"""Service for importing and converting Google Earth KMZ/KML files into FTTH Projects."""

import io
import json
import math
import os
import re
import uuid
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

from backend.app.domain.models import (
    CableSegment,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    ProjectArea,
    ProjectSettings,
    PoleSpan,
    OpticalComponent,
    TopologyConnection,
    current_utc_timestamp,
)
from backend.app.engine.geo import calculate_route_length, distance_meters


def _strip_ns(tag: str) -> str:
    """Strip XML namespace prefix from a tag name."""
    return tag.split("}")[-1] if "}" in tag else tag


def _parse_coordinates(coord_text: str) -> List[Tuple[float, float]]:
    """Parse KML coordinate string (lon,lat[,alt]) into a list of [lon, lat] tuples."""
    results: List[Tuple[float, float]] = []
    tokens = coord_text.strip().split()
    for token in tokens:
        parts = token.strip().split(",")
        if len(parts) >= 2:
            try:
                lon = float(parts[0].strip())
                lat = float(parts[1].strip())
                if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
                    results.append((lon, lat))
            except ValueError:
                continue
    return results


def _json_extended(properties: Dict[str, Any], name: str, default):
    raw = properties.get(f"ftth:{name}")
    if not isinstance(raw, str):
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def _roundtrip_properties(placemark: Dict[str, Any]) -> Dict[str, Any]:
    saved = _json_extended(placemark["properties"], "properties", None)
    if isinstance(saved, dict):
        return saved
    return {
        key: value for key, value in placemark["properties"].items()
        if not key.startswith("ftth:")
    }


def _extract_all_placemarks(root: ET.Element) -> List[Dict[str, Any]]:
    """Extract all placemarks from KML DOM with their folder paths and properties."""
    placemarks: List[Dict[str, Any]] = []
    parent_map = {child: parent for parent in root.iter() for child in parent}

    for element in root.iter():
        if _strip_ns(element.tag) != "Placemark":
            continue

        name_elem = next((e for e in element if _strip_ns(e.tag) == "name"), None)
        desc_elem = next((e for e in element if _strip_ns(e.tag) == "description"), None)
        name = name_elem.text.strip() if name_elem is not None and name_elem.text else ""
        desc = desc_elem.text.strip() if desc_elem is not None and desc_elem.text else ""

        # Collect folder path from ancestors
        folder_path: List[str] = []
        curr = element
        while curr in parent_map:
            curr = parent_map[curr]
            if _strip_ns(curr.tag) == "Folder":
                folder_name_elem = next((e for e in curr if _strip_ns(e.tag) == "name"), None)
                if folder_name_elem is not None and folder_name_elem.text and folder_name_elem.text.strip():
                    folder_path.append(folder_name_elem.text.strip())
        folder_path.reverse()

        # ExtendedData / Custom properties
        properties: Dict[str, Any] = {}
        for ext in element.iter():
            ext_tag = _strip_ns(ext.tag)
            if ext_tag in ("Data", "SimpleData"):
                data_name = ext.attrib.get("name")
                val_elem = next((e for e in ext if _strip_ns(e.tag) == "value"), None)
                val = val_elem.text.strip() if val_elem is not None and val_elem.text else ext.text
                if data_name and val:
                    properties[data_name] = val.strip()

        # Geometry search
        points: List[Tuple[float, float]] = []
        linestrings: List[List[Tuple[float, float]]] = []
        polygons: List[List[List[Tuple[float, float]]]] = []

        for sub in element.iter():
            sub_tag = _strip_ns(sub.tag)
            if sub_tag == "Point":
                coord_elem = next((e for e in sub if _strip_ns(e.tag) == "coordinates"), None)
                if coord_elem is not None and coord_elem.text:
                    pts = _parse_coordinates(coord_elem.text)
                    if pts:
                        points.append(pts[0])
            elif sub_tag == "LineString":
                coord_elem = next((e for e in sub if _strip_ns(e.tag) == "coordinates"), None)
                if coord_elem is not None and coord_elem.text:
                    pts = _parse_coordinates(coord_elem.text)
                    if len(pts) >= 2:
                        linestrings.append(pts)
            elif sub_tag == "Polygon":
                rings = []
                for ring in (e for e in sub.iter() if _strip_ns(e.tag) == "LinearRing"):
                    coord_elem = next((e for e in ring if _strip_ns(e.tag) == "coordinates"), None)
                    if coord_elem is not None and coord_elem.text:
                        pts = _parse_coordinates(coord_elem.text)
                        if len(pts) >= 3:
                            rings.append(pts)
                if rings:
                    polygons.append(rings)

        placemarks.append({
            "name": name,
            "description": desc,
            "folderPath": folder_path,
            "properties": properties,
            "points": points,
            "lineStrings": linestrings,
            "polygons": polygons,
        })

    return placemarks


