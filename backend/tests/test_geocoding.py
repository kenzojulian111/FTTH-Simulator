import json
from urllib.error import HTTPError

import pytest
from fastapi import HTTPException

from backend.app.api import routes
from backend.app.services import geocoding


class _Response:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return self.body


@pytest.fixture(autouse=True)
def reset_geocoder(monkeypatch):
    geocoding._cache.clear()
    monkeypatch.setattr(geocoding, "_last_request_at", 0.0)
    monkeypatch.setattr(geocoding, "PROVIDER_URL", "https://nominatim.test/search")
    monkeypatch.setattr(geocoding, "CONTACT_EMAIL", "")


def test_search_route_validates_query_and_returns_places(monkeypatch):
    monkeypatch.setattr(routes, "search_places", lambda query: [{"id": query, "displayName": query, "address": "Bali", "coordinate": [115.21, -8.65], "category": "city"}])
    with pytest.raises(HTTPException) as invalid:
        routes.geocoding_search("  ")
    assert invalid.value.status_code == 422
    response = routes.geocoding_search("  Denpasar  ")
    assert response["results"][0]["coordinate"] == [115.21, -8.65]
    assert response["results"][0]["id"] == "Denpasar"


def test_search_provider_is_identified_cached_and_not_called_for_repeats(monkeypatch):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append(request)
        return _Response([{"place_id": 1, "display_name": "Bali", "lon": "115", "lat": "-8", "type": "island"}])

    monkeypatch.setattr(geocoding, "urlopen", fake_urlopen)
    assert geocoding.search_places("Bali") == geocoding.search_places("  bali ")
    assert len(requests) == 1
    assert "FTTHNetworkPlanningSimulator" in requests[0].get_header("User-agent")
    assert "format=jsonv2" in requests[0].full_url
    assert "limit=6" in requests[0].full_url
    assert geocoding.MIN_REQUEST_INTERVAL_SECONDS >= 1


def test_provider_throttling_is_reported_as_retryable(monkeypatch):
    def throttled(*_args, **_kwargs):
        raise HTTPError("https://nominatim.test/search", 429, "rate limited", {}, None)

    monkeypatch.setattr(geocoding, "urlopen", throttled)
    with pytest.raises(geocoding.GeocodingError) as error:
        geocoding.search_places("Bali")
    assert error.value.status_code == 429
    assert "busy" in str(error.value)
