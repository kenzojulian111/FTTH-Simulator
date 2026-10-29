"""Unit tests for optical power budget engineering calculations."""

import pytest
from backend.app.domain.models import (
    CableSegment,
    LineGeometry,
    NetworkNode,
    NodeType,
    OpticalBudgetConfig,
    PointGeometry,
    Project,
    TopologyConnection,
)
from backend.app.engine.optical import calculate_optical_budget


def test_hand_computed_optical_budget_case():
    """Verify hand-computed optical budget against exact theoretical formula.
    
    Parameters:
    - Tx Power: +2.50 dBm
    - Cable: 2000.0 m (2.0 km) @ 0.35 dB/km -> 0.70 dB
    - Splitter: 1:8 ratio -> 10.50 dB
    - Connectors: 2 @ 0.50 dB -> 1.00 dB
    - Splices: 1 @ 0.10 dB -> 0.10 dB
    - Safety margin: 3.00 dB
    --------------------------------------------------
    Total Loss = 0.70 + 10.50 + 1.00 + 0.10 + 3.00 = 15.30 dB
    Received Power = +2.50 - 15.30 = -12.80 dBm
    Optical Margin = -12.80 - (-27.00) = +14.20 dB
    Status = 'pass' (within [-27.0, -8.0] dBm)
    """
    olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT 1",
        location=PointGeometry(coordinates=(115.0, -8.0)),
        properties={"txPowerDbm": 2.5},
    )
    odc = NetworkNode(
        id="odc-1",
        type=NodeType.ODC,
        name="ODC 1",
        location=PointGeometry(coordinates=(115.018, -8.0)),
        properties={"splitterRatio": "1:8"},
    )
    cable = CableSegment(
        id="cable-1",
        name="Feeder Cable",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.018, -8.0)]),
        length_m=2000.0,
    )
    conn = TopologyConnection(
        id="conn-1",
        from_node_id="olt-1",
        to_node_id="odc-1",
        cable_segment_id="cable-1",
    )

    project = Project(
        id="test-optical-proj",
        name="Optical Test",
        nodes=[olt, odc],
        cable_segments=[cable],
        connections=[conn],
    )

    result = calculate_optical_budget(project)

    assert len(result.links) == 1
    link = result.links[0]
    assert link.connection_id == "conn-1"
    assert link.length_m == 2000.0
    # Physical loss: 0.70 + 10.50 + 1.00 + 0.10 = 12.30 dB
    assert pytest.approx(link.loss_db, abs=0.01) == 12.30
    assert pytest.approx(link.details["totalLossDb"], abs=0.01) == 15.30
    assert pytest.approx(link.details["safetyMarginDb"], abs=0.01) == 3.00
    # Physical received power (safety margin not deducted): +2.50 - 12.30 = -9.80 dBm
    assert pytest.approx(link.received_power_dbm, abs=0.01) == -9.80
    # Design margin: -9.80 - (-27.00) - 3.00 = +14.20 dB
    assert pytest.approx(link.margin_db, abs=0.01) == 14.20
    assert link.status == "pass"


def test_optical_budget_fail_low_signal():
    """Verify link fails when optical loss exceeds available power margin."""
    olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT 1",
        location=PointGeometry(coordinates=(115.0, -8.0)),
        properties={"txPowerDbm": 2.5},
    )
    ont = NetworkNode(
        id="ont-1",
        type=NodeType.ONT,
        name="ONT 1",
        location=PointGeometry(coordinates=(115.3, -8.0)),
        properties={"rxSensitivityDbm": -27.0, "splitterRatio": "1:64"},
    )
    # 30 km cable @ 0.35 dB/km = 10.5 dB + 1:64 splitter (20.5 dB) + conn (1.0) + splice (0.1) + safety (3.0) = 35.1 dB loss
    # Rx Power = 2.5 - 35.1 = -32.6 dBm (below -27.0 dBm sensitivity)
    cable = CableSegment(
        id="cable-long",
        name="Long Cable",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.3, -8.0)]),
        length_m=30000.0,
    )
    conn = TopologyConnection(
        id="conn-fail",
        from_node_id="olt-1",
        to_node_id="ont-1",
        cable_segment_id="cable-long",
    )
    project = Project(
        id="proj-fail",
        name="Fail Test",
        nodes=[olt, ont],
        cable_segments=[cable],
        connections=[conn],
    )

    result = calculate_optical_budget(project)
    assert len(result.links) == 1
    link = result.links[0]
    assert link.status == "fail"
    assert link.received_power_dbm < -27.0
    assert result.summary["failed"] == 1


def test_optical_budget_unknown_status_for_pole_endpoint():
    """Verify connection terminating at a physical pole reports status 'unknown'."""
    olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT",
        location=PointGeometry(coordinates=(115.0, -8.0)),
    )
    pole = NetworkNode(
        id="pole-1",
        type=NodeType.POLE,
        name="Pole 1",
        location=PointGeometry(coordinates=(115.001, -8.0)),
    )
    cable = CableSegment(
        id="c1",
        name="Cable",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.001, -8.0)]),
        length_m=110.0,
    )
    conn = TopologyConnection(
        id="conn-pole",
        from_node_id="olt-1",
        to_node_id="pole-1",
        cable_segment_id="c1",
    )
    project = Project(
        id="proj-pole",
        name="Pole Link Test",
        nodes=[olt, pole],
        cable_segments=[cable],
        connections=[conn],
    )

    result = calculate_optical_budget(project)
    assert len(result.links) == 1
    assert result.links[0].status == "unknown"


def test_optical_budget_cable_property_override():
    """Verify cable-level attenuation override takes precedence over default."""
    olt = NetworkNode(
        id="olt-1",
        type=NodeType.OLT,
        name="OLT",
        location=PointGeometry(coordinates=(115.0, -8.0)),
        properties={"txPowerDbm": 0.0},
    )
    odp = NetworkNode(
        id="odp-1",
        type=NodeType.ODP,
        name="ODP",
        location=PointGeometry(coordinates=(115.01, -8.0)),
    )
    # Cable has 1550nm fiber with 0.20 dB/km override
    cable = CableSegment(
        id="c-override",
        name="Low Loss Cable",
        geometry=LineGeometry(coordinates=[(115.0, -8.0), (115.01, -8.0)]),
        length_m=10000.0,  # 10 km
        properties={"attenuationDbPerKm": 0.20},
    )
    conn = TopologyConnection(
        id="conn-override",
        from_node_id="olt-1",
        to_node_id="odp-1",
        cable_segment_id="c-override",
    )
    project = Project(
        id="proj-override",
        name="Override Test",
        nodes=[olt, odp],
        cable_segments=[cable],
        connections=[conn],
    )

    # Physical loss: 2.0 + 1.0 + 0.1 = 3.10 dB; Total loss budget with margin: 6.10 dB
    result = calculate_optical_budget(project)
    link = result.links[0]
    assert pytest.approx(link.details["fiberLossDb"], abs=0.01) == 2.0
    assert pytest.approx(link.loss_db, abs=0.01) == 3.10
    assert pytest.approx(link.details["totalLossDb"], abs=0.01) == 6.10
