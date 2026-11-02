import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.domain.models import (
    NodeType,
    Project,
    NetworkNode,
    CableSegment,
    TopologyConnection,
    PointGeometry,
    LineGeometry,
    ConnectionValidationRequest,
)
from backend.app.domain.validation import (
    validate_connection_candidate,
    validate_project_integrity,
)
from backend.app.engine.optical import calculate_optical_budget
from backend.app.persistence.repository import ProjectRepository


@pytest.fixture
def clean_ftth_project():
    """Build a minimal valid FTTH project with OLT, ODC, ODP, ONT."""
    p = Project(id="test-ports-proj", name="Port Testing Project")
    p.nodes = [
        NetworkNode(
            id="olt-1",
            name="OLT 1",
            type=NodeType.OLT,
            location=PointGeometry(coordinates=[115.0, -8.0]),
            properties={
                "vendor": "Huawei",
                "model": "MA5800",
                "ponTechnology": "GPON",
                "ponPortCapacity": 4,
                "ponPorts": 4,
                "txPowerDbm": 2.5,
                "maxCustomersPerPort": 64,
                "ponPortArchitectureStatus": "configured",
                "opticalEquipmentStatus": "configured",
            },
        ),
        NetworkNode(
            id="odc-1",
            name="ODC 1",
            type=NodeType.ODC,
            location=PointGeometry(coordinates=[115.001, -8.001]),
            properties={
                "feederPortCapacity": 4,
                "distributionPortCapacity": 16,
                "distributionFanoutCapacity": 16,
                "distributionFanoutCapacityStatus": "configured",
            },
        ),
        NetworkNode(
            id="odp-1",
            name="ODP 1",
            type=NodeType.ODP,
            location=PointGeometry(coordinates=[115.002, -8.002]),
            properties={
                "portCapacity": 8,
                "capacity": 8,
                "splitterRatio": "1:8",
                "sourcePonPortId": "OLT 1 PON 1",
            },
        ),
        NetworkNode(
            id="ont-1",
            name="ONT 1",
            type=NodeType.ONT,
            location=PointGeometry(coordinates=[115.003, -8.003]),
            properties={
                "opticalEquipmentStatus": "configured",
                "plannedPonPortId": "OLT 1 PON 1",
            },
        ),
        NetworkNode(
            id="spl-odc-1",
            name="ODC 1 Feeder Splitter",
            type=NodeType.SPLITTER,
            location=PointGeometry(coordinates=[115.001, -8.001]),
            properties={
                "mountedInNodeId": "odc-1",
                "splitterRatio": "1:8",
                "splitterLossDb": 10.38,
                "capacity": 8,
                "inputPortId": "IN-1",
                "ponPortId": "OLT 1 PON 1",
                "outputPortAssignments": [{"portId": "OUT-1", "connectedNodeId": "odp-1"}],
                "splitterSpecificationStatus": "configured",
            },
        ),
        NetworkNode(
            id="spl-odp-1",
            name="ODP 1 Internal Splitter",
            type=NodeType.SPLITTER,
            location=PointGeometry(coordinates=[115.002, -8.002]),
            properties={
                "mountedInNodeId": "odp-1",
                "splitterRatio": "1:8",
                "splitterLossDb": 10.0,
                "capacity": 8,
                "inputPortId": "IN-1",
                "outputPortAssignments": [{"portId": "OUT-1", "connectedNodeId": "ont-1"}],
                "splitterSpecificationStatus": "configured",
            },
        ),
    ]
    p.cable_segments = [
        CableSegment(
            id="c-feeder",
            name="Feeder Cable",
            start_node_id="olt-1",
            end_node_id="odc-1",
            cable_type="feeder",
            fiber_count=12,
            geometry=LineGeometry(coordinates=[[115.0, -8.0], [115.001, -8.001]]),
            length_m=120.0,
            properties={"deploymentMethod": "aerial", "routeStatus": "map_candidate_unverified"},
        ),
        CableSegment(
            id="c-dist",
            name="Distribution Cable",
            start_node_id="odc-1",
            end_node_id="odp-1",
            cable_type="distribution",
            fiber_count=12,
            geometry=LineGeometry(coordinates=[[115.001, -8.001], [115.002, -8.002]]),
            length_m=80.0,
            properties={"deploymentMethod": "aerial", "routeStatus": "map_candidate_unverified"},
        ),
        CableSegment(
            id="c-drop",
            name="Drop Cable",
            start_node_id="odp-1",
            end_node_id="ont-1",
            cable_type="drop",
            fiber_count=1,
            geometry=LineGeometry(coordinates=[[115.002, -8.002], [115.003, -8.003]]),
            length_m=35.0,
            properties={"deploymentMethod": "aerial", "routeStatus": "map_candidate_unverified"},
        ),
    ]
    p.connections = [
        TopologyConnection(
            id="conn-1",
            from_node_id="olt-1",
            to_node_id="odc-1",
            cable_segment_id="c-feeder",
            from_port_id="PON-1",
            to_port_id="IN-01",
        ),
        TopologyConnection(
            id="conn-2",
            from_node_id="odc-1",
            to_node_id="odp-1",
            cable_segment_id="c-dist",
            from_port_id="OUT-01",
            to_port_id="IN",
        ),
        TopologyConnection(
            id="conn-3",
            from_node_id="odp-1",
            to_node_id="ont-1",
            cable_segment_id="c-drop",
            from_port_id="OUT-1",
            to_port_id="IN",
        ),
    ]
    return p


