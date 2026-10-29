"""Integration tests for FastAPI endpoints against docs/API_CONTRACT.md."""

from fastapi.testclient import TestClient
from backend.app.domain.models import OpticalBudgetConfig, Project


def test_health_check_endpoints(client: TestClient):
    """Verify health endpoints return ok status."""
    res_root = client.get("/health")
    assert res_root.status_code == 200
    assert res_root.json()["status"] == "ok"

    res_api = client.get("/api/v1/health")
    assert res_api.status_code == 200
    assert res_api.json()["status"] == "ok"


def test_project_crud_lifecycle(client: TestClient, sample_project: Project):
    """Verify full CRUD lifecycle and camelCase JSON contracts."""
    project_id = sample_project.id
    payload = sample_project.model_dump(by_alias=True)

    # 1. Initially empty
    res_list = client.get("/api/v1/projects")
    assert res_list.status_code == 200
    assert res_list.json() == {"projects": []}

    # 2. PUT creates project
    res_save = client.put(f"/api/v1/projects/{project_id}", json=payload)
    assert res_save.status_code == 200
    saved_data = res_save.json()
    assert saved_data["id"] == project_id
    assert saved_data["name"] == sample_project.name
    # Verify calculated length in camelCase
    assert "cableSegments" in saved_data
    assert saved_data["cableSegments"][0]["lengthM"] is not None
    assert saved_data["cableSegments"][0]["lengthM"] > 0

    # 3. GET project
    res_get = client.get(f"/api/v1/projects/{project_id}")
    assert res_get.status_code == 200
    assert res_get.json()["id"] == project_id
    assert len(res_get.json()["nodes"]) == len(sample_project.nodes)

    # 4. List projects
    res_list_after = client.get("/api/v1/projects")
    assert res_list_after.status_code == 200
    summaries = res_list_after.json()["projects"]
    assert len(summaries) == 1
    assert summaries[0]["id"] == project_id
    assert summaries[0]["currency"] == "IDR"

    # 5. Calculate Optical Budget
    res_opt = client.post(f"/api/v1/projects/{project_id}/calculations/optical-budget")
    assert res_opt.status_code == 200
    opt_data = res_opt.json()
    assert opt_data["projectId"] == project_id
    assert "links" in opt_data
    assert len(opt_data["links"]) == len(sample_project.connections)
    assert all("status" in l for l in opt_data["links"])

    # 6. Calculate Construction Cost
    res_cost = client.post(f"/api/v1/projects/{project_id}/calculations/construction-cost")
    assert res_cost.status_code == 200
    cost_data = res_cost.json()
    assert cost_data["projectId"] == project_id
    assert cost_data["currency"] == "IDR"
    assert cost_data["totalAmount"] > 0
    assert len(cost_data["items"]) > 0

    # 7. DELETE project
    res_del = client.delete(f"/api/v1/projects/{project_id}")
    assert res_del.status_code == 204

    # 8. Subsequent GET returns 404 with error envelope
    res_not_found = client.get(f"/api/v1/projects/{project_id}")
    assert res_not_found.status_code == 404
    error_body = res_not_found.json()
    assert "error" in error_body
    assert error_body["error"]["code"] == "not_found"


def test_validation_error_envelope_on_bad_put(client: TestClient, sample_project: Project):
    """Verify validation errors conform to API_CONTRACT.md shape."""
    project_id = sample_project.id
    payload = sample_project.model_dump(by_alias=True)

    # Corrupt payload with self-link
    payload["connections"].append(
        {
            "id": "bad-conn",
            "fromNodeId": "node-olt-1",
            "toNodeId": "node-olt-1",  # Self-link
            "cableSegmentId": "cable-feeder-1",
        }
    )

    res = client.put(f"/api/v1/projects/{project_id}", json=payload)
    assert res.status_code == 422
    err_json = res.json()
    assert "error" in err_json
    assert err_json["error"]["code"] == "validation_error"
    assert len(err_json["error"]["details"]) > 0
    assert any("self-link" in d["message"].lower() or "connections" in d.get("field", "") for d in err_json["error"]["details"])


