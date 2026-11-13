"""Checkouts of real repositories, made by the machine's git."""

import logging
import os
import signal
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

from forgemind_api import workspace
from forgemind_api.workspace import CloneSource, RepositoryUnavailable, checkout
from tests.gitrepos import commit, git, repository, running_under, write


def source(directory: Path) -> CloneSource:
    return CloneSource(directory.as_uri())


def files_of(directory: Path) -> dict[str, str]:
    return {
        str(path.relative_to(directory)): path.read_text()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


@pytest.fixture
def root(tmp_path: Path) -> Iterator[Path]:
    """Where the checkouts under test go. Nothing may be left in it."""
    directory = tmp_path / "workspaces"
    directory.mkdir()
    yield directory
    assert os.listdir(directory) == []


def test_checks_out_the_commit_the_branch_is_at(tmp_path: Path, root: Path) -> None:
    origin = tmp_path / "with space" / "origin"
    first = repository(origin, {"README.md": "# One\n", "src/a.py": "print(1)\n"})
    write(origin, {"README.md": "# Two\n", "src/b.py": "print(2)\n"})
    second = commit(origin)
    with checkout(source(origin), branch="main", root=str(root)) as found:
        assert found.commit == second != first
        assert found.files == 3
        assert files_of(found.path) == {
            "README.md": "# Two\n",
            "src/a.py": "print(1)\n",
            "src/b.py": "print(2)\n",
        }
        # Git's own directory is beside the tree, not in it.
        assert sorted(os.listdir(found.path)) == ["README.md", "src"]
        assert found.path.parent.parent == root


def test_checks_out_a_named_commit_whatever_the_branch_did_since(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    first = repository(origin, {"README.md": "# One\n"})
    write(origin, {"README.md": "# Two\n"})
    commit(origin)
    with checkout(source(origin), commit=first, root=str(root)) as found:
        assert found.commit == first
        assert files_of(found.path) == {"README.md": "# One\n"}


def test_a_checkout_is_of_a_branch_or_of_a_full_commit(tmp_path: Path) -> None:
    origin = source(tmp_path)
    for branch, named in (
        (None, None),
        ("main", "a" * 40),
        (None, "abc1234"),
        (None, "--upload-pack=touch /tmp/pwned"),
    ):
        with pytest.raises(ValueError), checkout(origin, branch=branch, commit=named):
            pass


def test_the_tree_is_read_only_and_removed_afterwards(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n", "bin/run": "#!/bin/sh\n"})
    (origin / "bin/run").chmod(0o755)
    commit(origin)
    with checkout(source(origin), branch="main", root=str(root)) as found:
        base = found.path.parent
        with pytest.raises(PermissionError):
            (found.path / "new.txt").write_text("x")
        with pytest.raises(PermissionError):
            (found.path / "README.md").write_text("changed")
        with pytest.raises(PermissionError):
            (found.path / "README.md").unlink()
        with pytest.raises(PermissionError):
            (found.path / "bin" / "more").mkdir()
        # Still marked as a program, for whoever reads the tree.
        assert os.access(found.path / "bin/run", os.X_OK)
        assert not os.access(found.path / "README.md", os.X_OK)
    assert not base.exists()


def test_the_workspace_is_removed_when_the_work_in_it_fails(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n"})
    with (
        pytest.raises(RuntimeError),
        checkout(source(origin), branch="main", root=str(root)),
    ):
        raise RuntimeError("the inspection broke")


def test_links_are_not_created(tmp_path: Path, root: Path) -> None:
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n", "real/a.py": "x\n"})
    (origin / "passwd").symlink_to("/etc/passwd")
    (origin / "up").symlink_to("../..", target_is_directory=True)
    (origin / "real" / "again.py").symlink_to("a.py")
    commit(origin)
    with checkout(source(origin), branch="main", root=str(root)) as found:
        assert files_of(found.path) == {"README.md": "# One\n", "real/a.py": "x\n"}
        assert found.files == 2
        for current, names, files in os.walk(found.path):
            for name in [*names, *files]:
                assert not os.path.islink(os.path.join(current, name))


def test_submodules_are_not_fetched(tmp_path: Path, root: Path) -> None:
    other = tmp_path / "other"
    inner = repository(other, {"secret.txt": "from another repository\n"})
    origin = tmp_path / "origin"
    repository(
        origin,
        {
            "README.md": "# One\n",
            ".gitmodules": (
                '[submodule "other"]\n\tpath = vendor/other\n'
                f"\turl = {other.as_uri()}\n"
            ),
        },
    )
    git(origin, "update-index", "--add", "--cacheinfo", f"160000,{inner},vendor/other")
    git(origin, "commit", "-q", "-m", "A submodule")
    with checkout(source(origin), branch="main", root=str(root)) as found:
        assert sorted(files_of(found.path)) == [".gitmodules", "README.md"]


def test_the_machines_own_git_setup_is_not_used(
    tmp_path: Path, root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A hook the server's configuration would run is run by a plain clone,
    and not by a checkout."""
    marker = tmp_path / "ran"
    hooks = tmp_path / "hooks"
    template = tmp_path / "template"
    for directory in (hooks, template / "hooks"):
        directory.mkdir(parents=True)
        hook = directory / "post-checkout"
        hook.write_text(f"#!/bin/sh\ntouch {marker}\n")
        hook.chmod(0o755)
    home = tmp_path / "home"
    home.mkdir()
    (home / ".gitconfig").write_text(f"[core]\n\thooksPath = {hooks}\n")
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n"})

    def hostile(**variables: str) -> None:
        for name in (
            "HOME",
            "GIT_TEMPLATE_DIR",
            "GIT_CONFIG_GLOBAL",
            "GIT_CONFIG_COUNT",
            "GIT_CONFIG_KEY_0",
            "GIT_CONFIG_VALUE_0",
        ):
            monkeypatch.delenv(name, raising=False)
        for name, value in variables.items():
            monkeypatch.setenv(name, value)

    setups = (
        {"HOME": str(home)},
        {"GIT_TEMPLATE_DIR": str(template)},
        {"GIT_CONFIG_GLOBAL": str(home / ".gitconfig")},
        {
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.hooksPath",
            "GIT_CONFIG_VALUE_0": str(hooks),
        },
    )
    for number, setup in enumerate(setups):
        hostile(**setup)
        subprocess.run(
            ["git", "clone", "-q", origin.as_uri(), str(tmp_path / f"plain-{number}")],
            check=True,
            capture_output=True,
            timeout=60,
        )
        assert marker.exists(), setup
        marker.unlink()
        with checkout(source(origin), branch="main", root=str(root)) as found:
            assert files_of(found.path) == {"README.md": "# One\n"}
        assert not marker.exists(), setup


@pytest.fixture
def base(root: Path) -> Iterator[Path]:
    """A workspace's own directory, made and removed as a checkout does."""
    directory = workspace.make_base(str(root))
    yield directory
    workspace.remove(directory)


def set_up(base: Path, origin: CloneSource) -> workspace.Git:
    """Git as a checkout sets it up, to be asked what no checkout asks."""
    ours = workspace.Git(base, origin, time.monotonic() + 60, 10_000_000)
    ours.run("init", "-q", "--template=", "--object-format=sha1")
    return ours


def test_git_is_told_this_and_nothing_else(tmp_path: Path, base: Path) -> None:
    """All of what git is given, the settings as git reads them back. Some
    change nothing a checkout does today: no helper is configured for
    `credential.helper` to clear, and no submodule is ever set up to recurse
    into. They are kept for the day a checkout does more."""
    origin = tmp_path / 'a "quoted" \\ name' / "origin"
    ours = set_up(base, source(origin))
    assert ours.env == {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "HOME": str(base / "home"),
        "XDG_CONFIG_HOME": str(base / "home"),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": str(base / "gitconfig"),
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_DIR": str(base / "git"),
        "GIT_WORK_TREE": str(base / "tree"),
        "LC_ALL": "C",
    }
    told = ours.run("config", "--global", "--list", "-z")
    assert dict(entry.split("\n", 1) for entry in told.split("\0") if entry) == {
        "core.hookspath": "/dev/null",
        "core.symlinks": "false",
        "core.fsmonitor": "false",
        "core.attributesfile": "/dev/null",
        "core.excludesfile": "/dev/null",
        "protocol.allow": "never",
        "protocol.file.allow": "always",
        "credential.helper": "",
        "http.followredirects": "false",
        "fetch.recursesubmodules": "false",
        "submodule.recurse": "false",
        "gc.auto": "0",
        "maintenance.auto": "false",
        "advice.detachedhead": "false",
        # Where the source is, whatever its name has in it.
        "safe.directory": str(origin),
    }


def test_git_speaks_the_protocol_of_the_source_and_no_other(
    tmp_path: Path, base: Path
) -> None:
    """Wherever a repository or its server points, git does not go there by
    another way, and above all not by running a command."""
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n"})
    marker = tmp_path / "ran"
    ours = set_up(base, CloneSource("https://github.com/acme/thing.git"))
    for protocol, url in (
        ("file", origin.as_uri()),
        ("http", "http://127.0.0.1:9/acme/thing.git"),
        ("ext", f"ext::touch {marker}"),
    ):
        with pytest.raises(workspace.GitFailed) as refused:
            ours.run("ls-remote", "--", url)
        assert f"transport '{protocol}' not allowed" in refused.value.output
    assert not marker.exists()


def test_nothing_in_gits_own_directory_is_run_as_a_hook(
    tmp_path: Path, base: Path
) -> None:
    """No checkout puts a program there. If something did, git would not run
    it."""
    origin = tmp_path / "origin"
    wanted = repository(origin, {"README.md": "# One\n"})
    marker = tmp_path / "ran"
    ours = set_up(base, source(origin))
    hooks = base / "git" / "hooks"
    hooks.mkdir(exist_ok=True)
    for name in ("reference-transaction", "post-checkout"):
        hook = hooks / name
        hook.write_text(f"#!/bin/sh\ntouch {marker}\n")
        hook.chmod(0o755)
    ours.run("fetch", "-q", "--depth=1", "--", origin.as_uri(), wanted)
    ours.run("checkout", "-q", "--detach", wanted)
    assert (base / "tree" / "README.md").read_text() == "# One\n"
    assert not marker.exists()


def test_a_commit_larger_than_allowed_is_refused_before_it_is_written(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    # Three megabytes that travel as a few kilobytes.
    repository(origin, {"zeros.bin": b"\0" * 3_000_000, "README.md": "# One\n"})
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(origin), branch="main", root=str(root), max_bytes=1_000_000),
    ):
        pass
    assert refused.value.permanent
    assert refused.value.reason == (
        "The repository's files come to more than 1 MB at this commit, which "
        "is more than this server inspects."
    )
    with checkout(
        source(origin), branch="main", root=str(root), max_bytes=4_000_000
    ) as found:
        assert found.size == 3_000_006


def test_a_download_larger_than_allowed_is_stopped(tmp_path: Path, root: Path) -> None:
    origin = tmp_path / "origin"
    repository(origin, {"noise.bin": os.urandom(3_000_000)})
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(origin), branch="main", root=str(root), max_bytes=1_000_000),
    ):
        pass
    assert refused.value.permanent
    assert refused.value.reason == (
        "The repository is more than 1 MB to download at this commit, which "
        "is more than this server inspects."
    )


def test_a_commit_with_more_files_than_allowed_is_refused(
    tmp_path: Path, root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    origin = tmp_path / "origin"
    repository(origin, {f"f{number}.txt": "x\n" for number in range(8)})
    monkeypatch.setattr(workspace, "MAX_ENTRIES", 7)
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(origin), branch="main", root=str(root)),
    ):
        pass
    assert refused.value.permanent
    assert "more than 7 files" in refused.value.reason
    monkeypatch.setattr(workspace, "MAX_ENTRIES", 8)
    with checkout(source(origin), branch="main", root=str(root)) as found:
        assert found.files == 8


def test_a_branch_without_commits_is_refused_for_good(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main", ".")
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(origin), branch="main", root=str(root)),
    ):
        pass
    assert refused.value.permanent
    assert refused.value.reason == (
        "The repository's default branch has no commits, so there is nothing "
        "to inspect."
    )


