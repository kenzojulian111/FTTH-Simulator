"""Consistent error handling and response formatting conforming to docs/API_CONTRACT.md."""

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from backend.app.domain.models import ErrorBody, ErrorDetail, ErrorEnvelope
from backend.app.domain.validation import TopologyValidationError


def _format_pydantic_loc(loc: tuple) -> str:
    """Format a Pydantic error loc tuple into a path string (e.g., 'nodes[0].name')."""
    parts = []
    for item in loc:
        if item in ("body", "query", "path"):
            continue
        if isinstance(item, int):
            if parts:
                parts[-1] = f"{parts[-1]}[{item}]"
            else:
                parts.append(f"[{item}]")
        else:
            parts.append(str(item))
    return ".".join(parts) or "body"


def register_error_handlers(app: FastAPI) -> None:
    """Register custom exception handlers on the FastAPI application."""

    @app.exception_handler(TopologyValidationError)
    async def topology_validation_handler(request: Request, exc: TopologyValidationError):
        envelope = ErrorEnvelope(
            error=ErrorBody(
                code="validation_error",
                message=exc.message,
                details=exc.details,
            )
        )
        return JSONResponse(
            status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
            content=envelope.model_dump(by_alias=True),
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        details = [
            ErrorDetail(
                field=_format_pydantic_loc(err["loc"]),
                message=err["msg"],
            )
            for err in exc.errors()
        ]
        envelope = ErrorEnvelope(
            error=ErrorBody(
                code="validation_error",
                message="Request payload validation failed",
                details=details,
            )
        )
        return JSONResponse(
            status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
            content=envelope.model_dump(by_alias=True),
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        code = "not_found" if exc.status_code == 404 else "request_error"
        message = str(exc.detail)
        details = None
        if isinstance(exc.detail, dict):
            code = exc.detail.get("code", code)
            message = str(exc.detail.get("message", message))
            details = exc.detail.get("details", None)
        envelope = ErrorEnvelope(
            error=ErrorBody(
                code=code,
                message=message,
                details=details,
            )
        )
        return JSONResponse(
            status_code=exc.status_code,
            content=envelope.model_dump(by_alias=True),
        )

    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        envelope = ErrorEnvelope(
            error=ErrorBody(
                code="internal_error",
                message="An unexpected server error occurred.",
                details=None,
            )
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=envelope.model_dump(by_alias=True),
        )
