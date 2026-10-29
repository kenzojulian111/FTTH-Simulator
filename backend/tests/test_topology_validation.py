"""Unit and integration tests for authoritative GPON FTTH topology validation.

Verifies:
- Standard GPON optical flow: OLT -> ODC -> ODP -> ONT.
- Allowed splitter placement variants (centralized, distributed, cascaded).
- Physical infrastructure separation (Poles cannot host optical connections).
- Customer subscriber separation (Customers link via ontNodeId, not fiber links).
- Invalid device transitions and upstream flow inversions.
- Prohibited cycle / loop detection.
- Capacity enforcement (splitter ratio, cable fiber count, ONT single-input) only when configured.
- Unconfigured capacity reporting (no false rejections).
- Validation API endpoints for frontend connection dialog consumption.
"""

import pytest
from fastapi.testclient import TestClient

from backend.app.domain.models import (
    CableSegment,
    ConnectionValidationRequest,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    TopologyConnection,
)
from backend.app.domain.validation import (
    validate_connection_candidate,
    validate_project_topology,
)


def _make_node(node_id: str, node_type: NodeType, properties=None) -> NetworkNode:
    return NetworkNode(
        id=node_id,
        type=node_type,
        name=f"Node {node_id.upper()}",
        location=PointGeometry(coordinates=(106.84 + len(node_id) * 0.001, -6.20)),
        properties=properties or {},
    )


def _make_cable(cable_id: str, fiber_count=None) -> CableSegment:
    return CableSegment(
        id=cable_id,
        name=f"Cable {cable_id}",
        fiber_count=fiber_count,
        geometry=LineGeometry(coordinates=[(106.84, -6.20), (106.85, -6.20)]),
    )


