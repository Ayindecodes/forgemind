"""Sessions: who is signed in, for how long, and the GitHub sign-in that
creates them. Only a hash of the session token is ever stored."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.errors import ApiFailure, unauthorized
from forgemind_api.github import GitHubIdentity, GitHubProvider
from forgemind_api.models import (
    OrganizationMember,
    Session,
    SignInState,
    User,
)
from forgemind_api.schemas import SessionOut, UserOut

SESSION_COOKIE = "fm_session"
STATE_MINUTES = 10


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Principal:
    """The signed-in person and the organization the session acts in."""

    session: Session
    user: User
    organization_id: str | None
    role: str | None

    def out(self) -> SessionOut:
        return SessionOut(
            user=UserOut(
                id=str(self.user.id),
                email=self.user.email,
                name=self.user.name,
                avatar_url=self.user.avatar_url,
                github_login=self.user.github_login,
                created_at=self.user.created_at,
            ),
            organization_id=self.organization_id,
            role=self.role,  # type: ignore[arg-type]
            expires_at=self.session.expires_at,
        )


def membership_of(db: DbSession, user: User) -> OrganizationMember | None:
    """The organization the person acts in: the one they joined first."""
    return db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == user.id)
        .order_by(OrganizationMember.joined_at)
        .limit(1)
    ).first()


def principal_for_token(db: DbSession, token: str | None) -> Principal:
    if not token:
        raise unauthorized("signed_out")
    session = db.scalars(
        select(Session).where(Session.token_hash == token_hash(token))
    ).first()
    if session is None or session.revoked_at is not None:
        raise unauthorized("signed_out")
    if session.expires_at <= now():
        raise unauthorized("expired")
    user = db.get(User, session.user_id)
    if user is None or user.status != "active":
        raise unauthorized("signed_out")
    membership = membership_of(db, user)
    session.last_seen_at = now()
    return Principal(
        session=session,
        user=user,
        organization_id=str(membership.organization_id) if membership else None,
        role=membership.role if membership else None,
    )


def start_sign_in(db: DbSession, next_path: str | None) -> str:
    """Records a sign-in attempt and returns the state GitHub must echo back."""
    state = secrets.token_urlsafe(24)
    db.add(
        SignInState(
            state=state,
            next=next_path,
            expires_at=now() + timedelta(minutes=STATE_MINUTES),
        )
    )
    db.flush()
    return state


def upsert_user(db: DbSession, identity: GitHubIdentity) -> User:
    user = db.scalars(
        select(User).where(User.github_user_id == identity.github_user_id)
    ).first()
    if user is None:
        user = db.scalars(select(User).where(User.email.ilike(identity.email))).first()
    if user is None:
        user = User(email=identity.email, name=identity.name)
        db.add(user)
    user.github_user_id = identity.github_user_id
    user.github_login = identity.login
    user.name = identity.name
    user.avatar_url = identity.avatar_url
    db.flush()
    return user


def complete_sign_in(
    db: DbSession,
    provider: GitHubProvider,
    code: str,
    state: str,
    session_days: int,
) -> tuple[str, Principal, str | None]:
    """Turns GitHub's code into a session. Returns the token, who is signed
    in, and where they were going."""
    pending = db.get(SignInState, state)
    if pending is None or pending.used_at is not None or pending.expires_at <= now():
        raise ApiFailure("invalid", "The sign-in could not be completed. Try again.")
    pending.used_at = now()
    identity = provider.identity_for_code(code, state)
    user = upsert_user(db, identity)
    token = secrets.token_urlsafe(32)
    session = Session(
        token_hash=token_hash(token),
        user_id=user.id,
        expires_at=now() + timedelta(days=session_days),
    )
    db.add(session)
    db.flush()
    return token, principal_for_token(db, token), pending.next


def sign_out(db: DbSession, token: str | None) -> None:
    if not token:
        return
    session = db.scalars(
        select(Session).where(Session.token_hash == token_hash(token))
    ).first()
    if session is not None and session.revoked_at is None:
        session.revoked_at = now()
