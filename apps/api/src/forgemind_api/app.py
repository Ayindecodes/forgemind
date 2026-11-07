"""The FastAPI application: middleware, telemetry and the routes."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from forgemind_api.logging import configure_logging, request_id_var
from forgemind_api.settings import Settings, load_settings
from forgemind_api.telemetry import configure_telemetry

log = logging.getLogger("forgemind_api")

REQUEST_ID_HEADER = "x-request-id"


class Health(BaseModel):
    """What the service says about itself."""

    status: str
    service: str
    version: str
    commit: str
    environment: str


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
        expose_headers=[REQUEST_ID_HEADER],
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

    @app.get("/health", response_model=Health)
    def health() -> Health:
        return Health(
            status="ok",
            service="forgemind-api",
            version=settings.version,
            commit=settings.commit,
            environment=settings.environment,
        )

    configure_telemetry(app, settings)
    return app


app = create_app()
