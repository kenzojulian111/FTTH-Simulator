import asyncio

import httpx
import pytest

from backend.app.main import app

from backend.app.config import cors_policy


def test_cors_policy_has_local_defaults_and_requires_explicit_nonlocal_origins():
    origins, credentials = cors_policy("development", "")
    assert origins == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert credentials is True
    with pytest.raises(RuntimeError, match="CORS_ALLOWED_ORIGINS"):
        cors_policy("production", "")
    assert cors_policy("production", "https://planner.example,https://admin.example")[0] == [
        "https://planner.example", "https://admin.example"
    ]


@pytest.mark.parametrize("value", ["*", "https://planner.example/path", "ftp://planner.example", "https://user@planner.example", "https://planner.example:bad"])
def test_cors_policy_rejects_wildcard_or_non_origin_values(value):
    with pytest.raises(RuntimeError, match="exact http"):
        cors_policy("production", value)


def test_cors_preflight_allows_local_origin_and_rejects_other_origins():
    async def requests():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            allowed = await client.options(
                "/api/v1/projects",
                headers={
                    "Origin": "http://localhost:5173",
                    "Access-Control-Request-Method": "PUT",
                    "Access-Control-Request-Headers": "content-type",
                },
            )
            rejected = await client.options(
                "/api/v1/projects",
                headers={
                    "Origin": "https://untrusted.example",
                    "Access-Control-Request-Method": "PUT",
                },
            )
            return allowed, rejected

    allowed, rejected = asyncio.run(requests())
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers
