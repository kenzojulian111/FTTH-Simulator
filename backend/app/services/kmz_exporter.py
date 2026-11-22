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

    def folder(name: str):
        item = ET.SubElement(document, _tag("Folder"))
        ET.SubElement(item, _tag("name")).text = name
        return item

    def placemark(parent, name: str, description: str, geometry: str, coordinates: str):
        mark = ET.SubElement(parent, _tag("Placemark"))
        ET.SubElement(mark, _tag("name")).text = name
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
        placemark(nodes, node.name, node.type.value, "Point", f"{lon},{lat},0")
    customers = folder("Homes / Customers")
    for customer in project.customers:
        lon, lat = customer.location.coordinates
        placemark(customers, customer.name, customer.address or "Customer", "Point", f"{lon},{lat},0")
    cables = folder("Cable Routes")
    for cable in project.cable_segments:
        coords = " ".join(f"{lon},{lat},0" for lon, lat in cable.geometry.coordinates)
        if coords:
            placemark(cables, cable.name, cable.cable_type, "LineString", coords)
    areas = folder("Project Areas")
    for area in project.areas:
        rings = area.geometry.get("coordinates", [])
        coords = " ".join(f"{lon},{lat},0" for lon, lat in (rings[0] if rings else []))
        if coords:
            mark = ET.SubElement(areas, _tag("Placemark"))
            ET.SubElement(mark, _tag("name")).text = area.name
            polygon = ET.SubElement(mark, _tag("Polygon"))
            boundary = ET.SubElement(polygon, _tag("outerBoundaryIs"))
            ring = ET.SubElement(boundary, _tag("LinearRing"))
            ET.SubElement(ring, _tag("coordinates")).text = coords

    kml = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml)
    return output.getvalue()
