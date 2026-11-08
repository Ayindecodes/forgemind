"""Organizations, who belongs to them with which role, and the audit trail.

Every function takes the organization from the signed-in person, never from
the request, so one organization can neither read nor change another's data.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import Principal, now
from forgemind_api.errors import ApiFailure
from forgemind_api.models import (
    AuditEvent,
    Organization,
    OrganizationMember,
    Session,
    User,
)

ROLES = ("owner", "admin", "developer", "reviewer", "viewer")
MANAGERS = ("owner", "admin")


def require_org(principal: Principal) -> uuid.UUID:
    if principal.organization_id is None:
        raise ApiFailure("forbidden", "Create an organization first")
    return uuid.UUID(principal.organization_id)


def require_role(principal: Principal, roles: Sequence[str]) -> None:
    if principal.role not in roles:
        raise ApiFailure("forbidden", f"This needs the {' or '.join(roles)} role")


def audit(
    db: DbSession,
    organization_id: uuid.UUID,
    actor: User,
    action: str,
    target_type: str,
    target_id: str,
    target_label: str,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        organization_id=organization_id,
        actor_id=actor.id,
        actor_name=actor.name,
        action=action,
        target_type=target_type,
        target_id=target_id,
        target_label=target_label,
        details=details,
        at=now(),
    )
    db.add(event)
    db.flush()
    return event


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "organization"


def free_slug(db: DbSession, wanted: str) -> str:
    """`wanted`, or `wanted-2`, `wanted-3`... when it is taken."""
    taken = set(
        db.scalars(
            select(Organization.slug).where(Organization.slug.like(f"{wanted}%"))
        ).all()
    )
    if wanted not in taken:
        return wanted
    suffix = 2
    while f"{wanted}-{suffix}" in taken:
        suffix += 1
    return f"{wanted}-{suffix}"


def create_organization(db: DbSession, principal: Principal, name: str) -> Organization:
    if principal.organization_id is not None:
        raise ApiFailure("conflict", "You already belong to an organization")
    organization = Organization(
        name=name, slug=free_slug(db, slugify(name)), plan="free"
    )
    db.add(organization)
    db.flush()
    db.add(
        OrganizationMember(
            organization_id=organization.id, user_id=principal.user.id, role="owner"
        )
    )
    db.flush()
    audit(
        db,
        organization.id,
        principal.user,
        "organization.created",
        "organization",
        str(organization.id),
        name,
    )
    return organization


def members(
    db: DbSession, organization_id: uuid.UUID
) -> list[tuple[User, OrganizationMember]]:
    rows = db.execute(
        select(User, OrganizationMember)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == organization_id)
        .order_by(OrganizationMember.joined_at, User.name)
    ).all()
    return [(user, member) for user, member in rows]


def member_of(
    db: DbSession, organization_id: uuid.UUID, user_id: str
) -> tuple[User, OrganizationMember]:
    try:
        parsed = uuid.UUID(user_id)
    except ValueError:
        raise ApiFailure("not_found", "No such member") from None
    row = db.execute(
        select(User, OrganizationMember)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == parsed,
        )
    ).first()
    if row is None:
        raise ApiFailure("not_found", "No such member")
    return row[0], row[1]


def owners(db: DbSession, organization_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.role == "owner",
            )
        )
        or 0
    )


def invite_member(
    db: DbSession, principal: Principal, email: str, name: str, role: str
) -> tuple[User, OrganizationMember]:
    organization_id = require_org(principal)
    require_role(principal, MANAGERS)
    if role == "owner" and principal.role != "owner":
        raise ApiFailure("forbidden", "Only an owner can add an owner")
    user = db.scalars(
        select(User).where(func.lower(User.email) == email.lower())
    ).first()
    if user is not None and db.get(OrganizationMember, (organization_id, user.id)):
        raise ApiFailure("conflict", f"{email} is already a member")
    if user is None:
        user = User(email=email, name=name)
        db.add(user)
        db.flush()
    member = OrganizationMember(
        organization_id=organization_id, user_id=user.id, role=role
    )
    db.add(member)
    db.flush()
    db.refresh(member)
    audit(
        db,
        organization_id,
        principal.user,
        "member.invited",
        "user",
        str(user.id),
        user.name,
    )
    return user, member


def update_member_role(
    db: DbSession, principal: Principal, user_id: str, role: str
) -> tuple[User, OrganizationMember]:
    organization_id = require_org(principal)
    require_role(principal, MANAGERS)
    user, member = member_of(db, organization_id, user_id)
    if (member.role == "owner" or role == "owner") and principal.role != "owner":
        raise ApiFailure(
            "forbidden", "Only an owner can change who owns the organization"
        )
    if member.role == "owner" and role != "owner" and owners(db, organization_id) == 1:
        raise ApiFailure("conflict", "The organization needs at least one owner")
    member.role = role
    db.flush()
    audit(
        db,
        organization_id,
        principal.user,
        "member.role_changed",
        "user",
        str(user.id),
        f"{user.name}: {role}",
    )
    return user, member


def remove_member(db: DbSession, principal: Principal, user_id: str) -> None:
    organization_id = require_org(principal)
    require_role(principal, MANAGERS)
    user, member = member_of(db, organization_id, user_id)
    if member.role == "owner" and principal.role != "owner":
        raise ApiFailure("forbidden", "Only an owner can remove an owner")
    if member.role == "owner" and owners(db, organization_id) == 1:
        raise ApiFailure("conflict", "The organization needs at least one owner")
    db.delete(member)
    # Their sessions stop working at once.
    for session in db.scalars(
        select(Session).where(Session.user_id == user.id, Session.revoked_at.is_(None))
    ):
        session.revoked_at = now()
    db.flush()
    audit(
        db,
        organization_id,
        principal.user,
        "member.removed",
        "user",
        str(user.id),
        user.name,
    )


def audit_page(
    db: DbSession, organization_id: uuid.UUID, cursor: str | None, limit: int
) -> tuple[list[AuditEvent], str | None]:
    """Newest first. The cursor is an offset, the way the dev API pages."""
    try:
        offset = int(cursor) if cursor else 0
    except ValueError:
        raise ApiFailure("invalid", "Invalid cursor") from None
    if offset < 0:
        raise ApiFailure("invalid", "Invalid cursor")
    rows = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.organization_id == organization_id)
        .order_by(AuditEvent.at.desc(), AuditEvent.id.desc())
        .offset(offset)
        .limit(limit + 1)
    ).all()
    page = list(rows[:limit])
    next_cursor = str(offset + limit) if len(rows) > limit else None
    return page, next_cursor
