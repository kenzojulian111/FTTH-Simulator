use std::collections::{HashMap, HashSet};
use std::net::Ipv4Addr;

use crate::models::{
    ConnectionValidationRequest, NetworkNode, NodeType, Project, RouterConfig, RouterConfigIssue,
    TopologyIssue, TopologyValidationResult, WanMode,
};

pub fn is_allowed_optical_transition(from_type: &NodeType, to_type: &NodeType) -> bool {
    match from_type {
        NodeType::Olt => matches!(to_type, NodeType::Odc | NodeType::Odp | NodeType::Splitter | NodeType::Ont),
        NodeType::Odc => matches!(to_type, NodeType::Odc | NodeType::Odp | NodeType::Splitter | NodeType::Ont),
        NodeType::Odp => matches!(to_type, NodeType::Odp | NodeType::Splitter | NodeType::Ont),
        NodeType::Splitter => matches!(to_type, NodeType::Odc | NodeType::Odp | NodeType::Splitter | NodeType::Ont),
        NodeType::Ont | NodeType::Pole | NodeType::Manhole | NodeType::Handhole | NodeType::Annotation | NodeType::Router | NodeType::Customer | NodeType::Unknown => false,
    }
}

#[cfg(test)]
mod physical_node_tests {
    use super::is_allowed_optical_transition;
    use crate::models::NodeType;

    #[test]
    fn manholes_and_handholes_are_not_optical_topology_nodes() {
        for physical in [NodeType::Manhole, NodeType::Handhole, NodeType::Annotation] {
            assert!(!is_allowed_optical_transition(&NodeType::Olt, &physical));
            assert!(!is_allowed_optical_transition(&physical, &NodeType::Ont));
        }
    }
}

pub fn extract_router_config(node: &NetworkNode) -> Option<RouterConfig> {
    for key in ["routerConfiguration", "router_configuration", "routerConfig", "router_config"] {
        if let Some(val) = node.properties.get(key) {
            if val.is_object() {
                if let Ok(cfg) = serde_json::from_value::<RouterConfig>(val.clone()) {
                    return Some(cfg);
                }
            }
        }
    }

    if node.r#type == NodeType::Router {
        let router_keys = [
            "hostname", "wanMode", "wan_mode", "wanIpv4Address", "wan_ipv4_address",
            "wanIp", "wan_ip", "wanPrefix", "wan_prefix", "defaultGateway", "default_gateway",
            "lanIpv4Address", "lan_ipv4_address", "lanIp", "lan_ip", "lanPrefix", "lan_prefix",
            "dhcpServerEnabled", "dhcp_server_enabled", "dhcpPoolStart", "dhcp_pool_start",
            "dhcpPoolEnd", "dhcp_pool_end", "dnsServers", "dns_servers", "natEnabled", "nat_enabled",
            "vlanId", "vlan_id", "pppoeUsername", "pppoePassword",
        ];
        let has_any = router_keys.iter().any(|k| node.properties.contains_key(*k));
        if has_any {
            let val = serde_json::Value::Object(node.properties.clone());
            if let Ok(cfg) = serde_json::from_value::<RouterConfig>(val) {
                return Some(cfg);
            }
        }
    }

    None
}

pub fn validate_router_config(
    config: &RouterConfig,
    _node_id: Option<&str>,
    _node_name: Option<&str>,
) -> Vec<RouterConfigIssue> {
    let mut issues = Vec::new();

    let mut add = |field: &str, message: &str, code: &str| {
        issues.push(RouterConfigIssue {
            field: field.to_string(),
            message: message.to_string(),
            code: Some(code.to_string()),
            severity: "error".to_string(),
        });
    };

    if config.wan_mode.is_none() {
        add("wanMode", "Choose a WAN addressing mode.", "missing_wan_mode");
    }

    if let Some(WanMode::Static) = config.wan_mode {
        let wan_ip: Option<Ipv4Addr> = config
            .wan_ipv4_address
            .as_deref()
            .and_then(|s| s.trim().parse().ok());
        if wan_ip.is_none() {
            add("wanIpv4Address", "Enter a valid static WAN IPv4 address.", "invalid_wan_ip");
        }

        if let Some(prefix) = config.wan_prefix {
            if prefix > 32 {
                add("wanPrefix", "Enter a prefix from 0 to 32.", "invalid_wan_prefix");
            }
        } else {
            add("wanPrefix", "Enter a prefix from 0 to 32.", "invalid_wan_prefix");
        }

        let gateway: Option<Ipv4Addr> = config
            .default_gateway
            .as_deref()
            .and_then(|s| s.trim().parse().ok());
        if gateway.is_none() {
            add("defaultGateway", "Enter a valid IPv4 default gateway.", "invalid_default_gateway");
        }

        if let (Some(wip), Some(gw), Some(prefix)) = (wan_ip, gateway, config.wan_prefix) {
            if prefix <= 32 {
                if wip == gw {
                    add("defaultGateway", "The gateway cannot be the router's WAN address.", "gateway_equals_wan_ip");
                } else {
                    let mask = if prefix == 0 { 0u32 } else { !0u32 << (32 - prefix) };
                    let wip_u32 = u32::from(wip);
                    let gw_u32 = u32::from(gw);
                    if (wip_u32 & mask) != (gw_u32 & mask) {
                        add("defaultGateway", "The gateway must be in the WAN address subnet.", "gateway_outside_wan_subnet");
                    }
                }
            }
        }
    }

    issues
}

