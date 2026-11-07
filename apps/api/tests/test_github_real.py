"""The real GitHub exchange, against a fake GitHub."""

import json

import httpx
import pytest

from forgemind_api.errors import ApiFailure
from forgemind_api.github import RealGitHub


def fake_github(
    *, token: str | None = "gho_abc", email: str | None = "ada@example.com"
) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/login/oauth/access_token":
            body = dict(httpx.QueryParams(request.content.decode()))
            assert body["code"] == "the-code" and body["state"] == "the-state"
            return httpx.Response(200, json={"access_token": token} if token else {})
        assert request.headers["authorization"] == "Bearer gho_abc"
        if request.url.path == "/user":
            return httpx.Response(
                200,
                json={
                    "id": 42,
                    "login": "ada",
                    "name": None,
                    "email": None,
                    "avatar_url": "https://avatars.example/42",
                },
            )
        if request.url.path == "/user/emails":
            entries = [{"email": "old@example.com", "primary": False, "verified": True}]
            if email:
                entries.append({"email": email, "primary": True, "verified": True})
            return httpx.Response(200, json=entries)
        return httpx.Response(404)

    return httpx.MockTransport(handle)


def test_exchanges_the_code_and_reads_the_person() -> None:
    github = RealGitHub("id", "secret", transport=fake_github())
    assert github.authorize_url("s", "http://web/cb").startswith(
        "https://github.com/login/oauth/authorize?client_id=id&redirect_uri="
    )
    identity = github.identity_for_code("the-code", "the-state")
    assert identity.github_user_id == 42
    assert identity.login == "ada"
    assert identity.name == "ada"  # no display name: the login stands in
    assert identity.email == "ada@example.com"  # the primary verified one
    assert identity.avatar_url == "https://avatars.example/42"


def test_refuses_without_a_token_or_a_verified_email() -> None:
    with pytest.raises(ApiFailure) as no_token:
        RealGitHub("id", "secret", transport=fake_github(token=None)).identity_for_code(
            "the-code", "the-state"
        )
    assert no_token.value.code == "invalid"
    with pytest.raises(ApiFailure) as no_email:
        RealGitHub("id", "secret", transport=fake_github(email=None)).identity_for_code(
            "the-code", "the-state"
        )
    assert "email" in no_email.value.message


def test_the_secret_never_leaves_in_a_query_string() -> None:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={})

    github = RealGitHub("id", "s3cret", transport=httpx.MockTransport(handle))
    with pytest.raises(ApiFailure):
        github.identity_for_code("c", "s")
    assert "s3cret" not in str(seen[0].url)
    assert "s3cret" in seen[0].content.decode()
    assert json.loads("{}") == {}
