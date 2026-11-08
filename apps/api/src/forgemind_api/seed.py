"""A known organization, its people and fixed session tokens for development
and tests. Refuses to run anywhere else. Safe to run again: it updates."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import token_hash
from forgemind_api.github import APP_PERMISSIONS, PERSONAS
from forgemind_api.models import (
    GitHubInstallation,
    Organization,
    OrganizationMember,
    Repository,
    Session,
    User,
)
from forgemind_api.settings import Settings, SettingsError

PEOPLE: tuple[tuple[str, str, str, int | None, str | None], ...] = (
    # name, email, github login, github id, role in the organization
    ("Ayinde", "ayindegraphicscreation@gmail.com", "Ayindecodes", 90000001, "owner"),
    ("Mariette Talya", "mariette@example.com", "mtalya", 90000002, "admin"),
    ("Chidi Okafor", "chidi@example.com", "chidiok", 90000003, "developer"),
    ("Lena Fischer", "lena@example.com", "lfischer", 90000004, "reviewer"),
    ("Sam Rivera", "sam@example.com", "samrivera", 90000005, None),
)

# The organization's repositories as the dev API seeds them: id, name,
# private, languages, pushed minutes ago, status, message, commit, analysed
# minutes ago.
REPOSITORIES: tuple[
    tuple[
        int,
        str,
        bool,
        tuple[tuple[str, float], ...],
        int,
        str,
        str | None,
        str | None,
        int | None,
    ],
    ...,
] = (
    (
        811001,
        "forgemind/api",
        True,
        (("TypeScript", 0.88), ("SQL", 0.07), ("Shell", 0.05)),
        30,
        "connected",
        None,
        "a1b2c3d",
        46,
    ),
    (
        811002,
        "forgemind/web",
        False,
        (("TypeScript", 0.94), ("CSS", 0.06)),
        90,
        "connected",
        None,
        "b1bb32f",
        46,
    ),
    (
        811003,
        "forgemind/workers",
        True,
        (("Python", 0.76), ("Dockerfile", 0.14), ("Shell", 0.1)),
        300,
        "connected",
        None,
        "9e8d7c6",
        46,
    ),
    (
        811004,
        "acme/payments",
        True,
        (("Go", 0.81), ("HCL", 0.19)),
        2 * 1440,
        "error",
        "The GitHub App installation was suspended by the organization owner.",
        "5a4b3c2",
        3 * 1440,
    ),
    (
        811005,
        "acme/legacy-portal",
        True,
        (("PHP", 0.9), ("JavaScript", 0.1)),
        60 * 1440,
        "revoked",
        "Access revoked",
        None,
        None,
    ),
)

# Fixed tokens the interface's tests sign in with. Only their hashes are stored.
DEV_TOKENS: tuple[tuple[str, str, int], ...] = (
    # token, email, days until expiry (negative: already expired)
    ("dev-owner", "ayindegraphicscreation@gmail.com", 365),
    ("dev-reviewer", "lena@example.com", 365),
    ("dev-new", "sam@example.com", 365),
    ("dev-expired", "ayindegraphicscreation@gmail.com", -1),
)


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
                installation_id=1001,
                account_login="forgemind",
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
            languages,
            pushed,
            status,
            message,
            commit,
            analyzed,
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
            repo.status = status
            repo.status_message = message
            repo.languages = [
                {"name": name, "share": share} for name, share in languages
            ]
            repo.pushed_at = base - timedelta(minutes=pushed)
            repo.last_analyzed_commit = commit
            repo.last_analyzed_at = (
                base - timedelta(minutes=analyzed) if analyzed else None
            )
            repo.revoked_at = base - timedelta(days=5) if status == "revoked" else None
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
