"""Export project geometry plus FTTH ExtendedData in a Google Earth KMZ."""

import io
import json
import zipfile
import xml.etree.ElementTree as ET

from backend.app.domain.models import Project

KML = "http://www.opengis.net/kml/2.2"
ET.register_namespace("", KML)


def _tag(name: str) -> str:
    return f"{{{KML}}}{name}"


def _extended_data(parent: ET.Element, values: dict) -> None:
    data = ET.SubElement(parent, _tag("ExtendedData"))
    for name, value in values.items():
        if value is None:
            continue
        item = ET.SubElement(data, _tag("Data"), {"name": f"ftth:{name}"})
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        ET.SubElement(item, _tag("value")).text = text


def export_project_kmz(project: Project) -> bytes:
    root = ET.Element(_tag("kml"))
    document = ET.SubElement(root, _tag("Document"))
    ET.SubElement(document, _tag("name")).text = project.name
    _extended_data(document, {
        "manifest": {
            "description": project.description,
            "currency": project.currency,
            "settings": project.settings.model_dump(mode="json", by_alias=True),
            "poleSpans": [item.model_dump(mode="json", by_alias=True) for item in project.pole_spans],
            "opticalComponents": [item.model_dump(mode="json", by_alias=True) for item in project.optical_components],
        }
    })

    styles = {
        "customer": ("ffffcc00", "0.62"), "olt": ("ff3333ff", "0.9"),
        "odc": ("ff00a5ff", "0.82"), "odp": ("ff00cc66", "0.72"),
        "pole": ("ff00ffff", "0.48"), "manhole": ("ff8899aa", "0.58"),
        "handhole": ("ffb87936", "0.58"), "ont": ("ffff66cc", "0.56"),
        "splitter": ("ffccaa44", "0.62"), "router": ("ff8844cc", "0.62"),
        "other": ("ffffffff", "0.68"), "cable": ("ffff9900", "0.85"),
        "area": ("6622cc66", "0.68"),
    }
    for style_id, (color, scale) in styles.items():
        style = ET.SubElement(document, _tag("Style"), {"id": style_id})
        icon_style = ET.SubElement(style, _tag("IconStyle"))
        ET.SubElement(icon_style, _tag("color")).text = color
        ET.SubElement(icon_style, _tag("scale")).text = scale
        label_style = ET.SubElement(style, _tag("LabelStyle"))
        ET.SubElement(label_style, _tag("scale")).text = "0"
        if style_id in {"cable", "area"}:
            line_style = ET.SubElement(style, _tag("LineStyle"))
            ET.SubElement(line_style, _tag("color")).text = color
            ET.SubElement(line_style, _tag("width")).text = "3"

    def folder(name: str):
        item = ET.SubElement(document, _tag("Folder"))
        ET.SubElement(item, _tag("name")).text = name
        return item

    def placemark(parent, name: str, description: str, style_id: str, metadata: dict):
        mark = ET.SubElement(parent, _tag("Placemark"))
        ET.SubElement(mark, _tag("name")).text = name
        ET.SubElement(mark, _tag("styleUrl")).text = f"#{style_id}"
        if description:
            ET.SubElement(mark, _tag("description")).text = description
        _extended_data(mark, metadata)
        return mark

    node_folder = folder("Network Nodes")
    for node in project.nodes:
        lon, lat = node.location.coordinates
        mark = placemark(node_folder, node.name, node.type.value, node.type.value if node.type.value in styles else "other", {
            "entity": "node", "id": node.id, "nodeType": node.type.value,
            "properties": node.properties, "createdAt": node.created_at, "updatedAt": node.updated_at,
        })
        point = ET.SubElement(mark, _tag("Point"))
        ET.SubElement(point, _tag("coordinates")).text = f"{lon},{lat},0"

    customer_folder = folder("Homes / Customers")
    for customer in project.customers:
        lon, lat = customer.location.coordinates
        mark = placemark(customer_folder, customer.name, customer.address or "Customer", "customer", {
            "entity": "customer", "id": customer.id, "ontNodeId": customer.ont_node_id,
            "status": customer.status.value, "properties": customer.properties,
            "createdAt": customer.created_at, "updatedAt": customer.updated_at,
        })
        point = ET.SubElement(mark, _tag("Point"))
        ET.SubElement(point, _tag("coordinates")).text = f"{lon},{lat},0"

    connection_map: dict[str, list] = {}
    for connection in project.connections:
        connection_map.setdefault(connection.cable_segment_id, []).append(connection.model_dump(mode="json", by_alias=True))
    cable_folder = folder("Cable Routes")
    for cable in project.cable_segments:
        coords = " ".join(f"{lon},{lat},0" for lon, lat in cable.geometry.coordinates)
        if not coords:
            continue
        mark = placemark(cable_folder, cable.name, cable.cable_type, "cable", {
            "entity": "cable", "id": cable.id, "cableType": cable.cable_type,
            "fiberCount": cable.fiber_count, "deploymentMethod": cable.deployment_method,
            "lengthM": cable.length_m, "startNodeId": cable.start_node_id, "endNodeId": cable.end_node_id,
            "medium": cable.medium, "connectionType": cable.connection_type,
            "properties": cable.properties, "connections": connection_map.get(cable.id, []),
            "createdAt": cable.created_at, "updatedAt": cable.updated_at,
        })
        line = ET.SubElement(mark, _tag("LineString"))
        ET.SubElement(line, _tag("coordinates")).text = coords

    area_folder = folder("Project Areas")
    for area in project.areas:
        rings = area.geometry.get("coordinates", [])
        if not rings:
            continue
        mark = placemark(area_folder, area.name, area.description or "", "area", {
            "entity": "area", "id": area.id, "classification": area.classification,
            "fillColor": area.fill_color, "fillOpacity": area.fill_opacity,
            "borderColor": area.border_color,
        })
        polygon = ET.SubElement(mark, _tag("Polygon"))
        outer = ET.SubElement(ET.SubElement(polygon, _tag("outerBoundaryIs")), _tag("LinearRing"))
        ET.SubElement(outer, _tag("coordinates")).text = " ".join(f"{lon},{lat},0" for lon, lat in rings[0])
        for ring_coords in rings[1:]:
            inner = ET.SubElement(ET.SubElement(polygon, _tag("innerBoundaryIs")), _tag("LinearRing"))
            ET.SubElement(inner, _tag("coordinates")).text = " ".join(f"{lon},{lat},0" for lon, lat in ring_coords)

    kml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml)
    return output.getvalue()
