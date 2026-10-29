"""End-to-end optical path tests, separate from the per-connection diagnostics."""

import pytest
from pydantic import ValidationError

from backend.app.domain.models import (
    CableSegment, Customer, CustomerStatus, LineGeometry, NetworkNode, NodeType,
    OpticalBudgetConfig, PointGeometry, Project, TopologyConnection,
)
from backend.app.engine.optical import calculate_optical_budget


def _node(node_id, node_type, properties=None):
    return NetworkNode(
        id=node_id, type=node_type, name=node_id,
        location=PointGeometry(coordinates=(115.0, -8.0)), properties=properties or {},
    )


def _cable(cable_id, length_m):
    return CableSegment(
        id=cable_id, name=cable_id,
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.001, -8.0)]),
        length_m=length_m,
    )


def _three_hop_project():
    olt = _node("olt", NodeType.OLT, {"txPowerDbm": 2.5})
    odc = _node("odc", NodeType.ODC, {"splitterRatio": "1:4"})
    odp = _node("odp", NodeType.ODP, {"splitterRatio": "1:8"})
    ont = _node("ont", NodeType.ONT, {"rxSensitivityDbm": -27.0})
    cables = [_cable("c1", 2000), _cable("c2", 3000), _cable("c3", 1000)]
    links = [
        TopologyConnection(id="l1", from_node_id="olt", to_node_id="odc", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="odc", to_node_id="odp", cable_segment_id="c2"),
        TopologyConnection(id="l3", from_node_id="odp", to_node_id="ont", cable_segment_id="c3"),
    ]
    customer = Customer(
        id="cust-1", name="Connected", location=PointGeometry(coordinates=(115.0, -8.0)),
        status=CustomerStatus.CONNECTED, ont_node_id="ont",
    )
    return Project(id="p", name="Three hop", nodes=[olt, odc, odp, ont], customers=[customer], cable_segments=cables, connections=links)


def test_accumulates_complete_olt_odc_odp_ont_path_losses():
    result = calculate_optical_budget(_three_hop_project())

    assert len(result.paths) == 1
    path = result.paths[0]
    assert path.status == "pass"
    assert path.node_ids == ["olt", "odc", "odp", "ont"]
    assert path.connection_ids == ["l1", "l2", "l3"]
    assert path.customer_ids == ["cust-1"]
    assert path.length_m == 6000
    # Fiber 2.10 + connectors 3.00 + splices 0.30 + two splitters 17.70 = 23.10 dB physical loss.
    # Total loss budget with margin = 26.10 dB.
    assert path.details["fiberLossDb"] == 2.1
    assert path.details["connectorLossDb"] == 3.0
    assert path.details["spliceLossDb"] == 0.3
    assert path.details["splitterLossDb"] == 17.7
    assert path.details["physicalLossDb"] == 23.1
    assert path.details["safetyMarginDb"] == 3.0
    assert path.details["totalLossDb"] == 26.1
    assert path.loss_db == 23.1
    # Physical received power (safety margin not deducted): 2.5 - 23.1 = -20.6 dBm
    assert path.received_power_dbm == -20.6
    # Design margin: -20.6 - (-27.0) - 3.0 = 3.4 dB
    assert path.margin_db == 3.4
    assert result.disconnected_customer_ids == []


def test_new_optical_defaults_identify_the_illustrative_profile():
    project = _three_hop_project()
    config = project.settings.optical_budget

    assert config.profile_id == "illustrative_gpon_planning_v1"
    assert set(config.parameter_sources.values()) == {"profile_default"}
    path = calculate_optical_budget(project).paths[0]
    assert path.status == "pass"
    assert path.profile_id == "illustrative_gpon_planning_v1"
    assert path.parameter_sources["txPowerDbm"] == "configured"
    assert path.parameter_sources["c1.connectorsCount"] == "profile_default"
    assert path.segments[0].fiber_type == "G.652.D"
    assert path.segments[0].wavelength_nm == 1310


def test_configured_provenance_requires_a_supplied_value():
    with pytest.raises(ValidationError, match="must include its value"):
        OpticalBudgetConfig.model_validate({"parameterSources": {"txPowerDbm": "configured"}})


def test_legacy_config_keeps_numeric_results_but_marks_feasibility_unknown():
    project_data = _three_hop_project().model_dump(by_alias=True)
    legacy_config = project_data["settings"]["opticalBudget"]
    legacy_config.pop("parameterSources")
    legacy_config.pop("profileId")

    legacy_project = Project.model_validate(project_data)
    result = calculate_optical_budget(legacy_project)
    path = result.paths[0]

    # Migration preserves the former numeric calculation while withholding a
    # feasibility pass because the saved values have no recorded provenance.
    assert path.length_m == 6000.0
    assert path.loss_db == 23.1
    assert path.received_power_dbm == -20.6
    assert path.status == "unknown"
    assert path.status_reason == "legacy_fallback_parameters"
    assert result.links[0].status == "unknown"
    assert path.parameter_sources["c1.fiberAttenuationDbPerKm"] == "legacy_fallback"
    serialized = path.model_dump(by_alias=True)
    assert serialized["parameterSources"]["txPowerDbm"] == "configured"
    assert serialized["profileId"] == "legacy_unclassified"


