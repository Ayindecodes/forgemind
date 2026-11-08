"""The real GitHub App endpoints, against a fake GitHub."""

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from forgemind_api.errors import ApiFailure
from forgemind_api.github import RealGitHub

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE = KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
PUBLIC = KEY.public_key()


def fake_github(
    repositories: int = 1,
) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/app/installations/42":
            return httpx.Response(
                200,
                json={
                    "id": 42,
                    "account": {"login": "acme", "type": "Organization"},
                    "repository_selection": "all",
                },
            )
        if request.url.path == "/app/installations/42/access_tokens":
            return httpx.Response(201, json={"token": "ghs_installation"})
        if request.url.path == "/installation/repositories":
            assert request.headers["authorization"] == "Bearer ghs_installation"
            page = int(request.url.params.get("page", "1"))
            start = (page - 1) * 100
            batch = [
                {
                    "id": 1000 + i,
                    "full_name": f"acme/repo-{i}",
                    "private": i % 2 == 0,
                    "default_branch": "trunk",
                    "description": None,
                    "pushed_at": "2026-11-01T10:00:00Z",
                }
                for i in range(start, min(start + 100, repositories))
            ]
            return httpx.Response(200, json={"repositories": batch})
        return httpx.Response(404)

    return httpx.MockTransport(handle), seen


def app() -> tuple[RealGitHub, list[httpx.Request]]:
    transport, seen = fake_github(repositories=101)
    return RealGitHub(
        "id",
        "secret",
        app_id="12345",
        private_key=PRIVATE,
        slug="forgemind-dev",
        transport=transport,
    ), seen


def test_the_install_page_is_the_apps_own() -> None:
    github, _ = app()
    assert (
        github.install_url("st")
        == "https://github.com/apps/forgemind-dev/installations/new?state=st"
    )


def test_the_installation_is_read_with_an_app_token() -> None:
    github, seen = app()
    info = github.installation(42)
    assert info.account_login == "acme"
    assert info.account_type == "organization"
    assert info.repository_selection == "all"
    token = seen[0].headers["authorization"].removeprefix("Bearer ")
    claims = jwt.decode(token, PUBLIC, algorithms=["RS256"])
    assert claims["iss"] == "12345"
    assert claims["exp"] - claims["iat"] <= 600


def test_repositories_are_listed_through_an_installation_token_across_pages() -> None:
    github, seen = app()
    repos = github.installation_repositories(42)
    assert len(repos) == 101
    assert repos[0].full_name == "acme/repo-0"
    assert repos[0].default_branch == "trunk"
    assert repos[0].pushed_at.isoformat().startswith("2026-11-01T10:00:00")
    pages = [
        r.url.params.get("page")
        for r in seen
        if r.url.path == "/installation/repositories"
    ]
    assert pages == ["1", "2"]


def test_an_unknown_installation_is_refused() -> None:
    github, _ = app()
    with pytest.raises(ApiFailure) as refused:
        github.installation(43)
    assert refused.value.code == "invalid"
