"""Tests for KMZ/KML import service and API endpoints."""

import io
import zipfile
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.kmz_importer import parse_kmz_or_kml_bytes
from backend.app.domain.models import NodeType
from backend.app.services.kmz_exporter import export_project_kmz

SAMPLE_KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Proyek Klaster Flamboyan</name>
    <Folder>
      <name>Perangkat Jaringan</name>
      <Placemark>
        <name>OLT STO Panakkukang</name>
        <description>GPON OLT 8 Port</description>
        <Point><coordinates>119.450000,-5.150000,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>ODC 01</name>
        <description>ODC 144 Core</description>
        <Point><coordinates>119.452000,-5.151000,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>ODP-A01</name>
        <description>ODP 8 Port Solid</description>
        <Point><coordinates>119.454000,-5.152000,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Tiang T.01</name>
        <Point><coordinates>119.453000,-5.151500,0</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Pelanggan 01</name>
        <description>Bpk. Santoso - Jl. Mawar No. 1</description>
        <Point><coordinates>119.454200,-5.152100,0</coordinates></Point>
      </Placemark>
    </Folder>
    <Folder>
      <name>Jalur Kabel</name>
      <Placemark>
        <name>Kabel Feeder OLT ke ODC</name>
        <LineString>
          <coordinates>
            119.450000,-5.150000,0
            119.451000,-5.150500,0
            119.452000,-5.151000,0
          </coordinates>
        </LineString>
      </Placemark>
      <Placemark>
        <name>Kabel Distribusi ODC ke ODP</name>
        <LineString>
          <coordinates>
            119.452000,-5.151000,0
            119.453000,-5.151500,0
            119.454000,-5.152000,0
          </coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>"""


def test_parse_kml_bytes():
    """Verify parsing uncompressed KML bytes."""
    project = parse_kmz_or_kml_bytes(SAMPLE_KML.encode("utf-8"), filename="test.kml")
    assert project.name == "Proyek Klaster Flamboyan"
    assert len(project.nodes) == 5
    node_types = {n.type for n in project.nodes}
    assert NodeType.OLT in node_types
    assert NodeType.ODC in node_types
    assert NodeType.ODP in node_types
    assert NodeType.POLE in node_types
    assert NodeType.ONT in node_types

    assert len(project.customers) == 1
    assert project.customers[0].name == "Pelanggan 01"

    assert len(project.cable_segments) == 2
    assert project.cable_segments[0].properties.get("cableCategory") == "feeder"
    assert project.cable_segments[1].properties.get("cableCategory") == "distribution"
    assert project.cable_segments[0].properties.get("verificationStatus") == "unverified"
    assert project.cable_segments[0].properties.get("routeFieldVerificationRequired") is True
    assert project.cable_segments[0].properties.get("attenuationDbPerKm") is None
    assert project.cable_segments[0].fiber_count is None
    assert project.cable_segments[0].cable_type == "Unspecified fiber cable"

    # Both cables should snap and form connections
    assert len(project.connections) >= 2


def test_parse_kmz_bytes():
    """Verify parsing zipped KMZ bytes."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("doc.kml", SAMPLE_KML)

    kmz_bytes = bio.getvalue()
    project = parse_kmz_or_kml_bytes(kmz_bytes, filename="bontomarannu.kmz")
    assert project.name == "Proyek Klaster Flamboyan"
    assert len(project.nodes) == 5
    assert len(project.cable_segments) == 2


def test_ftth_kmz_roundtrip_preserves_entity_ids_connections_and_project_configuration():
    original = parse_kmz_or_kml_bytes(SAMPLE_KML.encode())
    original.settings.construction_cost.cable_slack_percent = 17
    roundtrip = parse_kmz_or_kml_bytes(export_project_kmz(original), filename="roundtrip.kmz")

    assert {node.id for node in roundtrip.nodes} == {node.id for node in original.nodes}
    assert {customer.id for customer in roundtrip.customers} == {customer.id for customer in original.customers}
    assert {cable.id for cable in roundtrip.cable_segments} == {cable.id for cable in original.cable_segments}
    assert {connection.id for connection in roundtrip.connections} == {connection.id for connection in original.connections}
    assert roundtrip.settings.construction_cost.cable_slack_percent == 17
    assert all(cable.properties == next(item for item in original.cable_segments if item.id == cable.id).properties for cable in roundtrip.cable_segments)


