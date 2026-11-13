"""Real workers indexing real clones, from a real queue, with the worker
killed and the request lost: what the unit tests say holds, held by the
processes as they are shipped."""

from __future__ import annotations

import os
import shutil
import signal
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api import workspace
from forgemind_api.app import create_app
from forgemind_api.inspection import inspect_tree
from forgemind_api.models import Repository
from forgemind_api.queue import INDEX_REPOSITORY
from forgemind_api.settings import Settings
from forgemind_api.simulated_repositories import materialise
from tests.gitrepos import running_under
from tests.workers import (
    ask_to_stop,
    kill,
    logged,
    queued_messages,
    settings_for,
    wait_for,
    worker_process,
)

Sessions = sessionmaker[Session]

OWNER = {"cookie": "fm_session=dev-owner"}
DOCS = {"githubId": 811006, "fullName": "forgemind/docs"}


@pytest.fixture
def root(tmp_path: Path) -> Path:
    directory = tmp_path / "workspaces"
    directory.mkdir()
    return directory


@pytest.fixture
def settings(own_database_url: str, redis_url: str, root: Path) -> Settings:
    return settings_for(
        own_database_url,
        redis_url=redis_url,
        worker_heartbeat_seconds=0.2,
        worker_stale_seconds=1.5,
        worker_redispatch_seconds=1,
        workspace_root=str(root),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()


def connect(client: TestClient) -> str:
    created = client.post("/repositories", json=DOCS, headers=OWNER)
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "analyzing"
    identifier: str = created.json()["id"]
    return identifier


def repository(client: TestClient, repository_id: str) -> dict[str, Any]:
    found: dict[str, Any] = client.get(
        f"/repositories/{repository_id}", headers=OWNER
    ).json()
    return found


def attempts(sessions: Sessions, repository_id: str) -> tuple[int, str | None]:
    """How many workers have taken the repository, and who has it now."""
    with sessions() as db:
        stored = db.get_one(Repository, repository_id)
        return stored.index_attempts, stored.index_worker_id


def messages(log: Path, message: str) -> list[dict[str, Any]]:
    return [record for record in logged(log) if record["message"] == message]


def test_the_shipped_worker_indexes_a_repository_connected_through_the_api(
    settings: Settings,
    client: TestClient,
    sessions: Sessions,
    redis_url: str,
    root: Path,
    tmp_path: Path,
) -> None:
    log = tmp_path / "worker.log"
    repository_id = connect(client)
    assert queued_messages(redis_url) == [(INDEX_REPOSITORY, [repository_id])]
    waiting = client.get(f"/repositories/{repository_id}/analysis", headers=OWNER)
    assert waiting.status_code == 404
    with worker_process(settings, log, "forgemind_api", "worker") as worker:
        wait_for(
            lambda: repository(client, repository_id)["status"] == "connected",
            "the worker to index the repository",
            describe=log.read_text,
        )
        wait_for(
            lambda: len(messages(log, "indexing delivery handled")) == 1,
            "the worker to log the delivery",
            describe=log.read_text,
        )
        # Read before the worker is asked to stop: Celery says goodbye in a
        # line of its own that is not a record.
        [ended] = messages(log, "indexing attempt ended")
        [handled] = messages(log, "indexing delivery handled")
        assert ask_to_stop(worker) == 0
    # What is served is what is in the repository, read by this test too.
    commit = materialise("forgemind/docs", tmp_path / "docs")
    shutil.rmtree(tmp_path / "docs" / ".git")
    expected = inspect_tree(tmp_path / "docs")
    indexed = repository(client, repository_id)
    assert indexed["statusMessage"] is None
    assert indexed["lastAnalyzedCommit"] == commit
    assert indexed["languages"] == expected.languages
    analysis = client.get(f"/repositories/{repository_id}/analysis", headers=OWNER)
    assert analysis.status_code == 200, analysis.text
    served = analysis.json()
    assert served["analyzedAt"] == indexed["lastAnalyzedAt"]
    assert {
        **served,
        "analyzedAt": None,
    } == {
        **expected.data,
        "repositoryId": repository_id,
        "commit": commit,
        "analyzedAt": None,
        "summary": expected.summary,
    }
    assert (ended["repository_id"], ended["verdict"], ended["commit"]) == (
        repository_id,
        "indexed",
        commit,
    )
    assert ended["files"] > 0 and ended["bytes"] > 0
    assert handled["verdict"] == "indexed"
    assert attempts(sessions, repository_id) == (1, None)
    assert os.listdir(root) == []
    assert queued_messages(redis_url) == []


def test_a_worker_killed_while_cloning_leaves_a_repository_another_worker_indexes(
    settings: Settings,
    client: TestClient,
    sessions: Sessions,
    root: Path,
    tmp_path: Path,
) -> None:
    """The first worker's git never finishes fetching, and the worker is
    killed while it waits."""
    real = shutil.which("git")
    assert real is not None
    held = tmp_path / "held"
    programs = tmp_path / "bin"
    programs.mkdir()
    (programs / "git").write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = fetch ] && mkdir "{held}" 2>/dev/null; then\n'
        "    exec sleep 600\n"
        "fi\n"
        f'exec "{real}" "$@"\n'
    )
    (programs / "git").chmod(0o755)
    path = f"{programs}:{os.environ['PATH']}"
    log, sweeps = tmp_path / "worker.log", tmp_path / "sweeper.log"
    repository_id = connect(client)
    try:
        with worker_process(settings, log, "forgemind_api", "worker", PATH=path) as one:
            wait_for(held.exists, "git to start fetching", describe=log.read_text)
            taken, first = attempts(sessions, repository_id)
            assert taken == 1 and first is not None
            kill(one)
        # Killed, it ended nothing it had started.
        assert running_under(root)
        assert repository(client, repository_id)["status"] == "analyzing"
        with (
            worker_process(settings, sweeps, "forgemind_api", "sweeper"),
            worker_process(settings, log, "forgemind_api", "worker", PATH=path),
        ):
            wait_for(
                lambda: repository(client, repository_id)["status"] == "connected",
                "another worker to index the repository",
                describe=lambda: log.read_text() + sweeps.read_text(),
            )
            wait_for(
                lambda: len(messages(log, "indexing attempt ended")) == 1,
                "the second worker to log what it did",
                describe=log.read_text,
            )
    finally:
        # The git that would have gone on fetching until its deadline.
        for pid in running_under(root):
            os.kill(pid, signal.SIGKILL)
    assert attempts(sessions, repository_id) == (2, None)
    indexed = repository(client, repository_id)
    assert indexed["lastAnalyzedCommit"] is not None and indexed["languages"]
    analysis = client.get(f"/repositories/{repository_id}/analysis", headers=OWNER)
    assert analysis.status_code == 200
    assert analysis.json()["commit"] == indexed["lastAnalyzedCommit"]
    [lost] = messages(sweeps, "indexing lost its worker")
    assert (lost["repository_id"], lost["worker_id"]) == (repository_id, first)
    [swept] = messages(sweeps, "swept indexing")
    assert (swept["recovered"], swept["stopped"]) == (1, 0)
    [ended] = messages(log, "indexing attempt ended")
    assert ended["verdict"] == "indexed"
    # The worker that finished left nothing. The dead one left its checkout
    # and the repository the simulated GitHub had made for it to clone, and
    # both go when they are older than any checkout may last.
    left = [root / name for name in os.listdir(root)]
    assert sorted(sorted(os.listdir(path)) for path in left) == [
        ["git", "gitconfig", "home", "tree"],
        ["source"],
    ]
    assert workspace.remove_stale(str(root), settings.indexing_seconds) == 0
    long_ago = time.time() - settings.indexing_seconds - 3600
    for path in left:
        os.utime(path, (long_ago, long_ago))
    assert workspace.remove_stale(str(root), settings.indexing_seconds) == 2
    assert os.listdir(root) == []


def test_a_request_the_queue_lost_is_made_again_by_the_shipped_sweeper(
    settings: Settings,
    client: TestClient,
    sessions: Sessions,
    redis_url: str,
    root: Path,
    tmp_path: Path,
) -> None:
    log, sweeps = tmp_path / "worker.log", tmp_path / "sweeper.log"
    repository_id = connect(client)
    queue = Redis.from_url(redis_url)  # pyright: ignore[reportUnknownMemberType]
    queue.flushdb()  # pyright: ignore[reportUnknownMemberType]
    queue.close()
    assert queued_messages(redis_url) == []
    with (
        worker_process(settings, sweeps, "forgemind_api", "sweeper") as sweeper,
        worker_process(settings, log, "forgemind_api", "worker"),
    ):
        wait_for(
            lambda: repository(client, repository_id)["status"] == "connected",
            "the sweeper to ask again and a worker to index the repository",
            describe=lambda: log.read_text() + sweeps.read_text(),
        )
        assert ask_to_stop(sweeper) == 0
    [swept] = messages(sweeps, "swept indexing")
    assert (swept["queued"], swept["recovered"], swept["undelivered"]) == (1, 0, 0)
    assert attempts(sessions, repository_id) == (1, None)
    assert os.listdir(root) == []
