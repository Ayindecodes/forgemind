"""The organization the signed-in person acts in."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from forgemind_api.deps import Current, Db
from forgemind_api.errors import ApiFailure
from forgemind_api.models import Organization
from forgemind_api.schemas import OrganizationOut

router = APIRouter(tags=["organizations"])


def organization_of(db: Db, current: Current) -> Organization:
    if current.organization_id is None:
        raise ApiFailure("forbidden", "Create an organization first")
    organization = db.get(Organization, uuid.UUID(current.organization_id))
    if organization is None:
        raise ApiFailure("not_found", "The organization no longer exists")
    return organization


@router.get("/organization", response_model=OrganizationOut)
def organization(db: Db, current: Current) -> OrganizationOut:
    found = organization_of(db, current)
    return OrganizationOut(
        id=str(found.id),
        name=found.name,
        slug=found.slug,
        plan=found.plan,  # type: ignore[arg-type]
        created_at=found.created_at,
    )