def test_explicitly_configured_parameter_sources_can_produce_a_pass():
    project = _three_hop_project()
    sources = {name: "configured" for name in project.settings.optical_budget.parameter_sources}
    config_data = project.settings.optical_budget.model_dump(by_alias=True)
    config_data.update({"parameterSources": sources, "profileId": None})
    config = OpticalBudgetConfig.model_validate(config_data)
    path = calculate_optical_budget(project, config_override=config).paths[0]

    assert path.status == "pass"
    assert path.parameter_sources["c1.fiberAttenuationDbPerKm"] == "configured"
    assert path.parameter_sources["txPowerDbm"] == "configured"
    assert path.profile_id is None


def test_reused_cable_geometry_contributes_once_to_end_to_end_length_and_fiber_loss():
    project = _three_hop_project()
    # Legacy payloads may reference one persistent physical cable object from
    # several consecutive logical links. The route itself remains one cable.
    for connection in project.connections:
        connection.cable_segment_id = "c1"
    project.cable_segments[0].length_m = 1000

    path = calculate_optical_budget(project).paths[0]

    assert path.length_m == 1000
    assert path.details["fiberLossDb"] == 0.35
    assert [segment.route_length_contribution_m for segment in path.segments] == [1000, 0, 0]
    assert [segment.length_m for segment in path.segments] == [1000, 1000, 1000]
    assert path.details["reusedCableSegmentIds"] == ["c1"]


def test_invalid_passive_multiple_feed_is_excluded_from_optical_path():
    olt_a = _node("olt-a", NodeType.OLT, {"txPowerDbm": 2.5})
    olt_b = _node("olt-b", NodeType.OLT, {"txPowerDbm": 2.5})
    splitter = _node("splitter", NodeType.SPLITTER, {"splitterRatio": "1:2", "splitterLossDb": 4.0})
    ont = _node("ont", NodeType.ONT, {"rxSensitivityDbm": -27.0})
    cables = [_cable(f"c{i}", 1000) for i in range(1, 4)]
    project = Project(
        id="invalid-merge",
        name="Invalid OLT merge",
        nodes=[olt_a, olt_b, splitter, ont],
        cable_segments=cables,
        connections=[
            TopologyConnection(id="a", from_node_id=olt_a.id, to_node_id=splitter.id, cable_segment_id="c1"),
            TopologyConnection(id="b", from_node_id=olt_b.id, to_node_id=splitter.id, cable_segment_id="c2"),
            TopologyConnection(id="drop", from_node_id=splitter.id, to_node_id=ont.id, cable_segment_id="c3"),
        ],
    )

    path = calculate_optical_budget(project).paths[0]

    assert path.status == "unknown"
    assert path.status_reason == "invalid_topology_connection"
    assert {item["connectionId"] for item in path.details["invalidConnections"]} == {"a", "b"}
    assert path.received_power_dbm is None


def test_unknown_fiber_attenuation_preserves_route_length_but_not_false_budget():
    project = _three_hop_project()
    sources = dict(project.settings.optical_budget.parameter_sources)
    sources["fiberAttenuationDbPerKm"] = "unknown"
    config = project.settings.optical_budget.model_copy(update={"parameter_sources": sources})

    path = calculate_optical_budget(project, config_override=config).paths[0]

    assert path.length_m == 6000.0
    assert path.segments[0].fiber_loss_db is None
    assert path.segments[0].connector_loss_db == 1.0
    assert path.loss_db is None
    assert path.received_power_dbm is None
    assert path.status == "unknown"
    assert path.status_reason == "unknown_optical_parameters"


@pytest.mark.parametrize("category", ["feeder", "distribution", "drop", "custom"])
def test_cable_category_does_not_select_physical_attenuation(category):
    project = _three_hop_project()
    project.cable_segments[2].properties["cableCategory"] = category
    project.cable_segments[2].properties["cableCategorySource"] = "manual"
    config_data = project.settings.optical_budget.model_dump(by_alias=True)
    config_data["fiberAttenuationDbPerKm"] = 0.30
    config_data["dropFiberAttenuationDbPerKm"] = 0.90
    config_data["parameterSources"]["fiberAttenuationDbPerKm"] = "configured"
    config_data["parameterSources"]["dropFiberAttenuationDbPerKm"] = "configured"
    config = OpticalBudgetConfig.model_validate(config_data)

    reference_project = _three_hop_project()
    reference_project.cable_segments[2].properties["cableCategory"] = "feeder"
    reference_loss = calculate_optical_budget(reference_project, config_override=config).paths[0].loss_db
    path = calculate_optical_budget(project, config_override=config).paths[0]
    segment = path.segments[-1]

    assert segment.attenuation_db_per_km == 0.30
    assert segment.fiber_loss_db == 0.30
    assert path.loss_db == reference_loss
    legacy_drop_note = any(item.code == "LEGACY_CATEGORY_ATTENUATION_NOT_APPLIED" for item in path.diagnostics)
    assert legacy_drop_note is (category == "drop")


