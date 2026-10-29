"""Unit tests for domain model and topology validation."""

import pytest
from pydantic import ValidationError

from backend.app.domain.models import (
    CableSegment,
    Customer,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    TopologyConnection,
)
from backend.app.domain.validation import (
    TopologyValidationError,
    ensure_valid_project,
    validate_project_integrity,
    validate_project_topology,
)


def test_node_name_cannot_be_empty():
    """Verify whitespace or empty node name fails validation."""
    with pytest.raises(ValidationError) as exc:
        NetworkNode(
            id="n1",
            type=NodeType.OLT,
            name="   ",
            location=PointGeometry(coordinates=(115.0, -8.0)),
        )
    assert "Node name must not be empty" in str(exc.value)


def test_coordinates_out_of_range():
    """Verify longitude and latitude out of bounds fail validation."""
    with pytest.raises(ValidationError):
        PointGeometry(coordinates=(185.0, 0.0))

    with pytest.raises(ValidationError):
        PointGeometry(coordinates=(0.0, -95.0))


def test_line_string_minimum_two_points():
    """Verify LineString with less than 2 coordinates fails."""
    with pytest.raises(ValidationError) as exc:
        LineGeometry(coordinates=[(115.0, -8.0)])
    assert "at least two coordinates" in str(exc.value)


@pytest.mark.parametrize(
    "coordinates",
    [[(115.0, -8.0), (115.0, -8.0)], [(115.0, -8.0), (115.0, -8.0), (115.0, -8.0)]],
)
def test_zero_length_cable_route_is_rejected_by_project_and_topology_validation(coordinates):
    cable = CableSegment(id="zero", name="Zero route", geometry=LineGeometry(coordinates=coordinates))
    project = Project(id="zero-route", name="Zero route", cable_segments=[cable])

    integrity = validate_project_integrity(project)
    assert any("zero geographic route length" in issue.message for issue in integrity)
    assert any(issue.code == "zero_length_cable_route" for issue in validate_project_topology(project).errors) is False


def test_short_nonzero_cable_route_is_not_classified_as_zero_length():
    cable = CableSegment(id="short", name="Short route", geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.000000000001, -8.0)]))
    project = Project(id="short-route", name="Short route", cable_segments=[cable])

    assert not any("zero geographic route length" in issue.message for issue in validate_project_integrity(project))


def test_topology_diagnostic_marks_connected_zero_length_cable():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(115.0, -8.0)))
    odc = NetworkNode(id="odc", type=NodeType.ODC, name="ODC", location=PointGeometry(coordinates=(115.0, -8.0)))
    cable = CableSegment(id="zero", name="Zero route", geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.0, -8.0)]))
    project = Project(id="zero-topology", name="Zero topology", nodes=[olt, odc], cable_segments=[cable], connections=[TopologyConnection(id="link", from_node_id="olt", to_node_id="odc", cable_segment_id="zero")])

    issues = validate_project_topology(project).errors
    assert any(issue.code == "zero_length_cable_route" and issue.connection_id == "link" for issue in issues)


def test_fiber_count_must_be_positive():
    """Verify non-positive fiberCount fails validation."""
    with pytest.raises(ValidationError):
        CableSegment(
            id="c1",
            name="Test Cable",
            fiber_count=0,
            geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.1, -8.1)]),
        )


def test_self_loop_connection_fails():
    """Verify connection from a node to itself fails validation."""
    with pytest.raises(ValidationError) as exc:
        TopologyConnection(
            id="conn-1",
            from_node_id="node-1",
            to_node_id="node-1",
            cable_segment_id="cable-1",
        )
    assert "self-link is invalid" in str(exc.value)


def test_missing_from_node_reference(sample_project: Project):
    """Verify error reported when fromNodeId does not exist."""
    sample_project.connections.append(
        TopologyConnection(
            id="conn-bad",
            from_node_id="non-existent-node",
            to_node_id="node-odc-1",
            cable_segment_id="cable-feeder-1",
        )
    )
    errors = validate_project_integrity(sample_project)
    assert any("fromNodeId" in (err.field or "") for err in errors)
    assert any("non-existent-node" in err.message for err in errors)


def test_missing_to_node_reference(sample_project: Project):
    """Verify error reported when toNodeId does not exist."""
    sample_project.connections.append(
        TopologyConnection(
            id="conn-bad-2",
            from_node_id="node-olt-1",
            to_node_id="ghost-node",
            cable_segment_id="cable-feeder-1",
        )
    )
    errors = validate_project_integrity(sample_project)
    assert any("toNodeId" in (err.field or "") for err in errors)


def test_missing_cable_reference(sample_project: Project):
    """Verify error reported when cableSegmentId does not exist."""
    sample_project.connections.append(
        TopologyConnection(
            id="conn-bad-3",
            from_node_id="node-olt-1",
            to_node_id="node-odc-1",
            cable_segment_id="ghost-cable",
        )
    )
    errors = validate_project_integrity(sample_project)
    assert any("cableSegmentId" in (err.field or "") for err in errors)


def test_customer_ont_reference_must_exist_and_be_an_ont(sample_project: Project):
    sample_project.customers[0].ont_node_id = "missing-ont"
    errors = validate_project_integrity(sample_project)
    assert any("ontNodeId" in (err.field or "") for err in errors)

    sample_project.customers[0].ont_node_id = "node-olt-1"
    errors = validate_project_integrity(sample_project)
    assert any("not an ONT" in err.message for err in errors)


def test_duplicate_connection_triplet(sample_project: Project):
    """Verify duplicate connection between same nodes and cable is caught."""
    sample_project.connections.append(
        TopologyConnection(
            id="conn-dup",
            from_node_id="node-olt-1",
            to_node_id="node-odc-1",
            cable_segment_id="cable-feeder-1",
        )
    )
    errors = validate_project_integrity(sample_project)
    assert any("Duplicate connection" in err.message for err in errors)


def test_ensure_valid_project_raises(sample_project: Project):
    """Verify ensure_valid_project raises TopologyValidationError."""
    sample_project.connections.append(
        TopologyConnection(
            id="conn-bad",
            from_node_id="invalid-id",
            to_node_id="node-odc-1",
            cable_segment_id="cable-feeder-1",
        )
    )
    with pytest.raises(TopologyValidationError) as exc_info:
        ensure_valid_project(sample_project)
    assert len(exc_info.value.details) > 0
