# Frontend / Backend Integration Audit

Date: 2026-10-17

## Repository state

- The workspace's `.git` directory is empty, so `git status` cannot report tracked or untracked changes (`fatal: not a git repository`). Existing frontend files and Gemini's backend files were inspected in place and preserved except for the focused optical/cost integration fixes documented below.
- Node `v26.11.1`, npm `12.2.0`, and Python `3.14.7` are available. `.venv/bin/pip install --no-index -r backend/requirements.txt` succeeded with all requirements already installed; `.venv/bin/pip check` reports no broken requirements.
- No `package-lock.json` or `node_modules` directory exists. A bounded `npm install --no-audit --no-fund` attempt timed out without installing dependencies.

## Contract alignment

- FastAPI uses `/api/v1`, camelCase JSON aliases, `{ projects: [...] }` list responses, `PUT /projects/{id}` upsert, `GET`, `DELETE`, and the two `POST` calculation paths. The frontend adapter uses those paths and unwraps project lists.
- Project settings round-trip in the frontend model. Node types include ONT and splitter. Customers can optionally refer to an ONT with `ontNodeId`. Cable start/end node IDs and server `lengthM` are represented in frontend types.
- The frontend parses backend error envelopes and validation details. `VITE_API_BASE_URL=http://localhost:8000/api/v1` is the configured base form. FastAPI CORS returned `Access-Control-Allow-Origin: http://localhost:5173` in an in-process ASGI request.
- The optical UI renders backend `paths` and margins, not edge-only results. Cost UI shows CAPEX, cost per connected customer, and item quantities/rates. The UI labels rates as configured estimates, not market-verified prices.

## Engineering audit and focused changes

- Gemini's original optical engine produced only per-connection edge results; it did not trace an accumulated OLT-to-ONT path. Added an additive `paths` field and preserved `links` as edge diagnostics. Each unique directed OLT-to-ONT path accumulates segment fiber, connector, and splice losses; counts each traversed splitter once; and applies the safety margin once. Missing or ambiguous routes return `unknown` with null measurements. Connected customers without a complete associated path are listed in `disconnectedCustomerIds`.
- Added optional customer-to-ONT association validation and tests. Existing payloads remain valid because the field is optional.
- CAPEX quantities and rates were already calculated from cable route length plus configured slack, node inventory, and configurable material/installation rates. Fixed the semantic issue where cost per connected customer fell back to ONT count when there were zero connected customers; it now remains null. Added assertions for supply and installation quantities and total CAPEX.
- Default unit prices are assumptions and are not market-verified.

## Checks actually run

- `python -m pytest -q --ignore=backend/tests/test_api_routes.py -k 'not test_api_empty_body_put_validation_error'` using `.venv`: **35 passed, 1 deselected**. This runs all tests that do not depend on Starlette `TestClient`.
- Focused optical/cost tests: **11 passed**.
- Full pytest collection: **40 tests collected**. Full execution does not complete: it times out at `backend/tests/test_api_routes.py::test_health_check_endpoints` before the first assertion. A minimal FastAPI sync endpoint also hangs through the installed AnyIO 4.15.1 worker threadpool on Python 3.14.7. Starlette additionally warns that its installed `TestClient` integration with `httpx` is deprecated.
- An in-process ASGI request check, with sync-to-thread dispatch bypassed to work around that environment issue and a temporary SQLite DB under `/tmp`, passed health, CORS preflight/origin handling, project list/save/load, node and cable geometry edits, optical/cost calculation requests, validation-error envelope, and delete/not-found. The modified cable was returned with a recalculated `lengthM` of `991.02 m`; the OLT-to-ONT calculation returned one path, `25.12 dB` loss, and `4.38 dB` margin. Cost returned 14 items and `79,997,625 IDR` for the configured sample assumptions. This is an in-process ASGI check, not a listening-server test.
- Uvicorn could not bind locally: socket binding returned `PermissionError: [Errno 1] Operation not permitted`. A live browser-to-server test was therefore not possible in this sandbox.
- Frontend tests and build were attempted. `npm test` fails because `vitest` is not installed; `npm run build` fails because `tsc` is not installed. There is no lockfile to use with `npm ci`, and package installation did not complete. No frontend runtime claim is made.

## Local startup commands

In an environment with package registry access and local TCP binding:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
FTTH_DATABASE_URL=sqlite:///./ftth_simulator.db uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

In another terminal:

```bash
npm install
VITE_API_BASE_URL=http://localhost:8000/api/v1 npm run dev -- --host 127.0.0.1
```

The backend docs are available at `http://localhost:8000/docs`; the health endpoints are `/health` and `/api/v1/health`.