def test_calculations_on_missing_project(client: TestClient):
    """Verify 404 error envelope when calculating on non-existent project."""
    res_opt = client.post("/api/v1/projects/non-existent/calculations/optical-budget")
    assert res_opt.status_code == 404
    assert res_opt.json()["error"]["code"] == "not_found"

    res_cost = client.post("/api/v1/projects/non-existent/calculations/construction-cost")
    assert res_cost.status_code == 404
    assert res_cost.json()["error"]["code"] == "not_found"


import pytest
import httpx

@pytest.mark.anyio
async def test_in_process_asgi_full_flow(async_client: httpx.AsyncClient, sample_project: Project):
    """Verify in-process ASGI transport directly covering health, CRUD, validation, optical, and cost calculations."""
    # 1. Health check & CORS
    res_health = await async_client.get("/health", headers={"origin": "http://localhost:5173"})
    assert res_health.status_code == 200
    assert res_health.json() == {"status": "ok", "version": "0.1.0"}
    assert res_health.headers.get("access-control-allow-origin") == "http://localhost:5173"

    res_api_health = await async_client.get("/api/v1/health")
    assert res_api_health.status_code == 200

    # 2. List initially empty
    res_init = await async_client.get("/api/v1/projects")
    assert res_init.status_code == 200
    assert res_init.json()["projects"] == []

    # 3. Create project via PUT
    project_id = sample_project.id
    payload = sample_project.model_dump(by_alias=True)
    res_put = await async_client.put(f"/api/v1/projects/{project_id}", json=payload)
    assert res_put.status_code == 200
    saved = res_put.json()
    assert saved["id"] == project_id
    assert saved["cableSegments"][0]["lengthM"] > 0

    # 4. GET project
    res_get = await async_client.get(f"/api/v1/projects/{project_id}")
    assert res_get.status_code == 200
    assert res_get.json()["id"] == project_id

    # 5. Optical budget calculation
    res_opt = await async_client.post(f"/api/v1/projects/{project_id}/calculations/optical-budget")
    assert res_opt.status_code == 200
    opt_body = res_opt.json()
    assert opt_body["projectId"] == project_id
    assert len(opt_body["links"]) > 0
    assert len(opt_body["paths"]) > 0

    # 6. Construction cost calculation
    res_cost = await async_client.post(f"/api/v1/projects/{project_id}/calculations/construction-cost")
    assert res_cost.status_code == 200
    cost_body = res_cost.json()
    assert cost_body["totalAmount"] > 0
    assert len(cost_body["items"]) > 0

    # 7. Validation error handling
    bad_payload = dict(payload)
    bad_payload["nodes"] = [
        {"id": "bad", "type": "olt", "name": "   ", "location": {"type": "Point", "coordinates": [0, 0]}}
    ]
    res_err = await async_client.put(f"/api/v1/projects/{project_id}", json=bad_payload)
    assert res_err.status_code == 422
    assert res_err.json()["error"]["code"] == "validation_error"

    # 8. Delete project
    res_del = await async_client.delete(f"/api/v1/projects/{project_id}")
    assert res_del.status_code == 204

    # 9. Verify 404 after delete
    res_gone = await async_client.get(f"/api/v1/projects/{project_id}")
    assert res_gone.status_code == 404
    assert res_gone.json()["error"]["code"] == "not_found"


