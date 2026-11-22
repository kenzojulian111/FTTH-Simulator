"""Tests for Google Earth KMZ project export."""
import io
import zipfile
import xml.etree.ElementTree as ET

from backend.app.domain.models import Customer, NetworkNode, NodeType, PointGeometry, Project
from backend.app.services.kmz_exporter import export_project_kmz


def test_export_project_as_kmz_includes_homes_and_network_nodes():
    project = Project(
        id="project-1",
        name="FTTH Survey",
        nodes=[
            NetworkNode(id="olt-1", type=NodeType.OLT, name="OLT Main", location=PointGeometry(coordinates=(112.1, -7.2))),
            NetworkNode(id="ont-1", type=NodeType.ONT, name="ONT Home", location=PointGeometry(coordinates=(112.2, -7.3))),
        ],
        customers=[Customer(id="home-1", name="Rumah 1", location=PointGeometry(coordinates=(112.2, -7.3)), ont_node_id="ont-1")],
    )

    with zipfile.ZipFile(io.BytesIO(export_project_kmz(project))) as archive:
        assert archive.namelist() == ["doc.kml"]
        root = ET.fromstring(archive.read("doc.kml"))

    ns = {"k": "http://www.opengis.net/kml/2.2"}
    placemarks = root.findall(".//k:Placemark", ns)
    names = [mark.findtext("k:name", namespaces=ns) for mark in placemarks]
    assert names == ["OLT Main", "ONT Home", "Rumah 1"]
    assert len(root.findall(".//k:Point/k:coordinates", ns)) == 3
