"""Tests for KMZ/KML import service and API endpoints."""

import io
import zipfile
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.kmz_importer import parse_kmz_or_kml_bytes
from backend.app.domain.models import NodeType

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
    assert project.cable_segments[0].properties.get("routeStatus") == "verified"

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
