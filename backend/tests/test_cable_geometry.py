"""Tests for geographic fiber route geometry, multi-vertex polylines, and length calculation.

Verifies:
1. Valid multi-vertex geometry with road waypoints.
2. Rejection of invalid, out-of-range, and non-finite coordinates.
3. Save/load preservation of intermediate vertices and length across SQLite persistence.
4. Accurate cable length calculation summing every segment along the polyline.
5. Bent multi-vertex route is strictly longer than direct route (triangle inequality).
6. Backward compatibility with straight-line routes and legacy projects.
7. Consistent route length semantics in construction cost (RAB) calculations.
8. Optical budget attenuation calculated from complete fiber route length.
9. Endpoint correspondence validation (startNodeId/endNodeId vs first/last coordinates).
10. Safe handling of duplicate consecutive points and malformed geometry without project corruption.
"""

import math
import pytest
from pydantic import ValidationError
from fastapi.testclient import TestClient

from backend.app.domain.models import (
    CableSegment,
    ConstructionCostConfig,
    LineGeometry,
    NetworkNode,
    NodeType,
    OpticalBudgetConfig,
    PointGeometry,
    Project,
    ProjectSettings,
    TopologyConnection,
)
from backend.app.domain.validation import (
    TopologyValidationError,
    ensure_valid_project,
    validate_connection_candidate,
    validate_project_integrity,
    validate_project_topology,
)
from backend.app.engine.cost import calculate_construction_cost
from backend.app.engine.geo import calculate_route_length, distance_meters, update_cable_lengths
from backend.app.engine.optical import calculate_optical_budget
from backend.app.persistence.repository import ProjectRepository


# --- Test 1: Coordinate Validation & Bounds ---

def test_point_geometry_finite_and_bounds():
    """Verify PointGeometry validates bounds and rejects non-finite values."""
    # Valid coordinates
    pt = PointGeometry(coordinates=(106.8450, -6.2080))
    assert pt.coordinates == (106.8450, -6.2080)

    # Longitude out of bounds
    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(180.001, -6.2080))
    assert "between -180 and 180" in str(exc.value)

    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(-180.5, 0.0))
    assert "between -180 and 180" in str(exc.value)

    # Latitude out of bounds
    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(106.0, 90.001))
    assert "between -90 and 90" in str(exc.value)

    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(106.0, -90.5))
    assert "between -90 and 90" in str(exc.value)

    # Non-finite values (NaN and Inf)
    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(float("nan"), -6.2080))
    assert "finite numbers" in str(exc.value)

    with pytest.raises(ValidationError) as exc:
        PointGeometry(coordinates=(106.8450, float("inf")))
    assert "finite numbers" in str(exc.value)


def test_line_geometry_multi_vertex_validation():
    """Verify LineGeometry validates multi-vertex polylines and rejects malformed coordinates."""
    # Valid 4-vertex polyline
    coords = [
        (106.8400, -6.2000),
        (106.8425, -6.2025),
        (106.8450, -6.2050),
        (106.8500, -6.2100),
    ]
    line = LineGeometry(coordinates=coords)
    assert len(line.coordinates) == 4
    assert line.coordinates[1] == (106.8425, -6.2025)

    # Fewer than 2 coordinates
    with pytest.raises(ValidationError) as exc:
        LineGeometry(coordinates=[(106.8400, -6.2000)])
    assert "at least two coordinates" in str(exc.value)

    # Empty coordinates
    with pytest.raises(ValidationError) as exc:
        LineGeometry(coordinates=[])
    assert "at least two coordinates" in str(exc.value)

    # Out of bounds intermediate vertex
    bad_coords = [
        (106.8400, -6.2000),
        (106.8425, -95.0000),  # Latitude out of range
        (106.8500, -6.2100),
    ]
    with pytest.raises(ValidationError) as exc:
        LineGeometry(coordinates=bad_coords)
    assert "out of bounds" in str(exc.value)

    # Non-finite intermediate vertex
    nan_coords = [
        (106.8400, -6.2000),
        (float("nan"), -6.2025),
        (106.8500, -6.2100),
    ]
    with pytest.raises(ValidationError) as exc:
        LineGeometry(coordinates=nan_coords)
    assert "finite numeric values" in str(exc.value)


# --- Test 2: Multi-Vertex Distance and Triangle Inequality ---