def parse_kmz_or_kml_bytes(
    file_bytes: bytes,
    filename: str = "",
    project_name: Optional[str] = None,
) -> Project:
    """Parse KMZ (ZIP) or KML (XML) binary bytes and return a fully populated FTTH Project."""
    kml_string = ""

    # Check if this is a KMZ file (starts with PK / zip magic number)
    if file_bytes.startswith(b"PK"):
        try:
            with zipfile.ZipFile(io.BytesIO(file_bytes), "r") as zf:
                kml_candidates = [n for n in zf.namelist() if n.lower().endswith(".kml")]
                if not kml_candidates:
                    raise ValueError("KMZ archive does not contain any .kml document")
                # Prefer 'doc.kml' if present, otherwise largest .kml
                chosen_kml = next((n for n in kml_candidates if os.path.basename(n).lower() == "doc.kml"), None)
                if not chosen_kml:
                    chosen_kml = max(kml_candidates, key=lambda n: zf.getinfo(n).file_size)
                kml_string = zf.read(chosen_kml).decode("utf-8", errors="replace")
        except Exception as exc:
            raise ValueError(f"Failed to read KMZ archive: {exc}") from exc
    else:
        # Plain KML file
        try:
            kml_string = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            kml_string = file_bytes.decode("latin-1", errors="replace")

    if not kml_string.strip():
        raise ValueError("KML content is empty")

    try:
        root = ET.fromstring(kml_string)
    except ET.ParseError as exc:
        raise ValueError(f"Invalid XML syntax in KML file: {exc}") from exc

    # Determine project name
    inferred_name = ""
    for elem in root.iter():
        if _strip_ns(elem.tag) in ("Document", "kml"):
            name_elem = next((e for e in elem if _strip_ns(e.tag) == "name"), None)
            if name_elem is not None and name_elem.text and name_elem.text.strip():
                inferred_name = name_elem.text.strip()
                break

    clean_file_name = os.path.splitext(os.path.basename(filename))[0] if filename else ""
    final_project_name = (
        project_name.strip() if project_name and project_name.strip()
        else inferred_name if inferred_name
        else clean_file_name if clean_file_name
        else "Imported KMZ Project"
    )

    placemarks = _extract_all_placemarks(root)
    manifest: Dict[str, Any] = {}
    for element in root.iter():
        if _strip_ns(element.tag) == "Document":
            for child in element.iter():
                if _strip_ns(child.tag) != "Data" or child.attrib.get("name") != "ftth:manifest":
                    continue
                value_element = next((part for part in child if _strip_ns(part.tag) == "value"), None)
                if value_element is not None and value_element.text:
                    try:
                        raw_manifest = json.loads(value_element.text)
                        if isinstance(raw_manifest, dict):
                            manifest = raw_manifest
                    except (TypeError, ValueError):
                        pass
                break
            break

    now_iso = current_utc_timestamp()
    proj_id = str(uuid.uuid4())

    nodes: List[NetworkNode] = []
    customers: List[Customer] = []
    cables: List[CableSegment] = []
    areas: List[ProjectArea] = []

    node_counter = {"olt": 0, "odc": 0, "odp": 0, "pole": 0, "manhole": 0, "handhole": 0, "annotation": 0, "ont": 0}
    pending_customers: List[Tuple[Dict[str, Any], Tuple[float, float]]] = []
    roundtrip_connections: List[Dict[str, Any]] = []
    roundtrip_cable_ids = set()

    # Helper function to classify node type from text
    def _classify_node(name: str, desc: str, folder_path: List[str]) -> Tuple[NodeType, str]:
        combined = f"{name} {desc} {' '.join(folder_path)}".lower()
        if re.search(r"man\s*hole|manhole|access chamber|inspection chamber|bak kontrol utama", combined):
            return NodeType.MANHOLE, "manhole"
        if re.search(r"hand\s*hole|handhole|joint box|bak kontrol kecil", combined):
            return NodeType.HANDHOLE, "handhole"
        if re.search(r"\bolt\b|optical line terminal|central office|sto\b", combined):
            return NodeType.OLT, "olt"
        if re.search(r"\bodc\b|\bfdt\b|optical distribution cabinet", combined):
            return NodeType.ODC, "odc"
        if re.search(r"\bodp\b|\bfat\b|optical distribution point|closure|box odp", combined):
            return NodeType.ODP, "odp"
        if re.search(r"\bont\b|optical network terminal|modem", combined):
            return NodeType.ONT, "ont"
        if re.search(r"pelanggan|customer|subscriber|client|rumah|home|house|building|residential|hunian|user", combined):
            return NodeType.CUSTOMER, "customer"
        if re.search(r"pole|tiang|\bpln\b|\btelkom\b|\bp\d+|\bt\d+|\bp\.\d+|\bt\.\d+", combined):
            return NodeType.POLE, "pole"
        # Require an explicit pole prefix. Bare numbers are common customer
        # labels (house numbers) and must not be classified as infrastructure.
        if re.match(r"^[tp]\.?(?:\s*)\d+$", name.strip(), re.IGNORECASE):
            return NodeType.POLE, "pole"
        # Some operator exports label subscribers as "NAME 2C TRJT" or
        # "NAME 2A TELKOM" without explicit customer keywords. Limit this
        # inference to a terminal area-code pattern; arbitrary POIs stay pins.
        if re.search(r"\b\d{1,2}[A-Z]\s+[A-Z]{3,}\s*$", name.strip(), re.IGNORECASE):
            return NodeType.CUSTOMER, "customer_code_suffix"
        # Keep unidentified points as non-optical annotations. A landmark or
        # arbitrary map pin must not silently become a planned customer/ONT.
        return NodeType.ANNOTATION, "annotation"

    # Names may suggest a category, but do not establish physical specification.
    def _classify_cable(name: str, desc: str, folder_path: List[str], length_m: float = 0) -> Optional[str]:
        combined = f"{name} {desc} {' '.join(folder_path)}".lower()
        if re.search(r"feeder|fdr|\bf-|\b12c\b|\b24c\b|\b48c\b", combined):
            return "feeder"
        if re.search(r"dist|distribusi|distribution|\bd-|\b8c\b|\b6c\b|\b4c\b", combined):
            return "distribution"
        if re.search(r"drop|\bdc\b|langganan|\b1c\b|\b2c\b", combined):
            return "drop"
        return None

    # 1. Process Points (Nodes & Customers)
    for pm in placemarks:
        for pt in pm["points"]:
            name = pm["name"] or "Unnamed Node"
            desc = pm["description"]
            entity = pm["properties"].get("ftth:entity")
            explicit_type = pm["properties"].get("ftth:nodeType")
            try:
                node_type = NodeType(explicit_type) if entity == "node" and explicit_type else _classify_node(name, desc, pm["folderPath"])[0]
            except ValueError:
                node_type = _classify_node(name, desc, pm["folderPath"])[0]
            cat_key = node_type.value
            saved_id = pm["properties"].get("ftth:id") if entity in {"node", "customer"} else None
            node_id = str(saved_id or uuid.uuid4())

            if entity == "customer":
                pending_customers.append((pm, pt))
                continue
            if node_type == NodeType.CUSTOMER:
                # Create both a Customer and an ONT node
                cust_idx = len(customers) + 1
                cust_name = name if name != "Unnamed Node" else f"Customer {cust_idx}"
                ont_id = str(uuid.uuid4())
                ont_name = f"ONT - {cust_name}"
                inferred_customer_code = bool(re.search(r"\b\d{1,2}[A-Z]\s+[A-Z]{3,}\s*$", name.strip(), re.IGNORECASE))
                classification_source = "customer_code_suffix" if inferred_customer_code else "name_or_folder_keyword"

                ont_node = NetworkNode(
                    id=ont_id,
                    type=NodeType.ONT,
                    name=ont_name,
                    location=PointGeometry(coordinates=pt),
                    properties={
                        "geographicPositionSet": True,
                        "customerId": node_id,
                        "deploymentStatus": "planned",
                        "opticalEquipmentStatus": "configured",
                        "sourceClassification": classification_source,
                    },
                    created_at=now_iso,
                    updated_at=now_iso,
                )
                nodes.append(ont_node)

                cust_obj = Customer(
                    id=node_id,
                    name=cust_name,
                    address=desc,
                    location=PointGeometry(coordinates=pt),
                    status=CustomerStatus.PLANNED,
                    ont_node_id=ont_id,
                    properties={
                        "geographicPositionSet": True,
                        "source": "google_earth_kmz",
                        "sourceClassification": classification_source,
                    },
                    created_at=now_iso,
                    updated_at=now_iso,
                )
                customers.append(cust_obj)
                continue

            node_counter[cat_key] = node_counter.get(cat_key, 0) + 1
            display_name = name if name != "Unnamed Node" else f"{node_type.value.upper()} {node_counter[cat_key]}"

            is_roundtrip_node = entity == "node"
            props: Dict[str, Any] = _roundtrip_properties(pm) if is_roundtrip_node else {
                "geographicPositionSet": True,
                "source": "google_earth_kmz",
                **{key: value for key, value in pm["properties"].items() if not key.startswith("ftth:")},
            }
            if not is_roundtrip_node:
                props["geographicPositionSet"] = True
                if node_type in {NodeType.POLE, NodeType.MANHOLE, NodeType.HANDHOLE}:
                    props.update({"status": "unverified", "infrastructureKind": node_type.value})
                elif node_type == NodeType.ANNOTATION:
                    props.update({"status": "unverified", "sourceClassification": "unclassified_placemark"})

            node = NetworkNode(
                id=node_id,
                type=node_type,
                name=display_name,
                location=PointGeometry(coordinates=pt),
                properties=props,
                created_at=str(pm["properties"].get("ftth:createdAt") or now_iso),
                updated_at=str(pm["properties"].get("ftth:updatedAt") or now_iso),
            )
            nodes.append(node)

    # Restore FTTH customer records after nodes are loaded so their existing
    # ONT references survive round-trip KMZ import without creating duplicates.
    for pm, point in pending_customers:
        metadata = pm["properties"]
        customer_id = str(metadata.get("ftth:id") or uuid.uuid4())
        ont_node_id = metadata.get("ftth:ontNodeId") or None
        if ont_node_id and not any(node.id == ont_node_id for node in nodes):
            nodes.append(NetworkNode(
                id=str(ont_node_id), type=NodeType.ONT, name=f"ONT - {pm['name'] or 'Customer'}",
                location=PointGeometry(coordinates=point),
                properties={"geographicPositionSet": True, "source": "google_earth_kmz", "status": "unverified"},
                created_at=now_iso, updated_at=now_iso,
            ))
        try:
            customer_status = CustomerStatus(metadata.get("ftth:status", "planned"))
        except ValueError:
            customer_status = CustomerStatus.PLANNED
        customer_properties = _roundtrip_properties(pm) if metadata.get("ftth:entity") == "customer" else {
            "geographicPositionSet": True, "source": "google_earth_kmz",
        }
        customers.append(Customer(
            id=customer_id, name=pm["name"] or f"Customer {len(customers) + 1}", address=pm["description"],
            location=PointGeometry(coordinates=point), status=customer_status, ont_node_id=ont_node_id,
            properties=customer_properties,
            created_at=str(metadata.get("ftth:createdAt") or now_iso),
            updated_at=str(metadata.get("ftth:updatedAt") or now_iso),
        ))

    # 2. Process LineStrings (Cables)
    cable_counter = 0
    for pm in placemarks:
        for line_coords in pm["lineStrings"]:
            cable_counter += 1
            length_m = calculate_route_length(line_coords)
            name = pm["name"] or f"Cable {cable_counter}"
            metadata = pm["properties"]
            is_roundtrip_cable = metadata.get("ftth:entity") == "cable"
            category = _classify_cable(name, pm["description"], pm["folderPath"])
            cable_id = str(metadata.get("ftth:id") or uuid.uuid4()) if is_roundtrip_cable else str(uuid.uuid4())
            cable_properties = _roundtrip_properties(pm) if is_roundtrip_cable else {
                "source": "google_earth_kmz", "verificationStatus": "unverified",
                "routeFieldVerificationRequired": True,
                "cableCategorySource": "import_inference" if category else "unknown",
                **{key: value for key, value in metadata.items() if not key.startswith("ftth:")},
            }
            if is_roundtrip_cable:
                category = cable_properties.get("cableCategory")
            if category:
                cable_properties["cableCategory"] = category
            if is_roundtrip_cable:
                roundtrip_cable_ids.add(cable_id)
                raw_connections = _json_extended(metadata, "connections", [])
                if isinstance(raw_connections, list):
                    roundtrip_connections.extend(item for item in raw_connections if isinstance(item, dict))
            try:
                fiber_count = int(metadata["ftth:fiberCount"]) if is_roundtrip_cable and metadata.get("ftth:fiberCount") not in (None, "", "null") else None
            except (TypeError, ValueError):
                fiber_count = None

            cable = CableSegment(
                id=cable_id,
                name=name,
                cable_type=str(metadata.get("ftth:cableType") or "Unspecified fiber cable") if is_roundtrip_cable else "Unspecified fiber cable",
                fiber_count=fiber_count,
                deployment_method=str(metadata.get("ftth:deploymentMethod") or "unspecified") if is_roundtrip_cable else "unspecified",
                geometry=LineGeometry(coordinates=line_coords),
                length_m=round(length_m, 2),
                medium=str(metadata.get("ftth:medium") or "fiber") if is_roundtrip_cable else "fiber",
                connection_type=str(metadata.get("ftth:connectionType") or "optical") if is_roundtrip_cable else "optical",
                start_node_id=metadata.get("ftth:startNodeId") if is_roundtrip_cable else None,
                end_node_id=metadata.get("ftth:endNodeId") if is_roundtrip_cable else None,
                properties=cable_properties,
                created_at=str(metadata.get("ftth:createdAt") or now_iso),
                updated_at=str(metadata.get("ftth:updatedAt") or now_iso),
            )
            cables.append(cable)

    # 3. Process Polygons (Areas)
    area_counter = 0
    for pm in placemarks:
        for poly_rings in pm["polygons"]:
            rings = []
            for source_ring in poly_rings:
                ring = list(source_ring)
                if ring and ring[0] != ring[-1]:
                    ring.append(ring[0])
                if len(ring) >= 4:
                    rings.append(ring)
            if not rings:
                continue
            area_counter += 1
            area_name = pm["name"] or f"Survey Area {area_counter}"
            area_metadata = pm["properties"]
            area_id = str(area_metadata.get("ftth:id") or uuid.uuid4()) if area_metadata.get("ftth:entity") == "area" else str(uuid.uuid4())
            area = ProjectArea(
                id=area_id,
                name=area_name,
                classification=area_metadata.get("ftth:classification") or "project_boundary",
                geometry={"type": "Polygon", "coordinates": rings},
                fill_color=area_metadata.get("ftth:fillColor") or "#22c55e",
                fill_opacity=float(area_metadata.get("ftth:fillOpacity", 0.2)),
                border_color=area_metadata.get("ftth:borderColor"),
                description=pm["description"] or "",
            )
            areas.append(area)

            # Google Earth/My Maps house footprints are often polygons rather
            # than point placemarks. Keep the boundary and add a customer at
            # its centroid when its name, description, or folder identifies it
            # as a home/residential building.
            poly_type, _ = _classify_node(pm["name"], pm["description"], pm["folderPath"])
            if area_metadata.get("ftth:entity") != "area" and poly_type == NodeType.CUSTOMER:
                ring = rings[0]
                vertices = ring[:-1] if ring[0] == ring[-1] else ring
                if vertices:
                    lon = sum(point[0] for point in vertices) / len(vertices)
                    lat = sum(point[1] for point in vertices) / len(vertices)
                    customer_id = str(uuid.uuid4())
                    ont_id = str(uuid.uuid4())
                    customer_name = pm["name"] or f"Customer {len(customers) + 1}"
                    nodes.append(NetworkNode(
                        id=ont_id,
                        type=NodeType.ONT,
                        name=f"ONT - {customer_name}",
                        location=PointGeometry(coordinates=(lon, lat)),
                        properties={
                            "geographicPositionSet": True,
                            "customerId": customer_id,
                            "deploymentStatus": "planned",
                            "opticalEquipmentStatus": "configured",
                            "source": "google_earth_kmz",
                        },
                        created_at=now_iso,
                        updated_at=now_iso,
                    ))
                    customers.append(Customer(
                        id=customer_id,
                        name=customer_name,
                        address=pm["description"],
                        location=PointGeometry(coordinates=(lon, lat)),
                        status=CustomerStatus.PLANNED,
                        ont_node_id=ont_id,
                        properties={"geographicPositionSet": True, "source": "google_earth_kmz"},
                        created_at=now_iso,
                        updated_at=now_iso,
                    ))

    # 4. Auto-snapping cable endpoints to nearest nodes and creating TopologyConnections
    connections: List[TopologyConnection] = []
    # Keep auto-snapping within the same endpoint tolerance enforced by
    # validate_project_integrity; otherwise a 50–75 m snap creates a project
    # that is rejected immediately after import.
    SNAP_TOLERANCE_METERS = 50.0

    nodes_by_id = {n.id: n for n in nodes}

    for cable in cables:
        if cable.id in roundtrip_cable_ids:
            continue
        start_pt = cable.geometry.coordinates[0]
        end_pt = cable.geometry.coordinates[-1]

        # Find closest nodes to start and end
        best_start_node: Optional[NetworkNode] = None
        best_start_dist = float("inf")
        best_end_node: Optional[NetworkNode] = None
        best_end_dist = float("inf")

        optical_node_types = {NodeType.OLT, NodeType.ODC, NodeType.ODP, NodeType.ONT, NodeType.SPLITTER}
        for node in nodes:
            if node.type not in optical_node_types:
                continue
            d_start = distance_meters(start_pt, node.location.coordinates)
            d_end = distance_meters(end_pt, node.location.coordinates)

            if d_start < best_start_dist:
                best_start_dist = d_start
                best_start_node = node
            if d_end < best_end_dist:
                best_end_dist = d_end
                best_end_node = node

        if best_start_node and best_start_dist <= SNAP_TOLERANCE_METERS:
            cable.start_node_id = best_start_node.id
        if best_end_node and best_end_dist <= SNAP_TOLERANCE_METERS:
            cable.end_node_id = best_end_node.id

        # If both ends snapped to different nodes, establish a topology connection
        if cable.start_node_id and cable.end_node_id and cable.start_node_id != cable.end_node_id:
            n_start = nodes_by_id[cable.start_node_id]
            n_end = nodes_by_id[cable.end_node_id]

            # Determine hierarchical direction (OLT -> ODC -> ODP -> ONT)
            type_hierarchy = {NodeType.OLT: 1, NodeType.ODC: 2, NodeType.ODP: 3, NodeType.ONT: 4, NodeType.SPLITTER: 3}
            h_start = type_hierarchy.get(n_start.type, 99)
            h_end = type_hierarchy.get(n_end.type, 99)

            from_node = n_start if h_start <= h_end else n_end
            to_node = n_end if h_start <= h_end else n_start

            from_port = "PON-1" if from_node.type == NodeType.OLT else "OUT-01" if from_node.type in (NodeType.ODC, NodeType.ODP) else "PORT-1"
            to_port = "IN-01" if to_node.type == NodeType.ODC else "IN" if to_node.type in (NodeType.ODP, NodeType.ONT) else "PORT-2"

            conn = TopologyConnection(
                id=str(uuid.uuid4()),
                from_node_id=from_node.id,
                to_node_id=to_node.id,
                cable_segment_id=cable.id,
                medium="fiber",
                connection_type="optical",
                from_port_id=from_port,
                to_port_id=to_port,
            )
            connections.append(conn)

    # 5. Splitter attributes are configured directly on ODC and ODP nodes
    # (Integrated enclosure splitters as supported by the optical and cost engines)

    # Restore FTTH project configuration where present. Third-party KML remains
    # deliberately incomplete instead of receiving fabricated design inputs.
    raw_settings = manifest.get("settings") if isinstance(manifest, dict) else None
    try:
        settings = ProjectSettings.model_validate(raw_settings) if isinstance(raw_settings, dict) else ProjectSettings()
    except Exception:
        settings = ProjectSettings()
    pole_spans = []
    for item in manifest.get("poleSpans", []) if isinstance(manifest, dict) else []:
        try:
            pole_spans.append(PoleSpan.model_validate(item))
        except Exception:
            continue
    optical_components = []
    for item in manifest.get("opticalComponents", []) if isinstance(manifest, dict) else []:
        try:
            optical_components.append(OpticalComponent.model_validate(item))
        except Exception:
            continue
    cable_ids = {cable.id for cable in cables}
    for item in roundtrip_connections:
        try:
            connection = TopologyConnection.model_validate(item)
            if connection.cable_segment_id in roundtrip_cable_ids and connection.cable_segment_id in cable_ids:
                connections.append(connection)
        except Exception:
            continue

    return Project(
        id=proj_id,
        name=final_project_name,
        description=str(manifest.get("description") or f"Auto-imported from Google Earth KMZ ({len(nodes)} nodes, {len(cables)} cable segments, {len(customers)} customers)."),
        currency=str(manifest.get("currency") or "IDR"),
        nodes=nodes,
        customers=customers,
        cable_segments=cables,
        connections=connections,
        pole_spans=pole_spans,
        optical_components=optical_components,
        areas=areas,
        settings=settings,
        created_at=now_iso,
        updated_at=now_iso,
    )
