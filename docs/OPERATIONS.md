# Backend deployment notes

The backend currently uses SQLite for the project aggregate. It is suitable for
local and modest single-host use, but write throughput is serialized by SQLite;
do not treat it as an unlimited multi-worker write store. Project writes are
short aggregate transactions. Python's SQLite driver already applies its bounded
default 5-second busy timeout through SQLAlchemy; this application does not add
unbounded write retries or enable WAL. The API has no project revision or conflict token,
so concurrent clients can still overwrite one another with stale full-project
payloads. Keep deployments on a reliable local filesystem and retain scheduled
backups. For a consistent live backup, use SQLite's online backup API (or stop
the application before copying the database); do not copy only the main database
file while WAL mode is active. WAL is not enabled by this application.

The public Nominatim adapter's request limiter and cache are process-local. Use
one backend worker and one application instance when calling the public service;
multiple replicas do not share the rate limit. Follow the provider policy and
use a separately approved provider or shared limiter before scaling that route.
The supported local launch command is `uvicorn backend.app.main:app --host
127.0.0.1 --port 8000 --workers 1`; production process managers must likewise
configure one worker and one replica while the public provider is selected.

Production deployments must set `FTTH_ENVIRONMENT=production` and an explicit
`CORS_ALLOWED_ORIGINS` list. CORS does not authenticate project write APIs. Keep
them on a trusted network or put them behind an authenticated access layer.

## Render Free & Single-Container Docker Notes

When deployed as a single-container Docker web service on Render Free:
- Uvicorn binds to `0.0.0.0` and the `PORT` environment variable injected by Render (`uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1`).
- FastAPI serves the compiled Vite frontend from `/app/dist`, while preserving `/health`, `/docs`, and all `/api/v1/*` routes.
- **Ephemeral SQLite Persistence Warning**: Render Free instances have an ephemeral filesystem and do not support persistent disks. SQLite database writes (`ftth_simulator.db`) only persist for the life of the current container process and **do not survive** container restarts, free-tier spin-down/spin-up cycles, instance replacements, or redeployments.

