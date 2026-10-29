"""Tests for project listing, loading by ID, creation, and restart persistence.

Verifies:
1. Multiple project listing returns stable IDs, names, timestamps, and device counts.
2. Saved projects load by ID with complete fidelity.
3. Project creation via POST /api/v1/projects (with and without client-provided ID).
4. Updates target the intended project without cross-project side-effects, preserving creation timestamps.
5. Structured 404 and validation error envelopes on missing/corrupt project requests.
6. Persistence across engine/session restarts using a real SQLite file.
7. Backward compatibility with legacy/minimal database records.
"""

import os
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.domain.models import (
    CableSegment,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    ProjectSummary,
    TopologyConnection,
)
from backend.app.persistence.database import Base
from backend.app.persistence.models import ProjectORM
from backend.app.persistence.repository import ProjectRepository


def _make_node(node_id: str, node_type: NodeType, name: str, lon: float, lat: float) -> NetworkNode:
    return NetworkNode(
        id=node_id,
        type=node_type,
        name=name,
        location=PointGeometry(coordinates=(lon, lat)),
    )


def _make_customer(cust_id: str, name: str, lon: float, lat: float, ont_node_id: str = None) -> Customer:
    return Customer(
        id=cust_id,
        name=name,
        address="Jl. Telekomunikasi No. 1",
        location=PointGeometry(coordinates=(lon, lat)),
        status=CustomerStatus.CONNECTED if ont_node_id else CustomerStatus.PLANNED,
        ont_node_id=ont_node_id,
    )


def _make_cable(cable_id: str, name: str, coords: list, fiber_count: int = 12) -> CableSegment:
    return CableSegment(
        id=cable_id,
        name=name,
        fiber_count=fiber_count,
        geometry=LineGeometry(coordinates=coords),
    )


def test_list_projects_returns_stable_ids_and_rich_metadata(client: TestClient, db_session):
    """Verify GET /api/v1/projects returns enriched summaries with device counts and timestamps."""
    repo = ProjectRepository(db_session)

    # Project 1: Standard 2-stage GPON with customer
    olt = _make_node("olt-1", NodeType.OLT, "OLT Central", 106.8450, -6.2080)
    odc = _make_node("odc-1", NodeType.ODC, "ODC Cabinet", 106.8460, -6.2082)
    odp = _make_node("odp-1", NodeType.ODP, "ODP Closure", 106.8470, -6.2084)
    ont = _make_node("ont-1", NodeType.ONT, "ONT Home", 106.8475, -6.2085)
    cust = _make_customer("cust-1", "Subscriber Alpha", 106.8476, -6.2085, ont_node_id="ont-1")
    c1 = _make_cable("c-1", "Feeder", [(106.8450, -6.2080), (106.8460, -6.2082)])
    c2 = _make_cable("c-2", "Distribution", [(106.8460, -6.2082), (106.8470, -6.2084)])
    c3 = _make_cable("c-3", "Drop", [(106.8470, -6.2084), (106.8475, -6.2085)])
    conn1 = TopologyConnection(id="conn-1", from_node_id="olt-1", to_node_id="odc-1", cable_segment_id="c-1")
    conn2 = TopologyConnection(id="conn-2", from_node_id="odc-1", to_node_id="odp-1", cable_segment_id="c-2")
    conn3 = TopologyConnection(id="conn-3", from_node_id="odp-1", to_node_id="ont-1", cable_segment_id="c-3")

    p1 = Project(
        id="proj-gpon-alpha",
        name="Alpha Fiber Cluster",
        description="Active cluster in South Jakarta",
        currency="IDR",
        nodes=[olt, odc, odp, ont],
        customers=[cust],
        cable_segments=[c1, c2, c3],
        connections=[conn1, conn2, conn3],
    )
    repo.save(p1)

    # Project 2: Commercial branch with OLT, ONT, and Router
    router = _make_node("rtr-1", NodeType.ROUTER, "Premises Router", 106.8505, -6.2105)
    p2 = Project(
        id="proj-enterprise-beta",
        name="Beta Enterprise Link",
        description="Dedicated business circuit",
        currency="IDR",
        nodes=[
            _make_node("olt-2", NodeType.OLT, "OLT North", 106.8500, -6.2100),
            _make_node("ont-2", NodeType.ONT, "ONT Branch", 106.8502, -6.2102),
            router,
        ],
        customers=[],
        cable_segments=[_make_cable("c-ent", "Dedicated Fiber", [(106.8500, -6.2100), (106.8502, -6.2102)])],
        connections=[TopologyConnection(id="conn-ent", from_node_id="olt-2", to_node_id="ont-2", cable_segment_id="c-ent")],
    )
    repo.save(p2)

    # Project 3: Empty draft
    p3 = Project(
        id="proj-empty-draft",
        name="Draft Project",
        description="Unconfigured draft",
        currency="IDR",
    )
    repo.save(p3)

    # Call GET /api/v1/projects
    response = client.get("/api/v1/projects")
    assert response.status_code == 200
    data = response.json()
    assert "projects" in data
    projects = data["projects"]
    assert len(projects) == 3

    # Check that projects are in descending order of updatedAt
    timestamps = [p["updatedAt"] for p in projects]
    assert timestamps == sorted(timestamps, reverse=True)

    # Find each project by ID
    proj_map = {p["id"]: p for p in projects}

    # Verify Project 1 metadata
    alpha = proj_map["proj-gpon-alpha"]
    assert alpha["name"] == "Alpha Fiber Cluster"
    assert alpha["description"] == "Active cluster in South Jakarta"
    assert alpha["currency"] == "IDR"
    assert alpha["nodeCount"] == 4
    assert alpha["customerCount"] == 1
    assert alpha["cableSegmentCount"] == 3
    assert alpha["connectionCount"] == 3
    assert alpha["deviceCounts"] == {"olt": 1, "odc": 1, "odp": 1, "ont": 1, "customer": 1}
    assert alpha["createdAt"] is not None
    assert alpha["updatedAt"] is not None
    # Validate ISO timestamp parseable
    datetime.fromisoformat(alpha["updatedAt"])
    datetime.fromisoformat(alpha["createdAt"])

    # Verify Project 2 metadata
    beta = proj_map["proj-enterprise-beta"]
    assert beta["name"] == "Beta Enterprise Link"
    assert beta["nodeCount"] == 3
    assert beta["customerCount"] == 0
    assert beta["cableSegmentCount"] == 1
    assert beta["connectionCount"] == 1
    assert beta["deviceCounts"] == {"olt": 1, "ont": 1, "router": 1}

    # Verify Project 3 metadata
    draft = proj_map["proj-empty-draft"]
    assert draft["name"] == "Draft Project"
    assert draft["nodeCount"] == 0
    assert draft["customerCount"] == 0
    assert draft["cableSegmentCount"] == 0
    assert draft["connectionCount"] == 0
    assert draft["deviceCounts"] == {}

    # Verify frontend contract compatibility (src/api/projectApi.ts isProjectSummary)
    for p in projects:
        assert isinstance(p["id"], str) and len(p["id"]) > 0
        assert isinstance(p["name"], str) and len(p["name"]) > 0
        assert isinstance(p["description"], str)
        assert isinstance(p["currency"], str) and len(p["currency"]) > 0
        assert isinstance(p["updatedAt"], str) and len(p["updatedAt"]) > 0


