use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

use crate::geo::update_cable_lengths;
use crate::models::{
    current_utc_timestamp, Customer, NetworkNode, Project, ProjectSummary,
};

#[derive(Clone)]
pub struct Database {
    pub pool: Arc<SqlitePool>,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;

        // Ensure table exists
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                currency TEXT DEFAULT 'IDR',
                nodes_data JSON NOT NULL DEFAULT '[]',
                customers_data JSON NOT NULL DEFAULT '[]',
                cable_segments_data JSON NOT NULL DEFAULT '[]',
                connections_data JSON NOT NULL DEFAULT '[]',
                pole_spans_data JSON NOT NULL DEFAULT '[]',
                optical_components_data JSON NOT NULL DEFAULT '[]',
                areas_data JSON NOT NULL DEFAULT '[]',
                settings_data JSON NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
        )
        .execute(&pool)
        .await?;

        Ok(Self {
            pool: Arc::new(pool),
        })
    }

    pub async fn list_projects(&self) -> Result<Vec<ProjectSummary>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, name, description, currency, created_at, updated_at,
                   nodes_data, customers_data, cable_segments_data, connections_data
            FROM projects
            ORDER BY updated_at DESC
            "#,
        )
        .fetch_all(&*self.pool)
        .await?;

        let mut summaries = Vec::new();
        for row in rows {
            let id: String = row.get("id");
            let name: String = row.get("name");
            let description: String = row.try_get("description").unwrap_or_default();
            let currency: String = row.try_get("currency").unwrap_or_else(|_| "IDR".to_string());
            let created_at: Option<String> = row.try_get("created_at").ok();
            let updated_at: String = row.get("updated_at");

            let nodes_json: String = row.get("nodes_data");
            let customers_json: String = row.get("customers_data");
            let cables_json: String = row.get("cable_segments_data");
            let connections_json: String = row.get("connections_data");

            let nodes: Vec<NetworkNode> = serde_json::from_str(&nodes_json).unwrap_or_default();
            let customers: Vec<Customer> = serde_json::from_str(&customers_json).unwrap_or_default();
            let cables: Vec<serde_json::Value> = serde_json::from_str(&cables_json).unwrap_or_default();
            let connections: Vec<serde_json::Value> = serde_json::from_str(&connections_json).unwrap_or_default();

            let mut device_counts: HashMap<String, usize> = HashMap::new();
            for n in &nodes {
                let ntype = n.r#type.as_str().to_string();
                *device_counts.entry(ntype).or_insert(0) += 1;
            }
            if !customers.is_empty() {
                device_counts.insert("customer".to_string(), customers.len());
            }

            summaries.append(&mut vec![ProjectSummary {
                id,
                name,
                description,
                currency,
                created_at,
                updated_at,
                node_count: nodes.len(),
                customer_count: customers.len(),
                cable_segment_count: cables.len(),
                connection_count: connections.len(),
                device_counts,
            }]);
        }

        Ok(summaries)
    }

    pub async fn get_project(&self, project_id: &str) -> Result<Option<Project>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, name, description, currency, created_at, updated_at,
                   nodes_data, customers_data, cable_segments_data, connections_data,
                   pole_spans_data, optical_components_data, areas_data, settings_data
            FROM projects
            WHERE id = ?
            "#,
        )
        .bind(project_id)
        .fetch_optional(&*self.pool)
        .await?;

        match row {
            Some(row) => {
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
                    id,
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

                Ok(Some(project))
            }
            None => Ok(None),
        }
    }

    pub async fn save_project(&self, mut project: Project) -> Result<Project, sqlx::Error> {
        update_cable_lengths(&mut project.cable_segments);
        project.updated_at = current_utc_timestamp();

        let nodes_json = serde_json::to_string(&project.nodes).unwrap_or_else(|_| "[]".to_string());
        let customers_json = serde_json::to_string(&project.customers).unwrap_or_else(|_| "[]".to_string());
        let cables_json = serde_json::to_string(&project.cable_segments).unwrap_or_else(|_| "[]".to_string());
        let conns_json = serde_json::to_string(&project.connections).unwrap_or_else(|_| "[]".to_string());
        let spans_json = serde_json::to_string(&project.pole_spans).unwrap_or_else(|_| "[]".to_string());
        let opt_comps_json = serde_json::to_string(&project.optical_components).unwrap_or_else(|_| "[]".to_string());
        let areas_json = serde_json::to_string(&project.areas).unwrap_or_else(|_| "[]".to_string());
        let settings_json = serde_json::to_string(&project.settings).unwrap_or_else(|_| "{}".to_string());

        let existing_created_at: Option<String> = sqlx::query_scalar("SELECT created_at FROM projects WHERE id = ?")
            .bind(&project.id)
            .fetch_optional(&*self.pool)
            .await?;

        let created_at = existing_created_at.unwrap_or_else(|| project.created_at.clone());
        project.created_at = created_at.clone();

        sqlx::query(
            r#"
            INSERT INTO projects (
                id, name, description, currency, created_at, updated_at,
                nodes_data, customers_data, cable_segments_data, connections_data,
                pole_spans_data, optical_components_data, areas_data, settings_data
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                currency = excluded.currency,
                updated_at = excluded.updated_at,
                nodes_data = excluded.nodes_data,
                customers_data = excluded.customers_data,
                cable_segments_data = excluded.cable_segments_data,
                connections_data = excluded.connections_data,
                pole_spans_data = excluded.pole_spans_data,
                optical_components_data = excluded.optical_components_data,
                areas_data = excluded.areas_data,
                settings_data = excluded.settings_data
            "#,
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(&project.description)
        .bind(&project.currency)
        .bind(&created_at)
        .bind(&project.updated_at)
        .bind(&nodes_json)
        .bind(&customers_json)
        .bind(&cables_json)
        .bind(&conns_json)
        .bind(&spans_json)
        .bind(&opt_comps_json)
        .bind(&areas_json)
        .bind(&settings_json)
        .execute(&*self.pool)
        .await?;

        Ok(project)
    }

    pub async fn delete_project(&self, project_id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(project_id)
            .execute(&*self.pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }
}
