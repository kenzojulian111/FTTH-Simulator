"""Sprint 1 Remediation Acceptance Tests.

Verifies:
- Splitter loss counted exactly once on multi-hop paths.
- Passive nodes do not act as optical transmitters.
- Safety margin is not deducted from physical received power.
- Receiver overload is evaluated using physical received power.
- Unknown splitter ratios never produce an unjustified PASS.
- Cable routes can be drawn in either direction.
- Endpoint spatial tolerance is strictly enforced.
- Router costs are omitted when unconfigured and calculated when configured.
- Existing projects without router costs load and calculate correctly.
"""

import pytest
from backend.app.domain.models import (
    CableSegment,
    ConstructionCostConfig,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    OpticalBudgetConfig,
    PointGeometry,
    Project,
    ProjectSettings,
    TopologyConnection,
)
from backend.app.domain.validation import validate_project_integrity
from backend.app.engine.cost import calculate_construction_cost
from backend.app.engine.optical import calculate_optical_budget


def _node(node_id, node_type, coords, properties=None):
    return NetworkNode(
        id=node_id,
        type=node_type,
        name=node_id,
        location=PointGeometry(coordinates=coords),
        properties=properties or {},
    )


def _cable(cable_id, coords, length_m=None, start_id=None, end_id=None, properties=None):
    return CableSegment(
        id=cable_id,
        name=cable_id,
        geometry=LineGeometry(coordinates=coords),
        length_m=length_m,
        start_node_id=start_id,
        end_node_id=end_id,
        properties=properties or {},
    )


# --- A. Optical Engineering Correctness ---