def test_unpersisted_project_calculation_returns_404_and_succeeds_after_save(client: TestClient):
    """Reproduce exact scenario: POST calculations on unpersisted UUID returns 404,
    then after PUT saving, calculation succeeds with 200.
    """
    target_uuid = "d739674a-4925-4004-a9b7-cc6c32a3ac1c"

    # 1. POST calculation before PUT must return 404 with structured error envelope
    res_cost_unpersisted = client.post(
        f"/api/v1/projects/{target_uuid}/calculations/construction-cost",
        headers={"Content-Type": "application/json"},
        content=b"",
    )
    assert res_cost_unpersisted.status_code == 404
    err_cost = res_cost_unpersisted.json()
    assert err_cost["error"]["code"] == "not_found"
    assert target_uuid in err_cost["error"]["message"]
    assert "Save the project first" in err_cost["error"]["message"]

    res_opt_unpersisted = client.post(
        f"/api/v1/projects/{target_uuid}/calculations/optical-budget",
        headers={"Content-Type": "application/json"},
        content=b"",
    )
    assert res_opt_unpersisted.status_code == 404
    err_opt = res_opt_unpersisted.json()
    assert err_opt["error"]["code"] == "not_found"
    assert target_uuid in err_opt["error"]["message"]
    assert "Save the project first" in err_opt["error"]["message"]

    # 2. Save the project with nodes, cables, splitters, and customer
    project_data = {
        "id": target_uuid,
        "name": "Persisted Project",
        "description": "Project saved before running calculations",
        "currency": "IDR",
        "nodes": [
            {
                "id": "node-olt",
                "type": "olt",
                "name": "Central OLT",
                "location": {"type": "Point", "coordinates": [106.8456, -6.2088]},
                "properties": {"logicalPosition": {"x": 50, "y": 100}},
            },
            {
                "id": "node-odc",
                "type": "odc",
                "name": "Street ODC",
                "location": {"type": "Point", "coordinates": [106.8466, -6.2088]},
                "properties": {"logicalPosition": {"x": 200, "y": 100}, "splitterRatio": "1:4"},
            },
            {
                "id": "node-odp",
                "type": "odp",
                "name": "Pole ODP",
                "location": {"type": "Point", "coordinates": [106.8476, -6.2088]},
                "properties": {"logicalPosition": {"x": 350, "y": 100}, "splitterRatio": "1:8"},
            },
            {
                "id": "node-ont",
                "type": "ont",
                "name": "Customer ONT",
                "location": {"type": "Point", "coordinates": [106.8486, -6.2088]},
                "properties": {"logicalPosition": {"x": 500, "y": 100}},
            },
        ],
        "customers": [
            {
                "id": "cust-1",
                "name": "Residential Subscriber 1",
                "address": "Jl. Merdeka No. 1",
                "location": {"type": "Point", "coordinates": [106.8487, -6.2089]},
                "status": "connected",
                "ontNodeId": "node-ont",
                "properties": {"logicalPosition": {"x": 600, "y": 100}},
            }
        ],
        "cableSegments": [
            {
                "id": "cable-1",
                "name": "Feeder Cable",
                "cableType": "Aerial-24F",
                "fiberCount": 24,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[106.8456, -6.2088], [106.8466, -6.2088]],
                },
                "properties": {"logicalWaypoints": [{"x": 125, "y": 100}]},
            },
            {
                "id": "cable-2",
                "name": "Distribution Cable",
                "cableType": "Aerial-12F",
                "fiberCount": 12,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[106.8466, -6.2088], [106.8476, -6.2088]],
                },
                "properties": {},
            },
            {
                "id": "cable-3",
                "name": "Drop Cable",
                "cableType": "Drop-2F",
                "fiberCount": 2,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[106.8476, -6.2088], [106.8486, -6.2088]],
                },
                "properties": {},
            },
        ],
        "connections": [
            {"id": "conn-1", "fromNodeId": "node-olt", "toNodeId": "node-odc", "cableSegmentId": "cable-1"},
            {"id": "conn-2", "fromNodeId": "node-odc", "toNodeId": "node-odp", "cableSegmentId": "cable-2"},
            {"id": "conn-3", "fromNodeId": "node-odp", "toNodeId": "node-ont", "cableSegmentId": "cable-3"},
        ],
        "settings": {
            "opticalBudget": {
                "txPowerDbm": 3.0,
                "fiberAttenuationDbPerKm": 0.35,
                "fiberType": "G.652.D",
                "wavelengthNm": 1310,
                "connectorLossDb": 0.5,
                "connectorsPerLink": 2,
                "spliceLossDb": 0.1,
                "splicesPerLink": 1,
                "safetyMarginDb": 3.0,
                "rxSensitivityDbm": -27.0,
                "rxOverloadDbm": -8.0,
                "minMarginDb": 0.0,
                "splitterLossTable": {"1:4": 7.2, "1:8": 10.5},
                "parameterSources": {key: "configured" for key in OpticalBudgetConfig().parameter_sources},
            },
            "constructionCost": {
                "currency": "IDR",
                "cableSlackPercent": 10.0,
                "cableUnitCostPerMeter": 5000.0,
                "cableInstallationCostPerMeter": 7500.0,
                "poleUnitCost": 850000.0,
                "poleInstallationCost": 350000.0,
                "oltUnitCost": 25000000.0,
                "oltInstallationCost": 3000000.0,
                "odcUnitCost": 4500000.0,
                "odcInstallationCost": 1200000.0,
                "odpUnitCost": 350000.0,
                "odpInstallationCost": 150000.0,
                "ontUnitCost": 250000.0,
                "ontInstallationCost": 100000.0,
                "splitterUnitCost": 120000.0,
                "splitterInstallationCost": 50000.0,
            },
        },
    }

    res_put = client.put(f"/api/v1/projects/{target_uuid}", json=project_data)
    assert res_put.status_code == 200

    # 3. Calculation now succeeds for construction cost
    res_cost_persisted = client.post(f"/api/v1/projects/{target_uuid}/calculations/construction-cost")
    assert res_cost_persisted.status_code == 200
    cost_res = res_cost_persisted.json()
    assert cost_res["projectId"] == target_uuid
    assert cost_res["totalCapex"] > 0
    assert cost_res["connectedCustomerCount"] == 1
    assert cost_res["costPerConnectedCustomer"] == cost_res["totalCapex"]

    # 4. Calculation now succeeds for optical budget with end-to-end path
    res_opt_persisted = client.post(f"/api/v1/projects/{target_uuid}/calculations/optical-budget")
    assert res_opt_persisted.status_code == 200
    opt_res = res_opt_persisted.json()
    assert opt_res["projectId"] == target_uuid
    assert len(opt_res["paths"]) == 1
    assert opt_res["paths"][0]["ontNodeId"] == "node-ont"
    assert opt_res["paths"][0]["status"] in ("pass", "fail")
    assert {item["nodeType"] for item in opt_res["intermediateNodes"]} == {"odc", "odp"}
    assert all("estimatedPowerDbm" in item and "status" in item and "lossBreakdown" in item for item in opt_res["intermediateNodes"])
    assert opt_res["paths"][0]["profileId"] is None
    assert opt_res["paths"][0]["parameterSources"]["cable-1.fiberAttenuationDbPerKm"] == "configured"
    assert opt_res["disconnectedCustomerIds"] == []

    # 5. Reloading preserves logical canvas properties and keeps geographic coordinates intact
    res_get = client.get(f"/api/v1/projects/{target_uuid}")
    assert res_get.status_code == 200
    loaded = res_get.json()
    assert loaded["nodes"][0]["location"]["coordinates"] == [106.8456, -6.2088]
    assert loaded["nodes"][0]["properties"]["logicalPosition"] == {"x": 50, "y": 100}
    assert loaded["cableSegments"][0]["geometry"]["coordinates"] == [[106.8456, -6.2088], [106.8466, -6.2088]]
    assert loaded["cableSegments"][0]["properties"]["logicalWaypoints"] == [{"x": 125, "y": 100}]
    assert loaded["customers"][0]["location"]["coordinates"] == [106.8487, -6.2089]
    assert loaded["customers"][0]["properties"]["logicalPosition"] == {"x": 600, "y": 100}
