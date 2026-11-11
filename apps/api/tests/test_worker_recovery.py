"""Real workers, on a real queue, killed while they work. What the plan asks
of this stage: a worker killed mid-run leaves a run that either resumes or
fails, with its events intact."""

from __future__ import annotations

import os
import signal
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api.queue import CeleryDispatcher, make_publisher
from forgemind_api.runstate import run_from_events
from forgemind_api.settings import Settings
from forgemind_api.worker import INTERRUPTED, run_sweeper, sweep
from tests.workers import (
    events_of,
    kill,
    kinds,
    queued_messages,
    queued_run,
    run_of,
    settings_for,
    stage_of,
    task_of,
    wait_for,
    worker_process,
)

Sessions = sessionmaker[Session]

NOT_YET = "The {} stage is not available on this server yet, so the run stopped there."


@pytest.fixture
def settings(own_database_url: str, redis_url: str) -> Settings:
    return settings_for(
        own_database_url,
        redis_url=redis_url,
        worker_heartbeat_seconds=0.2,
        worker_stale_seconds=1.5,
    )


@pytest.fixture
def dispatcher(settings: Settings) -> Iterator[CeleryDispatcher]:
    celery = make_publisher(settings)
    yield CeleryDispatcher(celery)
    celery.close()


def inside(sessions: Sessions, run_id: uuid.UUID, stage: str) -> bool:
    """True once a worker is in the middle of `stage`."""
    return any(
        event["type"] == "log" and event["text"] == f"{stage} at work"
        for event in events_of(sessions, run_id)
    )


def statuses(sessions: Sessions, run_id: uuid.UUID, stage: str) -> list[str]:
    return [a["status"] for a in stage_of(sessions, run_id, stage)["attempts"]]


def test_a_worker_killed_mid_run_leaves_a_run_another_worker_finishes(
    sessions: Sessions,
    settings: Settings,
    dispatcher: CeleryDispatcher,
    tmp_path: Path,
) -> None:
    log, release = tmp_path / "workers.log", tmp_path / "release"
    hold = {"SLOW_HOLD": "inspection", "SLOW_RELEASE": str(release)}
    run_id = queued_run(sessions, dispatcher)

    with worker_process(settings, log, "tests.slow_worker", **hold) as first:
        wait_for(
            lambda: inside(sessions, run_id, "inspection"),
            "the first worker to be part-way through inspection",
            describe=log.read_text,
        )
        before = events_of(sessions, run_id)
        kill(first)

    assert kinds(before) == ["run.started", "stage.started", "log"]
    orphan = run_of(sessions, run_id)
    assert orphan.status == "running" and orphan.worker_id is not None
    assert queued_messages(settings.redis_url or "") == []

    wait_for(
        lambda: sweep(sessions, settings, dispatcher)["recovered"] == 1,
        "the sweeper to see that the worker is gone",
    )
    assert events_of(sessions, run_id) == before
    release.touch()

    with worker_process(settings, log, "tests.slow_worker", **hold):
        wait_for(
            lambda: run_of(sessions, run_id).status == "completed",
            "a second worker to finish the run",
            describe=log.read_text,
        )

    after = events_of(sessions, run_id)
    # Nothing the dead worker recorded was lost, changed or repeated.
    assert after[: len(before)] == before
    assert [event["seq"] for event in after] == list(range(1, len(after) + 1))
    assert kinds(after).count("run.started") == 1
    assert kinds(after).count("run.finished") == 1
    assert after[-1]["type"] == "run.finished"
    assert after[-1]["error"] == NOT_YET.format("implementation")
    resumed, closed = after[len(before) : len(before) + 2]
    assert (resumed["type"], resumed["level"]) == ("log", "warn")
    assert "attempt 2 of 3" in resumed["text"]
    assert (closed["type"], closed["stage"]) == ("stage.finished", "inspection")
    assert (closed["status"], closed["failureReason"]) == ("failed", INTERRUPTED)
    assert statuses(sessions, run_id, "inspection") == ["failed", "passed"]
    assert statuses(sessions, run_id, "planning") == ["passed"]
    run = run_of(sessions, run_id)
    assert (run.attempts, run.worker_id, run.outcome) == (2, None, "failed")
    assert run.state == run_from_events(
        str(run.id), str(run.task_id), run.base_commit, after
    )
    assert task_of(sessions, run_id).status == "failed"