def test_cable_physical_attenuation_override_and_route_length_drive_fiber_loss():
    project = _three_hop_project()
    cable = project.cable_segments[2]
    cable.properties["cableCategory"] = "drop"
    cable.properties["attenuationDbPerKm"] = 0.50
    cable.length_m = 2000.0

    path = calculate_optical_budget(project).paths[0]
    segment = path.segments[-1]

    assert segment.attenuation_db_per_km == 0.50
    assert segment.route_length_contribution_m == 2000.0
    assert segment.fiber_loss_db == 1.0


def test_unknown_receiver_sensitivity_keeps_physical_loss_and_power():
    project = _three_hop_project()
    project.nodes[-1].properties.pop("rxSensitivityDbm")
    sources = dict(project.settings.optical_budget.parameter_sources)
    sources["rxSensitivityDbm"] = "unknown"
    config = project.settings.optical_budget.model_copy(update={"parameter_sources": sources})

    path = calculate_optical_budget(project, config_override=config).paths[0]

    assert path.loss_db == 23.1
    assert path.received_power_dbm == -20.6
    assert path.rx_sensitivity_dbm is None
    assert path.sensitivity_margin_db is None
    assert path.overload_margin_db == 12.6
    assert path.status == "unknown"
    assert path.status_reason == "unknown_optical_parameters"


def test_unknown_transmitter_or_component_loss_keeps_only_defensible_partial_values():
    project = _three_hop_project()
    project.nodes[0].properties.pop("txPowerDbm")
    config_data = project.settings.optical_budget.model_dump(by_alias=True)
    config_data.pop("txPowerDbm")
    config_data["parameterSources"].pop("txPowerDbm")
    config = OpticalBudgetConfig.model_validate(config_data)
    assert config.parameter_sources["txPowerDbm"] == "unknown"

    no_tx = calculate_optical_budget(project, config_override=config).paths[0]
    assert no_tx.length_m == 6000.0
    assert no_tx.loss_db == 23.1
    assert no_tx.tx_power_dbm is None
    assert no_tx.received_power_dbm is None
    assert no_tx.status == "unknown"

    sources = dict(project.settings.optical_budget.parameter_sources)
    sources["connectorLossDb"] = "unknown"
    config = project.settings.optical_budget.model_copy(update={"parameter_sources": sources})
    missing_connector_loss = calculate_optical_budget(project, config_override=config).paths[0]
    assert missing_connector_loss.length_m == 6000.0
    assert missing_connector_loss.segments[0].fiber_loss_db == 0.7
    assert missing_connector_loss.segments[0].connector_loss_db is None
    assert missing_connector_loss.loss_db is None
    assert missing_connector_loss.received_power_dbm is None
    assert missing_connector_loss.status == "unknown"


def test_missing_path_and_disconnected_customers_are_reported():
    olt = _node("olt", NodeType.OLT)
    ont = _node("ont-disconnected", NodeType.ONT)
    linked = Customer(id="cust-linked", name="No route", location=olt.location, status=CustomerStatus.CONNECTED, ont_node_id=ont.id)
    unassigned = Customer(id="cust-unassigned", name="No ONT", location=olt.location, status=CustomerStatus.CONNECTED)
    project = Project(id="p", name="Disconnected", nodes=[olt, ont], customers=[linked, unassigned])

    result = calculate_optical_budget(project)

    assert len(result.paths) == 1
    assert result.paths[0].status == "unknown"
    assert result.paths[0].details["reason"] == "no_directed_path_from_olt"
    assert result.disconnected_customer_ids == ["cust-linked", "cust-unassigned"]
    assert result.summary["pathUnknown"] == 1
    assert result.summary["unassignedCustomers"] == 1
    assert result.summary["unreachableOnts"] == 1


def test_planned_customer_on_disconnected_ont_is_not_counted_as_connected_failure():
    olt = _node("olt", NodeType.OLT)
    ont = _node("ont", NodeType.ONT)
    planned = Customer(id="planned", name="Planned", location=olt.location, status=CustomerStatus.PLANNED, ont_node_id=ont.id)
    result = calculate_optical_budget(Project(id="planned-disconnected", name="Planned disconnected", nodes=[olt, ont], customers=[planned]))

    assert result.disconnected_customer_ids == []
    assert result.summary["unassignedCustomers"] == 0
    assert result.summary["unreachableOnts"] == 1