def test_splitter_loss_counted_once_on_multihop_path():
    """Verify that multi-hop OLT->ODC->ODP->ONT paths charge each splitter exactly once."""
    olt = _node("olt-1", NodeType.OLT, (106.8400, -6.2000), {"txPowerDbm": 3.0})
    odc = _node("odc-1", NodeType.ODC, (106.8450, -6.2000), {"splitterRatio": "1:4"})   # 7.2 dB
    odp = _node("odp-1", NodeType.ODP, (106.8500, -6.2000), {"splitterRatio": "1:8"})   # 10.5 dB
    ont = _node("ont-1", NodeType.ONT, (106.8550, -6.2000), {"rxSensitivityDbm": -27.0})

    c1 = _cable("c1", [(106.8400, -6.2000), (106.8450, -6.2000)], length_m=1000.0)
    c2 = _cable("c2", [(106.8450, -6.2000), (106.8500, -6.2000)], length_m=1000.0)
    c3 = _cable("c3", [(106.8500, -6.2000), (106.8550, -6.2000)], length_m=1000.0)

    conns = [
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c2"),
        TopologyConnection(id="l3", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c3"),
    ]

    project = Project(
        id="p-split-once",
        name="Splitter Once Test",
        nodes=[olt, odc, odp, ont],
        cable_segments=[c1, c2, c3],
        connections=conns,
    )

    result = calculate_optical_budget(project)
    path = result.paths[0]

    # Two splitters on the path: 1:4 (7.2 dB) and 1:8 (10.5 dB) = 17.7 dB
    assert len(path.splitters) == 2
    assert path.details["splitterLossDb"] == 17.7
    # Path segments must NOT duplicate splitter loss inside segment totals
    for seg in path.segments:
        assert seg.total_segment_loss_db == round(seg.fiber_loss_db + seg.connector_loss_db + seg.splice_loss_db, 2)


def test_passive_nodes_do_not_act_as_optical_transmitters():
    """Verify that intermediate passive nodes (ODC, ODP, splitter) do not emit fictitious Tx power."""
    olt = _node("olt-1", NodeType.OLT, (106.8400, -6.2000), {"txPowerDbm": 2.5})
    odc = _node("odc-1", NodeType.ODC, (106.8450, -6.2000))
    odp = _node("odp-1", NodeType.ODP, (106.8500, -6.2000))

    c1 = _cable("c1", [(106.8400, -6.2000), (106.8450, -6.2000)], length_m=1000.0)
    c2 = _cable("c2", [(106.8450, -6.2000), (106.8500, -6.2000)], length_m=1000.0)

    conns = [
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c2"),
    ]

    project = Project(
        id="p-passive",
        name="Passive Nodes Test",
        nodes=[olt, odc, odp],
        cable_segments=[c1, c2],
        connections=conns,
    )

    result = calculate_optical_budget(project)
    link2 = next(l for l in result.links if l.connection_id == "l2")

    # l2 connects ODC -> ODP; ODC is not a transmitter and has no txPowerDbm
    assert link2.status == "unknown"
    assert link2.details.get("txPowerDbm") is None
    assert "not an optical transmitter" in link2.details.get("note", "").lower()


def test_safety_margin_not_deducted_from_physical_received_power():
    """Verify physical received power is P_tx - A_physical without deducting design safety margin."""
    olt = _node("olt-1", NodeType.OLT, (106.8400, -6.2000), {"txPowerDbm": 3.0})
    # ODC with 1:8 splitter (10.5 dB) ensures signal is within normal dynamic range [-27, -8] dBm
    odc = _node("odc-1", NodeType.ODC, (106.8450, -6.2000), {"splitterRatio": "1:8"})
    ont = _node("ont-1", NodeType.ONT, (106.8500, -6.2000), {"rxSensitivityDbm": -27.0, "rxOverloadDbm": -8.0})

    # Cable 1: 5 km fiber @ 0.35 = 1.75 dB + 1.0 conn + 0.1 splice = 2.85 dB
    c1 = _cable("c1", [(106.8400, -6.2000), (106.8450, -6.2000)], length_m=5000.0)
    # Cable 2: 5 km fiber @ 0.35 = 1.75 dB + 1.0 conn + 0.1 splice = 2.85 dB
    c2 = _cable("c2", [(106.8450, -6.2000), (106.8500, -6.2000)], length_m=5000.0)

    conns = [
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="odc-1", to_node_id="ont-1", cable_segment_id="c2"),
    ]

    config = OpticalBudgetConfig(
        tx_power_dbm=3.0,
        fiber_attenuation_db_per_km=0.35,
        fiber_type="G.652.D",
        wavelength_nm=1310,
        connector_loss_db=0.5,
        connectors_per_link=2,
        splice_loss_db=0.1,
        splices_per_link=1,
        safety_margin_db=3.0,
        rx_sensitivity_dbm=-27.0,
        rx_overload_dbm=-8.0,
        min_margin_db=0.0,
        splitter_loss_table={"1:8": 10.5},
        parameter_sources={key: "configured" for key in OpticalBudgetConfig().parameter_sources},
    )

    project = Project(
        id="p-margin",
        name="Margin Separation Test",
        nodes=[olt, odc, ont],
        cable_segments=[c1, c2],
        connections=conns,
        settings=ProjectSettings(optical_budget=config),
    )

    result = calculate_optical_budget(project)
    path = result.paths[0]

    # Fiber loss: 3.50 dB, Connectors: 2.00 dB, Splices: 0.20 dB, Splitter: 10.50 dB
    # Physical loss: 3.50 + 2.00 + 0.20 + 10.50 = 16.20 dB
    assert path.loss_db == 16.20
    assert path.details["physicalLossDb"] == 16.20
    assert path.details["safetyMarginDb"] == 3.00
    assert path.details["totalLossDb"] == 19.20

    # Physical received power: 3.0 - 16.20 = -13.20 dBm (NOT 3.0 - 19.20 = -16.20 dBm)
    assert path.received_power_dbm == -13.20

    # Design margin: -13.20 - (-27.0) - 3.0 = 10.80 dB
    assert path.margin_db == 10.80
    assert path.status == "pass"


