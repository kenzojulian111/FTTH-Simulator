"""Network topology and project validation rules.

Implements authoritative GPON FTTH topology validation policy:
- Validates cross-entity references (nodes, cables, customer ONT links).
- Enforces device role compatibility and optical flow direction:
    OLT -> ODC, ODP, SPLITTER, ONT (Root transmitter)
    ODC -> ODC, ODP, SPLITTER, ONT (Distribution cabinet / 1st stage splitter)
    ODP -> ODP, SPLITTER, ONT (Distribution closure / 2nd stage splitter)
    SPLITTER -> ODC, ODP, SPLITTER, ONT (Standalone or cascaded splitter)
    ONT -> leaf subscriber device, no downstream optical connections
    POLE -> civil infrastructure, cannot host logical optical connections
    CUSTOMER -> subscriber record, linked via ontNodeId, not fiber connections
- Detects prohibited cycles and loops.
- Enforces device port and cable fiber capacities only when explicitly configured.
- Supports single-connection pre-validation for frontend connection dialogs.
"""

from collections import deque
import ipaddress
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.app.domain.models import (
    ConnectionValidationRequest,
    ErrorDetail,
    NetworkNode,
    NodeType,
    Project,
    RouterConfig,
    RouterConfigIssue,
    TopologyConnection,
    TopologyIssue,
    TopologyValidationResult,
    WanMode,
)
from backend.app.engine.geo import calculate_route_length, distance_meters, has_zero_length_route


class TopologyValidationError(Exception):
    """Exception raised when project or topology semantic validation fails."""
    def __init__(self, message: str, details: List[ErrorDetail]):
        super().__init__(message)
        self.message = message
        self.details = details


# Allowed directed optical transitions in GPON: from_type -> set of allowed to_types
ALLOWED_OPTICAL_TRANSITIONS: Dict[NodeType, Set[NodeType]] = {
    NodeType.OLT: {NodeType.ODC, NodeType.ODP, NodeType.SPLITTER, NodeType.ONT},
    NodeType.ODC: {NodeType.ODC, NodeType.ODP, NodeType.SPLITTER, NodeType.ONT},
    NodeType.ODP: {NodeType.ODP, NodeType.SPLITTER, NodeType.ONT},
    NodeType.SPLITTER: {NodeType.ODC, NodeType.ODP, NodeType.SPLITTER, NodeType.ONT},
    NodeType.ONT: set(),
    NodeType.POLE: set(),
    NodeType.ROUTER: set(),
    NodeType.CUSTOMER: set(),
}


def extract_router_config(node: NetworkNode) -> Optional[RouterConfig]:
    """Extract RouterConfig from node properties if present."""
    for key in ("routerConfiguration", "router_configuration", "routerConfig", "router_config"):
        val = node.properties.get(key)
        if isinstance(val, dict) and val:
            try:
                return RouterConfig.model_validate(val)
            except Exception:
                pass

    if node.type == NodeType.ROUTER:
        router_keys = {
            "hostname", "wanMode", "wan_mode", "wanIpv4Address", "wan_ipv4_address",
            "wanIp", "wan_ip", "wanPrefix", "wan_prefix", "defaultGateway", "default_gateway",
            "lanIpv4Address", "lan_ipv4_address", "lanIp", "lan_ip", "lanPrefix", "lan_prefix",
            "dhcpServerEnabled", "dhcp_server_enabled", "dhcpPoolStart", "dhcp_pool_start",
            "dhcpPoolEnd", "dhcp_pool_end", "dnsServers", "dns_servers", "natEnabled", "nat_enabled",
            "vlanId", "vlan_id", "pppoeUsername", "pppoePassword",
        }
        present_keys = router_keys.intersection(node.properties.keys())
        if present_keys:
            try:
                return RouterConfig.model_validate(node.properties)
            except Exception:
                pass

    return None


def _parse_ipv4(val: Optional[str]) -> Optional[ipaddress.IPv4Address]:
    """Parse a strictly formatted IPv4 dotted-quad address string."""
    if not val or not isinstance(val, str):
        return None
    val = val.strip()
    parts = val.split(".")
    if len(parts) != 4:
        return None
    for p in parts:
        if not p.isdigit() or (len(p) > 1 and p.startswith("0")):
            return None
        num = int(p)
        if not (0 <= num <= 255):
            return None
    try:
        return ipaddress.IPv4Address(val)
    except ValueError:
        return None