def test_path_customer_ids_are_assignments_while_lifecycle_connectivity_metrics_stay_distinct():
    olt = _node("olt", NodeType.OLT)
    reachable = _node("ont-reachable", NodeType.ONT)
    disconnected = _node("ont-disconnected", NodeType.ONT)
    customers = [
        Customer(id="connected-reachable", name="Connected", location=olt.location, status=CustomerStatus.CONNECTED, ont_node_id=reachable.id),
        Customer(id="planned-reachable", name="Planned", location=olt.location, status=CustomerStatus.PLANNED, ont_node_id=reachable.id),
        Customer(id="hold-reachable", name="On hold", location=olt.location, status=CustomerStatus.ON_HOLD, ont_node_id=reachable.id),
        Customer(id="connected-disconnected", name="Connected no route", location=olt.location, status=CustomerStatus.CONNECTED, ont_node_id=disconnected.id),
        Customer(id="planned-disconnected", name="Planned no route", location=olt.location, status=CustomerStatus.PLANNED, ont_node_id=disconnected.id),
        Customer(id="hold-disconnected", name="On hold no route", location=olt.location, status=CustomerStatus.ON_HOLD, ont_node_id=disconnected.id),
    ]
    cable = _cable("c1", 100.0)
    link = TopologyConnection(id="l1", from_node_id=olt.id, to_node_id=reachable.id, cable_segment_id=cable.id)
    result = calculate_optical_budget(Project(id="assignment-semantics", name="Assignments", nodes=[olt, reachable, disconnected], customers=customers, cable_segments=[cable], connections=[link]))
    paths_by_ont = {path.ont_node_id: path for path in result.paths}

    assert paths_by_ont[reachable.id].customer_ids == ["connected-reachable", "planned-reachable", "hold-reachable"]
    assert paths_by_ont[reachable.id].connectivity_status == "connected"
    assert paths_by_ont[disconnected.id].customer_ids == ["connected-disconnected", "planned-disconnected", "hold-disconnected"]
    assert paths_by_ont[disconnected.id].connectivity_status == "disconnected"
    assert result.disconnected_customer_ids == ["connected-disconnected"]
    assert result.summary["unreachableOnts"] == 1


def test_receiver_sensitivity_and_minimum_margin_fail_end_to_end_path():
    project = _three_hop_project()
    project.nodes[-1].properties["rxSensitivityDbm"] = -22.0
    config = project.settings.optical_budget.model_copy(update={"min_margin_db": 1.0})

    path = calculate_optical_budget(project, config_override=config).paths[0]

    assert path.received_power_dbm == -20.6
    assert path.margin_db == -1.6
    assert path.status == "fail"


def test_multiple_olt_paths_are_not_silently_selected():
    nodes = [_node("olt-a", NodeType.OLT), _node("olt-b", NodeType.OLT), _node("ont", NodeType.ONT)]
    cables = [_cable("ca", 100), _cable("cb", 100)]
    connections = [
        TopologyConnection(id="la", from_node_id="olt-a", to_node_id="ont", cable_segment_id="ca"),
        TopologyConnection(id="lb", from_node_id="olt-b", to_node_id="ont", cable_segment_id="cb"),
    ]
    result = calculate_optical_budget(Project(id="multi", name="Ambiguous", nodes=nodes, cable_segments=cables, connections=connections))

    assert result.paths[0].status == "unknown"
    assert result.paths[0].details["reason"] == "multiple_directed_paths_from_olt"
    assert result.paths[0].status_reason == "multiple_directed_paths_from_olt"


def test_end_to_end_path_breakdown_and_component_losses():
    """Verify detailed path breakdown: segments, splitters, power levels, and reasons."""
    project = _three_hop_project()
    result = calculate_optical_budget(project)

    assert len(result.paths) == 1
    path = result.paths[0]

    # 1. Ordered IDs
    assert path.node_ids == ["olt", "odc", "odp", "ont"]
    assert path.connection_ids == ["l1", "l2", "l3"]
    assert path.cable_segment_ids == ["c1", "c2", "c3"]

    # 2. Power and loss levels in dB and dBm
    assert path.tx_power_dbm == 2.5
    # lossDb is physical attenuation. The safety reserve is applied to design
    # margin and reported separately in details, not folded into lossDb.
    assert path.loss_db == 23.1
    assert path.received_power_dbm == -20.6
    assert path.rx_sensitivity_dbm == -27.0
    assert path.rx_overload_dbm == -8.0
    # Physical receiver headrooms are separate from the 3 dB design reserve:
    # -20.6 - (-27) = 6.4 dB; -8 - (-20.6) = 12.6 dB.
    assert path.sensitivity_margin_db == 6.4
    assert path.overload_margin_db == 12.6
    assert path.margin_db == 3.4
    assert path.details["sensitivityMarginDb"] == 6.4
    assert path.details["overloadMarginDb"] == 12.6
    assert path.min_margin_db == 0.0
    assert path.status == "pass"
    assert path.status_reason == "optical_budget_within_limits"

    # 3. Traversed Splitters
    assert len(path.splitters) == 2
    odc_spl = next(s for s in path.splitters if s.node_id == "odc")
    assert odc_spl.splitter_ratio == "1:4"
    assert odc_spl.loss_db == 7.2
    assert odc_spl.ideal_loss_db == 6.02

    odp_spl = next(s for s in path.splitters if s.node_id == "odp")
    assert odp_spl.splitter_ratio == "1:8"
    assert odp_spl.loss_db == 10.5
    assert odp_spl.ideal_loss_db == 9.03

    # 4. Hop Segments
    assert len(path.segments) == 3
    # Hop 1: OLT -> ODC (2000m, alpha=0.35 -> 0.7 dB fiber, 2 conn * 0.5 = 1.0 dB, 1 splice * 0.1 = 0.1 dB -> 1.8 dB)
    seg1 = path.segments[0]
    assert seg1.connection_id == "l1"
    assert seg1.cable_segment_id == "c1"
    assert seg1.from_node_id == "olt"
    assert seg1.to_node_id == "odc"
    assert seg1.length_m == 2000.0
    assert seg1.fiber_loss_db == 0.7
    assert seg1.connector_loss_db == 1.0
    assert seg1.splice_loss_db == 0.1
    assert seg1.total_segment_loss_db == 1.8

    # Each splitter is charged once in the per-hop diagnostics: on its
    # incoming edge, not again on the following edge as a source splitter.
    assert [link.details["splitterLossDb"] for link in result.links] == [7.2, 10.5, 0.0]
    assert sum(link.details["splitterLossDb"] for link in result.links) == path.details["splitterLossDb"]
    assert [link.received_power_dbm for link in result.links] == [-6.5, None, None]
    assert [link.model_dump(by_alias=True)["receivedPowerDbm"] for link in result.links] == [-6.5, None, None]


