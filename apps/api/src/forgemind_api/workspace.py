"""Checks a repository out at one commit, into a directory of its own, to be
read and nothing else.

A repository is not trusted, and neither is the machine's own git setup. Git
runs with an environment built here, never the server's: no system or user
configuration, no hooks, no credential helpers, no prompts, no submodules and
only the one protocol the source uses. What authorises the clone travels in
that environment for the one address, so it is never on a command line, in
the repository's configuration or in the workspace.

The work tree holds the commit's regular files and no `.git`: git's own
directory sits beside it. Links are not created, so nothing in the tree can
point outside it. The whole checkout is bounded in time, in the size of what
is downloaded and in the size of what is written, and it is refused before
anything is written if the commit is larger than this server reads. The tree
is then made read-only, and removed when the caller is done.

The deadline is kept twice: by this process, and by the system for each git
it starts, so that a git whose worker was killed does not outlive it for
long."""

from __future__ import annotations

import contextlib
import logging
import math
import os
import re
import select
import shutil
import signal
import stat
import subprocess
import tempfile
import time
from collections.abc import Generator
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit

log = logging.getLogger("forgemind.workspace")

PREFIX = "forgemind-workspace-"
SHA = re.compile(r"^[0-9a-f]{40}$")
SCHEMES = frozenset({"https", "http", "file"})

# The most files one commit may hold, and the longest path among them.
MAX_ENTRIES = 250_000
MAX_PATH_BYTES = 4096

# A workspace left behind by a worker that died is removed once it is this
# much older than any checkout is allowed to take.
STALE_MARGIN_SECONDS = 600

LINK = b"120000"

NO_GIT = "This server has no git to clone repositories with."

# Runs git under a limit on the size of any one file it writes, so that a
# download cannot fill the disk. A write past the limit fails; it does not
# kill git, which then says why.
LIMITED = 'trap "" XFSZ; ulimit -f "$0" || exit 97; exec "$@"'

# How long after the deadline the system ends a git that is still running.
# This process ends it at the deadline; that is for when this process cannot.
OUTLIVED_SECONDS = 5


class RepositoryUnavailable(Exception):
    """A repository could not be cloned. `reason` is for people; `permanent`
    says whether trying again could help."""

    def __init__(self, reason: str, *, permanent: bool) -> None:
        super().__init__(reason)
        self.reason = reason
        self.permanent = permanent


@dataclass(frozen=True)
class CloneSource:
    """Where to clone from, and the Authorization header that allows it."""

    url: str
    authorization: str | None = field(default=None, repr=False)


@dataclass(frozen=True)
class Workspace:
    """A commit's files, read-only, under `path`."""

    path: Path
    commit: str
    files: int
    size: int


class GitFailed(Exception):
    def __init__(self, step: str, status: int, output: str) -> None:
        super().__init__(f"git {step} ended with {status}")
        self.step = step
        self.status = status
        self.output = output


def megabytes(size: int) -> str:
    return f"{size / 1_000_000:,.0f} MB"


