"""Indexing a connected repository: one worker reads it whatever the queue
does, and only the worker it still belongs to writes down what was found."""

from __future__ import annotations

import contextlib
import logging
import os
import socket
import time
import uuid
from collections.abc import Callable, Generator, Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api import indexing
from forgemind_api.auth import now, principal_for_token
from forgemind_api.db import run_after_commit
from forgemind_api.github import UNREACHABLE, SimulatedGitHub
from forgemind_api.indexing import (
    INDEXING,
    INTERNAL,
    NOT_INSTALLED,
    Claimed,
    Failure,
    Found,
    claim,
    conclude,
    exhausted,
    index_repository,
    indexing_heartbeat,
    sweep_indexing,
)
from forgemind_api.inspection import Inspection, inspect_tree
from forgemind_api.leases import Heartbeat
from forgemind_api.models import Repository, RepositoryAnalysis
from forgemind_api.queue import Dispatcher
from forgemind_api.repositories import (
    SUSPENDED,
    analysis_of,
    connect_repository,
    disconnect_repository,
    handle_webhook,
)
from forgemind_api.settings import Settings
from forgemind_api.simulated_repositories import TREES
from forgemind_api.workspace import (
    PREFIX,
    STALE_MARGIN_SECONDS,
    CloneSource,
    RepositoryUnavailable,
    remove,
)
from tests.gitrepos import commit, git, repository, write
from tests.workers import QUIET, Flaky, Recorder, settings_for

Sessions = sessionmaker[Session]

# A repository the seeded installation can see and nobody has connected, and
# the commit its files make.
DOCS = 811006
DOCS_COMMIT = "e718b4f3e4533b30ab174781e4bbbb7c3cd9a878"
# Another, and the installation that sees them both.
INFRA = 811007
INSTALLATION = 1001
GONE = "The repository was deleted."


class Scripted(SimulatedGitHub):
    """The simulated GitHub, which first does what a test tells it to each
    time a worker asks it for a repository, and hands out the repository the
    test made instead of its own if there is one."""

    def __init__(self, root: Path) -> None:
        super().__init__(
            "", "", lambda installation_id: "forgemind", workspace_root=str(root)
        )
        self.before: Callable[[], None] = lambda: None
        self.instead: CloneSource | None = None
        self.asked = 0

    @contextlib.contextmanager
    def clone_access(
        self, installation_id: int, full_name: str
    ) -> Generator[CloneSource]:
        self.asked += 1
        self.before()
        if self.instead is not None:
            yield self.instead
            return
        with super().clone_access(installation_id, full_name) as source:
            yield source


class Killed(BaseException):
    """What ends a worker without asking it."""


@pytest.fixture
def root(tmp_path: Path) -> Iterator[Path]:
    """Where repositories are cloned to. Nothing may be left in it."""
    directory = tmp_path / "workspaces"
    directory.mkdir()
    yield directory
    assert os.listdir(directory) == []


@pytest.fixture
def settings(own_database_url: str, root: Path) -> Settings:
    return settings_for(own_database_url, workspace_root=str(root))


@pytest.fixture
def github(root: Path) -> Scripted:
    return Scripted(root)


def connect(
    sessions: Sessions,
    github: SimulatedGitHub,
    dispatcher: Dispatcher | None = None,
    github_id: int = DOCS,
) -> uuid.UUID:
    """Connects a repository the way the API does, committed. Unless the test
    brings a queue of its own, the request is taken and goes nowhere."""
    with sessions() as db:
        with db.begin():
            repository = connect_repository(
                db,
                principal_for_token(db, "dev-owner"),
                github,
                dispatcher or Recorder(),
                github_id,
                "whatever/the-request-says",
            )
            repository_id = repository.id
        run_after_commit(db)
    return repository_id


def disconnect(sessions: Sessions, repository_id: uuid.UUID) -> None:
    with sessions() as db, db.begin():
        disconnect_repository(
            db, principal_for_token(db, "dev-owner"), str(repository_id)
        )


def repository_of(sessions: Sessions, repository_id: uuid.UUID) -> Repository:
    with sessions() as db:
        return db.get_one(Repository, repository_id)


def analyses_of(
    sessions: Sessions, repository_id: uuid.UUID
) -> list[RepositoryAnalysis]:
    with sessions() as db:
        return list(
            db.scalars(
                select(RepositoryAnalysis).where(
                    RepositoryAnalysis.repository_id == repository_id
                )
            )
        )


