"""What routes depend on: a database session and the signed-in person."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import SESSION_COOKIE, Principal, principal_for_token
from forgemind_api.db import run_after_commit
from forgemind_api.errors import ApiFailure
from forgemind_api.github import GitHubProvider
from forgemind_api.settings import Settings


def settings_of(request: Request) -> Settings:
    return request.app.state.settings


def provider_of(request: Request) -> GitHubProvider:
    return request.app.state.github


def db_of(request: Request) -> Iterator[DbSession]:
    factory = request.app.state.session_factory
    if factory is None:
        raise ApiFailure("internal", "This service has no database configured")
    with factory() as db:
        with db.begin():
            yield db
        run_after_commit(db)


# Function scope: the transaction commits, and anything waiting on the commit
# runs, before the response starts. Nobody is told a write happened before it
# is durable.
Db = Annotated[DbSession, Depends(db_of, scope="function")]
Config = Annotated[Settings, Depends(settings_of)]
GitHub = Annotated[GitHubProvider, Depends(provider_of)]


def current_principal(request: Request, db: Db) -> Principal:
    return principal_for_token(db, request.cookies.get(SESSION_COOKIE))


Current = Annotated[Principal, Depends(current_principal)]
