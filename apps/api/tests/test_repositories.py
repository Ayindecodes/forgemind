"""The GitHub App installation, the repositories it can see, connecting and
revoking them, webhooks, and one organization never seeing another's."""

import hashlib
import hmac
import json
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from forgemind_api.app import create_app
from forgemind_api.github import LOCAL_IDS
from forgemind_api.indexing import INDEXING, index_repository
from forgemind_api.repositories import INACCESSIBLE, SUSPENDED
from forgemind_api.seed import seed
from forgemind_api.settings import Settings
from tests.gitrepos import ENVIRONMENT, repository
from tests.helpers import newcomer, session_for
from tests.test_simulated_repositories import API_COMMIT, FOUND

OWNER = {"cookie": "fm_session=dev-owner"}
REVIEWER = {"cookie": "fm_session=dev-reviewer"}
WEB = "http://localhost:3200"
SECRET = "hook-secret"
# The seeded organization's repositories, most recently pushed first.
SEEDED = (
    "forgemind/api",
    "forgemind/web",
    "forgemind/workers",
    "acme/payments",
    "acme/legacy-portal",
)


@pytest.fixture(scope="module")
def app(database_url: str, engine: Engine) -> Iterator[FastAPI]:
    """The API with no queue: a repository connected through it waits."""
    settings = Settings(
        environment="test",
        database_url=database_url,
        web_origin=WEB,
        github_webhook_secret=SECRET,
    )
    seed(engine, settings)
    app = create_app(settings)
    yield app
    app.state.engine.dispose()