def test_splitter_inclusion_only_when_on_actual_path():
    """Verify that off-path splitters are not charged to unrelated ONT paths."""
    olt = _node("olt", NodeType.OLT, {"txPowerDbm": 3.0})
    # Path A has splitter 1:2
    spl_a = _node("spl-a", NodeType.SPLITTER, {"splitterRatio": "1:2"})  # 3.5 dB
    ont_a = _node("ont-a", NodeType.ONT)
    # Path B has splitter 1:32
    spl_b = _node("spl-b", NodeType.SPLITTER, {"splitterRatio": "1:32"})  # 17.5 dB
    ont_b = _node("ont-b", NodeType.ONT)

    c1 = _cable("c1", 1000.0)
    c2 = _cable("c2", 1000.0)
    c3 = _cable("c3", 1000.0)
    c4 = _cable("c4", 1000.0)

    conns = [
        TopologyConnection(id="l1", from_node_id="olt", to_node_id="spl-a", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="spl-a", to_node_id="ont-a", cable_segment_id="c2"),
        TopologyConnection(id="l3", from_node_id="olt", to_node_id="spl-b", cable_segment_id="c3"),
        TopologyConnection(id="l4", from_node_id="spl-b", to_node_id="ont-b", cable_segment_id="c4"),
    ]

    project = Project(
        id="p-split",
        name="Off-Path Splitter Test",
        nodes=[olt, spl_a, ont_a, spl_b, ont_b],
        cable_segments=[c1, c2, c3, c4],
        connections=conns,
    )

    result = calculate_optical_budget(project)
    path_a = next(p for p in result.paths if p.ont_node_id == "ont-a")
    path_b = next(p for p in result.paths if p.ont_node_id == "ont-b")

    # Path A should only include spl_a (3.5 dB)
    assert len(path_a.splitters) == 1
    assert path_a.splitters[0].node_id == "spl-a"
    assert path_a.details["splitterLossDb"] == 3.5


    # Path B should only include spl_b (17.1 dB)
    assert len(path_b.splitters) == 1
    assert path_b.splitters[0].node_id == "spl-b"
    assert path_b.details["splitterLossDb"] == 17.1


def test_splitter_without_ratio_or_configured_loss_is_unknown():
    olt = _node("olt", NodeType.OLT, {"txPowerDbm": 2.5})
    splitter = _node("splitter", NodeType.SPLITTER)
    ont = _node("ont", NodeType.ONT)
    cables = [_cable("c1", 100.0), _cable("c2", 100.0)]
    connections = [
        TopologyConnection(id="l1", from_node_id="olt", to_node_id="splitter", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="splitter", to_node_id="ont", cable_segment_id="c2"),
    ]

    path = calculate_optical_budget(
        Project(id="unknown-splitter", name="Unknown splitter", nodes=[olt, splitter, ont], cable_segments=cables, connections=connections)
    ).paths[0]

    assert path.status == "unknown"
    assert path.status_reason == "unknown_splitter_ratio"
    assert path.received_power_dbm is None
    assert path.splitters[0].splitter_ratio == "unknown"
    assert path.splitters[0].loss_db is None
    assert path.splitters[0].ideal_loss_db is None


def test_unknown_splitter_budget_does_not_mark_topologically_reachable_customer_disconnected():
    olt = _node("olt", NodeType.OLT, {"txPowerDbm": 2.5})
    splitter = _node("splitter", NodeType.SPLITTER)
    ont = _node("ont", NodeType.ONT)
    customer = Customer(id="cust", name="Connected", location=olt.location, status=CustomerStatus.CONNECTED, ont_node_id=ont.id)
    cables = [_cable("c1", 100.0), _cable("c2", 100.0)]
    links = [
        TopologyConnection(id="l1", from_node_id="olt", to_node_id="splitter", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="splitter", to_node_id="ont", cable_segment_id="c2"),
    ]
    result = calculate_optical_budget(Project(id="reachable-unknown", name="Reachable unknown", nodes=[olt, splitter, ont], customers=[customer], cable_segments=cables, connections=links))

    assert result.paths[0].connectivity_status == "connected"
    assert result.paths[0].status == "unknown"
    assert result.disconnected_customer_ids == []
    assert result.summary["unreachableOnts"] == 0
    assert result.summary["unassignedCustomers"] == 0