def test_bent_route_longer_than_direct_route():
    """Prove that a bent multi-vertex route is strictly longer than the direct route (triangle inequality)."""
    p_start = (106.8400, -6.2000)
    p_end = (106.8500, -6.2000)
    # Intermediate waypoint displaced laterally along a road detour
    p_waypoint = (106.8450, -6.2050)

    direct_line = [p_start, p_end]
    bent_line = [p_start, p_waypoint, p_end]

    len_direct = calculate_route_length(direct_line)
    len_bent = calculate_route_length(bent_line)

    assert len_direct > 0.0
    assert len_bent > 0.0
    # Bent route must be strictly longer than straight direct route
    assert len_bent > len_direct
    assert (len_bent - len_direct) > 400.0  # Significant difference (>400m)

    # Sum of individual segments must equal cumulative length
    seg1 = distance_meters(p_start, p_waypoint)
    seg2 = distance_meters(p_waypoint, p_end)
    assert pytest.approx(len_bent, abs=0.01) == (seg1 + seg2)


def test_duplicate_consecutive_points_handled_safely():
    """Verify duplicate consecutive vertices add 0 meters and do not trigger errors."""
    p1 = (106.8400, -6.2000)
    p2 = (106.8450, -6.2025)
    p3 = (106.8500, -6.2050)

    clean_coords = [p1, p2, p3]
    with_dups = [p1, p1, p2, p2, p2, p3, p3]

    len_clean = calculate_route_length(clean_coords)
    len_dups = calculate_route_length(with_dups)

    assert pytest.approx(len_clean, abs=0.001) == len_dups


# --- Test 3: Endpoint Correspondence Validation ---

