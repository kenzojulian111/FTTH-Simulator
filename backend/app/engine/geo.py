"""Geographic calculations using WGS-84 Haversine distance."""

import math
from typing import List, Sequence, Tuple
from backend.app.domain.models import CableSegment

# Mean Earth radius in metres, aligned with frontend implementation
EARTH_RADIUS_METRES = 6371008.8


def distance_meters(coord_a: Tuple[float, float], coord_b: Tuple[float, float]) -> float:
    """Calculate great-circle distance between two [longitude, latitude] coordinates in metres."""
    lon1, lat1 = coord_a
    lon2, lat2 = coord_b

    # Exact match fast path for identical points or duplicate consecutive vertices
    if lon1 == lon2 and lat1 == lat2:
        return 0.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    h = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    # Avoid numerical instability near antipodes
    h = min(1.0, max(0.0, h))
    c = 2.0 * math.atan2(math.sqrt(h), math.sqrt(1.0 - h))

    return EARTH_RADIUS_METRES * c


def calculate_route_length(coordinates: Sequence[Tuple[float, float]]) -> float:
    """Calculate the cumulative route distance along a sequence of coordinates in metres."""
    if len(coordinates) < 2:
        return 0.0

    total_meters = 0.0
    for idx in range(len(coordinates) - 1):
        total_meters += distance_meters(coordinates[idx], coordinates[idx + 1])

    return total_meters


def has_zero_length_route(coordinates: Sequence[Tuple[float, float]]) -> bool:
    """Return true only when every route segment has exactly zero geodesic length."""
    return calculate_route_length(coordinates) == 0.0


def update_cable_lengths(cables: List[CableSegment]) -> List[CableSegment]:
    """Compute and update the authoritative length_m for all cable segments."""
    for cable in cables:
        raw_length = calculate_route_length(cable.geometry.coordinates)
        cable.length_m = round(raw_length, 2)
    return cables
