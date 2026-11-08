"""The organization the signed-in person acts in, its members, and its audit trail."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query

from forgemind_api import organizations as service
from forgemind_api.deps import Current, Db
from forgemind_api.errors import ApiFailure
from forgemind_api.models import AuditEvent, Organization, OrganizationMember, User
from forgemind_api.schemas import (
    AuditEventOut,
    AuditPageOut,
    AuditTargetOut,
    CreateOrganizationIn,
    InviteMemberIn,
    MemberOut,
    OkOut,
    OrganizationOut,
    UpdateMemberRoleIn,
    UserOut,
)

router = APIRouter(tags=["organizations"])

# The contract names every path parameter `id`; the OpenAPI document must too.
MemberId = Annotated[str, Path(description="The member's user id")]


def organization_out(found: Organization) -> OrganizationOut:
    return OrganizationOut(
        id=str(found.id),
        name=found.name,
        slug=found.slug,
        plan=found.plan,  # type: ignore[arg-type]
        created_at=found.created_at,
    )


def member_out(user: User, member: OrganizationMember) -> MemberOut:
    return MemberOut(
        user=UserOut(
            id=str(user.id),
            email=user.email,
            name=user.name,
            avatar_url=user.avatar_url,
            github_login=user.github_login,
            created_at=user.created_at,
        ),
        role=member.role,  # type: ignore[arg-type]
        joined_at=member.joined_at,
    )


def audit_out(event: AuditEvent) -> AuditEventOut:
    return AuditEventOut(
        id=str(event.id),
        actor_id=str(event.actor_id) if event.actor_id else "deleted-user",
        actor_name=event.actor_name,
        action=event.action,
        target=AuditTargetOut(
            type=event.target_type, id=event.target_id, label=event.target_label
        ),
        at=event.at,
    )


def organization_of(db: Db, current: Current) -> Organization:
    organization_id = service.require_org(current)
    organization = db.get(Organization, organization_id)
    if organization is None:
        raise ApiFailure("not_found", "The organization no longer exists")
    return organization


@router.get("/organization", response_model=OrganizationOut)
def organization(db: Db, current: Current) -> OrganizationOut:
    return organization_out(organization_of(db, current))


@router.post("/organization", response_model=OrganizationOut, status_code=201)
def create_organization(
    body: CreateOrganizationIn, db: Db, current: Current
) -> OrganizationOut:
    return organization_out(service.create_organization(db, current, body.name))


@router.get("/organization/members", response_model=list[MemberOut])
def members(db: Db, current: Current) -> list[MemberOut]:
    organization_id = service.require_org(current)
    return [
        member_out(user, member)
        for user, member in service.members(db, organization_id)
    ]


@router.post("/organization/members", response_model=MemberOut, status_code=201)
def invite_member(body: InviteMemberIn, db: Db, current: Current) -> MemberOut:
    user, member = service.invite_member(
        db, current, str(body.email), body.name, body.role
    )
    return member_out(user, member)


@router.patch("/organization/members/{id}", response_model=MemberOut)
def update_member_role(
    id: MemberId, body: UpdateMemberRoleIn, db: Db, current: Current
) -> MemberOut:
    user, member = service.update_member_role(db, current, id, body.role)
    return member_out(user, member)


@router.delete("/organization/members/{id}", response_model=OkOut)
def remove_member(id: MemberId, db: Db, current: Current) -> OkOut:
    service.remove_member(db, current, id)
    return OkOut()


@router.get("/audit", response_model=AuditPageOut)
def audit(
    db: Db,
    current: Current,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> AuditPageOut:
    organization_id = service.require_org(current)
    events, next_cursor = service.audit_page(db, organization_id, cursor, limit)
    return AuditPageOut(
        items=[audit_out(event) for event in events], next_cursor=next_cursor
    )
