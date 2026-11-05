# FTTH Network Planning Simulator

A web app for laying out FTTH networks on a map, connecting devices in a topology, and reviewing backend engineering results. The project uses React, TypeScript, Vite, Leaflet, FastAPI, and SQLite.

## Features

- Place and edit OLT, ODC, ODP, splitter, ONT, router, pole, and customer records.
- Draw and edit cable routes, including individual route vertices.
- Create explicit topology connections and validate them.
- Mark project or service areas, search for locations, and switch between map and imagery basemaps.
- Run optical budget analysis. ONT results include received power and margins; ODC/ODP results show estimated power and loss breakdowns along the path.
- Review RAB and pole-span planning reports based on backend results.
- Save and reopen projects through the API.

## Run the app

You’ll need Node.js 18 or newer and Python 3.14 for the backend.

### 1. Install dependencies

From the project root:

```bash
npm install
python3.14 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

On Windows, activate the virtual environment with `.venv\Scripts\activate`.

### 2. Start the backend

From the project root, with the virtual environment active:

```bash
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

The API is available at `http://localhost:8000`. Interactive API documentation is at `http://localhost:8000/docs`, and the health check is at `http://localhost:8000/health`.

### 3. Connect the frontend to the backend

The frontend uses an in-memory adapter by default. To save projects through the API and run calculations, create a `.env.local` file in the project root:

```dotenv
VITE_API_BASE_URL=/api/v1
```

Vite proxies `/api/v1` to the backend on port 8000. Restart the Vite server after changing the environment file.

### 4. Start the frontend

In a second terminal, from the project root:

```bash
npm run dev
```

Open the address printed by Vite, usually `http://localhost:5173`.

## In-memory mode and storage

When `VITE_API_BASE_URL` is unset, the app uses the in-memory adapter. Projects are not persisted to a database in this mode, and backend calculations are unavailable. Run and connect the backend to enable persistent storage and analysis.

The backend uses SQLite by default and creates `ftth_simulator.db` when it starts. Set `FTTH_DATABASE_URL` to change the database location.

## Engineering results

Calculation values come from the backend. Review `unknown` statuses, incomplete inputs, ambiguous paths, and fallback-sourced values before using results for design decisions. Default profile values are planning assumptions; check them against equipment specifications, field data, and project standards. These reports support planning and do not replace field engineering verification.

Coordinates use longitude, latitude order. Lengths are in metres, optical loss in dB, and optical power in dBm. Basemaps and location search require an internet connection; provider attribution is shown in the app.

## Development checks

```bash
npm test
npx tsc -b
npm run build
```

To run backend tests, activate the virtual environment and run this from the project root:

```bash
pytest -q
```

## Project layout

```text
src/       React frontend, domain model, state, and Vitest tests
backend/   FastAPI, calculation engine, persistence, and pytest tests
docs/      Project specifications, API contract, and engineering notes
```

See [docs/API_CONTRACT.md](docs/API_CONTRACT.md) for endpoint and data details, and [docs/OPERATIONS.md](docs/OPERATIONS.md) for backend operations notes.

## Single-Container Docker & Render Free Deployment

The repository includes a multi-stage [`Dockerfile`](Dockerfile) that builds the React + Vite frontend (`VITE_API_BASE_URL=/api/v1`) and serves both the SPA (`dist/`) and FastAPI backend (`backend.app.main:app`) from a single container bound to `0.0.0.0:$PORT`.

### Local Docker build & run

```bash
docker build -t ftth-simulator:latest .
docker run --rm -p 10000:10000 -e PORT=10000 ftth-simulator:latest
```

Once running:
- **Frontend SPA**: `http://localhost:10000/`
- **Health check**: `http://localhost:10000/health` and `http://localhost:10000/api/v1/health`
- **Interactive API docs**: `http://localhost:10000/docs`
- **REST API v1**: `http://localhost:10000/api/v1/...`

### Ephemeral SQLite storage on Render Free

> **Important:** Render Free web services use an **ephemeral container filesystem** and do not support persistent disks. Although SQLite (`ftth_simulator.db`) works during the lifetime of a running container instance, **any newly created or modified project data will be lost whenever the container restarts, spins down due to inactivity, is replaced, or is redeployed**. Do not rely on Render Free SQLite storage for permanent project retention.

