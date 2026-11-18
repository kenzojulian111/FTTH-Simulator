use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::cost::calculate_construction_cost;
use crate::db::Database;
use crate::geocoding::GeocodingService;
use crate::models::{
    ConnectionValidationRequest, ConstructionCostConfig, ConstructionCostResult,
    OpticalBudgetConfig, OpticalBudgetResult, PoleSpanResult, Project, ProjectListResponse,
    RouterConfig, RouterValidationResponse, TopologyValidationResult,
};
use crate::optical::calculate_optical_budget;
use crate::pole::calculate_pole_spans;
use crate::validation::{
    extract_router_config, validate_connection_candidate, validate_project_topology,
    validate_router_config,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub geocoding: Arc<GeocodingService>,
}

#[derive(Debug)]
pub struct AppError(StatusCode, String);

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.0;
        let message = self.1;
        let body = Json(serde_json::json!({
            "detail": message,
            "message": message,
            "error": {
                "code": match status {
                    StatusCode::NOT_FOUND => "not_found",
                    StatusCode::UNPROCESSABLE_ENTITY => "validation_error",
                    StatusCode::BAD_REQUEST => "bad_request",
                    _ => "internal_error",
                },
                "message": message
            }
        }));
        (status, body).into_response()
    }
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        // Health
        .route("/health", get(health_check))
        .route("/api/v1/health", get(health_check))
        // Geocoding
        .route("/api/v1/geocoding/search", get(geocoding_search))
        // Projects CRUD
        .route("/api/v1/projects", get(list_projects).post(create_project))
        .route(
            "/api/v1/projects/{project_id}",
            get(get_project).put(save_project).delete(delete_project),
        )
        // Calculations
        .route(
            "/api/v1/projects/{project_id}/calculations/optical-budget",
            post(run_optical_budget),
        )
        .route(
            "/api/v1/projects/{project_id}/calculations/construction-cost",
            post(run_construction_cost),
        )
        .route(
            "/api/v1/projects/{project_id}/calculations/pole-spans",
            post(run_pole_spans),
        )
        // Validations
        .route(
            "/api/v1/projects/{project_id}/validate-topology",
            get(get_validate_topology).post(post_validate_topology),
        )
        .route(
            "/api/v1/projects/{project_id}/validate-connection",
            post(validate_connection),
        )
        .route(
            "/api/v1/validate-router-config",
            post(validate_standalone_router_config),
        )
        .route(
            "/api/v1/projects/{project_id}/nodes/{node_id}/validate-router",
            post(validate_project_node_router),
        )
        .with_state(state)
}

async fn health_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "version": "0.1.0",
        "service": "FTTH Network Planning Simulator Rust API"
    }))
}

#[derive(Deserialize)]
struct GeocodingQuery {
    q: String,
}

#[axum::debug_handler]
async fn geocoding_search(
    Query(params): Query<GeocodingQuery>,
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    match state.geocoding.search(&params.q).await {
        Ok(results) => Ok(Json(serde_json::json!({ "results": results }))),
        Err(err) => Err(AppError(StatusCode::UNPROCESSABLE_ENTITY, err)),
    }
}

async fn list_projects(State(state): State<AppState>) -> Result<Json<ProjectListResponse>, AppError> {
    let summaries = state
        .db
        .list_projects()
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ProjectListResponse {
        projects: summaries,
    }))
}

async fn create_project(
    State(state): State<AppState>,
    Json(mut project): Json<Project>,
) -> Result<(StatusCode, Json<Project>), AppError> {
    if project.id.trim().is_empty() {
        project.id = uuid::Uuid::new_v4().to_string();
    }
    let saved = state
        .db
        .save_project(project)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::CREATED, Json(saved)))
}

async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Project>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match project {
        Some(p) => Ok(Json(p)),
        None => Err(AppError(
            StatusCode::NOT_FOUND,
            format!("Project with ID '{}' was not found.", project_id),
        )),
    }
}

async fn save_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(mut project): Json<Project>,
) -> Result<Json<Project>, AppError> {
    project.id = project_id;
    let saved = state
        .db
        .save_project(project)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(saved))
}

async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, AppError> {
    let success = state
        .db
        .delete_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if success {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError(
            StatusCode::NOT_FOUND,
            format!("Project with ID '{}' was not found.", project_id),
        ))
    }
}

async fn run_optical_budget(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    payload: Option<Json<OpticalBudgetConfig>>,
) -> Result<Json<OpticalBudgetResult>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!(
                    "Project with ID '{}' was not found. Save the project first before requesting optical budget calculations.",
                    project_id
                ),
            )
        })?;

    let config_override = payload.map(|p| p.0);
    let result = calculate_optical_budget(&project, config_override.as_ref());
    Ok(Json(result))
}

async fn run_construction_cost(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    payload: Option<Json<ConstructionCostConfig>>,
) -> Result<Json<ConstructionCostResult>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!(
                    "Project with ID '{}' was not found. Save the project first before requesting construction cost calculations.",
                    project_id
                ),
            )
        })?;

    let config_override = payload.map(|p| p.0);
    let result = calculate_construction_cost(&project, config_override.as_ref());
    Ok(Json(result))
}

async fn run_pole_spans(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<PoleSpanResult>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!("Project with ID '{}' was not found.", project_id),
            )
        })?;

    let result = calculate_pole_spans(&project);
    Ok(Json(result))
}

async fn get_validate_topology(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<TopologyValidationResult>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!("Project with ID '{}' was not found.", project_id),
            )
        })?;

    let result = validate_project_topology(&project);
    Ok(Json(result))
}

async fn post_validate_topology(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    payload: Option<Json<Project>>,
) -> Result<Json<TopologyValidationResult>, AppError> {
    let project = if let Some(Json(proj)) = payload {
        proj
    } else {
        state
            .db
            .get_project(&project_id)
            .await
            .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| {
                AppError(
                    StatusCode::NOT_FOUND,
                    format!("Project with ID '{}' was not found.", project_id),
                )
            })?
    };

    let result = validate_project_topology(&project);
    Ok(Json(result))
}

async fn validate_connection(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<ConnectionValidationRequest>,
) -> Result<Json<TopologyValidationResult>, AppError> {
    let project = if let Some(ref proj) = request.project {
        proj.clone()
    } else {
        state
            .db
            .get_project(&project_id)
            .await
            .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| {
                AppError(
                    StatusCode::NOT_FOUND,
                    format!("Project with ID '{}' was not found.", project_id),
                )
            })?
    };

    let result = validate_connection_candidate(&project, &request);
    Ok(Json(result))
}

async fn validate_standalone_router_config(
    Json(config): Json<RouterConfig>,
) -> Json<RouterValidationResponse> {
    let issues = validate_router_config(&config, None, None);
    let valid = issues.is_empty();
    Json(RouterValidationResponse { valid, issues })
}

async fn validate_project_node_router(
    State(state): State<AppState>,
    Path((project_id, node_id)): Path<(String, String)>,
) -> Result<Json<RouterValidationResponse>, AppError> {
    let project = state
        .db
        .get_project(&project_id)
        .await
        .map_err(|e| AppError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!("Project with ID '{}' was not found.", project_id),
            )
        })?;

    let node = project
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| {
            AppError(
                StatusCode::NOT_FOUND,
                format!("Node with ID '{}' was not found in project '{}'.", node_id, project_id),
            )
        })?;

    let config = extract_router_config(node).unwrap_or_default();
    let issues = validate_router_config(&config, Some(&node.id), Some(&node.name));
    let valid = issues.is_empty();
    Ok(Json(RouterValidationResponse { valid, issues }))
}
