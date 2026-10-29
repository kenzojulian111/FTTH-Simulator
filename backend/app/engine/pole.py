"""Physical pole/span planning; relationships are always explicit project data."""
from math import ceil
from typing import Dict, List, Optional, Sequence, Tuple

from backend.app.domain.models import CableSegment, NetworkNode, NodeType, PoleSpan, PoleSpanResult, Project, current_utc_timestamp
from backend.app.engine.geo import calculate_route_length, distance_meters

VERTEX_MATCH_TOLERANCE_M = 1.0


def _resolve_cable_category(cable) -> str:
    if cable is None:
        return ""
    explicit = cable.properties.get("cableCategory")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    raw = (cable.cable_type or "").strip()
    raw_lower = raw.lower()
    for known in ("feeder", "distribution", "drop", "indoor", "custom"):
        if raw_lower == known or raw_lower.startswith(f"{known} ") or raw_lower.endswith(f" {known}"):
            return known
    return raw


def _is_geographically_placed(entity) -> bool:
    if entity is None:
        return False
    props = getattr(entity, "properties", None) or {}
    return props.get("geographicPositionSet") is not False


def _find_matching_vertex_index(
    coordinates: Sequence[Tuple[float, float]],
    pole: Optional[NetworkNode],
    tolerance_m: float = VERTEX_MATCH_TOLERANCE_M,
) -> Optional[int]:
    if pole is None or pole.type != NodeType.POLE or not _is_geographically_placed(pole) or not coordinates:
        return None
    pole_coord = pole.location.coordinates
    best_idx: Optional[int] = None
    best_dist = float("inf")
    for idx, coord in enumerate(coordinates):
        dist = distance_meters(coord, pole_coord)
        if dist <= tolerance_m and dist < best_dist:
            best_dist = dist
            best_idx = idx
    return best_idx


def extract_subspan_coordinates(
    cable: Optional[CableSegment],
    start_pole: Optional[NetworkNode],
    end_pole: Optional[NetworkNode],
    tolerance_m: float = VERTEX_MATCH_TOLERANCE_M,
) -> Optional[List[Tuple[float, float]]]:
    """Extract contiguous cable polyline sub-route between two poles if both align with cable vertices."""
    if cable is None or not cable.geometry or len(cable.geometry.coordinates) < 2:
        return None
    coords = cable.geometry.coordinates
    start_idx = _find_matching_vertex_index(coords, start_pole, tolerance_m=tolerance_m)
    end_idx = _find_matching_vertex_index(coords, end_pole, tolerance_m=tolerance_m)
    if start_idx is None or end_idx is None or start_idx == end_idx:
        return None
    if start_idx < end_idx:
        return list(coords[start_idx : end_idx + 1])
    return list(reversed(coords[end_idx : start_idx + 1]))


def resolve_span_geometry_and_length(
    span: PoleSpan,
    cable: Optional[CableSegment],
    nodes_by_id: Dict[str, NetworkNode],
    cable_span_count: int,
) -> Tuple[Optional[List[Tuple[float, float]]], Optional[str], Optional[float], List[str]]:
    """Determine authoritative span geometry, geometry source, length in metres, and diagnostic codes.

    Never assigns a full cable's length to every sub-span when multiple spans share the same cable.
    """
    extra_issues: List[str] = []
    start_pole = nodes_by_id.get(span.from_pole_id)
    end_pole = nodes_by_id.get(span.to_pole_id)
    ambiguous_full_route = cable_span_count > 1 and span.covers_entire_cable_route and span.geometry is None
    preserved_length = span.length_m if (
        span.length_source == "measured"
        or (span.length_source == "legacy" and not ambiguous_full_route)
        or (span.length_source == "unknown" and span.length_m is not None)
    ) else None

    if span.geometry and span.geometry.coordinates and len(span.geometry.coordinates) >= 2:
        coords = list(span.geometry.coordinates)
        length = float(preserved_length) if preserved_length is not None else round(calculate_route_length(coords), 2)
        return coords, "span_geometry", length, extra_issues

    if cable_span_count > 1:
        subroute = extract_subspan_coordinates(cable, start_pole, end_pole)
        if subroute is not None and len(subroute) >= 2:
            length = float(preserved_length) if preserved_length is not None else round(calculate_route_length(subroute), 2)
            return subroute, "cable_subroute", length, extra_issues
        if preserved_length is not None and (span.length_source == "measured" or not span.covers_entire_cable_route):
            return None, "explicit_length", round(float(preserved_length), 2), extra_issues
        if span.covers_entire_cable_route:
            extra_issues.append("multiple_spans_require_subspan_geometry")
        return None, None, None, extra_issues

    # Single span on this cable
    if span.covers_entire_cable_route and cable is not None and cable.geometry and len(cable.geometry.coordinates) >= 2:
        coords = list(cable.geometry.coordinates)
        length = float(preserved_length) if preserved_length is not None else round(calculate_route_length(coords), 2)
        return coords, "entire_cable_route", length, extra_issues

    subroute = extract_subspan_coordinates(cable, start_pole, end_pole)
    if subroute is not None and len(subroute) >= 2:
        length = float(preserved_length) if preserved_length is not None else round(calculate_route_length(subroute), 2)
        return subroute, "cable_subroute", length, extra_issues

    if preserved_length is not None:
        return None, "explicit_length", round(float(preserved_length), 2), extra_issues

    return None, None, None, extra_issues


