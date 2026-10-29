"""Environment-backed application configuration."""

import os
from urllib.parse import urlsplit


def cors_policy(environment: str | None = None, configured_origins: str | None = None) -> tuple[list[str], bool]:
    """Return exact CORS origins; non-development deployments must configure them."""
    env = (environment if environment is not None else os.getenv("FTTH_ENVIRONMENT", "development")).strip().lower()
    raw = configured_origins if configured_origins is not None else os.getenv("CORS_ALLOWED_ORIGINS", "")
    if not raw.strip():
        if env in {"development", "dev", "local", "test"}:
            return ["http://localhost:5173", "http://127.0.0.1:5173"], True
        raise RuntimeError("CORS_ALLOWED_ORIGINS must list explicit origins outside local development.")

    origins = [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    for origin in origins:
        parsed = urlsplit(origin)
        try:
            valid_port = parsed.port is None or 1 <= parsed.port <= 65535
        except ValueError:
            valid_port = False
        if (
            origin == "*"
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or not valid_port
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError("CORS_ALLOWED_ORIGINS must contain exact http(s) origins; wildcard and URL paths are not allowed.")
    if len(set(origins)) != len(origins):
        origins = list(dict.fromkeys(origins))
    return origins, True
