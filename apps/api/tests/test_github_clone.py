"""Read access to one repository, for as long as it takes to clone it: as the
real GitHub gives it, checked against git's own HTTP server, and as the
simulated GitHub does."""

from __future__ import annotations

import base64
import json
import os
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import jwt
import pytest

from forgemind_api import simulated_repositories
from forgemind_api.github import (
    NO_ACCESS,
    SIMULATED_ACCOUNTS,
    UNREACHABLE,
    RealGitHub,
    SimulatedGitHub,
)
from forgemind_api.simulated_repositories import TREES
from forgemind_api.workspace import (
    NO_GIT,
    PREFIX,
    CloneSource,
    Git,
    RepositoryUnavailable,
    checkout,
    make_base,
    remove,
)
from tests.gitrepos import GitServer, git, repository, running_under
from tests.test_github_app import PRIVATE, PUBLIC

TOKEN = "ghs_ReadsOneRepositoryAndNothingElse"
FILES: dict[str, str | bytes] = {"README.md": "# Thing\n", "src/thing.py": "x = 1\n"}


def basic(token: str) -> str:
    """The Authorization header git sends for an installation token."""
    return "Basic " + base64.b64encode(f"x-access-token:{token}".encode()).decode()


def files_of(directory: Path) -> dict[str, str]:
    return {
        str(path.relative_to(directory)): path.read_text()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def granted(request: httpx.Request) -> httpx.Response:
    return httpx.Response(201, json={"token": TOKEN})


@dataclass
class FakeApi:
    """GitHub's API, as far as access to clone goes."""

    grant: Callable[[httpx.Request], httpx.Response] = granted
    revoke: Callable[[httpx.Request], httpx.Response] = lambda request: httpx.Response(
        204
    )
    seen: list[httpx.Request] = field(default_factory=list[httpx.Request])
    revoked: list[str] = field(default_factory=list[str])

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        path = request.url.path
        if request.method == "POST" and path == "/app/installations/42/access_tokens":
            return self.grant(request)
        if request.method == "DELETE" and path == "/installation/token":
            self.revoked.append(request.headers["authorization"])
            return self.revoke(request)
        return httpx.Response(404)

    def github(self, git_origin: str = "http://127.0.0.1:9") -> RealGitHub:
        return RealGitHub(
            "id",
            "secret",
            app_id="12345",
            private_key=PRIVATE,
            slug="forgemind-dev",
            transport=httpx.MockTransport(self.handle),
            git_origin=git_origin,
        )


@pytest.fixture
def root(tmp_path: Path) -> Iterator[Path]:
    """Where the checkouts under test go. Nothing may be left in it."""
    directory = tmp_path / "workspaces"
    directory.mkdir()
    yield directory
    assert os.listdir(directory) == []


@pytest.fixture
def hosted(tmp_path: Path) -> tuple[Path, str]:
    """`acme/thing` where a git server would keep it, and its commit."""
    served = tmp_path / "served"
    return served, repository(served / "acme" / "thing.git", FILES)


# --- the real GitHub


def test_a_repository_is_cloned_with_a_token_for_it_alone(
    hosted: tuple[Path, str], root: Path
) -> None:
    served, commit = hosted
    api = FakeApi()
    with GitServer(served, allows=lambda sent: sent == basic(TOKEN)) as server:
        github = api.github(server.origin)
        with (
            github.clone_access(42, "acme/thing") as source,
            checkout(source, branch="main", root=str(root)) as found,
        ):
            assert source.url == f"{server.origin}/acme/thing.git"
            assert found.commit == commit
            assert files_of(found.path) == FILES
    # Asked for as the App, for that repository's contents, to read.
    asked = api.seen[0]
    assert (asked.method, asked.url.host) == ("POST", "api.github.com")
    assert json.loads(asked.content) == {
        "repositories": ["thing"],
        "permissions": {"contents": "read"},
    }
    bearer = asked.headers["authorization"].removeprefix("Bearer ")
    assert jwt.decode(bearer, PUBLIC, algorithms=["RS256"])["iss"] == "12345"
    # Git sent the token with every request, and was answered.
    assert {(a.authorization, a.status) for a in server.asked} == {(basic(TOKEN), 200)}
    assert {a.method for a in server.asked} == {"GET", "POST"}


def test_the_git_server_gives_nothing_without_the_token(
    hosted: tuple[Path, str], root: Path
) -> None:
    """What the other tests rest on: that server does check."""
    served, _ = hosted
    with GitServer(served, allows=lambda sent: sent == basic(TOKEN)) as server:
        url = f"{server.origin}/acme/thing.git"
        for source in (CloneSource(url), CloneSource(url, basic("ghs_another"))):
            with (
                pytest.raises(RepositoryUnavailable) as refused,
                checkout(source, branch="main", root=str(root)),
            ):
                pass
            assert refused.value.reason == (
                "The repository could not be reached to clone it."
            )
    assert server.asked
    assert {a.status for a in server.asked} == {401}


def test_the_token_is_revoked_when_the_clone_is_done(
    hosted: tuple[Path, str], root: Path
) -> None:
    served, _ = hosted
    api = FakeApi()
    with GitServer(served) as server:
        github = api.github(server.origin)
        with github.clone_access(42, "acme/thing") as source:
            with checkout(source, branch="main", root=str(root)):
                pass
            assert api.revoked == []
    assert api.revoked == [f"Bearer {TOKEN}"]
    assert api.seen[-1].url == "https://api.github.com/installation/token"


def test_the_token_is_revoked_when_the_work_fails() -> None:
    api = FakeApi()
    with pytest.raises(RuntimeError), api.github().clone_access(42, "acme/thing"):
        raise RuntimeError("the inspection broke")
    assert api.revoked == [f"Bearer {TOKEN}"]


def test_a_token_that_could_not_be_revoked_does_not_undo_the_work() -> None:
    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to GitHub", request=request)

    api = FakeApi(revoke=unreachable)
    with api.github().clone_access(42, "acme/thing") as source:
        assert source.authorization == basic(TOKEN)
    assert api.revoked == [f"Bearer {TOKEN}"]


def test_the_token_is_on_no_command_line_and_in_no_file(
    hosted: tuple[Path, str], root: Path
) -> None:
    """Looked for while git is running: any account on the machine can read a
    command line, and the workspace is what the inspection reads."""
    served, _ = hosted
    commands: list[str] = []
    written: dict[str, bytes] = {}

    def look() -> None:
        for pid in running_under(root):
            try:
                command = Path(f"/proc/{pid}/cmdline").read_bytes()
            except OSError:
                continue
            commands.append(command.replace(b"\0", b" ").decode("utf-8", "replace"))
        for path in root.rglob("*"):
            if path.is_file() and not path.is_symlink():
                written[str(path)] = path.read_bytes()

    api = FakeApi()
    with GitServer(served, during=look) as server:
        github = api.github(server.origin)
        with (
            github.clone_access(42, "acme/thing") as source,
            checkout(source, branch="main", root=str(root)) as found,
        ):
            look()
            written |= {
                str(path): path.read_bytes()
                for path in found.path.parent.rglob("*")
                if path.is_file()
            }
    # Git and the helper that speaks HTTP for it were both seen at work.
    assert any("remote-http" in command for command in commands), commands
    assert any(name.endswith("/gitconfig") for name in written)
    assert any(name.endswith("/FETCH_HEAD") for name in written)
    secret = (TOKEN, basic(TOKEN).removeprefix("Basic "))
    for command in commands:
        assert not any(value in command for value in secret), command
    for name, content in written.items():
        assert not any(value.encode() in content for value in secret), name
    # The source says where, never how.
    assert TOKEN not in repr(source)
    assert basic(TOKEN) not in repr(source)


def test_a_clone_does_not_follow_the_server_elsewhere(
    hosted: tuple[Path, str], root: Path
) -> None:
    """A server that answers by sending git to another address would have the
    token sent there too."""
    served, _ = hosted
    api = FakeApi()
    with GitServer(served) as elsewhere:
        with GitServer(served, redirect_to=elsewhere.origin) as server:
            github = api.github(server.origin)
            with (
                pytest.raises(RepositoryUnavailable),
                github.clone_access(42, "acme/thing") as source,
                checkout(source, branch="main", root=str(root)),
            ):
                pass
        assert [a.status for a in server.asked] == [302]
        assert elsewhere.asked == []
    assert api.revoked == [f"Bearer {TOKEN}"]


def test_the_token_goes_to_the_repositorys_address_and_no_other(
    hosted: tuple[Path, str], root: Path
) -> None:
    """Git as a checkout sets it up, asked for what no checkout asks for:
    another repository on the same server, and the same one on another."""
    served, _ = hosted
    repository(served / "acme" / "other.git", FILES)
    base = make_base(str(root))
    try:
        with GitServer(served) as server, GitServer(served) as elsewhere:
            thing = f"{server.origin}/acme/thing.git"
            ours = Git(
                base, CloneSource(thing, basic(TOKEN)), time.monotonic() + 60, 10**7
            )
            ours.run("init", "-q", "--template=", "--object-format=sha1")
            for url in (
                thing,
                f"{server.origin}/acme/other.git",
                f"{elsewhere.origin}/acme/thing.git",
            ):
                assert "refs/heads/main" in ours.run("ls-remote", "--", url)
    finally:
        remove(base)
    assert {(a.path.partition(".git/")[0], a.authorization) for a in server.asked} == {
        ("/acme/thing", basic(TOKEN)),
        ("/acme/other", None),
    }
    assert elsewhere.asked
    assert {a.authorization for a in elsewhere.asked} == {None}


Grant = Callable[[httpx.Request], httpx.Response]


def answers(
    status: int,
    body: object = None,
    text: str | None = None,
    headers: dict[str, str] | None = None,
) -> Grant:
    """A GitHub that answers every request for a token the same way."""

    def grant(request: httpx.Request) -> httpx.Response:
        if text is not None:
            return httpx.Response(status, text=text, headers=headers)
        return httpx.Response(status, json=body or {}, headers=headers)

    return grant


def dropped(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("GitHub said nothing", request=request)


@pytest.mark.parametrize(
    ("grant", "reason", "permanent"),
    [
        (answers(403), NO_ACCESS, True),
        (answers(404), NO_ACCESS, True),
        (answers(422), NO_ACCESS, True),
        (answers(403, headers={"retry-after": "60"}), UNREACHABLE, False),
        (answers(403, headers={"x-ratelimit-remaining": "0"}), UNREACHABLE, False),
        (answers(429), UNREACHABLE, False),
        (answers(401), UNREACHABLE, False),
        (answers(500, text="oops"), UNREACHABLE, False),
        (answers(502, text=""), UNREACHABLE, False),
        (answers(201, text="<html>"), UNREACHABLE, False),
        (answers(201), UNREACHABLE, False),
        (answers(201, {"token": ""}), UNREACHABLE, False),
        (answers(201, {"token": 7}), UNREACHABLE, False),
        (dropped, UNREACHABLE, False),
    ],
    ids=[
        "forbidden",
        "not found",
        "not this installation's",
        "asked too often, told to wait",
        "asked too often, none left",
        "too many requests",
        "the app itself refused",
        "github broke",
        "bad gateway",
        "not json",
        "no token",
        "an empty token",
        "a token that is no text",
        "no answer",
    ],
)
def test_why_github_gave_no_access_decides_whether_to_try_again(
    grant: Grant, reason: str, permanent: bool
) -> None:
    api = FakeApi(grant=grant)
    entered = False
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        api.github().clone_access(42, "acme/thing"),
    ):
        entered = True
    assert not entered
    assert (refused.value.reason, refused.value.permanent) == (reason, permanent)
    # There was no token to revoke, and none was made up to.
    assert api.revoked == []
    assert len(api.seen) == 1


# --- the simulated GitHub


def simulated(root: Path) -> SimulatedGitHub:
    github = SimulatedGitHub(
        "http://api.test",
        "http://web.test",
        lambda installation_id: "forgemind" if installation_id == 1001 else None,
        workspace_root=str(root),
    )
    return github


def test_a_made_up_repository_is_committed_for_the_clone_and_removed_after(
    root: Path,
) -> None:
    github = simulated(root)
    with github.clone_access(1001, "forgemind/docs") as source:
        assert source.authorization is None
        [made] = os.listdir(root)
        assert made.startswith(PREFIX)
        assert source.url == (root / made / "source").as_uri()
        with checkout(source, branch="main", root=str(root)) as found:
            assert files_of(found.path) == TREES["forgemind/docs"]
            assert found.commit == git(root / made / "source", "rev-parse", "HEAD")
    # The fixture checks that nothing is left.


def test_a_made_up_repository_is_removed_when_the_work_fails(root: Path) -> None:
    with (
        pytest.raises(RuntimeError),
        simulated(root).clone_access(1001, "forgemind/docs"),
    ):
        raise RuntimeError("the inspection broke")


def test_an_installation_made_in_this_process_needs_no_resolving(root: Path) -> None:
    github = SimulatedGitHub("", "", workspace_root=str(root))
    installation = github.issue_installation("samrivera")
    with (
        github.clone_access(installation, "samrivera/dotfiles") as source,
        checkout(source, branch="main", root=str(root)) as found,
    ):
        assert files_of(found.path) == TREES["samrivera/dotfiles"]


@pytest.mark.parametrize(
    ("installation", "full_name"),
    [
        (1001, "samrivera/dotfiles"),
        (1001, "forgemind/nothing-like-it"),
        (1001, "../../etc"),
        (4242, "forgemind/docs"),
    ],
    ids=[
        "another account's",
        "one that does not exist",
        "a path",
        "an installation nobody made",
    ],
)
def test_the_simulated_github_gives_only_what_the_installation_can_see(
    installation: int, full_name: str, root: Path
) -> None:
    entered = False
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        simulated(root).clone_access(installation, full_name),
    ):
        entered = True
    assert not entered
    assert (refused.value.reason, refused.value.permanent) == (NO_ACCESS, True)


def test_every_repository_it_lists_can_be_cloned() -> None:
    """Each has files to commit: none is listed that could not be read."""
    for account in SIMULATED_ACCOUNTS.values():
        for listed in account.repositories:
            assert listed.full_name in TREES
            assert listed.default_branch == "main"


def test_a_server_without_git_says_so_for_good(
    root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_git(full_name: str, directory: Path) -> str:
        raise simulated_repositories.GitMissing("git is needed")

    monkeypatch.setattr(simulated_repositories, "materialise", no_git)
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        simulated(root).clone_access(1001, "forgemind/docs"),
    ):
        pass
    assert (refused.value.reason, refused.value.permanent) == (NO_GIT, True)