def test_a_run_whose_last_allowed_worker_was_killed_fails_with_its_events_intact(
    sessions: Sessions, own_database_url: str, redis_url: str, tmp_path: Path
) -> None:
    settings = settings_for(
        own_database_url,
        redis_url=redis_url,
        worker_heartbeat_seconds=0.2,
        worker_stale_seconds=1.5,
        worker_max_attempts=1,
    )
    log, release = tmp_path / "workers.log", tmp_path / "release"
    hold = {"SLOW_HOLD": "inspection", "SLOW_RELEASE": str(release)}
    celery = make_publisher(settings)
    dispatcher = CeleryDispatcher(celery)
    run_id = queued_run(sessions, dispatcher)

    with worker_process(settings, log, "tests.slow_worker", **hold) as only:
        wait_for(
            lambda: inside(sessions, run_id, "inspection"),
            "the worker to be part-way through inspection",
            describe=log.read_text,
        )
        before = events_of(sessions, run_id)
        kill(only)

    wait_for(
        lambda: sweep(sessions, settings, dispatcher)["stopped"] == 1,
        "the sweeper to end the run",
    )
    after = events_of(sessions, run_id)
    assert after[: len(before)] == before
    assert kinds(after[len(before) :]) == ["stage.finished", "run.finished"]
    assert after[-2]["failureReason"] == INTERRUPTED
    assert (
        after[-1]["error"]
        == "No worker finished this run in 1 attempt, so it was stopped."
    )
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome, run.worker_id) == ("completed", "failed", None)
    assert run.verification == "unverified"
    assert task_of(sessions, run_id).status == "failed"
    # Ended, not queued for anyone else.
    assert queued_messages(redis_url) == []
    celery.close()


def test_a_stage_that_finished_before_its_worker_died_is_not_run_again(
    sessions: Sessions,
    settings: Settings,
    dispatcher: CeleryDispatcher,
    tmp_path: Path,
) -> None:
    log, release = tmp_path / "workers.log", tmp_path / "release"
    hold = {"SLOW_HOLD": "planning", "SLOW_RELEASE": str(release)}
    run_id = queued_run(sessions, dispatcher)

    with worker_process(settings, log, "tests.slow_worker", **hold) as worker:
        wait_for(
            lambda: inside(sessions, run_id, "planning"),
            "the worker to be part-way through planning",
            describe=log.read_text,
        )
        before = events_of(sessions, run_id)
        # Only the process executing the run dies, as when it runs out of
        # memory. The worker it belongs to lives, and is not told anything.
        executing = int((run_of(sessions, run_id).worker_id or "").split(":")[1])
        assert executing != worker.pid
        assert os.getpgid(executing) == os.getpgid(worker.pid)
        os.kill(executing, signal.SIGKILL)
        release.touch()

        stop = threading.Event()
        sweeper = threading.Thread(target=run_sweeper, args=(settings, stop))
        sweeper.start()
        try:
            wait_for(
                lambda: run_of(sessions, run_id).status == "completed",
                "the run to be continued and finished",
                describe=log.read_text,
            )
        finally:
            stop.set()
            sweeper.join(30)
        assert not sweeper.is_alive()
        assert worker.poll() is None

    after = events_of(sessions, run_id)
    assert after[: len(before)] == before
    assert [event["seq"] for event in after] == list(range(1, len(after) + 1))
    assert statuses(sessions, run_id, "inspection") == ["passed"]
    assert statuses(sessions, run_id, "planning") == ["failed", "passed"]
    inspections = [
        event
        for event in after
        if event["type"] == "stage.started" and event["stage"] == "inspection"
    ]
    assert len(inspections) == 1
    assert kinds(after).count("run.finished") == 1
    assert run_of(sessions, run_id).attempts == 2