def test_receiver_overload_failure_independent_check():
    """Verify that an optical path with excessive received power fails with rx_power_exceeds_overload."""
    # OLT txPower = +10 dBm, very short 10m cable, no splitters -> total loss ~ 4 dB -> Prx = +6 dBm
    olt = _node("olt-hot", NodeType.OLT, {"txPowerDbm": 10.0})
    ont = _node("ont-sensitive", NodeType.ONT, {"rxOverloadDbm": -8.0, "rxSensitivityDbm": -27.0})
    c = _cable("c-short", 10.0)
    conn = TopologyConnection(id="l1", from_node_id="olt-hot", to_node_id="ont-sensitive", cable_segment_id="c-short")

    project = Project(id="p-overload", name="Overload Test", nodes=[olt, ont], cable_segments=[c], connections=[conn])
    result = calculate_optical_budget(project)

    path = result.paths[0]
    assert path.received_power_dbm is not None
    assert path.received_power_dbm > -8.0  # Exceeds overload
    assert path.status == "fail"
    assert path.status_reason == "rx_power_exceeds_overload"


def test_receiver_sensitivity_and_margin_failure_reasons():
    """Verify separate failure reasons for sensitivity and margin."""
    # 1. Below sensitivity
    olt = _node("olt", NodeType.OLT, {"txPowerDbm": 0.0})
    spl = _node("spl", NodeType.SPLITTER, {"splitterRatio": "1:64"})  # 20.5 dB
    ont = _node("ont", NodeType.ONT, {"rxSensitivityDbm": -20.0, "rxOverloadDbm": -8.0})
    c1 = _cable("c1", 20000.0)  # 20 km -> 7 dB
    c2 = _cable("c2", 5000.0)   # 5 km -> 1.75 dB
    conns = [
        TopologyConnection(id="l1", from_node_id="olt", to_node_id="spl", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="spl", to_node_id="ont", cable_segment_id="c2"),
    ]
    p_sens = Project(id="p-sens", name="Sens Test", nodes=[olt, spl, ont], cable_segments=[c1, c2], connections=conns)
    res_sens = calculate_optical_budget(p_sens)
    assert res_sens.paths[0].status == "fail"
    assert res_sens.paths[0].status_reason == "rx_power_below_sensitivity"

    # 2. Insufficient safety margin (power >= sensitivity, but margin < min_margin_db)
    # Set sensitivity very low (-35 dBm), received power ~ -32 dBm -> margin ~ 3 dB, but min_margin set to 5 dB
    ont.properties["rxSensitivityDbm"] = -35.0
    config_high_margin = p_sens.settings.optical_budget.model_copy(update={"min_margin_db": 5.0})
    res_margin = calculate_optical_budget(p_sens, config_override=config_high_margin)
    assert res_margin.paths[0].status == "fail"
    assert res_margin.paths[0].status_reason == "insufficient_safety_margin"


