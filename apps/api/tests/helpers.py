"""People and sessions created straight in the database, for tests."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import Engine, select, update
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import token_hash
from forgemind_api.models import Session, User


def session_for(engine: Engine, email: str) -> dict[str, str]:
    """A cookie for an existing person."""
    token = f"test-{uuid.uuid4().hex}"
    with DbSession(engine) as db, db.begin():
        user = db.scalars(select(User).where(User.email == email)).one()
        db.add(
            Session(
                token_hash=token_hash(token),
                user_id=user.id,
                expires_at=datetime.now(UTC) + timedelta(days=1),
            )
        )
    return {"cookie": f"fm_session={token}"}


def newcomer(
    engine: Engine, name: str, github_login: str | None = None
) -> dict[str, str]:
    """A person with no organization at all, signed in. With a GitHub login the
    simulated GitHub knows, they can install the App."""
    email = f"{uuid.uuid4().hex[:8]}@example.com"
    with DbSession(engine) as db, db.begin():
        db.add(User(email=email, name=name))
    if github_login:
        with DbSession(engine) as db, db.begin():
            db.execute(
                update(User)
                .where(User.email == email)
                .values(github_login=github_login)
            )
    return session_for(engine, email)