pub fn validate_project_topology(project: &Project) -> TopologyValidationResult {
    let mut errors: Vec<TopologyIssue> = Vec::new();
    let mut warnings: Vec<TopologyIssue> = Vec::new();

    let nodes_by_id: HashMap<String, &NetworkNode> =
        project.nodes.iter().map(|n| (n.id.clone(), n)).collect();
    let cables_by_id: HashMap<String, &crate::models::CableSegment> = project
        .cable_segments
        .iter()
        .map(|c| (c.id.clone(), c))
        .collect();

    let mut seen_connections: HashSet<(String, String)> = HashSet::new();

    for conn in &project.connections {
        // Self-loop check
        if conn.from_node_id == conn.to_node_id {
            errors.push(TopologyIssue {
                code: "SELF_LOOP_DETECTED".to_string(),
                message: format!("Connection '{}' connects node '{}' to itself.", conn.id, conn.from_node_id),
                severity: "error".to_string(),
                policy_code: None,
                from_node_id: Some(conn.from_node_id.clone()),
                to_node_id: Some(conn.to_node_id.clone()),
                cable_segment_id: Some(conn.cable_segment_id.clone()),
                connection_id: Some(conn.id.clone()),
                details: None,
            });
            continue;
        }

        // Duplicate connection
        let pair = (conn.from_node_id.clone(), conn.to_node_id.clone());
        if !seen_connections.insert(pair) {
            warnings.push(TopologyIssue {
                code: "DUPLICATE_CONNECTION".to_string(),
                message: format!("Duplicate connection between '{}' and '{}'.", conn.from_node_id, conn.to_node_id),
                severity: "warning".to_string(),
                policy_code: None,
                from_node_id: Some(conn.from_node_id.clone()),
                to_node_id: Some(conn.to_node_id.clone()),
                cable_segment_id: Some(conn.cable_segment_id.clone()),
                connection_id: Some(conn.id.clone()),
                details: None,
            });
        }

        // Check node existence
        let from_node = nodes_by_id.get(&conn.from_node_id);
        let to_node = nodes_by_id.get(&conn.to_node_id);

        if from_node.is_none() {
            errors.push(TopologyIssue {
                code: "MISSING_FROM_NODE".to_string(),
                message: format!("Connection refers to non-existent from_node '{}'", conn.from_node_id),
                severity: "error".to_string(),
                policy_code: None,
                from_node_id: Some(conn.from_node_id.clone()),
                to_node_id: Some(conn.to_node_id.clone()),
                cable_segment_id: Some(conn.cable_segment_id.clone()),
                connection_id: Some(conn.id.clone()),
                details: None,
            });
        }

        if to_node.is_none() {
            errors.push(TopologyIssue {
                code: "MISSING_TO_NODE".to_string(),
                message: format!("Connection refers to non-existent to_node '{}'", conn.to_node_id),
                severity: "error".to_string(),
                policy_code: None,
                from_node_id: Some(conn.from_node_id.clone()),
                to_node_id: Some(conn.to_node_id.clone()),
                cable_segment_id: Some(conn.cable_segment_id.clone()),
                connection_id: Some(conn.id.clone()),
                details: None,
            });
        }

        // Cable segment existence
        if !cables_by_id.contains_key(&conn.cable_segment_id) {
            errors.push(TopologyIssue {
                code: "MISSING_CABLE_SEGMENT".to_string(),
                message: format!("Connection refers to non-existent cable segment '{}'", conn.cable_segment_id),
                severity: "error".to_string(),
                policy_code: None,
                from_node_id: Some(conn.from_node_id.clone()),
                to_node_id: Some(conn.to_node_id.clone()),
                cable_segment_id: Some(conn.cable_segment_id.clone()),
                connection_id: Some(conn.id.clone()),
                details: None,
            });
        }

        // Validate optical role transition if optical/fiber
        if let (Some(fn_node), Some(tn_node)) = (from_node, to_node) {
            let is_ethernet = conn.connection_type.as_deref() == Some("ethernet")
                || conn.medium.as_deref() == Some("copper")
                || fn_node.r#type == NodeType::Router
                || tn_node.r#type == NodeType::Router;

            if !is_ethernet {
                if !is_allowed_optical_transition(&fn_node.r#type, &tn_node.r#type) {
                    errors.push(TopologyIssue {
                        code: "INVALID_OPTICAL_TRANSITION".to_string(),
                        message: format!(
                            "Invalid optical flow direction from {} ({:?}) to {} ({:?})",
                            fn_node.name, fn_node.r#type, tn_node.name, tn_node.r#type
                        ),
                        severity: "error".to_string(),
                        policy_code: Some("GPON_TOPOLOGY_FLOW".to_string()),
                        from_node_id: Some(fn_node.id.clone()),
                        to_node_id: Some(tn_node.id.clone()),
                        cable_segment_id: Some(conn.cable_segment_id.clone()),
                        connection_id: Some(conn.id.clone()),
                        details: None,
                    });
                }
            }
        }
    }

    let summary = serde_json::json!({
        "errorCount": errors.len(),
        "warningCount": warnings.len(),
        "connectionCount": project.connections.len(),
        "nodeCount": project.nodes.len(),
    });

    TopologyValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        summary,
    }
}