def quoted(value: str) -> str:
    """A value as git's configuration format writes it."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


class Git:
    """Git, for one checkout: its own environment, one deadline."""

    def __init__(
        self, base: Path, source: CloneSource, deadline: float, max_bytes: int
    ) -> None:
        binary = shutil.which("git")
        timeout = shutil.which("timeout")
        if binary is None or timeout is None or shutil.which("sh") is None:
            raise RepositoryUnavailable(NO_GIT, permanent=True)
        address = urlsplit(source.url)
        if address.scheme not in SCHEMES:
            raise ValueError(f"cannot clone over {address.scheme or 'no protocol'}")
        self.binary = binary
        self.timeout = timeout
        self.source = source
        self.deadline = deadline
        self.max_bytes = max_bytes
        self.tree = base / "tree"
        home = base / "home"
        home.mkdir()
        self.tree.mkdir()
        settings = [
            "[core]",
            "\thooksPath = /dev/null",
            "\tsymlinks = false",
            "\tfsmonitor = false",
            "\tattributesFile = /dev/null",
            "\texcludesFile = /dev/null",
            "[protocol]",
            "\tallow = never",
            f'[protocol "{address.scheme}"]',
            "\tallow = always",
            "[credential]",
            "\thelper =",
            "[http]",
            "\tfollowRedirects = false",
            "[fetch]",
            "\trecurseSubmodules = false",
            "[submodule]",
            "\trecurse = false",
            "[gc]",
            "\tauto = 0",
            "[maintenance]",
            "\tauto = false",
            "[advice]",
            "\tdetachedHead = false",
        ]
        if address.scheme == "file":
            # A repository on this machine may belong to another account,
            # as a mounted directory does. Reading it is what was asked for.
            settings += ["[safe]", f"\tdirectory = {quoted(unquote(address.path))}"]
        config = base / "gitconfig"
        config.write_text("\n".join(settings) + "\n")
        self.env = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": str(home),
            "XDG_CONFIG_HOME": str(home),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": str(config),
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_DIR": str(base / "git"),
            "GIT_WORK_TREE": str(self.tree),
            "LC_ALL": "C",
        }
        if source.authorization is not None:
            # For this address only, and only in the environment.
            self.env |= {
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": f"http.{source.url}.extraHeader",
                "GIT_CONFIG_VALUE_0": f"Authorization: {source.authorization}",
            }

    def remaining(self) -> float:
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise self.late()
        return left

    def late(self) -> RepositoryUnavailable:
        return RepositoryUnavailable(
            "Cloning the repository took longer than this server allows.",
            permanent=False,
        )

    def start(
        self, arguments: tuple[str, ...], errors: int = subprocess.PIPE
    ) -> subprocess.Popen[bytes]:
        blocks = max(1, self.max_bytes // 512)
        allowed = math.ceil(self.remaining()) + OUTLIVED_SECONDS
        return subprocess.Popen(
            [
                *("sh", "-c", LIMITED, str(blocks)),
                *(self.timeout, "-s", "KILL", str(allowed)),
                self.binary,
                *arguments,
            ],
            env=self.env,
            cwd=self.tree,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=errors,
            # A group of its own, so that the helpers git starts end with it.
            start_new_session=True,
        )

    def stop(self, process: subprocess.Popen[bytes]) -> None:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)

    def run(self, *arguments: str) -> str:
        """Runs one git command to its end, or to the deadline."""
        wait = self.remaining()
        process = self.start(arguments)
        try:
            output, errors = process.communicate(timeout=wait)
        except subprocess.TimeoutExpired:
            self.stop(process)
            process.communicate()
            raise self.late() from None
        except BaseException:
            self.stop(process)
            process.communicate()
            raise
        if process.returncode != 0:
            raise GitFailed(
                arguments[0], process.returncode, errors.decode("utf-8", "replace")
            )
        return output.decode("utf-8", "replace")

    def measure(self, commit: str) -> tuple[int, int, list[bytes]]:
        """Counts what the commit would write, without writing it: its
        files, their size together, and which of them are links. Stops, and
        refuses the repository, as soon as it is more than is allowed."""
        process = self.start(("ls-tree", "-r", "-l", "-z", commit), subprocess.DEVNULL)
        assert process.stdout is not None
        channel = process.stdout.fileno()
        files = size = 0
        links: list[bytes] = []
        pending = b""
        try:
            while True:
                ready, _, _ = select.select([channel], [], [], self.remaining())
                if not ready:
                    raise self.late()
                chunk = os.read(channel, 1 << 16)
                if not chunk:
                    break
                *records, pending = (pending + chunk).split(b"\0")
                if len(pending) > MAX_PATH_BYTES + 128:
                    raise RepositoryUnavailable(
                        "The repository has a path too long for this server to "
                        "check out.",
                        permanent=True,
                    )
                for record in records:
                    described, _, path = record.partition(b"\t")
                    fields = described.split()
                    if len(fields) != 4 or not path:
                        raise GitFailed("ls-tree", 0, repr(record[:200]))
                    files += 1
                    size += int(fields[3]) if fields[3].isdigit() else 0
                    if fields[0] == LINK:
                        links.append(path)
                    if files > MAX_ENTRIES:
                        raise RepositoryUnavailable(
                            f"The repository has more than {MAX_ENTRIES:,} files "
                            "at this commit, which is more than this server "
                            "inspects.",
                            permanent=True,
                        )
                    if size > self.max_bytes:
                        raise RepositoryUnavailable(
                            "The repository's files come to more than "
                            f"{megabytes(self.max_bytes)} at this commit, which is "
                            "more than this server inspects.",
                            permanent=True,
                        )
            status = process.wait(timeout=self.remaining())
        except subprocess.TimeoutExpired:
            raise self.late() from None
        finally:
            self.stop(process)
            process.stdout.close()
            process.wait()
        if status != 0:
            raise GitFailed("ls-tree", status, "")
        return files, size, links


def make_base(root: str | None) -> Path:
    """A new directory for one checkout, private to this account."""
    if root is not None:
        Path(root).mkdir(mode=0o700, parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=PREFIX, dir=root))


def seal(tree: Path) -> None:
    """Takes away the right to write anywhere in the tree."""
    for current, _, names in os.walk(tree, topdown=False, followlinks=False):
        for name in names:
            path = os.path.join(current, name)
            found = os.lstat(path)
            if stat.S_ISREG(found.st_mode):
                os.chmod(path, 0o555 if found.st_mode & 0o100 else 0o444)
        os.chmod(current, 0o555)


def remove(base: Path) -> None:
    """Removes a checkout, sealed or not."""
    for current, _, _ in os.walk(base, followlinks=False):
        with contextlib.suppress(OSError):
            os.chmod(current, 0o700)
    shutil.rmtree(base, ignore_errors=True)


def remove_stale(root: str | None, older_than_seconds: float) -> int:
    """Removes the checkouts that workers which died left behind: this
    account's own, and only those older than any checkout may last."""
    directory = Path(root) if root is not None else Path(tempfile.gettempdir())
    removed = 0
    try:
        candidates = [
            entry for entry in directory.iterdir() if entry.name.startswith(PREFIX)
        ]
    except OSError:
        return 0
    limit = time.time() - older_than_seconds - STALE_MARGIN_SECONDS
    for candidate in candidates:
        try:
            found = candidate.lstat()
        except OSError:
            continue
        if (
            stat.S_ISDIR(found.st_mode)
            and found.st_uid == os.getuid()
            and found.st_mtime < limit
        ):
            remove(candidate)
            removed += 1
    return removed


