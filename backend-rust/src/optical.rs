use std::collections::{HashMap, HashSet, VecDeque};

use crate::geo::calculate_route_length;
use crate::models::{
    current_utc_timestamp, IntermediateOpticalLossItem, IntermediateOpticalResult, NetworkNode,
    NodeType, OpticalBudgetConfig, OpticalBudgetResult, OpticalLinkResult, OpticalPathResult,
    OpticalPathSegment, OpticalSplitterInfo, Project,
};

fn resolve_cable_category(cable: &crate::models::CableSegment) -> String {
    if let Some(explicit) = cable.properties.get("cableCategory").and_then(|v| v.as_str()) {
        if !explicit.trim().is_empty() {
            return explicit.trim().to_lowercase();
        }
    }
    let raw = cable.cable_type.trim().to_lowercase();
    for known in ["feeder", "distribution", "drop", "indoor", "custom"] {
        if raw == known || raw.starts_with(&format!("{} ", known)) || raw.ends_with(&format!(" {}", known)) {
            return known.to_string();
        }
    }
    "unspecified".to_string()
}

fn ideal_splitter_loss_db(ratio: Option<&str>) -> Option<f64> {
    let ratio = ratio?;
    let parts: Vec<&str> = ratio.split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let input: u32 = parts[0].parse().ok()?;
    let output: u32 = parts[1].parse().ok()?;
    if input != 1 || output < 1 {
        return None;
    }
    Some(((10.0 * (output as f64).log10()) * 100.0).round() / 100.0)
}

fn get_splitter_info_for_node(
    node: &NetworkNode,
    config: &OpticalBudgetConfig,
) -> Option<OpticalSplitterInfo> {
    let has_splitter = node.r#type == NodeType::Splitter
        || node.properties.contains_key("splitterRatio")
        || node.properties.contains_key("splitterLossDb");

    if !has_splitter {
        return None;
    }

    let loss_prop = node
        .properties
        .get("splitterLossDb")
        .and_then(|v| v.as_f64());
    let ratio_str = node
        .properties
        .get("splitterRatio")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(val) = loss_prop {
        if val >= 0.0 {
            return Some(OpticalSplitterInfo {
                node_id: node.id.clone(),
                node_name: node.name.clone(),
                node_type: node.r#type.as_str().to_string(),
                splitter_ratio: ratio_str.clone(),
                loss_db: Some(val),
                ideal_loss_db: ideal_splitter_loss_db(ratio_str.as_deref()),
            });
        }
    }

    if let Some(ref r) = ratio_str {
        if let Some(loss) = config.splitter_loss_table.get(r) {
            return Some(OpticalSplitterInfo {
                node_id: node.id.clone(),
                node_name: node.name.clone(),
                node_type: node.r#type.as_str().to_string(),
                splitter_ratio: Some(r.clone()),
                loss_db: Some(*loss),
                ideal_loss_db: ideal_splitter_loss_db(Some(r)),
            });
        }
    }

    Some(OpticalSplitterInfo {
        node_id: node.id.clone(),
        node_name: node.name.clone(),
        node_type: node.r#type.as_str().to_string(),
        splitter_ratio: ratio_str.clone(),
        loss_db: None,
        ideal_loss_db: ideal_splitter_loss_db(ratio_str.as_deref()),
    })
}

