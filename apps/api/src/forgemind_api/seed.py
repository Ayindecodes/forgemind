"""A known organization, its people and fixed session tokens for development
and tests. Refuses to run anywhere else. Safe to run again: it updates."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import token_hash
from forgemind_api.github import PERSONAS
from forgemind_api.models import Organization, OrganizationMember, Session, User
from forgemind_api.settings import Settings, SettingsError

PEOPLE: tuple[tuple[str, str, str, int | None, str | None], ...] = (
    # name, email, github login, github id, role in the organization
    ("Ayinde", "ayindegraphicscreation@gmail.com", "Ayindecodes", 90000001, "owner"),
    ("Mariette Talya", "mariette@example.com", "mtalya", 90000002, "admin"),
    ("Chidi Okafor", "chidi@example.com", "chidiok", 90000003, "developer"),
    ("Lena Fischer", "lena@example.com", "lfischer", 90000004, "reviewer"),
    ("Sam Rivera", "sam@example.com", "samrivera", 90000005, None),
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