def test_port_validation_duplicate_prevention(clean_ftth_project):
    """Ensure two connections cannot use the same dedicated distribution output port."""
    project = clean_ftth_project

    # Candidate attempting to reuse ODC OUT-01 for another ODP
    request = ConnectionValidationRequest(
        from_node_id="odc-1",
        to_node_id="odp-1",
        cable_segment_id="c-dist",
        from_port_id="OUT-01",  # already used by conn-2
        to_port_id="IN",
        project=project,
    )
    result = validate_connection_candidate(project, request)
    assert not result.valid
    assert any(err.code == "port_already_in_use" for err in result.errors)
    assert "OUT-01" in str([e.message for e in result.errors])


def test_pon_port_multipoint_allowed(clean_ftth_project):
    """Ensure OLT PON ports support point-to-multipoint branches up to capacity."""
    project = clean_ftth_project

    # Add second ODC on PON-1
    request = ConnectionValidationRequest(
        from_node_id="olt-1",
        to_node_id="odc-1",
        cable_segment_id="c-feeder",
        from_port_id="PON-1",  # PON-1 allows multi-point subscriber fanout
        to_port_id="IN-02",
        project=project,
    )
    result = validate_connection_candidate(project, request)
    assert not any(e.details and e.details.get("portId") == "PON-1" for e in result.errors)


def test_optical_budget_no_double_counting(clean_ftth_project):
    """Ensure splitter loss is counted exactly once between mounted splitter and host cabinet."""
    project = clean_ftth_project

    result = calculate_optical_budget(project)
    assert len(result.paths) == 1
    path = result.paths[0]
    assert path.status == "pass"

    # Exactly 2 splitters along the path (1 ODC feeder splitter + 1 ODP distribution splitter)
    assert len(path.splitters) == 2
    splitter_names = [s.node_name for s in path.splitters]
    assert "ODC 1 Feeder Splitter" in splitter_names
    assert "ODP 1 Internal Splitter" in splitter_names

    # Power in valid ONT sensitivity range (-27 dBm to -8 dBm)
    assert path.received_power_dbm is not None
    assert -27.0 <= path.received_power_dbm <= -8.0
    assert path.margin_db is not None and path.margin_db > 0
    assert path.physical_route_status == "unverified"


