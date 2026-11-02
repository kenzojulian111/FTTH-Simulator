import pytest

from backend.app.domain.models import (
    CableSegment, Customer, LineGeometry, NetworkNode, NodeType, PointGeometry,
    Project, TopologyConnection,
)
from backend.app.domain.validation import ensure_valid_project, validate_project_topology
from backend.app.engine.optical import calculate_optical_budget
from backend.app.persistence.repository import ProjectRepository


def _manual_cable(cable_id: str, start: str, end: str) -> CableSegment:
    return CableSegment(
        id=cable_id, name=cable_id, cable_type="drop", start_node_id=start,
        end_node_id=end, geometry=LineGeometry(coordinates=[]), length_m=None,
        properties={"routeStatus": "manual_required", "cableCategory": "drop"},
    )


def test_manual_route_round_trip_stays_logically_connected_but_optically_unknown(db_session):
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    ont = NetworkNode(id="ont", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(0.001, 0)))
    cable = _manual_cable("drop", "olt", "ont")
    project = Project(id="manual-route", name="Manual route", nodes=[olt, ont], cable_segments=[cable],
        connections=[TopologyConnection(id="link", from_node_id="olt", to_node_id="ont", cable_segment_id="drop")],
        customers=[Customer(id="customer", name="Customer", location=ont.location, ont_node_id="ont")])

    ensure_valid_project(project)
    assert validate_project_topology(project).valid
    assert any(issue.code == "manual_route_required" for issue in validate_project_topology(project).warnings)

    repository = ProjectRepository(db_session)
    repository.save(project)
    db_session.commit()
    loaded = repository.get("manual-route")
    assert loaded is not None
    assert loaded.cable_segments[0].geometry.coordinates == []
    assert loaded.cable_segments[0].length_m is None

    optical = calculate_optical_budget(loaded)
    path = optical.paths[0]
    assert path.connectivity_status == "connected"
    assert path.status == "unknown"
    assert path.received_power_dbm is None
    assert path.loss_db is None
    assert optical.links[0].length_m is None
    assert optical.links[0].loss_db is None
    assert path.segments[0].length_m is None
    assert path.segments[0].route_length_contribution_m is None
    assert any(diagnostic.code == "MANUAL_ROUTE_REQUIRED" for diagnostic in path.diagnostics)


def test_empty_cable_route_requires_explicit_manual_provenance():
    with pytest.raises(ValueError, match="routeStatus='manual_required'"):
        CableSegment(id="empty", name="Empty", geometry=LineGeometry(coordinates=[]))


def test_splitter_output_capacity_is_enforced_for_manual_routes():
    splitter = NetworkNode(id="splitter", type=NodeType.SPLITTER, name="1:8", location=PointGeometry(coordinates=(0, 0)), properties={"splitterRatio": "1:8"})
    onts = [NetworkNode(id=f"ont-{i}", type=NodeType.ONT, name=f"ONT {i}", location=PointGeometry(coordinates=(0, 0))) for i in range(9)]
    cables = [_manual_cable(f"drop-{i}", "splitter", ont.id) for i, ont in enumerate(onts)]
    connections = [TopologyConnection(id=f"link-{i}", from_node_id="splitter", to_node_id=ont.id, cable_segment_id=f"drop-{i}") for i, ont in enumerate(onts)]
    project = Project(id="split-capacity", name="Capacity", nodes=[splitter, *onts], cable_segments=cables, connections=connections)
    result = validate_project_topology(project)
    assert not result.valid
    assert any(issue.code == "splitter_capacity_exceeded" for issue in result.errors)


def test_planned_odp_customer_limit_and_assignment_to_actual_upstream_are_validated():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odp = NetworkNode(id="odp", type=NodeType.ODP, name="ODP", location=PointGeometry(coordinates=(0.001, 0)), properties={"splitterRatio": "1:8"})
    onts = [NetworkNode(id=f"ont-{i}", type=NodeType.ONT, name=f"ONT {i}", location=odp.location) for i in range(9)]
    nodes = [olt, odp, *onts]
    cables = [_manual_cable("feed-0", "olt", "odp")]
    connections = [TopologyConnection(id="feed", from_node_id="olt", to_node_id="odp", cable_segment_id="feed-0")]
    cables.extend(_manual_cable(f"drop-{i}", "odp", ont.id) for i, ont in enumerate(onts))
    connections.extend(TopologyConnection(id=f"drop-link-{i}", from_node_id="odp", to_node_id=ont.id, cable_segment_id=f"drop-{i}") for i, ont in enumerate(onts))
    customers = [Customer(id=f"customer-{i}", name=f"Customer {i}", location=odp.location, ont_node_id=ont.id, properties={"plannedOdpNodeId": "odp"}) for i, ont in enumerate(onts)]
    project = Project(id="odp-capacity", name="ODP output limit", nodes=nodes, cable_segments=cables, connections=connections, customers=customers)
    result = validate_project_topology(project)
    assert not result.valid
    assert any(issue.code == "odp_customer_output_capacity_exceeded" for issue in result.errors)
    assert any(issue.code == "splitter_capacity_exceeded" for issue in result.errors)


