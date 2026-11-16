"""The findings on an organization's repositories."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from forgemind_api import findings as service
from forgemind_api.deps import Current, Db
from forgemind_api.models import SecurityFinding
from forgemind_api.organizations import require_org
from forgemind_api.schemas import (
    CodeReferenceOut,
    FindingOut,
    FindingPageOut,
    FindingStatus,
    Severity,
)

router = APIRouter(tags=["findings"])


def finding_out(finding: SecurityFinding) -> FindingOut:
    return FindingOut(
        id=str(finding.id),
        repository_id=str(finding.repository_id),
        run_id=str(finding.run_id) if finding.run_id else None,
        title=finding.title,
        severity=finding.severity,  # type: ignore[arg-type]
        confidence=finding.confidence,  # type: ignore[arg-type]
        category=finding.category,  # type: ignore[arg-type]
        commit=finding.commit,
        location=CodeReferenceOut(path=finding.path, line=finding.line),
        evidence=finding.evidence,
        remediation=finding.remediation,
        advisory_url=finding.advisory_url,
        tool=finding.tool,
        status=finding.status,  # type: ignore[arg-type]
        fixed_commit=finding.fixed_commit,
        detected_at=finding.detected_at,
    )


@router.get("/findings", response_model=FindingPageOut)
def list_findings(
    db: Db,
    current: Current,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    repository_id: Annotated[str | None, Query(alias="repositoryId")] = None,
    severity: Annotated[Severity | None, Query()] = None,
    status: Annotated[FindingStatus | None, Query()] = None,
) -> FindingPageOut:
    rows, next_cursor = service.findings_page(
        db, require_org(current), cursor, limit, repository_id, severity, status
    )
    return FindingPageOut(
        items=[finding_out(row) for row in rows], next_cursor=next_cursor
    )
