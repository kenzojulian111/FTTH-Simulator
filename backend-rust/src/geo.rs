use crate::models::CableSegment;

pub const EARTH_RADIUS_METRES: f64 = 6371008.8;

pub fn distance_meters(coord_a: (f64, f64), coord_b: (f64, f64)) -> f64 {
    let (lon1, lat1) = coord_a;
    let (lon2, lat2) = coord_b;

    if (lon1 - lon2).abs() < f64::EPSILON && (lat1 - lat2).abs() < f64::EPSILON {
        return 0.0;
    }

    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_phi = (lat2 - lat1).to_radians();
    let delta_lambda = (lon2 - lon1).to_radians();

    let h = (delta_phi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (delta_lambda / 2.0).sin().powi(2);
    let h = h.clamp(0.0, 1.0);
    let c = 2.0 * h.sqrt().atan2((1.0 - h).sqrt());

    EARTH_RADIUS_METRES * c
}

pub fn calculate_route_length(coordinates: &[(f64, f64)]) -> f64 {
    if coordinates.len() < 2 {
        return 0.0;
    }

    let mut total_meters = 0.0;
    for i in 0..coordinates.len() - 1 {
        total_meters += distance_meters(coordinates[i], coordinates[i + 1]);
    }

    total_meters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identical_coordinates_zero_distance() {
        assert_eq!(distance_meters((106.8456, -6.2088), (106.8456, -6.2088)), 0.0);
    }

    #[test]
    fn test_calculate_route_length() {
        let coords = vec![(106.8456, -6.2088), (106.8460, -6.2088)];
        let len = calculate_route_length(&coords);
        assert!(len > 0.0);
    }
}

pub fn update_cable_lengths(cables: &mut [CableSegment]) {
    for cable in cables.iter_mut() {
        if cable.properties.get("routeStatus").and_then(|v| v.as_str()) == Some("manual_required")
            && cable.geometry.coordinates.is_empty()
        {
            cable.length_m = None;
            continue;
        }
        let raw_length = calculate_route_length(&cable.geometry.coordinates);
        cable.length_m = Some((raw_length * 100.0).round() / 100.0);
    }
}
