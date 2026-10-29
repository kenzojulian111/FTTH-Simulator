"""FastAPI routes implementing the FTTH Simulator API contract (v1)."""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from backend.app.domain.models import (
    ConnectionValidationRequest,
    ConstructionCostConfig,
    ConstructionCostResult,
    OpticalBudgetConfig,
    OpticalBudgetResult,
    Project,
    ProjectListResponse,
    PoleSpanResult,
    RouterConfig,
    RouterValidationResponse,
    TopologyValidationResult,
)
from backend.app.domain.validation import (
    extract_router_config,
    validate_connection_candidate,
    validate_project_topology,
    validate_router_config,
)
from backend.app.engine.cost import calculate_construction_cost
from backend.app.engine.optical import calculate_optical_budget
from backend.app.engine.pole import calculate_pole_spans
from backend.app.persistence.database import get_db
from backend.app.persistence.repository import ProjectRepository
from backend.app.services.geocoding import GeocodingError, search_places

router = APIRouter(prefix="/api/v1", tags=["projects"])


@router.get("/geocoding/search")
def geocoding_search(q: str = Query(min_length=3, max_length=200)):
    """Explicit user-triggered place lookup through the configured provider."""
    query = " ".join(q.split())
    if len(query) < 3:
        raise HTTPException(status_code=422, detail="Enter at least 3 characters to search for a place.")
    try:
        return {"results": search_places(query)}
    except GeocodingError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error


@router.get("/health", tags=["system"])
async def api_health():
    """Health check endpoint."""
    return {"status": "ok", "version": "0.1.0"}


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects(db: Session = Depends(get_db)):
    """List all projects."""
    repo = ProjectRepository(db)
    projects = repo.list_all()
    return ProjectListResponse(projects=projects)


@router.post("/projects", response_model=Project, status_code=status.HTTP_201_CREATED)
async def create_project(project: Project, db: Session = Depends(get_db)):
    """Create a new project aggregate.

    If the project ID is omitted or empty, a stable UUID is automatically assigned.
    Returns HTTP 201 Created with canonical Project aggregate.
    """
    repo = ProjectRepository(db)
    saved = repo.save(project)
    return saved


@router.get("/projects/{project_id}", response_model=Project)
async def get_project(project_id: str, db: Session = Depends(get_db)):
    """Retrieve a project aggregate by ID."""
    repo = ProjectRepository(db)
    project = repo.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found.",
        )
    return project


@router.put("/projects/{project_id}", response_model=Project)
async def save_project(project_id: str, project: Project, db: Session = Depends(get_db)):
    """Create or replace project data at the specified stable ID."""
    if project.id != project_id:
        project.id = project_id

    repo = ProjectRepository(db)
    saved = repo.save(project)
    return saved


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, db: Session = Depends(get_db)):
    """Delete a project aggregate by ID."""
    repo = ProjectRepository(db)
    success = repo.delete(project_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found.",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/projects/{project_id}/calculations/optical-budget",
    response_model=OpticalBudgetResult,
)
async def run_optical_budget(
    project_id: str,
    config: Optional[OpticalBudgetConfig] = None,
    db: Session = Depends(get_db),
):

    repo = ProjectRepository(db)
    project = repo.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found. Save the project first before requesting optical budget calculations.",
        )
    return calculate_optical_budget(project, config_override=config)


@router.post(
    "/projects/{project_id}/calculations/construction-cost",
    response_model=ConstructionCostResult,
)
async def run_construction_cost(
    project_id: str,
    config: Optional[ConstructionCostConfig] = None,
    db: Session = Depends(get_db),
):
    repo = ProjectRepository(db)
    project = repo.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found. Save the project first before requesting construction cost calculations.",
        )
    return calculate_construction_cost(project, config_override=config)


@router.post("/projects/{project_id}/calculations/pole-spans", response_model=PoleSpanResult)
async def run_pole_span_plan(project_id: str, db: Session = Depends(get_db)):
    """Calculate explicit pole spans and only configured, fully covered estimates."""
    project = ProjectRepository(db).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project with ID '{project_id}' was not found.")
    return calculate_pole_spans(project)


@router.post(
    "/projects/{project_id}/validate-connection",
    response_model=TopologyValidationResult,
)
async def validate_connection(
    project_id: str,
    request: ConnectionValidationRequest,
    db: Session = Depends(get_db),
):
    """Validate a proposed connection against GPON topology rules before creation."""
    project = request.project
    if not project:
        repo = ProjectRepository(db)
        project = repo.get(project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project with ID '{project_id}' was not found. Save the project first or provide project data in request.",
            )
    return validate_connection_candidate(project, request)


@router.get(
    "/projects/{project_id}/validate-topology",
    response_model=TopologyValidationResult,
)
async def get_validate_topology(
    project_id: str,
    db: Session = Depends(get_db),
):
    """Validate all topology connections and structural rules for a saved project."""
    repo = ProjectRepository(db)
    project = repo.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found.",
        )
    return validate_project_topology(project)


@router.post(
    "/projects/{project_id}/validate-topology",
    response_model=TopologyValidationResult,
)
async def post_validate_topology(
    project_id: str,
    project: Optional[Project] = None,
    db: Session = Depends(get_db),
):
    """Validate all topology connections and structural rules for a project (persisted or inline draft)."""
    if not project:
        repo = ProjectRepository(db)
        project = repo.get(project_id)
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project with ID '{project_id}' was not found. Save the project first or provide project data in request body.",
            )
    return validate_project_topology(project)


@router.post(
    "/validate-router-config",
    response_model=RouterValidationResponse,
    tags=["validation"],
)
async def validate_standalone_router_config(config: RouterConfig):
    """Validate router IP configuration independently."""
    issues = validate_router_config(config)
    return RouterValidationResponse(valid=len(issues) == 0, issues=issues)


@router.post(
    "/projects/{project_id}/nodes/{node_id}/validate-router",
    response_model=RouterValidationResponse,
    tags=["validation"],
)
async def validate_project_node_router_config(
    project_id: str,
    node_id: str,
    db: Session = Depends(get_db),
):
    """Validate the router configuration of a specific node within a saved project."""
    repo = ProjectRepository(db)
    project = repo.get(project_id)
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID '{project_id}' was not found.",
        )
    node = next((n for n in project.nodes if n.id == node_id), None)
    if not node:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Node with ID '{node_id}' was not found in project '{project_id}'.",
        )
    config = extract_router_config(node) or RouterConfig()
    issues = validate_router_config(config, node_id=node.id, node_name=node.name)
    return RouterValidationResponse(valid=len(issues) == 0, issues=issues)

