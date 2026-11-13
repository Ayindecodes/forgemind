"""The GitHub App installation and the repositories connected through it.

Rules follow the dev API: owners and admins install and revoke; developers may
connect; a repository is connected once per organization, and reconnecting a
revoked one revives the same record. Every change writes an audit entry.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import Principal, now
from forgemind_api.errors import ApiFailure
from forgemind_api.github import APP_PERMISSIONS, GitHubProvider, GitHubRepo, as_object
from forgemind_api.indexing import request_indexing
from forgemind_api.models import (
    GitHubInstallation,
    InstallState,
    Repository,
    SecurityFinding,
    Task,
)
from forgemind_api.organizations import audit, require_org, require_role
from forgemind_api.queue import Dispatcher

STATE_MINUTES = 10
SUSPENDED = "The GitHub App installation was suspended by the organization owner."
UNINSTALLED = "The GitHub App was uninstalled."
INACCESSIBLE = "No longer accessible through the GitHub App."


def installation_of(
    db: DbSession, organization_id: uuid.UUID
) -> GitHubInstallation | None:
    return db.scalars(
        select(GitHubInstallation).where(
            GitHubInstallation.organization_id == organization_id
        )
    ).first()


def account_login_of(db: DbSession, installation_id: int) -> str | None:
    """The GitHub account a stored installation belongs to, if it is stored."""
    return db.scalar(
        select(GitHubInstallation.account_login).where(
            GitHubInstallation.installation_id == installation_id
        )
    )


def start_install(db: DbSession, principal: Principal) -> str:
    organization_id = require_org(principal)
    require_role(principal, ("owner", "admin"))
    state = f"install-{uuid.uuid4().hex}"
    db.add(
        InstallState(
            state=state,
            organization_id=organization_id,
            user_id=principal.user.id,
            expires_at=now() + timedelta(minutes=STATE_MINUTES),
        )
    )
    db.flush()
    return state


def complete_install(
    db: DbSession,
    principal: Principal,
    provider: GitHubProvider,
    installation_id: str,
    state: str,
) -> GitHubInstallation:
    organization_id = require_org(principal)
    pending = db.get(InstallState, state)
    if (
        pending is None
        or pending.used_at is not None
        or pending.expires_at <= now()
        or pending.organization_id != organization_id
        or pending.user_id != principal.user.id
    ):
        raise ApiFailure(
            "invalid", "The installation could not be completed. Try again."
        )
    try:
        numeric = int(installation_id)
    except ValueError:
        raise ApiFailure(
            "invalid", "The installation could not be completed. Try again."
        ) from None
    pending.used_at = now()
    info = provider.installation(numeric)
    elsewhere = db.scalars(
        select(GitHubInstallation).where(
            GitHubInstallation.installation_id == numeric,
            GitHubInstallation.organization_id != organization_id,
        )
    ).first()
    if elsewhere is not None:
        raise ApiFailure(
            "conflict", "That installation already belongs to another organization"
        )
    installation = installation_of(db, organization_id)
    if installation is None:
        installation = GitHubInstallation(
            organization_id=organization_id,
            installation_id=numeric,
            account_login=info.account_login,
            account_type=info.account_type,
            repository_selection=info.repository_selection,
            permissions=list(APP_PERMISSIONS),
        )
        db.add(installation)
    else:
        installation.installation_id = numeric
        installation.account_login = info.account_login
        installation.account_type = info.account_type
        installation.repository_selection = info.repository_selection
        installation.permissions = list(APP_PERMISSIONS)
        installation.suspended_at = None
    db.flush()
    db.refresh(installation)
    audit(
        db,
        organization_id,
        principal.user,
        "github_app.installed",
        "installation",
        str(numeric),
        info.account_login,
    )
    return installation


def github_repositories(
    db: DbSession, principal: Principal, provider: GitHubProvider
) -> list[tuple[GitHubRepo, uuid.UUID | None]]:
    organization_id = require_org(principal)
    installation = installation_of(db, organization_id)
    if installation is None:
        raise ApiFailure("conflict", "Install the GitHub App first")
    connected = {
        repo.github_id: repo.id
        for repo in db.scalars(
            select(Repository).where(
                Repository.organization_id == organization_id,
                Repository.status != "revoked",
            )
        )
    }
    return [
        (repo, connected.get(repo.github_id))
        for repo in provider.installation_repositories(installation.installation_id)
    ]


def repositories_page(
    db: DbSession, organization_id: uuid.UUID, cursor: str | None, limit: int
) -> tuple[list[Repository], str | None]:
    """Most recently pushed first, the way the dev API orders them."""
    try:
        offset = int(cursor) if cursor else 0
    except ValueError:
        raise ApiFailure("invalid", "Invalid cursor") from None
    if offset < 0:
        raise ApiFailure("invalid", "Invalid cursor")
    rows = db.scalars(
        select(Repository)
        .where(Repository.organization_id == organization_id)
        .order_by(
            Repository.pushed_at.desc().nulls_last(), Repository.created_at.desc()
        )
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return list(rows[:limit]), (str(offset + limit) if len(rows) > limit else None)


def repository_of(
    db: DbSession, organization_id: uuid.UUID, repo_id: str
) -> Repository:
    try:
        parsed = uuid.UUID(repo_id)
    except ValueError:
        raise ApiFailure("not_found", "No such repository") from None
    repo = db.get(Repository, parsed)
    if repo is None or repo.organization_id != organization_id:
        raise ApiFailure("not_found", "No such repository")
    return repo


def open_findings(db: DbSession, repo_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(SecurityFinding)
            .where(
                SecurityFinding.repository_id == repo_id,
                SecurityFinding.status == "open",
            )
        )
        or 0
    )


def latest_task_id(db: DbSession, repo_id: uuid.UUID) -> uuid.UUID | None:
    return db.scalar(
        select(Task.id)
        .where(Task.repository_id == repo_id)
        .order_by(Task.created_at.desc())
        .limit(1)
    )


def connect_repository(
    db: DbSession,
    principal: Principal,
    provider: GitHubProvider,
    dispatcher: Dispatcher,
    github_id: int,
    full_name: str,
) -> Repository:
    """Connects a repository the organization's installation can see, and
    asks for it to be indexed. What is stored about it is what GitHub says,
    not what the request says."""
    organization_id = require_org(principal)
    require_role(principal, ("owner", "admin", "developer"))
    existing = db.scalars(
        select(Repository).where(
            Repository.organization_id == organization_id,
            Repository.github_id == github_id,
        )
    ).first()
    if existing is not None and existing.status != "revoked":
        raise ApiFailure("conflict", f"{existing.full_name} is already connected")
    installation = installation_of(db, organization_id)
    if installation is None:
        raise ApiFailure("conflict", "Install the GitHub App first")
    source = next(
        (
            repo
            for repo in provider.installation_repositories(installation.installation_id)
            if repo.github_id == github_id
        ),
        None,
    )
    if source is None:
        raise ApiFailure(
            "not_found", "The GitHub App installation cannot see that repository"
        )
    if existing is None:
        repo = Repository(
            organization_id=organization_id,
            installation_id=installation.id,
            github_id=github_id,
            full_name=source.full_name,
            private=source.private,
            default_branch=source.default_branch,
            url=f"https://github.com/{source.full_name}",
            status="analyzing",
            languages=[],
            pushed_at=source.pushed_at,
            connected_at=now(),
        )
        db.add(repo)
    else:
        # A revoked connection comes back as the same record, so its history
        # of tasks and findings stays attached.
        repo = existing
        repo.revoked_at = None
        repo.connected_at = now()
        repo.installation_id = installation.id
        repo.full_name = source.full_name
        repo.url = f"https://github.com/{source.full_name}"
        repo.private = source.private
        repo.default_branch = source.default_branch
        repo.pushed_at = source.pushed_at
    request_indexing(db, repo, dispatcher)
    db.refresh(repo)
    audit(
        db,
        organization_id,
        principal.user,
        "repository.connected",
        "repository",
        str(repo.id),
        repo.full_name,
    )
    return repo


def disconnect_repository(
    db: DbSession, principal: Principal, repo_id: str
) -> Repository:
    organization_id = require_org(principal)
    require_role(principal, ("owner", "admin"))
    repo = repository_of(db, organization_id, repo_id)
    repo.status = "revoked"
    repo.status_message = "Access revoked"
    repo.revoked_at = now()
    db.flush()
    audit(
        db,
        organization_id,
        principal.user,
        "repository.revoked",
        "repository",
        str(repo.id),
        repo.full_name,
    )
    return repo


def handle_webhook(
    db: DbSession, dispatcher: Dispatcher, event: str, payload: dict[str, object]
) -> str:
    """Applies what GitHub says about an installation. Returns what was done."""
    installation_id = as_object(payload.get("installation")).get("id")
    if not isinstance(installation_id, int):
        return "ignored: no installation"
    installation = db.scalars(
        select(GitHubInstallation).where(
            GitHubInstallation.installation_id == installation_id
        )
    ).first()
    if installation is None:
        return "ignored: unknown installation"
    action = payload.get("action")
    repos = db.scalars(
        select(Repository).where(
            Repository.organization_id == installation.organization_id,
            Repository.status != "revoked",
        )
    ).all()
    if event == "installation" and action == "deleted":
        for repo in repos:
            repo.status = "error"
            repo.status_message = UNINSTALLED
            repo.installation_id = None
        db.delete(installation)
        return "installation removed"
    if event == "installation" and action == "suspend":
        installation.suspended_at = now()
        for repo in repos:
            repo.status = "error"
            repo.status_message = SUSPENDED
        return "installation suspended"
    if event == "installation" and action == "unsuspend":
        installation.suspended_at = None
        for repo in repos:
            if repo.status == "error" and repo.status_message == SUSPENDED:
                if repo.last_analyzed_commit is None:
                    request_indexing(db, repo, dispatcher)
                else:
                    repo.status = "connected"
                    repo.status_message = None
        return "installation restored"
    if event == "installation_repositories" and action == "removed":
        removed: set[int] = set()
        raw = payload.get("repositories_removed")
        if isinstance(raw, list):
            for item in cast(list[object], raw):
                github_id = as_object(item).get("id")
                if isinstance(github_id, int):
                    removed.add(github_id)
        for repo in repos:
            if repo.github_id in removed:
                repo.status = "error"
                repo.status_message = INACCESSIBLE
        return f"{len(removed)} repositories marked inaccessible"
    return f"ignored: {event} {action}"