pub fn calculate_optical_budget(
    project: &Project,
    config_override: Option<&OpticalBudgetConfig>,
) -> OpticalBudgetResult {
    let config = config_override.unwrap_or(&project.settings.optical_budget);
    let nodes_by_id: HashMap<String, &NetworkNode> =
        project.nodes.iter().map(|n| (n.id.clone(), n)).collect();
    let cables_by_id: HashMap<String, &crate::models::CableSegment> = project
        .cable_segments
        .iter()
        .map(|c| (c.id.clone(), c))
        .collect();

    // Adjacency for path tracing: from_node -> Vec<(to_node, conn_id, cable_id)>
    let mut outgoing: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    for conn in &project.connections {
        outgoing
            .entry(conn.from_node_id.clone())
            .or_default()
            .push((
                conn.to_node_id.clone(),
                conn.id.clone(),
                conn.cable_segment_id.clone(),
            ));
    }

    // Customer map to ONT
    let mut customers_by_ont: HashMap<String, Vec<String>> = HashMap::new();
    for cust in &project.customers {
        if let Some(ref ont_id) = cust.ont_node_id {
            customers_by_ont
                .entry(ont_id.clone())
                .or_default()
                .push(cust.id.clone());
        }
    }

    // Trace from each OLT using BFS
    let olt_nodes: Vec<&NetworkNode> = project
        .nodes
        .iter()
        .filter(|n| n.r#type == NodeType::Olt)
        .collect();

    struct PathState {
        node_ids: Vec<String>,
        conn_ids: Vec<String>,
        cable_ids: Vec<String>,
    }

    let mut paths_to_ont: Vec<PathState> = Vec::new();
    let mut intermediate_traces: HashMap<String, PathState> = HashMap::new();

    for olt in &olt_nodes {
        let mut queue = VecDeque::new();
        queue.push_back(PathState {
            node_ids: vec![olt.id.clone()],
            conn_ids: Vec::new(),
            cable_ids: Vec::new(),
        });

        let mut visited_paths: HashSet<(String, usize)> = HashSet::new();

        while let Some(current) = queue.pop_front() {
            let last_node_id = current.node_ids.last().unwrap().clone();
            let depth = current.node_ids.len();

            if !visited_paths.insert((last_node_id.clone(), depth)) {
                continue;
            }

            if let Some(last_node) = nodes_by_id.get(&last_node_id) {
                if last_node.r#type == NodeType::Ont {
                    paths_to_ont.push(PathState {
                        node_ids: current.node_ids.clone(),
                        conn_ids: current.conn_ids.clone(),
                        cable_ids: current.cable_ids.clone(),
                    });
                } else if (last_node.r#type == NodeType::Odc || last_node.r#type == NodeType::Odp)
                    && !intermediate_traces.contains_key(&last_node_id)
                {
                    intermediate_traces.insert(
                        last_node_id.clone(),
                        PathState {
                            node_ids: current.node_ids.clone(),
                            conn_ids: current.conn_ids.clone(),
                            cable_ids: current.cable_ids.clone(),
                        },
                    );
                }
            }

            if let Some(next_hops) = outgoing.get(&last_node_id) {
                for (to_id, conn_id, cable_id) in next_hops {
                    if !current.node_ids.contains(to_id) {
                        let mut next_state = PathState {
                            node_ids: current.node_ids.clone(),
                            conn_ids: current.conn_ids.clone(),
                            cable_ids: current.cable_ids.clone(),
                        };
                        next_state.node_ids.push(to_id.clone());
                        next_state.conn_ids.push(conn_id.clone());
                        next_state.cable_ids.push(cable_id.clone());
                        queue.push_back(next_state);
                    }
                }
            }
        }
    }

    // Evaluate paths to ONT
    let mut path_results: Vec<OpticalPathResult> = Vec::new();
    let mut intermediate_results: Vec<IntermediateOpticalResult> = Vec::new();

    let tx_power = config.tx_power_dbm;
    let rx_sens = config.rx_sensitivity_dbm;
    let rx_overload = config.rx_overload_dbm;
    let safety_margin = config.safety_margin_db;

    for path in &paths_to_ont {
        let ont_node_id = path.node_ids.last().unwrap().clone();
        let mut total_fiber_loss = 0.0;
        let mut total_length_m = 0.0;
        let mut segments: Vec<OpticalPathSegment> = Vec::new();
        let mut splitters: Vec<OpticalSplitterInfo> = Vec::new();
        let mut loss_breakdown: Vec<IntermediateOpticalLossItem> = Vec::new();

        // Process segments
        for i in 0..path.conn_ids.len() {
            let from_id = &path.node_ids[i];
            let to_id = &path.node_ids[i + 1];
            let conn_id = &path.conn_ids[i];
            let cable_id = &path.cable_ids[i];

            let from_node = nodes_by_id.get(from_id);
            let to_node = nodes_by_id.get(to_id);
            let cable = cables_by_id.get(cable_id);

            let length_m = cable
                .and_then(|c| c.length_m)
                .unwrap_or_else(|| cable.map(|c| calculate_route_length(&c.geometry.coordinates)).unwrap_or(0.0));
            total_length_m += length_m;

            let cat = cable.map(|c| resolve_cable_category(c)).unwrap_or_else(|| "unspecified".to_string());
            let att_rate = if cat == "drop" {
                config.drop_fiber_attenuation_db_per_km
            } else {
                config.fiber_attenuation_db_per_km
            };

            let fiber_loss = (length_m / 1000.0) * att_rate;
            total_fiber_loss += fiber_loss;

            segments.push(OpticalPathSegment {
                connection_id: conn_id.clone(),
                cable_segment_id: cable_id.clone(),
                cable_name: cable.map(|c| c.name.clone()).unwrap_or_default(),
                cable_category: Some(cat.clone()),
                from_node_id: from_id.clone(),
                from_node_name: from_node.map(|n| n.name.clone()).unwrap_or_default(),
                from_node_type: from_node.map(|n| n.r#type.as_str().to_string()).unwrap_or_default(),
                to_node_id: to_id.clone(),
                to_node_name: to_node.map(|n| n.name.clone()).unwrap_or_default(),
                to_node_type: to_node.map(|n| n.r#type.as_str().to_string()).unwrap_or_default(),
                length_m: Some(length_m),
                route_length_contribution_m: Some(length_m),
                attenuation_db_per_km: Some(att_rate),
                fiber_type: config.fiber_type.clone(),
                wavelength_nm: config.wavelength_nm,
                fiber_loss_db: Some((fiber_loss * 100.0).round() / 100.0),
                connectors_count: Some(config.connectors_per_link),
                connector_unit_loss_db: Some(config.connector_loss_db),
                connector_loss_db: Some(config.connectors_per_link as f64 * config.connector_loss_db),
                splices_count: Some(config.splices_per_link),
                splice_unit_loss_db: Some(config.splice_loss_db),
                splice_loss_db: Some(config.splices_per_link as f64 * config.splice_loss_db),
                pigtail_splices_count: Some(config.pigtail_splices_per_link),
                pigtail_splice_unit_loss_db: Some(config.pigtail_splice_loss_db),
                pigtail_splice_loss_db: Some(config.pigtail_splices_per_link as f64 * config.pigtail_splice_loss_db),
                total_segment_loss_db: Some((fiber_loss * 100.0).round() / 100.0),
            });
        }

        // Process splitters on nodes
        let mut total_splitter_loss = 0.0;
        for (pos, node_id) in path.node_ids.iter().enumerate() {
            if let Some(node) = nodes_by_id.get(node_id) {
                if let Some(s_info) = get_splitter_info_for_node(node, config) {
                    if let Some(loss) = s_info.loss_db {
                        total_splitter_loss += loss;
                        loss_breakdown.push(IntermediateOpticalLossItem {
                            component_id: format!("SPL-{}", node.id),
                            component: format!("Splitter {}", s_info.splitter_ratio.as_deref().unwrap_or("")),
                            category: "splitter".to_string(),
                            position: node.name.clone(),
                            quantity: Some(1.0),
                            quantity_unit: Some("piece".to_string()),
                            calculation_quantity: Some(1.0),
                            calculation_quantity_unit: Some("piece".to_string()),
                            unit_loss_db: Some(loss),
                            unit_loss_unit: Some("dB".to_string()),
                            total_loss_db: Some(loss),
                            cumulative_loss_db: Some(total_splitter_loss),
                            source: Some("configured".to_string()),
                            node_id: Some(node.id.clone()),
                            connection_id: None,
                            cable_segment_id: None,
                            cable_name: None,
                            cable_category: None,
                            path_position: pos,
                        });
                    }
                    splitters.push(s_info);
                }
            }
        }

        let connector_loss = config.connectors_per_link as f64 * config.connector_loss_db;
        let splice_loss = config.splices_per_link as f64 * config.splice_loss_db;
        let total_loss = total_fiber_loss + total_splitter_loss + connector_loss + splice_loss;
        let received_power = tx_power - total_loss;

        let sens_margin = received_power - rx_sens;
        let overload_margin = rx_overload - received_power;
        let net_margin = sens_margin - safety_margin;

        let pass = net_margin >= config.min_margin_db && received_power <= rx_overload;
        let status = if pass { "pass" } else { "fail" };

        let mut cat_losses = HashMap::new();
        cat_losses.insert("fiber".to_string(), Some((total_fiber_loss * 100.0).round() / 100.0));
        cat_losses.insert("splitter".to_string(), Some((total_splitter_loss * 100.0).round() / 100.0));
        cat_losses.insert("connector".to_string(), Some(connector_loss));
        cat_losses.insert("splice".to_string(), Some(splice_loss));

        let customers = customers_by_ont.get(&ont_node_id).cloned().unwrap_or_default();

        path_results.push(OpticalPathResult {
            ont_node_id: ont_node_id.clone(),
            customer_ids: customers,
            node_ids: path.node_ids.clone(),
            connection_ids: path.conn_ids.clone(),
            cable_segment_ids: path.cable_ids.clone(),
            length_m: Some((total_length_m * 100.0).round() / 100.0),
            loss_db: Some((total_loss * 100.0).round() / 100.0),
            tx_power_dbm: Some(tx_power),
            received_power_dbm: Some((received_power * 100.0).round() / 100.0),
            rx_sensitivity_dbm: Some(rx_sens),
            rx_overload_dbm: Some(rx_overload),
            sensitivity_margin_db: Some((sens_margin * 100.0).round() / 100.0),
            overload_margin_db: Some((overload_margin * 100.0).round() / 100.0),
            margin_db: Some((net_margin * 100.0).round() / 100.0),
            min_margin_db: Some(config.min_margin_db),
            status: status.to_string(),
            connectivity_status: "connected".to_string(),
            optical_budget_status: status.to_string(),
            physical_route_status: "planned".to_string(),
            status_reason: None,
            diagnostics: Vec::new(),
            calculation_limitations: Vec::new(),
            parameter_sources: config.parameter_sources.clone(),
            profile_id: config.profile_id.clone(),
            segments,
            splitters,
            details: None,
            component_losses: Vec::new(),
            standard_loss_db: None,
            standard_variance_db: None,
            datasheet_references: Vec::new(),
            field_measurements: Vec::new(),
            location_loss_summary: HashMap::new(),
            loss_breakdown,
            category_losses_db: cat_losses,
            design_margin_db: Some((net_margin * 100.0).round() / 100.0),
            total_design_allowance_db: Some(safety_margin),
        });
    }

    // Evaluate intermediate nodes (ODC, ODP)
    for (node_id, path) in &intermediate_traces {
        if let Some(node) = nodes_by_id.get(node_id) {
            let mut total_fiber_loss = 0.0;
            let mut total_length_m = 0.0;

            for cable_id in &path.cable_ids {
                if let Some(cable) = cables_by_id.get(cable_id) {
                    let length_m = cable
                        .length_m
                        .unwrap_or_else(|| calculate_route_length(&cable.geometry.coordinates));
                    total_length_m += length_m;
                    let fiber_loss = (length_m / 1000.0) * config.fiber_attenuation_db_per_km;
                    total_fiber_loss += fiber_loss;
                }
            }

            let mut total_splitter_loss = 0.0;
            let mut loss_breakdown = Vec::new();

            for (pos, n_id) in path.node_ids.iter().enumerate() {
                if let Some(n) = nodes_by_id.get(n_id) {
                    if let Some(s_info) = get_splitter_info_for_node(n, config) {
                        if let Some(loss) = s_info.loss_db {
                            total_splitter_loss += loss;
                            loss_breakdown.push(IntermediateOpticalLossItem {
                                component_id: format!("SPL-{}", n.id),
                                component: format!("Splitter {}", s_info.splitter_ratio.as_deref().unwrap_or("")),
                                category: "splitter".to_string(),
                                position: n.name.clone(),
                                quantity: Some(1.0),
                                quantity_unit: Some("piece".to_string()),
                                calculation_quantity: Some(1.0),
                                calculation_quantity_unit: Some("piece".to_string()),
                                unit_loss_db: Some(loss),
                                unit_loss_unit: Some("dB".to_string()),
                                total_loss_db: Some(loss),
                                cumulative_loss_db: Some(total_splitter_loss),
                                source: Some("configured".to_string()),
                                node_id: Some(n.id.clone()),
                                connection_id: None,
                                cable_segment_id: None,
                                cable_name: None,
                                cable_category: None,
                                path_position: pos,
                            });
                        }
                    }
                }
            }

            let accumulated_loss = total_fiber_loss + total_splitter_loss;
            let estimated_power = tx_power - accumulated_loss;

            let mut cat_losses = HashMap::new();
            cat_losses.insert("fiber".to_string(), Some((total_fiber_loss * 100.0).round() / 100.0));
            cat_losses.insert("splitter".to_string(), Some((total_splitter_loss * 100.0).round() / 100.0));

            let source_olt = path.node_ids.first().and_then(|id| nodes_by_id.get(id));

            intermediate_results.push(IntermediateOpticalResult {
                node_id: node.id.clone(),
                node_name: node.name.clone(),
                node_type: node.r#type.as_str().to_string(),
                status: "estimated".to_string(),
                physical_route_status: "planned".to_string(),
                source_olt_id: source_olt.map(|o| o.id.clone()),
                node_ids: path.node_ids.clone(),
                connection_ids: path.conn_ids.clone(),
                length_m: Some((total_length_m * 100.0).round() / 100.0),
                accumulated_loss_db: Some((accumulated_loss * 100.0).round() / 100.0),
                estimated_power_dbm: Some((estimated_power * 100.0).round() / 100.0),
                transmitter_power_dbm: Some(tx_power),
                design_margin_db: None,
                total_design_allowance_db: Some(safety_margin),
                source_olt_name: source_olt.map(|o| o.name.clone()),
                profile_id: config.profile_id.clone(),
                loss_breakdown,
                category_losses_db: cat_losses,
                parameter_sources: config.parameter_sources.clone(),
                diagnostics: Vec::new(),
            });
        }
    }

    // Per-connection optical link result
    let mut links = Vec::new();
    for conn in &project.connections {
        let cable = cables_by_id.get(&conn.cable_segment_id);
        let length_m = cable
            .and_then(|c| c.length_m)
            .unwrap_or_else(|| cable.map(|c| calculate_route_length(&c.geometry.coordinates)).unwrap_or(0.0));
        let loss = (length_m / 1000.0) * config.fiber_attenuation_db_per_km;

        links.push(OpticalLinkResult {
            connection_id: conn.id.clone(),
            length_m: Some((length_m * 100.0).round() / 100.0),
            loss_db: Some((loss * 100.0).round() / 100.0),
            received_power_dbm: None,
            status: "pass".to_string(),
            margin_db: None,
            details: None,
        });
    }

    // Customer disconnections
    let connected_ont_ids: HashSet<String> = paths_to_ont.iter().map(|p| p.node_ids.last().unwrap().clone()).collect();
    let disconnected_customer_ids: Vec<String> = project
        .customers
        .iter()
        .filter(|c| {
            c.ont_node_id
                .as_ref()
                .map(|ont| !connected_ont_ids.contains(ont))
                .unwrap_or(true)
        })
        .map(|c| c.id.clone())
        .collect();

    let pass_count = path_results.iter().filter(|p| p.status == "pass").count();
    let fail_count = path_results.iter().filter(|p| p.status == "fail").count();

    let summary = serde_json::json!({
        "totalPaths": path_results.len(),
        "passCount": pass_count,
        "failCount": fail_count,
        "disconnectedCustomersCount": disconnected_customer_ids.len(),
    });

    OpticalBudgetResult {
        project_id: project.id.clone(),
        calculated_at: current_utc_timestamp(),
        links,
        paths: path_results,
        intermediate_nodes: intermediate_results,
        disconnected_customer_ids,
        summary: Some(summary),
        diagnostics: Vec::new(),
    }
}
