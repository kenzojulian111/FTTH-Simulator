mod cost;
mod db;
mod geocoding;
mod geo;
mod models;
mod optical;
mod pole;
mod routes;
mod validation;

use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::db::Database;
use crate::geocoding::GeocodingService;
use crate::routes::{create_router, AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend_rust=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Determine database path
    let redb_path = if let Ok(env_path) = std::env::var("FTTH_REDB_PATH") {
        env_path
    } else if Path::new("ftth_simulator.redb").exists() {
        "ftth_simulator.redb".to_string()
    } else if Path::new("../ftth_simulator.redb").exists() {
        "../ftth_simulator.redb".to_string()
    } else {
        "ftth_simulator.redb".to_string()
    };

    let sqlite_url = std::env::var("FTTH_DATABASE_URL").ok();

    tracing::info!("Initializing Pure-Rust Redb database at: {}", redb_path);
    let db = Database::new(&redb_path, sqlite_url.as_deref())
        .await
        .map_err(|e| format!("Failed to initialize database: {}", e))?;
    let geocoding = Arc::new(GeocodingService::new());

    let state = AppState { db, geocoding };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = create_router(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .or_else(|_| std::env::var("FTTH_PORT"))
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("FTTH Simulator Rust API server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