def change(sessions: Sessions, repository_id: uuid.UUID, **values: object) -> None:
    with sessions() as db, db.begin():
        db.execute(
            update(Repository).where(Repository.id == repository_id).values(**values)
        )


def waiting(repository: Repository) -> tuple[str, str | None, str | None, bool]:
    """Whether the repository waits to be indexed, who has it, and whether
    the next sweep is to queue it at once."""
    return (
        repository.status,
        repository.status_message,
        repository.index_worker_id,
        repository.index_dispatched_at is None,
    )


def unreachable() -> None:
    raise RepositoryUnavailable(UNREACHABLE, permanent=False)


def found(tmp_path: Path) -> Found:
    """What a worker would have found in a small repository."""
    tree = tmp_path / "tree"
    write(tree, {"README.md": "# Thing\n", "thing.py": "x = 1\n"})
    return Found("c" * 40, 2, 17, inspect_tree(tree))


# --- asking for a repository to be indexed


def test_connecting_leaves_the_repository_waiting_and_queues_it_after_the_commit(
    sessions: Sessions, github: Scripted
) -> None:
    queue = Recorder()
    with sessions() as db:
        with db.begin():
            repository = connect_repository(
                db, principal_for_token(db, "dev-owner"), github, queue, DOCS, "x/y"
            )
            repository_id = repository.id
            # A worker told now could not see the repository yet.
            assert queue.indexing == []
        run_after_commit(db)
    assert queue.indexing == [repository_id]
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, None, False)
    assert stored.index_attempts == 0
    # What GitHub says of it, not what the request did, and nothing read yet.
    assert stored.full_name == "forgemind/docs"
    assert stored.languages == []
    assert stored.last_analyzed_commit is None
    assert github.asked == 0


def test_a_connection_that_does_not_commit_queues_nothing(
    sessions: Sessions, github: Scripted
) -> None:
    queue = Recorder()
    with sessions() as db, pytest.raises(RuntimeError), db.begin():
        connect_repository(
            db, principal_for_token(db, "dev-owner"), github, queue, DOCS, "x/y"
        )
        raise RuntimeError("the request failed after all")
    assert queue.indexing == []


def test_a_connection_the_queue_refuses_is_queued_by_the_next_sweep(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github, Recorder(accepts=False))
    assert waiting(repository_of(sessions, repository_id)) == (
        "analyzing",
        INDEXING,
        None,
        True,
    )
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "queued": 1}
    assert queue.indexing == [repository_id]
    # And not again by the sweep after that.
    assert sweep_indexing(sessions, settings, queue) == QUIET


# --- a delivery