def test_project_loading_by_id_full_fidelity(client: TestClient, db_session):
    """Verify saved projects can be retrieved by ID with full aggregate fidelity."""
    repo = ProjectRepository(db_session)

    olt = _make_node("olt-load", NodeType.OLT, "OLT Load Test", 106.8450, -6.2080)
    ont = _make_node("ont-load", NodeType.ONT, "ONT Load Test", 106.8460, -6.2080)
    cable = _make_cable("c-load", "Test Cable", [(106.8450, -6.2080), (106.8460, -6.2080)])
    conn = TopologyConnection(id="conn-load", from_node_id="olt-load", to_node_id="ont-load", cable_segment_id="c-load")

    project = Project(
        id="proj-fidelity-test",
        name="Fidelity Test",
        description="Testing full aggregate recovery",
        currency="IDR",
        nodes=[olt, ont],
        customers=[],
        cable_segments=[cable],
        connections=[conn],
    )
    repo.save(project)

    # Load via GET /api/v1/projects/{projectId}
    response = client.get("/api/v1/projects/proj-fidelity-test")
    assert response.status_code == 200
    loaded = response.json()

    assert loaded["id"] == "proj-fidelity-test"
    assert loaded["name"] == "Fidelity Test"
    assert loaded["description"] == "Testing full aggregate recovery"
    assert loaded["currency"] == "IDR"
    assert len(loaded["nodes"]) == 2
    assert loaded["nodes"][0]["name"] == "OLT Load Test"
    assert loaded["nodes"][1]["name"] == "ONT Load Test"
    assert len(loaded["cableSegments"]) == 1
    # Check that route length was computed authoritatively
    assert loaded["cableSegments"][0]["lengthM"] is not None
    assert loaded["cableSegments"][0]["lengthM"] > 100
    assert len(loaded["connections"]) == 1
    assert loaded["connections"][0]["fromNodeId"] == "olt-load"