def test_a_branch_named_to_look_like_another_is_not_taken_for_it(
    tmp_path: Path, root: Path
) -> None:
    origin = tmp_path / "origin"
    wanted = repository(origin, {"README.md": "# The real one\n"})
    git(origin, "checkout", "-q", "-b", "a/refs/heads/main")
    write(origin, {"README.md": "# The impostor\n"})
    commit(origin)
    with checkout(source(origin), branch="main", root=str(root)) as found:
        assert found.commit == wanted
    # And with only the impostor there, there is no such branch.
    git(origin, "branch", "-q", "-D", "main")
    with (
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(origin), branch="main", root=str(root)),
    ):
        pass
    assert refused.value.permanent


def test_a_source_that_cannot_be_reached_may_be_tried_again(
    tmp_path: Path, root: Path, caplog: pytest.LogCaptureFixture
) -> None:
    missing = tmp_path / "nowhere"
    with (
        caplog.at_level(logging.WARNING, logger="forgemind.workspace"),
        pytest.raises(RepositoryUnavailable) as refused,
        checkout(source(missing), branch="main", root=str(root)),
    ):
        pass
    assert not refused.value.permanent
    # What git said is for the log. People get a sentence.
    assert refused.value.reason == "The repository could not be reached to clone it."
    [record] = caplog.records
    assert record.__dict__["step"] == "ls-remote"
    assert "nowhere" in record.__dict__["output"]


