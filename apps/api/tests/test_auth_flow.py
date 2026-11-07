"""Signing in through the simulated GitHub, the session, and signing out."""

import re
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from forgemind_api.app import create_app
from forgemind_api.db import make_engine
from forgemind_api.seed import seed
from forgemind_api.settings import Settings

WEB = "http://localhost:3200"
API = "http://localhost:4200"


@pytest.fixture(scope="module")
def client(database_url: str) -> Iterator[TestClient]:
    settings = Settings(
        environment="test",
        database_url=database_url,
        web_origin=WEB,
        api_origin=API,
    )
    engine = make_engine(database_url)
    seed(engine, settings)
    engine.dispose()
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()


@pytest.fixture(autouse=True)
def fresh_jar(client: TestClient) -> None:
    """No cookie from an earlier test, even one that failed half-way."""
    client.cookies.clear()


def sign_in_as(client: TestClient, login: str) -> tuple[dict[str, Any], str]:
    """Runs the whole flow and returns the session body and the cookie."""
    client.cookies.clear()
    started = client.post("/auth/github/start", json={"next": "/tasks"})
    assert started.status_code == 200, started.text
    state = started.json()["state"]
    assert started.json()["url"] == f"{API}/auth/github/authorize?state={state}"

    page = client.get("/auth/github/authorize", params={"state": state})
    assert page.status_code == 200
    assert 'role="note"' in page.text and "Simulated GitHub" in page.text
    assert "Authorize as Ayinde (Ayindecodes)" in page.text
    assert "Authorize as Sam Rivera (samrivera, new to ForgeMind)" in page.text

    hop = client.get(
        "/auth/github/authorize/continue",
        params={"state": state, "user": login},
        follow_redirects=False,
    )
    assert hop.status_code == 302
    location = urlparse(hop.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == (
        f"{WEB}/auth/github/callback"
    )
    query = parse_qs(location.query)
    assert query["state"] == [state]

    done = client.post(
        "/auth/github/callback", json={"code": query["code"][0], "state": state}
    )
    assert done.status_code == 200, done.text
    cookie = done.headers["set-cookie"]
    token = re.search(r"fm_session=([^;]+)", cookie)
    assert token is not None
    client.cookies.clear()
    return done.json(), f"fm_session={token.group(1)}"


def test_the_owner_signs_in_and_lands_in_her_organization(client: TestClient) -> None:
    session, cookie = sign_in_as(client, "Ayindecodes")
    assert session["user"]["email"] == "ayindegraphicscreation@gmail.com"
    assert session["user"]["githubLogin"] == "Ayindecodes"
    assert session["organizationId"] is not None
    assert session["role"] == "owner"

    again = client.get("/auth/session", headers={"cookie": cookie})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == session["user"]["id"]


def test_the_cookie_is_http_only_lax_and_lasts_a_week(client: TestClient) -> None:
    client.cookies.clear()
    state = client.post("/auth/github/start", json={}).json()["state"]
    hop = client.get(
        "/auth/github/authorize/continue",
        params={"state": state, "user": "Ayindecodes"},
        follow_redirects=False,
    )
    code = parse_qs(urlparse(hop.headers["location"]).query)["code"][0]
    done = client.post("/auth/github/callback", json={"code": code, "state": state})
    cookie = done.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "max-age=604800" in cookie
    assert "path=/" in cookie
    assert "secure" not in cookie  # http origin in tests; https sets it
    client.cookies.clear()


def test_a_new_person_has_no_organization_yet(client: TestClient) -> None:
    session, _ = sign_in_as(client, "samrivera")
    assert session["user"]["name"] == "Sam Rivera"
    assert session["organizationId"] is None
    assert session["role"] is None


def test_signing_out_ends_the_session(client: TestClient) -> None:
    _, cookie = sign_in_as(client, "Ayindecodes")
    out = client.post("/auth/sign-out", headers={"cookie": cookie})
    assert out.status_code == 200
    assert out.json() == {"ok": True}
    assert "max-age=0" in out.headers["set-cookie"].lower()
    gone = client.get("/auth/session", headers={"cookie": cookie})
    assert gone.status_code == 401
    assert gone.json()["error"]["details"] == {"reason": "signed_out"}


def test_a_code_and_state_work_once(client: TestClient) -> None:
    client.cookies.clear()
    state = client.post("/auth/github/start", json={}).json()["state"]
    hop = client.get(
        "/auth/github/authorize/continue",
        params={"state": state, "user": "Ayindecodes"},
        follow_redirects=False,
    )
    code = parse_qs(urlparse(hop.headers["location"]).query)["code"][0]
    first = client.post("/auth/github/callback", json={"code": code, "state": state})
    assert first.status_code == 200
    second = client.post("/auth/github/callback", json={"code": code, "state": state})
    assert second.status_code == 400
    assert second.json()["error"]["code"] == "invalid"
    # A fresh code for the same, already used state is refused too: the
    # state guard holds on its own, not only because the code was spent.
    again = client.get(
        "/auth/github/authorize/continue",
        params={"state": state, "user": "Ayindecodes"},
        follow_redirects=False,
    )
    fresh = parse_qs(urlparse(again.headers["location"]).query)["code"][0]
    reused = client.post("/auth/github/callback", json={"code": fresh, "state": state})
    assert reused.status_code == 400
    unknown = client.post(
        "/auth/github/callback", json={"code": "nope", "state": "never-issued"}
    )
    assert unknown.status_code == 400
    client.cookies.clear()


def test_the_next_target_must_be_a_path_on_this_app(client: TestClient) -> None:
    refused = client.post("/auth/github/start", json={"next": "https://evil.example"})
    assert refused.status_code == 400
    body = refused.json()["error"]
    assert body["code"] == "invalid"
    assert body["details"]["issues"][0]["path"] == "next"


def test_the_fixed_development_tokens(client: TestClient) -> None:
    owner = client.get("/auth/session", headers={"cookie": "fm_session=dev-owner"})
    assert owner.status_code == 200
    assert owner.json()["role"] == "owner"
    reviewer = client.get(
        "/auth/session", headers={"cookie": "fm_session=dev-reviewer"}
    )
    assert reviewer.json()["role"] == "reviewer"
    new = client.get("/auth/session", headers={"cookie": "fm_session=dev-new"})
    assert new.json()["organizationId"] is None
    expired = client.get("/auth/session", headers={"cookie": "fm_session=dev-expired"})
    assert expired.status_code == 401
    assert expired.json()["error"]["details"] == {"reason": "expired"}
    assert expired.json()["error"]["message"] == "Your session has expired"
    nobody = client.get("/auth/session")
    assert nobody.status_code == 401
    assert nobody.json()["error"]["details"] == {"reason": "signed_out"}
    garbage = client.get("/auth/session", headers={"cookie": "fm_session=garbage"})
    assert garbage.status_code == 401


def test_the_organization_follows_the_session(client: TestClient) -> None:
    owner = client.get("/organization", headers={"cookie": "fm_session=dev-owner"})
    assert owner.status_code == 200
    assert owner.json()["name"] == "Ayinde Creations"
    assert owner.json()["slug"] == "ayinde-creations"
    assert owner.json()["plan"] == "team"
    nobody = client.get("/organization")
    assert nobody.status_code == 401
    newcomer = client.get("/organization", headers={"cookie": "fm_session=dev-new"})
    assert newcomer.status_code == 403
    assert newcomer.json()["error"]["message"] == "Create an organization first"