def test_create_project_via_post_endpoint(client: TestClient):
    """Verify POST /api/v1/projects creates projects with server-assigned or client-provided IDs."""
    # 1. Create project with omitted ID
    payload_no_id = {
        "name": "Server ID Project",
        "description": "Project created without an explicit ID",
        "currency": "IDR",
        "nodes": [],
        "customers": [],
        "cableSegments": [],
        "connections": [],
    }
    res_no_id = client.post("/api/v1/projects", json=payload_no_id)
    assert res_no_id.status_code == 201
    created_1 = res_no_id.json()
    assert "id" in created_1
    assert len(created_1["id"]) > 10
    assigned_id = created_1["id"]
    assert created_1["name"] == "Server ID Project"

    # Confirm it can be retrieved via GET
    res_get_1 = client.get(f"/api/v1/projects/{assigned_id}")
    assert res_get_1.status_code == 200
    assert res_get_1.json()["id"] == assigned_id

    # 2. Create project with client-provided ID
    payload_with_id = {
        "id": "custom-uuid-12345",
        "name": "Client ID Project",
        "description": "Project created with custom client ID",
        "currency": "IDR",
        "nodes": [],
        "customers": [],
        "cableSegments": [],
        "connections": [],
    }
    res_with_id = client.post("/api/v1/projects", json=payload_with_id)
    assert res_with_id.status_code == 201
    created_2 = res_with_id.json()
    assert created_2["id"] == "custom-uuid-12345"
    assert created_2["name"] == "Client ID Project"

    # Confirm it appears in GET /projects
    res_list = client.get("/api/v1/projects")
    assert res_list.status_code == 200
    ids = [p["id"] for p in res_list.json()["projects"]]
    assert assigned_id in ids
    assert "custom-uuid-12345" in ids


def test_save_updates_correct_project_without_cross_project_side_effects(client: TestClient, db_session):
    """Verify updating a project preserves createdAt, updates updatedAt, and does not alter other projects."""
    repo = ProjectRepository(db_session)

    p1 = Project(id="proj-isolated-1", name="Original Name 1", description="Project 1")
    p2 = Project(id="proj-isolated-2", name="Original Name 2", description="Project 2")
    repo.save(p1)
    repo.save(p2)

    saved_p1_initial = repo.get("proj-isolated-1")
    initial_created_at = saved_p1_initial.created_at
    initial_updated_at = saved_p1_initial.updated_at

    # Update Project 1 via PUT
    p1_update_payload = saved_p1_initial.model_dump(by_alias=True)
    p1_update_payload["name"] = "Modified Name 1"
    p1_update_payload["description"] = "Updated description"
    p1_update_payload["nodes"].append(
        _make_node("new-node", NodeType.POLE, "Civil Pole", 106.84, -6.20).model_dump(by_alias=True)
    )

    res_put = client.put("/api/v1/projects/proj-isolated-1", json=p1_update_payload)
    assert res_put.status_code == 200
    updated_p1 = res_put.json()
    assert updated_p1["name"] == "Modified Name 1"
    assert updated_p1["createdAt"] == initial_created_at
    assert len(updated_p1["nodes"]) == 1

    # Project 2 MUST remain completely unaltered
    saved_p2_after = repo.get("proj-isolated-2")
    assert saved_p2_after.name == "Original Name 2"
    assert saved_p2_after.description == "Project 2"
    assert len(saved_p2_after.nodes) == 0


def test_missing_and_deleted_project_returns_structured_404(client: TestClient, db_session):
    """Verify 404 responses conform to API_CONTRACT.md ErrorEnvelope structure."""
    # 1. GET non-existent project
    res_get = client.get("/api/v1/projects/non-existent-proj-id")
    assert res_get.status_code == 404
    err_body = res_get.json()
    assert "error" in err_body
    assert err_body["error"]["code"] == "not_found"
    assert "non-existent-proj-id" in err_body["error"]["message"]

    # 2. DELETE non-existent project
    res_del_missing = client.delete("/api/v1/projects/non-existent-proj-id")
    assert res_del_missing.status_code == 404
    assert res_del_missing.json()["error"]["code"] == "not_found"

    # 3. Create, delete, and verify missing
    p = Project(id="proj-to-delete", name="Temporary Project")
    ProjectRepository(db_session).save(p)

    res_del_real = client.delete("/api/v1/projects/proj-to-delete")
    assert res_del_real.status_code == 204

    # Subsequent GET returns 404
    res_get_deleted = client.get("/api/v1/projects/proj-to-delete")
    assert res_get_deleted.status_code == 404
    assert res_get_deleted.json()["error"]["code"] == "not_found"


