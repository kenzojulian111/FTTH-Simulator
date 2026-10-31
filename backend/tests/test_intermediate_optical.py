"""Intermediate passive-node power is derived from the evaluated ONT path prefix."""

from backend.app.domain.models import (
    CableSegment, LineGeometry, NetworkNode, NodeType, OpticalBudgetConfig, OpticalComponent,
    PointGeometry, Project, ProjectSettings, TopologyConnection,
)
from backend.app.engine.optical import calculate_optical_budget


def _node(node_id, kind, x, properties=None):
    return NetworkNode(id=node_id, type=kind, name=node_id,
                       location=PointGeometry(coordinates=(x, -6.2)), properties=properties or {})


def _cable(cid, a, b, length):
    return CableSegment(id=cid, name=cid,
                        geometry=LineGeometry(coordinates=[(a, -6.2), (b, -6.2)]),
                        length_m=length)


def _project(with_splitters=True):
    nodes = [
        _node("olt", NodeType.OLT, 106.84, {"txPowerDbm": 3.0}),
        _node("odc", NodeType.ODC, 106.845, {"splitterRatio": "1:4"} if with_splitters else {}),
        _node("odp", NodeType.ODP, 106.85, {"splitterRatio": "1:8"} if with_splitters else {}),
        _node("ont", NodeType.ONT, 106.855),
    ]
    cables = [_cable("c1", 106.84, 106.845, 1000), _cable("c2", 106.845, 106.85, 1000), _cable("c3", 106.85, 106.855, 1000)]
    connections = [TopologyConnection(id=f"e{i+1}", from_node_id=a, to_node_id=b, cable_segment_id=f"c{i+1}")
                   for i, (a, b) in enumerate((("olt", "odc"), ("odc", "odp"), ("odp", "ont")))]
    config = OpticalBudgetConfig(
        tx_power_dbm=3.0, fiber_attenuation_db_per_km=0.4,
        connector_loss_db=0.2, connectors_per_link=2,
        splice_loss_db=0.1, splices_per_link=1, pigtail_splices_per_link=0,
        splitter_loss_table={"1:4": 7.2, "1:8": 10.5},
        parameter_sources={key: "profile_default" for key in OpticalBudgetConfig().parameter_sources},
    )
    return Project(id="intermediate", name="Intermediate", nodes=nodes, cable_segments=cables,
                   connections=connections, settings=ProjectSettings(optical_budget=config))


def test_olt_odc_odp_and_ont_use_the_same_physical_path_losses():
    result = calculate_optical_budget(_project())
    odc, odp = result.intermediate_nodes
    ont_path = result.paths[0]
    assert odc.node_id == "odc" and odc.status == "estimated"
    assert odc.length_m == 1000
    assert odc.accumulated_loss_db == 8.1  # 0.4 fiber + 0.4 connectors + 0.1 splice + 7.2 splitter
    assert odc.estimated_power_dbm == -5.1
    assert odc.transmitter_power_dbm == 3.0
    assert odc.category_losses_db == {"fiber": 0.4, "connector": 0.4, "splice": 0.1, "splitter": 7.2, "passive_component": 0.0}
    fiber = next(row for row in odc.loss_breakdown if row.category == "fiber")
    assert (fiber.quantity, fiber.calculation_quantity, fiber.unit_loss_db, fiber.total_loss_db) == (1000, 1000, 0.4, 0.4)
    assert fiber.cumulative_loss_db == 0.4
    connector = next(row for row in odc.loss_breakdown if row.category == "connector")
    splice = next(row for row in odc.loss_breakdown if row.category == "splice")
    assert (connector.quantity, connector.unit_loss_db, connector.total_loss_db) == (2, 0.2, 0.4)
    assert (splice.quantity, splice.unit_loss_db, splice.total_loss_db) == (1, 0.1, 0.1)
    splitter = next(row for row in odc.loss_breakdown if row.category == "splitter")
    assert splitter.position == "At odc (topology node 2)"
    assert splitter.total_loss_db == 7.2
    assert odp.node_id == "odp" and odp.length_m == 2000
    assert odp.accumulated_loss_db == 19.5
    assert odp.estimated_power_dbm == -16.5
    assert [row.total_loss_db for row in odp.loss_breakdown if row.category == "splitter"] == [7.2, 10.5]
    assert odp.category_losses_db["splitter"] == 17.7
    assert odc.design_margin_db == odp.design_margin_db == 3.0
    assert odc.total_design_allowance_db == 11.1
    assert odp.total_design_allowance_db == 22.5
    # ONT retains its end-to-end receiver-budget calculation, with splitter losses once each.
    assert ont_path.details["splitterLossDb"] == 17.7
    assert ont_path.loss_db == 20.4
    assert ont_path.design_margin_db == 3.0
    assert ont_path.total_design_allowance_db == 23.4
    assert ont_path.received_power_dbm == 3.0 - ont_path.loss_db
    assert len([row for row in ont_path.loss_breakdown if row.category == "splitter"]) == 2
    assert ont_path.category_losses_db["splitter"] == 17.7