@pytest.fixture(scope="module")
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def install(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    """Runs the simulated installation flow and returns the installation."""
    started = client.post("/github/install/start", headers=headers)
    assert started.status_code == 200, started.text
    state = started.json()["state"]
    page = client.get("/auth/github/install", params={"state": state})
    assert page.status_code == 200
    assert 'role="note"' in page.text and "Install ForgeMind on" in page.text
    assert "Never the default branch" in page.text
    hop = client.get(
        "/auth/github/install/continue", params={"state": state}, follow_redirects=False
    )
    assert hop.status_code == 302
    location = urlparse(hop.headers["location"])
    assert location.path == "/auth/github/installed"
    query = parse_qs(location.query)
    done = client.post(
        "/github/install/callback",
        json={"installationId": query["installation_id"][0], "state": state},
        headers=headers,
    )
    assert done.status_code == 201, done.text
    body: dict[str, Any] = done.json()
    return body


def connect(
    client: TestClient, headers: dict[str, str], github_id: int, full_name: str
) -> dict[str, Any]:
    response = client.post(
        "/repositories",
        json={"githubId": github_id, "fullName": full_name},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def index(app: FastAPI, repository: dict[str, Any]) -> None:
    """Does what a worker handed the repository does."""
    done = index_repository(
        app.state.session_factory,
        uuid.UUID(repository["id"]),
        app.state.settings,
        app.state.github,
    )
    assert done == "indexed"


def signed(payload: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    return body, {"x-hub-signature-256": signature, "content-type": "application/json"}


def test_a_fresh_process_serves_a_seeded_installation(
    app: FastAPI, database_url: str
) -> None:
    """A restart must not forget which account an installation belongs to."""
    fresh = create_app(Settings(environment="test", database_url=database_url))
    assert fresh is not app
    try:
        response = TestClient(fresh).get("/github/repositories", headers=OWNER)
    finally:
        fresh.state.engine.dispose()
    assert response.status_code == 200, response.text
    assert len(response.json()) == 8


def test_one_of_this_machines_repositories_is_offered_as_the_others_are(
    app: FastAPI, database_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A time is told in UTC, whatever the clock of whoever committed last:
    it is the one form the interface reads."""
    monkeypatch.setitem(ENVIRONMENT, "GIT_COMMITTER_DATE", "2026-01-01T09:30:00+09:00")
    repository(tmp_path / "acme" / "abroad", {"a.txt": "a\n"})
    here = create_app(
        Settings(
            environment="test",
            database_url=database_url,
            local_repositories=str(tmp_path),
        )
    )
    assert here is not app
    try:
        response = TestClient(here).get("/github/repositories", headers=OWNER)
    finally:
        here.state.engine.dispose()
    assert response.status_code == 200, response.text
    offered = response.json()
    assert len(offered) == 9
    assert offered[-1].pop("githubId") >= LOCAL_IDS
    assert offered[-1] == {
        "fullName": "acme/abroad",
        "private": False,
        "defaultBranch": "main",
        "description": None,
        "pushedAt": "2026-01-01T00:30:00Z",
        "connectedRepositoryId": None,
    }


def test_the_seeded_installation_and_its_permissions(client: TestClient) -> None:
    response = client.get("/github/installation", headers=OWNER)
    assert response.status_code == 200
    installation = response.json()["installation"]
    assert installation["accountLogin"] == "forgemind"
    assert installation["accountType"] == "organization"
    assert installation["repositorySelection"] == "selected"
    names = [p["name"] for p in installation["permissions"]]
    assert names == ["Metadata", "Contents", "Pull requests", "Checks", "Webhooks"]
    assert "Administration" not in names


def test_installing_takes_owners_or_admins_through_the_simulated_pages(
    client: TestClient, engine: Engine
) -> None:
    refused = client.post("/github/install/start", headers=REVIEWER)
    assert refused.status_code == 403
    riley = newcomer(engine, "Riley Chen", github_login="samrivera")
    client.post("/organization", json={"name": "Rivera Labs"}, headers=riley)
    assert client.get("/github/installation", headers=riley).json() == {
        "installation": None
    }
    installation = install(client, riley)
    assert installation["accountLogin"] == "samrivera"
    assert installation["accountType"] == "user"
    assert (
        client.get("/github/installation", headers=riley).json()["installation"]["id"]
        == installation["id"]
    )
    repos = client.get("/github/repositories", headers=riley)
    assert repos.status_code == 200
    assert [r["fullName"] for r in repos.json()] == [
        "samrivera/notes-api",
        "samrivera/shop-web",
        "samrivera/data-pipeline",
        "samrivera/dotfiles",
        "samrivera/legacy-cms",
    ]
    assert all(r["connectedRepositoryId"] is None for r in repos.json())
    latest = client.get("/audit", headers=riley).json()["items"][0]
    assert latest["action"] == "github_app.installed"
    assert latest["target"]["label"] == "samrivera"


def test_an_install_state_works_once_and_for_its_own_person(
    client: TestClient, engine: Engine
) -> None:
    started = client.post("/github/install/start", headers=OWNER).json()
    admin = session_for(engine, "mariette@example.com")
    stolen = client.post(
        "/github/install/callback",
        json={"installationId": "7001", "state": started["state"]},
        headers=admin,
    )
    assert stolen.status_code == 400
    hop = client.get(
        "/auth/github/install/continue",
        params={"state": started["state"]},
        follow_redirects=False,
    )
    installation_id = parse_qs(urlparse(hop.headers["location"]).query)[
        "installation_id"
    ][0]
    first = client.post(
        "/github/install/callback",
        json={"installationId": installation_id, "state": started["state"]},
        headers=OWNER,
    )
    assert first.status_code == 201
    second = client.post(
        "/github/install/callback",
        json={"installationId": installation_id, "state": started["state"]},
        headers=OWNER,
    )
    assert second.status_code == 400
    assert (
        second.json()["error"]["message"]
        == "The installation could not be completed. Try again."
    )


def test_the_repositories_github_can_see_and_which_are_connected(
    client: TestClient,
) -> None:
    repos = client.get("/github/repositories", headers=OWNER).json()
    by_name = {r["fullName"]: r for r in repos}
    assert len(by_name) == 8
    assert by_name["forgemind/api"]["connectedRepositoryId"] is not None
    assert by_name["acme/legacy-portal"]["connectedRepositoryId"] is None  # revoked
    assert by_name["forgemind/docs"]["connectedRepositoryId"] is None
    assert set(by_name["forgemind/api"]) == {
        "githubId",
        "fullName",
        "private",
        "defaultBranch",
        "description",
        "pushedAt",
        "connectedRepositoryId",
    }


def test_connected_repositories_are_listed_most_recently_pushed_first(
    client: TestClient,
) -> None:
    page = client.get("/repositories", headers=REVIEWER).json()
    names = [r["fullName"] for r in page["items"]]
    # The seeded ones, wherever what other tests connected falls among them.
    assert [name for name in names if name in SEEDED] == list(SEEDED)
    broken = next(r for r in page["items"] if r["fullName"] == "acme/payments")
    assert broken["status"] == "error"
    assert broken["statusMessage"] == SUSPENDED
    api = page["items"][0]
    assert api["lastAnalyzedCommit"] == API_COMMIT
    assert api["languages"][0]["name"] == FOUND["forgemind/api"][0]
    assert api["openFindings"] == 0 and api["latestTaskId"] is None
    assert api["url"] == "https://github.com/forgemind/api"
    two = client.get("/repositories", params={"limit": 2}, headers=OWNER).json()
    assert len(two["items"]) == 2 and two["nextCursor"] == "2"
    assert (
        client.get(f"/repositories/{api['id']}", headers=OWNER).json()["fullName"]
        == "forgemind/api"
    )
    assert client.get(f"/repositories/{uuid.uuid4()}", headers=OWNER).status_code == 404
    assert client.get("/repositories/nope", headers=OWNER).status_code == 404


def test_developers_connect_and_only_managers_revoke(
    client: TestClient, engine: Engine
) -> None:
    developer = session_for(engine, "chidi@example.com")
    refused = client.post(
        "/repositories",
        json={"githubId": 811008, "fullName": "forgemind/cli"},
        headers=REVIEWER,
    )
    assert refused.status_code == 403
    repo = connect(client, developer, 811008, "forgemind/cli")
    assert repo["status"] == "analyzing"
    assert repo["statusMessage"] == INDEXING == "Indexing the repository"
    assert repo["private"] is True
    # Nothing is said of what is in it before it has been read.
    assert repo["languages"] == []
    assert repo["lastAnalyzedCommit"] is None and repo["lastAnalyzedAt"] is None
    again = client.post(
        "/repositories",
        json={"githubId": 811008, "fullName": "forgemind/cli"},
        headers=developer,
    )
    assert again.status_code == 409
    assert again.json()["error"]["message"] == "forgemind/cli is already connected"
    assert (
        next(
            r
            for r in client.get("/github/repositories", headers=OWNER).json()
            if r["githubId"] == 811008
        )["connectedRepositoryId"]
        == repo["id"]
    )

    cannot = client.delete(f"/repositories/{repo['id']}", headers=developer)
    assert cannot.status_code == 403
    revoked = client.delete(f"/repositories/{repo['id']}", headers=OWNER)
    assert revoked.status_code == 200 and revoked.json() == {"ok": True}
    after = client.get(f"/repositories/{repo['id']}", headers=OWNER).json()
    assert after["status"] == "revoked" and after["statusMessage"] == "Access revoked"

    revived = connect(client, OWNER, 811008, "forgemind/cli")
    assert revived["id"] == repo["id"]
    assert revived["status"] == "analyzing"
    actions = [
        e["action"]
        for e in client.get("/audit", params={"limit": 3}, headers=OWNER).json()[
            "items"
        ]
    ]
    assert actions == [
        "repository.connected",
        "repository.revoked",
        "repository.connected",
    ]
    client.delete(f"/repositories/{repo['id']}", headers=OWNER)


def test_only_what_the_installation_sees_is_connected_and_as_github_names_it(
    client: TestClient,
) -> None:
    before = client.get("/repositories", params={"limit": 200}, headers=OWNER).json()
    # Another account's repository, under a name this installation does see.
    refused = client.post(
        "/repositories",
        json={"githubId": 920001, "fullName": "forgemind/infra"},
        headers=OWNER,
    )
    assert refused.status_code == 404
    assert refused.json()["error"] == {
        "code": "not_found",
        "message": "The GitHub App installation cannot see that repository",
    }
    after = client.get("/repositories", params={"limit": 200}, headers=OWNER).json()
    assert after == before
    # One it does see, under a name that is not its own.
    repo = connect(client, OWNER, 811007, "somebody/elses")
    assert repo["fullName"] == "forgemind/infra"
    assert repo["url"] == "https://github.com/forgemind/infra"
    assert repo["private"] is True and repo["defaultBranch"] == "main"
    client.delete(f"/repositories/{repo['id']}", headers=OWNER)


def test_connecting_needs_the_app_installed(client: TestClient, engine: Engine) -> None:
    riley = newcomer(engine, "Riley Chen", github_login="samrivera")
    client.post("/organization", json={"name": "No App Yet"}, headers=riley)
    refused = client.post(
        "/repositories",
        json={"githubId": 920001, "fullName": "samrivera/notes-api"},
        headers=riley,
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["message"] == "Install the GitHub App first"


def test_webhooks_must_be_signed_by_github(client: TestClient) -> None:
    body, headers = signed({"action": "suspend", "installation": {"id": 1001}})
    forged = client.post(
        "/github/webhooks",
        content=body,
        headers={
            **headers,
            "x-hub-signature-256": "sha256=deadbeef",
            "x-github-event": "installation",
        },
    )
    assert forged.status_code == 401
    unknown = client.post(
        "/github/webhooks",
        content=body,
        headers={**headers, "x-github-event": "installation"},
    )
    assert unknown.status_code == 202 or unknown.json().get("result", "").startswith(
        "installation"
    )


def test_suspension_and_removal_from_github_reach_the_repositories(
    app: FastAPI, client: TestClient, engine: Engine
) -> None:
    riley = newcomer(engine, "Riley Chen", github_login="samrivera")
    client.post("/organization", json={"name": "Chen Works"}, headers=riley)
    installation = install(client, riley)
    notes = connect(client, riley, 920001, "samrivera/notes-api")
    shop = connect(client, riley, 920002, "samrivera/shop-web")
    pipeline = connect(client, riley, 920003, "samrivera/data-pipeline")
    index(app, pipeline)

    def post(event: str, payload: dict[str, Any]) -> dict[str, Any]:
        body, headers = signed(payload)
        response = client.post(
            "/github/webhooks",
            content=body,
            headers={**headers, "x-github-event": event},
        )
        assert response.status_code == 202, response.text
        result: dict[str, Any] = response.json()
        return result

    iid = int(installation["id"])
    post(
        "installation_repositories",
        {
            "action": "removed",
            "installation": {"id": iid},
            "repositories_removed": [{"id": 920002}],
        },
    )
    assert (
        client.get(f"/repositories/{shop['id']}", headers=riley).json()["statusMessage"]
        == INACCESSIBLE
    )
    assert (
        client.get(f"/repositories/{notes['id']}", headers=riley).json()["status"]
        == "analyzing"
    )

    post("installation", {"action": "suspend", "installation": {"id": iid}})
    for repo in (notes, pipeline):
        suspended = client.get(f"/repositories/{repo['id']}", headers=riley).json()
        assert suspended["status"] == "error"
        assert suspended["statusMessage"] == SUSPENDED
    post("installation", {"action": "unsuspend", "installation": {"id": iid}})
    # Never indexed, it waits to be again. Indexed, it is as it was.
    waiting = client.get(f"/repositories/{notes['id']}", headers=riley).json()
    assert (waiting["status"], waiting["statusMessage"]) == ("analyzing", INDEXING)
    restored = client.get(f"/repositories/{pipeline['id']}", headers=riley).json()
    assert (restored["status"], restored["statusMessage"]) == ("connected", None)
    assert restored["lastAnalyzedCommit"] is not None

    post("installation", {"action": "deleted", "installation": {"id": iid}})
    assert client.get("/github/installation", headers=riley).json() == {
        "installation": None
    }
    assert (
        client.get(f"/repositories/{notes['id']}", headers=riley).json()["status"]
        == "error"
    )
    assert client.get("/github/repositories", headers=riley).status_code == 409


def test_one_organization_never_sees_anothers_repositories(
    client: TestClient, engine: Engine
) -> None:
    riley = newcomer(engine, "Riley Chen")
    client.post("/organization", json={"name": "Chen Works"}, headers=riley)
    ours = client.get("/repositories", headers=OWNER).json()["items"]
    assert client.get("/repositories", headers=riley).json()["items"] == []
    assert (
        client.get(f"/repositories/{ours[0]['id']}", headers=riley).status_code == 404
    )
    assert (
        client.delete(f"/repositories/{ours[0]['id']}", headers=riley).status_code
        == 404
    )
    assert (
        client.get(f"/repositories/{ours[0]['id']}", headers=OWNER).json()["status"]
        == ours[0]["status"]
    )