@pytest.mark.parametrize(
    "url",
    [
        "ssh://git@github.com/acme/thing.git",
        "git://github.com/acme/thing.git",
        "ext::sh -c touch% /tmp/pwned",
        "/a/plain/path",
        "-u/tmp/pwned",
    ],
)
def test_only_addresses_this_server_clones_from_are_accepted(
    url: str, root: Path
) -> None:
    with (
        pytest.raises(ValueError),
        checkout(CloneSource(url), branch="main", root=str(root)),
    ):
        pass


def test_the_whole_checkout_has_one_deadline(root: Path) -> None:
    """A server that accepts and then says nothing."""
    with socket.socket() as silent:
        silent.bind(("127.0.0.1", 0))
        silent.listen(8)
        url = f"http://127.0.0.1:{silent.getsockname()[1]}/acme/thing.git"
        started = time.monotonic()
        with (
            pytest.raises(RepositoryUnavailable) as refused,
            checkout(CloneSource(url), branch="main", root=str(root), seconds=1.5),
        ):
            pass
        assert time.monotonic() - started < 10
    assert not refused.value.permanent
    assert refused.value.reason == (
        "Cloning the repository took longer than this server allows."
    )
    # Git and the helper it started are both gone.
    waited = time.monotonic() + 5
    while running_under(root) and time.monotonic() < waited:
        time.sleep(0.05)
    assert running_under(root) == []


