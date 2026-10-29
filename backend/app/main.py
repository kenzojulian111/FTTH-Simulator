"""Main FastAPI application entry point for the FTTH Network Planning Simulator."""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.error_handlers import register_error_handlers
from backend.app.api.routes import router as api_v1_router
from backend.app.config import cors_policy
from backend.app.persistence.database import init_db


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