def test_cable_endpoints_correspondence_valid():
    """Verify cable with matching start/end nodes passes integrity validation."""
    node_a = NetworkNode(
        id="node-a",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_b = NetworkNode(
        id="node-b",
        type=NodeType.ODC,
        name="ODC Main",
        location=PointGeometry(coordinates=(106.8500, -6.2000)),
    )
    # Cable starting at node-a and ending at node-b with 3 intermediate road waypoints
    cable = CableSegment(
        id="c-road",
        name="Road Feeder Cable",
        start_node_id="node-a",
        end_node_id="node-b",
        geometry=LineGeometry(
            coordinates=[
                (106.8400, -6.2000),  # Matches node-a exactly
                (106.8425, -6.2010),
                (106.8450, -6.2020),
                (106.8475, -6.2010),
                (106.8500, -6.2000),  # Matches node-b exactly
            ]
        ),
    )
    conn = TopologyConnection(
        id="conn-1",
        from_node_id="node-a",
        to_node_id="node-b",
        cable_segment_id="c-road",
    )
    project = Project(
        id="proj-valid-endpoints",
        name="Valid Endpoints Project",
        nodes=[node_a, node_b],
        cable_segments=[cable],
        connections=[conn],
    )

    errors = validate_project_integrity(project)
    assert len(errors) == 0


def test_cable_endpoints_drawn_in_either_direction_allowed():
    """Verify route coordinates drawn in reverse direction relative to startNodeId/endNodeId are valid."""
    node_a = NetworkNode(
        id="node-a",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_b = NetworkNode(
        id="node-b",
        type=NodeType.ODC,
        name="ODC Main",
        location=PointGeometry(coordinates=(106.8500, -6.2000)),
    )
    # Drawn from node-b to node-a
    cable = CableSegment(
        id="c-reversed",
        name="Reversed Feeder",
        start_node_id="node-a",
        end_node_id="node-b",
        geometry=LineGeometry(
            coordinates=[
                (106.8500, -6.2000),  # Node B location
                (106.8450, -6.2020),
                (106.8400, -6.2000),  # Node A location
            ]
        ),
    )
    project = Project(
        id="proj-reversed",
        name="Reversed Route Project",
        nodes=[node_a, node_b],
        cable_segments=[cable],
    )

    errors = validate_project_integrity(project)
    assert len(errors) == 0


def test_cable_endpoints_mismatched_coordinates_rejected():
    """Verify cable route coordinates not corresponding to endpoint node locations are rejected."""
    node_a = NetworkNode(
        id="node-a",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_b = NetworkNode(
        id="node-b",
        type=NodeType.ODC,
        name="ODC Main",
        location=PointGeometry(coordinates=(106.8500, -6.2000)),
    )
    # Cable claiming start_node_id="node-a", but starting far away in Bali (115.0, -8.0)
    cable = CableSegment(
        id="c-mismatch",
        name="Mismatched Route",
        start_node_id="node-a",
        end_node_id="node-b",
        geometry=LineGeometry(
            coordinates=[
                (115.0000, -8.0000),  # Far away from node-a
                (106.8500, -6.2000),
            ]
        ),
    )
    project = Project(
        id="proj-mismatch",
        name="Mismatch Project",
        nodes=[node_a, node_b],
        cable_segments=[cable],
    )

    errors = validate_project_integrity(project)
    assert len(errors) > 0
    assert any("does not correspond to start node" in e.message for e in errors)


def test_cable_same_start_and_end_node_rejected():
    """Verify a cable cannot have the same startNodeId and endNodeId."""
    node_a = NetworkNode(
        id="node-a",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    cable = CableSegment(
        id="c-loop",
        name="Loop Cable",
        start_node_id="node-a",
        end_node_id="node-a",
        geometry=LineGeometry(
            coordinates=[(106.8400, -6.2000), (106.8410, -6.2010), (106.8400, -6.2000)]
        ),
    )
    project = Project(id="p-loop", name="Loop Cable Proj", nodes=[node_a], cable_segments=[cable])
    errors = validate_project_integrity(project)
    assert any("cannot be the same node" in e.message for e in errors)


# --- Test 4: Save/Load Preservation Across SQLite ---

def test_persistence_preserves_multi_vertex_geometry_and_length(client: TestClient, db_session):
    """Verify that intermediate road waypoints and length round-trip through SQLite intact."""
    node_olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="Central OLT",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_odc = NetworkNode(
        id="odc-1",
        type=NodeType.ODC,
        name="Distribution Cabinet",
        location=PointGeometry(coordinates=(106.8500, -6.2050)),
    )
    # Multi-vertex route with 5 coordinates
    route_coords = [
        (106.8400, -6.2000),
        (106.8420, -6.2010),
        (106.8445, -6.2030),
        (106.8470, -6.2035),
        (106.8500, -6.2050),
    ]
    cable = CableSegment(
        id="cable-multi",
        name="Feeder Along Boulevard",
        start_node_id="olt-1",
        end_node_id="odc-1",
        fiber_count=24,
        geometry=LineGeometry(coordinates=route_coords),
        properties={"logicalWaypoints": [{"x": 200, "y": 300}]},
    )
    conn = TopologyConnection(
        id="conn-1",
        from_node_id="olt-1",
        to_node_id="odc-1",
        cable_segment_id="cable-multi",
    )

    p = Project(
        id="proj-multi-vertex",
        name="Multi-Vertex Boulevard Project",
        nodes=[node_olt, node_odc],
        cable_segments=[cable],
        connections=[conn],
    )

    repo = ProjectRepository(db_session)
    saved = repo.save(p)

    # 1. Authoritative length computed summing all 4 segments
    expected_length = round(calculate_route_length(route_coords), 2)
    assert saved.cable_segments[0].length_m == expected_length
    assert saved.cable_segments[0].length_m > 1200.0

    # 2. Reload from database
    loaded = repo.get("proj-multi-vertex")
    assert loaded is not None
    loaded_cable = loaded.cable_segments[0]

    # Verify all coordinates preserved in order
    assert len(loaded_cable.geometry.coordinates) == 5
    assert loaded_cable.geometry.coordinates == route_coords
    assert loaded_cable.length_m == expected_length

    # Verify logicalWaypoints in properties did NOT overwrite geographic coordinates
    assert loaded_cable.properties.get("logicalWaypoints") == [{"x": 200, "y": 300}]
    assert isinstance(loaded_cable.geometry.coordinates[0][0], float)

    # 3. Via API GET
    res_api = client.get("/api/v1/projects/proj-multi-vertex")
    assert res_api.status_code == 200
    api_cable = res_api.json()["cableSegments"][0]
    assert len(api_cable["geometry"]["coordinates"]) == 5
    assert api_cable["lengthM"] == expected_length


# --- Test 5: Construction Cost (RAB) Uses Multi-Vertex Route Length ---

def test_construction_cost_uses_full_polyline_length():
    """Verify formal RAB calculation computes cable supply and installation from complete multi-vertex length."""
    node_olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_ont = NetworkNode(
        id="ont-1",
        type=NodeType.ONT,
        name="ONT Subscriber",
        location=PointGeometry(coordinates=(106.8500, -6.2000)),
    )

    direct_coords = [(106.8400, -6.2000), (106.8500, -6.2000)]
    bent_coords = [(106.8400, -6.2000), (106.8450, -6.2060), (106.8500, -6.2000)]

    c_direct = CableSegment(id="c-dir", name="Direct", geometry=LineGeometry(coordinates=direct_coords))
    c_bent = CableSegment(id="c-bent", name="Bent Road", geometry=LineGeometry(coordinates=bent_coords))

    config = ConstructionCostConfig(
        cable_slack_percent=10.0,
        cable_unit_cost_per_meter=5000.0,
        cable_installation_cost_per_meter=7500.0,
    )

    p_direct = Project(
        id="p-dir",
        name="Direct Project",
        nodes=[node_olt, node_ont],
        cable_segments=[c_direct],
        settings=ProjectSettings(construction_cost=config),
    )
    p_bent = Project(
        id="p-bnt",
        name="Bent Project",
        nodes=[node_olt, node_ont],
        cable_segments=[c_bent],
        settings=ProjectSettings(construction_cost=config),
    )

    cost_direct = calculate_construction_cost(p_direct)
    cost_bent = calculate_construction_cost(p_bent)

    cbl_direct_item = next(i for i in cost_direct.items if i.code == "CBL-SUPPLY")
    cbl_bent_item = next(i for i in cost_bent.items if i.code == "CBL-SUPPLY")

    # Bent route must result in strictly higher cable quantity and higher total cost
    assert cbl_bent_item.quantity > cbl_direct_item.quantity
    assert cost_bent.total_amount > cost_direct.total_amount

    # Verify billed quantity matches raw length * 1.10
    raw_bent_length = calculate_route_length(bent_coords)
    expected_billed_m = round(raw_bent_length * 1.10, 2)
    assert cbl_bent_item.quantity == expected_billed_m


# --- Test 6: Optical Budget Uses Complete Route Length ---

def test_optical_budget_uses_full_polyline_length():
    """Verify optical power budget calculates fiber attenuation loss from complete multi-vertex polyline length."""
    node_olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT Central",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
        properties={"txPowerDbm": 3.0},
    )
    node_ont = NetworkNode(
        id="ont-1",
        type=NodeType.ONT,
        name="ONT End",
        location=PointGeometry(coordinates=(106.8500, -6.2000)),
        properties={"rxSensitivityDbm": -27.0, "rxOverloadDbm": -8.0},
    )

    direct_coords = [(106.8400, -6.2000), (106.8500, -6.2000)]
    bent_coords = [
        (106.8400, -6.2000),
        (106.8450, -6.2100),
        (106.8500, -6.2000),
    ]

    c_direct = CableSegment(
        id="c-dir",
        name="Direct Cable",
        geometry=LineGeometry(coordinates=direct_coords),
        fiber_count=12,
    )
    c_bent = CableSegment(
        id="c-bent",
        name="Bent Road Cable",
        geometry=LineGeometry(coordinates=bent_coords),
        fiber_count=12,
    )

    conn_dir = TopologyConnection(id="conn-dir", from_node_id="olt-1", to_node_id="ont-1", cable_segment_id="c-dir")
    conn_bent = TopologyConnection(id="conn-bent", from_node_id="olt-1", to_node_id="ont-1", cable_segment_id="c-bent")

    cfg = OpticalBudgetConfig(
        fiber_attenuation_db_per_km=0.35,
        connector_loss_db=0.5,
        connectors_per_link=2,
        splice_loss_db=0.1,
        splices_per_link=1,
        safety_margin_db=3.0,
    )

    p_dir = Project(
        id="p-dir",
        name="Direct",
        nodes=[node_olt, node_ont],
        cable_segments=[c_direct],
        connections=[conn_dir],
        settings=ProjectSettings(optical_budget=cfg),
    )
    p_bent = Project(
        id="p-bnt",
        name="Bent",
        nodes=[node_olt, node_ont],
        cable_segments=[c_bent],
        connections=[conn_bent],
        settings=ProjectSettings(optical_budget=cfg),
    )

    opt_direct = calculate_optical_budget(p_dir)
    opt_bent = calculate_optical_budget(p_bent)

    path_dir = opt_direct.paths[0]
    path_bent = opt_bent.paths[0]

    assert path_bent.length_m > path_dir.length_m
    # Bent route fiber loss must be strictly greater due to longer physical distance
    assert path_bent.loss_db > path_dir.loss_db
    assert path_bent.received_power_dbm < path_dir.received_power_dbm

    # Segment fiber loss matches (length_m / 1000) * alpha
    bent_seg = path_bent.segments[0]
    expected_seg_fiber_loss = round((path_bent.length_m / 1000.0) * 0.35, 2)
    assert bent_seg.fiber_loss_db == expected_seg_fiber_loss


# --- Test 7: Candidate Connection Pre-Validation with Geometry ---

def test_candidate_connection_validation_with_geometry(client: TestClient, db_session):
    """Verify validate-connection returns cable length and vertex count in summary."""
    node_a = NetworkNode(
        id="olt-pre",
        type=NodeType.OLT,
        name="OLT Pre",
        location=PointGeometry(coordinates=(106.8400, -6.2000)),
    )
    node_b = NetworkNode(
        id="odc-pre",
        type=NodeType.ODC,
        name="ODC Pre",
        location=PointGeometry(coordinates=(106.8500, -6.2050)),
    )
    cable = CableSegment(
        id="c-pre",
        name="Pre-validation Cable",
        start_node_id="olt-pre",
        end_node_id="odc-pre",
        geometry=LineGeometry(
            coordinates=[
                (106.8400, -6.2000),
                (106.8430, -6.2020),
                (106.8470, -6.2040),
                (106.8500, -6.2050),
            ]
        ),
    )

    project = Project(
        id="proj-pre-val",
        name="Pre-val Project",
        nodes=[node_a, node_b],
        cable_segments=[cable],
    )
    ProjectRepository(db_session).save(project)

    # 1. Valid candidate connection matching cable endpoints
    res_valid = client.post(
        "/api/v1/projects/proj-pre-val/validate-connection",
        json={
            "fromNodeId": "olt-pre",
            "toNodeId": "odc-pre",
            "cableSegmentId": "c-pre",
        },
    )
    assert res_valid.status_code == 200
    valid_data = res_valid.json()
    assert valid_data["valid"] is True
    assert valid_data["summary"]["cableVertexCount"] == 4
    assert valid_data["summary"]["cableLengthM"] > 1000.0

    # 2. Connection to different node rejected when cable has explicit endpoints
    node_c = NetworkNode(
        id="ont-pre",
        type=NodeType.ONT,
        name="ONT Pre",
        location=PointGeometry(coordinates=(106.8550, -6.2050)),
    )
    project.nodes.append(node_c)
    ProjectRepository(db_session).save(project)

    res_mismatch = client.post(
        "/api/v1/projects/proj-pre-val/validate-connection",
        json={
            "fromNodeId": "olt-pre",
            "toNodeId": "ont-pre",  # Mismatched destination (cable is bound to odc-pre)
            "cableSegmentId": "c-pre",
        },
    )
    assert res_mismatch.status_code == 200
    mismatch_data = res_mismatch.json()
    assert mismatch_data["valid"] is False
    assert any(err["code"] == "cable_endpoint_mismatch" for err in mismatch_data["errors"])


# --- Test 8: Rejection of Malformed Geometry without Project Corruption ---

def test_put_malformed_geometry_rejected_without_corrupting_project(client: TestClient, db_session):
    """Verify that submitting malformed cable coordinates returns 422 and preserves existing project."""
    repo = ProjectRepository(db_session)
    node_a = NetworkNode(id="n-a", type=NodeType.OLT, name="A", location=PointGeometry(coordinates=(106.84, -6.20)))
    node_b = NetworkNode(id="n-b", type=NodeType.ONT, name="B", location=PointGeometry(coordinates=(106.85, -6.20)))
    cable = CableSegment(
        id="c-orig",
        name="Original",
        geometry=LineGeometry(coordinates=[(106.84, -6.20), (106.85, -6.20)]),
    )
    initial_project = Project(
        id="proj-safe",
        name="Safe Project",
        nodes=[node_a, node_b],
        cable_segments=[cable],
    )
    repo.save(initial_project)

    # Corrupt payload with invalid longitude (250.0 > 180.0)
    bad_payload = initial_project.model_dump(by_alias=True)
    bad_payload["cableSegments"][0]["geometry"]["coordinates"] = [
        [106.84, -6.20],
        [250.0, -6.20],  # Invalid!
    ]

    res = client.put("/api/v1/projects/proj-safe", json=bad_payload)
    assert res.status_code == 422
    err_json = res.json()
    assert err_json["error"]["code"] == "validation_error"

    # Database state MUST remain uncorrupted and intact
    saved = repo.get("proj-safe")
    assert saved is not None
    assert saved.cable_segments[0].geometry.coordinates == [(106.84, -6.20), (106.85, -6.20)]
