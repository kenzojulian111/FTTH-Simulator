import os
import asyncio
os.environ.setdefault("FTTH_DATABASE_URL", "sqlite://")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import httpx

from backend.app.domain.models import (
    CableSegment,
    Customer,
    CustomerStatus,
    LineGeometry,
    NetworkNode,
    NodeType,
    PointGeometry,
    Project,
    TopologyConnection,
)
from backend.app.main import app
from backend.app.persistence.database import Base, get_db
# Ensure ProjectORM is registered with Base.metadata
from backend.app.persistence.models import ProjectORM


@pytest.fixture
def db_session():
    """In-memory SQLite session with StaticPool for testing."""
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session):
    """Synchronous facade over an in-process ASGI client for endpoint tests.

    Starlette 1.8's TestClient expects httpx2. Its deprecated httpx fallback
    blocks on app startup in the current environment. Keep synchronous tests
    working through the same ASGI transport used by the async API tests.
    """
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        class SyncASGIClient:
            def _request(self, method, url, **kwargs):
                async def send_request():
                    async with app.router.lifespan_context(app):
                        async with httpx.AsyncClient(
                            transport=httpx.ASGITransport(app=app),
                            base_url="http://test",
                        ) as async_client:
                            return await getattr(async_client, method)(url, **kwargs)

                return asyncio.run(send_request())

            def get(self, url, **kwargs):
                return self._request("get", url, **kwargs)

            def post(self, url, **kwargs):
                return self._request("post", url, **kwargs)

            def put(self, url, **kwargs):
                return self._request("put", url, **kwargs)

            def delete(self, url, **kwargs):
                return self._request("delete", url, **kwargs)

        yield SyncASGIClient()
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
async def async_client(db_session):
    """In-process ASGI HTTP client using httpx.ASGITransport without portal overhead."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()


@pytest.fixture
def sample_project() -> Project:
    """Fixture providing a realistic, valid FTTH project."""
    # Nodes: 1 OLT, 1 ODC (with 1:8 splitter), 1 ODP, 1 ONT, 2 Poles
    node_olt = NetworkNode(
        id="node-olt-1",
        type=NodeType.OLT,
        name="OLT Central Office",
        location=PointGeometry(coordinates=(115.2000, -8.6500)),
        properties={"txPowerDbm": 2.5},
    )
    node_odc = NetworkNode(
        id="node-odc-1",
        type=NodeType.ODC,
        name="ODC Cabinet 01",
        location=PointGeometry(coordinates=(115.2050, -8.6550)),
        properties={"splitterRatio": "1:8"},
    )
    node_odp = NetworkNode(
        id="node-odp-1",
        type=NodeType.ODP,
        name="ODP Box 01",
        location=PointGeometry(coordinates=(115.2100, -8.6600)),
        properties={},
    )
    node_ont = NetworkNode(
        id="node-ont-1",
        type=NodeType.ONT,
        name="ONT Subscriber 01",
        location=PointGeometry(coordinates=(115.2110, -8.6605)),
        properties={"rxSensitivityDbm": -27.0, "rxOverloadDbm": -8.0},
    )
    node_pole1 = NetworkNode(
        id="node-pole-1",
        type=NodeType.POLE,
        name="Pole 01",
        location=PointGeometry(coordinates=(115.2070, -8.6570)),
    )
    node_pole2 = NetworkNode(
        id="node-pole-2",
        type=NodeType.POLE,
        name="Pole 02",
        location=PointGeometry(coordinates=(115.2080, -8.6580)),
    )

    # Customers
    cust1 = Customer(
        id="cust-1",
        name="John Doe",
        address="Jl. Merdeka No. 10",
        location=PointGeometry(coordinates=(115.2110, -8.6605)),
        status=CustomerStatus.CONNECTED,
    )
    cust2 = Customer(
        id="cust-2",
        name="Jane Smith",
        address="Jl. Merdeka No. 12",
        location=PointGeometry(coordinates=(115.2115, -8.6610)),
        status=CustomerStatus.PLANNED,
    )

    # Cables
    cable_feeder = CableSegment(
        id="cable-feeder-1",
        name="Feeder 24 Core",
        cable_type="Aerial SM G.652.D",
        fiber_count=24,
        geometry=LineGeometry(
            coordinates=[
                (115.2000, -8.6500),
                (115.2025, -8.6525),
                (115.2050, -8.6550),
            ]
        ),
    )
    cable_dist = CableSegment(
        id="cable-dist-1",
        name="Distribution 12 Core",
        cable_type="Aerial SM G.652.D",
        fiber_count=12,
        geometry=LineGeometry(
            coordinates=[
                (115.2050, -8.6550),
                (115.2100, -8.6600),
            ]
        ),
    )
    cable_drop = CableSegment(
        id="cable-drop-1",
        name="Drop 1 Core",
        cable_type="Drop Cable",
        fiber_count=1,
        geometry=LineGeometry(
            coordinates=[
                (115.2100, -8.6600),
                (115.2110, -8.6605),
            ]
        ),
    )

    # Connections
    conn_feeder = TopologyConnection(
        id="conn-1",
        from_node_id="node-olt-1",
        to_node_id="node-odc-1",
        cable_segment_id="cable-feeder-1",
    )
    conn_dist = TopologyConnection(
        id="conn-2",
        from_node_id="node-odc-1",
        to_node_id="node-odp-1",
        cable_segment_id="cable-dist-1",
    )
    conn_drop = TopologyConnection(
        id="conn-3",
        from_node_id="node-odp-1",
        to_node_id="node-ont-1",
        cable_segment_id="cable-drop-1",
    )

    return Project(
        id="proj-ftth-001",
        name="Denpasar South FTTH Rollout",
        description="Phase 1 FTTH deployment",
        currency="IDR",
        nodes=[node_olt, node_odc, node_odp, node_ont, node_pole1, node_pole2],
        customers=[cust1, cust2],
        cable_segments=[cable_feeder, cable_dist, cable_drop],
        connections=[conn_feeder, conn_dist, conn_drop],
    )