def test_map_route_candidate_has_geometry_and_separates_optical_status_from_physical_route_status():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    ont = NetworkNode(id="ont", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(0.001, 0)))
    cable = CableSegment(id="route", name="Road candidate", cable_type="drop", geometry=LineGeometry(coordinates=[(0, 0), (0.0005, 0.0002), (0.001, 0)]), start_node_id="olt", end_node_id="ont", properties={"routeStatus": "map_candidate_unverified", "routeSource": "OpenStreetMap road route"})
    project = Project(id="map-candidate", name="Unverified map route", nodes=[olt, ont], cable_segments=[cable], connections=[TopologyConnection(id="link", from_node_id="olt", to_node_id="ont", cable_segment_id="route")])
    path = calculate_optical_budget(project).paths[0]
    assert path.connectivity_status == "connected"
    assert path.status in {"pass", "fail"}
    assert path.physical_route_status == "unverified"
    assert path.received_power_dbm is not None
    assert any(item.code == "ROUTE_FIELD_VERIFICATION_REQUIRED" for item in path.diagnostics)


def test_internal_jumper_length_is_not_inferred_as_zero_from_coincident_endpoints():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    ont = NetworkNode(id="ont", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(0, 0)))
    cable = _manual_cable("jumper", "olt", "ont")
    cable.name = "ODC internal jumper"
    cable.properties["connectionKind"] = "internal_optical_jumper"
    project = Project(
        id="internal-jumper-unknown", name="Unmeasured internal jumper",
        nodes=[olt, ont], cable_segments=[cable],
        connections=[TopologyConnection(id="link", from_node_id="olt", to_node_id="ont", cable_segment_id="jumper")],
    )

    validation = validate_project_topology(project)
    assert validation.valid
    assert any(issue.code == "internal_jumper_length_unknown" for issue in validation.warnings)
    path = calculate_optical_budget(project).paths[0]
    assert path.status == "unknown"
    assert path.status_reason == "internal_jumper_length_unknown"
    assert path.length_m is None
    assert path.loss_db is None
    diagnostic = next(item for item in path.diagnostics if item.code == "INTERNAL_JUMPER_LENGTH_UNKNOWN")
    assert "coincident node coordinates do not establish jumper length" in diagnostic.message


def test_olt_pon_and_odc_fanout_capacities_are_checked_when_configured():
    location = PointGeometry(coordinates=(0, 0))
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=location, properties={"requiredPonPorts": 2, "ponPortCapacity": 1})
    odc = NetworkNode(id="odc", type=NodeType.ODC, name="ODC", location=location, properties={"distributionFanoutPortsRequired": 14, "distributionFanoutCapacity": 12})
    result = validate_project_topology(Project(id="capacity", name="Capacity", nodes=[olt, odc]))
    assert not result.valid
    assert any(issue.code == "olt_pon_capacity_exceeded" for issue in result.errors)
    assert any(issue.code == "odc_fanout_capacity_exceeded" for issue in result.errors)


def test_required_feeder_core_count_is_not_assumed_from_missing_fiber_count():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="odc", type=NodeType.ODC, name="ODC", location=PointGeometry(coordinates=(0.001, 0)))
    cable = CableSegment(id="feeder", name="Feeder", cable_type="feeder", fiber_count=None, geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), start_node_id="olt", end_node_id="odc", properties={"requiredFiberCores": 2})
    project = Project(id="fiber-core-capacity", name="Core capacity", nodes=[olt, odc], cable_segments=[cable], connections=[TopologyConnection(id="link", from_node_id="olt", to_node_id="odc", cable_segment_id="feeder")])
    result = validate_project_topology(project)
    assert result.valid
    assert any(issue.code == "feeder_core_capacity_unknown" for issue in result.warnings)