def validate_router_config(
    config: RouterConfig,
    node_id: Optional[str] = None,
    node_name: Optional[str] = None,
) -> List[RouterConfigIssue]:
    """Validate router IP configuration according to IPv4, subnet, and DHCP rules."""
    issues: List[RouterConfigIssue] = []

    def add(field: str, message: str, code: str) -> None:
        issues.append(RouterConfigIssue(field=field, message=message, code=code, severity="error"))

    # 1. WAN mode
    if not config.wan_mode:
        add("wanMode", "Choose a WAN addressing mode.", "missing_wan_mode")

    # 2. Static WAN configuration
    wan_ip: Optional[ipaddress.IPv4Address] = None
    if config.wan_mode == WanMode.STATIC or str(config.wan_mode) in ("static-ipv4", "static"):
        wan_ip = _parse_ipv4(config.wan_ipv4_address)
        if wan_ip is None:
            add("wanIpv4Address", "Enter a valid static WAN IPv4 address.", "invalid_wan_ip")

        if config.wan_prefix is None or not isinstance(config.wan_prefix, int) or not (0 <= config.wan_prefix <= 32):
            add("wanPrefix", "Enter a prefix from 0 to 32.", "invalid_wan_prefix")

        gateway = _parse_ipv4(config.default_gateway)
        if gateway is None:
            add("defaultGateway", "Enter a valid IPv4 default gateway.", "invalid_default_gateway")

        if gateway is not None:
            if (
                wan_ip is not None
                and config.wan_prefix is not None
                and isinstance(config.wan_prefix, int)
                and (0 <= config.wan_prefix <= 32)
            ):
                if wan_ip == gateway:
                    add("defaultGateway", "The gateway cannot be the router's WAN address.", "gateway_equals_wan_ip")
                else:
                    wan_net = ipaddress.IPv4Network(f"{wan_ip}/{config.wan_prefix}", strict=False)
                    if gateway not in wan_net:
                        add("defaultGateway", "The gateway must be in the WAN address subnet.", "gateway_outside_wan_subnet")
            else:
                add("defaultGateway", "The gateway must be in the WAN address subnet.", "gateway_outside_wan_subnet")

    # 3. LAN configuration
    lan_ip = _parse_ipv4(config.lan_ipv4_address)
    if lan_ip is None:
        add("lanIpv4Address", "Enter a valid LAN IPv4 address.", "invalid_lan_ip")

    if config.lan_prefix is None or not isinstance(config.lan_prefix, int) or not (0 <= config.lan_prefix <= 32):
        add("lanPrefix", "Enter a LAN prefix from 0 to 32.", "invalid_lan_prefix")

    lan_net: Optional[ipaddress.IPv4Network] = None
    if (
        lan_ip is not None
        and config.lan_prefix is not None
        and isinstance(config.lan_prefix, int)
        and (0 <= config.lan_prefix <= 32)
    ):
        lan_net = ipaddress.IPv4Network(f"{lan_ip}/{config.lan_prefix}", strict=False)
        if config.lan_prefix <= 30:
            if lan_ip == lan_net.network_address or lan_ip == lan_net.broadcast_address:
                add("lanIpv4Address", "The router's LAN address must not be the network or broadcast address.", "lan_ip_is_network_or_broadcast")

    # 4. Overlap between WAN and LAN subnets
    if (config.wan_mode == WanMode.STATIC or str(config.wan_mode) in ("static-ipv4", "static")) and wan_ip is not None:
        if lan_ip is not None and wan_ip == lan_ip:
            add("lanIpv4Address", "LAN and WAN addresses must be different.", "wan_lan_same_ip")
        if (
            lan_net is not None
            and config.wan_prefix is not None
            and isinstance(config.wan_prefix, int)
            and (0 <= config.wan_prefix <= 32)
        ):
            wan_net = ipaddress.IPv4Network(f"{wan_ip}/{config.wan_prefix}", strict=False)
            if wan_net.overlaps(lan_net):
                add("lanIpv4Address", "LAN and WAN subnets must not overlap.", "wan_lan_subnet_overlap")

    # 5. DHCP server pool
    if config.dhcp_server_enabled:
        start_ip = _parse_ipv4(config.dhcp_pool_start)
        end_ip = _parse_ipv4(config.dhcp_pool_end)

        if start_ip is None:
            add("dhcpPoolStart", "Enter a valid DHCP pool start IPv4 address.", "invalid_dhcp_start")
        if end_ip is None:
            add("dhcpPoolEnd", "Enter a valid DHCP pool end IPv4 address.", "invalid_dhcp_end")

        if start_ip is not None and end_ip is not None and int(start_ip) > int(end_ip):
            add("dhcpPoolEnd", "The DHCP pool end must be at or after its start.", "dhcp_pool_end_before_start")

        if start_ip is not None and end_ip is not None and lan_net is not None and lan_ip is not None:
            if start_ip not in lan_net:
                add("dhcpPoolStart", "The DHCP pool must be within the LAN subnet.", "dhcp_start_outside_lan")
            if end_ip not in lan_net:
                add("dhcpPoolEnd", "The DHCP pool must be within the LAN subnet.", "dhcp_end_outside_lan")

            min_val = min(int(start_ip), int(end_ip))
            max_val = max(int(start_ip), int(end_ip))
            if min_val <= int(lan_ip) <= max_val:
                add("dhcpPoolStart", "The DHCP pool must exclude the router's LAN address.", "dhcp_pool_contains_router_ip")

            if config.lan_prefix is not None and config.lan_prefix <= 30:
                if min_val <= int(lan_net.network_address) or max_val >= int(lan_net.broadcast_address):
                    add("dhcpPoolStart", "The DHCP pool must exclude the LAN network and broadcast addresses.", "dhcp_pool_contains_network_or_broadcast")

    # 6. DNS servers
    if config.dns_servers:
        for idx, server in enumerate(config.dns_servers):
            if server and isinstance(server, str) and server.strip():
                s_addr = _parse_ipv4(server.strip())
                if s_addr is None:
                    add("dnsServers", f"DNS server {idx + 1} is not a valid IPv4 address.", "invalid_dns_server")
                elif str(s_addr) in ("0.0.0.0", "255.255.255.255"):
                    add("dnsServers", f"DNS server {idx + 1} must be a usable unicast IPv4 address.", "invalid_dns_unicast")

    # 7. VLAN ID
    if config.vlan_id is not None:
        if not isinstance(config.vlan_id, int) or not (1 <= config.vlan_id <= 4094):
            add("vlanId", "VLAN ID must be between 1 and 4094.", "invalid_vlan_id")

    return issues


def _extract_splitter_capacity(node: NetworkNode) -> Optional[int]:
    """Extract output port capacity from splitter properties if explicitly configured."""
    for key in ("capacity", "maxOutputs", "maxPorts", "outputPorts"):
        val = node.properties.get(key)
        if val is not None:
            try:
                parsed = int(val)
                if parsed > 0:
                    return parsed
            except (ValueError, TypeError):
                pass

    ratio = str(node.properties.get("splitterRatio", "")).strip()
    if ":" in ratio:
        parts = ratio.split(":")
        if len(parts) == 2 and parts[1].isdigit():
            return int(parts[1])

    return None


def _extract_device_port_capacity(node: NetworkNode) -> Optional[int]:
    """Extract port capacity from node properties if explicitly configured."""
    for key in ("capacity", "maxPorts", "maxOutputs"):
        val = node.properties.get(key)
        if val is not None:
            try:
                parsed = int(val)
                if parsed > 0:
                    return parsed
            except (ValueError, TypeError):
                pass
    return None


def _detect_cycle_if_added(
    connections: List[TopologyConnection],
    from_id: str,
    to_id: str,
    exclude_connection_id: Optional[str] = None,
) -> bool:
    """Check if adding directed edge from_id -> to_id introduces a cycle in connections."""
    if from_id == to_id:
        return True

    adj: Dict[str, List[str]] = {}
    for conn in connections:
        if exclude_connection_id and conn.id == exclude_connection_id:
            continue
        adj.setdefault(conn.from_node_id, []).append(conn.to_node_id)

    queue = deque([to_id])
    visited = {to_id}
    while queue:
        curr = queue.popleft()
        if curr == from_id:
            return True
        for nxt in adj.get(curr, []):
            if nxt not in visited:
                visited.add(nxt)
                queue.append(nxt)
    return False


