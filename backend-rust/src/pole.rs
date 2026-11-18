use std::collections::HashMap;

use crate::geo::calculate_route_length;
use crate::models::{current_utc_timestamp, PoleSpanResult, Project};

pub fn calculate_pole_spans(project: &Project) -> PoleSpanResult {
    let cables_by_id: HashMap<String, _> = project
        .cable_segments
        .iter()
        .map(|c| (c.id.clone(), c))
        .collect();

    let mut spans_json = Vec::new();
    for span in &project.pole_spans {
        let cable = cables_by_id.get(&span.cable_segment_id);
        let length_m = span.length_m.unwrap_or_else(|| {
            if let Some(ref geom) = span.geometry {
                calculate_route_length(&geom.coordinates)
            } else if let Some(c) = cable {
                calculate_route_length(&c.geometry.coordinates)
            } else {
                0.0
            }
        });

        spans_json.push(serde_json::json!({
            "id": span.id,
            "cableSegmentId": span.cable_segment_id,
            "fromPoleId": span.from_pole_id,
            "toPoleId": span.to_pole_id,
            "lengthM": (length_m * 100.0).round() / 100.0,
            "status": span.status,
            "lengthSource": span.length_source,
            "coversEntireCableRoute": span.covers_entire_cable_route,
        }));
    }

    let default_limit = project.settings.pole_span_planning.default_max_span_m;
    let odp_limit = project.settings.pole_span_planning.max_odp_to_house_distance_m;

    PoleSpanResult {
        project_id: project.id.clone(),
        calculated_at: current_utc_timestamp(),
        spans: spans_json,
        diagnostics: Vec::new(),
        estimated_additional_poles: None,
        estimation_method: None,
        assumptions: vec!["Explicit pole span records are authoritative.".to_string()],
        max_span_limit_m: default_limit,
        max_odp_to_house_limit_m: odp_limit,
        odp_house_distances: Vec::new(),
    }
}