def test_receiver_overload_evaluated_using_physical_received_power():
    """Verify that receiver overload is evaluated against physical received power, not masked by safety margin."""
    # Tx Power: +1.0 dBm, physical loss: 8.5 dB -> Physical Rx power: -7.5 dBm
    # Receiver overload limit: -8.0 dBm -> Physical power (-7.5) EXCEEDS overload (-8.0)
    # If safety margin (3 dB) were incorrectly deducted, Rx power would be -10.5 dBm, masking the overload!
    olt = _node("olt-1", NodeType.OLT, (106.8400, -6.2000), {"txPowerDbm": 1.0})
    ont = _node("ont-1", NodeType.ONT, (106.8500, -6.2000), {
        "rxOverloadDbm": -8.0,
        "rxSensitivityDbm": -27.0,
    })

    # Cable loss: 7.4 dB + 1.0 conn + 0.1 splice = 8.5 dB
    c = _cable("c1", [(106.8400, -6.2000), (106.8500, -6.2000)], length_m=20000.0, properties={"attenuationDbPerKm": 0.37})
    conn = TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="ont-1", cable_segment_id="c1")

    project = Project(
        id="p-overload-test",
        name="Overload Test",
        nodes=[olt, ont],
        cable_segments=[c],
        connections=[conn],
    )

    result = calculate_optical_budget(project)
    path = result.paths[0]

    assert path.received_power_dbm == -7.50
    assert path.received_power_dbm > -8.00  # Exceeds overload
    assert path.status == "fail"
    assert path.status_reason == "rx_power_exceeds_overload"


def test_unknown_splitter_ratio_never_produces_unjustified_pass():
    """Verify unlisted splitter ratio without explicit loss returns status unknown, never false pass."""
    olt = _node("olt-1", NodeType.OLT, (106.8400, -6.2000), {"txPowerDbm": 3.0})
    odc = _node("odc-1", NodeType.ODC, (106.8450, -6.2000), {"splitterRatio": "1:999"})  # Unlisted
    ont = _node("ont-1", NodeType.ONT, (106.8500, -6.2000))

    c1 = _cable("c1", [(106.8400, -6.2000), (106.8450, -6.2000)], length_m=100.0)
    c2 = _cable("c2", [(106.8450, -6.2000), (106.8500, -6.2000)], length_m=100.0)

    conns = [
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c1"),
        TopologyConnection(id="l2", from_node_id="odc-1", to_node_id="ont-1", cable_segment_id="c2"),
    ]

    project = Project(
        id="p-unknown-ratio",
        name="Unknown Ratio Test",
        nodes=[olt, odc, ont],
        cable_segments=[c1, c2],
        connections=conns,
    )

    result = calculate_optical_budget(project)
    path = result.paths[0]

    assert path.status == "unknown"
    assert path.status_reason == "unknown_splitter_ratio"
    assert path.loss_db is None
    assert path.received_power_dbm is None


# --- B. Cable Geometry Integrity ---

def test_cable_routes_drawn_in_either_direction_allowed():
    """Verify cable route can be drawn in either direction when endpoints match within tolerance."""
    p_a = (106.8400, -6.2000)
    p_b = (106.8500, -6.2000)
    node_a = _node("node-a", NodeType.OLT, p_a)
    node_b = _node("node-b", NodeType.ODC, p_b)

    # 1. Forward direction: coords start near node-a, end near node-b
    cable_fwd = _cable("c-fwd", [p_a, (106.8450, -6.2020), p_b], start_id="node-a", end_id="node-b")
    # 2. Reverse direction: coords start near node-b, end near node-a
    cable_rev = _cable("c-rev", [p_b, (106.8450, -6.2020), p_a], start_id="node-a", end_id="node-b")

    project = Project(
        id="p-bidirectional",
        name="Bidirectional Cable Drawing",
        nodes=[node_a, node_b],
        cable_segments=[cable_fwd, cable_rev],
    )

    errors = validate_project_integrity(project)
    assert len(errors) == 0


