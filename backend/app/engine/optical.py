"""Optical power budget calculation engine.

Calculates:
- Fiber attenuation: alpha (dB/km) * route_length (km)
- Splitter insertion loss: ITU-T / configurable ratio loss table
- Connector loss: mated pair loss * number of connectors
- Splice loss: fusion splice loss * number of splices
- Safety margin: aging / maintenance design margin
- Received optical power: P_tx - A_total
- Design margin: P_rx - P_sensitivity - safety_margin
- Pass/Fail evaluation based on sensitivity and overload thresholds.
"""

import math
from typing import Dict, List, Optional
from backend.app.domain.models import (
    NetworkNode,
    NodeType,
    OpticalBudgetConfig,
    OpticalBudgetResult,
    IntermediateOpticalLossItem,
    OpticalDiagnostic,
    OpticalLinkResult,
    OpticalPathResult,
    OpticalPathSegment,
    OpticalSplitterInfo,
    Project,
    TopologyIssue,
    current_utc_timestamp,
)
from backend.app.engine.geo import calculate_route_length
from backend.app.domain.validation import validate_project_topology


def _safe_float(value: object) -> tuple[Optional[float], bool]:
    """Return (parsed_float, is_valid_numeric)."""
    if value is None or isinstance(value, bool):
        return None, True
    try:
        parsed = float(value)
    except (ValueError, TypeError):
        return None, False
    if not math.isfinite(parsed):
        return None, False
    return parsed, True


def _safe_int(value: object) -> tuple[Optional[int], bool]:
    """Return (parsed_int, is_valid_int)."""
    if value is None or isinstance(value, bool):
        return None, True
    try:
        parsed_f = float(value)
    except (ValueError, TypeError):
        return None, False
    if not math.isfinite(parsed_f) or not parsed_f.is_integer():
        return None, False
    return int(parsed_f), True


def _parameter_source(config: OpticalBudgetConfig, name: str, explicitly_overridden: bool = False) -> str:
    if explicitly_overridden:
        return "configured"
    return config.parameter_sources.get(name, "legacy_fallback")


def _legacy_or_unknown_sources(sources: Dict[str, str]) -> List[str]:
    return [name for name, source in sources.items() if source in {"legacy_fallback", "unknown"}]


def _resolve_cable_category(cable) -> Optional[str]:
    explicit = cable.properties.get("cableCategory")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    raw_type = (cable.cable_type or "").strip().lower()
    for known in ("feeder", "distribution", "drop", "indoor", "custom"):
        if raw_type == known or raw_type.startswith(f"{known} ") or raw_type.endswith(f" {known}"):
            return known
    return None


def _ideal_splitter_loss_db(ratio: Optional[str]) -> Optional[float]:
    """Return theoretical 1:N split loss, not the device insertion loss."""
    if not ratio:
        return None
    try:
        input_count, output_count = (int(value) for value in ratio.split(":"))
    except (ValueError, TypeError):
        return None
    if input_count != 1 or output_count < 1:
        return None
    return round(10.0 * math.log10(output_count), 2)


def _get_splitter_info_for_node(node: NetworkNode, config: OpticalBudgetConfig) -> Optional[OpticalSplitterInfo]:
    """Determine optical splitter insertion loss and ratio for a node if configured.
    
    Returns OpticalSplitterInfo with loss_db=None if a splitter is defined but has an
    unknown/unlisted ratio without explicit loss configuration.
    """
    has_splitter = (
        node.type == NodeType.SPLITTER
        or "splitterRatio" in node.properties
        or "splitterLossDb" in node.properties
    )
    if not has_splitter:
        return None

    loss_prop = node.properties.get("splitterLossDb")
    ratio = node.properties.get("splitterRatio")

    # 1. Explicit loss override in properties takes precedence
    if loss_prop is not None:
        try:
            val = float(loss_prop)
            if val >= 0.0:
                return OpticalSplitterInfo(
                    node_id=node.id,
                    node_name=node.name,
                    node_type=node.type.value,
                    splitter_ratio=str(ratio) if ratio else None,
                    loss_db=val,
                    ideal_loss_db=_ideal_splitter_loss_db(str(ratio) if ratio else None),
                )
        except (ValueError, TypeError):
            pass

    # 2. Configured ratio lookup
    if ratio and str(ratio) in config.splitter_loss_table:
        return OpticalSplitterInfo(
            node_id=node.id,
            node_name=node.name,
            node_type=node.type.value,
            splitter_ratio=str(ratio),
            loss_db=config.splitter_loss_table[str(ratio)],
            ideal_loss_db=_ideal_splitter_loss_db(str(ratio)),
        )

    # A missing or unlisted specification is unknown; do not assume 1:8 or
    # substitute theoretical loss for actual device insertion loss.
    return OpticalSplitterInfo(
        node_id=node.id,
        node_name=node.name,
        node_type=node.type.value,
        splitter_ratio=str(ratio) if ratio else "unknown",
        loss_db=None,
        ideal_loss_db=_ideal_splitter_loss_db(str(ratio) if ratio else None),
    )


def _get_splitter_loss_for_node(node: NetworkNode, config: OpticalBudgetConfig) -> Optional[float]:
    """Determine optical splitter insertion loss for a node if configured.
    
    Returns:
    - float loss if configured
    - None if splitter exists but loss is unknown/unconfigured
    - 0.0 if no splitter exists on this node
    """
    info = _get_splitter_info_for_node(node, config)
    if info is None:
        return 0.0
    return info.loss_db



