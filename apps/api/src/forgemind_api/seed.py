"""A known organization, its people, its repositories and fixed session tokens
for development and tests. Refuses to run anywhere else. Safe to run again:
it updates.

The repositories are the simulated GitHub's, and what is recorded about them
is found the way a worker finds it: each is cloned and inspected here."""

from __future__ import annotations

import functools
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api import workspace
from forgemind_api.auth import token_hash
from forgemind_api.github import APP_PERMISSIONS, PERSONAS, SimulatedGitHub
from forgemind_api.indexing import record_analysis
from forgemind_api.inspection import Inspection, inspect_tree
from forgemind_api.models import (
    GitHubInstallation,
    Organization,
    OrganizationMember,
    Repository,
    Session,
    User,
)
from forgemind_api.settings import Settings, SettingsError
from forgemind_api.workspace import RepositoryUnavailable

# The installation the organization is seeded with, and the simulated GitHub
# account it is on.
INSTALLATION = 1001
ACCOUNT = "forgemind"

PEOPLE: tuple[tuple[str, str, str, int | None, str | None], ...] = (
    # name, email, github login, github id, role in the organization
    ("Ayinde", "ayindegraphicscreation@gmail.com", "Ayindecodes", 90000001, "owner"),
    ("Mariette Talya", "mariette@example.com", "mtalya", 90000002, "admin"),
    ("Chidi Okafor", "chidi@example.com", "chidiok", 90000003, "developer"),
    ("Lena Fischer", "lena@example.com", "lfischer", 90000004, "reviewer"),
    ("Sam Rivera", "sam@example.com", "samrivera", 90000005, None),
)

# The organization's repositories, the same ones the dev API seeds: id, name,
# private, pushed minutes ago, status, message, and whether it has been
# indexed. What indexing found is not written here: the seed indexes them.
REPOSITORIES: tuple[tuple[int, str, bool, int, str, str | None, bool], ...] = (
    (811001, "forgemind/api", True, 30, "connected", None, True),
    (811002, "forgemind/web", False, 90, "connected", None, True),
    (811003, "forgemind/workers", True, 300, "connected", None, True),
    (
        811004,
        "acme/payments",
        True,
        2 * 1440,
        "error",
        "The GitHub App installation was suspended by the organization owner.",
        True,
    ),
    (811005, "acme/legacy-portal", True, 60 * 1440, "revoked", "Access revoked", False),
)

# Fixed tokens the interface's tests sign in with. Only their hashes are stored.
DEV_TOKENS: tuple[tuple[str, str, int], ...] = (
    # token, email, days until expiry (negative: already expired)
    ("dev-owner", "ayindegraphicscreation@gmail.com", 365),
    ("dev-reviewer", "lena@example.com", 365),
    ("dev-new", "sam@example.com", 365),
    ("dev-expired", "ayindegraphicscreation@gmail.com", -1),
)


@functools.cache
def indexed(full_name: str, workspace_root: str | None) -> tuple[str, Inspection]:
    """The commit the simulated repository is at and what inspecting it
    finds. Cloned and inspected once per process: neither changes."""
    github = SimulatedGitHub(
        "", "", lambda installation_id: ACCOUNT, workspace_root=workspace_root
    )
    try:
        with (
            github.clone_access(INSTALLATION, full_name) as source,
            workspace.checkout(
                source, branch="main", root=workspace_root
            ) as checked_out,
        ):
            return checked_out.commit, inspect_tree(checked_out.path)
    except RepositoryUnavailable as unavailable:
        raise SettingsError(
            f"the seed could not index {full_name}: {unavailable.reason}"
        ) from None


def seed(engine: Engine, settings: Settings) -> None:
    if settings.environment not in ("development", "test"):
        raise SettingsError(
            f"the seed is for development and test, not {settings.environment}"
        )
    assert {p.login for p in PERSONAS} <= {login for _, _, login, _, _ in PEOPLE}
    with DbSession(engine) as db, db.begin():
        org = db.scalars(
            select(Organization).where(Organization.slug == "ayinde-creations")
        ).first()
        if org is None:
            org = Organization(
                name="Ayinde Creations", slug="ayinde-creations", plan="team"
            )
            db.add(org)
            db.flush()
        users: dict[str, User] = {}
        for name, email, login, github_id, role in PEOPLE:
            user = db.scalars(select(User).where(User.email == email)).first()
            if user is None:
                user = User(email=email, name=name)
                db.add(user)
            user.name = name
            user.github_login = login
            user.github_user_id = github_id
            db.flush()
            users[email] = user
            if role is not None:
                member = db.get(OrganizationMember, (org.id, user.id))
                if member is None:
                    db.add(
                        OrganizationMember(
                            organization_id=org.id, user_id=user.id, role=role
                        )
                    )
                else:
                    member.role = role
        installation = db.scalars(
            select(GitHubInstallation).where(
                GitHubInstallation.organization_id == org.id
            )
        ).first()
        if installation is None:
            installation = GitHubInstallation(
                organization_id=org.id,
                installation_id=INSTALLATION,
                account_login=ACCOUNT,
                account_type="organization",
                repository_selection="selected",
                permissions=list(APP_PERMISSIONS),
            )
            db.add(installation)
            db.flush()
        base = datetime.now(UTC)
        for (
            github_id,
            full_name,
            private,
            pushed,
            status,
            message,
            was_indexed,
        ) in REPOSITORIES:
            repo = db.scalars(
                select(Repository).where(
                    Repository.organization_id == org.id,
                    Repository.github_id == github_id,
                )
            ).first()
            if repo is None:
                repo = Repository(
                    organization_id=org.id,
                    installation_id=installation.id,
                    github_id=github_id,
                    full_name=full_name,
                    private=private,
                    default_branch="main",
                    url=f"https://github.com/{full_name}",
                    status=status,
                    connected_at=base - timedelta(days=30),
                )
                db.add(repo)
                db.flush()
            repo.status = status
            repo.status_message = message
            repo.pushed_at = base - timedelta(minutes=pushed)
            repo.revoked_at = base - timedelta(days=5) if status == "revoked" else None
            repo.index_attempts = 0
            repo.index_dispatched_at = None
            repo.index_worker_id = None
            repo.index_heartbeat_at = None
            if was_indexed:
                commit, inspection = indexed(full_name, settings.workspace_root)
                record_analysis(db, repo, commit, inspection, base)
            else:
                repo.languages = []
                repo.last_analyzed_commit = None
                repo.last_analyzed_at = None
        for token, email, days in DEV_TOKENS:
            session = db.scalars(
                select(Session).where(Session.token_hash == token_hash(token))
            ).first()
            expires = datetime.now(UTC) + timedelta(days=days)
            if session is None:
                db.add(
                    Session(
                        token_hash=token_hash(token),
                        user_id=users[email].id,
                        expires_at=expires,
                    )
                )
            else:
                session.user_id = users[email].id
                session.expires_at = expires
                session.revoked_at = None