def test_explainable_optical_diagnostics_14_cases(client):
    """Comprehensive regression test suite for the 14 required explainable optical diagnostic cases."""
    from backend.app.domain.models import OpticalComponent

    # 1. Valid path -> PASS with structured info diagnostic
    p_valid = _three_hop_project()
    path_valid = calculate_optical_budget(p_valid).paths[0]
    assert path_valid.status == "pass"
    assert path_valid.connectivity_status == "connected"
    assert path_valid.optical_budget_status == "pass"
    assert any(d.code == "OPTICAL_BUDGET_PASS" and d.severity == "info" for d in path_valid.diagnostics)

    # 2. Received power below sensitivity -> FAIL with RX_BELOW_SENSITIVITY, actual, threshold, unit, corrective action
    p_below = _three_hop_project()
    p_below.nodes[-1].properties["rxSensitivityDbm"] = -15.0  # Received is -20.6 dBm
    path_below = calculate_optical_budget(p_below).paths[0]
    assert path_below.status == "fail"
    assert path_below.optical_budget_status == "fail"
    diag_below = next(d for d in path_below.diagnostics if d.code == "RX_BELOW_SENSITIVITY")
    assert diag_below.severity == "error"
    assert diag_below.category == "optical_budget"
    assert diag_below.affected_entity_type == "ont"
    assert diag_below.affected_entity_id == "ont"
    assert diag_below.actual_value == -20.6
    assert diag_below.expected_value == -15.0
    assert diag_below.unit == "dBm"
    assert diag_below.corrective_action

    # 3. Received power above overload -> FAIL with RX_ABOVE_OVERLOAD
    p_ovl = _three_hop_project()
    p_ovl.nodes[0].properties["txPowerDbm"] = 20.0  # Received is 20.0 - 23.1 = -3.1 dBm > -8.0 dBm
    path_ovl = calculate_optical_budget(p_ovl).paths[0]
    assert path_ovl.status == "fail"
    assert path_ovl.optical_budget_status == "fail"
    diag_ovl = next(d for d in path_ovl.diagnostics if d.code == "RX_ABOVE_OVERLOAD")
    assert diag_ovl.actual_value == -3.1
    assert diag_ovl.expected_value == -8.0
    assert diag_ovl.unit == "dBm"
    assert diag_ovl.corrective_action

    # 4. Margin below minimum -> FAIL with OPTICAL_MARGIN_INSUFFICIENT
    p_margin = _three_hop_project()
    cfg_margin = p_margin.settings.optical_budget.model_copy(update={"min_margin_db": 5.0})  # Actual margin is 3.4 dB
    path_margin = calculate_optical_budget(p_margin, config_override=cfg_margin).paths[0]
    assert path_margin.status == "fail"
    assert path_margin.optical_budget_status == "fail"
    diag_margin = next(d for d in path_margin.diagnostics if d.code == "OPTICAL_MARGIN_INSUFFICIENT")
    assert diag_margin.actual_value == 3.4
    assert diag_margin.expected_value == 5.0
    assert diag_margin.unit == "dB"
    assert diag_margin.corrective_action

    # 5. Unknown splitter insertion loss -> UNKNOWN with SPLITTER_LOSS_UNKNOWN
    p_spl = _three_hop_project()
    p_spl.nodes[1].properties["splitterRatio"] = "1:128"  # Unlisted ratio, no explicit splitterLossDb
    path_spl = calculate_optical_budget(p_spl).paths[0]
    assert path_spl.status == "unknown"
    assert path_spl.optical_budget_status == "unknown"
    assert path_spl.loss_db is None
    assert path_spl.received_power_dbm is None
    diag_spl = next(d for d in path_spl.diagnostics if d.code == "SPLITTER_LOSS_UNKNOWN")
    assert diag_spl.affected_entity_id == "odc"
    assert diag_spl.actual_value == "1:128"
    assert diag_spl.unit == "dB"

    # 6. Unknown transmitter power -> UNKNOWN with TX_POWER_UNKNOWN
    p_tx = _three_hop_project()
    p_tx.nodes[0].properties.pop("txPowerDbm")
    sources_tx = dict(p_tx.settings.optical_budget.parameter_sources, txPowerDbm="unknown")
    path_tx = calculate_optical_budget(
        p_tx, config_override=p_tx.settings.optical_budget.model_copy(update={"parameter_sources": sources_tx})
    ).paths[0]
    assert path_tx.status == "unknown"
    assert path_tx.tx_power_dbm is None
    assert path_tx.received_power_dbm is None
    diag_tx = next(d for d in path_tx.diagnostics if d.code == "TX_POWER_UNKNOWN")
    assert diag_tx.affected_entity_id == "olt"
    assert diag_tx.actual_value is None
    assert diag_tx.unit == "dBm"

    # 7. Unknown receiver sensitivity -> UNKNOWN with RX_SENSITIVITY_UNKNOWN
    p_sens_unk = _three_hop_project()
    p_sens_unk.nodes[-1].properties.pop("rxSensitivityDbm")
    sources_sens = dict(p_sens_unk.settings.optical_budget.parameter_sources, rxSensitivityDbm="unknown")
    path_sens_unk = calculate_optical_budget(
        p_sens_unk, config_override=p_sens_unk.settings.optical_budget.model_copy(update={"parameter_sources": sources_sens})
    ).paths[0]
    assert path_sens_unk.status == "unknown"
    assert path_sens_unk.rx_sensitivity_dbm is None
    assert path_sens_unk.margin_db is None
    diag_sens_unk = next(d for d in path_sens_unk.diagnostics if d.code == "RX_SENSITIVITY_UNKNOWN")
    assert diag_sens_unk.affected_entity_id == "ont"
    assert diag_sens_unk.actual_value is None

    # 8. Unknown receiver overload -> UNKNOWN with RX_OVERLOAD_UNKNOWN
    p_ovl_unk = _three_hop_project()
    sources_ovl = dict(p_ovl_unk.settings.optical_budget.parameter_sources, rxOverloadDbm="unknown")
    path_ovl_unk = calculate_optical_budget(
        p_ovl_unk, config_override=p_ovl_unk.settings.optical_budget.model_copy(update={"parameter_sources": sources_ovl})
    ).paths[0]
    assert path_ovl_unk.status == "unknown"
    assert path_ovl_unk.rx_overload_dbm is None
    diag_ovl_unk = next(d for d in path_ovl_unk.diagnostics if d.code == "RX_OVERLOAD_UNKNOWN")
    assert diag_ovl_unk.affected_entity_id == "ont"
    assert diag_ovl_unk.actual_value is None

    # 9. Unknown cable length -> UNKNOWN with CABLE_LENGTH_UNKNOWN
    p_len_unk = _three_hop_project()
    p_len_unk.cable_segments[0].length_m = None
    p_len_unk.cable_segments[0].geometry = LineGeometry(coordinates=[(115.0, -8.0), (115.0, -8.0)])  # 0m degenerate
    path_len_unk = calculate_optical_budget(p_len_unk).paths[0]
    assert path_len_unk.status == "unknown"
    assert path_len_unk.length_m is None
    assert path_len_unk.loss_db is None
    assert path_len_unk.received_power_dbm is None
    diag_len_unk = next(d for d in path_len_unk.diagnostics if d.code == "CABLE_LENGTH_UNKNOWN")
    assert diag_len_unk.affected_entity_type == "cable"
    assert diag_len_unk.affected_entity_id == "c1"
    assert diag_len_unk.actual_value is None

    # 10. Unknown fiber attenuation -> UNKNOWN with FIBER_ATTENUATION_UNKNOWN
    p_alpha_unk = _three_hop_project()
    sources_alpha = dict(p_alpha_unk.settings.optical_budget.parameter_sources, fiberAttenuationDbPerKm="unknown")
    path_alpha_unk = calculate_optical_budget(
        p_alpha_unk, config_override=p_alpha_unk.settings.optical_budget.model_copy(update={"parameter_sources": sources_alpha})
    ).paths[0]
    assert path_alpha_unk.status == "unknown"
    assert path_alpha_unk.loss_db is None
    diag_alpha_unk = next(d for d in path_alpha_unk.diagnostics if d.code == "FIBER_ATTENUATION_UNKNOWN")
    assert diag_alpha_unk.affected_entity_type == "cable"
    assert diag_alpha_unk.affected_entity_id == "c1"
    assert diag_alpha_unk.unit == "dB/km"

    # 11. Disconnected ONT -> connectivity failure with OPTICAL_PATH_DISCONNECTED
    p_disc = Project(
        id="p-disc",
        name="Disconnected",
        nodes=[_node("olt", NodeType.OLT), _node("ont-disc", NodeType.ONT)],
    )
    path_disc = calculate_optical_budget(p_disc).paths[0]
    assert path_disc.connectivity_status == "disconnected"
    assert path_disc.optical_budget_status == "unknown"
    diag_disc = next(d for d in path_disc.diagnostics if d.code == "OPTICAL_PATH_DISCONNECTED")
    assert diag_disc.affected_entity_id == "ont-disc"
    assert diag_disc.category == "connectivity"

    # 12. Multiple simultaneous issues on one path (e.g., unknown splitter + unknown tx power + unknown component loss + invalid cable attenuation)
    p_multi = _three_hop_project()
    p_multi.nodes[0].properties.pop("txPowerDbm")
    p_multi.nodes[1].properties["splitterRatio"] = "1:999"
    p_multi.cable_segments[1].properties["attenuationDbPerKm"] = -0.5  # Invalid negative attenuation
    p_multi.optical_components = [
        OpticalComponent(id="comp-missing", kind="attenuator", node_id="odp", configured_source="unknown")
    ]
    sources_multi = dict(p_multi.settings.optical_budget.parameter_sources, txPowerDbm="unknown")
    path_multi = calculate_optical_budget(
        p_multi, config_override=p_multi.settings.optical_budget.model_copy(update={"parameter_sources": sources_multi})
    ).paths[0]
    codes_multi = {d.code for d in path_multi.diagnostics}
    assert "SPLITTER_LOSS_UNKNOWN" in codes_multi
    assert "TX_POWER_UNKNOWN" in codes_multi
    assert "OPTICAL_COMPONENT_MISSING" in codes_multi
    assert "OPTICAL_CONFIGURATION_INVALID" in codes_multi
    assert path_multi.status == "fail"  # Deterministic precedence: hard configuration violation produces FAIL while keeping all UNKNOWN diagnostics

    # 13 & 14. API serialization of structured diagnostics
    saved = client.put(f"/api/v1/projects/{p_below.id}", json=p_below.model_dump(by_alias=True))
    assert saved.status_code == 200
    resp = client.post(f"/api/v1/projects/{p_below.id}/calculations/optical-budget")
    assert resp.status_code == 200
    payload = resp.json()
    api_path = payload["paths"][0]
    assert api_path["status"] == "fail"
    assert api_path["connectivityStatus"] == "connected"
    assert api_path["opticalBudgetStatus"] == "fail"
    assert len(api_path["diagnostics"]) >= 1
    api_diag = next(d for d in api_path["diagnostics"] if d["code"] == "RX_BELOW_SENSITIVITY")
    assert api_diag["severity"] == "error"
    assert api_diag["category"] == "optical_budget"
    assert api_diag["affectedEntityType"] == "ont"
    assert api_diag["affectedEntityId"] == "ont"
    assert api_diag["actualValue"] == api_path["receivedPowerDbm"]
    assert api_diag["expectedValue"] == -15.0
    assert api_diag["unit"] == "dBm"
    assert api_diag["correctiveAction"]