def test_valid_standard_2_stage_gpon_path():
    """Verify standard 2-stage GPON path (OLT -> ODC -> ODP -> ONT) is valid."""
    olt = _make_node("olt-1", NodeType.OLT, {"txPowerDbm": 3.0})
    odc = _make_node("odc-1", NodeType.ODC, {"splitterRatio": "1:4"})
    odp = _make_node("odp-1", NodeType.ODP, {"splitterRatio": "1:8"})
    ont = _make_node("ont-1", NodeType.ONT)

    c1 = _make_cable("c1", fiber_count=24)
    c2 = _make_cable("c2", fiber_count=12)
    c3 = _make_cable("c3", fiber_count=2)

    conns = [
        TopologyConnection(id="conn-1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c1"),
        TopologyConnection(id="conn-2", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c2"),
        TopologyConnection(id="conn-3", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c3"),
    ]

    project = Project(
        id="proj-valid-gpon",
        name="Valid GPON",
        nodes=[olt, odc, odp, ont],
        cable_segments=[c1, c2, c3],
        connections=conns,
    )

    result = validate_project_topology(project)
    assert result.valid is True
    assert len(result.errors) == 0
    assert result.summary["hasCycles"] is False


def test_valid_cascaded_splitters_and_placement_variants():
    """Verify legitimate deployment variations: standalone splitters, cascaded splitters, and direct drops."""
    olt = _make_node("olt-1", NodeType.OLT)
    s1 = _make_node("s1", NodeType.SPLITTER, {"splitterRatio": "1:2"})
    s2 = _make_node("s2", NodeType.SPLITTER, {"splitterRatio": "1:8"})
    odp = _make_node("odp-1", NodeType.ODP)
    ont1 = _make_node("ont-1", NodeType.ONT)
    ont2 = _make_node("ont-2", NodeType.ONT)

    cables = [_make_cable(f"c{i}") for i in range(1, 6)]
    conns = [
        # OLT -> Splitter 1 (Cascaded stage 1)
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="s1", cable_segment_id="c1"),
        # Splitter 1 -> Splitter 2 (Cascaded stage 2)
        TopologyConnection(id="l2", from_node_id="s1", to_node_id="s2", cable_segment_id="c2"),
        # Splitter 2 -> ODP
        TopologyConnection(id="l3", from_node_id="s2", to_node_id="odp-1", cable_segment_id="c3"),
        # ODP -> ONT 1
        TopologyConnection(id="l4", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c4"),
        # Splitter 2 -> ONT 2 (Direct drop from splitter)
        TopologyConnection(id="l5", from_node_id="s2", to_node_id="ont-2", cable_segment_id="c5"),
    ]

    project = Project(
        id="proj-variants",
        name="Splitter Variants",
        nodes=[olt, s1, s2, odp, ont1, ont2],
        cable_segments=cables,
        connections=conns,
    )

    result = validate_project_topology(project)
    assert result.valid is True
    assert len(result.errors) == 0


def test_passive_distribution_node_rejects_multiple_upstream_feeds():
    olt1 = _make_node("olt-1", NodeType.OLT)
    olt2 = _make_node("olt-2", NodeType.OLT)
    splitter = _make_node("splitter-1", NodeType.SPLITTER, {"splitterRatio": "1:8"})
    ont = _make_node("ont-1", NodeType.ONT)
    cables = [_make_cable("c1"), _make_cable("c2"), _make_cable("c3")]
    project = Project(
        id="p-multiple-inputs",
        name="Two OLT feeds",
        nodes=[olt1, olt2, splitter, ont],
        cable_segments=cables,
        connections=[
            TopologyConnection(id="l1", from_node_id=olt1.id, to_node_id=splitter.id, cable_segment_id="c1"),
            TopologyConnection(id="l2", from_node_id=olt2.id, to_node_id=splitter.id, cable_segment_id="c2"),
            TopologyConnection(id="l3", from_node_id=splitter.id, to_node_id=ont.id, cable_segment_id="c3"),
        ],
    )

    result = validate_project_topology(project)

    assert result.valid is False
    issue = next(error for error in result.errors if error.code == "passive_node_multiple_inputs")
    assert issue.to_node_id == splitter.id
    assert issue.details["connectionIds"] == ["l1", "l2"]


def test_candidate_connection_rejects_second_upstream_feed_to_passive_node():
    olt1 = _make_node("olt-1", NodeType.OLT)
    olt2 = _make_node("olt-2", NodeType.OLT)
    splitter = _make_node("splitter-1", NodeType.SPLITTER, {"splitterRatio": "1:8"})
    project = Project(
        id="p-candidate-multiple-inputs",
        name="Candidate two OLT feeds",
        nodes=[olt1, olt2, splitter],
        cable_segments=[_make_cable("c1"), _make_cable("c2")],
        connections=[TopologyConnection(id="l1", from_node_id=olt1.id, to_node_id=splitter.id, cable_segment_id="c1")],
    )

    result = validate_connection_candidate(project, ConnectionValidationRequest(
        from_node_id=olt2.id,
        to_node_id=splitter.id,
        cable_segment_id="c2",
    ))

    assert result.valid is False
    assert any(error.code == "passive_node_multiple_inputs" for error in result.errors)


def test_invalid_transition_from_ont():
    """Verify ONT cannot have downstream optical connections."""
    ont = _make_node("ont-1", NodeType.ONT)
    odc = _make_node("odc-1", NodeType.ODC)
    cable = _make_cable("c1")

    project = Project(id="p", name="Test", nodes=[ont, odc], cable_segments=[cable])
    req = ConnectionValidationRequest(from_node_id="ont-1", to_node_id="odc-1", cable_segment_id="c1")

    res = validate_connection_candidate(project, req)
    assert res.valid is False
    assert any(e.code == "ont_cannot_have_downstream_connections" for e in res.errors)


def test_invalid_transition_into_olt():
    """Verify OLT cannot accept an upstream optical input."""
    olt = _make_node("olt-1", NodeType.OLT)
    odc = _make_node("odc-1", NodeType.ODC)
    cable = _make_cable("c1")

    project = Project(id="p", name="Test", nodes=[odc, olt], cable_segments=[cable])
    req = ConnectionValidationRequest(from_node_id="odc-1", to_node_id="olt-1", cable_segment_id="c1")

    res = validate_connection_candidate(project, req)
    assert res.valid is False
    assert any(e.code == "olt_cannot_have_upstream_feed" for e in res.errors)


def test_invalid_transition_with_pole():
    """Verify physical Pole cannot be an optical connection endpoint."""
    olt = _make_node("olt-1", NodeType.OLT)
    pole = _make_node("pole-1", NodeType.POLE)
    cable = _make_cable("c1")

    project = Project(id="p", name="Test", nodes=[olt, pole], cable_segments=[cable])
    req = ConnectionValidationRequest(from_node_id="olt-1", to_node_id="pole-1", cable_segment_id="c1")

    res = validate_connection_candidate(project, req)
    assert res.valid is False
    assert any(e.code == "pole_not_optical_device" for e in res.errors)


def test_invalid_transition_with_customer():
    """Verify Customer entity cannot be an optical connection endpoint."""
    olt = _make_node("olt-1", NodeType.OLT)
    cust_node = _make_node("cust-1", NodeType.CUSTOMER)
    cable = _make_cable("c1")

    project = Project(id="p", name="Test", nodes=[olt, cust_node], cable_segments=[cable])
    req = ConnectionValidationRequest(from_node_id="olt-1", to_node_id="cust-1", cable_segment_id="c1")

    res = validate_connection_candidate(project, req)
    assert res.valid is False
    assert any(e.code == "customer_not_optical_node" for e in res.errors)


def test_invalid_reverse_flow_odp_to_odc():
    """Verify upstream flow inversion (ODP -> ODC) is rejected."""
    odp = _make_node("odp-1", NodeType.ODP)
    odc = _make_node("odc-1", NodeType.ODC)
    cable = _make_cable("c1")

    project = Project(id="p", name="Test", nodes=[odp, odc], cable_segments=[cable])
    req = ConnectionValidationRequest(from_node_id="odp-1", to_node_id="odc-1", cable_segment_id="c1")

    res = validate_connection_candidate(project, req)
    assert res.valid is False
    assert any(e.code == "invalid_connection_direction" for e in res.errors)


def test_prohibited_cycle_detection():
    """Verify circular optical dependency (e.g. A -> B -> C -> A) is detected and rejected."""
    n1 = _make_node("n1", NodeType.ODC)
    n2 = _make_node("n2", NodeType.ODC)
    n3 = _make_node("n3", NodeType.ODC)

    c1 = _make_cable("c1")
    c2 = _make_cable("c2")
    c3 = _make_cable("c3")

    # Existing: n1 -> n2 -> n3
    conns = [
        TopologyConnection(id="conn-1", from_node_id="n1", to_node_id="n2", cable_segment_id="c1"),
        TopologyConnection(id="conn-2", from_node_id="n2", to_node_id="n3", cable_segment_id="c2"),
    ]

    project = Project(id="p-cycle", name="Cycle Test", nodes=[n1, n2, n3], cable_segments=[c1, c2, c3], connections=conns)

    # Propose n3 -> n1 closing the cycle
    req = ConnectionValidationRequest(from_node_id="n3", to_node_id="n1", cable_segment_id="c3")
    res = validate_connection_candidate(project, req)

    assert res.valid is False
    assert any(e.code == "prohibited_cycle" for e in res.errors)


def test_splitter_capacity_enforced_when_configured():
    """Verify splitter output capacity is enforced when splitterRatio or capacity is specified."""
    olt = _make_node("olt-1", NodeType.OLT)
    splitter = _make_node("spl-1", NodeType.SPLITTER, {"splitterRatio": "1:2"})  # capacity = 2
    ont1 = _make_node("ont-1", NodeType.ONT)
    ont2 = _make_node("ont-2", NodeType.ONT)
    ont3 = _make_node("ont-3", NodeType.ONT)

    cables = [_make_cable(f"c{i}") for i in range(1, 5)]
    conns = [
        TopologyConnection(id="l0", from_node_id="olt-1", to_node_id="spl-1", cable_segment_id="c1"),
        TopologyConnection(id="l1", from_node_id="spl-1", to_node_id="ont-1", cable_segment_id="c2"),
        TopologyConnection(id="l2", from_node_id="spl-1", to_node_id="ont-2", cable_segment_id="c3"),
    ]

    project = Project(id="p", name="Test", nodes=[olt, splitter, ont1, ont2, ont3], cable_segments=cables, connections=conns)

    # Propose 3rd output from a 1:2 splitter
    req = ConnectionValidationRequest(from_node_id="spl-1", to_node_id="ont-3", cable_segment_id="c4")
    res = validate_connection_candidate(project, req)

    assert res.valid is False
    assert any(e.code == "splitter_capacity_exceeded" for e in res.errors)
    assert res.summary["fromNodeCapacity"] == 2


def test_cable_fiber_capacity_enforced_when_configured():
    """Verify cable segment capacity is enforced when fiberCount is configured."""
    odc = _make_node("odc-1", NodeType.ODC)
    odp1 = _make_node("odp-1", NodeType.ODP)
    odp2 = _make_node("odp-2", NodeType.ODP)
    single_fiber_cable = _make_cable("c-single", fiber_count=1)

    conns = [
        TopologyConnection(id="conn-1", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c-single"),
    ]

    project = Project(id="p", name="Test", nodes=[odc, odp1, odp2], cable_segments=[single_fiber_cable], connections=conns)

    # Propose second connection on 1-fiber cable
    req = ConnectionValidationRequest(from_node_id="odc-1", to_node_id="odp-2", cable_segment_id="c-single")
    res = validate_connection_candidate(project, req)

    assert res.valid is False
    assert any(e.code == "cable_capacity_exceeded" for e in res.errors)
    assert res.summary["cableFiberCount"] == 1


def test_ont_multiple_incoming_feeds_prohibited():
    """Verify ONT can only have a single incoming upstream optical feed."""
    odp1 = _make_node("odp-1", NodeType.ODP)
    odp2 = _make_node("odp-2", NodeType.ODP)
    ont = _make_node("ont-1", NodeType.ONT)

    c1 = _make_cable("c1")
    c2 = _make_cable("c2")

    conns = [
        TopologyConnection(id="c1", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c1"),
    ]

    project = Project(id="p", name="Test", nodes=[odp1, odp2, ont], cable_segments=[c1, c2], connections=conns)

    # Propose second feed into the same ONT
    req = ConnectionValidationRequest(from_node_id="odp-2", to_node_id="ont-1", cable_segment_id="c2")
    res = validate_connection_candidate(project, req)

    assert res.valid is False
    assert any(e.code == "ont_multiple_inputs" for e in res.errors)


def test_unconfigured_capacity_is_not_falsely_rejected():
    """Verify nodes and cables without configured capacity are not falsely rejected."""
    odc = _make_node("odc-unconfigured", NodeType.ODC)  # No maxPorts / capacity
    odp = _make_node("odp-unconfigured", NodeType.ODP)
    cable = _make_cable("cable-unconfigured", fiber_count=None)  # fiber_count is None

    project = Project(id="p", name="Test", nodes=[odc, odp], cable_segments=[cable], connections=[])
    req = ConnectionValidationRequest(from_node_id="odc-unconfigured", to_node_id="odp-unconfigured", cable_segment_id="cable-unconfigured")

    res = validate_connection_candidate(project, req)
    assert res.valid is True
    assert res.summary["cableFiberCount"] == "unconfigured"
    assert res.summary["fromNodeCapacity"] == "unconfigured"


def test_candidate_connection_accepts_committed_route_without_endpoint_assignments():
    """Map-first route drafts may be committed before logical endpoints are assigned."""
    olt = _make_node("route-olt", NodeType.OLT)
    odc = _make_node("route-odc", NodeType.ODC)
    route = _make_cable("route-unassigned", fiber_count=12)
    project = Project(
        id="route-draft", name="Map-first route",
        nodes=[olt, odc], cable_segments=[route], connections=[],
    )
    request = ConnectionValidationRequest(
        from_node_id=olt.id,
        to_node_id=odc.id,
        cable_segment_id=route.id,
    )

    result = validate_connection_candidate(project, request)

    assert result.valid is True
    assert result.summary["allowedTransition"] is True
    # Validation approves a proposal only; it does not mutate/assign endpoints.
    assert route.start_node_id is None
    assert route.end_node_id is None


def test_api_validate_connection_endpoint_success(client: TestClient, sample_project: Project):
    """Verify POST /projects/{project_id}/validate-connection returns valid: true for allowed connection."""
    # 1. Save project first
    client.put(f"/api/v1/projects/{sample_project.id}", json=sample_project.model_dump(by_alias=True))

    # Add an unassigned cable and new ONT
    new_ont = _make_node("node-ont-new", NodeType.ONT)
    new_cable = _make_cable("cable-drop-new", fiber_count=2)
    sample_project.nodes.append(new_ont)
    sample_project.cable_segments.append(new_cable)
    client.put(f"/api/v1/projects/{sample_project.id}", json=sample_project.model_dump(by_alias=True))

    # Validate proposed connection from ODP to new ONT
    req_body = {
        "fromNodeId": "node-odp-1",
        "toNodeId": "node-ont-new",
        "cableSegmentId": "cable-drop-new",
    }
    res = client.post(f"/api/v1/projects/{sample_project.id}/validate-connection", json=req_body)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["errors"] == []
    assert data["summary"]["allowedTransition"] is True


def test_api_validate_connection_endpoint_failure_codes(client: TestClient, sample_project: Project):
    """Verify POST /projects/{project_id}/validate-connection returns valid: false with stable error codes."""
    client.put(f"/api/v1/projects/{sample_project.id}", json=sample_project.model_dump(by_alias=True))

    # Attempt connecting ONT -> OLT (Reverse direction & ONT downstream)
    req_body = {
        "fromNodeId": "node-ont-1",
        "toNodeId": "node-olt-1",
        "cableSegmentId": "cable-drop-1",
    }
    res = client.post(f"/api/v1/projects/{sample_project.id}/validate-connection", json=req_body)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is False
    assert len(data["errors"]) > 0
    codes = {e["code"] for e in data["errors"]}
    assert "ont_cannot_have_downstream_connections" in codes or "olt_cannot_have_upstream_feed" in codes


def test_api_validate_connection_with_inline_draft_project(client: TestClient):
    """Verify client can pre-validate a connection on an unsaved draft by providing project payload."""
    olt = _make_node("draft-olt", NodeType.OLT)
    odc = _make_node("draft-odc", NodeType.ODC)
    cable = _make_cable("draft-cable")

    draft_project = Project(id="draft-id", name="Draft", nodes=[olt, odc], cable_segments=[cable])

    req_body = {
        "fromNodeId": "draft-olt",
        "toNodeId": "draft-odc",
        "cableSegmentId": "draft-cable",
        "project": draft_project.model_dump(by_alias=True),
    }

    # project_id does not exist in DB, but inline project is passed
    res = client.post("/api/v1/projects/draft-id/validate-connection", json=req_body)
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["summary"]["fromNodeType"] == "olt"
    assert data["summary"]["toNodeType"] == "odc"


def test_api_validate_topology_endpoint(client: TestClient, sample_project: Project):
    """Verify GET and POST /projects/{project_id}/validate-topology returns full topology validation result."""
    client.put(f"/api/v1/projects/{sample_project.id}", json=sample_project.model_dump(by_alias=True))

    res_post = client.post(f"/api/v1/projects/{sample_project.id}/validate-topology")
    assert res_post.status_code == 200
    data_post = res_post.json()
    assert data_post["valid"] is True
    assert data_post["summary"]["totalNodes"] == len(sample_project.nodes)
    assert data_post["summary"]["totalConnections"] == len(sample_project.connections)

    res_get = client.get(f"/api/v1/projects/{sample_project.id}/validate-topology")
    assert res_get.status_code == 200
    assert res_get.json()["valid"] is True


def test_api_validation_endpoints_on_missing_project_return_404(client: TestClient):
    """Verify validate-connection and validate-topology return 404 when project is unpersisted and no inline draft is provided."""
    req_body = {
        "fromNodeId": "olt-1",
        "toNodeId": "odc-1",
        "cableSegmentId": "c1",
    }
    # 1. validate-connection on missing project
    res_conn = client.post("/api/v1/projects/unpersisted-id/validate-connection", json=req_body)
    assert res_conn.status_code == 404
    assert res_conn.json()["error"]["code"] == "not_found"

    # 2. GET validate-topology on missing project
    res_topo_get = client.get("/api/v1/projects/unpersisted-id/validate-topology")
    assert res_topo_get.status_code == 404
    assert res_topo_get.json()["error"]["code"] == "not_found"

    # 3. POST validate-topology without body on missing project
    res_topo_post = client.post("/api/v1/projects/unpersisted-id/validate-topology")
    assert res_topo_post.status_code == 404
    assert res_topo_post.json()["error"]["code"] == "not_found"


def test_api_validate_topology_with_inline_draft_project(client: TestClient):
    """Verify POST /projects/{project_id}/validate-topology validates an unsaved inline draft project."""
    olt = _make_node("draft-olt", NodeType.OLT)
    odc = _make_node("draft-odc", NodeType.ODC)
    cable = _make_cable("draft-cable")
    conn = TopologyConnection(id="conn-1", from_node_id="draft-olt", to_node_id="draft-odc", cable_segment_id="draft-cable")

    draft_project = Project(id="draft-topo-id", name="Draft Topo", nodes=[olt, odc], cable_segments=[cable], connections=[conn])

    res = client.post("/api/v1/projects/draft-topo-id/validate-topology", json=draft_project.model_dump(by_alias=True))
    assert res.status_code == 200
    data = res.json()
    assert data["valid"] is True
    assert data["summary"]["totalNodes"] == 2
    assert data["summary"]["totalConnections"] == 1


def test_centralized_1_stage_split_topology_and_optical_consistency():
    """Verify centralized single-stage splitting (OLT -> Splitter 1:32 -> ONT) validates and calculates optical budget."""
    from backend.app.engine.optical import calculate_optical_budget

    olt = _make_node("olt-1", NodeType.OLT, {"txPowerDbm": 4.0})
    splitter = _make_node("spl-1", NodeType.SPLITTER, {"splitterRatio": "1:32"})
    ont = _make_node("ont-1", NodeType.ONT, {"rxSensitivityDbm": -27.0, "rxOverloadDbm": -8.0})

    c_feeder = _make_cable("c-feeder", fiber_count=24)
    c_feeder.length_m = 5000.0  # 5 km
    c_drop = _make_cable("c-drop", fiber_count=2)
    c_drop.length_m = 500.0    # 500 m

    conns = [
        TopologyConnection(id="l1", from_node_id="olt-1", to_node_id="spl-1", cable_segment_id="c-feeder"),
        TopologyConnection(id="l2", from_node_id="spl-1", to_node_id="ont-1", cable_segment_id="c-drop"),
    ]

    project = Project(
        id="proj-centralized",
        name="Centralized Split",
        nodes=[olt, splitter, ont],
        cable_segments=[c_feeder, c_drop],
        connections=conns,
    )

    # 1. Topology validator
    topo_res = validate_project_topology(project)
    assert topo_res.valid is True
    assert len(topo_res.errors) == 0

    # 2. Optical budget calculation
    opt_res = calculate_optical_budget(project)
    assert len(opt_res.paths) == 1
    path = opt_res.paths[0]
    assert path.ont_node_id == "ont-1"
    assert path.status == "pass"
    assert path.loss_db is not None
    # 5.5 km * 0.35 dB/km = 1.925 dB fiber loss
    # 1:32 splitter loss = 17.5 dB
    # connectors (4 * 0.5 = 2 dB) + splices (4 * 0.1 = 0.4 dB) + safety margin (3 dB)
    # Total loss approx 24.8 dB -> Received power = 4.0 - 24.8 = -20.8 dBm (Sensitivity -27 dBm -> Margin 6.2 dB >= 3 dB -> pass)
    assert path.received_power_dbm is not None
    assert path.received_power_dbm > -27.0