def drop_links(tree: Path, links: list[bytes]) -> None:
    """Git writes a link, when told not to make one, as a small file holding
    where it pointed. Those are not the repository's files: they go."""
    top = os.fsencode(tree)
    for link in links:
        parts = link.split(b"/")
        if any(part in (b"", b".", b"..") for part in parts):
            continue
        path = os.path.join(top, *parts)
        with contextlib.suppress(OSError):
            if stat.S_ISREG(os.lstat(path).st_mode):
                os.unlink(path)


@contextlib.contextmanager
def checkout(
    source: CloneSource,
    *,
    branch: str | None = None,
    commit: str | None = None,
    root: str | None = None,
    seconds: float = 300,
    max_bytes: int = 512_000_000,
) -> Generator[Workspace]:
    """Checks out `commit`, or the commit `branch` is at, read-only. The
    workspace is removed when the block ends, however it ends."""
    if (branch is None) == (commit is None):
        raise ValueError("a checkout is of a branch or of a commit")
    if commit is not None and not SHA.match(commit):
        raise ValueError("a commit is named by its full hash")
    base = make_base(root)
    try:
        git = Git(base, source, time.monotonic() + seconds, max_bytes)
        try:
            git.run("init", "-q", "--template=", "--object-format=sha1")
            if commit is None:
                wanted = f"refs/heads/{branch}"
                listed = git.run("ls-remote", "--", source.url, wanted)
                # The pattern also matches longer names that end the same way.
                heads: dict[str, str] = {}
                for line in listed.splitlines():
                    found, _, name = line.partition("\t")
                    heads[name] = found
                commit = heads.get(wanted)
                if commit is None:
                    raise RepositoryUnavailable(
                        "The repository's default branch has no commits, so "
                        "there is nothing to inspect.",
                        permanent=True,
                    )
                if not SHA.match(commit):
                    raise GitFailed("ls-remote", 0, listed[:200])
            git.run(
                "fetch",
                "-q",
                "--depth=1",
                "--no-tags",
                "--no-recurse-submodules",
                "--",
                source.url,
                commit,
            )
            files, size, links = git.measure(commit)
            git.run("checkout", "-q", "--detach", commit)
        except GitFailed as failed:
            log.warning(
                "git failed",
                extra={
                    "step": failed.step,
                    "status": failed.status,
                    "output": failed.output[-2000:],
                },
            )
            if "File too large" in failed.output:
                raise RepositoryUnavailable(
                    f"The repository is more than {megabytes(max_bytes)} to "
                    "download at this commit, which is more than this server "
                    "inspects.",
                    permanent=True,
                ) from None
            raise RepositoryUnavailable(
                "The repository could not be checked out."
                if failed.step == "checkout"
                else "The repository could not be reached to clone it.",
                permanent=False,
            ) from None
        drop_links(git.tree, links)
        seal(git.tree)
        yield Workspace(git.tree, commit, files - len(links), size)
    finally:
        remove(base)
