"""What the organization has used."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from forgemind_api.deps import Config, Current, Db
from forgemind_api.organizations import require_org
from forgemind_api.usage import usage_summary

router = APIRouter(tags=["usage"])


@router.get("/usage")
def usage(db: Db, current: Current, settings: Config) -> dict[str, Any]:
    return usage_summary(db, require_org(current), settings.prices)