def _find_all_cycles(
    nodes_by_id: Dict[str, NetworkNode], connections: List[TopologyConnection]
) -> List[List[str]]:
    """Detect all directed cycles in the connection graph using 3-color DFS."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in nodes_by_id}
    adj: Dict[str, List[str]] = {}
    for conn in connections:
        adj.setdefault(conn.from_node_id, []).append(conn.to_node_id)

    cycles: List[List[str]] = []

    def dfs(node: str, path: List[str]) -> None:
        color[node] = GRAY
        path.append(node)
        for neighbor in adj.get(node, []):
            if neighbor not in color:
                continue
            if color[neighbor] == GRAY:
                cycle_start = path.index(neighbor)
                cycles.append(list(path[cycle_start:] + [neighbor]))
            elif color[neighbor] == WHITE:
                dfs(neighbor, path)
        path.pop()
        color[node] = BLACK

    for nid in list(nodes_by_id.keys()):
        if color.get(nid) == WHITE:
            dfs(nid, [])

    return cycles


def validate_connection_candidate(
    project: Project, request: ConnectionValidationRequest
) -> TopologyValidationResult:
    """Validate a single proposed connection against project topology rules."""
    errors: List[TopologyIssue] = []
    warnings: List[TopologyIssue] = []
    summary: Dict[str, Any] = {}

    nodes_by_id = {node.id: node for node in project.nodes}
    cables_by_id = {cable.id: cable for cable in project.cable_segments}

    from_node = nodes_by_id.get(request.from_node_id)
    to_node = nodes_by_id.get(request.to_node_id)
    cable = cables_by_id.get(request.cable_segment_id)

    # 1. Reference Checks
    if not from_node:
        errors.append(
            TopologyIssue(
                code="missing_from_node",
                policy_code="invalid-reference",
                message=f"Referenced fromNodeId '{request.from_node_id}' does not exist in project nodes",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
    if not to_node:
        errors.append(
            TopologyIssue(
                code="missing_to_node",
                policy_code="invalid-reference",
                message=f"Referenced toNodeId '{request.to_node_id}' does not exist in project nodes",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
    if not cable:
        errors.append(
            TopologyIssue(
                code="missing_cable_segment",
                policy_code="invalid-reference",
                message=f"Referenced cableSegmentId '{request.cable_segment_id}' does not exist in project cable segments",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )

    if errors:
        return TopologyValidationResult(valid=False, errors=errors, warnings=warnings, summary=summary)

    if has_zero_length_route(cable.geometry.coordinates):
        errors.append(TopologyIssue(
            code="zero_length_cable_route",
            policy_code="zero-length-route",
            message=f"Cable '{cable.name}' has zero geographic route length; provide at least one non-zero route segment.",
            severity="error",
            from_node_id=request.from_node_id,
            to_node_id=request.to_node_id,
            cable_segment_id=cable.id,
            connection_id=request.connection_id,
        ))

    summary["fromNodeType"] = from_node.type.value
    summary["fromNodeName"] = from_node.name
    summary["toNodeType"] = to_node.type.value
    summary["toNodeName"] = to_node.name
    summary["cableName"] = cable.name
    cable_length = cable.length_m if cable.length_m is not None else round(calculate_route_length(cable.geometry.coordinates), 2)
    summary["cableLengthM"] = cable_length
    summary["cableVertexCount"] = len(cable.geometry.coordinates)

    # 1b. Cable Endpoint Alignment Check (if cable explicitly specifies endpoint nodes)
    if cable.start_node_id and cable.end_node_id:
        if {request.from_node_id, request.to_node_id} != {cable.start_node_id, cable.end_node_id}:
            errors.append(
                TopologyIssue(
                    code="cable_endpoint_mismatch",
                    policy_code="invalid-reference",
                    message=(
                        f"Cable segment '{cable.name}' has defined endpoints '{cable.start_node_id}' and '{cable.end_node_id}', "
                        f"which does not match proposed connection endpoints '{request.from_node_id}' and '{request.to_node_id}'"
                    ),
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )
            return TopologyValidationResult(valid=False, errors=errors, warnings=warnings, summary=summary)

    # 2. Self-loop check
    if request.from_node_id == request.to_node_id:
        errors.append(
            TopologyIssue(
                code="self_loop",
                policy_code="same-device",
                message=f"Self-link detected: connection connects node '{from_node.name}' to itself",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        return TopologyValidationResult(valid=False, errors=errors, warnings=warnings, summary=summary)

    # 3. Device Role & Compatibility Checks
    if from_node.type == NodeType.POLE or to_node.type == NodeType.POLE:
        pole_name = from_node.name if from_node.type == NodeType.POLE else to_node.name
        errors.append(
            TopologyIssue(
                code="pole_not_optical_device",
                policy_code="incompatible-types",
                message=f"Pole '{pole_name}' is physical support infrastructure and cannot host logical optical connections",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        summary["allowedTransition"] = False
        return TopologyValidationResult(valid=False, errors=errors, warnings=warnings, summary=summary)

    if from_node.type == NodeType.CUSTOMER or to_node.type == NodeType.CUSTOMER:
        cust_name = from_node.name if from_node.type == NodeType.CUSTOMER else to_node.name
        errors.append(
            TopologyIssue(
                code="customer_not_optical_node",
                policy_code="incompatible-types",
                message=f"Customer '{cust_name}' is a subscriber record; link via ontNodeId rather than a cable connection",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        summary["allowedTransition"] = False
        return TopologyValidationResult(valid=False, errors=errors, warnings=warnings, summary=summary)

    is_ethernet_link = (from_node.type == NodeType.ONT and to_node.type == NodeType.ROUTER)

    if from_node.type == NodeType.ONT:
        if not is_ethernet_link:
            errors.append(
                TopologyIssue(
                    code="ont_cannot_have_downstream_connections",
                    policy_code="incompatible-types",
                    message=f"ONT '{from_node.name}' is a terminal subscriber device and cannot have downstream optical connections",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )
            summary["allowedTransition"] = False

    if from_node.type == NodeType.ROUTER:
        if to_node.type == NodeType.ONT:
            errors.append(
                TopologyIssue(
                    code="router_cannot_feed_ont",
                    policy_code="incompatible-types",
                    message=f"Router '{from_node.name}' cannot feed back into ONT '{to_node.name}'. Customer connections flow from ONT to Router",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )
        elif to_node.type in (NodeType.OLT, NodeType.ODC, NodeType.ODP, NodeType.SPLITTER):
            errors.append(
                TopologyIssue(
                    code="router_invalid_upstream_connection",
                    policy_code="incompatible-types",
                    message=f"Router '{from_node.name}' cannot connect to optical infrastructure node '{to_node.name}'",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )
        else:
            errors.append(
                TopologyIssue(
                    code="router_invalid_downstream_connection",
                    policy_code="incompatible-types",
                    message=f"Router '{from_node.name}' does not support connection to '{to_node.type.value.upper()}' ({to_node.name})",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )
        summary["allowedTransition"] = False

    if to_node.type == NodeType.ROUTER and from_node.type != NodeType.ONT:
        errors.append(
            TopologyIssue(
                code="router_invalid_optical_connection",
                policy_code="incompatible-types",
                message=f"Optical node '{from_node.name}' cannot connect directly to Router '{to_node.name}'. Routers must connect to an ONT",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        summary["allowedTransition"] = False

    if to_node.type == NodeType.OLT:
        errors.append(
            TopologyIssue(
                code="olt_cannot_have_upstream_feed",
                policy_code="incompatible-types",
                message=f"OLT '{to_node.name}' is a root optical transmitter and cannot accept an upstream optical input",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        summary["allowedTransition"] = False

    if is_ethernet_link:
        summary["allowedTransition"] = True
        summary["connectionType"] = "ethernet"
        summary["medium"] = "copper"
    else:
        allowed_targets = ALLOWED_OPTICAL_TRANSITIONS.get(from_node.type, set())
        if to_node.type not in allowed_targets:
            if not any(
                e.code in (
                    "ont_cannot_have_downstream_connections",
                    "olt_cannot_have_upstream_feed",
                    "router_cannot_feed_ont",
                    "router_invalid_upstream_connection",
                    "router_invalid_downstream_connection",
                    "router_invalid_optical_connection",
                )
                for e in errors
            ):
                errors.append(
                    TopologyIssue(
                        code="invalid_connection_direction",
                        policy_code="incompatible-types",
                        message=f"Invalid GPON optical flow: cannot connect '{from_node.type.value.upper()}' ({from_node.name}) to '{to_node.type.value.upper()}' ({to_node.name})",
                        severity="error",
                        from_node_id=request.from_node_id,
                        to_node_id=request.to_node_id,
                        cable_segment_id=request.cable_segment_id,
                        connection_id=request.connection_id,
                    )
                )
            summary["allowedTransition"] = False
        else:
            summary["allowedTransition"] = True

    # 4. Duplicate Check
    other_connections = [c for c in project.connections if not (request.connection_id and c.id == request.connection_id)]
    for conn in other_connections:
        if (
            conn.from_node_id == request.from_node_id
            and conn.to_node_id == request.to_node_id
            and conn.cable_segment_id == request.cable_segment_id
        ):
            errors.append(
                TopologyIssue(
                    code="duplicate_connection",
                    policy_code="duplicate-link",
                    message=f"Duplicate connection: an identical connection already exists between '{from_node.name}' and '{to_node.name}' using cable '{cable.name}'",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=conn.id,
                )
            )

    # 5. Cycle Detection
    if _detect_cycle_if_added(other_connections, request.from_node_id, request.to_node_id, request.connection_id):
        errors.append(
            TopologyIssue(
                code="prohibited_cycle",
                policy_code="prohibited-cycle",
                message=f"Circular optical dependency detected: connection from '{from_node.name}' to '{to_node.name}' would create a loop in optical topology",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )
        summary["createsCycle"] = True
    else:
        summary["createsCycle"] = False

    # 6. ONT Single Upstream Feed Check
    if to_node.type == NodeType.ONT:
        existing_incoming = [c for c in other_connections if c.to_node_id == to_node.id]
        if existing_incoming:
            existing_source = nodes_by_id.get(existing_incoming[0].from_node_id)
            source_label = existing_source.name if existing_source else existing_incoming[0].from_node_id
            errors.append(
                TopologyIssue(
                    code="ont_multiple_inputs",
                    policy_code="incompatible-types",
                    message=f"ONT '{to_node.name}' already has an incoming optical feed from '{source_label}'. An ONT supports only one upstream connection",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )

    # Passive optical distribution devices have one upstream feed in the
    # supported GPON tree model. Allowing multiple parents can merge distinct
    # OLT sources at a splitter/ODC/ODP and makes the optical path ambiguous.
    if not is_ethernet_link and to_node.type in (NodeType.ODC, NodeType.ODP, NodeType.SPLITTER):
        existing_incoming = [c for c in other_connections if c.to_node_id == to_node.id]
        if existing_incoming:
            sources = [nodes_by_id.get(c.from_node_id) for c in existing_incoming]
            source_labels = ", ".join(source.name if source else c.from_node_id for source, c in zip(sources, existing_incoming))
            errors.append(
                TopologyIssue(
                    code="passive_node_multiple_inputs",
                    policy_code="incompatible-types",
                    message=f"Passive optical node '{to_node.name}' already has an upstream feed from {source_labels}. A GPON distribution tree supports one upstream feed per passive node.",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )

    # 6b. Router Single Upstream Feed Check
    if to_node.type == NodeType.ROUTER:
        existing_incoming = [c for c in other_connections if c.to_node_id == to_node.id]
        if existing_incoming:
            existing_source = nodes_by_id.get(existing_incoming[0].from_node_id)
            source_label = existing_source.name if existing_source else existing_incoming[0].from_node_id
            errors.append(
                TopologyIssue(
                    code="router_multiple_wan_feeds",
                    policy_code="incompatible-types",
                    message=f"Router '{to_node.name}' already has an incoming connection from '{source_label}'. A customer router supports only one upstream ONT feed",
                    severity="error",
                    from_node_id=request.from_node_id,
                    to_node_id=request.to_node_id,
                    cable_segment_id=request.cable_segment_id,
                    connection_id=request.connection_id,
                )
            )

    # 7. Cable Capacity Check
    cables_used = sum(1 for c in other_connections if c.cable_segment_id == cable.id)
    summary["cableFiberCount"] = cable.fiber_count if cable.fiber_count is not None else "unconfigured"
    summary["cableFibersUsed"] = cables_used + 1
    if cable.fiber_count is not None and (cables_used + 1) > cable.fiber_count:
        errors.append(
            TopologyIssue(
                code="cable_capacity_exceeded",
                policy_code="capacity-exceeded",
                message=f"Cable segment '{cable.name}' has fiberCount={cable.fiber_count}, which is already fully allocated ({cables_used} in use)",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )

    # 8. Splitter / Device Output Port Capacity Check
    splitter_cap = _extract_splitter_capacity(from_node)
    device_cap = _extract_device_port_capacity(from_node)
    effective_cap = splitter_cap or device_cap

    from_node_used = sum(1 for c in other_connections if c.from_node_id == from_node.id)
    summary["fromNodeCapacity"] = effective_cap if effective_cap is not None else "unconfigured"
    summary["fromNodePortsUsed"] = from_node_used + 1

    if effective_cap is not None and (from_node_used + 1) > effective_cap:
        code = (
            "splitter_capacity_exceeded"
            if (from_node.type == NodeType.SPLITTER or splitter_cap is not None)
            else "device_capacity_exceeded"
        )
        label = "Splitter" if code == "splitter_capacity_exceeded" else "Device"
        errors.append(
            TopologyIssue(
                code=code,
                policy_code="capacity-exceeded",
                message=f"{label} '{from_node.name}' has configured capacity of {effective_cap} output ports, which is exceeded ({from_node_used} already connected)",
                severity="error",
                from_node_id=request.from_node_id,
                to_node_id=request.to_node_id,
                cable_segment_id=request.cable_segment_id,
                connection_id=request.connection_id,
            )
        )

    valid = len(errors) == 0
    return TopologyValidationResult(valid=valid, errors=errors, warnings=warnings, summary=summary)


def validate_project_topology(project: Project) -> TopologyValidationResult:
    """Validate all topology connections and structural rules across the full project."""
    errors: List[TopologyIssue] = []
    warnings: List[TopologyIssue] = []

    nodes_by_id = {node.id: node for node in project.nodes}
    cables_by_id = {cable.id: cable for cable in project.cable_segments}

    # 1. Whole-graph cycle check
    cycles = _find_all_cycles(nodes_by_id, project.connections)
    for cycle in cycles:
        names = [nodes_by_id[nid].name if nid in nodes_by_id else nid for nid in cycle]
        errors.append(
            TopologyIssue(
                code="prohibited_cycle",
                policy_code="prohibited-cycle",
                message=f"Circular optical dependency detected: loop involving {' -> '.join(names)}",
                severity="error",
                details={"cycle": cycle},
            )
        )

    # 2. Check each connection
    seen_triplets: Set[Tuple[str, str, str]] = set()
    incoming_to_ont: Dict[str, List[str]] = {}
    incoming_to_router: Dict[str, List[str]] = {}
    incoming_to_passive: Dict[str, List[str]] = {}
    cable_usage: Dict[str, int] = {}
    from_node_usage: Dict[str, int] = {}

    for conn in project.connections:
        from_node = nodes_by_id.get(conn.from_node_id)
        to_node = nodes_by_id.get(conn.to_node_id)
        cable = cables_by_id.get(conn.cable_segment_id)

        if not from_node or not to_node or not cable:
            continue

        if has_zero_length_route(cable.geometry.coordinates):
            errors.append(TopologyIssue(
                code="zero_length_cable_route",
                policy_code="zero-length-route",
                message=f"Cable '{cable.name}' has zero geographic route length; provide at least one non-zero route segment.",
                severity="error",
                from_node_id=conn.from_node_id,
                to_node_id=conn.to_node_id,
                cable_segment_id=cable.id,
                connection_id=conn.id,
            ))

        if cable.start_node_id and cable.end_node_id:
            if {conn.from_node_id, conn.to_node_id} != {cable.start_node_id, cable.end_node_id}:
                errors.append(
                    TopologyIssue(
                        code="cable_endpoint_mismatch",
                        policy_code="invalid-reference",
                        message=(
                            f"Connection '{conn.id}' joins '{from_node.name}' ({conn.from_node_id}) and '{to_node.name}' ({conn.to_node_id}), "
                            f"but referenced cable '{cable.name}' has defined endpoints '{cable.start_node_id}' and '{cable.end_node_id}'"
                        ),
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )

        if conn.from_node_id == conn.to_node_id:
            errors.append(
                TopologyIssue(
                    code="self_loop",
                    policy_code="same-device",
                    message=f"Self-link detected: connection '{conn.id}' connects node '{from_node.name}' to itself",
                    severity="error",
                    from_node_id=conn.from_node_id,
                    to_node_id=conn.to_node_id,
                    cable_segment_id=conn.cable_segment_id,
                    connection_id=conn.id,
                )
            )
            continue

        if from_node.type == NodeType.POLE or to_node.type == NodeType.POLE:
            errors.append(
                TopologyIssue(
                    code="pole_not_optical_device",
                    policy_code="incompatible-types",
                    message=f"Pole '{from_node.name if from_node.type == NodeType.POLE else to_node.name}' is physical infrastructure and cannot host logical optical connections",
                    severity="error",
                    from_node_id=conn.from_node_id,
                    to_node_id=conn.to_node_id,
                    cable_segment_id=conn.cable_segment_id,
                    connection_id=conn.id,
                )
            )

        if from_node.type == NodeType.CUSTOMER or to_node.type == NodeType.CUSTOMER:
            errors.append(
                TopologyIssue(
                    code="customer_not_optical_node",
                    policy_code="incompatible-types",
                    message=f"Customer '{from_node.name if from_node.type == NodeType.CUSTOMER else to_node.name}' cannot be in a fiber connection; link via ontNodeId",
                    severity="error",
                    from_node_id=conn.from_node_id,
                    to_node_id=conn.to_node_id,
                    cable_segment_id=conn.cable_segment_id,
                    connection_id=conn.id,
                )
            )

        is_ethernet_link = (from_node.type == NodeType.ONT and to_node.type == NodeType.ROUTER)

        if from_node.type == NodeType.ONT:
            if not is_ethernet_link:
                errors.append(
                    TopologyIssue(
                        code="ont_cannot_have_downstream_connections",
                        policy_code="incompatible-types",
                        message=f"ONT '{from_node.name}' is a terminal subscriber device and cannot have downstream optical connections",
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )

        if from_node.type == NodeType.ROUTER:
            if to_node.type == NodeType.ONT:
                errors.append(
                    TopologyIssue(
                        code="router_cannot_feed_ont",
                        policy_code="incompatible-types",
                        message=f"Router '{from_node.name}' cannot feed back into ONT '{to_node.name}'. Customer connections flow from ONT to Router",
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )
            elif to_node.type in (NodeType.OLT, NodeType.ODC, NodeType.ODP, NodeType.SPLITTER):
                errors.append(
                    TopologyIssue(
                        code="router_invalid_upstream_connection",
                        policy_code="incompatible-types",
                        message=f"Router '{from_node.name}' cannot connect to optical infrastructure node '{to_node.name}'",
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )
            else:
                errors.append(
                    TopologyIssue(
                        code="router_invalid_downstream_connection",
                        policy_code="incompatible-types",
                        message=f"Router '{from_node.name}' does not support connection to '{to_node.type.value.upper()}' ({to_node.name})",
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )

        if to_node.type == NodeType.ROUTER:
            if from_node.type != NodeType.ONT:
                errors.append(
                    TopologyIssue(
                        code="router_invalid_optical_connection",
                        policy_code="incompatible-types",
                        message=f"Optical node '{from_node.name}' cannot connect directly to Router '{to_node.name}'. Routers must connect to an ONT",
                        severity="error",
                        from_node_id=conn.from_node_id,
                        to_node_id=conn.to_node_id,
                        cable_segment_id=conn.cable_segment_id,
                        connection_id=conn.id,
                    )
                )
            incoming_to_router.setdefault(to_node.id, []).append(conn.id)

        if to_node.type == NodeType.OLT:
            errors.append(
                TopologyIssue(
                    code="olt_cannot_have_upstream_feed",
                    policy_code="incompatible-types",
                    message=f"OLT '{to_node.name}' is a root optical transmitter and cannot accept an upstream optical input",
                    severity="error",
                    from_node_id=conn.from_node_id,
                    to_node_id=conn.to_node_id,
                    cable_segment_id=conn.cable_segment_id,
                    connection_id=conn.id,
                )
            )

        if not is_ethernet_link:
            allowed_targets = ALLOWED_OPTICAL_TRANSITIONS.get(from_node.type, set())
            if to_node.type not in allowed_targets:
                if not any(
                    e.code in (
                        "ont_cannot_have_downstream_connections",
                        "olt_cannot_have_upstream_feed",
                        "pole_not_optical_device",
                        "customer_not_optical_node",
                        "router_cannot_feed_ont",
                        "router_invalid_upstream_connection",
                        "router_invalid_downstream_connection",
                        "router_invalid_optical_connection",
                    )
                    and e.connection_id == conn.id
                    for e in errors
                ):
                    errors.append(
                        TopologyIssue(
                            code="invalid_connection_direction",
                            policy_code="incompatible-types",
                            message=f"Invalid GPON optical flow: cannot connect '{from_node.type.value.upper()}' to '{to_node.type.value.upper()}'",
                            severity="error",
                            from_node_id=conn.from_node_id,
                            to_node_id=conn.to_node_id,
                            cable_segment_id=conn.cable_segment_id,
                            connection_id=conn.id,
                        )
                    )

        triplet = (conn.from_node_id, conn.to_node_id, conn.cable_segment_id)
        if triplet in seen_triplets:
            errors.append(
                TopologyIssue(
                    code="duplicate_connection",
                    policy_code="duplicate-link",
                    message=f"Duplicate connection between '{from_node.name}' and '{to_node.name}' using cable '{cable.name}'",
                    severity="error",
                    from_node_id=conn.from_node_id,
                    to_node_id=conn.to_node_id,
                    cable_segment_id=conn.cable_segment_id,
                    connection_id=conn.id,
                )
            )
        seen_triplets.add(triplet)

        if to_node.type == NodeType.ONT:
            incoming_to_ont.setdefault(to_node.id, []).append(conn.id)
        if to_node.type in (NodeType.ODC, NodeType.ODP, NodeType.SPLITTER):
            incoming_to_passive.setdefault(to_node.id, []).append(conn.id)

        cable_usage[cable.id] = cable_usage.get(cable.id, 0) + 1
        from_node_usage[from_node.id] = from_node_usage.get(from_node.id, 0) + 1

    # Check ONT multiple inputs
    for ont_id, incoming_conns in incoming_to_ont.items():
        if len(incoming_conns) > 1:
            ont_node = nodes_by_id.get(ont_id)
            errors.append(
                TopologyIssue(
                    code="ont_multiple_inputs",
                    policy_code="incompatible-types",
                    message=f"ONT '{ont_node.name if ont_node else ont_id}' already has {len(incoming_conns)} incoming optical feeds. An ONT supports only one upstream connection",
                    severity="error",
                    to_node_id=ont_id,
                )
            )

    # A passive distribution node is a branch point, not an optical source.
    # Multiple inputs merge separate branches and are unsupported by this
    # project's directed GPON path model.
    for passive_id, incoming_conns in incoming_to_passive.items():
        if len(incoming_conns) > 1:
            passive_node = nodes_by_id.get(passive_id)
            errors.append(
                TopologyIssue(
                    code="passive_node_multiple_inputs",
                    policy_code="incompatible-types",
                    message=f"Passive optical node '{passive_node.name if passive_node else passive_id}' has {len(incoming_conns)} upstream feeds. A GPON distribution tree supports one upstream feed per passive node.",
                    severity="error",
                    to_node_id=passive_id,
                    details={"connectionIds": incoming_conns},
                )
            )

    # Check Router multiple inputs
    for r_id, incoming_conns in incoming_to_router.items():
        if len(incoming_conns) > 1:
            r_node = nodes_by_id.get(r_id)
            errors.append(
                TopologyIssue(
                    code="router_multiple_wan_feeds",
                    policy_code="incompatible-types",
                    message=f"Router '{r_node.name if r_node else r_id}' has {len(incoming_conns)} incoming feeds. A customer router supports only one upstream ONT connection",
                    severity="error",
                    to_node_id=r_id,
                )
            )

    # Validate Router IP configurations
    for node in project.nodes:
        if node.type == NodeType.ROUTER:
            r_cfg = extract_router_config(node)
            if r_cfg is not None:
                r_issues = validate_router_config(r_cfg, node_id=node.id, node_name=node.name)
                for r_issue in r_issues:
                    errors.append(
                        TopologyIssue(
                            code=r_issue.code or "invalid_router_config",
                            policy_code="router-configuration",
                            message=f"Router '{node.name}': {r_issue.message}",
                            severity="error",
                            from_node_id=node.id,
                            details={"field": r_issue.field, "nodeId": node.id, "issue": r_issue.message},
                        )
                    )
            else:
                warnings.append(
                    TopologyIssue(
                        code="unconfigured_router",
                        policy_code="router-configuration",
                        message=f"Router '{node.name}' has no IP configuration.",
                        severity="warning",
                        from_node_id=node.id,
                    )
                )

    # Check cable capacities
    for cable_id, used_count in cable_usage.items():
        cable = cables_by_id[cable_id]
        if cable.fiber_count is not None and used_count > cable.fiber_count:
            errors.append(
                TopologyIssue(
                    code="cable_capacity_exceeded",
                    policy_code="capacity-exceeded",
                    message=f"Cable segment '{cable.name}' has fiberCount={cable.fiber_count}, which is already fully allocated ({used_count} in use)",
                    severity="error",
                    cable_segment_id=cable_id,
                )
            )

    for from_id, used_count in from_node_usage.items():
        from_node = nodes_by_id[from_id]
        splitter_cap = _extract_splitter_capacity(from_node)
        device_cap = _extract_device_port_capacity(from_node)
        effective_cap = splitter_cap or device_cap
        if effective_cap is not None and used_count > effective_cap:
            code = (
                "splitter_capacity_exceeded"
                if (from_node.type == NodeType.SPLITTER or splitter_cap is not None)
                else "device_capacity_exceeded"
            )
            label = "Splitter" if code == "splitter_capacity_exceeded" else "Device"
            errors.append(
                TopologyIssue(
                    code=code,
                    policy_code="capacity-exceeded",
                    message=f"{label} '{from_node.name}' has configured capacity of {effective_cap} output ports, which is exceeded ({used_count} connected)",
                    severity="error",
                    from_node_id=from_id,
                )
            )

    # Physical span and ODP-to-house distance checks (max 300 m)
    from backend.app.engine.pole import resolve_span_geometry_and_length, _is_geographically_placed
    max_span_limit_m = float(project.settings.pole_span_planning.default_max_span_m or 300.0)
    max_odp_house_m = float(project.settings.pole_span_planning.max_odp_to_house_distance_m or 300.0)
    spans_per_cable: Dict[str, int] = {}
    seen_span_ids = set()
    for s in project.pole_spans:
        if s.id in seen_span_ids:
            continue
        seen_span_ids.add(s.id)
        spans_per_cable[s.cable_segment_id] = spans_per_cable.get(s.cable_segment_id, 0) + 1
    for span in project.pole_spans:
        cable = cables_by_id.get(span.cable_segment_id)
        if cable is not None and cable.deployment_method in {"underground", "building_attached", "other"}:
            warnings.append(
                TopologyIssue(
                    code="pole_span_on_non_aerial_cable",
                    policy_code="non-aerial-pole-span",
                    message=f"Pole span '{span.id}' is attached to cable '{cable.name}' with deployment method '{cable.deployment_method}'.",
                    severity="warning",
                    from_node_id=span.from_pole_id,
                    to_node_id=span.to_pole_id,
                    cable_segment_id=span.cable_segment_id,
                    details={"spanId": span.id, "deploymentMethod": cable.deployment_method},
                )
            )
            continue
        cable_span_count = spans_per_cable.get(span.cable_segment_id, 1)
        _, _, span_len, _ = resolve_span_geometry_and_length(span, cable, nodes_by_id, cable_span_count)
        if span_len is not None and span_len > max_span_limit_m:
            warnings.append(
                TopologyIssue(
                    code="pole_span_exceeds_300m",
                    policy_code="span-length-exceeded",
                    message=f"Pole span '{span.id}' length ({span_len:.2f} m) exceeds maximum limit of {max_span_limit_m:.0f} m.",
                    severity="warning",
                    from_node_id=span.from_pole_id,
                    to_node_id=span.to_pole_id,
                    cable_segment_id=span.cable_segment_id,
                    details={"spanId": span.id, "lengthM": span_len, "maxSpanM": max_span_limit_m},
                )
            )

    for cable in project.cable_segments:
        if cable.properties.get("deploymentMethodMalformed") is True:
            warnings.append(
                TopologyIssue(
                    code="malformed_cable_deployment_method",
                    policy_code="invalid-deployment-metadata",
                    message=f"Cable '{cable.name}' has unrecognized deploymentMethod '{cable.properties.get('rawDeploymentMethod')}'; treated as 'unspecified'.",
                    severity="warning",
                    cable_segment_id=cable.id,
                    details={"rawDeploymentMethod": cable.properties.get("rawDeploymentMethod")},
                )
            )

    for conn in project.connections:
        from_n = nodes_by_id.get(conn.from_node_id)
        to_n = nodes_by_id.get(conn.to_node_id)
        cable = cables_by_id.get(conn.cable_segment_id)
        if from_n and to_n and from_n.type == NodeType.ODP and to_n.type == NodeType.ONT:
            route_dist: Optional[float] = None
            distance_method = "unknown"
            if cable and cable.length_m is not None:
                route_dist = float(cable.length_m)
                distance_method = "drop_route"
            elif cable and cable.geometry and len(cable.geometry.coordinates) >= 2 and _is_geographically_placed(from_n) and _is_geographically_placed(to_n):
                computed = round(calculate_route_length(cable.geometry.coordinates), 2)
                if computed > 0:
                    route_dist = computed
                    distance_method = "drop_route"
            elif _is_geographically_placed(from_n) and _is_geographically_placed(to_n):
                route_dist = round(distance_meters(from_n.location.coordinates, to_n.location.coordinates), 2)
                distance_method = "geodesic_fallback"
            if route_dist is not None and route_dist > max_odp_house_m:
                warnings.append(
                    TopologyIssue(
                        code="odp_to_house_exceeds_300m",
                        policy_code="odp-drop-distance-exceeded",
                        message=f"Distance from ODP '{from_n.name}' to house/ONT '{to_n.name}' ({route_dist:.2f} m) exceeds maximum limit of {max_odp_house_m:.0f} m.",
                        severity="warning",
                        from_node_id=from_n.id,
                        to_node_id=to_n.id,
                        cable_segment_id=cable.id if cable else None,
                        connection_id=conn.id,
                        details={"distanceM": route_dist, "distanceMethod": distance_method, "maxAllowedM": max_odp_house_m},
                    )
                )

    summary = {
        "totalNodes": len(project.nodes),
        "totalConnections": len(project.connections),
        "totalCableSegments": len(project.cable_segments),
        "totalCustomers": len(project.customers),
        "nodeTypeCounts": {t.value: sum(1 for n in project.nodes if n.type == t) for t in NodeType},
        "routerCount": sum(1 for n in project.nodes if n.type == NodeType.ROUTER),
        "hasCycles": len(cycles) > 0,
    }

    return TopologyValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        warnings=warnings,
        summary=summary,
    )


def validate_project_integrity(project: Project) -> List[ErrorDetail]:
    """Validate cross-entity references and topology integrity within a project.
    
    Returns a list of ErrorDetail objects. If valid, the list is empty.
    Preserves exact backward-compatible field names and messages for existing tests.
    """
    errors: List[ErrorDetail] = []

    # 1. Check ID uniqueness across nodes
    node_ids: Set[str] = set()
    for idx, node in enumerate(project.nodes):
        if node.id in node_ids:
            errors.append(
                ErrorDetail(
                    field=f"nodes[{idx}].id",
                    message=f"Duplicate node ID '{node.id}' found in project",
                )
            )
        node_ids.add(node.id)

    nodes_by_id = {node.id: node for node in project.nodes}

    # 2. Check ID uniqueness across customers
    customer_ids: Set[str] = set()
    for idx, customer in enumerate(project.customers):
        if customer.id in customer_ids:
            errors.append(
                ErrorDetail(
                    field=f"customers[{idx}].id",
                    message=f"Duplicate customer ID '{customer.id}' found in project",
                )
            )
        customer_ids.add(customer.id)
        if customer.ont_node_id:
            ont = nodes_by_id.get(customer.ont_node_id)
            if ont is None:
                errors.append(
                    ErrorDetail(
                        field=f"customers[{idx}].ontNodeId",
                        message=f"Referenced ONT node '{customer.ont_node_id}' does not exist in project nodes",
                    )
                )
            elif ont.type != NodeType.ONT:
                errors.append(
                    ErrorDetail(
                        field=f"customers[{idx}].ontNodeId",
                        message=f"Referenced node '{customer.ont_node_id}' is not an ONT",
                    )
                )

    # 3. Check ID uniqueness across cable segments
    cable_ids: Set[str] = set()
    for idx, cable in enumerate(project.cable_segments):
        if cable.id in cable_ids:
            errors.append(
                ErrorDetail(
                    field=f"cableSegments[{idx}].id",
                    message=f"Duplicate cable segment ID '{cable.id}' found in project",
                )
            )
        cable_ids.add(cable.id)

        if has_zero_length_route(cable.geometry.coordinates):
            errors.append(ErrorDetail(
                field=f"cableSegments[{idx}].geometry.coordinates",
                message=f"Cable '{cable.name}' has zero geographic route length; provide at least one non-zero route segment.",
            ))

        # Optional start/end node ID reference check
        if cable.start_node_id and cable.start_node_id not in node_ids:
            errors.append(
                ErrorDetail(
                    field=f"cableSegments[{idx}].startNodeId",
                    message=f"Referenced startNodeId '{cable.start_node_id}' does not exist in project nodes",
                )
            )
        if cable.end_node_id and cable.end_node_id not in node_ids:
            errors.append(
                ErrorDetail(
                    field=f"cableSegments[{idx}].endNodeId",
                    message=f"Referenced endNodeId '{cable.end_node_id}' does not exist in project nodes",
                )
            )

        # Check startNodeId != endNodeId if both provided
        if cable.start_node_id and cable.end_node_id and cable.start_node_id == cable.end_node_id:
            errors.append(
                ErrorDetail(
                    field=f"cableSegments[{idx}].endNodeId",
                    message=f"Cable '{cable.name}' startNodeId and endNodeId cannot be the same node '{cable.start_node_id}'",
                )
            )

        # Validate that first and last route coordinates correspond to intended endpoint nodes
        start_node = nodes_by_id.get(cable.start_node_id) if cable.start_node_id else None
        end_node = nodes_by_id.get(cable.end_node_id) if cable.end_node_id else None
        coords = cable.geometry.coordinates
        first_pt = coords[0]
        last_pt = coords[-1]
        TOLERANCE_METRES = 50.0

        if start_node and end_node:
            d_start_first = distance_meters(first_pt, start_node.location.coordinates)
            d_end_last = distance_meters(last_pt, end_node.location.coordinates)
            d_start_last = distance_meters(last_pt, start_node.location.coordinates)
            d_end_first = distance_meters(first_pt, end_node.location.coordinates)

            # Route may be drawn in either direction: start->end or end->start
            forward_match = d_start_first <= TOLERANCE_METRES and d_end_last <= TOLERANCE_METRES
            reverse_match = d_end_first <= TOLERANCE_METRES and d_start_last <= TOLERANCE_METRES

            if not (forward_match or reverse_match):
                # Identify specific endpoint mismatch if one end is aligned
                if d_end_last <= TOLERANCE_METRES and d_start_first > TOLERANCE_METRES:
                    errors.append(
                        ErrorDetail(
                            field=f"cableSegments[{idx}].geometry.coordinates[0]",
                            message=(
                                f"Cable '{cable.name}' first route coordinate {first_pt} "
                                f"does not correspond to start node '{start_node.name}' location {start_node.location.coordinates} "
                                f"({d_start_first:.1f}m > {TOLERANCE_METRES:.0f}m)"
                            ),
                        )
                    )
                elif d_start_first <= TOLERANCE_METRES and d_end_last > TOLERANCE_METRES:
                    errors.append(
                        ErrorDetail(
                            field=f"cableSegments[{idx}].geometry.coordinates[-1]",
                            message=(
                                f"Cable '{cable.name}' last route coordinate {last_pt} "
                                f"does not correspond to end node '{end_node.name}' location {end_node.location.coordinates} "
                                f"({d_end_last:.1f}m > {TOLERANCE_METRES:.0f}m)"
                            ),
                        )
                    )
                elif d_end_first <= TOLERANCE_METRES and d_start_last > TOLERANCE_METRES:
                    errors.append(
                        ErrorDetail(
                            field=f"cableSegments[{idx}].geometry.coordinates[-1]",
                            message=(
                                f"Cable '{cable.name}' last route coordinate {last_pt} "
                                f"does not correspond to start node '{start_node.name}' location {start_node.location.coordinates} "
                                f"({d_start_last:.1f}m > {TOLERANCE_METRES:.0f}m)"
                            ),
                        )
                    )
                elif d_start_last <= TOLERANCE_METRES and d_end_first > TOLERANCE_METRES:
                    errors.append(
                        ErrorDetail(
                            field=f"cableSegments[{idx}].geometry.coordinates[0]",
                            message=(
                                f"Cable '{cable.name}' first route coordinate {first_pt} "
                                f"does not correspond to end node '{end_node.name}' location {end_node.location.coordinates} "
                                f"({d_end_first:.1f}m > {TOLERANCE_METRES:.0f}m)"
                            ),
                        )
                    )
                else:
                    errors.append(
                        ErrorDetail(
                            field=f"cableSegments[{idx}].geometry.coordinates",
                            message=(
                                f"Cable '{cable.name}' route endpoints do not correspond to declared endpoint nodes "
                                f"'{start_node.name}' and '{end_node.name}' within {TOLERANCE_METRES:.0f}m tolerance: "
                                f"first coordinate {first_pt} is {min(d_start_first, d_end_first):.1f}m from nearest endpoint, "
                                f"last coordinate {last_pt} is {min(d_end_last, d_start_last):.1f}m from nearest endpoint"
                            ),
                        )
                    )
        elif start_node:
            d_start_first = distance_meters(first_pt, start_node.location.coordinates)
            d_start_last = distance_meters(last_pt, start_node.location.coordinates)
            if d_start_first > TOLERANCE_METRES and d_start_last > TOLERANCE_METRES:
                errors.append(
                    ErrorDetail(
                        field=f"cableSegments[{idx}].geometry.coordinates",
                        message=(
                            f"Cable '{cable.name}' route endpoints do not correspond to start node '{start_node.name}' "
                            f"location {start_node.location.coordinates} within {TOLERANCE_METRES:.0f}m"
                        ),
                    )
                )
        elif end_node:
            d_end_first = distance_meters(first_pt, end_node.location.coordinates)
            d_end_last = distance_meters(last_pt, end_node.location.coordinates)
            if d_end_first > TOLERANCE_METRES and d_end_last > TOLERANCE_METRES:
                errors.append(
                    ErrorDetail(
                        field=f"cableSegments[{idx}].geometry.coordinates",
                        message=(
                            f"Cable '{cable.name}' route endpoints do not correspond to end node '{end_node.name}' "
                            f"location {end_node.location.coordinates} within {TOLERANCE_METRES:.0f}m"
                        ),
                    )
                )

    # 4. Check topology connections
    connection_ids: Set[str] = set()
    seen_connections: Set[Tuple[str, str, str]] = set()

    for idx, conn in enumerate(project.connections):
        if conn.id in connection_ids:
            errors.append(
                ErrorDetail(
                    field=f"connections[{idx}].id",
                    message=f"Duplicate connection ID '{conn.id}' found in project",
                )
            )
        connection_ids.add(conn.id)

        # Self-link validation
        if conn.from_node_id == conn.to_node_id:
            errors.append(
                ErrorDetail(
                    field=f"connections[{idx}].toNodeId",
                    message=f"Self-link detected: connection '{conn.id}' connects node '{conn.from_node_id}' to itself",
                )
            )

        # Reference existence check
        from_node = nodes_by_id.get(conn.from_node_id)
        to_node = nodes_by_id.get(conn.to_node_id)
        cable = next((c for c in project.cable_segments if c.id == conn.cable_segment_id), None)

        if not from_node:
            errors.append(
                ErrorDetail(
                    field=f"connections[{idx}].fromNodeId",
                    message=f"Referenced fromNodeId '{conn.from_node_id}' does not exist in project nodes",
                )
            )
        if not to_node:
            errors.append(
                ErrorDetail(
                    field=f"connections[{idx}].toNodeId",
                    message=f"Referenced toNodeId '{conn.to_node_id}' does not exist in project nodes",
                )
            )
        if not cable:
            errors.append(
                ErrorDetail(
                    field=f"connections[{idx}].cableSegmentId",
                    message=f"Referenced cableSegmentId '{conn.cable_segment_id}' does not exist in project cable segments",
                )
            )

        if from_node and to_node and cable:
            triplet = (conn.from_node_id, conn.to_node_id, conn.cable_segment_id)
            if triplet in seen_connections:
                errors.append(
                    ErrorDetail(
                        field=f"connections[{idx}]",
                        message=f"Duplicate connection between '{conn.from_node_id}' and '{conn.to_node_id}' using cable '{conn.cable_segment_id}'",
                    )
                )
            seen_connections.add(triplet)

    # 5. Run deeper topology checks and append any additional violations
    topology_result = validate_project_topology(project)
    for issue in topology_result.errors:
        # Avoid duplicate messages already captured above
        if issue.code in ("missing_from_node", "missing_to_node", "missing_cable_segment", "self_loop", "duplicate_connection"):
            continue
        field = "connections"
        if issue.connection_id:
            conn_idx = next((i for i, c in enumerate(project.connections) if c.id == issue.connection_id), None)
            if conn_idx is not None:
                field = f"connections[{conn_idx}]"
        elif issue.details and "nodeId" in issue.details:
            node_id = issue.details["nodeId"]
            node_idx = next((i for i, n in enumerate(project.nodes) if n.id == node_id), None)
            subfield = issue.details.get("field", "properties")
            if node_idx is not None:
                field = f"nodes[{node_idx}].properties.{subfield}"
            else:
                field = f"nodes.{subfield}"
        errors.append(ErrorDetail(field=field, message=issue.message))

    return errors


def ensure_valid_project(project: Project) -> None:
    """Validate project and raise TopologyValidationError if any issues exist."""
    errors = validate_project_integrity(project)
    if errors:
        raise TopologyValidationError(
            message=f"Project semantic validation failed with {len(errors)} error(s)",
            details=errors,
        )
