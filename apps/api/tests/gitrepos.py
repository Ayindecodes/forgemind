"""Git repositories for the tests, made with the machine's git and none of
its configuration."""

from __future__ import annotations

import os
import subprocess
import threading
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import TracebackType

ENVIRONMENT = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/nonexistent",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_AUTHOR_NAME": "A Test",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
    "GIT_COMMITTER_NAME": "A Test",
    "GIT_COMMITTER_EMAIL": "test@example.com",
    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
}


def git(directory: Path, *arguments: str) -> str:
    done = subprocess.run(
        ["git", *arguments],
        cwd=directory,
        env=ENVIRONMENT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


def write(directory: Path, files: dict[str, str | bytes]) -> None:
    for path, content in files.items():
        target = directory / path
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content)


def commit(directory: Path, message: str = "A change") -> str:
    """Commits everything in the directory and returns the commit's hash."""
    git(directory, "add", "-A")
    git(directory, "commit", "-q", "--allow-empty", "-m", message)
    return git(directory, "rev-parse", "HEAD")


def repository(
    directory: Path, files: dict[str, str | bytes], branch: str = "main"
) -> str:
    """A new repository holding `files` in one commit, whose hash it returns."""
    directory.mkdir(parents=True, exist_ok=True)
    git(directory, "init", "-q", "-b", branch, ".")
    write(directory, files)
    return commit(directory, "The first commit")


def running_under(directory: Path) -> list[int]:
    """The processes whose working directory is inside `directory`."""
    found: list[int] = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            where = os.readlink(f"/proc/{entry}/cwd")
        except OSError:
            continue
        if where.startswith(str(directory)):
            found.append(int(entry))
    return found


@dataclass(frozen=True)
class Asked:
    """One request a git server was sent, and the status it answered with."""

    method: str
    path: str
    authorization: str | None
    status: int


def backend(
    root: Path, method: str, target: str, headers: dict[str, str], body: bytes
) -> tuple[int, list[tuple[str, str]], bytes]:
    """Hands one request to git's own HTTP backend, as a web server would."""
    path, _, query = target.partition("?")
    environment = {
        "PATH": ENVIRONMENT["PATH"],
        "HOME": "/nonexistent",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_PROJECT_ROOT": str(root),
        "GIT_HTTP_EXPORT_ALL": "1",
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": query,
        "CONTENT_TYPE": headers.get("content-type", ""),
        "CONTENT_LENGTH": str(len(body)),
        "REMOTE_ADDR": "127.0.0.1",
    }
    if "content-encoding" in headers:
        environment["HTTP_CONTENT_ENCODING"] = headers["content-encoding"]
    if "git-protocol" in headers:
        environment["GIT_PROTOCOL"] = headers["git-protocol"]
    done = subprocess.run(
        ["git", "http-backend"],
        input=body,
        env=environment,
        capture_output=True,
        timeout=60,
        check=False,
    )
    assert done.returncode == 0, done.stderr.decode()
    head, _, content = done.stdout.partition(b"\r\n\r\n")
    status = 200
    fields: list[tuple[str, str]] = []
    for line in head.decode().split("\r\n"):
        name, _, value = line.partition(": ")
        if name.lower() == "status":
            status = int(value.split()[0])
        elif name:
            fields.append((name, value))
    return status, fields, content


class GitServer:
    """What GitHub is to a clone: the repositories under `root`, laid out
    owner/name.git, served over HTTP by git's own backend to whoever sends an
    Authorization header that `allows` accepts.

    `during` is called while each request is being answered, which is while
    the git that sent it is running. With `redirect_to`, every request is
    sent on to that origin instead of being answered."""

    def __init__(
        self,
        root: Path,
        allows: Callable[[str | None], bool] = lambda authorization: True,
        during: Callable[[], None] | None = None,
        redirect_to: str | None = None,
    ) -> None:
        self.root = root
        self.allows = allows
        self.during = during
        self.redirect_to = redirect_to
        self.asked: list[Asked] = []
        served = self

        class Handler(BaseHTTPRequestHandler):
            def answer(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                authorization = self.headers.get("Authorization")
                if served.during is not None:
                    served.during()
                fields: list[tuple[str, str]] = []
                content = b""
                if served.redirect_to is not None:
                    status = 302
                    fields = [("Location", f"{served.redirect_to}{self.path}")]
                elif not served.allows(authorization):
                    status = 401
                    fields = [("WWW-Authenticate", 'Basic realm="GitHub"')]
                else:
                    status, fields, content = backend(
                        served.root,
                        self.command,
                        self.path,
                        {name.lower(): value for name, value in self.headers.items()},
                        body,
                    )
                served.asked.append(
                    Asked(self.command, self.path, authorization, status)
                )
                self.send_response(status)
                for name, value in fields:
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            do_GET = answer
            do_POST = answer

            def log_message(self, format: str, *args: object) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def __enter__(self) -> GitServer:
        self._thread.start()
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        error: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(10)
