"""Findings kept up to date with each scan of a repository, and the
organization's list of them."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from forgemind_api.credentials import TOOL
from forgemind_api.findings import record_findings
from forgemind_api.models import Organization, Repository, SecurityFinding
from forgemind_api.scanning import Raised, Scanned, Severity

FIRST, SECOND, THIRD = "a" * 40, "b" * 40, "c" * 40
AT = datetime(2026, 11, 1, 9, tzinfo=UTC)


def raised(
    name: str = "one",
    path: str = "deploy/id.pem",
    line: int | None = 1,
    severity: Severity = "high",
) -> Raised:
    return Raised(
        rule="private-key",
        identity=f"the digest of key {name}",
        title=f"Private key {name} committed",
        severity=severity,
        confidence="confirmed",
        category="exposed_credential",
        path=path,
        line=line,
        evidence=f"Key {name} was found.",
        remediation="Replace it.",
    )


def scans(
    *found: Raised,
    tool: str = TOOL,
    unread: frozenset[str] = frozenset(),
    cut_short: bool = False,
) -> tuple[Scanned, ...]:
    return (Scanned(tool, found, unread, cut_short),)


def add_repository(db: Session, organization_id: uuid.UUID, name: str) -> Repository:
    repo = Repository(
        organization_id=organization_id,
        github_id=int(uuid.uuid4().int % 1_000_000_000),
        full_name=name,
        private=True,
        default_branch="main",
        url=f"https://github.com/{name}",
        status="connected",
    )
    db.add(repo)
    db.flush()
    return repo


@pytest.fixture
def repo(session: Session) -> Repository:
    org = Organization(name="Findings", slug=f"findings-{uuid.uuid4().hex[:6]}")
    session.add(org)
    session.flush()
    return add_repository(session, org.id, "acme/thing")


def findings_of(session: Session, repo: Repository) -> dict[str, SecurityFinding]:
    """The repository's findings by title."""
    return {
        finding.title: finding
        for finding in session.scalars(
            select(SecurityFinding).where(SecurityFinding.repository_id == repo.id)
        )
    }


def paths_of(session: Session, repo: Repository) -> list[tuple[str, str]]:
    """Where each of the repository's findings is, and whether it is open."""
    return sorted(
        (finding.path, finding.status)
        for finding in session.scalars(
            select(SecurityFinding).where(SecurityFinding.repository_id == repo.id)
        )
    )


def counts(raised: int = 0, found_again: int = 0, closed: int = 0) -> dict[str, int]:
    return {"raised": raised, "found_again": found_again, "closed": closed}


# --- kept up to date with each scan


def test_a_finding_is_raised_once_and_then_found_again_where_it_is_now(
    session: Session, repo: Repository
) -> None:
    assert record_findings(session, repo, FIRST, scans(raised(line=3)), AT) == (
        counts(raised=1)
    )
    [first] = findings_of(session, repo).values()
    assert (first.status, first.commit, first.path, first.line) == (
        "open",
        FIRST,
        "deploy/id.pem",
        3,
    )
    assert (first.organization_id, first.tool, first.rule) == (
        repo.organization_id,
        TOOL,
        "private-key",
    )
    assert first.detected_at == AT and first.fixed_commit is None
    # Further down the file at the next commit: the same finding, at the line
    # and the commit it was found at last, and raised when it was first.
    later = AT + timedelta(days=1)
    assert record_findings(session, repo, SECOND, scans(raised(line=9)), later) == (
        counts(found_again=1)
    )
    [again] = findings_of(session, repo).values()
    assert again.id == first.id
    assert (again.status, again.commit, again.line, again.detected_at) == (
        "open",
        SECOND,
        9,
        AT,
    )


def test_a_finding_no_longer_found_is_closed_at_the_commit_without_it(
    session: Session, repo: Repository
) -> None:
    both = scans(raised("one"), raised("two", path="b.pem"))
    record_findings(session, repo, FIRST, both, AT)
    later = AT + timedelta(hours=1)
    assert record_findings(
        session, repo, SECOND, scans(raised("two", path="b.pem")), later
    ) == counts(found_again=1, closed=1)
    found = findings_of(session, repo)
    gone, kept = found["Private key one committed"], found["Private key two committed"]
    # It points at where it was last found, and names the commit without it.
    assert (gone.status, gone.commit, gone.fixed_commit, gone.fixed_at) == (
        "fixed",
        FIRST,
        SECOND,
        later,
    )
    assert (kept.status, kept.commit, kept.fixed_commit) == ("open", SECOND, None)
    # Closed, it stays closed at the commit that closed it.
    assert record_findings(
        session, repo, THIRD, scans(raised("two", path="b.pem")), later
    ) == counts(found_again=1)
    assert (gone.status, gone.fixed_commit) == ("fixed", SECOND)


