"""The FastAPI application: middleware, telemetry and the routes."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Literal

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from forgemind_api.db import database_reachable, make_engine, make_session_factory
from forgemind_api.errors import ApiFailure, install_error_handlers
from forgemind_api.github import (
    PERSONAS,
    GitHubIdentity,
    SimulatedGitHub,
    make_provider,
)
from forgemind_api.logging import configure_logging, request_id_var
from forgemind_api.models import InstallState, Organization, User
from forgemind_api.queue import make_dispatcher, queue_reachable
from forgemind_api.repositories import account_login_of
from forgemind_api.routes import auth as auth_routes
from forgemind_api.routes import notifications as notification_routes
from forgemind_api.routes import organizations as organization_routes
from forgemind_api.routes import repositories as repository_routes
from forgemind_api.routes import tasks as task_routes
from forgemind_api.settings import Settings, load_settings
from forgemind_api.telemetry import configure_telemetry

log = logging.getLogger("forgemind_api")

REQUEST_ID_HEADER = "x-request-id"
# The contract's data-source header: this service serves real data.
DATA_SOURCE_HEADER = "x-forgemind-data"
DATA_SOURCE = "live"
# The contract's provider header: where sign-in goes.
GITHUB_PROVIDER_HEADER = "x-forgemind-github"


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
        expose_headers=[REQUEST_ID_HEADER, DATA_SOURCE_HEADER, GITHUB_PROVIDER_HEADER],
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
            response.headers[GITHUB_PROVIDER_HEADER] = settings.github_provider
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
    app.state.session_factory = make_session_factory(engine) if engine else None
    app.state.dispatcher = make_dispatcher(settings)
    install_error_handlers(app)

    def resolve_account(installation_id: int) -> str | None:
        factory = app.state.session_factory
        if factory is None:
            return None
        with factory() as db:
            return account_login_of(db, installation_id)

    github = make_provider(settings, resolve_account)
    app.state.github = github
    if isinstance(github, SimulatedGitHub):

        def is_new(persona: GitHubIdentity) -> bool:
            # A persona without an organization goes through onboarding.
            return persona is PERSONAS[1]

        def resolve_install(state: str) -> tuple[str, str]:
            factory = app.state.session_factory
            if factory is None:
                raise ApiFailure("internal", "This service has no database configured")
            with factory() as db:
                pending = db.get(InstallState, state)
                if pending is None or pending.used_at is not None:
                    raise ApiFailure("invalid", "Unknown install state")
                user = db.get(User, pending.user_id)
                organization = db.get(Organization, pending.organization_id)
                if user is None or organization is None or not user.github_login:
                    raise ApiFailure("invalid", "Unknown install state")
                return user.github_login, organization.name

        app.include_router(github.router(is_new, resolve_install))

    app.include_router(auth_routes.router)
    app.include_router(organization_routes.router)
    app.include_router(repository_routes.router)
    app.include_router(task_routes.router)
    app.include_router(notification_routes.router)

    @app.get("/health", response_model=Health, responses={503: {"model": Health}})
    def health(response: Response) -> Health:
        checks: dict[str, Literal["ok", "unreachable"]] = {}
        if engine is not None:
            checks["database"] = "ok" if database_reachable(engine) else "unreachable"
        if settings.redis_url is not None:
            reachable = queue_reachable(settings.redis_url)
            checks["queue"] = "ok" if reachable else "unreachable"
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