pub fn validate_connection_candidate(
    project: &Project,
    request: &ConnectionValidationRequest,
) -> TopologyValidationResult {
    let mut errors = Vec::new();
    let warnings = Vec::new();

    if request.from_node_id == request.to_node_id {
        errors.push(TopologyIssue {
            code: "SELF_LOOP_DETECTED".to_string(),
            message: "Cannot connect a device to itself.".to_string(),
            severity: "error".to_string(),
            policy_code: None,
            from_node_id: Some(request.from_node_id.clone()),
            to_node_id: Some(request.to_node_id.clone()),
            cable_segment_id: Some(request.cable_segment_id.clone()),
            connection_id: request.connection_id.clone(),
            details: None,
        });
    }

    let nodes_by_id: HashMap<String, &NetworkNode> =
        project.nodes.iter().map(|n| (n.id.clone(), n)).collect();

    let from_node = nodes_by_id.get(&request.from_node_id);
    let to_node = nodes_by_id.get(&request.to_node_id);

    if let (Some(fn_node), Some(tn_node)) = (from_node, to_node) {
        let is_ethernet = request.connection_type.as_deref() == Some("ethernet")
            || request.medium.as_deref() == Some("copper")
            || fn_node.r#type == NodeType::Router
            || tn_node.r#type == NodeType::Router;

        if !is_ethernet {
            if !is_allowed_optical_transition(&fn_node.r#type, &tn_node.r#type) {
                errors.push(TopologyIssue {
                    code: "INVALID_OPTICAL_TRANSITION".to_string(),
                    message: format!(
                        "Invalid optical flow direction from {} ({:?}) to {} ({:?})",
                        fn_node.name, fn_node.r#type, tn_node.name, tn_node.r#type
                    ),
                    severity: "error".to_string(),
                    policy_code: Some("GPON_TOPOLOGY_FLOW".to_string()),
                    from_node_id: Some(fn_node.id.clone()),
                    to_node_id: Some(tn_node.id.clone()),
                    cable_segment_id: Some(request.cable_segment_id.clone()),
                    connection_id: request.connection_id.clone(),
                    details: None,
                });
            }
        }
    }

    let summary = serde_json::json!({
        "errorCount": errors.len(),
        "warningCount": warnings.len(),
    });

    TopologyValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        summary,
    }
}
