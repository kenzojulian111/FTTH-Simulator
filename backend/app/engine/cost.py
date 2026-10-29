"""Construction cost and Bill of Quantities (BoQ) calculation engine."""

from typing import List, Optional
from backend.app.domain.models import (
    ConstructionCostConfig,
    ConstructionCostResult,
    CostItem,
    CustomerStatus,
    NodeType,
    Project,
    current_utc_timestamp,
)
from backend.app.engine.geo import calculate_route_length


def calculate_construction_cost(
    project: Project,
    config_override: Optional[ConstructionCostConfig] = None,
) -> ConstructionCostResult:
    """Calculate the Bill of Quantities (BoQ) and estimated construction CAPEX."""
    config = config_override or project.settings.construction_cost
    items: List[CostItem] = []
    incomplete_items = []
    assumptions = ["Legacy project rate defaults are illustrative planning inputs, not verified quotations."]
    unique_cables = {cable.id: cable for cable in project.cable_segments}
    duplicate_cable_ids = sorted({cable.id for cable in project.cable_segments if sum(1 for item in project.cable_segments if item.id == cable.id) > 1})
    if duplicate_cable_ids:
        assumptions.append("Duplicate cable IDs were de-duplicated for procurement quantity calculation.")

    # 1. Cable Route Length and Slack Allowance (Fiber optic only)
    nodes_by_id = {n.id: n for n in project.nodes}
    router_cable_ids = set()
    for conn in project.connections:
        from_n = nodes_by_id.get(conn.from_node_id)
        to_n = nodes_by_id.get(conn.to_node_id)
        if (
            (from_n and from_n.type == NodeType.ROUTER)
            or (to_n and to_n.type == NodeType.ROUTER)
            or conn.connection_type == "ethernet"
            or conn.medium == "copper"
        ):
            router_cable_ids.add(conn.cable_segment_id)

    cable_groups = {}
    deployment_groups: dict[str, dict] = {}
    raw_route_length_m = 0.0
    for cable in unique_cables.values():
        start_n = nodes_by_id.get(cable.start_node_id) if cable.start_node_id else None
        end_n = nodes_by_id.get(cable.end_node_id) if cable.end_node_id else None
        is_router_link = (
            cable.id in router_cable_ids
            or (start_n and start_n.type == NodeType.ROUTER)
            or (end_n and end_n.type == NodeType.ROUTER)
            or cable.connection_type == "ethernet"
        )
        is_copper = (
            is_router_link
            or cable.medium == "copper"
            or cable.cable_type.lower() in ("cat5", "cat5e", "cat6", "cat6a", "cat7", "cat8", "utp", "stp", "ethernet", "copper")
            or cable.properties.get("medium") == "copper"
        )
        if is_copper:
            continue
        route_length_m = float(cable.length_m) if cable.length_m is not None else calculate_route_length(cable.geometry.coordinates)
        explicit_cat = cable.properties.get("cableCategory")
        category = (
            explicit_cat.strip()
            if isinstance(explicit_cat, str) and explicit_cat.strip()
            else (cable.cable_type.strip() or "Unspecified")
        )
        group = cable_groups.setdefault(category, {"lengthM": 0.0, "segmentIds": []})
        group["lengthM"] += route_length_m
        group["segmentIds"].append(cable.id)
        raw_route_length_m += route_length_m

        dep_method = cable.deployment_method or "unspecified"
        dep_group = deployment_groups.setdefault(dep_method, {"lengthM": 0.0, "segmentIds": []})
        dep_group["lengthM"] += route_length_m
        dep_group["segmentIds"].append(cable.id)

        if cable.properties.get("deploymentMethodMalformed") is True:
            incomplete_items.append({
                "code": f"DEP-MALFORMED-{cable.id}",
                "description": f"Cable '{cable.name}' has malformed deploymentMethod '{cable.properties.get('rawDeploymentMethod')}'",
                "quantity": round(route_length_m, 2),
                "unit": "meter",
                "reason": "malformed_deployment_method",
            })

    slack_multiplier = 1.0 + (config.cable_slack_percent / 100.0)
    total_cable_m = round(raw_route_length_m * slack_multiplier, 2)

    if total_cable_m > 0:
        multiple_categories = len(cable_groups) > 1
        for category, group in sorted(cable_groups.items()):
            physical_m = group["lengthM"]
            billed_m = round(physical_m * slack_multiplier, 2)
            suffix = "-" + "".join(char if char.isalnum() else "-" for char in category.upper()).strip("-") if multiple_categories else ""
            cable_material_cost = round(billed_m * config.cable_unit_cost_per_meter, 2)
            items.append(CostItem(code=f"CBL-SUPPLY{suffix}", description=f"{category} fiber cable supply (incl. {config.cable_slack_percent:.0f}% slack allowance)", quantity=billed_m, unit="meter", unit_cost=config.cable_unit_cost_per_meter, amount=cable_material_cost, category="material"))
            cable_install_cost = round(billed_m * config.cable_installation_cost_per_meter, 2)
            items.append(CostItem(code=f"CBL-INSTALL{suffix}", description=f"{category} fiber cable installation", quantity=billed_m, unit="meter", unit_cost=config.cable_installation_cost_per_meter, amount=cable_install_cost, category="installation"))

    # 1b. Optional deployment-specific civil / attachment costs (underground, building_attached, other, unspecified)
    any_deployment_specific_rate_configured = any(
        getattr(config, attr) is not None or config.rate_sources.get(wire_key) == "unknown"
        for attr, wire_key in (
            ("duct_unit_cost_per_meter", "ductUnitCostPerMeter"),
            ("trenching_cost_per_meter", "trenchingCostPerMeter"),
            ("excavation_cost_per_meter", "excavationCostPerMeter"),
            ("warning_tape_cost_per_meter", "warningTapeCostPerMeter"),
            ("underground_installation_cost_per_meter", "undergroundInstallationCostPerMeter"),
            ("building_attachment_cost_per_meter", "buildingAttachmentCostPerMeter"),
            ("other_deployment_cost_per_meter", "otherDeploymentCostPerMeter"),
        )
    )

    underground_m = round(deployment_groups.get("underground", {}).get("lengthM", 0.0), 2)
    if underground_m > 0:
        underground_specs = (
            ("UG-DUCT-SUPPLY", "Underground HDPE sub-duct supply", config.duct_unit_cost_per_meter, "ductUnitCostPerMeter", "material"),
            ("UG-TRENCH", "Underground trenching work", config.trenching_cost_per_meter, "trenchingCostPerMeter", "installation"),
            ("UG-EXCAVATION", "Underground excavation & reinstatement", config.excavation_cost_per_meter, "excavationCostPerMeter", "installation"),
            ("UG-WARNTAPE-SUPPLY", "Underground optical warning tape supply", config.warning_tape_cost_per_meter, "warningTapeCostPerMeter", "material"),
            ("UG-INSTALL", "Underground duct pulling & civil installation", config.underground_installation_cost_per_meter, "undergroundInstallationCostPerMeter", "installation"),
        )
        for code, desc, rate_val, wire_key, cat in underground_specs:
            if config.rate_sources.get(wire_key) == "unknown":
                incomplete_items.append({"code": code, "description": desc, "quantity": underground_m, "unit": "meter", "reason": "unit_rate_unknown"})
            elif rate_val is not None:
                items.append(CostItem(
                    code=code,
                    description=desc,
                    quantity=underground_m,
                    unit="meter",
                    unit_cost=rate_val,
                    amount=round(underground_m * rate_val, 2),
                    category=cat,
                    unit_cost_source="configured",
                    unit_cost_reference=config.rate_references.get(wire_key),
                ))

    building_m = round(deployment_groups.get("building_attached", {}).get("lengthM", 0.0), 2)
    if building_m > 0:
        if config.rate_sources.get("buildingAttachmentCostPerMeter") == "unknown":
            incomplete_items.append({"code": "BLDG-ATTACH-INSTALL", "description": "Building-attached routing & clamping installation", "quantity": building_m, "unit": "meter", "reason": "unit_rate_unknown"})
        elif config.building_attachment_cost_per_meter is not None:
            items.append(CostItem(
                code="BLDG-ATTACH-INSTALL",
                description="Building-attached routing & clamping installation",
                quantity=building_m,
                unit="meter",
                unit_cost=config.building_attachment_cost_per_meter,
                amount=round(building_m * config.building_attachment_cost_per_meter, 2),
                category="installation",
                unit_cost_source="configured",
                unit_cost_reference=config.rate_references.get("buildingAttachmentCostPerMeter"),
            ))

    other_m = round(deployment_groups.get("other", {}).get("lengthM", 0.0), 2)
    if other_m > 0:
        if config.rate_sources.get("otherDeploymentCostPerMeter") == "unknown":
            incomplete_items.append({"code": "DEP-OTHER-INSTALL", "description": "Other deployment installation", "quantity": other_m, "unit": "meter", "reason": "unit_rate_unknown"})
        elif config.other_deployment_cost_per_meter is not None:
            items.append(CostItem(
                code="DEP-OTHER-INSTALL",
                description="Other deployment installation",
                quantity=other_m,
                unit="meter",
                unit_cost=config.other_deployment_cost_per_meter,
                amount=round(other_m * config.other_deployment_cost_per_meter, 2),
                category="installation",
                unit_cost_source="configured",
                unit_cost_reference=config.rate_references.get("otherDeploymentCostPerMeter"),
            ))
        elif config.require_deployment_method_for_cable_cost:
            incomplete_items.append({
                "code": "DEP-OTHER-INSTALL",
                "description": "Other cable deployment cost input",
                "quantity": other_m,
                "unit": "meter",
                "reason": "other_deployment_cost_not_configured",
            })

    unspecified_m = round(deployment_groups.get("unspecified", {}).get("lengthM", 0.0), 2)
    if unspecified_m > 0 and (config.require_deployment_method_for_cable_cost or any_deployment_specific_rate_configured):
        incomplete_items.append({
            "code": "DEP-UNSPECIFIED",
            "description": "Unspecified cable deployment method (deployment-specific civil/attachment rates are active)",
            "quantity": unspecified_m,
            "unit": "meter",
            "reason": "deployment_method_unspecified",
        })


    # 2. Node Quantities (Shared poles across multiple spans/cables and all device nodes are counted once by physical ID)
    unique_nodes = {n.id: n for n in project.nodes}
    duplicate_node_ids = sorted({n.id for n in project.nodes if sum(1 for item in project.nodes if item.id == n.id) > 1})
    if duplicate_node_ids:
        assumptions.append("Duplicate node IDs were de-duplicated for procurement quantity calculation.")
    unique_poles = {n.id: n for n in unique_nodes.values() if n.type == NodeType.POLE}
    pole_span_usage: dict[str, int] = {}
    for span in project.pole_spans:
        for pid in (span.from_pole_id, span.to_pole_id):
            if pid in unique_poles:
                pole_span_usage[pid] = pole_span_usage.get(pid, 0) + 1
    shared_pole_ids = sorted(
        pid
        for pid, pole in unique_poles.items()
        if pole.properties.get("status", pole.properties.get("lifecycleStatus")) == "shared"
        or pole_span_usage.get(pid, 0) > 1
    )
    pole_count = len(unique_poles)
    known_pole_statuses = ("existing", "proposed", "shared", "unverified")

    def _resolve_pole_status(pole) -> str:
        raw = pole.properties.get("status", pole.properties.get("lifecycleStatus"))
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            return "legacy"
        normalized = str(raw).strip().lower()
        return normalized if normalized in known_pole_statuses else "unverified"

    pole_status_counts = {
        status: sum(1 for pole in unique_poles.values() if _resolve_pole_status(pole) == status)
        for status in known_pole_statuses
    }
    legacy_pole_count = sum(1 for pole in unique_poles.values() if _resolve_pole_status(pole) == "legacy")
    assumptions.append("Pole assets are counted once per stable pole ID; legacy unset statuses retain the historic planning-rate treatment.")
    olt_count = sum(1 for n in unique_nodes.values() if n.type == NodeType.OLT)
    odc_count = sum(1 for n in unique_nodes.values() if n.type == NodeType.ODC)
    odp_count = sum(1 for n in unique_nodes.values() if n.type == NodeType.ODP)

    # Splitter count: SPLITTER nodes + any splitter declared in node properties
    splitter_count = sum(
        1 for n in unique_nodes.values()
        if n.type == NodeType.SPLITTER or "splitterRatio" in n.properties or "splitterLossDb" in n.properties
    )

    # ONT count: ONT nodes + connected customers (deduplicated by customer ID)
    unique_customers = {c.id: c for c in project.customers}
    connected_customers = sum(1 for c in unique_customers.values() if c.status == CustomerStatus.CONNECTED)
    ont_nodes_count = sum(1 for n in unique_nodes.values() if n.type == NodeType.ONT)
    total_ont_count = max(ont_nodes_count, connected_customers)

    # 3. Pole supply and installation follow explicit lifecycle cost policies.
    pole_groups = {"legacy": legacy_pole_count}
    pole_groups.update(pole_status_counts)
    for pole_status, quantity in pole_groups.items():
        if quantity <= 0:
            continue
        policy = "supply_and_install" if pole_status == "legacy" else config.pole_cost_policy.get(pole_status, "incomplete")
        if policy == "incomplete":
            incomplete_items.append({"code": f"POLE-{pole_status.upper()}", "description": f"{pole_status} pole cost policy", "quantity": quantity, "unit": "piece", "reason": "pole_cost_policy_incomplete"})
            continue
        if policy == "exclude":
            continue
        suffix = "" if pole_status == "legacy" else f"-{pole_status.upper()}"
        if policy == "supply_and_install":
            amount = round(quantity * config.pole_unit_cost, 2)
            items.append(CostItem(code=f"POLE-SUPPLY{suffix}", description=f"{pole_status.title()} pole supply", quantity=float(quantity), unit="piece", unit_cost=config.pole_unit_cost, amount=amount, category="material"))
        if policy in {"supply_and_install", "installation_only"}:
            amount = round(quantity * config.pole_installation_cost, 2)
            items.append(CostItem(code=f"POLE-INSTALL{suffix}", description=f"{pole_status.title()} pole installation", quantity=float(quantity), unit="piece", unit_cost=config.pole_installation_cost, amount=amount, category="installation"))

    # 4. OLT Equipment
    if olt_count > 0:
        olt_mat_amount = round(olt_count * config.olt_unit_cost, 2)
        items.append(
            CostItem(
                code="OLT-SUPPLY",
                description="GPON OLT Chassis & SFP Optical Modules",
                quantity=float(olt_count),
                unit="unit",
                unit_cost=config.olt_unit_cost,
                amount=olt_mat_amount,
                category="material",
            )
        )
        olt_inst_amount = round(olt_count * config.olt_installation_cost, 2)
        items.append(
            CostItem(
                code="OLT-INSTALL",
                description="OLT Central Office Rack Mount & Commissioning",
                quantity=float(olt_count),
                unit="unit",
                unit_cost=config.olt_installation_cost,
                amount=olt_inst_amount,
                category="installation",
            )
        )

    # 5. ODC Cabinets
    if odc_count > 0:
        odc_mat_amount = round(odc_count * config.odc_unit_cost, 2)
        items.append(
            CostItem(
                code="ODC-SUPPLY",
                description="Optical Distribution Cabinet (ODC) Enclosure",
                quantity=float(odc_count),
                unit="unit",
                unit_cost=config.odc_unit_cost,
                amount=odc_mat_amount,
                category="material",
            )
        )
        odc_inst_amount = round(odc_count * config.odc_installation_cost, 2)
        items.append(
            CostItem(
                code="ODC-INSTALL",
                description="ODC Pad Foundation & Feeder Termination Splicing",
                quantity=float(odc_count),
                unit="unit",
                unit_cost=config.odc_installation_cost,
                amount=odc_inst_amount,
                category="installation",
            )
        )

    # 6. ODP Boxes
    if odp_count > 0:
        odp_mat_amount = round(odp_count * config.odp_unit_cost, 2)
        items.append(
            CostItem(
                code="ODP-SUPPLY",
                description="Optical Distribution Point (ODP) Box Enclosure",
                quantity=float(odp_count),
                unit="unit",
                unit_cost=config.odp_unit_cost,
                amount=odp_mat_amount,
                category="material",
            )
        )
        odp_inst_amount = round(odp_count * config.odp_installation_cost, 2)
        items.append(
            CostItem(
                code="ODP-INSTALL",
                description="ODP Pole Mounting & Drop Cable Termination",
                quantity=float(odp_count),
                unit="unit",
                unit_cost=config.odp_installation_cost,
                amount=odp_inst_amount,
                category="installation",
            )
        )

    # 7. Optical Splitters
    if splitter_count > 0:
        spl_mat_amount = round(splitter_count * config.splitter_unit_cost, 2)
        items.append(
            CostItem(
                code="SPL-SUPPLY",
                description="Optical PLC Splitter Supply",
                quantity=float(splitter_count),
                unit="piece",
                unit_cost=config.splitter_unit_cost,
                amount=spl_mat_amount,
                category="material",
            )
        )
        spl_inst_amount = round(splitter_count * config.splitter_installation_cost, 2)
        items.append(
            CostItem(
                code="SPL-INSTALL",
                description="Splitter Tray Installation & Fusion Splicing",
                quantity=float(splitter_count),
                unit="piece",
                unit_cost=config.splitter_installation_cost,
                amount=spl_inst_amount,
                category="installation",
            )
        )

    # 8. ONT / Customer Premise
    if total_ont_count > 0:
        ont_mat_amount = round(total_ont_count * config.ont_unit_cost, 2)
        items.append(
            CostItem(
                code="ONT-SUPPLY",
                description="GPON ONT Subscriber Terminal Device",
                quantity=float(total_ont_count),
                unit="unit",
                unit_cost=config.ont_unit_cost,
                amount=ont_mat_amount,
                category="material",
            )
        )
        ont_inst_amount = round(total_ont_count * config.ont_installation_cost, 2)
        items.append(
            CostItem(
                code="ONT-INSTALL",
                description="Customer Premise Drop Wire & ONT Installation",
                quantity=float(total_ont_count),
                unit="unit",
                unit_cost=config.ont_installation_cost,
                amount=ont_inst_amount,
                category="installation",
            )
        )

    # 9. Standalone Customer Routers (CPE)
    router_count = sum(1 for n in unique_nodes.values() if n.type == NodeType.ROUTER)
    integrated_router_count = sum(
        1 for n in unique_nodes.values()
        if n.type == NodeType.ONT and (n.properties.get("integratedRouter") is True or n.properties.get("integrated_router") is True)
    )

    if router_count > 0:
        if config.router_unit_cost is not None:
            router_mat_amount = round(router_count * config.router_unit_cost, 2)
            items.append(
                CostItem(
                    code="RTR-SUPPLY",
                    description="Customer Premises Router (Wi-Fi 6 / Gigabit CPE)",
                    quantity=float(router_count),
                    unit="unit",
                    unit_cost=config.router_unit_cost,
                    amount=router_mat_amount,
                    category="material",
                    unit_cost_source="configured",
                )
            )
        else:
            incomplete_items.append({"code": "RTR-SUPPLY", "description": "Customer Premises Router supply", "quantity": router_count, "unit": "unit", "reason": "router_unit_cost_not_configured"})
        if config.router_installation_cost is not None:
            router_inst_amount = round(router_count * config.router_installation_cost, 2)
            items.append(
                CostItem(
                    code="RTR-INSTALL",
                    description="Router Setup, Wi-Fi Configuration & Customer Handover",
                    quantity=float(router_count),
                    unit="unit",
                    unit_cost=config.router_installation_cost,
                    amount=router_inst_amount,
                    category="installation",
                    unit_cost_source="configured",
                )
            )
        else:
            incomplete_items.append({"code": "RTR-INSTALL", "description": "Router installation", "quantity": router_count, "unit": "unit", "reason": "router_installation_cost_not_configured"})
        assumptions.append("Router line items are included only when their respective rate is configured.")

    # Explicit connector, splice, and other component procurement records.
    seen_component_ids = set()
    for component in project.optical_components:
        if component.id in seen_component_ids:
            continue
        seen_component_ids.add(component.id)
        if component.kind.lower() not in {"connector", "connector-pair", "splice", "fusion-splice"} and component.procurement_quantity is None:
            continue
        code_kind = "CONN" if "connector" in component.kind.lower() else "SPLICE" if "splice" in component.kind.lower() else "OPT-" + "".join(ch if ch.isalnum() else "-" for ch in component.kind.upper()).strip("-")
        quantity = component.procurement_quantity
        unit = component.procurement_unit or "unit"
        if quantity is None or quantity <= 0:
            incomplete_items.append({"code": f"{code_kind}-SUPPLY", "description": component.kind, "quantity": quantity, "unit": unit, "reason": "procurement_quantity_unknown"})
            continue
        for suffix, description, unit_cost, category in (
            ("SUPPLY", f"{component.kind} supply", component.material_unit_cost, "material"),
            ("INSTALL", f"{component.kind} installation", component.installation_unit_cost, "installation"),
        ):
            if unit_cost is None or component.price_source != "configured":
                incomplete_items.append({"code": f"{code_kind}-{suffix}", "description": description, "quantity": quantity, "unit": unit, "reason": "unit_rate_unknown"})
                continue
            items.append(CostItem(code=f"{code_kind}-{suffix}", description=description, quantity=quantity, unit=unit,
                unit_cost=unit_cost, amount=round(quantity * unit_cost, 2), category=category,
                unit_cost_source="configured", unit_cost_reference=component.price_reference))

    rate_key_by_code = {
        "CBL-SUPPLY": "cableUnitCostPerMeter", "CBL-INSTALL": "cableInstallationCostPerMeter",
        "POLE-SUPPLY": "poleUnitCost", "POLE-INSTALL": "poleInstallationCost",
        "OLT-SUPPLY": "oltUnitCost", "OLT-INSTALL": "oltInstallationCost",
        "ODC-SUPPLY": "odcUnitCost", "ODC-INSTALL": "odcInstallationCost",
        "ODP-SUPPLY": "odpUnitCost", "ODP-INSTALL": "odpInstallationCost",
        "ONT-SUPPLY": "ontUnitCost", "ONT-INSTALL": "ontInstallationCost",
        "SPL-SUPPLY": "splitterUnitCost", "SPL-INSTALL": "splitterInstallationCost",
        "RTR-SUPPLY": "routerUnitCost", "RTR-INSTALL": "routerInstallationCost",
    }
    priced_items = []
    for item in items:
        rate_key = next((key for prefix, key in rate_key_by_code.items() if item.code == prefix or item.code.startswith(prefix + "-")), None)
        if rate_key is None:
            priced_items.append(item)
            continue
        rate_source = config.rate_sources.get(rate_key, "legacy_illustrative")
        if rate_source == "unknown":
            incomplete_items.append({"code": item.code, "description": item.description, "quantity": item.quantity, "unit": item.unit, "reason": "unit_rate_unknown"})
            continue
        item.unit_cost_source = rate_source
        item.unit_cost_reference = config.rate_references.get(rate_key)
        priced_items.append(item)
    items = priced_items
    if incomplete_items:
        assumptions.append("Unknown-rate items are excluded from priced subtotals and grand total.")

    # Subtotals & Total CAPEX
    material_subtotal = round(sum(item.amount for item in items if item.category == "material"), 2)
    installation_subtotal = round(sum(item.amount for item in items if item.category == "installation"), 2)
    total_amount = round(sum(item.amount for item in items), 2)

    # Cost per connected customer
    cost_per_cust: Optional[float] = None
    if connected_customers > 0:
        cost_per_cust = round(total_amount / connected_customers, 2)

    summary = {
        "materialSubtotal": material_subtotal,
        "installationSubtotal": installation_subtotal,
        "grandTotal": total_amount,
        "totalCapex": total_amount,
        "totalCableRouteMeters": round(raw_route_length_m, 2),
        "totalCableBilledMeters": total_cable_m,
        "duplicateCableIdsDeduplicated": duplicate_cable_ids,
        "cableQuantityAudit": [
            {"category": category, "cableSegmentIds": group["segmentIds"], "physicalLengthM": round(group["lengthM"], 2), "slackPercent": config.cable_slack_percent, "billedLengthM": round(group["lengthM"] * slack_multiplier, 2)}
            for category, group in sorted(cable_groups.items())
        ],
        "deploymentMethodAudit": [
            {"deploymentMethod": dep_method, "cableSegmentIds": dep_group["segmentIds"], "physicalLengthM": round(dep_group["lengthM"], 2)}
            for dep_method, dep_group in sorted(deployment_groups.items())
        ],
        "cableSlackPercent": config.cable_slack_percent,
        "poleCount": pole_count,
        "sharedPoleIds": shared_pole_ids,
        "poleStatusCounts": pole_status_counts,
        "poleCostPolicy": config.pole_cost_policy,
        "oltCount": olt_count,
        "odcCount": odc_count,
        "odpCount": odp_count,
        "splitterCount": splitter_count,
        "ontCount": total_ont_count,
        "routerCount": router_count,
        "integratedRouterCount": integrated_router_count,
        "connectedCustomerCount": connected_customers,
        "costPerConnectedCustomer": cost_per_cust,
    }

    return ConstructionCostResult(
        project_id=project.id,
        calculated_at=current_utc_timestamp(),
        currency=project.currency or config.currency,
        total_amount=total_amount,
        items=items,
        total_capex=total_amount,
        cost_per_connected_customer=cost_per_cust,
        connected_customer_count=connected_customers,
        material_subtotal=material_subtotal,
        installation_subtotal=installation_subtotal,
        grand_total=total_amount,
        summary=summary,
        incomplete_items=incomplete_items,
        assumptions=assumptions,
        complete=not incomplete_items,
    )

