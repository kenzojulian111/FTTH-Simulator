"""Tests for edge cases, missing configurations, and boundary conditions."""

import pytest
from fastapi.testclient import TestClient

from backend.app.domain.models import (
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    TopologyConnection,
)
from backend.app.engine.cost import calculate_construction_cost
from backend.app.engine.optical import calculate_optical_budget
from backend.app.persistence.repository import ProjectRepository


def test_empty_project_calculations():
    """Verify calculating on an empty project handles 0 quantities gracefully."""
    empty_proj = Project(
        id="empty-1",
        name="Empty Project",
        nodes=[],
        customers=[],
        cable_segments=[],
        connections=[],
    )

    # Optical budget should return 0 links without crashing
    opt_result = calculate_optical_budget(empty_proj)
    assert opt_result.links == []
    assert opt_result.summary["totalLinks"] == 0

    # Construction cost should return 0 total without ZeroDivisionError
    cost_result = calculate_construction_cost(empty_proj)
    assert cost_result.total_amount == 0.0
    assert cost_result.cost_per_connected_customer is None
    assert cost_result.items == []


def test_cost_calculation_zero_connected_customers_with_planned_only():
    """Verify planned-only customers do not cause division by zero in cost per customer."""
    node = NetworkNode(
        id="p1",
        type=NodeType.POLE,
        name="Pole 1",
        location=PointGeometry(coordinates=(115.0, -8.0)),
    )
    cust = Customer(
        id="c1",
        name="Planned Customer",
        location=PointGeometry(coordinates=(115.01, -8.01)),
        status=CustomerStatus.PLANNED,
    )
    proj = Project(
        id="proj-planned",
        name="Planned Only",
        nodes=[node],
        customers=[cust],
    )
    cost = calculate_construction_cost(proj)
    assert cost.total_amount > 0
    assert cost.connected_customer_count == 0
    assert cost.cost_per_connected_customer is None


def test_optical_budget_unlisted_splitter_ratio():
    """Verify node with unknown splitter ratio defaults gracefully without throwing."""
    olt = NetworkNode(
        id="olt",
        type=NodeType.OLT,
        name="OLT",
        location=PointGeometry(coordinates=(115.0, -8.0)),
    )
    odc = NetworkNode(
        id="odc",
        type=NodeType.ODC,
        name="ODC",
        location=PointGeometry(coordinates=(115.01, -8.01)),
        properties={"splitterRatio": "1:999"},  # Unlisted ratio
    )
    cable = LineGeometry(coordinates=[(115.0, -8.0), (115.01, -8.01)])
    c = LineGeometry(coordinates=[(115.0, -8.0), (115.01, -8.01)])
    from backend.app.domain.models import CableSegment
    cable_seg = CableSegment(id="cab1", name="Cab", geometry=c, length_m=500.0)
    conn = TopologyConnection(id="c1", from_node_id="olt", to_node_id="odc", cable_segment_id="cab1")

    proj = Project(id="p-unlisted", name="Test", nodes=[olt, odc], cable_segments=[cable_seg], connections=[conn])
    result = calculate_optical_budget(proj)
    assert len(result.links) == 1
    # Unlisted splitter ratio without explicit loss must not silently pass; returns status 'unknown'
    assert result.links[0].status == "unknown"
    assert "unknown splitter ratio" in result.links[0].details.get("error", "").lower()


def test_optical_budget_receiver_overload():
    """Verify receiver power exceeding overload threshold triggers status 'fail'."""
    olt = NetworkNode(
        id="olt",
        type=NodeType.OLT,
        name="OLT High Power",
        location=PointGeometry(coordinates=(115.0, -8.0)),
        properties={"txPowerDbm": 10.0},  # +10 dBm high power Tx
    )
    ont = NetworkNode(
        id="ont",
        type=NodeType.ONT,
        name="ONT Saturated",
        location=PointGeometry(coordinates=(115.0001, -8.0)),
        properties={"rxOverloadDbm": -8.0},
    )
    from backend.app.domain.models import CableSegment
    cable_seg = CableSegment(
        id="short-cab",
        name="Short Jump",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.0001, -8.0)]),
        length_m=10.0,
    )
    conn = TopologyConnection(id="c1", from_node_id="olt", to_node_id="ont", cable_segment_id="short-cab")
    proj = Project(id="p-overload", name="Test", nodes=[olt, ont], cable_segments=[cable_seg], connections=[conn])

    # Total loss on 10m is around ~4.1 dB (conn 1.0 + splice 0.1 + safety 3.0)
    # Rx Power = 10.0 - 4.1 = +5.9 dBm (way above -8.0 dBm overload limit)
    result = calculate_optical_budget(proj)
    assert result.links[0].status == "fail"
    assert result.links[0].received_power_dbm > -8.0


def test_api_empty_body_put_validation_error(client: TestClient):
    """Verify empty PUT body returns 422 with proper error structure."""
    res = client.put("/api/v1/projects/any-id", json={})
    assert res.status_code == 422
    data = res.json()
    assert data["error"]["code"] == "validation_error"
    assert any("name" in d["message"].lower() or "name" in d.get("field", "") for d in data["error"]["details"])


def test_geometry_update_recalculates_length(db_session):
    """Verify editing a cable's vertices and saving recalculates its length_m."""
    repo = ProjectRepository(db_session)
    from backend.app.domain.models import CableSegment

    initial_cable = CableSegment(
        id="cable-edit",
        name="Editable Cable",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.001, -8.0)]),
        length_m=None,
    )
    proj = Project(
        id="p-edit-geo",
        name="Geo Edit Test",
        cable_segments=[initial_cable],
    )
    saved_1 = repo.save(proj)
    len_1 = saved_1.cable_segments[0].length_m
    assert len_1 is not None

    # Now simulate dragging a handle or adding vertex (multiplied distance)
    saved_1.cable_segments[0].geometry.coordinates.append((115.005, -8.0))
    saved_2 = repo.save(saved_1)
    len_2 = saved_2.cable_segments[0].length_m
    assert len_2 > len_1 * 2