def test_component_rows_show_segment_losses_splitter_positions_and_running_totals():
    project = _project()
    project.optical_components = [OpticalComponent(
        id="attenuator-1", kind="attenuator", connection_id="e2", location="ODP",
        configured_loss_db=0.3, configured_source="configured",
    )]
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    odp = next(item for item in result.intermediate_nodes if item.node_id == "odp")
    assert [(row.category, row.total_loss_db) for row in odc.loss_breakdown] == [
        ("fiber", 0.4), ("connector", 0.4), ("splice", 0.1), ("splitter", 7.2),
    ]
    assert odc.loss_breakdown[-1].cumulative_loss_db == odc.accumulated_loss_db == 8.1
    fiber = odp.loss_breakdown[4]
    assert fiber.cable_name == "c2" and fiber.cable_segment_id == "c2"
    assert fiber.cable_category == "Unspecified"
    assert fiber.quantity == fiber.calculation_quantity == 1000
    assert fiber.unit_loss_db == 0.4 and fiber.total_loss_db == 0.4
    splitters = [row for row in odp.loss_breakdown if row.category == "splitter"]
    assert [row.node_id for row in splitters] == ["odc", "odp"]
    assert [row.path_position for row in splitters] == [1, 2]
    assert [row.total_loss_db for row in splitters] == [7.2, 10.5]
    passive = next(row for row in odp.loss_breakdown if row.component_id == "attenuator-1")
    assert passive.total_loss_db == 0.3
    assert odp.category_losses_db == {
        "fiber": 0.8, "connector": 0.8, "splice": 0.2,
        "splitter": 17.7, "passive_component": 0.3,
    }
    assert odp.accumulated_loss_db == 19.8
    assert odp.loss_breakdown[-1].cumulative_loss_db == 19.8
    assert odp.transmitter_power_dbm == 3.0 and odp.estimated_power_dbm == -16.8


def test_no_splitter_is_assumed_at_odc_or_odp():
    result = calculate_optical_budget(_project(with_splitters=False))
    assert [item.accumulated_loss_db for item in result.intermediate_nodes] == [0.9, 1.8]


def test_missing_splitter_loss_makes_intermediate_power_unknown():
    project = _project()
    project.nodes[1].properties["splitterRatio"] = "1:999"
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    assert odc.status == "unknown"
    assert odc.accumulated_loss_db is None
    assert odc.estimated_power_dbm is None
    assert any("splitter" in message.lower() for message in odc.diagnostics)


def test_missing_other_component_loss_stays_unknown_in_breakdown():
    project = _project()
    project.optical_components = [OpticalComponent(
        id="unknown-attenuator", kind="attenuator", node_id="odc", configured_source="unknown",
    )]
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    unknown = next(row for row in odc.loss_breakdown if row.component_id == "unknown-attenuator")
    assert unknown.total_loss_db is None
    assert unknown.cumulative_loss_db is None
    assert odc.category_losses_db["passive_component"] is None
    assert odc.estimated_power_dbm is None
    assert any("component" in message.lower() and "unknown" in message.lower() for message in odc.diagnostics)