def test_a_delivered_repository_is_cloned_inspected_and_connected(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    before = now()
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("connected", None, None, True)
    assert stored.index_heartbeat_at is None and stored.index_attempts == 1
    assert stored.last_analyzed_commit == DOCS_COMMIT
    assert stored.last_analyzed_at is not None and stored.last_analyzed_at >= before
    assert stored.languages[0]["name"] == "MDX"
    [analysis] = analyses_of(sessions, repository_id)
    assert analysis.commit == DOCS_COMMIT
    assert analysis.analyzed_at == stored.last_analyzed_at
    assert analysis.data["frameworks"] == ["Next.js", "Nextra", "React"]
    assert analysis.data["buildCommands"] == ["pnpm build"]
    for document in analysis.data["documentation"]:
        assert document["path"] in TREES["forgemind/docs"]
    assert "nothing in the repository was run" in analysis.summary


def test_a_repository_already_indexed_is_not_read_again(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    first = repository_of(sessions, repository_id)
    assert index_repository(sessions, repository_id, settings, github) == "skipped"
    assert github.asked == 1
    assert repository_of(sessions, repository_id).last_analyzed_at == (
        first.last_analyzed_at
    )
    assert len(analyses_of(sessions, repository_id)) == 1


def test_a_delivery_that_arrives_while_another_is_at_work_leaves_it_alone(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    meanwhile: list[str] = []

    def deliver_again() -> None:
        if github.asked == 1:
            meanwhile.append(
                index_repository(sessions, repository_id, settings, github)
            )

    github.before = deliver_again
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    assert meanwhile == ["held"]
    assert github.asked == 1
    assert repository_of(sessions, repository_id).index_attempts == 1


def test_a_delivery_for_no_repository_is_nothing_to_do(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    assert index_repository(sessions, uuid.uuid4(), settings, github) == "missing"
    assert github.asked == 0


def test_a_repository_that_cannot_be_read_says_why_and_is_not_tried_again(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)

    def deleted() -> None:
        raise RepositoryUnavailable(GONE, permanent=True)

    github.before = deleted
    assert index_repository(sessions, repository_id, settings, github) == "failed"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("error", GONE, None, True)
    assert stored.last_analyzed_commit is None
    assert analyses_of(sessions, repository_id) == []
    later = now() + timedelta(days=1)
    assert sweep_indexing(sessions, settings, Recorder(), at=later) == QUIET
    assert index_repository(sessions, repository_id, settings, github) == "skipped"
    assert github.asked == 1


def test_a_failure_that_may_pass_is_tried_again_later_and_only_so_often(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    queue = Recorder()
    repository_id = connect(sessions, github, queue)
    github.before = unreachable
    for attempt in (1, 2):
        assert index_repository(sessions, repository_id, settings, github) == "retry"
        stored = repository_of(sessions, repository_id)
        assert waiting(stored) == ("analyzing", INDEXING, None, False)
        assert stored.index_attempts == attempt
        # Not at once: what was in the way is given time to pass.
        assert sweep_indexing(sessions, settings, queue) == QUIET
        soon = now() + timedelta(seconds=settings.worker_redispatch_seconds - 5)
        assert sweep_indexing(sessions, settings, queue, at=soon) == QUIET
        later = now() + timedelta(seconds=settings.worker_redispatch_seconds + 1)
        assert sweep_indexing(sessions, settings, queue, at=later) == {
            **QUIET,
            "queued": 1,
        }
        assert queue.indexing == [repository_id] * (attempt + 1)
    assert index_repository(sessions, repository_id, settings, github) == "failed"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("error", f"{UNREACHABLE} Tried 3 times.", None, True)
    assert github.asked == 3 == settings.worker_max_attempts
    later = now() + timedelta(days=1)
    assert sweep_indexing(sessions, settings, queue, at=later) == QUIET


def test_a_failure_that_passes_is_forgotten(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    github.before = unreachable
    assert index_repository(sessions, repository_id, settings, github) == "retry"
    github.before = lambda: None
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("connected", None, None, True)
    assert stored.index_attempts == 2


def test_a_fault_of_this_servers_is_logged_and_shown_as_no_more_than_that(
    sessions: Sessions,
    own_database_url: str,
    root: Path,
    github: Scripted,
    caplog: pytest.LogCaptureFixture,
) -> None:
    settings = settings_for(
        own_database_url, workspace_root=str(root), worker_max_attempts=1
    )
    repository_id = connect(sessions, github)

    def broken() -> None:
        raise RuntimeError("password=hunter2 leaked into a message")

    github.before = broken
    with caplog.at_level(logging.ERROR, logger="forgemind_api.indexing"):
        assert index_repository(sessions, repository_id, settings, github) == "failed"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("error", f"{INTERNAL} Tried 1 time.", None, True)
    [record] = caplog.records
    assert record.message == "indexing stopped on an internal error"
    assert record.exc_info is not None
    assert "hunter2" in str(record.exc_info[1])
    assert record.__dict__["repository_id"] == str(repository_id)


def test_a_repository_disconnected_meanwhile_is_left_disconnected(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    github.before = lambda: disconnect(sessions, repository_id)
    assert index_repository(sessions, repository_id, settings, github) == "lost"
    stored = repository_of(sessions, repository_id)
    assert (stored.status, stored.status_message) == ("revoked", "Access revoked")
    assert stored.last_analyzed_commit is None and stored.languages == []
    assert analyses_of(sessions, repository_id) == []


def test_a_repository_connected_again_meanwhile_belongs_to_the_new_request(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    queue = Recorder()
    repository_id = connect(sessions, github, queue)

    def reconnect() -> None:
        if github.asked == 1:
            disconnect(sessions, repository_id)
            assert connect(sessions, github, queue) == repository_id

    github.before = reconnect
    assert index_repository(sessions, repository_id, settings, github) == "lost"
    stored = repository_of(sessions, repository_id)
    # Exactly as the new request left it: waiting, untried, and queued.
    assert waiting(stored) == ("analyzing", INDEXING, None, False)
    assert stored.index_attempts == 0
    assert stored.last_analyzed_commit is None
    assert analyses_of(sessions, repository_id) == []
    assert queue.indexing == [repository_id, repository_id]
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    assert repository_of(sessions, repository_id).index_attempts == 1


def test_only_the_worker_that_holds_the_repository_writes_what_it_found(
    sessions: Sessions, settings: Settings, github: Scripted, tmp_path: Path
) -> None:
    repository_id = connect(sessions, github)
    with sessions() as db, db.begin():
        assert isinstance(claim(db, repository_id, "one", settings), Claimed)
    outcome = found(tmp_path)
    assert conclude(sessions, repository_id, "two", settings, outcome) == "lost"
    gone = Failure(GONE, permanent=True)
    assert conclude(sessions, repository_id, "two", settings, gone) == "lost"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, "one", False)
    assert stored.last_analyzed_commit is None
    assert analyses_of(sessions, repository_id) == []
    assert conclude(sessions, repository_id, "one", settings, outcome) == "indexed"
    assert repository_of(sessions, repository_id).last_analyzed_commit == "c" * 40
    # It is nobody's now, and nothing more is written to it.
    assert conclude(sessions, repository_id, "one", settings, gone) == "lost"
    assert repository_of(sessions, repository_id).status == "connected"


def test_a_worker_whose_repository_was_taken_over_writes_nothing(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    github.before = lambda: change(
        sessions, repository_id, index_worker_id="another", index_heartbeat_at=now()
    )
    assert index_repository(sessions, repository_id, settings, github) == "lost"
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, "another", False)
    assert stored.last_analyzed_commit is None
    assert analyses_of(sessions, repository_id) == []


def test_a_heartbeat_notices_that_the_repository_is_no_longer_held(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    with sessions() as db, db.begin():
        assert isinstance(claim(db, repository_id, "one", settings), Claimed)
    first = repository_of(sessions, repository_id).index_heartbeat_at
    assert first is not None
    heartbeat = indexing_heartbeat(sessions, repository_id, "one", 0.05)
    heartbeat.start()
    try:
        time.sleep(0.3)
        proved = repository_of(sessions, repository_id).index_heartbeat_at
        assert proved is not None and proved > first
        assert not heartbeat.lost.is_set()
        disconnect(sessions, repository_id)
        assert heartbeat.lost.wait(5)
    finally:
        heartbeat.stop()
    # Another worker's heartbeat proves nothing for this one.
    stranger = indexing_heartbeat(sessions, repository_id, "two", 0.05)
    stranger.start()
    try:
        assert stranger.lost.wait(5)
    finally:
        stranger.stop()


def test_a_worker_that_learns_it_lost_the_repository_reads_no_further(
    sessions: Sessions,
    settings: Settings,
    github: Scripted,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """It would have nothing to write what it found to."""
    beating: list[Heartbeat] = []
    noticed: list[bool] = []
    read: list[Path] = []

    def heartbeat(
        sessions: Sessions, repository_id: uuid.UUID, holder: str, seconds: float
    ) -> Heartbeat:
        beating.append(indexing_heartbeat(sessions, repository_id, holder, seconds))
        return beating[-1]

    def inspect(tree: Path) -> Inspection:
        read.append(tree)
        return inspect_tree(tree)

    monkeypatch.setattr(indexing, "indexing_heartbeat", heartbeat)
    monkeypatch.setattr(indexing, "inspect_tree", inspect)
    repository_id = connect(sessions, github)

    def lose() -> None:
        disconnect(sessions, repository_id)
        noticed.append(beating[-1].lost.wait(5))

    github.before = lose
    assert index_repository(sessions, repository_id, settings, github) == "lost"
    assert noticed == [True]
    assert read == []
    # One it still holds is read.
    github.before = lambda: None
    held = connect(sessions, github, github_id=INFRA)
    assert index_repository(sessions, held, settings, github) == "indexed"
    assert len(read) == 1


def test_a_slow_clone_is_not_taken_from_the_worker_doing_it(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    """Longer than a worker may stay quiet, and never quiet."""
    repository_id = connect(sessions, github)
    meanwhile: list[object] = []

    def slow() -> None:
        time.sleep(settings.worker_stale_seconds * 1.6)
        meanwhile.append(sweep_indexing(sessions, settings, Recorder()))
        with sessions() as db, db.begin():
            meanwhile.append(claim(db, repository_id, "another", settings))

    github.before = slow
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    assert meanwhile == [QUIET, "held"]
    assert repository_of(sessions, repository_id).index_attempts == 1


def test_a_delivery_ended_from_outside_gives_the_repository_back_at_once(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)

    def killed() -> None:
        raise Killed

    github.before = killed
    with pytest.raises(Killed):
        index_repository(sessions, repository_id, settings, github)
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, None, True)
    assert stored.index_heartbeat_at is None and stored.index_attempts == 1
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "queued": 1}
    assert queue.indexing == [repository_id]


def test_a_database_that_goes_away_leaves_a_claim_that_lapses(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    flaky = Flaky(**sessions.kw)

    def lose_the_database() -> None:
        flaky.broken = True

    github.before = lose_the_database
    with pytest.raises(OperationalError):
        index_repository(flaky, repository_id, settings, github, worker_id="one")
    # Nothing could be written, not even that the worker gave up.
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, "one", False)
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == QUIET
    later = now() + timedelta(seconds=settings.worker_stale_seconds + 1)
    assert sweep_indexing(sessions, settings, queue, at=later) == {
        **QUIET,
        "recovered": 1,
    }
    assert queue.indexing == [repository_id]


def test_a_repository_whose_app_is_no_longer_installed_cannot_be_read(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    change(sessions, repository_id, installation_id=None)
    assert index_repository(sessions, repository_id, settings, github) == "failed"
    assert waiting(repository_of(sessions, repository_id)) == (
        "error",
        NOT_INSTALLED,
        None,
        True,
    )
    assert github.asked == 0


def test_indexing_again_at_the_same_commit_keeps_one_analysis(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    [first] = analyses_of(sessions, repository_id)
    disconnect(sessions, repository_id)
    assert connect(sessions, github) == repository_id
    again = repository_of(sessions, repository_id)
    # What was found before is still what is known, until it is read again.
    assert waiting(again) == ("analyzing", INDEXING, None, False)
    assert again.last_analyzed_commit == DOCS_COMMIT
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    [second] = analyses_of(sessions, repository_id)
    assert second.id == first.id
    assert second.analyzed_at > first.analyzed_at
    assert repository_of(sessions, repository_id).last_analyzed_at == (
        second.analyzed_at
    )


def test_the_analysis_is_of_the_commit_last_indexed(
    sessions: Sessions, settings: Settings, github: Scripted, tmp_path: Path
) -> None:
    """What was found at earlier commits is kept, and is not what is shown."""
    origin = tmp_path / "origin"
    first = repository(origin, {"main.py": "print('one')\n"})
    write(origin, {"main.go": "package main\n"})
    second = commit(origin)
    github.instead = CloneSource(origin.as_uri())
    repository_id = connect(sessions, github)
    # The branch at its first commit, at its second, and put back.
    for at in (first, second, first):
        git(origin, "reset", "-q", "--hard", at)
        assert index_repository(sessions, repository_id, settings, github) == "indexed"
        with sessions() as db:
            stored = db.get_one(Repository, repository_id)
            assert stored.last_analyzed_commit == at
            assert analysis_of(db, stored).commit == at
        disconnect(sessions, repository_id)
        assert connect(sessions, github) == repository_id
    assert sorted(a.commit for a in analyses_of(sessions, repository_id)) == sorted(
        [first, second]
    )


# --- what a worker is allowed


def test_a_repository_larger_than_this_server_is_set_to_inspect_is_refused(
    sessions: Sessions,
    own_database_url: str,
    root: Path,
    github: Scripted,
    tmp_path: Path,
) -> None:
    origin = tmp_path / "origin"
    at = repository(origin, {"README.md": "# Big\n", "zeros.bin": b"\0" * 3_000_000})
    github.instead = CloneSource(origin.as_uri())

    def allowed(megabytes: int) -> Settings:
        return settings_for(
            own_database_url, workspace_root=str(root), workspace_megabytes=megabytes
        )

    refused = connect(sessions, github)
    assert index_repository(sessions, refused, allowed(2), github) == "failed"
    stored = repository_of(sessions, refused)
    assert waiting(stored) == (
        "error",
        "The repository's files come to more than 2 MB at this commit, which is "
        "more than this server inspects.",
        None,
        True,
    )
    assert analyses_of(sessions, refused) == []
    # The same repository, on a server set to inspect more.
    read = connect(sessions, github, github_id=INFRA)
    assert index_repository(sessions, read, allowed(4), github) == "indexed"
    assert repository_of(sessions, read).last_analyzed_commit == at


def test_a_clone_that_outlasts_what_this_server_is_set_to_allow_is_ended(
    sessions: Sessions, own_database_url: str, root: Path, github: Scripted
) -> None:
    """A server that accepts and then says nothing."""
    settings = settings_for(
        own_database_url, workspace_root=str(root), indexing_seconds=5
    )
    repository_id = connect(sessions, github)
    with socket.socket() as silent:
        silent.bind(("127.0.0.1", 0))
        silent.listen(8)
        github.instead = CloneSource(
            f"http://127.0.0.1:{silent.getsockname()[1]}/acme/thing.git"
        )
        started = time.monotonic()
        assert index_repository(sessions, repository_id, settings, github) == "retry"
        assert time.monotonic() - started < 30
    # It may answer another time, and the worker was the repository's all along.
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, None, False)
    assert stored.index_attempts == 1


def test_what_a_worker_that_died_left_behind_is_removed_by_the_next_to_index(
    sessions: Sessions, settings: Settings, github: Scripted, root: Path
) -> None:
    abandoned = root / f"{PREFIX}abandoned"
    recent = root / f"{PREFIX}recent"
    for left in (abandoned, recent):
        write(left / "tree", {"README.md": "# Left\n"})
    long_ago = time.time() - settings.indexing_seconds - STALE_MARGIN_SECONDS - 5
    os.utime(abandoned, (long_ago, long_ago))
    repository_id = connect(sessions, github)
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    # One that may still be another worker's is not this worker's to remove.
    assert os.listdir(root) == [recent.name]
    remove(recent)


# --- an installation suspended and restored


def told(sessions: Sessions, queue: Dispatcher, action: str) -> str:
    """GitHub saying what happened to the installation, committed."""
    with sessions() as db:
        with db.begin():
            done = handle_webhook(
                db,
                queue,
                "installation",
                {"action": action, "installation": {"id": INSTALLATION}},
            )
        run_after_commit(db)
    return done


def test_an_installation_restored_has_what_was_never_indexed_indexed(
    sessions: Sessions, settings: Settings, github: Scripted, tmp_path: Path
) -> None:
    indexed = connect(sessions, github)
    assert index_repository(sessions, indexed, settings, github) == "indexed"
    never = connect(sessions, github, github_id=INFRA)
    with sessions() as db, db.begin():
        assert isinstance(claim(db, never, "at-work", settings), Claimed)
    queue = Recorder()
    assert told(sessions, queue, "suspend") == "installation suspended"
    for repository_id in (indexed, never):
        stored = repository_of(sessions, repository_id)
        assert (stored.status, stored.status_message) == ("error", SUSPENDED)
    # Nothing is read through a suspended installation, and the worker that
    # was reading has nothing to write.
    assert queue.indexing == []
    assert sweep_indexing(sessions, settings, queue, at=now() + timedelta(days=1)) == (
        QUIET
    )
    assert index_repository(sessions, never, settings, github) == "skipped"
    assert conclude(sessions, never, "at-work", settings, found(tmp_path)) == "lost"

    assert told(sessions, queue, "unsuspend") == "installation restored"
    # What was indexed is as it was. What was not is asked for afresh.
    assert queue.indexing == [never]
    assert waiting(repository_of(sessions, indexed)) == ("connected", None, None, True)
    again = repository_of(sessions, never)
    assert waiting(again) == ("analyzing", INDEXING, None, False)
    assert again.index_attempts == 0
    assert index_repository(sessions, never, settings, github) == "indexed"
    assert repository_of(sessions, never).status == "connected"


def test_a_restored_installation_the_queue_refuses_is_swept(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    never = connect(sessions, github)
    told(sessions, Recorder(), "suspend")
    assert told(sessions, Recorder(accepts=False), "unsuspend") == (
        "installation restored"
    )
    assert waiting(repository_of(sessions, never)) == (
        "analyzing",
        INDEXING,
        None,
        True,
    )
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "queued": 1}
    assert queue.indexing == [never]


# --- the sweeper


def test_a_request_that_never_reached_a_worker_is_queued_again_after_a_while(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github, Recorder())
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == QUIET
    later = now() + timedelta(seconds=settings.worker_redispatch_seconds + 1)
    assert sweep_indexing(sessions, settings, queue, at=later) == {**QUIET, "queued": 1}
    assert queue.indexing == [repository_id]
    # That request is given as long again before another is made.
    assert sweep_indexing(sessions, settings, queue, at=later) == QUIET
    assert repository_of(sessions, repository_id).index_attempts == 0


def test_a_repository_whose_worker_went_quiet_is_queued_again(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    quiet_for = timedelta(seconds=settings.worker_stale_seconds + 1)
    with sessions() as db, db.begin():
        died = claim(db, repository_id, "dead", settings, at=now() - quiet_for)
        assert isinstance(died, Claimed)
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "recovered": 1}
    assert queue.indexing == [repository_id]
    stored = repository_of(sessions, repository_id)
    assert waiting(stored) == ("analyzing", INDEXING, None, False)
    assert index_repository(sessions, repository_id, settings, github) == "indexed"
    assert repository_of(sessions, repository_id).index_attempts == 2


def test_a_worker_still_at_work_is_left_to_it(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    with sessions() as db, db.begin():
        assert isinstance(claim(db, repository_id, "busy", settings), Claimed)
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == QUIET
    assert queue.indexing == []
    assert index_repository(sessions, repository_id, settings, github) == "held"
    assert repository_of(sessions, repository_id).index_worker_id == "busy"
    assert github.asked == 0


def test_a_repository_that_keeps_losing_its_worker_is_stopped(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github)
    quiet_for = timedelta(seconds=settings.worker_stale_seconds + 1)
    queue = Recorder()
    for attempt in (1, 2, 3):
        with sessions() as db, db.begin():
            died = claim(db, repository_id, "dead", settings, at=now() - quiet_for)
            assert isinstance(died, Claimed)
        if attempt < 3:
            assert sweep_indexing(sessions, settings, queue) == {
                **QUIET,
                "recovered": 1,
            }
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "stopped": 1}
    assert queue.indexing == [repository_id, repository_id]
    assert waiting(repository_of(sessions, repository_id)) == (
        "error",
        exhausted(3),
        None,
        True,
    )
    assert exhausted(3) == (
        "No worker finished indexing this repository in 3 attempts, so it was stopped."
    )


def test_a_delivery_past_the_last_attempt_stops_the_repository_too(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    """The sweeper is not the only one who counts."""
    repository_id = connect(sessions, github)
    change(sessions, repository_id, index_attempts=settings.worker_max_attempts)
    assert index_repository(sessions, repository_id, settings, github) == "failed"
    assert waiting(repository_of(sessions, repository_id)) == (
        "error",
        exhausted(3),
        None,
        True,
    )
    assert github.asked == 0


def test_a_sweep_the_queue_refuses_is_made_good_by_the_next(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    repository_id = connect(sessions, github, Recorder(accepts=False))
    refused = sweep_indexing(sessions, settings, Recorder(accepts=False))
    assert refused == {**QUIET, "queued": 1, "undelivered": 1}
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "queued": 1}
    assert queue.indexing == [repository_id]


def test_a_repository_left_waiting_by_an_earlier_version_is_indexed(
    sessions: Sessions, settings: Settings, github: Scripted
) -> None:
    """Before there was a worker to do it, connecting left a repository
    "analyzing" with nothing to say who would."""
    repository_id = connect(sessions, github)
    change(sessions, repository_id, index_dispatched_at=None)
    queue = Recorder()
    assert sweep_indexing(sessions, settings, queue) == {**QUIET, "queued": 1}
    assert index_repository(sessions, queue.indexing[0], settings, github) == "indexed"
    assert repository_of(sessions, repository_id).status == "connected"


def test_repositories_not_waiting_to_be_indexed_are_never_swept(
    sessions: Sessions, settings: Settings
) -> None:
    """The seeded ones: connected, in error and revoked."""
    queue = Recorder()
    later = now() + timedelta(days=1)
    assert sweep_indexing(sessions, settings, queue, at=later) == QUIET
    assert queue.indexing == []
