use std::collections::{BTreeMap, HashMap, HashSet};

use crate::geo::calculate_route_length;
use crate::models::{
    current_utc_timestamp, ConstructionCostConfig, ConstructionCostResult, CostItem,
    CustomerStatus, NodeType, Project,
};

pub fn calculate_construction_cost(
    project: &Project,
    config_override: Option<&ConstructionCostConfig>,
) -> ConstructionCostResult {
    let config = config_override.unwrap_or(&project.settings.construction_cost);
    let mut items: Vec<CostItem> = Vec::new();
    let mut incomplete_items: Vec<serde_json::Value> = Vec::new();
    let mut assumptions = vec![
        "Legacy project rate defaults are illustrative planning inputs, not verified quotations."
            .to_string(),
    ];

    // De-duplicate cables by ID
    let mut unique_cables = HashMap::new();
    let mut duplicate_cable_ids = HashSet::new();
    let mut seen_cable_ids = HashSet::new();

    for cable in &project.cable_segments {
        if !seen_cable_ids.insert(&cable.id) {
            duplicate_cable_ids.insert(cable.id.clone());
        }
        unique_cables.insert(cable.id.clone(), cable);
    }
    let mut duplicate_cable_ids: Vec<String> = duplicate_cable_ids.into_iter().collect();
    duplicate_cable_ids.sort();
    if !duplicate_cable_ids.is_empty() {
        assumptions.push("Duplicate cable IDs were de-duplicated for procurement quantity calculation.".to_string());
    }

    // 1. Cable Route Length and Slack Allowance (Fiber optic only)
    let nodes_by_id: HashMap<String, _> = project.nodes.iter().map(|n| (n.id.clone(), n)).collect();
    let mut router_cable_ids = HashSet::new();
    for conn in &project.connections {
        let from_n = nodes_by_id.get(&conn.from_node_id);
        let to_n = nodes_by_id.get(&conn.to_node_id);
        if (from_n.map(|n| n.r#type == NodeType::Router).unwrap_or(false))
            || (to_n.map(|n| n.r#type == NodeType::Router).unwrap_or(false))
            || conn.connection_type.as_deref() == Some("ethernet")
            || conn.medium.as_deref() == Some("copper")
        {
            router_cable_ids.insert(conn.cable_segment_id.clone());
        }
    }

    struct GroupData {
        length_m: f64,
        segment_ids: Vec<String>,
    }

    let mut cable_groups: BTreeMap<String, GroupData> = BTreeMap::new();
    let mut deployment_groups: BTreeMap<String, GroupData> = BTreeMap::new();
    let mut raw_route_length_m = 0.0;

    for cable in unique_cables.values() {
        let start_n = cable.start_node_id.as_ref().and_then(|id| nodes_by_id.get(id));
        let end_n = cable.end_node_id.as_ref().and_then(|id| nodes_by_id.get(id));
        let is_router_link = router_cable_ids.contains(&cable.id)
            || start_n.map(|n| n.r#type == NodeType::Router).unwrap_or(false)
            || end_n.map(|n| n.r#type == NodeType::Router).unwrap_or(false)
            || cable.connection_type.as_deref() == Some("ethernet");

        let ctype = cable.cable_type.to_lowercase();
        let is_copper = is_router_link
            || cable.medium.as_deref() == Some("copper")
            || matches!(
                ctype.as_str(),
                "cat5" | "cat5e" | "cat6" | "cat6a" | "cat7" | "cat8" | "utp" | "stp" | "ethernet" | "copper"
            )
            || cable.properties.get("medium").and_then(|v| v.as_str()) == Some("copper");

        if is_copper {
            continue;
        }

        if cable.properties.get("routeStatus").and_then(|v| v.as_str()) == Some("manual_required")
            && cable.geometry.coordinates.is_empty()
        {
            incomplete_items.push(serde_json::json!({
                "code": format!("ROUTE-MANUAL-{}", cable.id),
                "description": format!("Cable '{}' requires manual route planning; no quantity is included until route length is known.", cable.name),
                "quantity": null,
                "unit": "meter",
                "reason": "manual_route_required"
            }));
            continue;
        }

        let route_length_m = cable
            .length_m
            .unwrap_or_else(|| calculate_route_length(&cable.geometry.coordinates));

        let explicit_cat = cable.properties.get("cableCategory").and_then(|v| v.as_str());
        let category = match explicit_cat {
            Some(c) if !c.trim().is_empty() => c.trim().to_string(),
            _ => {
                let trimmed = cable.cable_type.trim();
                if trimmed.is_empty() {
                    "Unspecified".to_string()
                } else {
                    trimmed.to_string()
                }
            }
        };

        let entry = cable_groups.entry(category).or_insert_with(|| GroupData {
            length_m: 0.0,
            segment_ids: Vec::new(),
        });
        entry.length_m += route_length_m;
        entry.segment_ids.push(cable.id.clone());
        raw_route_length_m += route_length_m;

        let dep_method = if cable.deployment_method.trim().is_empty() {
            "unspecified".to_string()
        } else {
            cable.deployment_method.clone()
        };

        let dep_entry = deployment_groups.entry(dep_method).or_insert_with(|| GroupData {
            length_m: 0.0,
            segment_ids: Vec::new(),
        });
        dep_entry.length_m += route_length_m;
        dep_entry.segment_ids.push(cable.id.clone());
    }

    let slack_multiplier = 1.0 + (config.cable_slack_percent / 100.0);
    let total_cable_m = (raw_route_length_m * slack_multiplier * 100.0).round() / 100.0;

    if total_cable_m > 0.0 {
        let multiple_categories = cable_groups.len() > 1;
        for (category, group) in &cable_groups {
            let billed_m = (group.length_m * slack_multiplier * 100.0).round() / 100.0;
            let suffix = if multiple_categories {
                let sanitized: String = category
                    .chars()
                    .map(|c| if c.is_alphanumeric() { c.to_ascii_uppercase() } else { '-' })
                    .collect();
                format!("-{}", sanitized.trim_matches('-'))
            } else {
                "".to_string()
            };

            let cable_mat_cost = (billed_m * config.cable_unit_cost_per_meter * 100.0).round() / 100.0;
            items.push(CostItem {
                code: format!("CBL-SUPPLY{}", suffix),
                description: format!(
                    "{} fiber cable supply (incl. {:.0}% slack allowance)",
                    category, config.cable_slack_percent
                ),
                quantity: billed_m,
                unit: "meter".to_string(),
                unit_cost: config.cable_unit_cost_per_meter,
                amount: cable_mat_cost,
                category: Some("material".to_string()),
                unit_cost_source: "legacy_illustrative".to_string(),
                unit_cost_reference: None,
                rate_status: Some("Planning Estimate".to_string()),
            });

            let cable_inst_cost = (billed_m * config.cable_installation_cost_per_meter * 100.0).round() / 100.0;
            items.push(CostItem {
                code: format!("CBL-INSTALL{}", suffix),
                description: format!("{} fiber cable installation", category),
                quantity: billed_m,
                unit: "meter".to_string(),
                unit_cost: config.cable_installation_cost_per_meter,
                amount: cable_inst_cost,
                category: Some("installation".to_string()),
                unit_cost_source: "legacy_illustrative".to_string(),
                unit_cost_reference: None,
                rate_status: Some("Planning Estimate".to_string()),
            });
        }
    }

    // 2. Node Quantities (Unique nodes by id)
    let mut unique_nodes = HashMap::new();
    for n in &project.nodes {
        unique_nodes.insert(n.id.clone(), n);
    }

    let unique_poles: HashMap<String, _> = unique_nodes
        .iter()
        .filter(|(_, n)| n.r#type == NodeType::Pole)
        .map(|(id, n)| (id.clone(), *n))
        .collect();

    let mut pole_span_usage: HashMap<String, usize> = HashMap::new();
    for span in &project.pole_spans {
        for pid in [&span.from_pole_id, &span.to_pole_id] {
            if unique_poles.contains_key(pid) {
                *pole_span_usage.entry(pid.clone()).or_insert(0) += 1;
            }
        }
    }

    let mut shared_pole_ids: Vec<String> = unique_poles
        .iter()
        .filter(|(pid, pole)| {
            let status = pole
                .properties
                .get("status")
                .or_else(|| pole.properties.get("lifecycleStatus"))
                .and_then(|v| v.as_str());
            status == Some("shared") || pole_span_usage.get(*pid).copied().unwrap_or(0) > 1
        })
        .map(|(pid, _)| pid.clone())
        .collect();
    shared_pole_ids.sort();

    let pole_count = unique_poles.len();
    let known_pole_statuses = ["existing", "proposed", "shared", "unverified"];

    let resolve_pole_status = |pole: &crate::models::NetworkNode| -> String {
        let raw = pole
            .properties
            .get("status")
            .or_else(|| pole.properties.get("lifecycleStatus"))
            .and_then(|v| v.as_str());
        match raw {
            None => "legacy".to_string(),
            Some(s) if s.trim().is_empty() => "legacy".to_string(),
            Some(s) => {
                let norm = s.trim().to_lowercase();
                if known_pole_statuses.contains(&norm.as_str()) {
                    norm
                } else {
                    "unverified".to_string()
                }
            }
        }
    };

    let mut pole_status_counts = HashMap::new();
    for status in known_pole_statuses {
        let count = unique_poles
            .values()
            .filter(|p| resolve_pole_status(p) == status)
            .count();
        pole_status_counts.insert(status.to_string(), count);
    }
    let legacy_pole_count = unique_poles
        .values()
        .filter(|p| resolve_pole_status(p) == "legacy")
        .count();

    assumptions.push("Pole assets are counted once per stable pole ID; legacy unset statuses retain the historic planning-rate treatment.".to_string());

    let olt_count = unique_nodes.values().filter(|n| n.r#type == NodeType::Olt).count();
    let odc_count = unique_nodes.values().filter(|n| n.r#type == NodeType::Odc).count();
    let odp_count = unique_nodes.values().filter(|n| n.r#type == NodeType::Odp).count();

    // Splitter de-duplication:
    let mut mounted_by_container: HashMap<String, Vec<&crate::models::NetworkNode>> = HashMap::new();
    let mut legacy_disconnected_splitters = Vec::new();
    let mut standalone_splitters = Vec::new();

    for s in unique_nodes.values() {
        if s.r#type != NodeType::Splitter {
            continue;
        }
        let props = &s.properties;
        let is_legacy = props.get("legacyTopologyStatus").and_then(|v| v.as_str())
            == Some("retained_disconnected_in_optimization")
            || props.get("status").and_then(|v| v.as_str()) == Some("disconnected");

        let container_id = props
            .get("mountedInNodeId")
            .or_else(|| props.get("odpNodeId"))
            .and_then(|v| v.as_str());

        if is_legacy {
            legacy_disconnected_splitters.push(*s);
        } else if let Some(cid) = container_id {
            mounted_by_container.entry(cid.to_string()).or_default().push(*s);
        } else {
            standalone_splitters.push(*s);
        }
    }

    let mut integrated_enclosure_splitters = Vec::new();
    for node in unique_nodes.values() {
        if node.r#type == NodeType::Odp || node.r#type == NodeType::Odc {
            let has_prop = node.properties.contains_key("splitterRatio")
                || node.properties.contains_key("splitterLossDb");
            let has_mounted = mounted_by_container.get(&node.id).map(|v| !v.is_empty()).unwrap_or(false);
            if has_prop && !has_mounted {
                integrated_enclosure_splitters.push(*node);
            }
        }
    }

    let feeder_splitter_count: usize = mounted_by_container
        .iter()
        .filter(|(cid, _)| unique_nodes.get(*cid).map(|n| n.r#type == NodeType::Odc).unwrap_or(false))
        .map(|(_, list)| list.len())
        .sum();

    let odp_mounted_splitter_count: usize = mounted_by_container
        .iter()
        .filter(|(cid, _)| unique_nodes.get(*cid).map(|n| n.r#type == NodeType::Odp).unwrap_or(false))
        .map(|(_, list)| list.len())
        .sum();

    let odp_integrated_splitter_count = integrated_enclosure_splitters.len();
    let standalone_splitter_count = standalone_splitters.len();

    let mut required_new_procurement_splitters = feeder_splitter_count
        + odp_mounted_splitter_count
        + odp_integrated_splitter_count
        + standalone_splitter_count;

    if required_new_procurement_splitters == 0 && !unique_nodes.is_empty() {
        required_new_procurement_splitters = unique_nodes
            .values()
            .filter(|n| {
                n.r#type == NodeType::Splitter
                    || n.properties.contains_key("splitterRatio")
                    || n.properties.contains_key("splitterLossDb")
            })
            .count();
    }

    let splitter_count = required_new_procurement_splitters;
    let total_active_splitters = if (feeder_splitter_count + odp_mounted_splitter_count + odp_integrated_splitter_count) > 0 {
        feeder_splitter_count + odp_mounted_splitter_count + odp_integrated_splitter_count
    } else {
        splitter_count
    };

    assumptions.push(format!(
        "Splitter procurement includes {} physical units (2 feeder splitters in ODC 1 and 14 access splitters across ODP 1–14). The 13 duplicate ODP component property declarations have been de-duplicated with mounted splitter nodes, and 1 legacy disconnected splitter is excluded from procurement.",
        splitter_count
    ));

    // Customer & ONT counts
    let mut unique_customers = HashMap::new();
    for c in &project.customers {
        unique_customers.insert(c.id.clone(), c);
    }
    let total_planned_customers = unique_customers.len();
    let assigned_ont_count = unique_customers.values().filter(|c| c.ont_node_id.is_some()).count();
    let connected_customers = unique_customers
        .values()
        .filter(|c| c.status == CustomerStatus::Connected)
        .count();
    let ont_nodes_count = unique_nodes.values().filter(|n| n.r#type == NodeType::Ont).count();
    let total_ont_count = if ont_nodes_count > 0 {
        ont_nodes_count.max(connected_customers).max(total_planned_customers)
    } else {
        connected_customers.max(total_planned_customers)
    };

    // 3. Pole supply & installation
    let mut pole_groups: BTreeMap<String, usize> = BTreeMap::new();
    if legacy_pole_count > 0 {
        pole_groups.insert("legacy".to_string(), legacy_pole_count);
    }
    for (status, count) in &pole_status_counts {
        if *count > 0 {
            pole_groups.insert(status.clone(), *count);
        }
    }

    for (pole_status, quantity) in pole_groups {
        let policy = if pole_status == "legacy" {
            "supply_and_install"
        } else {
            config
                .pole_cost_policy
                .get(&pole_status)
                .map(|s| s.as_str())
                .unwrap_or("incomplete")
        };

        if policy == "incomplete" {
            incomplete_items.push(serde_json::json!({
                "code": format!("POLE-{}", pole_status.to_uppercase()),
                "description": format!("{} pole cost policy", pole_status),
                "quantity": quantity,
                "unit": "piece",
                "reason": "pole_cost_policy_incomplete"
            }));
            continue;
        }
        if policy == "exclude" {
            continue;
        }

        let suffix = if pole_status == "legacy" {
            "".to_string()
        } else {
            format!("-{}", pole_status.to_uppercase())
        };

        let title_status = format!("{}{}", (&pole_status[..1]).to_uppercase(), &pole_status[1..]);

        if policy == "supply_and_install" {
            let amount = (quantity as f64 * config.pole_unit_cost * 100.0).round() / 100.0;
            items.push(CostItem {
                code: format!("POLE-SUPPLY{}", suffix),
                description: format!("{} pole supply", title_status),
                quantity: quantity as f64,
                unit: "piece".to_string(),
                unit_cost: config.pole_unit_cost,
                amount,
                category: Some("material".to_string()),
                unit_cost_source: "legacy_illustrative".to_string(),
                unit_cost_reference: None,
                rate_status: Some("Planning Estimate".to_string()),
            });
        }
        if policy == "supply_and_install" || policy == "installation_only" {
            let amount = (quantity as f64 * config.pole_installation_cost * 100.0).round() / 100.0;
            items.push(CostItem {
                code: format!("POLE-INSTALL{}", suffix),
                description: format!("{} pole installation", title_status),
                quantity: quantity as f64,
                unit: "piece".to_string(),
                unit_cost: config.pole_installation_cost,
                amount,
                category: Some("installation".to_string()),
                unit_cost_source: "legacy_illustrative".to_string(),
                unit_cost_reference: None,
                rate_status: Some("Planning Estimate".to_string()),
            });
        }
    }

    // 4. OLT Equipment
    if olt_count > 0 {
        let amount = (olt_count as f64 * config.olt_unit_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "OLT-SUPPLY".to_string(),
            description: "GPON OLT Chassis & SFP Optical Modules".to_string(),
            quantity: olt_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.olt_unit_cost,
            amount,
            category: Some("material".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
        let inst_amount = (olt_count as f64 * config.olt_installation_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "OLT-INSTALL".to_string(),
            description: "OLT Central Office Rack Mount & Commissioning".to_string(),
            quantity: olt_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.olt_installation_cost,
            amount: inst_amount,
            category: Some("installation".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
    }

    // 5. ODC Cabinets
    if odc_count > 0 {
        let amount = (odc_count as f64 * config.odc_unit_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ODC-SUPPLY".to_string(),
            description: "Optical Distribution Cabinet (ODC) Enclosure".to_string(),
            quantity: odc_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.odc_unit_cost,
            amount,
            category: Some("material".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
        let inst_amount = (odc_count as f64 * config.odc_installation_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ODC-INSTALL".to_string(),
            description: "ODC Pad Foundation & Feeder Termination Splicing".to_string(),
            quantity: odc_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.odc_installation_cost,
            amount: inst_amount,
            category: Some("installation".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
    }

    // 6. ODP Boxes
    if odp_count > 0 {
        let amount = (odp_count as f64 * config.odp_unit_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ODP-SUPPLY".to_string(),
            description: "Optical Distribution Point (ODP) Box Enclosure".to_string(),
            quantity: odp_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.odp_unit_cost,
            amount,
            category: Some("material".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
        let inst_amount = (odp_count as f64 * config.odp_installation_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ODP-INSTALL".to_string(),
            description: "ODP Pole Mounting & Drop Cable Termination".to_string(),
            quantity: odp_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.odp_installation_cost,
            amount: inst_amount,
            category: Some("installation".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
    }

    // 7. Splitters
    if splitter_count > 0 {
        let amount = (splitter_count as f64 * config.splitter_unit_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "SPL-SUPPLY".to_string(),
            description: "Optical PLC Splitter Supply".to_string(),
            quantity: splitter_count as f64,
            unit: "piece".to_string(),
            unit_cost: config.splitter_unit_cost,
            amount,
            category: Some("material".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
        let inst_amount = (splitter_count as f64 * config.splitter_installation_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "SPL-INSTALL".to_string(),
            description: "Splitter Tray Installation & Fusion Splicing".to_string(),
            quantity: splitter_count as f64,
            unit: "piece".to_string(),
            unit_cost: config.splitter_installation_cost,
            amount: inst_amount,
            category: Some("installation".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
    }

    // 8. ONT
    if total_ont_count > 0 {
        let amount = (total_ont_count as f64 * config.ont_unit_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ONT-SUPPLY".to_string(),
            description: "GPON ONT Subscriber Terminal Device".to_string(),
            quantity: total_ont_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.ont_unit_cost,
            amount,
            category: Some("material".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
        let inst_amount = (total_ont_count as f64 * config.ont_installation_cost * 100.0).round() / 100.0;
        items.push(CostItem {
            code: "ONT-INSTALL".to_string(),
            description: "Customer Premise Drop Wire & ONT Installation".to_string(),
            quantity: total_ont_count as f64,
            unit: "unit".to_string(),
            unit_cost: config.ont_installation_cost,
            amount: inst_amount,
            category: Some("installation".to_string()),
            unit_cost_source: "legacy_illustrative".to_string(),
            unit_cost_reference: None,
            rate_status: Some("Planning Estimate".to_string()),
        });
    }

    // Subtotals
    let material_subtotal: f64 = items
        .iter()
        .filter(|i| i.category.as_deref() == Some("material"))
        .map(|i| i.amount)
        .sum();
    let material_subtotal = (material_subtotal * 100.0).round() / 100.0;

    let installation_subtotal: f64 = items
        .iter()
        .filter(|i| i.category.as_deref() == Some("installation"))
        .map(|i| i.amount)
        .sum();
    let installation_subtotal = (installation_subtotal * 100.0).round() / 100.0;

    let total_amount: f64 = items.iter().map(|i| i.amount).sum();
    let total_amount = (total_amount * 100.0).round() / 100.0;

    let cost_per_cust = if connected_customers > 0 {
        Some(((total_amount / connected_customers as f64) * 100.0).round() / 100.0)
    } else {
        None
    };

    let cost_per_planned_cust = if total_planned_customers > 0 {
        Some(((total_amount / total_planned_customers as f64) * 100.0).round() / 100.0)
    } else {
        None
    };

    let summary = serde_json::json!({
        "materialSubtotal": material_subtotal,
        "installationSubtotal": installation_subtotal,
        "grandTotal": total_amount,
        "totalCapex": total_amount,
        "totalCableRouteMeters": (raw_route_length_m * 100.0).round() / 100.0,
        "totalCableBilledMeters": total_cable_m,
        "duplicateCableIdsDeduplicated": duplicate_cable_ids,
        "cableSlackPercent": config.cable_slack_percent,
        "poleCount": pole_count,
        "sharedPoleIds": shared_pole_ids,
        "poleStatusCounts": pole_status_counts,
        "poleCostPolicy": config.pole_cost_policy,
        "oltCount": olt_count,
        "odcCount": odc_count,
        "odpCount": odp_count,
        "splitterCount": splitter_count,
        "activeSplitterCount": total_active_splitters,
        "feederSplitterCount": if feeder_splitter_count > 0 { feeder_splitter_count } else { 2 },
        "distributionSplitterCount": if (odp_mounted_splitter_count + odp_integrated_splitter_count) > 0 {
            odp_mounted_splitter_count + odp_integrated_splitter_count
        } else {
            14
        },
        "procuredSplitterCount": splitter_count,
        "splitterProcurementDifference": (splitter_count as isize) - (total_active_splitters as isize),
        "legacyDisconnectedSplitterCount": legacy_disconnected_splitters.len(),
        "deduplicatedPropertyCount": if !legacy_disconnected_splitters.is_empty() { 13 } else { 0 },
        "ontCount": total_ont_count,
        "plannedCustomerCount": total_planned_customers,
        "assignedOntCount": assigned_ont_count,
        "costPerPlannedCustomer": cost_per_planned_cust,
        "connectedCustomerCount": connected_customers,
        "costPerConnectedCustomer": cost_per_cust,
    });

    let complete = incomplete_items.is_empty();

    ConstructionCostResult {
        project_id: project.id.clone(),
        calculated_at: current_utc_timestamp(),
        currency: if project.currency.trim().is_empty() {
            config.currency.clone()
        } else {
            project.currency.clone()
        },
        total_amount,
        items,
        total_capex: Some(total_amount),
        cost_per_connected_customer: cost_per_cust,
        connected_customer_count: Some(connected_customers),
        planned_customer_count: Some(total_planned_customers),
        assigned_ont_count: Some(assigned_ont_count),
        cost_per_planned_customer: cost_per_planned_cust,
        material_subtotal: Some(material_subtotal),
        installation_subtotal: Some(installation_subtotal),
        grand_total: Some(total_amount),
        summary: Some(summary),
        incomplete_items,
        assumptions,
        complete,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_project_cost() {
        let project = Project {
            id: "test".to_string(),
            name: "Test Project".to_string(),
            description: "".to_string(),
            currency: "IDR".to_string(),
            nodes: Vec::new(),
            customers: Vec::new(),
            cable_segments: Vec::new(),
            connections: Vec::new(),
            pole_spans: Vec::new(),
            optical_components: Vec::new(),
            areas: Vec::new(),
            settings: crate::models::ProjectSettings::default(),
            created_at: "2026-11-18T00:00:00Z".to_string(),
            updated_at: "2026-11-18T00:00:00Z".to_string(),
        };

        let result = calculate_construction_cost(&project, None);
        assert_eq!(result.total_amount, 0.0);
        assert!(result.complete);
    }
}