def calculate_optical_budget(
    project: Project,
    config_override: Optional[OpticalBudgetConfig] = None,
    _include_intermediate: bool = True,
) -> OpticalBudgetResult:
    """Calculate the optical power budget for all topology connections in a project."""
    config = config_override or project.settings.optical_budget
    nodes_by_id: Dict[str, NetworkNode] = {n.id: n for n in project.nodes}
    cables_by_id = {c.id: c for c in project.cable_segments}

    link_results: List[OpticalLinkResult] = []
    passed_count = 0
    failed_count = 0
    unknown_count = 0

    for conn in project.connections:
        from_node = nodes_by_id.get(conn.from_node_id)
        to_node = nodes_by_id.get(conn.to_node_id)
        cable = cables_by_id.get(conn.cable_segment_id)

        # 1. Handle missing references
        if not from_node or not to_node or not cable:
            link_results.append(
                OpticalLinkResult(
                    connection_id=conn.id,
                    length_m=0.0,
                    loss_db=0.0,
                    received_power_dbm=None,
                    status="unknown",
                    margin_db=None,
                    details={"error": "Missing node or cable reference in project"},
                )
            )
            unknown_count += 1
            continue

        # 2. Determine link length
        if cable.length_m is not None:
            length_m = float(cable.length_m)
        else:
            length_m = round(calculate_route_length(cable.geometry.coordinates), 2)
        length_km = length_m / 1000.0

        # Check if endpoints are optical devices (not pure physical poles)
        is_from_optical = from_node.type in {NodeType.OLT, NodeType.ODC, NodeType.ODP, NodeType.ONT, NodeType.SPLITTER}
        is_to_optical = to_node.type in {NodeType.OLT, NodeType.ODC, NodeType.ODP, NodeType.ONT, NodeType.SPLITTER}

        is_copper = (
            cable.medium == "copper"
            or conn.medium == "copper"
            or conn.connection_type == "ethernet"
            or cable.cable_type.lower() in ("cat5", "cat5e", "cat6", "cat6a", "cat7", "cat8", "utp", "stp", "ethernet", "copper")
            or cable.properties.get("medium") == "copper"
        )

        if not is_from_optical or not is_to_optical or is_copper:
            note = "Non-optical copper/Ethernet link" if is_copper else "Non-optical network node endpoint (e.g. pole or router)"
            link_results.append(
                OpticalLinkResult(
                    connection_id=conn.id,
                    length_m=length_m,
                    loss_db=0.0,
                    received_power_dbm=None,
                    status="unknown",
                    margin_db=None,
                    details={"note": note},
                )
            )
            unknown_count += 1
            continue

        # 3. Fiber attenuation. Functional category never selects a physical
        # coefficient; use an explicit cable specification or the project fiber
        # coefficient, honoring its provenance (including unknown).
        alpha_override = cable.properties.get("attenuationDbPerKm")
        if alpha_override is None:
            alpha_override = cable.properties.get("fiberAttenuationDbPerKm")
        alpha_source = _parameter_source(config, "fiberAttenuationDbPerKm", alpha_override is not None)
        raw_alpha = None if alpha_source == "unknown" else (config.fiber_attenuation_db_per_km if alpha_override is None else alpha_override)
        fiber_alpha, valid_alpha = _safe_float(raw_alpha)
        if alpha_source == "unknown" or (raw_alpha is None and valid_alpha):
            link_results.append(OpticalLinkResult(connection_id=conn.id, length_m=length_m, loss_db=0.0, received_power_dbm=None, status="unknown", margin_db=None, details={"error": "Fiber attenuation coefficient is unknown", "fiberLossDb": None, "fiberAttenuationSource": alpha_source}))
            unknown_count += 1
            continue
        if not valid_alpha or fiber_alpha is None or fiber_alpha < 0:
            link_results.append(OpticalLinkResult(connection_id=conn.id, length_m=length_m, loss_db=0.0, received_power_dbm=None, status="unknown", margin_db=None, details={"error": "Fiber attenuation coefficient is invalid", "fiberLossDb": None, "fiberAttenuationSource": alpha_source}))
            unknown_count += 1
            continue
        fiber_loss = length_km * fiber_alpha

        # 4. Splitter insertion loss
        # A hop diagnostic charges a splitter at its destination only. Charging
        # both endpoints repeats each intermediate splitter on adjacent links.
        # Full end-to-end results account for every traversed splitter once.
        to_splitter_loss = _get_splitter_loss_for_node(to_node, config)

        # Check for unconfigured / unknown splitter ratio
        if to_splitter_loss is None:
            link_results.append(
                OpticalLinkResult(
                    connection_id=conn.id,
                    length_m=length_m,
                    loss_db=0.0,
                    received_power_dbm=None,
                    status="unknown",
                    margin_db=None,
                    details={
                        "error": "Unknown splitter ratio without explicit splitterLossDb configuration",
                        "fiberLossDb": round(fiber_loss, 2),
                    },
                )
            )
            unknown_count += 1
            continue

        splitter_loss = to_splitter_loss

        # 5. Connector loss
        connectors_count = int(cable.properties.get("connectorsCount", config.connectors_per_link))
        connector_unit_loss = float(cable.properties.get("connectorLossDb", config.connector_loss_db))
        connector_loss = connectors_count * connector_unit_loss

        # 6. Splice loss (route splices + optional pigtail splices)
        splices_count = int(cable.properties.get("splicesCount", config.splices_per_link))
        splice_unit_loss = float(cable.properties.get("spliceLossDb", config.splice_loss_db))
        pigtail_splices_count = int(cable.properties.get("pigtailSplicesCount", config.pigtail_splices_per_link))
        pigtail_splice_unit_loss = float(
            cable.properties.get(
                "pigtailSpliceLossDb",
                config.pigtail_splice_loss_db if config.pigtail_splice_loss_db is not None else config.splice_loss_db,
            )
        )
        pigtail_splice_loss = pigtail_splices_count * pigtail_splice_unit_loss
        splice_loss = (splices_count * splice_unit_loss) + pigtail_splice_loss

        # 7. Physical attenuation across this link
        physical_loss = round(fiber_loss + splitter_loss + connector_loss + splice_loss, 2)
        total_loss_budget = round(physical_loss + config.safety_margin_db, 2)

        # 8. Check if source node is an optical transmitter
        is_from_transmitter = (
            from_node.type == NodeType.OLT
            or "txPowerDbm" in from_node.properties
        )

        if not is_from_transmitter:
            # Passive nodes (ODC, ODP, Splitter) are NOT transmitters.
            # Never assign fictitious transmitter launch power.
            details = {
                "lengthKm": round(length_km, 4),
                "fiberLossDb": round(fiber_loss, 2),
                "fiberAttenuationDbPerKm": fiber_alpha,
                "splitterLossDb": round(splitter_loss, 2),
                "connectorLossDb": round(connector_loss, 2),
                "connectorsCount": connectors_count,
                "spliceLossDb": round(splice_loss, 2),
                "splicesCount": splices_count,
                "physicalLossDb": physical_loss,
                "safetyMarginDb": round(config.safety_margin_db, 2),
                "totalLossDb": total_loss_budget,
                "txPowerDbm": None,
                "note": f"Passive source node '{from_node.name}' ({from_node.type.value}) is not an optical transmitter; end-to-end power levels are evaluated in paths",
            }
            link_results.append(
                OpticalLinkResult(
                    connection_id=conn.id,
                    length_m=length_m,
                    loss_db=physical_loss,
                    received_power_dbm=None,
                    status="unknown",
                    margin_db=None,
                    details=details,
                )
            )
            unknown_count += 1
            continue

        # 9. Optical Power Levels for transmitter-driven links (e.g. from OLT)
        tx_power = float(from_node.properties.get("txPowerDbm", config.tx_power_dbm))
        rx_sensitivity = float(to_node.properties.get("rxSensitivityDbm", config.rx_sensitivity_dbm))
        rx_overload = float(to_node.properties.get("rxOverloadDbm", config.rx_overload_dbm))

        # PHYSICAL RECEIVED POWER (Safety margin NOT deducted from physical received power)
        received_power = round(tx_power - physical_loss, 2)

        # DESIGN MARGIN (Excess power above sensitivity after reserving safety margin)
        margin = round(received_power - rx_sensitivity - config.safety_margin_db, 2)
        gross_margin = round(received_power - rx_sensitivity, 2)
        # Receiver-limit headrooms use physical received power and do not
        # include the separate design reserve.
        sensitivity_margin = gross_margin
        overload_margin = round(rx_overload - received_power, 2)

        # 10. Pass / Fail evaluation
        # Overload evaluated using physical received power
        if received_power > rx_overload:
            status = "fail"
            failed_count += 1
        elif received_power < rx_sensitivity:
            status = "fail"
            failed_count += 1
        elif margin < config.min_margin_db:
            status = "fail"
            failed_count += 1
        else:
            status = "pass"
            passed_count += 1

        link_unverified_parameters = _legacy_or_unknown_sources(config.parameter_sources)
        if link_unverified_parameters:
            if status == "pass":
                passed_count -= 1
            elif status == "fail":
                failed_count -= 1
            status = "unknown"
            unknown_count += 1

        details = {
            "lengthKm": round(length_km, 4),
            "fiberLossDb": round(fiber_loss, 2),
            "fiberAttenuationDbPerKm": fiber_alpha,
            "splitterLossDb": round(splitter_loss, 2),
            "connectorLossDb": round(connector_loss, 2),
            "connectorsCount": connectors_count,
            "spliceLossDb": round(splice_loss, 2),
            "splicesCount": splices_count,
            "physicalLossDb": physical_loss,
            "safetyMarginDb": round(config.safety_margin_db, 2),
            "totalLossDb": total_loss_budget,
            "txPowerDbm": tx_power,
            "receivedPowerDbm": received_power,
            "rxSensitivityDbm": rx_sensitivity,
            "rxOverloadDbm": rx_overload,
            "sensitivityMarginDb": sensitivity_margin,
            "overloadMarginDb": overload_margin,
            "marginDb": margin,
            "grossMarginDb": gross_margin,
            "designMarginDb": margin,
            "parameterSources": config.parameter_sources,
            "unverifiedParameters": link_unverified_parameters,
            "profileId": config.profile_id,
        }

        link_results.append(
            OpticalLinkResult(
                connection_id=conn.id,
                length_m=length_m,
                loss_db=physical_loss,
                received_power_dbm=received_power,
                status=status,
                margin_db=margin,
                details=details,
            )
        )

    summary = {
        "totalLinks": len(link_results),
        "passed": passed_count,
        "failed": failed_count,
        "unknown": unknown_count,
        "maxLossDb": max((l.loss_db for l in link_results), default=0.0),
        "minMarginDb": min((l.margin_db for l in link_results if l.margin_db is not None), default=0.0),
    }

    # Edge results above are useful diagnostics, but they are not an end-to-end
    # GPON budget. Trace directed connection paths separately and charge each
    # segment's fiber/connector/splice loss, each splitter once, and safety
    # margin once per OLT-to-ONT path.
    topology_validation = validate_project_topology(project)
    invalid_connection_issues: Dict[str, List[TopologyIssue]] = {}
    for issue in topology_validation.errors:
        # A zero/degenerate route is an engineering validation issue, but it
        # does not change graph connectivity. Let the optical calculation keep
        # tracing the path so the missing route length is reported as UNKNOWN.
        if issue.code == "zero_length_cable_route":
            continue
        if issue.connection_id:
            invalid_connection_issues.setdefault(issue.connection_id, []).append(issue)
        for connection_id in (issue.details or {}).get("connectionIds", []):
            invalid_connection_issues.setdefault(connection_id, []).append(issue)

    outgoing: Dict[str, list] = {}
    all_optical_outgoing: Dict[str, list] = {}
    for conn in project.connections:
        if conn.from_node_id in nodes_by_id and conn.to_node_id in nodes_by_id and conn.cable_segment_id in cables_by_id:
            fn = nodes_by_id[conn.from_node_id]
            tn = nodes_by_id[conn.to_node_id]
            cb = cables_by_id[conn.cable_segment_id]
            is_copper = (
                cb.medium == "copper"
                or conn.medium == "copper"
                or conn.connection_type == "ethernet"
                or cb.cable_type.lower() in ("cat5", "cat5e", "cat6", "cat6a", "cat7", "cat8", "utp", "stp", "ethernet", "copper")
                or cb.properties.get("medium") == "copper"
            )
            if fn.type == NodeType.ROUTER or tn.type == NodeType.ROUTER or is_copper:
                continue
            all_optical_outgoing.setdefault(conn.from_node_id, []).append(conn)
            if conn.id not in invalid_connection_issues:
                outgoing.setdefault(conn.from_node_id, []).append(conn)

    customer_ids_by_ont: Dict[str, List[str]] = {}
    for customer in project.customers:
        if customer.ont_node_id:
            customer_ids_by_ont.setdefault(customer.ont_node_id, []).append(customer.id)

    paths: List[OpticalPathResult] = []
    reachable_ont_ids = set()
    ont_nodes = [node for node in project.nodes if node.type == NodeType.ONT]
    olt_nodes = [node for node in project.nodes if node.type == NodeType.OLT]

    for ont in ont_nodes:
        found: List[tuple] = []

        def walk(current_id: str, target_id: str, visited: set, connections: list, node_ids: list) -> None:
            if len(found) >= 2:
                return
            if current_id == target_id:
                if connections:
                    found.append((list(connections), list(node_ids)))
                return
            for connection in outgoing.get(current_id, []):
                next_id = connection.to_node_id
                if next_id in visited:
                    continue
                walk(next_id, target_id, visited | {next_id}, connections + [connection], node_ids + [next_id])

        for olt in olt_nodes:
            walk(olt.id, ont.id, {olt.id}, [], [olt.id])
            if len(found) >= 2:
                break

        linked_customers = customer_ids_by_ont.get(ont.id, [])
        forward_reachable = set()
        pending = list(olt.id for olt in olt_nodes)
        while pending:
            current_id = pending.pop()
            if current_id in forward_reachable:
                continue
            forward_reachable.add(current_id)
            pending.extend(edge.to_node_id for edge in all_optical_outgoing.get(current_id, []))
        backward_reachable = {ont.id}
        changed = True
        while changed:
            changed = False
            for source_id, edges in all_optical_outgoing.items():
                if source_id not in backward_reachable and any(edge.to_node_id in backward_reachable for edge in edges):
                    backward_reachable.add(source_id)
                    changed = True
        relevant_invalid_issues = [
            issue
            for connection in project.connections
            if connection.id in invalid_connection_issues
            and connection.from_node_id in forward_reachable
            and connection.to_node_id in backward_reachable
            for issue in invalid_connection_issues[connection.id]
        ]
        if not found:
            if relevant_invalid_issues:
                invalid_diagnostics: List[OpticalDiagnostic] = []
                seen_invalid_conns = set()
                for connection in project.connections:
                    if (
                        connection.id in invalid_connection_issues
                        and connection.from_node_id in forward_reachable
                        and connection.to_node_id in backward_reachable
                    ):
                        for issue in invalid_connection_issues[connection.id]:
                            key = (connection.id, issue.code)
                            if key in seen_invalid_conns:
                                continue
                            seen_invalid_conns.add(key)
                            invalid_diagnostics.append(
                                OpticalDiagnostic(
                                    code="OPTICAL_PATH_DISCONNECTED",
                                    severity="error",
                                    category="connectivity",
                                    message=f"Connection '{connection.id}' on route to ONT '{ont.name}' failed topology validation ({issue.code}): {issue.message}",
                                    affected_entity_type="connection",
                                    affected_entity_id=connection.id,
                                    affected_entity_name=f"{connection.from_node_id} -> {connection.to_node_id}",
                                    actual_value=issue.code,
                                    expected_value="valid_optical_connection",
                                    unit=None,
                                    corrective_action="Fix or remove the invalid connection in the topology editor so a valid OLT-to-ONT path can be traced.",
                                    data_source="topology_validation",
                                )
                            )
                paths.append(OpticalPathResult(
                    ont_node_id=ont.id,
                    customer_ids=linked_customers,
                    status="unknown",
                    connectivity_status="invalid_topology",
                    optical_budget_status="unknown",
                    status_reason="invalid_topology_connection",
                    diagnostics=invalid_diagnostics,
                    calculation_limitations=[
                        "End-to-end optical budget cannot be evaluated because a connection on the candidate route failed topology validation."
                    ],
                    details={
                        "reason": "A connection on the directed route to this ONT failed project topology validation.",
                        "invalidConnections": [
                            {"connectionId": connection.id, "code": issue.code, "message": issue.message}
                            for connection in project.connections
                            if connection.id in invalid_connection_issues
                            and connection.from_node_id in forward_reachable
                            and connection.to_node_id in backward_reachable
                            for issue in invalid_connection_issues[connection.id]
                        ],
                    },
                ))
                continue
            paths.append(OpticalPathResult(
                ont_node_id=ont.id,
                customer_ids=linked_customers,
                status="unknown",
                connectivity_status="disconnected",
                optical_budget_status="unknown",
                status_reason="no_directed_path_from_olt",
                diagnostics=[
                    OpticalDiagnostic(
                        code="OPTICAL_PATH_DISCONNECTED",
                        severity="error",
                        category="connectivity",
                        message=f"No directed optical path from any OLT reaches ONT '{ont.name}' ({ont.id}).",
                        affected_entity_type="ont",
                        affected_entity_id=ont.id,
                        affected_entity_name=ont.name,
                        actual_value=None,
                        expected_value=None,
                        unit=None,
                        corrective_action="Create validated directed fiber connections from an OLT through the distribution network to this ONT.",
                        data_source="topology",
                    )
                ],
                calculation_limitations=[
                    "End-to-end optical power budget cannot be calculated because no directed OLT-to-ONT path exists."
                ],
                details={"reason": "no_directed_path_from_olt"},
            ))
            continue
        if len(found) > 1:
            paths.append(OpticalPathResult(
                ont_node_id=ont.id,
                customer_ids=linked_customers,
                status="unknown",
                connectivity_status="ambiguous",
                optical_budget_status="unknown",
                status_reason="multiple_directed_paths_from_olt",
                diagnostics=[
                    OpticalDiagnostic(
                        code="OPTICAL_PATH_DISCONNECTED",
                        severity="error",
                        category="connectivity",
                        message=f"Multiple directed OLT-to-ONT paths reach ONT '{ont.name}' ({ont.id}); passive optical route is ambiguous.",
                        affected_entity_type="ont",
                        affected_entity_id=ont.id,
                        affected_entity_name=ont.name,
                        actual_value=len(found),
                        expected_value=1,
                        unit="paths",
                        corrective_action="Remove redundant or unintended upstream feed connections so a single deterministic OLT-to-ONT path exists.",
                        data_source="topology",
                    )
                ],
                calculation_limitations=[
                    "End-to-end optical power budget is withheld because multiple competing OLT paths reach this ONT."
                ],
                details={"reason": "multiple_directed_paths_from_olt"},
            ))
            continue

        path_connections, path_node_ids = found[0]
        # Connectivity is a topology fact, independent from whether the optical
        # budget is fully configured (for example, an unknown splitter loss).
        reachable_ont_ids.add(ont.id)
        root_olt = nodes_by_id[path_node_ids[0]]
        fiber_loss: Optional[float] = 0.0
        connector_loss: Optional[float] = 0.0
        splice_loss: Optional[float] = 0.0
        total_length_m: Optional[float] = 0.0
        path_segments: List[OpticalPathSegment] = []
        cable_segment_ids: List[str] = []
        seen_route_cable_ids = set()
        reused_route_cable_ids = set()
        path_parameter_sources: Dict[str, str] = {}
        path_diagnostics: List[OpticalDiagnostic] = []
        calculation_limitations: List[str] = []
        has_invalid_configuration = False

        for connection in path_connections:
            cable = cables_by_id[connection.cable_segment_id]
            cable_segment_ids.append(cable.id)
            from_n = nodes_by_id[connection.from_node_id]
            to_n = nodes_by_id[connection.to_node_id]

            raw_length_m = cable.properties.get("lengthM", cable.length_m)
            length_m: Optional[float] = None
            length_source = "configured" if cable.length_m is not None else "geometry"
            if raw_length_m is not None:
                parsed_len, valid_len = _safe_float(raw_length_m)
                if not valid_len or parsed_len is None or parsed_len <= 0:
                    has_invalid_configuration = True
                    path_diagnostics.append(
                        OpticalDiagnostic(
                            code="OPTICAL_CONFIGURATION_INVALID",
                            severity="error",
                            category="configuration",
                            message=f"Cable '{cable.name}' ({cable.id}) has an invalid route length ({raw_length_m}).",
                            affected_entity_type="cable",
                            affected_entity_id=cable.id,
                            affected_entity_name=cable.name,
                            actual_value=parsed_len if valid_len else str(raw_length_m),
                            expected_value="> 0",
                            unit="m",
                            corrective_action="Set a positive route length in meters or redraw valid cable geometry.",
                            data_source="configured",
                        )
                    )
                    path_diagnostics.append(
                        OpticalDiagnostic(
                            code="CABLE_LENGTH_UNKNOWN",
                            severity="warning",
                            category="configuration",
                            message=f"Route length for cable '{cable.name}' ({cable.id}) is unavailable because its configured length is invalid.",
                            affected_entity_type="cable",
                            affected_entity_id=cable.id,
                            affected_entity_name=cable.name,
                            actual_value=None,
                            expected_value=None,
                            unit="m",
                            corrective_action="Provide a valid positive cable route length in meters.",
                            data_source="unknown",
                        )
                    )
                    calculation_limitations.append(f"Cable '{cable.name}' ({cable.id}) has no valid route length.")
                else:
                    length_m = round(parsed_len, 2)
            else:
                geo_len = round(calculate_route_length(cable.geometry.coordinates), 2) if cable.geometry and len(cable.geometry.coordinates) >= 2 else 0.0
                if geo_len <= 0.0:
                    path_diagnostics.append(
                        OpticalDiagnostic(
                            code="CABLE_LENGTH_UNKNOWN",
                            severity="warning",
                            category="configuration",
                            message=f"Route length for cable '{cable.name}' ({cable.id}) is unknown (zero-length geometry and no explicit lengthM).",
                            affected_entity_type="cable",
                            affected_entity_id=cable.id,
                            affected_entity_name=cable.name,
                            actual_value=None,
                            expected_value=None,
                            unit="m",
                            corrective_action="Specify an explicit cable route length (m) or draw non-zero route geometry on the map.",
                            data_source="unknown",
                        )
                    )
                    calculation_limitations.append(f"Route length for cable '{cable.name}' ({cable.id}) is unknown.")
                    length_m = None
                else:
                    length_m = geo_len

            cable_category = _resolve_cable_category(cable)
            alpha_override = cable.properties.get("attenuationDbPerKm")
            if alpha_override is None:
                alpha_override = cable.properties.get("fiberAttenuationDbPerKm")
            alpha_source = _parameter_source(config, "fiberAttenuationDbPerKm", alpha_override is not None)
            raw_alpha = None if alpha_source == "unknown" else (config.fiber_attenuation_db_per_km if alpha_override is None else alpha_override)
            parsed_alpha, valid_alpha = _safe_float(raw_alpha)
            alpha: Optional[float] = None
            if alpha_source == "unknown" or (raw_alpha is None and valid_alpha):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="FIBER_ATTENUATION_UNKNOWN",
                        severity="warning",
                        category="configuration",
                        message=f"Fiber attenuation coefficient (dB/km) is unknown for cable '{cable.name}' ({cable.id}).",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=None,
                        expected_value=None,
                        unit="dB/km",
                        corrective_action="Configure fiberAttenuationDbPerKm on the cable or in the project optical budget settings.",
                        data_source=alpha_source,
                    )
                )
                calculation_limitations.append(f"Fiber attenuation (dB/km) is unknown for cable '{cable.name}'.")
            elif not valid_alpha or parsed_alpha is None or parsed_alpha < 0:
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Fiber attenuation coefficient ({raw_alpha} dB/km) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_alpha if valid_alpha else str(raw_alpha),
                        expected_value=">= 0",
                        unit="dB/km",
                        corrective_action="Set fiber attenuation (dB/km) to a non-negative finite number (e.g., 0.35 dB/km).",
                        data_source=alpha_source,
                    )
                )
                calculation_limitations.append(f"Fiber attenuation on cable '{cable.name}' is invalid.")
            else:
                alpha = parsed_alpha

            # Older versions implicitly applied this setting to cables whose
            # functional category was "drop". Keep the persisted profile value
            # for compatibility, but disclose when it would have changed this
            # segment's historical result. Physical cable differences belong
            # on cable.properties.attenuationDbPerKm.
            if (
                cable_category == "drop"
                and config.drop_fiber_attenuation_db_per_km is not None
                and config.drop_fiber_attenuation_db_per_km != config.fiber_attenuation_db_per_km
                and alpha_override is None
            ):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="LEGACY_CATEGORY_ATTENUATION_NOT_APPLIED",
                        severity="info",
                        category="configuration",
                        message=(
                            f"Cable '{cable.name}' is classified as drop, but category no longer selects "
                            "the legacy dropFiberAttenuationDbPerKm value. Configure attenuationDbPerKm "
                            "on the cable only when its physical fiber specification supports that value."
                        ),
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=config.drop_fiber_attenuation_db_per_km,
                        expected_value=config.fiber_attenuation_db_per_km,
                        unit="dB/km",
                        corrective_action="Review the cable's physical fiber specification; category metadata is not an attenuation input.",
                        data_source=config.parameter_sources.get("dropFiberAttenuationDbPerKm", "legacy_fallback"),
                    )
                )

            fiber_type_override = cable.properties.get("fiberType")
            wavelength_override = cable.properties.get("wavelengthNm")
            fiber_type = config.fiber_type if fiber_type_override is None else str(fiber_type_override)
            wavelength_nm = config.wavelength_nm if wavelength_override is None else int(wavelength_override)

            connectors_override = cable.properties.get("connectorsCount")
            connectors_source = _parameter_source(config, "connectorsPerLink", connectors_override is not None)
            raw_connectors = None if connectors_source == "unknown" else (config.connectors_per_link if connectors_override is None else connectors_override)
            parsed_connectors, valid_connectors = _safe_int(raw_connectors)
            connectors: Optional[int] = None
            if connectors_source == "unknown" or (raw_connectors is None and valid_connectors):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_COMPONENT_MISSING",
                        severity="warning",
                        category="configuration",
                        message=f"Connector count is unknown for cable '{cable.name}' ({cable.id}).",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=None,
                        expected_value=None,
                        unit="connectors",
                        corrective_action="Configure connectorsCount on the cable or connectorsPerLink in optical settings.",
                        data_source=connectors_source,
                    )
                )
                calculation_limitations.append(f"Connector count is unknown for cable '{cable.name}'.")
            elif not valid_connectors or parsed_connectors is None or parsed_connectors < 0:
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Connector count ({raw_connectors}) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_connectors if valid_connectors else str(raw_connectors),
                        expected_value=">= 0",
                        unit="connectors",
                        corrective_action="Set connectorsCount to a non-negative integer.",
                        data_source=connectors_source,
                    )
                )
                calculation_limitations.append(f"Connector count on cable '{cable.name}' is invalid.")
            else:
                connectors = parsed_connectors

            connector_loss_override = cable.properties.get("connectorLossDb")
            connector_unit_source = _parameter_source(config, "connectorLossDb", connector_loss_override is not None)
            raw_connector_loss = None if connector_unit_source == "unknown" else (config.connector_loss_db if connector_loss_override is None else connector_loss_override)
            parsed_conn_loss, valid_conn_loss = _safe_float(raw_connector_loss)
            connector_unit_loss: Optional[float] = None
            if connector_unit_source == "unknown" or (raw_connector_loss is None and valid_conn_loss):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_COMPONENT_MISSING",
                        severity="warning",
                        category="configuration",
                        message=f"Connector insertion loss (dB) is unknown for cable '{cable.name}' ({cable.id}).",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=None,
                        expected_value=None,
                        unit="dB",
                        corrective_action="Configure connectorLossDb on the cable or in project optical settings.",
                        data_source=connector_unit_source,
                    )
                )
                calculation_limitations.append(f"Connector insertion loss (dB) is unknown for cable '{cable.name}'.")
            elif not valid_conn_loss or parsed_conn_loss is None or parsed_conn_loss < 0:
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Connector insertion loss ({raw_connector_loss} dB) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_conn_loss if valid_conn_loss else str(raw_connector_loss),
                        expected_value=">= 0",
                        unit="dB",
                        corrective_action="Set connectorLossDb to a non-negative finite value in dB.",
                        data_source=connector_unit_source,
                    )
                )
                calculation_limitations.append(f"Connector loss on cable '{cable.name}' is invalid.")
            else:
                connector_unit_loss = parsed_conn_loss

            splices_override = cable.properties.get("splicesCount")
            splices_source = _parameter_source(config, "splicesPerLink", splices_override is not None)
            raw_splices = None if splices_source == "unknown" else (config.splices_per_link if splices_override is None else splices_override)
            parsed_splices, valid_splices = _safe_int(raw_splices)
            splices: Optional[int] = None
            if splices_source == "unknown" or (raw_splices is None and valid_splices):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_COMPONENT_MISSING",
                        severity="warning",
                        category="configuration",
                        message=f"Splice count is unknown for cable '{cable.name}' ({cable.id}).",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=None,
                        expected_value=None,
                        unit="splices",
                        corrective_action="Configure splicesCount on the cable or splicesPerLink in optical settings.",
                        data_source=splices_source,
                    )
                )
                calculation_limitations.append(f"Splice count is unknown for cable '{cable.name}'.")
            elif not valid_splices or parsed_splices is None or parsed_splices < 0:
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Splice count ({raw_splices}) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_splices if valid_splices else str(raw_splices),
                        expected_value=">= 0",
                        unit="splices",
                        corrective_action="Set splicesCount to a non-negative integer.",
                        data_source=splices_source,
                    )
                )
                calculation_limitations.append(f"Splice count on cable '{cable.name}' is invalid.")
            else:
                splices = parsed_splices

            splice_loss_override = cable.properties.get("spliceLossDb")
            splice_unit_source = _parameter_source(config, "spliceLossDb", splice_loss_override is not None)
            raw_splice_loss = None if splice_unit_source == "unknown" else (config.splice_loss_db if splice_loss_override is None else splice_loss_override)
            parsed_splice_loss, valid_splice_loss = _safe_float(raw_splice_loss)
            splice_unit_loss: Optional[float] = None
            if splice_unit_source == "unknown" or (raw_splice_loss is None and valid_splice_loss):
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_COMPONENT_MISSING",
                        severity="warning",
                        category="configuration",
                        message=f"Splice insertion loss (dB) is unknown for cable '{cable.name}' ({cable.id}).",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=None,
                        expected_value=None,
                        unit="dB",
                        corrective_action="Configure spliceLossDb on the cable or in project optical settings.",
                        data_source=splice_unit_source,
                    )
                )
                calculation_limitations.append(f"Splice insertion loss (dB) is unknown for cable '{cable.name}'.")
            elif not valid_splice_loss or parsed_splice_loss is None or parsed_splice_loss < 0:
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Splice insertion loss ({raw_splice_loss} dB) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_splice_loss if valid_splice_loss else str(raw_splice_loss),
                        expected_value=">= 0",
                        unit="dB",
                        corrective_action="Set spliceLossDb to a non-negative finite value in dB.",
                        data_source=splice_unit_source,
                    )
                )
                calculation_limitations.append(f"Splice loss on cable '{cable.name}' is invalid.")
            else:
                splice_unit_loss = parsed_splice_loss

            pigtail_splices_override = cable.properties.get("pigtailSplicesCount")
            raw_pigtail_splices = config.pigtail_splices_per_link if pigtail_splices_override is None else pigtail_splices_override
            parsed_pigtail_splices, valid_pigtail_splices = _safe_int(raw_pigtail_splices)
            pigtail_splices: Optional[int] = parsed_pigtail_splices if (valid_pigtail_splices and parsed_pigtail_splices is not None and parsed_pigtail_splices >= 0) else None
            if not valid_pigtail_splices or (parsed_pigtail_splices is not None and parsed_pigtail_splices < 0):
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Pigtail splice count ({raw_pigtail_splices}) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_pigtail_splices if valid_pigtail_splices else str(raw_pigtail_splices),
                        expected_value=">= 0",
                        unit="splices",
                        corrective_action="Set pigtailSplicesCount to a non-negative integer.",
                        data_source="configured" if pigtail_splices_override is not None else "profile_default",
                    )
                )

            pigtail_loss_override = cable.properties.get("pigtailSpliceLossDb")
            raw_pigtail_loss = (
                (config.pigtail_splice_loss_db if config.pigtail_splice_loss_db is not None else config.splice_loss_db)
                if pigtail_loss_override is None
                else pigtail_loss_override
            )
            parsed_pigtail_loss, valid_pigtail_loss = _safe_float(raw_pigtail_loss)
            pigtail_unit_loss: Optional[float] = parsed_pigtail_loss if (valid_pigtail_loss and parsed_pigtail_loss is not None and parsed_pigtail_loss >= 0) else None
            if not valid_pigtail_loss or (parsed_pigtail_loss is not None and parsed_pigtail_loss < 0):
                has_invalid_configuration = True
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_CONFIGURATION_INVALID",
                        severity="error",
                        category="configuration",
                        message=f"Pigtail splice loss ({raw_pigtail_loss} dB) on cable '{cable.name}' ({cable.id}) is invalid.",
                        affected_entity_type="cable",
                        affected_entity_id=cable.id,
                        affected_entity_name=cable.name,
                        actual_value=parsed_pigtail_loss if valid_pigtail_loss else str(raw_pigtail_loss),
                        expected_value=">= 0",
                        unit="dB",
                        corrective_action="Set pigtailSpliceLossDb to a non-negative finite number.",
                        data_source="configured" if pigtail_loss_override is not None else "profile_default",
                    )
                )

            path_parameter_sources[f"{cable.id}.fiberAttenuationDbPerKm"] = _parameter_source(
                config, "fiberAttenuationDbPerKm", alpha_override is not None
            )
            path_parameter_sources[f"{cable.id}.fiberType"] = _parameter_source(
                config, "fiberType", fiber_type_override is not None
            )
            path_parameter_sources[f"{cable.id}.wavelengthNm"] = _parameter_source(
                config, "wavelengthNm", wavelength_override is not None
            )
            path_parameter_sources[f"{cable.id}.connectorsCount"] = _parameter_source(
                config, "connectorsPerLink", connectors_override is not None
            )
            path_parameter_sources[f"{cable.id}.connectorLossDb"] = _parameter_source(
                config, "connectorLossDb", connector_loss_override is not None
            )
            path_parameter_sources[f"{cable.id}.splicesCount"] = _parameter_source(
                config, "splicesPerLink", splices_override is not None
            )
            path_parameter_sources[f"{cable.id}.spliceLossDb"] = _parameter_source(
                config, "spliceLossDb", splice_loss_override is not None
            )

            # A single physical CableSegment may be referenced by more than one
            # logical hop (legacy projects do this). Its geometry and fiber
            # attenuation belong to the physical segment and must contribute
            # once to an end-to-end route, while the hop remains visible.
            route_length_contribution_m: Optional[float] = length_m
            if cable.id in seen_route_cable_ids:
                route_length_contribution_m = 0.0
                reused_route_cable_ids.add(cable.id)
            else:
                seen_route_cable_ids.add(cable.id)
            seg_fiber_loss = (
                round((route_length_contribution_m / 1000.0) * alpha, 2)
                if alpha is not None and route_length_contribution_m is not None
                else None
            )
            seg_connector_loss = round(connectors * connector_unit_loss, 2) if connectors is not None and connector_unit_loss is not None else None
            seg_route_splice_loss = round(splices * splice_unit_loss, 2) if splices is not None and splice_unit_loss is not None else None
            seg_pigtail_splice_loss = (
                round(pigtail_splices * pigtail_unit_loss, 2)
                if pigtail_splices is not None and pigtail_unit_loss is not None and pigtail_splices > 0
                else (0.0 if pigtail_splices == 0 else None)
            )
            seg_splice_loss = (
                round(seg_route_splice_loss + seg_pigtail_splice_loss, 2)
                if seg_route_splice_loss is not None and seg_pigtail_splice_loss is not None
                else None
            )
            seg_total_loss = (
                round(seg_fiber_loss + seg_connector_loss + seg_splice_loss, 2)
                if seg_fiber_loss is not None and seg_connector_loss is not None and seg_splice_loss is not None
                else None
            )

            total_length_m = (
                total_length_m + route_length_contribution_m
                if total_length_m is not None and route_length_contribution_m is not None
                else None
            )
            fiber_loss = fiber_loss + seg_fiber_loss if fiber_loss is not None and seg_fiber_loss is not None else None
            connector_loss = connector_loss + seg_connector_loss if connector_loss is not None and seg_connector_loss is not None else None
            splice_loss = splice_loss + seg_splice_loss if splice_loss is not None and seg_splice_loss is not None else None

            path_segments.append(
                OpticalPathSegment(
                    connection_id=connection.id,
                    cable_segment_id=cable.id,
                    cable_name=cable.name,
                    cable_category=cable_category,
                    from_node_id=from_n.id,
                    from_node_name=from_n.name,
                    from_node_type=from_n.type.value,
                    to_node_id=to_n.id,
                    to_node_name=to_n.name,
                    to_node_type=to_n.type.value,
                    length_m=round(length_m, 2) if length_m is not None else 0.0,
                    route_length_contribution_m=round(route_length_contribution_m, 2) if route_length_contribution_m is not None else None,
                    attenuation_db_per_km=alpha,
                    fiber_type=fiber_type,
                    wavelength_nm=wavelength_nm,
                    fiber_loss_db=seg_fiber_loss,
                    connectors_count=connectors,
                    connector_loss_db=seg_connector_loss,
                    splices_count=splices,
                    splice_loss_db=seg_splice_loss,
                    pigtail_splices_count=pigtail_splices if pigtail_splices and pigtail_splices > 0 else None,
                    pigtail_splice_loss_db=seg_pigtail_splice_loss if pigtail_splices and pigtail_splices > 0 else None,
                    total_segment_loss_db=seg_total_loss,
                )
            )

        path_splitters: List[OpticalSplitterInfo] = []
        seen_splitter_node_ids = set()
        has_unconfigured_splitter = False
        unconfigured_splitter_names = []

        for node_id in path_node_ids:
            if node_id in seen_splitter_node_ids:
                continue
            splitter = nodes_by_id[node_id]
            raw_spl_loss = splitter.properties.get("splitterLossDb")
            if raw_spl_loss is not None:
                parsed_spl_loss, valid_spl_loss = _safe_float(raw_spl_loss)
                if not valid_spl_loss or parsed_spl_loss is None or parsed_spl_loss < 0:
                    has_invalid_configuration = True
                    path_diagnostics.append(
                        OpticalDiagnostic(
                            code="OPTICAL_CONFIGURATION_INVALID",
                            severity="error",
                            category="configuration",
                            message=f"Splitter insertion loss ({raw_spl_loss} dB) on '{splitter.name}' ({splitter.id}) is invalid.",
                            affected_entity_type="node",
                            affected_entity_id=splitter.id,
                            affected_entity_name=splitter.name,
                            actual_value=parsed_spl_loss if valid_spl_loss else str(raw_spl_loss),
                            expected_value=">= 0",
                            unit="dB",
                            corrective_action="Set splitterLossDb to a non-negative finite number in dB.",
                            data_source="configured",
                        )
                    )
            s_info = _get_splitter_info_for_node(splitter, config)
            if s_info:
                seen_splitter_node_ids.add(node_id)
                path_splitters.append(s_info)
                explicit_splitter_loss = (
                    raw_spl_loss is not None
                    and _safe_float(raw_spl_loss)[1]
                    and (_safe_float(raw_spl_loss)[0] or 0.0) >= 0.0
                )
                ratio_is_configured = bool(splitter.properties.get("splitterRatio"))
                if explicit_splitter_loss:
                    splitter_source = "configured"
                elif ratio_is_configured and str(splitter.properties.get("splitterRatio")) in config.splitter_loss_table:
                    splitter_source = _parameter_source(config, "splitterLossTable")
                else:
                    splitter_source = "unknown"
                path_parameter_sources[f"{node_id}.splitterLossDb"] = splitter_source
                path_parameter_sources[f"{node_id}.splitterRatio"] = "configured" if ratio_is_configured else "unknown"
                if s_info.loss_db is None or splitter_source == "unknown":
                    has_unconfigured_splitter = True
                    unconfigured_splitter_names.append(f"{s_info.node_name} ({s_info.splitter_ratio})")
                    path_diagnostics.append(
                        OpticalDiagnostic(
                            code="SPLITTER_LOSS_UNKNOWN",
                            severity="warning",
                            category="configuration",
                            message=f"Splitter '{s_info.node_name}' ({s_info.node_id}) has unknown insertion loss (ratio: {s_info.splitter_ratio}).",
                            affected_entity_type="node",
                            affected_entity_id=s_info.node_id,
                            affected_entity_name=s_info.node_name,
                            actual_value=s_info.splitter_ratio,
                            expected_value="configured splitterRatio in table or explicit splitterLossDb",
                            unit="dB",
                            corrective_action="Select a supported splitter ratio from the optical profile or configure an explicit splitterLossDb value on the device.",
                            data_source=splitter_source,
                        )
                    )
                    calculation_limitations.append(
                        f"Splitter insertion loss is unknown on '{s_info.node_name}' (ratio: {s_info.splitter_ratio})."
                    )

        path_components = []
        seen_component_ids = set()
        path_connection_ids = {edge.id for edge in path_connections}
        for component in project.optical_components:
            attached = ((component.node_id and component.node_id in path_node_ids)
                        or (component.connection_id and component.connection_id in path_connection_ids))
            if attached and component.id not in seen_component_ids:
                path_components.append(component)
                seen_component_ids.add(component.id)
        component_losses = []
        datasheet_references = []
        field_measurements = []
        location_loss_summary: Dict[str, Optional[float]] = {}

        def record_component(component_id: str, kind: str, location: str, loss_db: Optional[float], source: str, **refs):
            component_losses.append({"componentId": component_id, "kind": kind, "location": location, "lossDb": loss_db, "source": source, **refs})
            previous = location_loss_summary.get(location, 0.0)
            location_loss_summary[location] = round(previous + loss_db, 2) if previous is not None and loss_db is not None else None

        for segment in path_segments:
            record_component(f"{segment.cable_segment_id}:fiber", "fiber", "unallocated_route", segment.fiber_loss_db, "calculated", cableSegmentId=segment.cable_segment_id)
            record_component(f"{segment.connection_id}:connectors", "connectors", "unallocated_route", segment.connector_loss_db, "calculated", connectionId=segment.connection_id)
            record_component(f"{segment.connection_id}:splices", "splices", "unallocated_route", segment.splice_loss_db, "calculated", connectionId=segment.connection_id)
        for splitter_info in path_splitters:
            splitter_node = nodes_by_id[splitter_info.node_id]
            location = splitter_node.properties.get("opticalLocation")
            if not isinstance(location, str) or not location.strip():
                location = {"odc": "ODC", "odp": "ODP", "ont": "house"}.get(splitter_info.node_type, "node")
            record_component(f"{splitter_info.node_id}:insertion-loss", "splitter", location, splitter_info.loss_db, "configured_device")
        for component in path_components:
            configured_loss = component.configured_loss_db if component.configured_source == "configured" else None
            path_parameter_sources[f"{component.id}.lossDb"] = component.configured_source
            if configured_loss is None:
                path_diagnostics.append(
                    OpticalDiagnostic(
                        code="OPTICAL_COMPONENT_MISSING",
                        severity="warning",
                        category="configuration",
                        message=f"Optical component '{component.id}' ({component.kind}) on path has no configured insertion loss.",
                        affected_entity_type="component",
                        affected_entity_id=component.id,
                        affected_entity_name=f"{component.kind} ({component.id})",
                        actual_value=None,
                        expected_value=">= 0",
                        unit="dB",
                        corrective_action="Configure configuredLossDb and set configuredSource='configured' for this optical component.",
                        data_source=component.configured_source,
                    )
                )
                calculation_limitations.append(
                    f"Optical component '{component.id}' ({component.kind}) has unknown insertion loss."
                )
            if component.location:
                record_component(component.id, component.kind, component.location, configured_loss, component.configured_source, nodeId=component.node_id, connectionId=component.connection_id)
            else:
                record_component(component.id, component.kind, "unallocated_route", configured_loss, component.configured_source, nodeId=component.node_id, connectionId=component.connection_id)
            if component.datasheet_loss_db is not None or component.datasheet_reference or component.datasheet_model:
                datasheet_references.append({"componentId": component.id, "model": component.datasheet_model,
                    "lossDb": component.datasheet_loss_db, "reference": component.datasheet_reference})
            if component.measured_loss_db is not None or component.measured_at or component.measurement_reference:
                field_measurements.append({"componentId": component.id, "lossDb": component.measured_loss_db,
                    "measuredAt": component.measured_at, "method": component.measurement_method,
                    "reference": component.measurement_reference})
        additional_loss = (
            round(sum(item.configured_loss_db for item in path_components), 2)
            if all(item.configured_source == "configured" and item.configured_loss_db is not None for item in path_components)
            else (0.0 if not path_components else None)
        )

        tx_override = root_olt.properties.get("txPowerDbm")
        sensitivity_override = ont.properties.get("rxSensitivityDbm")
        overload_override = ont.properties.get("rxOverloadDbm")
        path_parameter_sources["txPowerDbm"] = _parameter_source(config, "txPowerDbm", tx_override is not None)
        path_parameter_sources["rxSensitivityDbm"] = _parameter_source(config, "rxSensitivityDbm", sensitivity_override is not None)
        path_parameter_sources["rxOverloadDbm"] = _parameter_source(config, "rxOverloadDbm", overload_override is not None)
        path_parameter_sources["safetyMarginDb"] = _parameter_source(config, "safetyMarginDb")
        path_parameter_sources["minMarginDb"] = _parameter_source(config, "minMarginDb")

        raw_tx = None if path_parameter_sources["txPowerDbm"] == "unknown" else (config.tx_power_dbm if tx_override is None else tx_override)
        parsed_tx, valid_tx = _safe_float(raw_tx)
        tx_power: Optional[float] = None
        if path_parameter_sources["txPowerDbm"] == "unknown" or (raw_tx is None and valid_tx):
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="TX_POWER_UNKNOWN",
                    severity="warning",
                    category="configuration",
                    message=f"Transmitter launch power (txPowerDbm) is unknown for OLT '{root_olt.name}' ({root_olt.id}).",
                    affected_entity_type="node",
                    affected_entity_id=root_olt.id,
                    affected_entity_name=root_olt.name,
                    actual_value=None,
                    expected_value=None,
                    unit="dBm",
                    corrective_action="Configure txPowerDbm on the OLT node or in the project optical budget settings.",
                    data_source=path_parameter_sources["txPowerDbm"],
                )
            )
            calculation_limitations.append(f"OLT '{root_olt.name}' transmitter power (txPowerDbm) is unknown.")
        elif not valid_tx or parsed_tx is None:
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message=f"Transmitter launch power ({raw_tx} dBm) on OLT '{root_olt.name}' ({root_olt.id}) is invalid.",
                    affected_entity_type="node",
                    affected_entity_id=root_olt.id,
                    affected_entity_name=root_olt.name,
                    actual_value=str(raw_tx),
                    expected_value="finite number",
                    unit="dBm",
                    corrective_action="Set txPowerDbm to a valid finite number in dBm (e.g., 2.5 dBm).",
                    data_source=path_parameter_sources["txPowerDbm"],
                )
            )
            calculation_limitations.append(f"OLT '{root_olt.name}' transmitter power is invalid.")
        else:
            tx_power = parsed_tx

        raw_rx_sens = None if path_parameter_sources["rxSensitivityDbm"] == "unknown" else (config.rx_sensitivity_dbm if sensitivity_override is None else sensitivity_override)
        parsed_rx_sens, valid_rx_sens = _safe_float(raw_rx_sens)
        rx_sensitivity: Optional[float] = None
        if path_parameter_sources["rxSensitivityDbm"] == "unknown" or (raw_rx_sens is None and valid_rx_sens):
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="RX_SENSITIVITY_UNKNOWN",
                    severity="warning",
                    category="configuration",
                    message=f"Receiver sensitivity threshold (rxSensitivityDbm) is unknown for ONT '{ont.name}' ({ont.id}).",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=None,
                    expected_value=None,
                    unit="dBm",
                    corrective_action="Configure rxSensitivityDbm on the ONT node or in the project optical budget settings.",
                    data_source=path_parameter_sources["rxSensitivityDbm"],
                )
            )
            calculation_limitations.append(f"ONT '{ont.name}' receiver sensitivity (rxSensitivityDbm) is unknown.")
        elif not valid_rx_sens or parsed_rx_sens is None:
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message=f"Receiver sensitivity ({raw_rx_sens} dBm) on ONT '{ont.name}' ({ont.id}) is invalid.",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=str(raw_rx_sens),
                    expected_value="finite number",
                    unit="dBm",
                    corrective_action="Set rxSensitivityDbm to a valid finite number in dBm (e.g., -27.0 dBm).",
                    data_source=path_parameter_sources["rxSensitivityDbm"],
                )
            )
            calculation_limitations.append(f"ONT '{ont.name}' receiver sensitivity is invalid.")
        else:
            rx_sensitivity = parsed_rx_sens

        raw_rx_ovl = None if path_parameter_sources["rxOverloadDbm"] == "unknown" else (config.rx_overload_dbm if overload_override is None else overload_override)
        parsed_rx_ovl, valid_rx_ovl = _safe_float(raw_rx_ovl)
        rx_overload: Optional[float] = None
        if path_parameter_sources["rxOverloadDbm"] == "unknown" or (raw_rx_ovl is None and valid_rx_ovl):
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="RX_OVERLOAD_UNKNOWN",
                    severity="warning",
                    category="configuration",
                    message=f"Receiver overload threshold (rxOverloadDbm) is unknown for ONT '{ont.name}' ({ont.id}).",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=None,
                    expected_value=None,
                    unit="dBm",
                    corrective_action="Configure rxOverloadDbm on the ONT node or in the project optical budget settings.",
                    data_source=path_parameter_sources["rxOverloadDbm"],
                )
            )
            calculation_limitations.append(f"ONT '{ont.name}' receiver overload threshold (rxOverloadDbm) is unknown.")
        elif not valid_rx_ovl or parsed_rx_ovl is None:
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message=f"Receiver overload threshold ({raw_rx_ovl} dBm) on ONT '{ont.name}' ({ont.id}) is invalid.",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=str(raw_rx_ovl),
                    expected_value="finite number",
                    unit="dBm",
                    corrective_action="Set rxOverloadDbm to a valid finite number in dBm (e.g., -8.0 dBm).",
                    data_source=path_parameter_sources["rxOverloadDbm"],
                )
            )
            calculation_limitations.append(f"ONT '{ont.name}' receiver overload threshold is invalid.")
        else:
            rx_overload = parsed_rx_ovl

        if rx_sensitivity is not None and rx_overload is not None and rx_sensitivity >= rx_overload:
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message=f"ONT '{ont.name}' receiver sensitivity ({rx_sensitivity} dBm) must be lower than receiver overload ({rx_overload} dBm).",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=rx_sensitivity,
                    expected_value=f"< {rx_overload}",
                    unit="dBm",
                    corrective_action="Ensure rxSensitivityDbm is strictly less than rxOverloadDbm.",
                    data_source=path_parameter_sources["rxSensitivityDbm"],
                )
            )

        safety_margin = None if path_parameter_sources["safetyMarginDb"] == "unknown" else config.safety_margin_db
        if safety_margin is not None and safety_margin < 0:
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message=f"Optical safety margin ({safety_margin} dB) cannot be negative.",
                    affected_entity_type="project",
                    affected_entity_id=project.id,
                    affected_entity_name=project.name,
                    actual_value=safety_margin,
                    expected_value=">= 0",
                    unit="dB",
                    corrective_action="Configure a non-negative safetyMarginDb in project optical budget settings.",
                    data_source=path_parameter_sources["safetyMarginDb"],
                )
            )
            safety_margin = None

        min_margin = None if path_parameter_sources["minMarginDb"] == "unknown" else config.min_margin_db
        if min_margin is not None and not math.isfinite(min_margin):
            has_invalid_configuration = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_CONFIGURATION_INVALID",
                    severity="error",
                    category="configuration",
                    message="Minimum optical design margin (minMarginDb) must be a finite number.",
                    affected_entity_type="project",
                    affected_entity_id=project.id,
                    affected_entity_name=project.name,
                    actual_value=str(min_margin),
                    expected_value="finite number",
                    unit="dB",
                    corrective_action="Configure a valid finite minMarginDb in project optical settings.",
                    data_source=path_parameter_sources["minMarginDb"],
                )
            )
            min_margin = None

        splitter_loss = (
            round(sum(s.loss_db for s in path_splitters if s.loss_db is not None), 2)
            if not has_unconfigured_splitter and all(s.loss_db is not None for s in path_splitters)
            else None
        )
        standard_loss = config.project_standard_loss_db
        standard_variance = None
        # Physical path attenuation (cable fiber + connectors + splices + splitters)
        physical_loss = (
            round(fiber_loss + connector_loss + splice_loss + splitter_loss + additional_loss, 2)
            if all(value is not None for value in (fiber_loss, connector_loss, splice_loss, splitter_loss, additional_loss))
            else None
        )
        if physical_loss is not None and standard_loss is not None:
            standard_variance = round(physical_loss - standard_loss, 2)
        total_loss_budget = (
            round(physical_loss + safety_margin, 2)
            if physical_loss is not None and safety_margin is not None
            else None
        )

        # PHYSICAL RECEIVED POWER (Safety margin NOT deducted from physical received power)
        received_power = round(tx_power - physical_loss, 2) if tx_power is not None and physical_loss is not None else None

        # DESIGN MARGIN (Excess power above sensitivity after reserving safety margin)
        margin = (
            round(received_power - rx_sensitivity - safety_margin, 2)
            if received_power is not None and rx_sensitivity is not None and safety_margin is not None
            else None
        )
        gross_margin = round(received_power - rx_sensitivity, 2) if received_power is not None and rx_sensitivity is not None else None
        # These headrooms use physical received power; the reserve is only in
        # design margin and is not subtracted from either receiver limit.
        sensitivity_margin = gross_margin
        overload_margin = round(rx_overload - received_power, 2) if rx_overload is not None and received_power is not None else None

        # Evaluate all independently determinable optical budget threshold violations
        has_overload_fail = False
        has_sensitivity_fail = False
        has_margin_fail = False

        if received_power is not None and rx_overload is not None and received_power > rx_overload:
            has_overload_fail = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="RX_ABOVE_OVERLOAD",
                    severity="error",
                    category="optical_budget",
                    message=f"Physical received power ({received_power:.2f} dBm) exceeds ONT '{ont.name}' receiver overload limit ({rx_overload:.2f} dBm) by {round(received_power - rx_overload, 2):.2f} dB.",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=received_power,
                    expected_value=rx_overload,
                    unit="dBm",
                    corrective_action="Insert an optical attenuator, increase split ratio, or reduce OLT transmit power so received power does not exceed the overload threshold.",
                    data_source=path_parameter_sources["rxOverloadDbm"],
                )
            )

        if received_power is not None and rx_sensitivity is not None and received_power < rx_sensitivity:
            has_sensitivity_fail = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="RX_BELOW_SENSITIVITY",
                    severity="error",
                    category="optical_budget",
                    message=f"Physical received power ({received_power:.2f} dBm) is below ONT '{ont.name}' receiver sensitivity threshold ({rx_sensitivity:.2f} dBm) by {round(rx_sensitivity - received_power, 2):.2f} dB.",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=received_power,
                    expected_value=rx_sensitivity,
                    unit="dBm",
                    corrective_action="Reduce total path attenuation (use lower split ratio, shorter route, or fewer connectors/splices) or increase OLT launch power.",
                    data_source=path_parameter_sources["rxSensitivityDbm"],
                )
            )

        if margin is not None and min_margin is not None and margin < min_margin:
            has_margin_fail = True
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_MARGIN_INSUFFICIENT",
                    severity="error",
                    category="optical_budget",
                    message=f"Optical design margin ({margin:.2f} dB after {safety_margin:.2f} dB reserve) is below the required minimum design margin ({min_margin:.2f} dB).",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=margin,
                    expected_value=min_margin,
                    unit="dB",
                    corrective_action="Reduce path loss, lower the required safety reserve if justified, or increase transmitter launch power to meet the minimum design margin.",
                    data_source=path_parameter_sources["minMarginDb"],
                )
            )

        unverified_parameters = _legacy_or_unknown_sources(path_parameter_sources)
        legacy_parameters = [name for name in unverified_parameters if path_parameter_sources.get(name) == "legacy_fallback"]
        if legacy_parameters:
            calculation_limitations.append(
                f"Legacy parameters without recorded source provenance ({', '.join(legacy_parameters)}) withhold automatic PASS/FAIL certification."
            )
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="LEGACY_PARAMETERS_UNVERIFIED",
                    severity="warning",
                    category="configuration",
                    message=f"Optical parameters ({', '.join(legacy_parameters)}) come from a legacy saved project without recorded provenance.",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=len(legacy_parameters),
                    expected_value=0,
                    unit="unverified parameters",
                    corrective_action="Apply an explicit optical profile or confirm parameter values in Optical Budget Settings.",
                    data_source="legacy_fallback",
                )
            )

        missing_component_ids = [
            component.id
            for component in path_components
            if component.configured_source != "configured" or component.configured_loss_db is None
        ]

        # Deterministic status and reason evaluation:
        # 1. Separate connectivity_status and optical_budget_status
        connectivity_status_val = "invalid_topology" if relevant_invalid_issues else "connected"
        has_budget_fail = has_overload_fail or has_sensitivity_fail or has_margin_fail or has_invalid_configuration
        has_missing_inputs = (
            has_unconfigured_splitter
            or total_length_m is None
            or any(value is None for value in (physical_loss, tx_power, received_power, rx_sensitivity, rx_overload, margin, min_margin))
            or bool(unverified_parameters)
            or bool(missing_component_ids)
        )

        if has_budget_fail and not legacy_parameters:
            optical_budget_status_val = "fail"
        elif has_missing_inputs:
            optical_budget_status_val = "unknown"
        else:
            optical_budget_status_val = "pass"

        if has_unconfigured_splitter:
            status_value = "fail" if has_invalid_configuration else "unknown"
            status_reason = "invalid_optical_configuration" if has_invalid_configuration else "unknown_splitter_ratio"
        elif has_invalid_configuration:
            status_value = "fail"
            status_reason = "invalid_optical_configuration"
        elif has_overload_fail and not legacy_parameters:
            status_value = "fail"
            status_reason = "rx_power_exceeds_overload"
        elif has_sensitivity_fail and not legacy_parameters:
            status_value = "fail"
            status_reason = "rx_power_below_sensitivity"
        elif has_margin_fail and not legacy_parameters:
            status_value = "fail"
            status_reason = "insufficient_safety_margin"
        elif any(value is None for value in (total_length_m, physical_loss, tx_power, received_power, rx_sensitivity, rx_overload, margin, min_margin)):
            status_value = "unknown"
            if missing_component_ids:
                status_reason = "unknown_component_loss"
            elif unverified_parameters:
                status_reason = (
                    "legacy_fallback_parameters"
                    if any(path_parameter_sources[name] == "legacy_fallback" for name in unverified_parameters)
                    else "unknown_optical_parameters"
                )
            else:
                status_reason = "missing_optical_parameter"
        else:
            status_value = "pass"
            status_reason = "optical_budget_within_limits"

        if unverified_parameters and status_value != "fail":
            status_value = "unknown"
            if not has_unconfigured_splitter:
                status_reason = (
                    "legacy_fallback_parameters"
                    if any(path_parameter_sources[name] == "legacy_fallback" for name in unverified_parameters)
                    else "unknown_optical_parameters"
                )
        if missing_component_ids and status_value != "fail":
            status_value = "unknown"
            if not has_unconfigured_splitter:
                status_reason = "unknown_component_loss"
        if relevant_invalid_issues:
            status_value = "unknown"
            status_reason = "invalid_topology_connection"
            for connection in project.connections:
                if (
                    connection.id in invalid_connection_issues
                    and connection.from_node_id in forward_reachable
                    and connection.to_node_id in backward_reachable
                ):
                    for issue in invalid_connection_issues[connection.id]:
                        path_diagnostics.append(
                            OpticalDiagnostic(
                                code="OPTICAL_PATH_DISCONNECTED",
                                severity="error",
                                category="connectivity",
                                message=f"Connection '{connection.id}' failed topology validation ({issue.code}): {issue.message}",
                                affected_entity_type="connection",
                                affected_entity_id=connection.id,
                                affected_entity_name=f"{connection.from_node_id} -> {connection.to_node_id}",
                                actual_value=issue.code,
                                expected_value="valid_optical_connection",
                                unit=None,
                                corrective_action="Fix or remove the invalid topology connection.",
                                data_source="topology_validation",
                            )
                        )

        if status_value == "pass":
            path_diagnostics.append(
                OpticalDiagnostic(
                    code="OPTICAL_BUDGET_PASS",
                    severity="info",
                    category="optical_budget",
                    message=f"Optical path to ONT '{ont.name}' passes all power and design margin thresholds (Rx: {received_power:.2f} dBm, Margin: {margin:.2f} dB).",
                    affected_entity_type="ont",
                    affected_entity_id=ont.id,
                    affected_entity_name=ont.name,
                    actual_value=received_power,
                    expected_value=f"[{rx_sensitivity:.2f}, {rx_overload:.2f}]",
                    unit="dBm",
                    corrective_action=None,
                    data_source=config.profile_id or "configured",
                )
            )

        details_reason = (
            f"Unknown or unverified splitter specification on {', '.join(unconfigured_splitter_names)}"
            if has_unconfigured_splitter
            else status_reason
        )
        paths.append(
            OpticalPathResult(
                ont_node_id=ont.id,
                customer_ids=linked_customers,
                node_ids=path_node_ids,
                connection_ids=[connection.id for connection in path_connections],
                cable_segment_ids=cable_segment_ids,
                length_m=round(total_length_m, 2) if total_length_m is not None else None,
                loss_db=physical_loss,
                tx_power_dbm=tx_power,
                received_power_dbm=received_power,
                rx_sensitivity_dbm=rx_sensitivity,
                rx_overload_dbm=rx_overload,
                sensitivity_margin_db=sensitivity_margin,
                overload_margin_db=overload_margin,
                margin_db=margin,
                min_margin_db=min_margin,
                status=status_value,
                connectivity_status=connectivity_status_val,
                optical_budget_status=optical_budget_status_val,
                status_reason=status_reason,
                diagnostics=path_diagnostics,
                calculation_limitations=calculation_limitations,
                parameter_sources=path_parameter_sources,
                profile_id=config.profile_id,
                segments=path_segments,
                splitters=path_splitters,
                component_losses=component_losses,
                standard_loss_db=standard_loss,
                standard_variance_db=standard_variance,
                datasheet_references=datasheet_references,
                field_measurements=field_measurements,
                location_loss_summary=location_loss_summary,
                details={
                    "fiberLossDb": round(fiber_loss, 2) if fiber_loss is not None else None,
                    "connectorLossDb": round(connector_loss, 2) if connector_loss is not None else None,
                    "spliceLossDb": round(splice_loss, 2) if splice_loss is not None else None,
                    "splitterLossDb": splitter_loss,
                    "otherComponentLossDb": additional_loss,
                    "missingComponentIds": missing_component_ids,
                    "reusedCableSegmentIds": sorted(reused_route_cable_ids),
                    "routeLengthSemantics": "Each unique cable segment geometry contributes once per optical path.",
                    "physicalLossDb": physical_loss,
                    "safetyMarginDb": safety_margin,
                    "totalLossDb": total_loss_budget,
                    "txPowerDbm": tx_power,
                    "receivedPowerDbm": received_power,
                    "rxSensitivityDbm": rx_sensitivity,
                    "rxOverloadDbm": rx_overload,
                    "sensitivityMarginDb": sensitivity_margin,
                    "overloadMarginDb": overload_margin,
                    "marginDb": margin,
                    "grossMarginDb": gross_margin,
                    "designMarginDb": margin,
                    "minMarginDb": min_margin,
                    "reason": details_reason,
                    "parameterSources": path_parameter_sources,
                    "unverifiedParameters": unverified_parameters,
                    "profileId": config.profile_id,
                    "invalidConnections": [
                        {"connectionId": connection.id, "code": issue.code, "message": issue.message}
                        for connection in project.connections
                        if connection.id in invalid_connection_issues
                        and connection.from_node_id in forward_reachable
                        and connection.to_node_id in backward_reachable
                        for issue in invalid_connection_issues[connection.id]
                    ],
                    "segments": [s.model_dump(by_alias=True) for s in path_segments],
                    "splitters": [s.model_dump(by_alias=True) for s in path_splitters],
                },
            )
        )

    disconnected_customer_ids = [
        customer.id for customer in project.customers
        if customer.status.value == "connected" and customer.ont_node_id not in reachable_ont_ids
    ]
    unassigned_customer_count = sum(1 for customer in project.customers if customer.ont_node_id is None)
    unreachable_ont_count = sum(1 for ont in ont_nodes if ont.id not in reachable_ont_ids)
    path_counts = {name: sum(1 for path in paths if path.status == name) for name in ("pass", "fail", "unknown")}
    summary.update({
        "totalPaths": len(paths),
        "pathPassed": path_counts["pass"],
        "pathFailed": path_counts["fail"],
        "pathUnknown": path_counts["unknown"],
        "disconnectedCustomers": len(disconnected_customer_ids),
        "unassignedCustomers": unassigned_customer_count,
        "unreachableOnts": unreachable_ont_count,
    })

    known_connection_ids = {connection.id for connection in project.connections}
    known_node_ids = set(nodes_by_id)
    component_diagnostics = []
    for component in project.optical_components:
        if component.node_id and component.node_id not in known_node_ids:
            component_diagnostics.append({"code": "missing_optical_component_node", "componentId": component.id, "nodeId": component.node_id})
        if component.connection_id and component.connection_id not in known_connection_ids:
            component_diagnostics.append({"code": "missing_optical_component_connection", "componentId": component.id, "connectionId": component.connection_id})

    # Intermediate readings are prefixes of the already evaluated OLT->ONT
    # paths. This deliberately reuses segment and splitter results rather than
    # implementing a second attenuation formula. A splitter is charged once
    # when its node is reached, matching the end-to-end path convention.
    intermediate_nodes = []
    def prefix_parameter_sources(path: OpticalPathResult, node_ids: list[str], connection_ids: list[str]) -> Dict[str, str]:
        cable_ids = {
            connection.cable_segment_id
            for connection in project.connections
            if connection.id in connection_ids
        }
        component_ids = {
            component.id for component in project.optical_components
            if ((component.node_id and component.node_id in node_ids)
                or (component.connection_id and component.connection_id in connection_ids))
        }
        scope_ids = set(node_ids) | cable_ids | component_ids
        return {
            key: value for key, value in path.parameter_sources.items()
            if key == "txPowerDbm" or key.split(".", 1)[0] in scope_ids
        }

    def make_loss_breakdown(path: OpticalPathResult, prefix_node_ids: list[str], prefix_connection_ids: list[str]):
        """Present evaluator outputs in topology order; never recompute unit losses."""
        rows = []
        category_values: Dict[str, list] = {key: [] for key in ("fiber", "connector", "splice", "splitter", "passive_component")}
        cumulative: Optional[float] = 0.0
        seen_components = set()
        segments = path.segments[:len(prefix_connection_ids)]
        connections_by_id = {connection.id: connection for connection in project.connections}
        cables_by_id = {cable.id: cable for cable in project.cable_segments}
        nodes_by_path_id = {node.id: node for node in project.nodes}
        splitter_by_node = {splitter.node_id: splitter for splitter in path.splitters}
        component_records = {str(item.get("componentId")): item for item in path.component_losses}
        components_by_node: Dict[str, list] = {}
        components_by_connection: Dict[str, list] = {}
        for component in project.optical_components:
            if component.id not in component_records:
                continue
            if component.node_id in prefix_node_ids:
                components_by_node.setdefault(component.node_id, []).append(component)
            if component.connection_id in prefix_connection_ids:
                components_by_connection.setdefault(component.connection_id, []).append(component)

        def append_row(**values):
            nonlocal cumulative
            loss = values.get("total_loss_db")
            if loss is None:
                cumulative = None
            elif cumulative is not None:
                cumulative += float(loss)
            category_values[values["category"]].append(loss)
            rows.append(IntermediateOpticalLossItem(**values, cumulative_loss_db=round(cumulative, 2) if cumulative is not None else None))

        def append_node_items(node_id: str, position: int):
            splitter = splitter_by_node.get(node_id)
            node = nodes_by_path_id.get(node_id)
            if splitter:
                append_row(
                    component_id=f"{node_id}:splitter", component=f"Splitter · {splitter.node_name} ({node_id}){f' · {splitter.splitter_ratio}' if splitter.splitter_ratio else ''}",
                    category="splitter", position=f"At {node.name if node else node_id} (topology node {position + 1})",
                    quantity=1.0, quantity_unit="device", unit_loss_db=splitter.loss_db,
                    unit_loss_unit="dB/device", total_loss_db=splitter.loss_db,
                    source=path.parameter_sources.get(f"{node_id}.splitterLossDb", "unknown"),
                    node_id=node_id, path_position=position,
                )
            for component in components_by_node.get(node_id, []):
                if component.id in seen_components:
                    continue
                seen_components.add(component.id)
                record = component_records[component.id]
                value = record.get("lossDb")
                append_row(
                    component_id=component.id, component=f"{component.kind} · {component.id}", category="passive_component",
                    position=f"At {node.name if node else node_id} (topology node {position + 1})",
                    quantity=1.0, quantity_unit="component", unit_loss_db=value, unit_loss_unit="dB/component",
                    total_loss_db=value if isinstance(value, (int, float)) else None,
                    source=str(record.get("source", component.configured_source)), node_id=node_id, path_position=position,
                )

        if prefix_node_ids:
            append_node_items(prefix_node_ids[0], 0)
        for index, segment in enumerate(segments):
            connection = connections_by_id.get(segment.connection_id)
            cable = cables_by_id.get(segment.cable_segment_id)
            position = f"{segment.from_node_name} → {segment.to_node_name} (hop {index + 1})"
            cable_category = segment.cable_category or (cable.cable_type if cable else None) or "Unspecified"
            segment_source = path.parameter_sources.get(f"{segment.cable_segment_id}.fiberAttenuationDbPerKm", "unknown")
            length = segment.route_length_contribution_m
            append_row(
                component_id=f"{segment.cable_segment_id}:fiber:{segment.connection_id}",
                component=f"Fiber attenuation · {segment.cable_name} ({segment.cable_segment_id}) · {cable_category}",
                category="fiber", position=position,
                quantity=segment.length_m if length is not None else None, quantity_unit="m",
                calculation_quantity=length, calculation_quantity_unit="m",
                unit_loss_db=segment.attenuation_db_per_km, unit_loss_unit="dB/km", total_loss_db=segment.fiber_loss_db,
                source=segment_source, connection_id=segment.connection_id, cable_segment_id=segment.cable_segment_id,
                cable_name=segment.cable_name, cable_category=cable_category, path_position=index,
            )
            connector_unit = segment.connector_loss_db / segment.connectors_count if segment.connectors_count and segment.connector_loss_db is not None else None
            append_row(
                component_id=f"{segment.connection_id}:connectors", component=f"Connectors · {segment.cable_name} ({segment.cable_segment_id})",
                category="connector", position=position, quantity=segment.connectors_count, quantity_unit="connector",
                unit_loss_db=round(connector_unit, 4) if connector_unit is not None else None,
                unit_loss_unit="dB/connector", total_loss_db=segment.connector_loss_db,
                source=path.parameter_sources.get(f"{segment.cable_segment_id}.connectorLossDb", "unknown"),
                connection_id=segment.connection_id, cable_segment_id=segment.cable_segment_id,
                cable_name=segment.cable_name, cable_category=cable_category, path_position=index,
            )
            route_splice_count = segment.splices_count
            route_splice_total = (
                round(segment.splice_loss_db - segment.pigtail_splice_loss_db, 2)
                if segment.splice_loss_db is not None and segment.pigtail_splices_count and segment.pigtail_splice_loss_db is not None
                else segment.splice_loss_db if not segment.pigtail_splices_count else None
            )
            route_splice_unit = route_splice_total / route_splice_count if route_splice_count and route_splice_total is not None else None
            append_row(
                component_id=f"{segment.connection_id}:splices", component=f"Splices · {segment.cable_name} ({segment.cable_segment_id})",
                category="splice", position=position, quantity=route_splice_count, quantity_unit="splice",
                unit_loss_db=round(route_splice_unit, 4) if route_splice_unit is not None else None,
                unit_loss_unit="dB/splice", total_loss_db=route_splice_total,
                source=path.parameter_sources.get(f"{segment.cable_segment_id}.spliceLossDb", "unknown"),
                connection_id=segment.connection_id, cable_segment_id=segment.cable_segment_id,
                cable_name=segment.cable_name, cable_category=cable_category, path_position=index,
            )
            if segment.pigtail_splices_count:
                append_row(
                    component_id=f"{segment.connection_id}:pigtail-splices", component=f"Pigtail splices · {segment.cable_name} ({segment.cable_segment_id})",
                    category="splice", position=position, quantity=segment.pigtail_splices_count, quantity_unit="splice",
                    unit_loss_db=segment.pigtail_splice_loss_db / segment.pigtail_splices_count if segment.pigtail_splice_loss_db is not None else None,
                    unit_loss_unit="dB/splice", total_loss_db=segment.pigtail_splice_loss_db,
                    source=path.parameter_sources.get(f"{segment.cable_segment_id}.pigtailSpliceLossDb", "unknown"),
                    connection_id=segment.connection_id, cable_segment_id=segment.cable_segment_id,
                    cable_name=segment.cable_name, cable_category=cable_category, path_position=index,
                )
            if connection:
                for component in components_by_connection.get(connection.id, []):
                    if component.id in seen_components:
                        continue
                    seen_components.add(component.id)
                    record = component_records[component.id]
                    value = record.get("lossDb")
                    append_row(
                        component_id=component.id, component=f"{component.kind} · {component.id}", category="passive_component",
                        position=f"On {position}", quantity=1.0, quantity_unit="component", unit_loss_db=value,
                        unit_loss_unit="dB/component", total_loss_db=value if isinstance(value, (int, float)) else None,
                        source=str(record.get("source", component.configured_source)), connection_id=connection.id,
                        path_position=index,
                    )
            append_node_items(segment.to_node_id, index + 1)

        category_totals = {
            category: (None if any(value is None for value in values) else round(sum(values), 2)) if values else 0.0
            for category, values in category_values.items()
        }
        return rows, category_totals

    for target in ((node for node in project.nodes if node.type in {NodeType.ODC, NodeType.ODP}) if _include_intermediate else []):
        reachable_paths = 0
        def count_routes(current_id: str, visited: set) -> None:
            nonlocal reachable_paths
            if reachable_paths >= 2:
                return
            if current_id == target.id:
                reachable_paths += 1
                return
            for edge in all_optical_outgoing.get(current_id, []):
                if edge.to_node_id not in visited:
                    count_routes(edge.to_node_id, visited | {edge.to_node_id})
        for olt in (node for node in project.nodes if node.type == NodeType.OLT):
            count_routes(olt.id, {olt.id})
            if reachable_paths >= 2:
                break
        if reachable_paths > 1:
            intermediate_nodes.append({
                "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
                "status": "ambiguous", "diagnostics": ["Multiple directed OLT paths reach this passive node."],
            })
            continue
        candidate_prefixes = {}
        for path in paths:
            if target.id not in path.node_ids:
                continue
            target_index = path.node_ids.index(target.id)
            if target_index == 0:
                continue
            prefix_node_ids = path.node_ids[: target_index + 1]
            prefix_connection_ids = path.connection_ids[:target_index]
            key = tuple(prefix_connection_ids)
            candidate_prefixes.setdefault(key, (path, target_index, prefix_node_ids, prefix_connection_ids))

        if len(candidate_prefixes) > 1:
            intermediate_nodes.append({
                "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
                "status": "ambiguous", "diagnostics": ["Multiple directed OLT paths reach this passive node."],
            })
            continue
        if not candidate_prefixes:
            if reachable_paths == 1:
                # Reuse the existing ONT path evaluator by making a temporary
                # analysis copy that terminates at this passive node. No data
                # is persisted and the passive node remains non-transmitting.
                probe_nodes = [
                    node.model_copy(update={"type": NodeType.ONT}) if node.id == target.id else node
                    for node in project.nodes
                ]
                probe = calculate_optical_budget(
                    project.model_copy(update={"nodes": probe_nodes}),
                    config_override=config,
                    _include_intermediate=False,
                )
                probe_path = next((item for item in probe.paths if item.ont_node_id == target.id), None)
                if probe_path is None or probe_path.connectivity_status != "connected":
                    intermediate_nodes.append({
                        "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
                        "status": "unknown", "diagnostics": ["The directed route could not be evaluated as a valid optical path."]
                            + ([str(item.message) for item in probe_path.diagnostics] if probe_path else []),
                    })
                    continue
                probe_diagnostics = [item.message for item in probe_path.diagnostics]
                probe_diagnostics.extend(probe_path.calculation_limitations)
                probe_sources = prefix_parameter_sources(probe_path, probe_path.node_ids, probe_path.connection_ids)
                unverified_sources = [key for key, source in probe_sources.items() if source in {"legacy_fallback", "unknown"}]
                if unverified_sources:
                    probe_diagnostics.append("Unverified optical input provenance: " + ", ".join(unverified_sources))
                probe_breakdown, probe_category_losses = make_loss_breakdown(probe_path, probe_path.node_ids, probe_path.connection_ids)
                intermediate_nodes.append({
                    "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
                    "status": "estimated" if probe_path.received_power_dbm is not None and not unverified_sources else "unknown",
                    "source_olt_id": probe_path.node_ids[0] if probe_path.node_ids else None,
                    "node_ids": probe_path.node_ids, "connection_ids": probe_path.connection_ids,
                    "length_m": probe_path.length_m, "accumulated_loss_db": probe_path.loss_db,
                    "estimated_power_dbm": probe_path.received_power_dbm,
                    "transmitter_power_dbm": probe_path.tx_power_dbm,
                    "source_olt_name": nodes_by_id[probe_path.node_ids[0]].name if probe_path.node_ids and probe_path.node_ids[0] in nodes_by_id else None,
                    "loss_breakdown": probe_breakdown, "category_losses_db": probe_category_losses,
                    "parameter_sources": probe_sources,
                    "diagnostics": probe_diagnostics,
                })
                continue
            intermediate_nodes.append({
                "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
                "status": "unreachable", "diagnostics": ["No evaluated directed OLT path reaches this node."],
            })
            continue

        path, target_index, prefix_node_ids, prefix_connection_ids = next(iter(candidate_prefixes.values()))
        prefix_segments = path.segments[:target_index]
        diagnostics = []
        segment_losses = [segment.total_segment_loss_db for segment in prefix_segments]
        length_parts = [segment.route_length_contribution_m for segment in prefix_segments]
        if any(value is None for value in segment_losses):
            diagnostics.append("One or more route segment losses are incomplete.")
        if any(value is None for value in length_parts):
            diagnostics.append("One or more route lengths are unknown.")

        prefix_splitters = [splitter for splitter in path.splitters if splitter.node_id in prefix_node_ids]
        splitter_losses = [splitter.loss_db for splitter in prefix_splitters]
        if any(value is None for value in splitter_losses):
            diagnostics.append("A splitter on the prefix has unknown insertion loss.")

        prefix_components = []
        seen_component_ids = set()
        for component in project.optical_components:
            attached = ((component.node_id and component.node_id in prefix_node_ids)
                        or (component.connection_id and component.connection_id in prefix_connection_ids))
            if attached and component.id not in seen_component_ids:
                prefix_components.append(component)
                seen_component_ids.add(component.id)
        component_losses = [
            component.configured_loss_db
            if component.configured_source == "configured" else None
            for component in prefix_components
        ]
        if any(value is None for value in component_losses):
            diagnostics.append("An explicitly modeled passive component has unknown configured loss.")

        loss_parts = segment_losses + splitter_losses + component_losses
        complete_loss = all(value is not None for value in loss_parts)
        total_loss = round(sum(value for value in loss_parts if value is not None), 2) if complete_loss else None
        tx_power = path.tx_power_dbm
        estimated_power = round(tx_power - total_loss, 2) if tx_power is not None and total_loss is not None else None
        if tx_power is None:
            diagnostics.append("OLT launch power is unknown.")
        parameter_sources = prefix_parameter_sources(path, prefix_node_ids, prefix_connection_ids)
        unverified_sources = [key for key, source in parameter_sources.items() if source in {"legacy_fallback", "unknown"}]
        if unverified_sources:
            diagnostics.append("Unverified optical input provenance: " + ", ".join(unverified_sources))
        complete_length = all(value is not None for value in length_parts)
        length_m = round(sum(value for value in length_parts if value is not None), 2) if complete_length else None
        loss_breakdown, category_losses = make_loss_breakdown(path, prefix_node_ids, prefix_connection_ids)
        intermediate_nodes.append({
            "node_id": target.id, "node_name": target.name, "node_type": target.type.value,
            "status": "estimated" if estimated_power is not None and not unverified_sources else "unknown",
            "source_olt_id": path.node_ids[0] if path.node_ids else None,
            "node_ids": prefix_node_ids, "connection_ids": prefix_connection_ids,
            "length_m": length_m, "accumulated_loss_db": total_loss,
            "estimated_power_dbm": estimated_power, "transmitter_power_dbm": tx_power,
            "source_olt_name": nodes_by_id[path.node_ids[0]].name if path.node_ids and path.node_ids[0] in nodes_by_id else None,
            "loss_breakdown": loss_breakdown, "category_losses_db": category_losses,
            "parameter_sources": parameter_sources,
            "diagnostics": diagnostics,
        })

    return OpticalBudgetResult(
        project_id=project.id,
        calculated_at=current_utc_timestamp(),
        links=link_results,
        paths=paths,
        intermediate_nodes=intermediate_nodes,
        disconnected_customer_ids=disconnected_customer_ids,
        summary=summary,
        diagnostics=component_diagnostics,
    )
