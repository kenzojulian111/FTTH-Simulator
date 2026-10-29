"""Unit tests for SQLite persistence and ProjectRepository."""

import pytest

from backend.app.domain.models import Project
from backend.app.persistence.repository import ProjectRepository


def test_init_db_adds_optical_and_pole_columns_to_legacy_sqlite_table():
    from sqlalchemy import create_engine, inspect, text
    from backend.app.persistence.database import init_db

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE projects (
                id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, description VARCHAR,
                currency VARCHAR, nodes_data JSON NOT NULL, customers_data JSON NOT NULL,
                cable_segments_data JSON NOT NULL, connections_data JSON NOT NULL,
                settings_data JSON NOT NULL, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL
            )
        """))
        connection.execute(text("""
            INSERT INTO projects (id, name, nodes_data, customers_data, cable_segments_data,
                                  connections_data, settings_data, created_at, updated_at)
            VALUES ('legacy', 'Legacy', '[]', '[]', '[]', '[]', '{}', 'now', 'now')
        """))
    init_db(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("projects")}
    assert {"pole_spans_data", "optical_components_data"} <= columns
    with engine.connect() as connection:
        defaults = connection.execute(text("SELECT pole_spans_data, optical_components_data FROM projects WHERE id='legacy'")).fetchone()
        assert defaults == ("[]", "[]")
    engine.dispose()


def test_project_save_and_retrieve(db_session, sample_project: Project):
    """Verify full project aggregate is persisted and retrieved intact."""
    repo = ProjectRepository(db_session)
    saved = repo.save(sample_project)

    # Check cable length was computed
    assert saved.cable_segments[0].length_m is not None
    assert saved.cable_segments[0].length_m > 0

    retrieved = repo.get(sample_project.id)
    assert retrieved is not None
    assert retrieved.id == sample_project.id
    assert retrieved.name == sample_project.name
    assert len(retrieved.nodes) == len(sample_project.nodes)
    assert len(retrieved.customers) == len(sample_project.customers)
    assert len(retrieved.cable_segments) == len(sample_project.cable_segments)
    assert len(retrieved.connections) == len(sample_project.connections)


def test_project_list(db_session, sample_project: Project):
    """Verify list_all returns project summaries."""
    repo = ProjectRepository(db_session)
    repo.save(sample_project)

    summaries = repo.list_all()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary.id == sample_project.id
    assert summary.name == sample_project.name
    assert summary.currency == "IDR"
    assert summary.updated_at is not None


def test_project_update(db_session, sample_project: Project):
    """Verify updating a project updates its fields and timestamp."""
    repo = ProjectRepository(db_session)
    saved = repo.save(sample_project)
    old_time = saved.updated_at

    sample_project.name = "Updated Project Name"
    updated = repo.save(sample_project)

    assert updated.name == "Updated Project Name"
    retrieved = repo.get(sample_project.id)
    assert retrieved.name == "Updated Project Name"


def test_project_delete(db_session, sample_project: Project):
    """Verify deleting a project removes it from storage."""
    repo = ProjectRepository(db_session)
    repo.save(sample_project)

    assert repo.delete(sample_project.id) is True
    assert repo.get(sample_project.id) is None
    assert repo.delete(sample_project.id) is False


def test_project_persistence_with_all_node_types_and_logical_properties(db_session):
    """Verify that all 7 node types and logical canvas presentation properties round-trip through SQLite."""
    from backend.app.domain.models import (
        Customer,
        CustomerStatus,
        LineGeometry,
        NetworkNode,
        NodeType,
        PointGeometry,
        Project,
        TopologyConnection,
        CableSegment,
    )

    project = Project(
        id="proj-all-types-logical",
        name="All Node Types with Logical Layout",
        description="Testing Cisco-style logical canvas presentation attributes",
        currency="IDR",
        nodes=[
            NetworkNode(
                id="n-olt",
                type=NodeType.OLT,
                name="OLT Central",
                location=PointGeometry(coordinates=(106.8450, -6.2080)),
                properties={"logicalPosition": {"x": 100, "y": 150}, "rackId": "RACK-01"},
            ),
            NetworkNode(
                id="n-odc",
                type=NodeType.ODC,
                name="ODC Main",
                location=PointGeometry(coordinates=(106.8460, -6.2082)),
                properties={"logicalPosition": {"x": 250, "y": 150}},
            ),
            NetworkNode(
                id="n-pole",
                type=NodeType.POLE,
                name="Pole P-01",
                location=PointGeometry(coordinates=(106.8470, -6.2084)),
                properties={"logicalPosition": {"x": 400, "y": 150}},
            ),
            NetworkNode(
                id="n-splitter",
                type=NodeType.SPLITTER,
                name="Splitter 1:8",
                location=PointGeometry(coordinates=(106.8475, -6.2085)),
                properties={"logicalPosition": {"x": 500, "y": 150}, "splitterRatio": "1:8"},
            ),
            NetworkNode(
                id="n-odp",
                type=NodeType.ODP,
                name="ODP Closure",
                location=PointGeometry(coordinates=(106.8480, -6.2086)),
                properties={"logicalPosition": {"x": 600, "y": 150}},
            ),
            NetworkNode(
                id="n-ont",
                type=NodeType.ONT,
                name="ONT Premise",
                location=PointGeometry(coordinates=(106.8490, -6.2088)),
                properties={"logicalPosition": {"x": 750, "y": 150}},
            ),
            NetworkNode(
                id="n-cust-node",
                type=NodeType.CUSTOMER,
                name="House Node",
                location=PointGeometry(coordinates=(106.8495, -6.2090)),
                properties={"logicalPosition": {"x": 900, "y": 150}},
            ),
        ],
        customers=[
            Customer(
                id="cust-res-1",
                name="Budi Santoso",
                address="Jl. Melati No. 5",
                location=PointGeometry(coordinates=(106.8491, -6.2089)),
                status=CustomerStatus.CONNECTED,
                ont_node_id="n-ont",
                properties={"logicalPosition": {"x": 750, "y": 250}},
            )
        ],
        cable_segments=[
            CableSegment(
                id="c-feeder",
                name="Feeder Cable",
                cable_type="Aerial-24F",
                fiber_count=24,
                geometry=LineGeometry(coordinates=[(106.8450, -6.2080), (106.8460, -6.2082)]),
                properties={"logicalWaypoints": [{"x": 175, "y": 150}]},
            )
        ],
        connections=[
            TopologyConnection(
                id="conn-feeder",
                from_node_id="n-olt",
                to_node_id="n-odc",
                cable_segment_id="c-feeder",
            )
        ],
    )

    repo = ProjectRepository(db_session)
    repo.save(project)

    retrieved = repo.get("proj-all-types-logical")
    assert retrieved is not None
    assert len(retrieved.nodes) == 7
    node_types = {n.type for n in retrieved.nodes}
    assert node_types == {
        NodeType.OLT,
        NodeType.ODC,
        NodeType.POLE,
        NodeType.SPLITTER,
        NodeType.ODP,
        NodeType.ONT,
        NodeType.CUSTOMER,
    }

    # Verify presentation properties persisted intact
    olt_node = next(n for n in retrieved.nodes if n.id == "n-olt")
    assert olt_node.properties["logicalPosition"] == {"x": 100, "y": 150}
    assert olt_node.properties["rackId"] == "RACK-01"

    cable = retrieved.cable_segments[0]
    assert cable.properties["logicalWaypoints"] == [{"x": 175, "y": 150}]

    cust = retrieved.customers[0]
    assert cust.properties["logicalPosition"] == {"x": 750, "y": 250}
    assert cust.ont_node_id == "n-ont"


def test_existing_project_area_add_modify_delete_and_save_load_save(db_session):
    from backend.app.domain.models import ProjectArea

    repository = ProjectRepository(db_session)
    project = Project(id="area-updates", name="Area update project")
    repository.save(project)

    loaded = repository.get(project.id)
    assert loaded is not None
    assert loaded.areas == []  # Old projects without area data remain loadable.
    loaded.areas.append(ProjectArea(
        id="area-1", name="Service area", geometry={"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        classification="service_area", fill_color="#22c55e", fill_opacity=0.2,
    ))
    repository.save(loaded)

    loaded = repository.get(project.id)
    assert loaded is not None
    assert len(loaded.areas) == 1
    assert loaded.areas[0].name == "Service area"

    loaded.areas[0].name = "Updated boundary"
    loaded.areas[0].geometry = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 0]]]}
    repository.save(loaded)
    loaded = repository.get(project.id)
    assert loaded is not None
    assert loaded.areas[0].name == "Updated boundary"
    assert loaded.areas[0].geometry["coordinates"][0][1] == [2.0, 0.0]

    loaded.areas.clear()
    repository.save(loaded)
    reloaded = repository.get(project.id)
    assert reloaded is not None
    assert reloaded.areas == []
    repository.save(reloaded)
    assert repository.get(project.id).areas == []


@pytest.mark.parametrize(
    ("coordinates", "message"),
    [
        ([[0, 0], [1, 0], [1, 0], [0, 0]], "duplicate adjacent"),
        ([[0, 0], [1, 1], [2, 2], [0, 0]], "non-zero area"),
        ([[0, 0], [3, 3], [0, 2], [2, 0], [0, 0]], "self-intersect"),
    ],
)
def test_project_area_rejects_duplicate_degenerate_and_self_intersecting_rings(coordinates, message):
    from pydantic import ValidationError
    from backend.app.domain.models import ProjectArea

    with pytest.raises(ValidationError, match=message):
        ProjectArea(id="invalid", name="Invalid", geometry={"type": "Polygon", "coordinates": [coordinates]})