def calculate_pole_spans(project: Project) -> PoleSpanResult:
    nodes = {node.id: node for node in project.nodes}
    cables = {cable.id: cable for cable in project.cable_segments}
    spans = []
    diagnostics = []
    additions = 0
    complete_estimate = bool(project.pole_spans)
    assumptions = []
    max_span_limit_m = float(project.settings.pole_span_planning.default_max_span_m or 300.0)
    max_odp_to_house_m = float(project.settings.pole_span_planning.max_odp_to_house_distance_m or 300.0)

    spans_per_cable: Dict[str, int] = {}
    unique_span_ids_for_count = set()
    for s in project.pole_spans:
        if s.id in unique_span_ids_for_count:
            continue
        unique_span_ids_for_count.add(s.id)
        spans_per_cable[s.cable_segment_id] = spans_per_cable.get(s.cable_segment_id, 0) + 1

    seen_span_ids = set()
    for span in project.pole_spans:
        if span.id in seen_span_ids:
            diagnostics.append({"code": "duplicate_span_id", "spanId": span.id})
            complete_estimate = False
            continue
        seen_span_ids.add(span.id)
        cable = cables.get(span.cable_segment_id)
        start = nodes.get(span.from_pole_id)
        end = nodes.get(span.to_pole_id)
        issue_codes = []
        if cable is None:
            issue_codes.append("missing_cable_reference")
        if start is None or start.type != NodeType.POLE:
            issue_codes.append("missing_from_pole_reference")
        if end is None or end.type != NodeType.POLE:
            issue_codes.append("missing_to_pole_reference")
        cable_span_count = spans_per_cable.get(span.cable_segment_id, 1)
        geometry, geometry_source, length, resolution_issues = resolve_span_geometry_and_length(
            span, cable, nodes, cable_span_count
        )
        issue_codes.extend(resolution_issues)
        if length is None:
            issue_codes.append("span_route_geometry_unknown")
        elif length < 0:
            issue_codes.append("invalid_span_length")

        category = _resolve_cable_category(cable)
        deployment_method = cable.deployment_method if cable else "unspecified"
        non_aerial_deployment = deployment_method in {"underground", "building_attached", "other"}
        if non_aerial_deployment:
            issue_codes.append("span_on_non_aerial_cable")
        raw_cable_type = cable.cable_type if cable else ""
        rule = next(
            (
                r
                for r in project.settings.pole_span_planning.rules
                if r.cable_category in {category, raw_cable_type}
                or r.cable_category.lower() in {category.lower(), raw_cable_type.lower()}
            ),
            None,
        )
        effective_max_span_m = min(rule.max_span_m, max_span_limit_m) if rule else max_span_limit_m
        if not non_aerial_deployment:
            if rule is None:
                issue_codes.append("span_rule_unconfigured")
            elif rule.placement_policy is None:
                issue_codes.append("placement_policy_unconfigured")
                complete_estimate = False
            elif length is not None and length > effective_max_span_m:
                issue_codes.append("span_exceeds_configured_limit")
            if length is not None and length > max_span_limit_m:
                issue_codes.append("span_exceeds_300m_limit")
        endpoints_verified = all(
            pole is not None and pole.properties.get("status", pole.properties.get("lifecycleStatus")) in {"existing", "proposed", "shared"}
            for pole in (start, end)
        )
        estimated = None
        if not non_aerial_deployment and rule and rule.placement_policy == "uniform_maximum_spacing" and length is not None and endpoints_verified and span.status != "unverified":
            estimated = max(0, ceil(length / effective_max_span_m) - 1)
            additions += estimated
        else:
            complete_estimate = False
        spans.append({
            "id": span.id,
            "cableSegmentId": span.cable_segment_id,
            "cableCategory": category or None,
            "deploymentMethod": deployment_method,
            "fromPoleId": span.from_pole_id,
            "toPoleId": span.to_pole_id,
            "lengthM": length,
            "geometrySource": geometry_source,
            "maximumSpanM": None if non_aerial_deployment else effective_max_span_m,
            "placementPolicy": None if non_aerial_deployment else (rule.placement_policy if rule else None),
            "estimatedAdditionalPoles": estimated,
            "status": span.status,
            "diagnostics": issue_codes,
        })
        for code in issue_codes:
            diagnostics.append({"code": code, "spanId": span.id, "cableSegmentId": span.cable_segment_id, "poleIds": [span.from_pole_id, span.to_pole_id]})

    for cable in project.cable_segments:
        if cable.properties.get("deploymentMethodMalformed") is True:
            diagnostics.append({
                "code": "malformed_cable_deployment_method",
                "cableSegmentId": cable.id,
                "rawDeploymentMethod": cable.properties.get("rawDeploymentMethod"),
            })

    related_poles = {pole_id for span in project.pole_spans for pole_id in (span.from_pole_id, span.to_pole_id)}
    for pole in project.nodes:
        if pole.type == NodeType.POLE and pole.id not in related_poles:
            diagnostics.append({"code": "pole_without_cable_span", "poleId": pole.id})

    # Validate ODP to farthest house/customer/ONT maximum distance (<= 300 m)
    customers_by_ont: Dict[str, list] = {}
    customers_by_odp: Dict[str, list] = {}
    for customer in project.customers:
        if customer.ont_node_id:
            customers_by_ont.setdefault(customer.ont_node_id, []).append(customer)
        odp_prop = customer.properties.get("odpNodeId") or customer.properties.get("odp_node_id")
        if isinstance(odp_prop, str) and odp_prop.strip():
            customers_by_odp.setdefault(odp_prop.strip(), []).append(customer)

    odp_nodes = [node for node in project.nodes if node.type == NodeType.ODP]
    odp_house_distances: List[Dict] = []

    for odp in odp_nodes:
        house_entries = []
        seen_targets = set()
        odp_placed = _is_geographically_placed(odp)

        def _cable_route_distance(cable_obj: Optional[CableSegment], target_obj) -> Optional[float]:
            if cable_obj is None:
                return None
            if cable_obj.length_m is not None:
                return float(cable_obj.length_m)
            if not (odp_placed and _is_geographically_placed(target_obj)):
                return None
            if not cable_obj.geometry or len(cable_obj.geometry.coordinates) < 2:
                return None
            computed = round(calculate_route_length(cable_obj.geometry.coordinates), 2)
            return computed if computed > 0 else None

        # 1. Topology connections from ODP to ONT
        for conn in project.connections:
            if conn.from_node_id != odp.id:
                continue
            target_node = nodes.get(conn.to_node_id)
            if target_node is None or target_node.type != NodeType.ONT:
                continue
            cable = cables.get(conn.cable_segment_id)
            route_dist = _cable_route_distance(cable, target_node)
            geo_ont_dist = (
                round(distance_meters(odp.location.coordinates, target_node.location.coordinates), 2)
                if (odp_placed and _is_geographically_placed(target_node))
                else None
            )
            linked_custs = customers_by_ont.get(target_node.id, [])
            if linked_custs:
                for cust in linked_custs:
                    geo_cust_dist = (
                        round(distance_meters(odp.location.coordinates, cust.location.coordinates), 2)
                        if (odp_placed and _is_geographically_placed(cust))
                        else None
                    )
                    effective_dist = route_dist if route_dist is not None else geo_cust_dist
                    distance_method = (
                        "drop_route"
                        if route_dist is not None
                        else ("geodesic_fallback" if geo_cust_dist is not None else "unknown")
                    )
                    exceeds = bool(effective_dist is not None and effective_dist > max_odp_to_house_m)
                    house_entries.append({
                        "targetId": cust.id,
                        "targetName": cust.name,
                        "targetKind": "customer",
                        "ontNodeId": target_node.id,
                        "cableSegmentId": cable.id if cable else None,
                        "routeDistanceM": route_dist,
                        "geodesicDistanceM": geo_cust_dist,
                        "distanceM": effective_dist,
                        "distanceMethod": distance_method,
                        "distanceSource": "cable_route" if route_dist is not None else distance_method,
                        "exceedsLimit": exceeds,
                    })
                    seen_targets.add(("customer", cust.id))
                    seen_targets.add(("ont", target_node.id))
                    if effective_dist is None:
                        diagnostics.append({
                            "code": "odp_to_house_distance_unknown",
                            "odpId": odp.id,
                            "odpName": odp.name,
                            "customerId": cust.id,
                            "ontNodeId": target_node.id,
                            "cableSegmentId": cable.id if cable else None,
                        })
                    elif exceeds:
                        diagnostics.append({
                            "code": "odp_to_house_exceeds_300m",
                            "odpId": odp.id,
                            "odpName": odp.name,
                            "customerId": cust.id,
                            "ontNodeId": target_node.id,
                            "cableSegmentId": cable.id if cable else None,
                            "distanceM": effective_dist,
                            "distanceMethod": distance_method,
                            "maxAllowedM": max_odp_to_house_m,
                        })
            else:
                effective_dist = route_dist if route_dist is not None else geo_ont_dist
                distance_method = (
                    "drop_route"
                    if route_dist is not None
                    else ("geodesic_fallback" if geo_ont_dist is not None else "unknown")
                )
                exceeds = bool(effective_dist is not None and effective_dist > max_odp_to_house_m)
                house_entries.append({
                    "targetId": target_node.id,
                    "targetName": target_node.name,
                    "targetKind": "ont",
                    "ontNodeId": target_node.id,
                    "cableSegmentId": cable.id if cable else None,
                    "routeDistanceM": route_dist,
                    "geodesicDistanceM": geo_ont_dist,
                    "distanceM": effective_dist,
                    "distanceMethod": distance_method,
                    "distanceSource": "cable_route" if route_dist is not None else distance_method,
                    "exceedsLimit": exceeds,
                })
                seen_targets.add(("ont", target_node.id))
                if effective_dist is None:
                    diagnostics.append({
                        "code": "odp_to_house_distance_unknown",
                        "odpId": odp.id,
                        "odpName": odp.name,
                        "ontNodeId": target_node.id,
                        "cableSegmentId": cable.id if cable else None,
                    })
                elif exceeds:
                    diagnostics.append({
                        "code": "odp_to_house_exceeds_300m",
                        "odpId": odp.id,
                        "odpName": odp.name,
                        "ontNodeId": target_node.id,
                        "cableSegmentId": cable.id if cable else None,
                        "distanceM": effective_dist,
                        "distanceMethod": distance_method,
                        "maxAllowedM": max_odp_to_house_m,
                    })

        # 2. Direct drop cables between ODP and ONT not yet covered by connections
        for cable in project.cable_segments:
            other_id = None
            if cable.start_node_id == odp.id:
                other_id = cable.end_node_id
            elif cable.end_node_id == odp.id:
                other_id = cable.start_node_id
            if not other_id or ("ont", other_id) in seen_targets:
                continue
            target_node = nodes.get(other_id)
            if target_node is None or target_node.type != NodeType.ONT:
                continue
            route_dist = _cable_route_distance(cable, target_node)
            geo_ont_dist = (
                round(distance_meters(odp.location.coordinates, target_node.location.coordinates), 2)
                if (odp_placed and _is_geographically_placed(target_node))
                else None
            )
            effective_dist = route_dist if route_dist is not None else geo_ont_dist
            distance_method = (
                "drop_route"
                if route_dist is not None
                else ("geodesic_fallback" if geo_ont_dist is not None else "unknown")
            )
            exceeds = bool(effective_dist is not None and effective_dist > max_odp_to_house_m)
            house_entries.append({
                "targetId": target_node.id,
                "targetName": target_node.name,
                "targetKind": "ont",
                "ontNodeId": target_node.id,
                "cableSegmentId": cable.id,
                "routeDistanceM": route_dist,
                "geodesicDistanceM": geo_ont_dist,
                "distanceM": effective_dist,
                "distanceMethod": distance_method,
                "distanceSource": "cable_route" if route_dist is not None else distance_method,
                "exceedsLimit": exceeds,
            })
            seen_targets.add(("ont", target_node.id))
            if effective_dist is None:
                diagnostics.append({
                    "code": "odp_to_house_distance_unknown",
                    "odpId": odp.id,
                    "odpName": odp.name,
                    "ontNodeId": target_node.id,
                    "cableSegmentId": cable.id,
                })
            elif exceeds:
                diagnostics.append({
                    "code": "odp_to_house_exceeds_300m",
                    "odpId": odp.id,
                    "odpName": odp.name,
                    "ontNodeId": target_node.id,
                    "cableSegmentId": cable.id,
                    "distanceM": effective_dist,
                    "distanceMethod": distance_method,
                    "maxAllowedM": max_odp_to_house_m,
                })

        # 3. Customers explicitly referencing odpNodeId
        for cust in customers_by_odp.get(odp.id, []):
            if ("customer", cust.id) in seen_targets:
                continue
            geo_cust_dist = (
                round(distance_meters(odp.location.coordinates, cust.location.coordinates), 2)
                if (odp_placed and _is_geographically_placed(cust))
                else None
            )
            distance_method = "geodesic_fallback" if geo_cust_dist is not None else "unknown"
            exceeds = bool(geo_cust_dist is not None and geo_cust_dist > max_odp_to_house_m)
            house_entries.append({
                "targetId": cust.id,
                "targetName": cust.name,
                "targetKind": "customer",
                "ontNodeId": cust.ont_node_id,
                "cableSegmentId": None,
                "routeDistanceM": None,
                "geodesicDistanceM": geo_cust_dist,
                "distanceM": geo_cust_dist,
                "distanceMethod": distance_method,
                "distanceSource": distance_method,
                "exceedsLimit": exceeds,
            })
            seen_targets.add(("customer", cust.id))
            if geo_cust_dist is None:
                diagnostics.append({
                    "code": "odp_to_house_distance_unknown",
                    "odpId": odp.id,
                    "odpName": odp.name,
                    "customerId": cust.id,
                    "ontNodeId": cust.ont_node_id,
                })
            elif exceeds:
                diagnostics.append({
                    "code": "odp_to_house_exceeds_300m",
                    "odpId": odp.id,
                    "odpName": odp.name,
                    "customerId": cust.id,
                    "ontNodeId": cust.ont_node_id,
                    "distanceM": geo_cust_dist,
                    "distanceMethod": distance_method,
                    "maxAllowedM": max_odp_to_house_m,
                })

        known_entries = [item for item in house_entries if item["distanceM"] is not None]
        has_unknown_entry = any(item["distanceM"] is None for item in house_entries)
        farthest_entry = max(known_entries, key=lambda item: item["distanceM"]) if known_entries else (house_entries[0] if house_entries else None)
        farthest_dist = farthest_entry["distanceM"] if (farthest_entry and farthest_entry["distanceM"] is not None) else None
        if not house_entries:
            odp_status = "unconnected"
        elif farthest_dist is not None and farthest_dist > max_odp_to_house_m:
            odp_status = "fail"
        elif has_unknown_entry or farthest_dist is None:
            odp_status = "unknown"
        else:
            odp_status = "pass"
        odp_house_distances.append({
            "odpId": odp.id,
            "odpName": odp.name,
            "maxAllowedDistanceM": max_odp_to_house_m,
            "connectedHouseCount": len(house_entries),
            "farthestDistanceM": farthest_dist,
            "farthestTargetId": farthest_entry["targetId"] if farthest_entry else None,
            "farthestTargetName": farthest_entry["targetName"] if farthest_entry else None,
            "farthestTargetKind": farthest_entry["targetKind"] if farthest_entry else None,
            "status": odp_status,
            "houses": house_entries,
        })

    if complete_estimate:
        assumptions.append("Estimate counts only intermediate poles within explicit spans; endpoint poles are already included.")
        assumptions.append("Route coverage is the stored span polyline or a span explicitly marked as the entire cable route.")
    else:
        assumptions.append("Additional pole count is unknown until each span has a configured interval, covered route geometry, and verified endpoint poles.")
    assumptions.append(f"Maximum allowed pole span is {max_span_limit_m:.0f} m and maximum ODP-to-farthest-house distance is {max_odp_to_house_m:.0f} m.")
    return PoleSpanResult(
        project_id=project.id,
        calculated_at=current_utc_timestamp(),
        spans=spans,
        diagnostics=diagnostics,
        estimated_additional_poles=additions if complete_estimate else None,
        estimation_method="sum(max(0, ceil(spanLengthM / maxSpanM) - 1))" if complete_estimate else None,
        assumptions=assumptions,
        max_span_limit_m=max_span_limit_m,
        max_odp_to_house_limit_m=max_odp_to_house_m,
        odp_house_distances=odp_house_distances,
    )