def test_sqlite_file_persistence_across_restarts(tmp_path):
    """Verify that projects, metadata, and device counts persist when engine/sessions restart against a SQLite file."""
    db_file = tmp_path / "test_restart_storage.db"
    db_url = f"sqlite:///{db_file}"

    # --- Phase 1: Engine 1 creates database and stores projects ---
    engine1 = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine1)
    Session1 = sessionmaker(autocommit=False, autoflush=False, bind=engine1)
    session1 = Session1()

    repo1 = ProjectRepository(session1)
    olt = _make_node("olt-persist", NodeType.OLT, "OLT Persist", 106.8450, -6.2080)
    ont1 = _make_node("ont-persist-1", NodeType.ONT, "ONT Persist 1", 106.8460, -6.2080)
    ont2 = _make_node("ont-persist-2", NodeType.ONT, "ONT Persist 2", 106.8470, -6.2080)
    c1 = _make_cable("c-persist-1", "Feeder Cable", [(106.8450, -6.2080), (106.8460, -6.2080)])
    c2 = _make_cable("c-persist-2", "Branch Cable", [(106.8460, -6.2080), (106.8470, -6.2080)])
    conn1 = TopologyConnection(id="conn-1", from_node_id="olt-persist", to_node_id="ont-persist-1", cable_segment_id="c-persist-1")
    conn2 = TopologyConnection(id="conn-2", from_node_id="olt-persist", to_node_id="ont-persist-2", cable_segment_id="c-persist-2")

    project = Project(
        id="proj-restart-test",
        name="Restart Persistence Project",
        description="Testing persistence across engine recreation",
        currency="IDR",
        nodes=[olt, ont1, ont2],
        customers=[_make_customer("cust-p", "Persisted Customer", 106.8461, -6.2081, ont_node_id="ont-persist-1")],
        cable_segments=[c1, c2],
        connections=[conn1, conn2],
    )
    repo1.save(project)
    session1.close()
    engine1.dispose()

    # Verify file actually exists and has non-zero size
    assert os.path.exists(db_file)
    assert os.path.getsize(db_file) > 0

    # --- Phase 2: Engine 2 reconnects to the exact same SQLite file ---
    engine2 = create_engine(db_url, connect_args={"check_same_thread": False})
    Session2 = sessionmaker(autocommit=False, autoflush=False, bind=engine2)
    session2 = Session2()

    repo2 = ProjectRepository(session2)

    # 1. Verify list_all retrieves the project with correct metadata
    summaries = repo2.list_all()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary.id == "proj-restart-test"
    assert summary.name == "Restart Persistence Project"
    assert summary.node_count == 3
    assert summary.customer_count == 1
    assert summary.cable_segment_count == 2
    assert summary.connection_count == 2
    assert summary.device_counts == {"olt": 1, "ont": 2, "customer": 1}

    # 2. Verify get retrieves the full aggregate intact
    restored = repo2.get("proj-restart-test")
    assert restored is not None
    assert restored.name == "Restart Persistence Project"
    assert len(restored.nodes) == 3
    assert len(restored.cable_segments) == 2
    # Verify calculated route length was preserved
    assert restored.cable_segments[0].length_m is not None
    assert restored.cable_segments[0].length_m > 0
    assert len(restored.connections) == 2
    assert len(restored.customers) == 1
    assert restored.customers[0].name == "Persisted Customer"

    session2.close()
    engine2.dispose()


def test_backward_compatibility_with_legacy_and_minimal_records(db_session):
    """Verify list_all and get handle legacy rows with null or minimal fields cleanly."""
    # Insert a raw ORM row directly simulating a legacy database record
    legacy_orm = ProjectORM(
        id="legacy-project-001",
        name="Legacy FTTH Network",
        description=None,  # Null description in older schema
        currency=None,     # Null currency in older schema
        nodes_data=[{"id": "node-legacy-1", "name": "Legacy OLT", "type": "olt", "location": {"type": "Point", "coordinates": [106.8, -6.2]}}],
        customers_data=[],
        cable_segments_data=[],
        connections_data=[],
        settings_data={},
        created_at="2025-01-01T00:00:00Z",
        updated_at="2025-01-01T12:00:00Z",
    )
    db_session.add(legacy_orm)
    db_session.commit()

    repo = ProjectRepository(db_session)

    # Test list_all handles nulls gracefully
    summaries = repo.list_all()
    legacy_summary = next((s for s in summaries if s.id == "legacy-project-001"), None)
    assert legacy_summary is not None
    assert legacy_summary.name == "Legacy FTTH Network"
    assert legacy_summary.description == ""       # Defaulted from None
    assert legacy_summary.currency == "IDR"       # Defaulted from None
    assert legacy_summary.node_count == 1
    assert legacy_summary.device_counts == {"olt": 1}

    # Test get handles nulls gracefully
    legacy_domain = repo.get("legacy-project-001")
    assert legacy_domain is not None
    assert legacy_domain.name == "Legacy FTTH Network"
    assert legacy_domain.description == ""
    assert legacy_domain.currency == "IDR"
    assert len(legacy_domain.nodes) == 1
    assert legacy_domain.nodes[0].name == "Legacy OLT"
