"""The API behind a proxy that serves it under a path of the site's own
origin and takes the path off before passing a request on, as the staging
deployment's edge does with /api."""

import re
from collections.abc import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from forgemind_api.app import create_app
from forgemind_api.db import make_engine
from forgemind_api.seed import seed
from forgemind_api.settings import Settings

SITE = "https://staging.example.com"
API = f"{SITE}/api"


@pytest.fixture(scope="module")
def client(database_url: str) -> Iterator[TestClient]:
    settings = Settings(
        environment="test", database_url=database_url, web_origin=SITE, api_origin=API
    )
    engine = make_engine(database_url)
    seed(engine, settings)
    engine.dispose()
    app = create_app(settings)
    # As the server gives it to the application: the path the proxy took off.
    yield TestClient(app, root_path="/api")
    app.state.engine.dispose()


def links(page: str) -> list[str]:
    return re.findall(r'<a class="button" href="([^"]+)"', page)


def without_the_path(url: str) -> str:
    """What the proxy passes on of a URL a browser was sent to."""
    assert url.startswith(f"{API}/"), url
    return url.removeprefix(API).replace("&amp;", "&")


def test_it_describes_itself_where_a_browser_finds_it(client: TestClient) -> None:
    assert client.get("/openapi.json").json()["servers"] == [{"url": "/api"}]
    assert "url: '/api/openapi.json'" in client.get("/docs").text
    assert client.get("/health").status_code == 200


def test_at_an_origin_of_its_own_it_names_no_path(database_url: str) -> None:
    app = create_app(Settings(environment="test", database_url=database_url))
    try:
        described = TestClient(app).get("/openapi.json").json()
    finally:
        app.state.engine.dispose()
    assert "servers" not in described


def test_every_step_of_signing_in_stays_under_the_path(client: TestClient) -> None:
    client.cookies.clear()
    started = client.post("/auth/github/start", json={"next": "/tasks"}).json()
    state = started["state"]
    assert started["url"] == f"{API}/auth/github/authorize?state={state}"

    page = client.get(without_the_path(started["url"]))
    assert page.status_code == 200
    choices = links(page.text)
    assert len(choices) >= 2
    # A link written from the site's root would leave the API for the interface.
    hop = client.get(without_the_path(choices[0]), follow_redirects=False)
    assert hop.status_code == 302
    back = urlparse(hop.headers["location"])
    assert f"{back.scheme}://{back.netloc}{back.path}" == f"{SITE}/auth/github/callback"

    code = parse_qs(back.query)["code"][0]
    done = client.post("/auth/github/callback", json={"code": code, "state": state})
    assert done.status_code == 200, done.text
    cookie = done.headers["set-cookie"].lower()
    # Served over https, the session is never sent in the clear; and it is the
    # whole site's, so the interface's pages and the API under /api share it.
    assert "; secure" in cookie
    assert "path=/;" in cookie or cookie.endswith("path=/")
    client.cookies.clear()


def test_installing_the_app_stays_under_the_path(client: TestClient) -> None:
    owner = {"cookie": "fm_session=dev-owner"}
    started = client.post("/github/install/start", headers=owner)
    assert started.status_code == 200, started.text
    url = started.json()["url"]
    assert url.startswith(f"{API}/auth/github/install?state=")

    page = client.get(without_the_path(url))
    assert page.status_code == 200
    (install,) = links(page.text)
    hop = client.get(without_the_path(install), follow_redirects=False)
    assert hop.status_code == 302
    back = urlparse(hop.headers["location"])
    assert (
        f"{back.scheme}://{back.netloc}{back.path}" == f"{SITE}/auth/github/installed"
    )
