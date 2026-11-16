"""The findings on an organization's repositories, kept up to date with what
each scan raises.

A finding is one row from the first scan that raises it to the last: found
again, it is the same finding, at the commit and line it was found at last. A
scan that no longer finds it closes it at the commit that scan read, unless
the scan could not speak for where it was. Dismissed, it stays dismissed.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.models import Repository, SecurityFinding
from forgemind_api.scanning import Scanned, fingerprint


def record_findings(
    db: DbSession,
    repo: Repository,
    commit: str,
    scans: tuple[Scanned, ...],
    at: datetime,
) -> dict[str, int]:
    """Brings the repository's findings up to date with what was raised at
    `commit`. Returns how many were raised for the first time, found again,
    and closed."""
    counts = {"raised": 0, "found_again": 0, "closed": 0}
    for scanned in scans:
        known = {
            finding.fingerprint: finding
            for finding in db.scalars(
                select(SecurityFinding)
                .where(
                    SecurityFinding.repository_id == repo.id,
                    SecurityFinding.tool == scanned.tool,
                    SecurityFinding.fingerprint.is_not(None),
                )
                .with_for_update()
            )
        }
        seen: set[str] = set()
        for raised in scanned.raised:
            mark = fingerprint(scanned.tool, raised)
            if mark in seen:
                continue
            seen.add(mark)
            finding = known.get(mark)
            if finding is None:
                finding = SecurityFinding(
                    organization_id=repo.organization_id,
                    repository_id=repo.id,
                    tool=scanned.tool,
                    rule=raised.rule,
                    fingerprint=mark,
                    status="open",
                    detected_at=at,
                )
                db.add(finding)
                counts["raised"] += 1
            else:
                counts["found_again"] += 1
                if finding.status == "fixed":
                    # It is back: the same finding, open again.
                    finding.status = "open"
                    finding.fixed_at = None
                    finding.fixed_commit = None
            finding.title = raised.title
            finding.severity = raised.severity
            finding.confidence = raised.confidence
            finding.category = raised.category
            finding.commit = commit
            finding.path = raised.path
            finding.line = raised.line
            finding.evidence = raised.evidence
            finding.remediation = raised.remediation
            finding.advisory_url = raised.advisory_url
        if scanned.cut_short:
            # It did not reach the end, so it cannot say what is gone.
            continue
        for mark, finding in known.items():
            if (
                mark not in seen
                and finding.status == "open"
                and finding.path not in scanned.unread
            ):
                finding.status = "fixed"
                finding.fixed_at = at
                finding.fixed_commit = commit
                counts["closed"] += 1
    db.flush()
    return counts