def test_cabinet_mounted_splitters_are_used_without_internal_jumper_cables():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="odc", type=NodeType.ODC, name="ODC", location=PointGeometry(coordinates=(0.001, 0)), properties={"distributionFanoutCapacityStatus": "unknown", "distributionFanoutPortsRequired": 1})
    odp = NetworkNode(id="odp", type=NodeType.ODP, name="ODP", location=PointGeometry(coordinates=(0.002, 0)), properties={"sourcePonPortId": "PON-1"})
    ont = NetworkNode(id="ont", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(0.003, 0)), properties={"plannedPonPortId": "PON-1"})
    feeder_splitter = NetworkNode(id="fs", type=NodeType.SPLITTER, name="Feeder splitter", location=odc.location, properties={"mountedInNodeId": "odc", "inputPortId": "IN-01", "outputPortAssignments": [{"portId": "OUT-01", "connectedNodeId": "odp"}], "ponPortId": "PON-1", "splitterRatio": "1:2", "capacity": 2, "splitterSpecificationStatus": "profile_assumption_unverified", "opticalLocation": "ODC"})
    odp_splitter = NetworkNode(id="os", type=NodeType.SPLITTER, name="ODP splitter", location=odp.location, properties={"mountedInNodeId": "odp", "inputPortId": "IN-01", "outputPortAssignments": [{"portId": "OUT-01", "connectedNodeId": "ont"}], "odpNodeId": "odp", "splitterRatio": "1:2", "capacity": 2, "splitterSpecificationStatus": "profile_assumption_unverified", "opticalLocation": "ODP"})
    cables = [
        CableSegment(id="f", name="Feeder", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), length_m=100, start_node_id="olt", end_node_id="odc", properties={"cableCategory": "feeder"}),
        CableSegment(id="d", name="Distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0.001, 0), (0.002, 0)]), length_m=100, start_node_id="odc", end_node_id="odp", properties={"cableCategory": "distribution"}),
        CableSegment(id="r", name="Drop", cable_type="drop", geometry=LineGeometry(coordinates=[(0.002, 0), (0.003, 0)]), length_m=100, start_node_id="odp", end_node_id="ont", properties={"cableCategory": "drop"}),
    ]
    connections = [TopologyConnection(id="f-link", from_node_id="olt", to_node_id="odc", cable_segment_id="f"), TopologyConnection(id="d-link", from_node_id="odc", to_node_id="odp", cable_segment_id="d"), TopologyConnection(id="r-link", from_node_id="odp", to_node_id="ont", cable_segment_id="r")]
    project = Project(id="mounted-splitters", name="Cabinet mounted splitters", nodes=[olt, odc, odp, ont, feeder_splitter, odp_splitter], cable_segments=cables, connections=connections)

    path = calculate_optical_budget(project).paths[0]
    assert path.connectivity_status == "connected"
    assert path.length_m == 300
    assert [(item.node_id, item.splitter_ratio) for item in path.splitters] == [("fs", "1:2"), ("os", "1:2")]
    assert sum(item.loss_db or 0 for item in path.splitters) == 7.0
    splitter_loss_rows = [item for item in path.component_losses if item.get("kind") == "splitter"]
    assert len(splitter_loss_rows) == 2
    assert sum(item["lossDb"] for item in splitter_loss_rows) == 7.0
    assert not any(item.code == "INTERNAL_JUMPER_LENGTH_UNKNOWN" for item in path.diagnostics)
    assert validate_project_topology(project).valid


def test_mounted_splitter_requires_explicit_valid_port_relationships():
    olt = NetworkNode(id="olt", type=NodeType.OLT, name="OLT", location=PointGeometry(coordinates=(0, 0)))
    odc = NetworkNode(id="odc", type=NodeType.ODC, name="ODC", location=PointGeometry(coordinates=(0.001, 0)))
    odp = NetworkNode(id="odp", type=NodeType.ODP, name="ODP", location=PointGeometry(coordinates=(0.002, 0)))
    ont = NetworkNode(id="ont", type=NodeType.ONT, name="ONT", location=PointGeometry(coordinates=(0.003, 0)))
    splitter = NetworkNode(id="splitter", type=NodeType.SPLITTER, name="Cabinet splitter", location=odc.location, properties={
        "mountedInNodeId": "odc", "splitterRatio": "1:1", "inputPortId": "IN-01",
        "outputPortAssignments": [{"portId": "OUT-01", "connectedNodeId": "ont"}],
    })
    cables = [
        CableSegment(id="f", name="Feeder", cable_type="feeder", geometry=LineGeometry(coordinates=[(0, 0), (0.001, 0)]), start_node_id="olt", end_node_id="odc"),
        CableSegment(id="d", name="Distribution", cable_type="distribution", geometry=LineGeometry(coordinates=[(0.001, 0), (0.002, 0)]), start_node_id="odc", end_node_id="odp"),
        CableSegment(id="r", name="Drop", cable_type="drop", geometry=LineGeometry(coordinates=[(0.002, 0), (0.003, 0)]), start_node_id="odp", end_node_id="ont"),
    ]
    connections = [TopologyConnection(id="f", from_node_id="olt", to_node_id="odc", cable_segment_id="f"), TopologyConnection(id="d", from_node_id="odc", to_node_id="odp", cable_segment_id="d"), TopologyConnection(id="r", from_node_id="odp", to_node_id="ont", cable_segment_id="r")]
    project = Project(id="ports", name="Port references", nodes=[olt, odc, odp, ont, splitter], cable_segments=cables, connections=connections)
    result = validate_project_topology(project)
    assert not result.valid
    assert any(issue.code == "splitter_output_topology_mismatch" for issue in result.errors)

    splitter.properties["outputPortAssignments"] = [{"portId": "OUT-01", "connectedNodeId": "odp"}, {"portId": "OUT-01", "connectedNodeId": "odp"}]
    result = validate_project_topology(project)
    assert any(issue.code == "splitter_output_ports_invalid" for issue in result.errors)
    assert any(issue.code == "splitter_output_target_duplicate" for issue in result.errors)
