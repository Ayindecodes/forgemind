"""The FastAPI application: middleware, telemetry and the routes."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from forgemind_api.db import database_reachable, make_engine
from forgemind_api.logging import configure_logging, request_id_var
from forgemind_api.settings import Settings, load_settings
from forgemind_api.telemetry import configure_telemetry

log = logging.getLogger("forgemind_api")

REQUEST_ID_HEADER = "x-request-id"
# The contract's data-source header: this service serves real data.
DATA_SOURCE_HEADER = "x-forgemind-data"
DATA_SOURCE = "live"


class Health(BaseModel):
    """What the service says about itself and what it depends on."""

    status: Literal["ok", "degraded"]
    service: str
    version: str
    commit: str
    environment: str
    # Each configured dependency, "ok" or "unreachable". Absent ones are not listed.
    checks: dict[str, Literal["ok", "unreachable"]]


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application from the given settings, or from the environment."""
    settings = settings or load_settings()
    configure_logging(settings.log_level)
    app = FastAPI(title="ForgeMind API", version=settings.version)
    app.state.settings = settings

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["content-type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER, DATA_SOURCE_HEADER],
    )

    @app.middleware("http")
    async def request_id(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and len(incoming) <= 128 else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        try:
            response = await call_next(request)
            response.headers[REQUEST_ID_HEADER] = request_id
            response.headers[DATA_SOURCE_HEADER] = DATA_SOURCE
            log.info(
                "request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                },
            )
        finally:
            request_id_var.reset(token)
        return response

    engine = make_engine(settings.database_url) if settings.database_url else None
    app.state.engine = engine

    @app.get("/health", response_model=Health, responses={503: {"model": Health}})
    def health(response: Response) -> Health:
        checks: dict[str, Literal["ok", "unreachable"]] = {}
        if engine is not None:
            checks["database"] = "ok" if database_reachable(engine) else "unreachable"
        degraded = "unreachable" in checks.values()
        if degraded:
            response.status_code = 503
        return Health(
            status="degraded" if degraded else "ok",
            service="forgemind-api",
            version=settings.version,
            commit=settings.commit,
            environment=settings.environment,
            checks=checks,
        )

    configure_telemetry(app, settings)
    return app


app = create_app()
