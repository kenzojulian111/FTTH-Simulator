"""Export an FTTH project as a Google Earth compatible KMZ archive."""
import io
import zipfile
import xml.etree.ElementTree as ET

from backend.app.domain.models import Project

KML = "http://www.opengis.net/kml/2.2"
ET.register_namespace("", KML)


def _tag(name: str) -> str:
    return f"{{{KML}}}{name}"


def export_project_kmz(project: Project) -> bytes:
    root = ET.Element(_tag("kml"))
    document = ET.SubElement(root, _tag("Document"))
    ET.SubElement(document, _tag("name")).text = project.name

    # Keep dense deployments legible in Google Earth. Names remain available
    # in the folder list and placemark detail card when selected.
    styles = {
        "customer": ("ffffcc00", "0.62"),
        "olt": ("ff3333ff", "0.9"),
        "odc": ("ff00a5ff", "0.82"),
        "odp": ("ff00cc66", "0.72"),
        "pole": ("ff00ffff", "0.48"),
        "ont": ("ffff66cc", "0.56"),
        "other": ("ffffffff", "0.68"),
        "cable": ("ffff9900", "0.85"),
    }
    for style_id, (color, scale) in styles.items():
        style = ET.SubElement(document, _tag("Style"), {"id": style_id})
        icon_style = ET.SubElement(style, _tag("IconStyle"))
        ET.SubElement(icon_style, _tag("color")).text = color
        ET.SubElement(icon_style, _tag("scale")).text = scale
        label_style = ET.SubElement(style, _tag("LabelStyle"))
        ET.SubElement(label_style, _tag("scale")).text = "0"
        if style_id == "cable":
            line_style = ET.SubElement(style, _tag("LineStyle"))
            ET.SubElement(line_style, _tag("color")).text = color
            ET.SubElement(line_style, _tag("width")).text = "3"

    def folder(name: str):
        item = ET.SubElement(document, _tag("Folder"))
        ET.SubElement(item, _tag("name")).text = name
        return item

    def placemark(parent, name: str, description: str, geometry: str, coordinates: str, style_id: str):
        mark = ET.SubElement(parent, _tag("Placemark"))
        ET.SubElement(mark, _tag("name")).text = name
        ET.SubElement(mark, _tag("styleUrl")).text = f"#{style_id}"
        if description:
            ET.SubElement(mark, _tag("description")).text = description
        shape = ET.SubElement(mark, _tag(geometry))
        ET.SubElement(shape, _tag("coordinates")).text = coordinates

    nodes = folder("Network Nodes")
    customer_ont_ids = {customer.ont_node_id for customer in project.customers if customer.ont_node_id}
    for node in project.nodes:
        if node.id in customer_ont_ids:
            continue
        lon, lat = node.location.coordinates
        style_id = node.type.value if node.type.value in styles else "other"
        placemark(nodes, node.name, node.type.value, "Point", f"{lon},{lat},0", style_id)
    customers = folder("Homes / Customers")
    for customer in project.customers:
        lon, lat = customer.location.coordinates
        placemark(customers, customer.name, customer.address or "Customer", "Point", f"{lon},{lat},0", "customer")
    cables = folder("Cable Routes")
    for cable in project.cable_segments:
        coords = " ".join(f"{lon},{lat},0" for lon, lat in cable.geometry.coordinates)
        if coords:
            placemark(cables, cable.name, cable.cable_type, "LineString", coords, "cable")
    areas = folder("Project Areas")
    for area in project.areas:
        rings = area.geometry.get("coordinates", [])
        coords = " ".join(f"{lon},{lat},0" for lon, lat in (rings[0] if rings else []))
        if coords:
            mark = ET.SubElement(areas, _tag("Placemark"))
            ET.SubElement(mark, _tag("name")).text = area.name
            ET.SubElement(mark, _tag("styleUrl")).text = "#other"
            polygon = ET.SubElement(mark, _tag("Polygon"))
            boundary = ET.SubElement(polygon, _tag("outerBoundaryIs"))
            ring = ET.SubElement(boundary, _tag("LinearRing"))
            ET.SubElement(ring, _tag("coordinates")).text = coords

    kml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml)
    return output.getvalue()