def test_a_finding_that_comes_back_is_the_same_one_open_again(
    session: Session, repo: Repository
) -> None:
    record_findings(session, repo, FIRST, scans(raised()), AT)
    record_findings(session, repo, SECOND, scans(), AT)
    assert record_findings(session, repo, THIRD, scans(raised(line=5)), AT) == (
        counts(found_again=1)
    )
    [back] = findings_of(session, repo).values()
    assert (back.status, back.commit, back.line) == ("open", THIRD, 5)
    assert back.fixed_commit is None and back.fixed_at is None


def test_a_dismissed_finding_stays_dismissed(
    session: Session, repo: Repository
) -> None:
    record_findings(session, repo, FIRST, scans(raised()), AT)
    [finding] = findings_of(session, repo).values()
    finding.status = "dismissed"
    record_findings(session, repo, SECOND, scans(raised(line=2)), AT)
    assert (finding.status, finding.commit, finding.line) == ("dismissed", SECOND, 2)
    assert record_findings(session, repo, THIRD, scans(), AT) == counts()
    assert (finding.status, finding.fixed_commit) == ("dismissed", None)


def test_a_key_moved_to_another_file_is_found_there_and_closed_where_it_was(
    session: Session, repo: Repository
) -> None:
    record_findings(session, repo, FIRST, scans(raised(path="old.pem")), AT)
    [old] = findings_of(session, repo).values()
    assert record_findings(
        session, repo, SECOND, scans(raised(path="new.pem")), AT
    ) == counts(raised=1, closed=1)
    assert (old.path, old.status, old.fixed_commit) == ("old.pem", "fixed", SECOND)
    assert paths_of(session, repo) == [("new.pem", "open"), ("old.pem", "fixed")]


def test_nothing_is_closed_in_a_file_the_scan_could_not_read(
    session: Session, repo: Repository
) -> None:
    record_findings(
        session, repo, FIRST, scans(raised("one"), raised("two", path="b.pem")), AT
    )
    assert record_findings(
        session, repo, SECOND, scans(unread=frozenset({"deploy/id.pem"})), AT
    ) == counts(closed=1)
    found = findings_of(session, repo)
    unread = found["Private key one committed"]
    assert (unread.status, unread.commit) == ("open", FIRST)
    assert found["Private key two committed"].status == "fixed"


def test_a_scan_that_stopped_early_closes_nothing(
    session: Session, repo: Repository
) -> None:
    record_findings(
        session, repo, FIRST, scans(raised("one"), raised("two", path="b.pem")), AT
    )
    assert record_findings(
        session, repo, SECOND, scans(raised("two", path="b.pem"), cut_short=True), AT
    ) == counts(found_again=1)
    found = findings_of(session, repo)
    left = found["Private key one committed"]
    assert (left.status, left.commit) == ("open", FIRST)
    assert found["Private key two committed"].commit == SECOND


def test_the_same_thing_raised_twice_in_one_scan_is_one_finding(
    session: Session, repo: Repository
) -> None:
    assert record_findings(
        session, repo, FIRST, scans(raised(line=1), raised(line=40)), AT
    ) == counts(raised=1)
    [finding] = findings_of(session, repo).values()
    assert finding.line == 1


def test_a_scanner_speaks_only_for_what_it_raised(
    session: Session, repo: Repository
) -> None:
    record_findings(session, repo, FIRST, scans(raised(), tool="another-scan"), AT)
    assert record_findings(session, repo, SECOND, scans(), AT) == counts()
    [theirs] = findings_of(session, repo).values()
    assert (theirs.tool, theirs.status) == ("another-scan", "open")


def test_the_same_key_in_two_repositories_is_two_findings(
    session: Session, repo: Repository
) -> None:
    other = add_repository(session, repo.organization_id, "acme/other")
    record_findings(session, repo, FIRST, scans(raised()), AT)
    record_findings(session, other, FIRST, scans(raised()), AT)
    record_findings(session, other, SECOND, scans(), AT)
    [ours] = findings_of(session, repo).values()
    [theirs] = findings_of(session, other).values()
    assert ours.id != theirs.id
    assert (ours.status, theirs.status) == ("open", "fixed")
