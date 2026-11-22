"""Service for importing and converting Google Earth KMZ/KML files into FTTH Projects."""

import io
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
        polygons: List[List[Tuple[float, float]]] = []

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
                ring = next((e for e in sub.iter() if _strip_ns(e.tag) == "LinearRing"), None)
                if ring is not None:
                    coord_elem = next((e for e in ring if _strip_ns(e.tag) == "coordinates"), None)
                    if coord_elem is not None and coord_elem.text:
                        pts = _parse_coordinates(coord_elem.text)
                        if len(pts) >= 3:
                            polygons.append(pts)

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

    now_iso = current_utc_timestamp()
    proj_id = str(uuid.uuid4())

    nodes: List[NetworkNode] = []
    customers: List[Customer] = []
    cables: List[CableSegment] = []
    areas: List[ProjectArea] = []

    node_counter = {"olt": 0, "odc": 0, "odp": 0, "pole": 0, "ont": 0}

    # Helper function to classify node type from text
    def _classify_node(name: str, desc: str, folder_path: List[str]) -> Tuple[NodeType, str]:
        combined = f"{name} {desc} {' '.join(folder_path)}".lower()
        if re.search(r"\bolt\b|optical line terminal|central office|sto\b", combined):
            return NodeType.OLT, "olt"
        if re.search(r"\bodc\b|\bfdt\b|optical distribution cabinet", combined):
            return NodeType.ODC, "odc"
        if re.search(r"\bodp\b|\bfat\b|optical distribution point|closure|box odp", combined):
            return NodeType.ODP, "odp"
        if re.search(r"\bont\b|optical network terminal|modem", combined):
            return NodeType.ONT, "ont"
        if re.search(r"pelanggan|customer|subscriber|client|rumah|home|user", combined):
            return NodeType.CUSTOMER, "customer"
        if re.search(r"pole|tiang|\bpln\b|\btelkom\b|\bp\d+|\bt\d+|\bp\.\d+|\bt\.\d+", combined):
            return NodeType.POLE, "pole"
        # If name matches typical pole numbering like '1', 'T1', 'P1', 'T.01'
        if re.match(r"^[tp]?\.?\d+$", name.strip(), re.IGNORECASE):
            return NodeType.POLE, "pole"
        # Default fallback: ODP if named ODP/FAT, otherwise POLE
        return NodeType.POLE, "pole"

    # Helper to classify cable category
    def _classify_cable(name: str, desc: str, folder_path: List[str], length_m: float) -> Tuple[str, str, int]:
        combined = f"{name} {desc} {' '.join(folder_path)}".lower()
        if re.search(r"feeder|fdr|\bf-|\b12c\b|\b24c\b|\b48c\b", combined):
            return "feeder", "Feeder 12-Core G.652.D", 12
        if re.search(r"dist|distribusi|distribution|\bd-|\b8c\b|\b6c\b|\b4c\b", combined):
            return "distribution", "Distribution 8-Core G.652.D", 8
        if re.search(r"drop|\bdc\b|langganan|\b1c\b|\b2c\b", combined):
            return "drop", "Drop 1-Core G.657.A1", 1
        # Fallback by length
        if length_m > 400.0:
            return "feeder", "Feeder 12-Core G.652.D", 12
        if length_m >= 75.0:
            return "distribution", "Distribution 8-Core G.652.D", 8
        return "drop", "Drop 1-Core G.657.A1", 1

    # 1. Process Points (Nodes & Customers)
    for pm in placemarks:
        for pt in pm["points"]:
            name = pm["name"] or "Unnamed Node"
            desc = pm["description"]
            node_type, cat_key = _classify_node(name, desc, pm["folderPath"])
            node_id = str(uuid.uuid4())

            if node_type == NodeType.CUSTOMER:
                # Create both a Customer and an ONT node
                cust_idx = len(customers) + 1
                cust_name = name if name != "Unnamed Node" else f"Customer {cust_idx}"
                ont_id = str(uuid.uuid4())
                ont_name = f"ONT - {cust_name}"

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
                        "rxSensitivityDbm": -27.0,
                        "rxOverloadDbm": -8.0,
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
                    },
                    created_at=now_iso,
                    updated_at=now_iso,
                )
                customers.append(cust_obj)
                continue

            node_counter[cat_key] = node_counter.get(cat_key, 0) + 1
            display_name = name if name != "Unnamed Node" else f"{node_type.value.upper()} {node_counter[cat_key]}"

            props: Dict[str, Any] = {
                "geographicPositionSet": True,
                "source": "google_earth_kmz",
                **pm["properties"],
            }

            if node_type == NodeType.OLT:
                props.update({
                    "txPowerDbm": 2.5,
                    "ponPortCapacity": 8,
                    "activePonPortCount": 1,
                    "wavelengthNm": 1490,
                    "technology": "GPON",
                })
            elif node_type == NodeType.ODC:
                props.update({
                    "feederPortCapacity": 4,
                    "distributionPortCapacity": 16,
                    "splitterRatio": "1:8",
                    "splitterLossDb": 10.38,
                })
            elif node_type == NodeType.ODP:
                props.update({
                    "portCapacity": 8,
                    "availablePorts": 8,
                    "connectedPorts": 0,
                    "splitterRatio": "1:8",
                    "splitterLossDb": 10.38,
                })
            elif node_type == NodeType.POLE:
                props.update({
                    "status": "existing",
                    "lifecycleStatus": "existing",
                    "verificationStatus": "field_verified",
                    "fieldVerificationRequired": False,
                    "poleType": "concrete_7m",
                })

            node = NetworkNode(
                id=node_id,
                type=node_type,
                name=display_name,
                location=PointGeometry(coordinates=pt),
                properties=props,
                created_at=now_iso,
                updated_at=now_iso,
            )
            nodes.append(node)

    # 2. Process LineStrings (Cables)
    cable_counter = 0
    for pm in placemarks:
        for line_coords in pm["lineStrings"]:
            cable_counter += 1
            length_m = calculate_route_length(line_coords)
            name = pm["name"] or f"Cable {cable_counter}"
            category, cable_type, fiber_count = _classify_cable(name, pm["description"], pm["folderPath"], length_m)

            cable = CableSegment(
                id=str(uuid.uuid4()),
                name=name,
                cable_type=cable_type,
                fiber_count=fiber_count,
                deployment_method="aerial",
                geometry=LineGeometry(coordinates=line_coords),
                length_m=round(length_m, 2),
                medium="fiber",
                connection_type="optical",
                properties={
                    "cableCategory": category,
                    "routeStatus": "verified",
                    "routeVerified": True,
                    "routeFieldVerificationRequired": False,
                    "routeSource": "field_verified",
                    "routeNote": "Imported from field Google Earth KMZ survey.",
                    "verificationStatus": "field_verified",
                    "attenuationDbPerKm": 0.35,
                    "source": "google_earth_kmz",
                    **pm["properties"],
                },
                created_at=now_iso,
                updated_at=now_iso,
            )
            cables.append(cable)

    # 3. Process Polygons (Areas)
    area_counter = 0
    for pm in placemarks:
        for poly_coords in pm["polygons"]:
            ring = list(poly_coords)
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) < 4:
                continue
            area_counter += 1
            area_name = pm["name"] or f"Survey Area {area_counter}"
            area = ProjectArea(
                id=str(uuid.uuid4()),
                name=area_name,
                classification="project_boundary",
                geometry={"type": "Polygon", "coordinates": [ring]},
                fill_color="#22c55e",
                fill_opacity=0.2,
                description=pm["description"] or "",
            )
            areas.append(area)

    # 4. Auto-snapping cable endpoints to nearest nodes and creating TopologyConnections
    connections: List[TopologyConnection] = []
    SNAP_TOLERANCE_METERS = 75.0

    nodes_by_id = {n.id: n for n in nodes}

    for cable in cables:
        start_pt = cable.geometry.coordinates[0]
        end_pt = cable.geometry.coordinates[-1]

        # Find closest nodes to start and end
        best_start_node: Optional[NetworkNode] = None
        best_start_dist = float("inf")
        best_end_node: Optional[NetworkNode] = None
        best_end_dist = float("inf")

        for node in nodes:
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
            type_hierarchy = {NodeType.OLT: 1, NodeType.ODC: 2, NodeType.ODP: 3, NodeType.ONT: 4, NodeType.POLE: 5}
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

    # 6. Default Project Settings
    settings = ProjectSettings()

    return Project(
        id=proj_id,
        name=final_project_name,
        description=f"Auto-imported from Google Earth KMZ ({len(nodes)} nodes, {len(cables)} cable segments, {len(customers)} customers).",
        currency="IDR",
        nodes=nodes,
        customers=customers,
        cable_segments=cables,
        connections=connections,
        pole_spans=[],
        optical_components=[],
        areas=areas,
        settings=settings,
        created_at=now_iso,
        updated_at=now_iso,
    )
