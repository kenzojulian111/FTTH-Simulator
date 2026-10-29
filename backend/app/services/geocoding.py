"""Rate-limited, cached adapter for Nominatim-compatible search providers."""

from __future__ import annotations

import json
import os
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PROVIDER_URL = os.environ.get("GEOCODING_PROVIDER_URL", "https://nominatim.openstreetmap.org/search")
USER_AGENT = os.environ.get("GEOCODING_USER_AGENT", "").strip() or "FTTHNetworkPlanningSimulator/0.1 (place search)"
CONTACT_EMAIL = os.environ.get("GEOCODING_CONTACT_EMAIL", "").strip()
MIN_REQUEST_INTERVAL_SECONDS = 1.1
CACHE_TTL_SECONDS = 6 * 60 * 60
MAX_CACHE_ENTRIES = 512
_cache: dict[str, tuple[float, list[dict]]] = {}
_last_request_at = 0.0
_lock = threading.Lock()


class GeocodingError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _valid_point(result: dict) -> dict | None:
    try:
        longitude = float(result["lon"])
        latitude = float(result["lat"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
        return None
    address_parts = result.get("address") or {}
    if not isinstance(address_parts, dict):
        address_parts = {}
    locality = next((address_parts.get(key) for key in ("city", "town", "village", "suburb", "county", "state") if address_parts.get(key)), "")
    display_name = str(result.get("display_name") or locality or "Place").strip()
    return {
        "id": str(result.get("place_id") or f"{longitude:.6f},{latitude:.6f}"),
        "displayName": display_name,
        "address": str(locality),
        "coordinate": [longitude, latitude],
        "category": str(result.get("type") or result.get("class") or "place"),
    }


def search_places(query: str) -> list[dict]:
    """Search once per explicit query; cache results and serialize provider calls."""
    global _last_request_at
    normalized = " ".join(query.lower().split())
    now = time.monotonic()
    with _lock:
        cached = _cache.get(normalized)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            return cached[1]
        wait = MIN_REQUEST_INTERVAL_SECONDS - (now - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        params = {"q": query, "format": "jsonv2", "addressdetails": 1, "limit": 6}
        if CONTACT_EMAIL:
            params["email"] = CONTACT_EMAIL
        request = Request(f"{PROVIDER_URL}?{urlencode(params)}", headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            _last_request_at = time.monotonic()
            if error.code == 429:
                raise GeocodingError("The place search provider is busy. Wait a moment and try again.", 429) from error
            raise GeocodingError(f"The place search provider returned an error ({error.code}).", 502) from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            _last_request_at = time.monotonic()
            raise GeocodingError("Could not reach the place search provider. Check your connection and retry.") from error
        _last_request_at = time.monotonic()
        results = [_valid_point(item) for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []
        clean_results = [item for item in results if item is not None]
        expired_keys = [key for key, (cached_at, _value) in _cache.items() if _last_request_at - cached_at >= CACHE_TTL_SECONDS]
        for key in expired_keys:
            _cache.pop(key, None)
        if len(_cache) >= MAX_CACHE_ENTRIES:
            _cache.pop(next(iter(_cache)))
        _cache[normalized] = (_last_request_at, clean_results)
        return clean_results
