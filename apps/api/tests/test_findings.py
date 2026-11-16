"""Findings kept up to date with each scan of a repository, and the
organization's list of them."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from forgemind_api.app import create_app
from forgemind_api.credentials import TOOL
from forgemind_api.findings import record_findings
from forgemind_api.models import Organization, Repository, SecurityFinding
from forgemind_api.scanning import Raised, Scanned, Severity
from forgemind_api.seed import seed
from forgemind_api.settings import Settings
from tests.helpers import newcomer

OWNER = {"cookie": "fm_session=dev-owner"}
WEB = "http://localhost:3200"
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


# --- the organization's list


@pytest.fixture(scope="module")
def app(database_url: str, engine: Engine) -> Iterator[FastAPI]:
    settings = Settings(environment="test", database_url=database_url, web_origin=WEB)
    seed(engine, settings)
    app = create_app(settings)
    yield app
    app.state.engine.dispose()


@pytest.fixture(scope="module")
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def repositories(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    items: list[dict[str, Any]] = client.get(
        "/repositories", params={"limit": 200}, headers=headers
    ).json()["items"]
    return {repo["fullName"]: repo for repo in items}


def findings(
    client: TestClient, headers: dict[str, str], **query: Any
) -> list[dict[str, Any]]:
    response = client.get("/findings", params={"limit": 200, **query}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["nextCursor"] is None
    items: list[dict[str, Any]] = response.json()["items"]
    return items


def organization_of(client: TestClient, headers: dict[str, str]) -> uuid.UUID:
    return uuid.UUID(client.get("/organization", headers=headers).json()["id"])


def stored_finding(
    db: Session,
    repo: Repository,
    title: str,
    severity: str,
    detected_at: datetime,
    status: str = "open",
) -> None:
    db.add(
        SecurityFinding(
            organization_id=repo.organization_id,
            repository_id=repo.id,
            title=title,
            severity=severity,
            confidence="confirmed",
            category="exposed_credential",
            commit=FIRST,
            path="key.pem",
            line=1,
            tool=TOOL,
            status=status,
            detected_at=detected_at,
            fixed_commit=SECOND if status == "fixed" else None,
        )
    )


@pytest.fixture(scope="module")
def chen(client: TestClient, engine: Engine) -> tuple[dict[str, str], dict[str, str]]:
    """Another organization, with two repositories and five findings on them.
    Returns its member's cookie and its repositories' ids by name."""
    riley = newcomer(engine, "Riley Chen")
    assert (
        client.post(
            "/organization", json={"name": "Chen Works"}, headers=riley
        ).status_code
        == 201
    )
    organization_id = organization_of(client, riley)
    with Session(engine) as db, db.begin():
        one = add_repository(db, organization_id, "chen/one")
        two = add_repository(db, organization_id, "chen/two")
        stored_finding(db, one, "low", "low", AT + timedelta(hours=3))
        stored_finding(db, one, "critical", "critical", AT)
        stored_finding(db, two, "older high", "high", AT + timedelta(hours=1))
        stored_finding(db, one, "newer high", "high", AT + timedelta(hours=2))
        stored_finding(db, two, "medium", "medium", AT, status="fixed")
        ids = {"chen/one": str(one.id), "chen/two": str(two.id)}
    return riley, ids


def titles(items: list[dict[str, Any]]) -> list[str]:
    return [item["title"] for item in items]


def test_findings_come_most_severe_first_then_most_recent(
    client: TestClient, chen: tuple[dict[str, str], dict[str, str]]
) -> None:
    riley, _ = chen
    assert titles(findings(client, riley)) == [
        "critical",
        "newer high",
        "older high",
        "medium",
        "low",
    ]


def test_findings_are_paged(
    client: TestClient, chen: tuple[dict[str, str], dict[str, str]]
) -> None:
    riley, _ = chen
    pages: list[list[str]] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        page = client.get("/findings", params=params, headers=riley).json()
        pages.append(titles(page["items"]))
        cursor = page["nextCursor"]
        if cursor is None:
            break
        assert len(pages) < 5
    assert pages == [["critical", "newer high"], ["older high", "medium"], ["low"]]


def test_findings_are_filtered_by_repository_severity_and_status(
    client: TestClient, chen: tuple[dict[str, str], dict[str, str]]
) -> None:
    riley, ids = chen
    assert titles(findings(client, riley, repositoryId=ids["chen/one"])) == [
        "critical",
        "newer high",
        "low",
    ]
    assert titles(findings(client, riley, severity="high")) == [
        "newer high",
        "older high",
    ]
    fixed = findings(client, riley, status="fixed")
    assert titles(fixed) == ["medium"]
    assert (fixed[0]["commit"], fixed[0]["fixedCommit"]) == (FIRST, SECOND)
    assert titles(
        findings(client, riley, repositoryId=ids["chen/two"], status="open")
    ) == ["older high"]
    # No repository of that name is no repository of theirs.
    assert findings(client, riley, repositoryId="nope") == []


@pytest.mark.parametrize(
    "query",
    [
        {"cursor": "next"},
        {"cursor": "-1"},
        {"limit": 0},
        {"limit": 201},
        {"severity": "dire"},
        {"status": "closed"},
    ],
)
def test_a_query_the_list_cannot_answer_is_refused(
    client: TestClient, query: dict[str, Any]
) -> None:
    refused = client.get("/findings", params=query, headers=OWNER)
    assert refused.status_code == 400, refused.text
    assert refused.json()["error"]["code"] == "invalid"


def test_one_organization_never_sees_anothers_findings(
    client: TestClient,
    engine: Engine,
    chen: tuple[dict[str, str], dict[str, str]],
) -> None:
    riley, ids = chen
    workers = repositories(client, OWNER)["forgemind/workers"]
    theirs = findings(client, riley)
    ours = findings(client, OWNER)
    assert len(theirs) == 5
    assert {item["repositoryId"] for item in theirs} == set(ids.values())
    assert not {item["id"] for item in theirs} & {item["id"] for item in ours}
    assert findings(client, riley, repositoryId=workers["id"]) == []
    assert findings(client, OWNER, repositoryId=ids["chen/one"]) == []
    assert client.get("/findings").status_code == 401
    nobody = newcomer(engine, "No Organization")
    assert client.get("/findings", headers=nobody).status_code == 403


def test_a_disconnected_repositorys_findings_are_neither_listed_nor_counted(
    client: TestClient,
    engine: Engine,
    chen: tuple[dict[str, str], dict[str, str]],
) -> None:
    riley, ids = chen
    two = uuid.UUID(ids["chen/two"])
    with Session(engine) as db, db.begin():
        db.get_one(Repository, two).status = "revoked"
    try:
        assert titles(findings(client, riley)) == ["critical", "newer high", "low"]
        assert findings(client, riley, repositoryId=str(two)) == []
        revoked = client.get(f"/repositories/{two}", headers=riley).json()
        assert (revoked["status"], revoked["openFindings"]) == ("revoked", 0)
    finally:
        with Session(engine) as db, db.begin():
            db.get_one(Repository, two).status = "connected"
    assert client.get(f"/repositories/{two}", headers=riley).json()["openFindings"] == 1