# A checkout by a process of its own, which gives the system one second past
# the deadline where a server gives it five.
ALONE = """
import sys
from forgemind_api import workspace

workspace.OUTLIVED_SECONDS = 1
with workspace.checkout(
    workspace.CloneSource(sys.argv[1]), branch="main", root=sys.argv[2], seconds=2
):
    pass
"""


def asking_the_server(directory: Path) -> bool:
    """Whether a git under `directory` has got as far as speaking HTTP."""
    for pid in running_under(directory):
        try:
            command = Path(f"/proc/{pid}/cmdline").read_bytes()
        except OSError:
            continue
        if b"remote-http" in command:
            return True
    return False


def test_a_git_whose_worker_was_killed_ends_at_the_deadline_all_the_same(
    tmp_path: Path,
) -> None:
    """Killed, a worker ends nothing it started: the deadline it was keeping
    has to be kept by something else."""
    directory = tmp_path / "workspaces"
    directory.mkdir()
    with socket.socket() as silent:
        silent.bind(("127.0.0.1", 0))
        silent.listen(8)
        url = f"http://127.0.0.1:{silent.getsockname()[1]}/acme/thing.git"
        worker = subprocess.Popen([sys.executable, "-c", ALONE, url, str(directory)])
        try:
            waited = time.monotonic() + 20
            while not asking_the_server(directory) and time.monotonic() < waited:
                assert worker.poll() is None
                time.sleep(0.02)
            assert asking_the_server(directory)
            worker.kill()
            worker.wait(10)
            # Git is still there, waiting on a server that says nothing.
            assert asking_the_server(directory)
            waited = time.monotonic() + 10
            while running_under(directory) and time.monotonic() < waited:
                time.sleep(0.05)
            assert running_under(directory) == []
        finally:
            worker.kill()
            for pid in running_under(directory):
                os.kill(pid, signal.SIGKILL)
    # What it left is removed later, as any dead worker's workspace is.
    [left] = directory.iterdir()
    workspace.remove(left)


def test_what_dead_workers_left_behind_is_removed(tmp_path: Path) -> None:
    origin = tmp_path / "origin"
    repository(origin, {"README.md": "# One\n", "src/a.py": "x\n"})
    root = tmp_path / "workspaces"
    abandoned = root / f"{workspace.PREFIX}abandoned"
    with checkout(source(origin), branch="main", root=str(root)) as found:
        # As a killed worker leaves it: sealed, and never cleaned up.
        subprocess.run(["cp", "-a", str(found.path.parent), str(abandoned)], check=True)
        current = found.path.parent
        old = time.time() - 300 - workspace.STALE_MARGIN_SECONDS - 5
        os.utime(abandoned, (old, old))
        recent = root / f"{workspace.PREFIX}recent"
        recent.mkdir()
        unrelated = root / "someone-elses"
        unrelated.mkdir()
        os.utime(unrelated, (old, old))
        a_file = root / f"{workspace.PREFIX}a-file"
        a_file.write_text("not a directory")
        os.utime(a_file, (old, old))
        assert workspace.remove_stale(str(root), 300) == 1
        assert sorted(os.listdir(root)) == sorted(
            [current.name, recent.name, unrelated.name, a_file.name]
        )
    assert workspace.remove_stale(str(tmp_path / "missing"), 300) == 0
