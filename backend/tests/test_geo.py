"""Unit tests for geographic route distance calculations."""

import pytest
from backend.app.domain.models import CableSegment, LineGeometry
from backend.app.engine.geo import (
    calculate_route_length,
    distance_meters,
    update_cable_lengths,
)


def test_distance_meters_exact_match_frontend():
    """Verify distance matches frontend approximate calculation within 1%.
    
    Frontend test asserts [115, -8] to [115.001, -8] is between 100m and 120m.
    """
    coord_a = (115.0, -8.0)
    coord_b = (115.001, -8.0)
    dist = distance_meters(coord_a, coord_b)
    # Haversine distance for 0.001 deg lon at lat -8 deg is ~110.1 m
    assert 109.0 <= dist <= 112.0


def test_distance_meters_same_point():
    """Distance between a point and itself is 0."""
    coord = (106.8456, -6.2088)
    assert distance_meters(coord, coord) == 0.0


def test_calculate_route_length_multi_vertex():
    """Calculate multi-vertex path length accurately."""
    coords = [
        (115.2000, -8.6500),
        (115.2050, -8.6550),
        (115.2100, -8.6600),
    ]
    total = calculate_route_length(coords)
    segment_1 = distance_meters(coords[0], coords[1])
    segment_2 = distance_meters(coords[1], coords[2])
    assert pytest.approx(total, abs=0.01) == (segment_1 + segment_2)


def test_update_cable_lengths():
    """Verify update_cable_lengths sets length_m on all cable segments."""
    cables = [
        CableSegment(
            id="c1",
            name="Cable 1",
            geometry=LineGeometry(
                coordinates=[(115.0, -8.0), (115.001, -8.0)]
            ),
            length_m=None,
        ),
        CableSegment(
            id="c2",
            name="Cable 2",
            geometry=LineGeometry(
                coordinates=[(115.0, -8.0), (115.002, -8.0)]
            ),
            length_m=None,
        ),
    ]
    update_cable_lengths(cables)
    assert cables[0].length_m is not None
    assert cables[1].length_m is not None
    assert cables[0].length_m > 100.0
    assert cables[1].length_m > cables[0].length_m
