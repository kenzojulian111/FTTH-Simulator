"""Main FastAPI application entry point for the FTTH Network Planning Simulator."""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api.error_handlers import register_error_handlers
from backend.app.api.routes import router as api_v1_router
from backend.app.config import cors_policy
from backend.app.persistence.database import init_db

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = Path(os.getenv("FTTH_FRONTEND_DIST", str(ROOT_DIR / "dist"))).resolve()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager to initialize database schemas on startup."""
    init_db()
    yield


app = FastAPI(
    title="FTTH Network Planning Simulator API",
    description="Backend engine for FTTH network design, persistence, optical budget, and CAPEX estimation.",
    version="0.1.0",
    lifespan=lifespan,
)

cors_origins, cors_credentials = cors_policy()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=cors_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register custom error handlers
register_error_handlers(app)


# Root-level health check
@app.get("/health", tags=["system"])
async def root_health():
    """Root health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}


# Mount v1 routes
app.include_router(api_v1_router)


# Mount built frontend assets if present
if (FRONTEND_DIST_DIR / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST_DIR / "assets")),
        name="frontend-assets",
    )


def _resolve_dist_file(full_path: str) -> Path | None:
    """Safely resolve a file inside FRONTEND_DIST_DIR without path traversal."""
    if not full_path or not FRONTEND_DIST_DIR.is_dir():
        return None
    candidate = (FRONTEND_DIST_DIR / full_path).resolve()
    try:
        candidate.relative_to(FRONTEND_DIST_DIR)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


@app.get("/", include_in_schema=False)
async def serve_spa_root():
    """Serve the built React SPA index.html at root."""
    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)
    return {
        "service": "FTTH Network Planning Simulator API",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_spa_fallback(full_path: str):
    """Serve static files from dist or fallback to index.html for client-side SPA routes."""
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not Found")

    static_file = _resolve_dist_file(full_path)
    if static_file is not None:
        return FileResponse(static_file)

    if full_path.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Static asset not found.")

    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(index_file)

    raise HTTPException(status_code=404, detail="Not Found")

