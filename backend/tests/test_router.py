"""Comprehensive test suite for Router device model, IP configuration validation,
topology rules, RAB costing, and optical budget isolation.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from backend.app.domain.models import (
    CableSegment,
    ConstructionCostConfig,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    ProjectSettings,
    RouterConfig,
    TopologyConnection,
    WanMode,
)
from backend.app.domain.validation import (
    extract_router_config,
    validate_connection_candidate,
    validate_project_integrity,
    validate_project_topology,
    validate_router_config,
)
from backend.app.engine.cost import calculate_construction_cost
from backend.app.engine.optical import calculate_optical_budget
from backend.app.main import app
from backend.app.persistence.repository import ProjectRepository


# --- 1. Router Model and Password Masking ---

def test_router_config_repr_and_str_mask_password():
    """Verify PPPoE password is never exposed in repr or str representations."""
    cfg = RouterConfig(
        hostname="home-gw",
        wan_mode=WanMode.PPPOE,
        pppoe_username="subscriber@isp.net",
        pppoe_password="SuperSecretPassword123!",
    )
    repr_str = repr(cfg)
    str_str = str(cfg)

    assert "SuperSecretPassword123!" not in repr_str
    assert "SuperSecretPassword123!" not in str_str
    assert "******" in repr_str
    assert "******" in str_str


def test_router_config_camel_and_snake_case_population():
    """Verify RouterConfig parses both camelCase and snake_case inputs cleanly."""
    camel_data = {
        "hostname": "branch-gw",
        "wanMode": "static-ipv4",
        "wanIpv4Address": "198.51.100.2",
        "wanPrefix": 29,
        "defaultGateway": "198.51.100.1",
        "lanIpv4Address": "10.0.0.1",
        "lanPrefix": 24,
        "dhcpServerEnabled": True,
        "dhcpPoolStart": "10.0.0.100",
        "dhcpPoolEnd": "10.0.0.200",
        "dnsServers": ["1.1.1.1", "8.8.8.8"],
        "natEnabled": True,
        "vlanId": 120,
    }
    cfg = RouterConfig.model_validate(camel_data)
    assert cfg.hostname == "branch-gw"
    assert cfg.wan_mode == WanMode.STATIC
    assert cfg.wan_ipv4_address == "198.51.100.2"
    assert cfg.wan_prefix == 29
    assert cfg.default_gateway == "198.51.100.1"
    assert cfg.lan_ipv4_address == "10.0.0.1"
    assert cfg.dhcp_server_enabled is True
    assert cfg.vlan_id == 120


# --- 2. IP Configuration Validation ---

def test_router_validation_valid_static_configuration():
    """Verify a consistent static WAN, LAN, DHCP, and DNS configuration passes."""
    cfg = RouterConfig(
        hostname="home-router",
        wan_mode=WanMode.STATIC,
        wan_ipv4_address="203.0.113.10",
        wan_prefix=24,
        default_gateway="203.0.113.1",
        lan_ipv4_address="192.168.10.1",
        lan_prefix=24,
        dhcp_server_enabled=True,
        dhcp_pool_start="192.168.10.20",
        dhcp_pool_end="192.168.10.200",
        dns_servers=["1.1.1.1", "8.8.8.8"],
        nat_enabled=True,
        vlan_id=100,
    )
    issues = validate_router_config(cfg)
    assert issues == []


def test_router_validation_valid_dhcp_and_pppoe_modes():
    """Verify DHCP and PPPoE modes pass without requiring static WAN fields."""
    dhcp_cfg = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
    )
    assert validate_router_config(dhcp_cfg) == []

    pppoe_cfg = RouterConfig(
        wan_mode=WanMode.PPPOE,
        pppoe_username="user1",
        pppoe_password="password",
        lan_ipv4_address="10.10.0.1",
        lan_prefix=24,
    )
    assert validate_router_config(pppoe_cfg) == []


def test_router_validation_invalid_ips_prefixes_and_gateway():
    """Verify syntax checks, prefix bounds, and gateway subnet membership."""
    cfg = RouterConfig(
        hostname="broken-gw",
        wan_mode=WanMode.STATIC,
        wan_ipv4_address="203.0.113.999",  # Invalid IPv4
        wan_prefix=33,                     # Prefix > 32
        default_gateway="198.51.100.1",    # Gateway in different subnet
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
    )
    issues = validate_router_config(cfg)
    fields = [i.field for i in issues]
    assert "wanIpv4Address" in fields
    assert "wanPrefix" in fields
    assert "defaultGateway" in fields


def test_router_validation_gateway_equals_wan_address():
    """Verify gateway matching WAN IP is rejected."""
    cfg = RouterConfig(
        wan_mode=WanMode.STATIC,
        wan_ipv4_address="203.0.113.1",
        wan_prefix=24,
        default_gateway="203.0.113.1",
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
    )
    issues = validate_router_config(cfg)
    gw_issue = next((i for i in issues if i.field == "defaultGateway"), None)
    assert gw_issue is not None
    assert "cannot be the router's WAN address" in gw_issue.message


def test_router_validation_wan_lan_subnet_overlap():
    """Verify overlapping WAN and LAN networks are rejected."""
    cfg = RouterConfig(
        wan_mode=WanMode.STATIC,
        wan_ipv4_address="192.168.10.99",
        wan_prefix=24,
        default_gateway="192.168.10.1",
        lan_ipv4_address="192.168.10.1",
        lan_prefix=24,
    )
    issues = validate_router_config(cfg)
    overlap_issue = next((i for i in issues if i.field == "lanIpv4Address" and "overlap" in i.message), None)
    assert overlap_issue is not None
    assert "must not overlap" in overlap_issue.message


def test_router_validation_dhcp_pool_boundaries_and_router_collision():
    """Verify DHCP pool order, LAN subnet membership, and exclusion of router IP."""
    # End before start
    cfg1 = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
        dhcp_server_enabled=True,
        dhcp_pool_start="192.168.1.100",
        dhcp_pool_end="192.168.1.50",
    )
    issues1 = validate_router_config(cfg1)
    end_issue = next((i for i in issues1 if i.field == "dhcpPoolEnd"), None)
    assert end_issue is not None
    assert "at or after" in end_issue.message

    # Pool includes router's own LAN IP
    cfg2 = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
        dhcp_server_enabled=True,
        dhcp_pool_start="192.168.1.1",
        dhcp_pool_end="192.168.1.50",
    )
    issues2 = validate_router_config(cfg2)
    assert any("exclude the router's LAN address" in i.message for i in issues2)

    # Pool outside LAN subnet
    cfg3 = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
        dhcp_server_enabled=True,
        dhcp_pool_start="192.168.2.10",
        dhcp_pool_end="192.168.2.50",
    )
    issues3 = validate_router_config(cfg3)
    assert any("within the LAN subnet" in i.message for i in issues3)

    # Pool includes network or broadcast address
    cfg4 = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="192.168.1.1",
        lan_prefix=24,
        dhcp_server_enabled=True,
        dhcp_pool_start="192.168.1.0",
        dhcp_pool_end="192.168.1.50",
    )
    issues4 = validate_router_config(cfg4)
    assert any("exclude the LAN network and broadcast addresses" in i.message for i in issues4)


def test_router_validation_vlan_and_dns():
    """Verify VLAN 802.1Q bounds and DNS address format."""
    cfg = RouterConfig(
        wan_mode=WanMode.DHCP,
        lan_ipv4_address="10.0.0.1",
        lan_prefix=24,
        dns_servers=["invalid-dns", "8.8.8.8"],
        vlan_id=4095,
    )
    issues = validate_router_config(cfg)
    fields = [i.field for i in issues]
    assert "dnsServers" in fields
    assert "vlanId" in fields


def test_router_validation_missing_required_fields():
    """Verify empty configuration returns issues for required fields."""
    issues = validate_router_config(RouterConfig())
    fields = [i.field for i in issues]
    assert "wanMode" in fields
    assert "lanIpv4Address" in fields
    assert "lanPrefix" in fields


# --- 3. Topology Rules & Connection Candidate Validation ---

@pytest.fixture
def base_ont_router_project():
    """Fixture with OLT -> ODC -> ODP -> ONT and a standalone ROUTER."""
    loc = PointGeometry(coordinates=(106.8450, -6.2080))
    line = LineGeometry(coordinates=[(106.8450, -6.2080), (106.8460, -6.2080)])
    olt = NetworkNode(id="olt-1", type=NodeType.OLT, name="OLT Main", location=loc)
    odc = NetworkNode(id="odc-1", type=NodeType.ODC, name="ODC Feeder", location=loc)
    odp = NetworkNode(id="odp-1", type=NodeType.ODP, name="ODP Dist", location=loc)
    ont = NetworkNode(id="ont-1", type=NodeType.ONT, name="ONT Premise", location=loc)
    router = NetworkNode(
        id="router-1",
        type=NodeType.ROUTER,
        name="Router Home",
        location=loc,
        properties={
            "routerConfiguration": {
                "hostname": "home-gw",
                "wanMode": "dhcp-client",
                "lanIpv4Address": "192.168.1.1",
                "lanPrefix": 24,
            }
        },
    )
    c_feeder = CableSegment(id="c-feeder", name="Feeder Cable", geometry=line, fiber_count=24)
    c_dist = CableSegment(id="c-dist", name="Distribution Cable", geometry=line, fiber_count=12)
    c_drop = CableSegment(id="c-drop", name="Drop Fiber", geometry=line, fiber_count=2)
    c_eth = CableSegment(id="c-eth", name="Ethernet Copper Patch", geometry=line, medium="copper", cable_type="cat6")

    connections = [
        TopologyConnection(id="conn-1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c-feeder"),
        TopologyConnection(id="conn-2", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c-dist"),
        TopologyConnection(id="conn-3", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c-drop"),
    ]
    return Project(
        id="proj-ont-router",
        name="ONT and Router Project",
        nodes=[olt, odc, odp, ont, router],
        cable_segments=[c_feeder, c_dist, c_drop, c_eth],
        connections=connections,
    )


def test_topology_validation_ont_to_router_is_allowed(base_ont_router_project):
    """Verify ONT -> Router connection candidate is approved as an Ethernet link."""
    from backend.app.domain.models import ConnectionValidationRequest

    req = ConnectionValidationRequest(
        from_node_id="ont-1",
        to_node_id="router-1",
        cable_segment_id="c-eth",
    )
    result = validate_connection_candidate(base_ont_router_project, req)
    assert result.valid is True
    assert result.errors == []
    assert result.summary.get("allowedTransition") is True
    assert result.summary.get("connectionType") == "ethernet"
    assert result.summary.get("medium") == "copper"


def test_topology_validation_prohibits_router_to_optical_or_reverse(base_ont_router_project):
    """Verify routers cannot feed ONTs or connect to optical infrastructure."""
    from backend.app.domain.models import ConnectionValidationRequest

    # Router -> ONT is rejected
    req1 = ConnectionValidationRequest(from_node_id="router-1", to_node_id="ont-1", cable_segment_id="c-eth")
    res1 = validate_connection_candidate(base_ont_router_project, req1)
    assert res1.valid is False
    assert any(e.code == "router_cannot_feed_ont" for e in res1.errors)

    # Router -> OLT is rejected
    req2 = ConnectionValidationRequest(from_node_id="router-1", to_node_id="olt-1", cable_segment_id="c-eth")
    res2 = validate_connection_candidate(base_ont_router_project, req2)
    assert res2.valid is False
    assert any(e.code == "router_invalid_upstream_connection" for e in res2.errors)

    # OLT -> Router is rejected
    req3 = ConnectionValidationRequest(from_node_id="olt-1", to_node_id="router-1", cable_segment_id="c-eth")
    res3 = validate_connection_candidate(base_ont_router_project, req3)
    assert res3.valid is False
    assert any(e.code == "router_invalid_optical_connection" for e in res3.errors)

    # ODP -> Router is rejected
    req4 = ConnectionValidationRequest(from_node_id="odp-1", to_node_id="router-1", cable_segment_id="c-eth")
    res4 = validate_connection_candidate(base_ont_router_project, req4)
    assert res4.valid is False
    assert any(e.code == "router_invalid_optical_connection" for e in res4.errors)


def test_topology_validation_prohibits_multiple_router_incoming_feeds(base_ont_router_project):
    """Verify a router cannot accept multiple incoming feeds."""
    from backend.app.domain.models import ConnectionValidationRequest

    # Add first feed
    conn_eth = TopologyConnection(id="conn-eth-1", from_node_id="ont-1", to_node_id="router-1", cable_segment_id="c-eth")
    base_ont_router_project.connections.append(conn_eth)

    # Attempt second feed into same router
    loc = PointGeometry(coordinates=(106.8450, -6.2080))
    second_ont = NetworkNode(id="ont-2", type=NodeType.ONT, name="ONT Second", location=loc)
    base_ont_router_project.nodes.append(second_ont)

    req = ConnectionValidationRequest(from_node_id="ont-2", to_node_id="router-1", cable_segment_id="c-eth")
    result = validate_connection_candidate(base_ont_router_project, req)
    assert result.valid is False
    assert any(e.code == "router_multiple_wan_feeds" for e in result.errors)


def test_project_topology_validation_validates_connected_project(base_ont_router_project):
    """Verify full project topology passes when ONT -> Router is connected."""
    conn_eth = TopologyConnection(id="conn-eth", from_node_id="ont-1", to_node_id="router-1", cable_segment_id="c-eth")
    base_ont_router_project.connections.append(conn_eth)

    res = validate_project_topology(base_ont_router_project)
    assert res.valid is True
    assert res.errors == []
    assert res.summary.get("routerCount") == 1


# --- 4. Persistence Round-Trip with Router ---

def test_project_persistence_round_trip_with_router(db_session, base_ont_router_project):
    """Verify saving and retrieving a project with a Router node and properties intact."""
    conn_eth = TopologyConnection(id="conn-eth", from_node_id="ont-1", to_node_id="router-1", cable_segment_id="c-eth")
    base_ont_router_project.connections.append(conn_eth)

    repo = ProjectRepository(db_session)
    saved = repo.save(base_ont_router_project)
    assert saved.id == base_ont_router_project.id

    retrieved = repo.get(base_ont_router_project.id)
    assert retrieved is not None
    router_node = next((n for n in retrieved.nodes if n.type == NodeType.ROUTER), None)
    assert router_node is not None
    assert router_node.name == "Router Home"

    cfg = extract_router_config(router_node)
    assert cfg is not None
    assert cfg.hostname == "home-gw"
    assert cfg.wan_mode == WanMode.DHCP
    assert cfg.lan_ipv4_address == "192.168.1.1"


# --- 5. RAB Construction Cost Calculation ---

def test_rab_cost_calculation_standalone_routers_and_copper_cable():
    """Verify RTR-SUPPLY and RTR-INSTALL items, and exclusion of copper cable from fiber pulling."""
    loc = PointGeometry(coordinates=(106.8450, -6.2080))
    p1 = (106.8450, -6.2080)
    p2 = (106.8460, -6.2080)
    line = LineGeometry(coordinates=[p1, p2])

    olt = NetworkNode(id="n-olt", type=NodeType.OLT, name="OLT", location=loc)
    ont = NetworkNode(id="n-ont", type=NodeType.ONT, name="ONT", location=loc)
    router1 = NetworkNode(id="n-rtr1", type=NodeType.ROUTER, name="Router 1", location=loc)
    router2 = NetworkNode(id="n-rtr2", type=NodeType.ROUTER, name="Router 2", location=loc)

    c_fiber = CableSegment(id="c-fib", name="Fiber Cable", geometry=line, length_m=100.0, medium="fiber")
    c_copper = CableSegment(id="c-cop", name="Cat6 Patch", geometry=line, length_m=20.0, medium="copper")

    cust = Customer(id="c-1", name="Alice", location=loc, status=CustomerStatus.CONNECTED, ont_node_id="n-ont")

    config = ConstructionCostConfig(
        cable_slack_percent=10.0,
        cable_unit_cost_per_meter=5000.0,
        cable_installation_cost_per_meter=7500.0,
        olt_unit_cost=10000000.0,
        olt_installation_cost=1000000.0,
        ont_unit_cost=250000.0,
        ont_installation_cost=100000.0,
        router_unit_cost=300000.0,
        router_installation_cost=50000.0,
    )

    project = Project(
        id="proj-cost-router",
        name="Cost Router Test",
        nodes=[olt, ont, router1, router2],
        customers=[cust],
        cable_segments=[c_fiber, c_copper],
        connections=[],
        settings=ProjectSettings(construction_cost=config),
    )

    res = calculate_construction_cost(project)

    # 1. Copper cable (20m) excluded from fiber route length
    # Fiber length = 100m * 1.1 = 110m billed
    cbl_item = next(i for i in res.items if i.code == "CBL-SUPPLY")
    assert cbl_item.quantity == 110.0

    # 2. Router items generated for 2 standalone routers
    rtr_mat = next((i for i in res.items if i.code == "RTR-SUPPLY"), None)
    rtr_inst = next((i for i in res.items if i.code == "RTR-INSTALL"), None)
    assert rtr_mat is not None
    assert rtr_mat.quantity == 2.0
    assert rtr_mat.unit_cost == 300000.0
    assert rtr_mat.amount == 600000.0
    assert rtr_mat.category == "material"

    assert rtr_inst is not None
    assert rtr_inst.quantity == 2.0
    assert rtr_inst.unit_cost == 50000.0
    assert rtr_inst.amount == 100000.0
    assert rtr_inst.category == "installation"

    # 3. Arithmetic consistency
    assert res.material_subtotal == round(sum(i.amount for i in res.items if i.category == "material"), 2)
    assert res.installation_subtotal == round(sum(i.amount for i in res.items if i.category == "installation"), 2)
    assert res.grand_total == round(res.material_subtotal + res.installation_subtotal, 2)
    assert res.total_amount == res.grand_total
    assert res.summary.get("routerCount") == 2


def test_rab_cost_calculation_integrated_router_ont_avoids_double_counting():
    """Verify integrated router ONTs do not generate separate router line items."""
    loc = PointGeometry(coordinates=(106.8450, -6.2080))
    line = LineGeometry(coordinates=[(106.8450, -6.2080), (106.8460, -6.2080)])

    # 1 standalone router and 1 integrated router ONT
    ont_integrated = NetworkNode(
        id="n-ont-int",
        type=NodeType.ONT,
        name="ONT with Built-in Wi-Fi Gateway",
        location=loc,
        properties={"integratedRouter": True},
    )
    router_standalone = NetworkNode(
        id="n-rtr-std",
        type=NodeType.ROUTER,
        name="Standalone Router",
        location=loc,
    )

    project = Project(
        id="proj-cost-integrated",
        name="Integrated Router Test",
        nodes=[ont_integrated, router_standalone],
        cable_segments=[CableSegment(id="c1", name="C", geometry=line, length_m=10.0)],
        connections=[],
        settings=ProjectSettings(
            construction_cost=ConstructionCostConfig(
                router_unit_cost=300000.0,
                router_installation_cost=50000.0,
            )
        ),
    )

    res = calculate_construction_cost(project)

    # Exactly 1 router billed (the standalone one)
    rtr_mat = next((i for i in res.items if i.code == "RTR-SUPPLY"), None)
    assert rtr_mat is not None
    assert rtr_mat.quantity == 1.0

    assert res.summary.get("routerCount") == 1
    assert res.summary.get("integratedRouterCount") == 1


def test_legacy_cost_config_without_router_rates_does_not_fabricate_prices():
    """Old project settings remain valid and do not receive guessed router rates."""
    location = PointGeometry(coordinates=(106.8450, -6.2080))
    router = NetworkNode(
        id="legacy-router", type=NodeType.ROUTER, name="Router",
        location=location,
    )
    legacy_config = ConstructionCostConfig.model_validate({"currency": "IDR"})
    assert legacy_config.router_unit_cost is None
    assert legacy_config.router_installation_cost is None

    project = Project(
        id="legacy-cost", name="Legacy project", nodes=[router],
        settings=ProjectSettings(construction_cost=legacy_config),
    )
    result = calculate_construction_cost(project)

    assert not any(item.code in {"RTR-SUPPLY", "RTR-INSTALL"} for item in result.items)


# --- 6. Optical Budget Independence ---

def test_optical_budget_completely_isolated_from_router(base_ont_router_project):
    """Verify that adding a router and Ethernet link leaves optical paths and loss unchanged."""
    # 1. Optical budget before adding router connection
    budget_before = calculate_optical_budget(base_ont_router_project)
    path_before = budget_before.paths[0]
    assert path_before.ont_node_id == "ont-1"
    assert path_before.status in ("pass", "fail")

    # 2. Add Ethernet connection ONT -> Router
    conn_eth = TopologyConnection(
        id="conn-eth",
        from_node_id="ont-1",
        to_node_id="router-1",
        cable_segment_id="c-eth",
        medium="copper",
        connection_type="ethernet",
    )
    base_ont_router_project.connections.append(conn_eth)

    # 3. Optical budget after adding router connection
    budget_after = calculate_optical_budget(base_ont_router_project)
    path_after = budget_after.paths[0]

    # Verify path is completely identical
    assert len(budget_after.paths) == len(budget_before.paths)
    assert path_after.loss_db == path_before.loss_db
    assert path_after.received_power_dbm == path_before.received_power_dbm
    assert path_after.length_m == path_before.length_m
    assert path_after.connection_ids == path_before.connection_ids
    assert "conn-eth" not in path_after.connection_ids
    assert "router-1" not in path_after.node_ids

    # Verify copper link is marked as unknown status in link diagnostics
    eth_link_res = next((l for l in budget_after.links if l.connection_id == "conn-eth"), None)
    assert eth_link_res is not None
    assert eth_link_res.status == "unknown"


# --- 7. FastAPI Endpoint Verification ---

@pytest.mark.anyio
async def test_api_validate_router_config_endpoint():
    """Verify POST /api/v1/validate-router-config."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        # Valid payload
        valid_payload = {
            "hostname": "home-gw",
            "wanMode": "static-ipv4",
            "wanIpv4Address": "203.0.113.10",
            "wanPrefix": 24,
            "defaultGateway": "203.0.113.1",
            "lanIpv4Address": "192.168.1.1",
            "lanPrefix": 24,
            "dhcpServerEnabled": True,
            "dhcpPoolStart": "192.168.1.10",
            "dhcpPoolEnd": "192.168.1.100",
            "dnsServers": ["8.8.8.8"],
            "natEnabled": True,
            "vlanId": 100,
        }
        res_valid = await client.post("/api/v1/validate-router-config", json=valid_payload)
        assert res_valid.status_code == 200
        data_valid = res_valid.json()
        assert data_valid["valid"] is True
        assert data_valid["issues"] == []

        # Invalid payload (WAN/LAN overlap)
        invalid_payload = {
            "wanMode": "static-ipv4",
            "wanIpv4Address": "192.168.1.10",
            "wanPrefix": 24,
            "defaultGateway": "192.168.1.1",
            "lanIpv4Address": "192.168.1.1",
            "lanPrefix": 24,
        }
        res_invalid = await client.post("/api/v1/validate-router-config", json=invalid_payload)
        assert res_invalid.status_code == 200
        data_invalid = res_invalid.json()
        assert data_invalid["valid"] is False
        assert any(i["field"] == "lanIpv4Address" for i in data_invalid["issues"])
