"""What the organization should hear about, and marking it heard."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import Field

from forgemind_api import execution as service
from forgemind_api.deps import Current, Db
from forgemind_api.organizations import require_org
from forgemind_api.schemas import OkOut, Wire

router = APIRouter(tags=["notifications"])


class MarkReadIn(Wire):
    ids: list[str] = Field(min_length=1)


@router.get("/notifications")
def notifications(db: Db, current: Current) -> list[dict[str, Any]]:
    return [
        service.notification_json(note)
        for note in service.notifications(db, require_org(current))
    ]


@router.post("/notifications/read", response_model=OkOut)
def mark_notifications_read(body: MarkReadIn, db: Db, current: Current) -> OkOut:
    service.mark_notifications_read(db, require_org(current), body.ids)
    return OkOut()