def test_migrated_database_project_integrity():
    """Verify test-proj-calc-physical-20261031 in database meets all Section 8 and 9 requirements."""
    engine = create_engine("sqlite:///ftth_simulator.db")
    Session = sessionmaker(bind=engine)
    db = Session()
    repo = ProjectRepository(db)

    project = repo.get("test-proj-calc-physical-20261031")
    assert project is not None, "Target project must exist"

    # 1. 110 customers preserved
    assert len(project.customers) == 110

    # 2. Ports are recorded on connections
    conns_with_ports = [c for c in project.connections if c.from_port_id and c.to_port_id]
    assert len(conns_with_ports) == len(project.connections)

    # 3. No zero-length jumper cables
    jumper_cables = [
        c for c in project.cable_segments
        if c.properties.get("connectionKind") == "internal_optical_jumper" or "jumper" in c.name.lower()
    ]
    assert len(jumper_cables) == 0

    # 4. Device capacities
    olt = next(n for n in project.nodes if n.type == NodeType.OLT)
    assert olt.properties.get("ponPortCapacity") >= 4
    assert olt.properties.get("txPowerDbm") == 2.5

    odc = next(n for n in project.nodes if n.type == NodeType.ODC)
    assert odc.properties.get("distributionPortCapacity") == 16

    c6 = next(c for c in project.cable_segments if "cable 6" in c.name.lower() or "feeder" in c.cable_type.lower())
    assert c6.fiber_count == 12

    # 5. Semantic validity
    integrity_errors = validate_project_integrity(project)
    assert len(integrity_errors) == 0

    # 6. Optical Power Budget verification
    res = calculate_optical_budget(project)
    assert len(res.paths) == 110
    assert all(p.status == "pass" for p in res.paths), "All 110 ONT paths must PASS"
    assert all(p.physical_route_status == "unverified" for p in res.paths), "All physical routes must be UNVERIFIED"
    assert all(-27.0 <= p.received_power_dbm <= -8.0 for p in res.paths), "Received power in range"
    assert all(p.margin_db > 0 for p in res.paths), "Margin must be positive"
    assert all(len(p.splitters) == 2 for p in res.paths), "Splitter loss counted exactly once (2 splitters: ODC + ODP)"

    # 7. Original Calc Projek untouched
    calc_orig = repo.get("test-proj-calc")
    assert calc_orig is not None
    assert len(calc_orig.customers) == 110
    assert len(calc_orig.nodes) == 30

    db.close()


def test_custom_optical_parameters_recalculation():
    engine = create_engine("sqlite:///ftth_simulator.db")
    Session = sessionmaker(bind=engine)
    db = Session()
    repo = ProjectRepository(db)

    project = repo.get("test-proj-calc-physical-20261031")
    assert project is not None

    # Baseline calculation with defaults
    res_base = calculate_optical_budget(project)
    path_base = res_base.paths[0]
    base_rx = path_base.received_power_dbm

    # 1. Custom OLT Tx Power: +6.00 dBm (baseline was 2.50 dBm -> delta = +3.50 dB)
    olt = next(n for n in project.nodes if n.type == NodeType.OLT)
    olt.properties["txPowerDbm"] = 6.0

    res_tx = calculate_optical_budget(project)
    path_tx = res_tx.paths[0]
    assert path_tx.details["txPowerDbm"] == 6.0
    assert path_tx.parameter_sources["txPowerDbm"] == "configured"
    assert round(path_tx.received_power_dbm - base_rx, 2) == 3.5

    # 2. Custom Splitter Insertion Loss: 10.2 dB on ODP mounted splitter
    spl_id = path_tx.splitters[1].node_id
    spl = next(n for n in project.nodes if n.id == spl_id)
    orig_loss = spl.properties.get("splitterLossDb", 10.38)
    spl.properties["splitterLossDb"] = 10.2

    res_spl = calculate_optical_budget(project)
    path_spl = next(p for p in res_spl.paths if p.ont_node_id == path_tx.ont_node_id)
    assert path_spl.splitters[1].loss_db == 10.2
    assert path_spl.parameter_sources[f"{spl_id}.splitterLossDb"] == "configured"

    # 3. Custom ONT Sensitivity: -28.0 dBm
    ont = next(n for n in project.nodes if n.id == path_spl.ont_node_id)
    ont.properties["rxSensitivityDbm"] = -28.0

    res_ont = calculate_optical_budget(project)
    path_ont = next(p for p in res_ont.paths if p.ont_node_id == path_spl.ont_node_id)
    assert path_ont.details["rxSensitivityDbm"] == -28.0
    assert path_ont.parameter_sources["rxSensitivityDbm"] == "configured"
    expected_sens_margin = round(path_ont.received_power_dbm - (-28.0), 2)
    assert path_ont.sensitivity_margin_db == expected_sens_margin

    # Revert properties in-memory so test leaves database clean
    olt.properties["txPowerDbm"] = 2.5
    spl.properties["splitterLossDb"] = orig_loss
    ont.properties.pop("rxSensitivityDbm", None)

    db.close()