def test_imports_house_named_points_and_residential_polygons_as_customers():
    kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Folder><name>Homes</name><Placemark><name>House 01</name><Point><coordinates>119.45,-5.15,0</coordinates></Point></Placemark></Folder>
      <Placemark><name>Rumah 02</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        119.46,-5.16,0 119.461,-5.16,0 119.461,-5.161,0 119.46,-5.161,0 119.46,-5.16,0
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    </Document></kml>"""
    project = parse_kmz_or_kml_bytes(kml.encode())
    assert {customer.name for customer in project.customers} == {"House 01", "Rumah 02"}
    assert len(project.areas) == 1


def test_unclassified_and_bare_number_points_stay_annotations_not_customers_or_onts():
    kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>The Eiffel Tower</name><Point><coordinates>2.2945,48.8584,0</coordinates></Point></Placemark>
      <Placemark><name>12</name><Point><coordinates>119.45,-5.15,0</coordinates></Point></Placemark>
      <Placemark><name>Tiang T.13</name><Point><coordinates>119.46,-5.16,0</coordinates></Point></Placemark>
    </Document></kml>"""
    project = parse_kmz_or_kml_bytes(kml.encode())
    assert project.customers == []
    assert {node.name for node in project.nodes if node.type == NodeType.ANNOTATION} == {"The Eiffel Tower", "12"}
    assert len(project.nodes) == 3
    assert [node.name for node in project.nodes if node.type == NodeType.POLE] == ["Tiang T.13"]


def test_customer_area_code_suffix_is_recognized_with_provenance():
    kml = b'''<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>IMELDA 2C TRJT</name><Point><coordinates>119.50,-5.13,0</coordinates></Point></Placemark>
      <Placemark><name>The Eiffel Tower</name><Point><coordinates>2.2945,48.8584,0</coordinates></Point></Placemark>
    </Document></kml>'''
    project = parse_kmz_or_kml_bytes(kml)
    assert [customer.name for customer in project.customers] == ["IMELDA 2C TRJT"]
    ont = next(node for node in project.nodes if node.type == NodeType.ONT)
    assert ont.properties["sourceClassification"] == "customer_code_suffix"
    assert next(node for node in project.nodes if node.type == NodeType.ANNOTATION).name == "The Eiffel Tower"


def test_imports_manholes_and_handholes_as_unverified_physical_infrastructure():
    kml = b'''<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Manhole MH-01</name><Point><coordinates>119.45,-5.15,0</coordinates></Point></Placemark>
      <Placemark><name>Handhole HH-02</name><Point><coordinates>119.451,-5.15,0</coordinates></Point></Placemark>
    </Document></kml>'''
    project = parse_kmz_or_kml_bytes(kml)
    physical = {node.type: node for node in project.nodes}
    assert set(physical) == {NodeType.MANHOLE, NodeType.HANDHOLE}
    assert all(node.properties["status"] == "unverified" for node in physical.values())
    assert project.connections == []


def test_cable_endpoint_beyond_validation_tolerance_is_not_auto_connected():
    kml = """<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>OLT Main</name><Point><coordinates>119.49,-5.14,0</coordinates></Point></Placemark>
      <Placemark><name>Rumah 1</name><Point><coordinates>119.491,-5.14,0</coordinates></Point></Placemark>
      <Placemark><name>JARAK</name><LineString><coordinates>119.49,-5.14,0 119.4905,-5.14,0</coordinates></LineString></Placemark>
    </Document></kml>"""
    project = parse_kmz_or_kml_bytes(kml.encode())
    cable = project.cable_segments[0]
    assert cable.start_node_id is not None
    assert cable.end_node_id is None
    assert project.connections == []


def test_api_import_kmz_endpoint(client: TestClient):
    """Verify POST /api/v1/projects/import-kmz endpoint."""
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("doc.kml", SAMPLE_KML)

    response = client.post(
        "/api/v1/projects/import-kmz",
        files={"file": ("flamboyan.kmz", bio.getvalue(), "application/vnd.google-earth.kmz")},
        data={"name": "Custom Import Name"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Custom Import Name"
    assert len(data["nodes"]) == 5
    assert len(data["customers"]) == 1

    # Cleanup created project
    proj_id = data["id"]
    del_resp = client.delete(f"/api/v1/projects/{proj_id}")
    assert del_resp.status_code == 204


def test_api_import_multiple_kmz_files_combines_projects(client: TestClient):
    response = client.post(
        "/api/v1/projects/import-kmz",
        files=[
            ("files", ("survey-a.kml", SAMPLE_KML.encode(), "application/vnd.google-earth.kml+xml")),
            ("files", ("survey-b.kml", SAMPLE_KML.encode(), "application/vnd.google-earth.kml+xml")),
        ],
        data={"name": "Combined Survey"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Combined Survey"
    assert len(data["customers"]) == 2
    assert len(data["nodes"]) == 10
    assert len(data["cableSegments"]) == 4
    assert client.delete(f"/api/v1/projects/{data['id']}").status_code == 204