def test_cable_endpoint_spatial_tolerance_strictly_enforced():
    """Verify endpoint coordinates exceeding 50m tolerance are rejected."""
    p_a = (106.8400, -6.2000)
    p_b = (106.8500, -6.2000)
    # Point ~80m away from node-a
    p_off = (106.8400, -6.2007)

    node_a = _node("node-a", NodeType.OLT, p_a)
    node_b = _node("node-b", NodeType.ODC, p_b)

    cable = _cable("c-off", [p_off, p_b], start_id="node-a", end_id="node-b")
    project = Project(
        id="p-tolerance",
        name="Tolerance Test",
        nodes=[node_a, node_b],
        cable_segments=[cable],
    )

    errors = validate_project_integrity(project)
    assert len(errors) > 0
    assert any("does not correspond to start node" in e.message for e in errors)


# --- C. Router Cost Configuration ---

def test_router_costs_omitted_when_not_configured():
    """Verify router BoQ items are not emitted when router rates are unconfigured (None)."""
    router = _node("rtr-1", NodeType.ROUTER, (106.8400, -6.2000))
    # Unconfigured router rates default to None
    config = ConstructionCostConfig()
    assert config.router_unit_cost is None
    assert config.router_installation_cost is None

    project = Project(
        id="p-rtr-unconf",
        name="Unconfigured Router Cost Test",
        nodes=[router],
        settings=ProjectSettings(construction_cost=config),
    )

    res = calculate_construction_cost(project)
    assert not any(i.code in ("RTR-SUPPLY", "RTR-INSTALL") for i in res.items)
    assert res.summary["routerCount"] == 1


def test_router_costs_calculated_correctly_when_configured():
    """Verify router BoQ items are generated and arithmetic is consistent when configured."""
    r1 = _node("rtr-1", NodeType.ROUTER, (106.8400, -6.2000))
    r2 = _node("rtr-2", NodeType.ROUTER, (106.8450, -6.2000))

    config = ConstructionCostConfig(
        router_unit_cost=350000.0,
        router_installation_cost=75000.0,
    )

    project = Project(
        id="p-rtr-conf",
        name="Configured Router Cost Test",
        nodes=[r1, r2],
        settings=ProjectSettings(construction_cost=config),
    )

    res = calculate_construction_cost(project)
    rtr_mat = next(i for i in res.items if i.code == "RTR-SUPPLY")
    rtr_inst = next(i for i in res.items if i.code == "RTR-INSTALL")

    assert rtr_mat.quantity == 2.0
    assert rtr_mat.unit_cost == 350000.0
    assert rtr_mat.amount == 700000.0

    assert rtr_inst.quantity == 2.0
    assert rtr_inst.unit_cost == 75000.0
    assert rtr_inst.amount == 150000.0

    assert res.material_subtotal == 700000.0
    assert res.installation_subtotal == 150000.0
    assert res.grand_total == 850000.0


def test_existing_projects_without_router_costs_load_and_calculate():
    """Verify existing/legacy project models without router cost fields load and calculate safely."""
    # Simulates an older project dictionary stored in database before router rates were added
    legacy_data = {
        "id": "legacy-proj",
        "name": "Legacy Project",
        "nodes": [
            {
                "id": "olt-leg",
                "type": "olt",
                "name": "OLT 1",
                "location": {"type": "Point", "coordinates": [106.84, -6.20]},
            }
        ],
        "settings": {
            "constructionCost": {
                "currency": "IDR",
                "oltUnitCost": 25000000.0,
                "oltInstallationCost": 3000000.0,
            }
        },
    }

    project = Project.model_validate(legacy_data)
    assert project.settings.construction_cost.router_unit_cost is None
    assert project.settings.construction_cost.router_installation_cost is None

    res = calculate_construction_cost(project)
    assert res.total_amount == 28000000.0
    assert not any(i.code in ("RTR-SUPPLY", "RTR-INSTALL") for i in res.items)
