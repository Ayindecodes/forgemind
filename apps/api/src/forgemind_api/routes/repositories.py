"""The GitHub App installation, the repositories it can see, and the ones
connected to the organization."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Annotated, Any, cast

from fastapi import APIRouter, Header, Path, Query, Request
from sqlalchemy.orm import Session as DbSession

from forgemind_api import repositories as service
from forgemind_api.deps import Config, Current, Db, GitHub
from forgemind_api.errors import ApiFailure
from forgemind_api.models import GitHubInstallation, Repository
from forgemind_api.organizations import require_org
from forgemind_api.schemas import (
    ConnectRepositoryIn,
    GitHubRedirectOut,
    GitHubRepositoryOut,
    InstallationOut,
    InstallationStateOut,
    InstallCallbackIn,
    LanguageOut,
    OkOut,
    PermissionOut,
    RepositoryOut,
    RepositoryPageOut,
)

router = APIRouter(tags=["repositories"])

RepositoryId = Annotated[str, Path(description="The repository's id")]


def installation_out(installation: GitHubInstallation) -> InstallationOut:
    return InstallationOut(
        id=str(installation.installation_id),
        account_login=installation.account_login,
        account_type=installation.account_type,  # type: ignore[arg-type]
        repository_selection=installation.repository_selection,  # type: ignore[arg-type]
        permissions=[
            PermissionOut.model_validate(p)
            for p in cast(list[object], installation.permissions)
        ],
        installed_at=installation.created_at,
    )


def repository_out(db: DbSession, repo: Repository) -> RepositoryOut:
    latest = service.latest_task_id(db, repo.id)
    return RepositoryOut(
        id=str(repo.id),
        organization_id=str(repo.organization_id),
        github_id=repo.github_id,
        full_name=repo.full_name,
        default_branch=repo.default_branch,
        private=repo.private,
        url=repo.url,
        status=repo.status,  # type: ignore[arg-type]
        status_message=repo.status_message,
        languages=[
            LanguageOut.model_validate(language)
            for language in cast(list[object], repo.languages)
        ],
        last_analyzed_commit=repo.last_analyzed_commit,
        last_analyzed_at=repo.last_analyzed_at,
        open_findings=service.open_findings(db, repo.id),
        latest_task_id=str(latest) if latest else None,
        pushed_at=repo.pushed_at or repo.connected_at,
        connected_at=repo.connected_at,
    )


@router.get("/github/installation", response_model=InstallationStateOut)
def installation(db: Db, current: Current) -> InstallationStateOut:
    found = service.installation_of(db, require_org(current))
    return InstallationStateOut(installation=installation_out(found) if found else None)


@router.post("/github/install/start", response_model=GitHubRedirectOut)
def install_start(db: Db, current: Current, github: GitHub) -> GitHubRedirectOut:
    state = service.start_install(db, current)
    return GitHubRedirectOut(url=github.install_url(state), state=state)


@router.post(
    "/github/install/callback", response_model=InstallationOut, status_code=201
)
def install_callback(
    body: InstallCallbackIn, db: Db, current: Current, github: GitHub
) -> InstallationOut:
    return installation_out(
        service.complete_install(db, current, github, body.installation_id, body.state)
    )


@router.get("/github/repositories", response_model=list[GitHubRepositoryOut])
def github_repositories(
    db: Db, current: Current, github: GitHub
) -> list[GitHubRepositoryOut]:
    return [
        GitHubRepositoryOut(
            github_id=repo.github_id,
            full_name=repo.full_name,
            private=repo.private,
            default_branch=repo.default_branch,
            description=repo.description,
            pushed_at=repo.pushed_at,
            connected_repository_id=str(connected) if connected else None,
        )
        for repo, connected in service.github_repositories(db, current, github)
    ]


@router.get("/repositories", response_model=RepositoryPageOut)
def repositories(
    db: Db,
    current: Current,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> RepositoryPageOut:
    items, next_cursor = service.repositories_page(
        db, require_org(current), cursor, limit
    )
    return RepositoryPageOut(
        items=[repository_out(db, repo) for repo in items], next_cursor=next_cursor
    )


@router.post("/repositories", response_model=RepositoryOut, status_code=201)
def connect_repository(
    body: ConnectRepositoryIn, db: Db, current: Current, github: GitHub
) -> RepositoryOut:
    repo = service.connect_repository(
        db, current, github, body.github_id, body.full_name
    )
    return repository_out(db, repo)


@router.get("/repositories/{id}", response_model=RepositoryOut)
def repository(id: RepositoryId, db: Db, current: Current) -> RepositoryOut:
    return repository_out(db, service.repository_of(db, require_org(current), id))


@router.delete("/repositories/{id}", response_model=OkOut)
def disconnect_repository(id: RepositoryId, db: Db, current: Current) -> OkOut:
    service.disconnect_repository(db, current, id)
    return OkOut()


@router.post("/github/webhooks", status_code=202)
async def github_webhook(
    request: Request,
    db: Db,
    settings: Config,
    x_github_event: Annotated[str, Header()] = "",
    x_hub_signature_256: Annotated[str, Header()] = "",
) -> dict[str, str]:
    """What GitHub tells us about installations, if it is really GitHub."""
    secret = settings.github_webhook_secret
    if not secret:
        raise ApiFailure("internal", "Webhooks are not configured")
    body = await request.body()
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_hub_signature_256):
        raise ApiFailure("unauthorized", "The signature does not match")
    try:
        payload: Any = json.loads(body)
    except ValueError:
        raise ApiFailure("invalid", "The payload is not JSON") from None
    if not isinstance(payload, dict):
        raise ApiFailure("invalid", "The payload is not an object")
    outcome = service.handle_webhook(
        db, x_github_event, cast(dict[str, object], payload)
    )
    return {"result": outcome}
