use std::time::Instant;
use tokio::sync::Mutex;

pub struct GeocodingService {
    client: reqwest::Client,
    provider_url: String,
    user_agent: String,
    last_request_at: Mutex<Option<Instant>>,
}

impl GeocodingService {
    pub fn new() -> Self {
        let provider_url = std::env::var("GEOCODING_PROVIDER_URL")
            .unwrap_or_else(|_| "https://nominatim.openstreetmap.org/search".to_string());
        let user_agent = std::env::var("GEOCODING_USER_AGENT").unwrap_or_else(|_| {
            "FTTHNetworkPlanningSimulator/0.1 (place search)".to_string()
        });

        Self {
            client: reqwest::Client::new(),
            provider_url,
            user_agent,
            last_request_at: Mutex::new(None),
        }
    }

    pub async fn search(&self, query: &str) -> Result<Vec<serde_json::Value>, String> {
        let normalized = query.trim();
        if normalized.len() < 3 {
            return Err("Enter at least 3 characters to search for a place.".to_string());
        }

        // Rate limiting check
        {
            let mut last_at = self.last_request_at.lock().await;
            if let Some(instant) = *last_at {
                let elapsed = instant.elapsed();
                if elapsed.as_millis() < 1100 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(
                        (1100 - elapsed.as_millis()) as u64,
                    ))
                    .await;
                }
            }
            *last_at = Some(Instant::now());
        }

        let res = self
            .client
            .get(&self.provider_url)
            .header("User-Agent", &self.user_agent)
            .query(&[("q", normalized), ("format", "jsonv2"), ("limit", "5")])
            .send()
            .await
            .map_err(|e| format!("Geocoding request failed: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Geocoding provider returned status {}", res.status()));
        }

        let raw_items: Vec<serde_json::Value> = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let mut results = Vec::new();
        for item in raw_items {
            let lon: f64 = item
                .get("lon")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            let lat: f64 = item
                .get("lat")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);

            let display_name = item
                .get("display_name")
                .and_then(|v| v.as_str())
                .unwrap_or("Place")
                .to_string();

            let place_id = item
                .get("place_id")
                .and_then(|v| v.as_i64())
                .map(|id| id.to_string())
                .unwrap_or_else(|| format!("{:.6},{:.6}", lon, lat));

            results.push(serde_json::json!({
                "id": place_id,
                "displayName": display_name,
                "address": "",
                "coordinate": [lon, lat],
                "category": item.get("type").and_then(|v| v.as_str()).unwrap_or("place")
            }));
        }

        Ok(results)
    }
}