def test_intermediate_result_discloses_legacy_input_provenance():
    project = _project()
    project.settings.optical_budget.parameter_sources["fiberAttenuationDbPerKm"] = "legacy_fallback"
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    assert odc.status == "unknown"
    assert odc.estimated_power_dbm == -5.1
    assert odc.parameter_sources["c1.fiberAttenuationDbPerKm"] == "legacy_fallback"
    assert any(row.source == "legacy_fallback" for row in odc.loss_breakdown if row.category == "fiber")
    assert any("provenance" in message.lower() for message in odc.diagnostics)


def test_intermediate_passive_component_loss_is_counted_once_and_missing_value_stays_unknown():
    project = _project()
    project.optical_components = [OpticalComponent(
        id="attenuator-1", kind="attenuator", node_id="odc", location="ODC",
        configured_loss_db=0.3, configured_source="configured",
    )]
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    assert odc.category_losses_db["passive_component"] == 0.3
    assert odc.accumulated_loss_db == 8.4
    assert next(row for row in odc.loss_breakdown if row.component_id == "attenuator-1").total_loss_db == 0.3

    project.optical_components[0].configured_source = "unknown"
    missing = calculate_optical_budget(project)
    odc_missing = next(item for item in missing.intermediate_nodes if item.node_id == "odc")
    assert odc_missing.category_losses_db["passive_component"] is None
    assert odc_missing.accumulated_loss_db is None
    assert odc_missing.estimated_power_dbm is None


def test_breakdown_uses_evaluator_unit_losses_before_segment_rounding():
    project = _project(with_splitters=False)
    project.cable_segments[0].properties.update({
        "connectorsCount": 3, "connectorLossDb": 0.125,
        "splicesCount": 3, "spliceLossDb": 0.15,
    })
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    connector = next(row for row in odc.loss_breakdown if row.category == "connector")
    splice = next(row for row in odc.loss_breakdown if row.category == "splice")
    assert connector.unit_loss_db == 0.125
    assert connector.total_loss_db == 0.38
    assert splice.unit_loss_db == 0.15
    assert splice.total_loss_db == 0.45


def test_multiple_olt_routes_to_a_passive_node_are_reported_ambiguous():
    project = _project()
    project.nodes.append(_node("olt-2", NodeType.OLT, 106.83, {"txPowerDbm": 2.0}))
    project.cable_segments.append(_cable("c4", 106.83, 106.845, 1000))
    project.connections.append(TopologyConnection(id="e4", from_node_id="olt-2", to_node_id="odc", cable_segment_id="c4"))
    result = calculate_optical_budget(project)
    odc = next(item for item in result.intermediate_nodes if item.node_id == "odc")
    assert odc.status == "ambiguous"
    assert odc.estimated_power_dbm is None


def test_unreachable_passive_node_is_explicit():
    project = _project()
    project.nodes.append(_node("odc-offline", NodeType.ODC, 106.86))
    result = calculate_optical_budget(project)
    offline = next(item for item in result.intermediate_nodes if item.node_id == "odc-offline")
    assert offline.status == "unreachable"
    assert offline.estimated_power_dbm is None


def test_intermediate_node_is_calculated_even_without_an_downstream_ont():
    project = _project()
    project.nodes = project.nodes[:3]
    project.connections = project.connections[:2]
    result = calculate_optical_budget(project)
    odc, odp = result.intermediate_nodes
    assert result.paths == []
    assert odc.status == odp.status == "estimated"
    assert (odc.length_m, odp.length_m) == (1000, 2000)
    assert (odc.estimated_power_dbm, odp.estimated_power_dbm) == (-5.1, -16.5)
