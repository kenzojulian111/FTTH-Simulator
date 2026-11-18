use redb::{Database as RedbDb, ReadableDatabase, ReadableTable, TableDefinition};
use sqlx::{sqlite::SqlitePoolOptions, Row};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use crate::geo::update_cable_lengths;
use crate::models::{
    current_utc_timestamp, Project, ProjectSummary,
};

const PROJECTS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("projects");

#[derive(Clone)]
pub struct Database {
    pub redb: Arc<RedbDb>,
}

impl Database {
    pub async fn new(redb_path: &str, sqlite_fallback_url: Option<&str>) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let path = Path::new(redb_path);
        let exists = path.exists();

        let db = if exists {
            tracing::info!("Opening existing Pure-Rust Redb database: {}", redb_path);
            RedbDb::open(path)?
        } else {
            tracing::info!("Creating new Pure-Rust Redb database: {}", redb_path);
            RedbDb::create(path)?
        };

        // Ensure table exists
        {
            let write_txn = db.begin_write()?;
            {
                let _ = write_txn.open_table(PROJECTS_TABLE)?;
            }
            write_txn.commit()?;
        }

        let database = Self {
            redb: Arc::new(db),
        };

        // Check if database is empty and auto-migrate from SQLite if available
        let project_count = database.count_projects()?;
        if project_count == 0 {
            tracing::info!("Redb database is empty. Checking for SQLite database to migrate data...");
            let sqlite_path = sqlite_fallback_url.unwrap_or_else(|| {
                if Path::new("ftth_simulator.db").exists() {
                    "sqlite://./ftth_simulator.db"
                } else if Path::new("../ftth_simulator.db").exists() {
                    "sqlite://../ftth_simulator.db"
                } else {
                    "sqlite://./ftth_simulator.db"
                }
            });

            if let Err(e) = database.migrate_from_sqlite(sqlite_path).await {
                tracing::warn!("SQLite auto-migration skipped or failed: {}", e);
            }
        } else {
            tracing::info!("Pure-Rust Redb database ready with {} projects.", project_count);
        }

        Ok(database)
    }

    pub fn count_projects(&self) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        let read_txn = self.redb.begin_read()?;
        let table = read_txn.open_table(PROJECTS_TABLE)?;
        let mut count = 0;
        let iter = table.iter()?;
        for _ in iter {
            count += 1;
        }
        Ok(count)
    }

    pub async fn migrate_from_sqlite(&self, sqlite_url: &str) -> Result<usize, Box<dyn std::error::Error + Send + Sync>> {
        tracing::info!("Starting auto-migration from SQLite: {}", sqlite_url);

        let pool = match SqlitePoolOptions::new().max_connections(1).connect(sqlite_url).await {
            Ok(p) => p,
            Err(e) => {
                return Err(format!("Could not connect to SQLite {}: {}", sqlite_url, e).into());
            }
        };

        let rows = sqlx::query(
            r#"
            SELECT id, name, description, currency, created_at, updated_at,
                   nodes_data, customers_data, cable_segments_data, connections_data,
                   pole_spans_data, optical_components_data, areas_data, settings_data
            FROM projects
            "#,
        )
        .fetch_all(&pool)
        .await?;

        if rows.is_empty() {
            tracing::info!("No projects found in SQLite database.");
            return Ok(0);
        }

        let mut migrated = 0;
        let write_txn = self.redb.begin_write()?;
        {
            let mut table = write_txn.open_table(PROJECTS_TABLE)?;
            for row in rows {
                let id: String = row.get("id");
                let name: String = row.get("name");
                let description: String = row.try_get("description").unwrap_or_default();
                let currency: String = row.try_get("currency").unwrap_or_else(|_| "IDR".to_string());
                let created_at: String = row.get("created_at");
                let updated_at: String = row.get("updated_at");

                let nodes_data: String = row.get("nodes_data");
                let customers_data: String = row.get("customers_data");
                let cable_segments_data: String = row.get("cable_segments_data");
                let connections_data: String = row.get("connections_data");
                let pole_spans_data: String = row.get("pole_spans_data");
                let optical_components_data: String = row.get("optical_components_data");
                let areas_data: String = row.get("areas_data");
                let settings_data: String = row.get("settings_data");

                let project = Project {
                    id: id.clone(),
                    name,
                    description,
                    currency,
                    nodes: serde_json::from_str(&nodes_data).unwrap_or_default(),
                    customers: serde_json::from_str(&customers_data).unwrap_or_default(),
                    cable_segments: serde_json::from_str(&cable_segments_data).unwrap_or_default(),
                    connections: serde_json::from_str(&connections_data).unwrap_or_default(),
                    pole_spans: serde_json::from_str(&pole_spans_data).unwrap_or_default(),
                    optical_components: serde_json::from_str(&optical_components_data).unwrap_or_default(),
                    areas: serde_json::from_str(&areas_data).unwrap_or_default(),
                    settings: serde_json::from_str(&settings_data).unwrap_or_default(),
                    created_at,
                    updated_at,
                };

                let serialized = serde_json::to_string(&project)?;
                table.insert(id.as_str(), serialized.as_str())?;
                migrated += 1;
            }
        }
        write_txn.commit()?;

        tracing::info!(
            "SUCCESS: Migrated {} projects from SQLite to Pure-Rust Redb database!",
            migrated
        );
        Ok(migrated)
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, Box<dyn std::error::Error + Send + Sync>> {
        let read_txn = self.redb.begin_read()?;
        let table = read_txn.open_table(PROJECTS_TABLE)?;

        let mut summaries = Vec::new();
        let iter = table.iter()?;
        for item in iter {
            let (_key, val) = item?;
            let project: Project = match serde_json::from_str(val.value()) {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!("Failed to parse project JSON: {}", e);
                    continue;
                }
            };

            let mut device_counts: HashMap<String, usize> = HashMap::new();
            for n in &project.nodes {
                let ntype = n.r#type.as_str().to_string();
                *device_counts.entry(ntype).or_insert(0) += 1;
            }
            if !project.customers.is_empty() {
                device_counts.insert("customer".to_string(), project.customers.len());
            }

            summaries.push(ProjectSummary {
                id: project.id,
                name: project.name,
                description: project.description,
                currency: project.currency,
                created_at: Some(project.created_at),
                updated_at: project.updated_at,
                node_count: project.nodes.len(),
                customer_count: project.customers.len(),
                cable_segment_count: project.cable_segments.len(),
                connection_count: project.connections.len(),
                device_counts,
            });
        }

        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(summaries)
    }

    pub fn get_project(&self, project_id: &str) -> Result<Option<Project>, Box<dyn std::error::Error + Send + Sync>> {
        let read_txn = self.redb.begin_read()?;
        let table = read_txn.open_table(PROJECTS_TABLE)?;

        if let Some(val) = table.get(project_id)? {
            let project: Project = serde_json::from_str(val.value())?;
            Ok(Some(project))
        } else {
            Ok(None)
        }
    }

    pub fn save_project(&self, mut project: Project) -> Result<Project, Box<dyn std::error::Error + Send + Sync>> {
        update_cable_lengths(&mut project.cable_segments);
        project.updated_at = current_utc_timestamp();

        let existing = self.get_project(&project.id)?;
        if let Some(existing_p) = existing {
            project.created_at = existing_p.created_at;
        }

        let serialized = serde_json::to_string(&project)?;

        let write_txn = self.redb.begin_write()?;
        {
            let mut table = write_txn.open_table(PROJECTS_TABLE)?;
            table.insert(project.id.as_str(), serialized.as_str())?;
        }
        write_txn.commit()?;

        Ok(project)
    }

    pub fn delete_project(&self, project_id: &str) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let write_txn = self.redb.begin_write()?;
        let deleted = {
            let mut table = write_txn.open_table(PROJECTS_TABLE)?;
            let is_some = table.remove(project_id)?.is_some();
            is_some
        };
        write_txn.commit()?;
        Ok(deleted)
    }
}
