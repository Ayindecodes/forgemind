"""A worker executing runs in this process: what it records, what it will not
repeat, and what becomes of a run whose worker is gone."""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api.models import Run
from forgemind_api.pipeline import StageFailed, StepContext
from forgemind_api.runstate import run_from_events
from forgemind_api.settings import Settings
from forgemind_api.worker import (
    execute_run,
)
from tests.workers import (
    Scripted,
    events_of,
    kinds,
    queued_run,
    run_of,
    says,
    settings_for,
    task_of,
)

Sessions = sessionmaker[Session]

NOT_YET = "The {} stage is not available on this server yet, so the run stopped there."
LINE = {"level": "info", "text": "written by a worker that should have stopped"}


@pytest.fixture
def settings(own_database_url: str) -> Settings:
    return settings_for(own_database_url)


def take_from_its_worker(sessions: Sessions, run_id: uuid.UUID) -> None:
    """What another worker's claim does to the lease."""
    with sessions() as db, db.begin():
        db.execute(
            update(Run).where(Run.id == run_id).values(worker_id="another-worker")
        )


# --- executing


def test_a_queued_run_is_started_and_stops_where_this_server_cannot_go_on(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    assert execute_run(sessions, run_id, settings) == "executed"
    events = events_of(sessions, run_id)
    run = run_of(sessions, run_id)
    assert kinds(events) == ["run.started", "run.finished"]
    assert events[0]["baseCommit"] == run.base_commit
    assert events[0]["branch"] is None
    assert events[0]["expectsPatch"] is True and events[0]["maxRetries"] == 2
    assert events[1]["status"] == "completed"
    assert events[1]["error"] == NOT_YET.format("inspection")
    # Nothing ran, so nothing is claimed: failed, and never verified.
    assert (run.status, run.outcome) == ("completed", "failed")
    assert run.verification == "unverified"
    assert {stage["status"] for stage in run.state["stages"]} == {"skipped"}
    assert (run.worker_id, run.heartbeat_at, run.attempts) == (None, None, 1)
    assert task_of(sessions, run_id).status == "failed"


def test_an_investigation_is_started_as_a_run_that_expects_no_patch(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions, category="investigate")
    assert execute_run(sessions, run_id, settings) == "executed"
    assert events_of(sessions, run_id)[0]["expectsPatch"] is False


def test_stages_run_in_order_and_each_ones_start_and_end_are_recorded(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    pipeline = [
        Scripted("inspection", says("Read 12 files"), agent="architect"),
        Scripted("planning", says("Three steps")),
    ]
    assert execute_run(sessions, run_id, settings, pipeline) == "executed"
    events = events_of(sessions, run_id)
    assert kinds(events) == [
        "run.started",
        "stage.started",
        "log",
        "stage.finished",
        "stage.started",
        "log",
        "stage.finished",
        "run.finished",
    ]
    assert [event["seq"] for event in events] == list(range(1, 9))
    assert (events[1]["stage"], events[1]["attempt"]) == ("inspection", 1)
    assert events[1]["agent"] == "architect" and events[4]["agent"] is None
    assert (events[3]["status"], events[3]["summary"]) == ("passed", "Read 12 files")
    assert events[3]["failureReason"] is None
    assert events[4]["stage"] == "planning"
    assert events[7]["error"] == NOT_YET.format("implementation")
    run = run_of(sessions, run_id)
    assert [stage["status"] for stage in run.state["stages"]] == [
        "passed",
        "passed",
        *["skipped"] * 5,
    ]
    # What is served is exactly what the events fold to.
    assert run.state == run_from_events(
        str(run.id), str(run.task_id), run.base_commit, events
    )


def test_a_stage_that_fails_ends_the_run_and_says_why(
    sessions: Sessions, settings: Settings
) -> None:
    def fail(context: StepContext) -> str | None:
        raise StageFailed(
            "The repository could not be read.", summary="Read 0 of 12 files"
        )

    planning = Scripted("planning", says("never reached"))
    pipeline = [Scripted("inspection", fail), planning]
    run_id = queued_run(sessions)
    assert execute_run(sessions, run_id, settings, pipeline) == "executed"
    events = events_of(sessions, run_id)
    assert kinds(events) == [
        "run.started",
        "stage.started",
        "stage.finished",
        "run.finished",
    ]
    assert events[2]["status"] == "failed"
    assert events[2]["summary"] == "Read 0 of 12 files"
    assert events[2]["failureReason"] == "The repository could not be read."
    assert events[3]["error"] is None
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome) == ("completed", "failed")
    assert [stage["status"] for stage in run.state["stages"]] == [
        "failed",
        *["skipped"] * 6,
    ]
    assert planning.calls == 0
    assert task_of(sessions, run_id).status == "failed"


def test_an_internal_error_ends_the_run_without_showing_what_it_was(
    sessions: Sessions, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    def crash(context: StepContext) -> str | None:
        raise RuntimeError("no route to postgresql://forgemind:hunter2@db")

    run_id = queued_run(sessions)
    with caplog.at_level(logging.ERROR, logger="forgemind_api.worker"):
        verdict = execute_run(sessions, run_id, settings, [Scripted("planning", crash)])
    assert verdict == "executed"
    events = events_of(sessions, run_id)
    assert events[2]["failureReason"] == "Stopped on an internal error (RuntimeError)."
    assert events[3]["error"] == "The planning stage stopped on an internal error."
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome) == ("completed", "failed")
    # The fault is in the log for whoever runs the service, and nowhere a
    # member of the organization can read it.
    assert "hunter2" not in json.dumps(events) + json.dumps(run.state)
    assert "hunter2" in caplog.text


# --- one delivery executes


def test_a_run_is_executed_by_one_delivery_however_many_arrive(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    holding, go = threading.Event(), threading.Event()

    def hold(context: StepContext) -> str | None:
        holding.set()
        assert go.wait(30)
        return None

    step = Scripted("inspection", hold)
    verdicts: list[str] = []
    first = threading.Thread(
        target=lambda: verdicts.append(execute_run(sessions, run_id, settings, [step]))
    )
    first.start()
    assert holding.wait(30)
    assert execute_run(sessions, run_id, settings, [step]) == "held"
    go.set()
    first.join(30)
    assert verdicts == ["executed"]
    assert execute_run(sessions, run_id, settings, [step]) == "finished"
    assert execute_run(sessions, uuid.uuid4(), settings, [step]) == "missing"
    assert step.calls == 1
    assert kinds(events_of(sessions, run_id)).count("run.started") == 1
    assert run_of(sessions, run_id).attempts == 1


def test_deliveries_arriving_together_start_the_run_once(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    step = Scripted("inspection", lambda _context: time.sleep(0.3))
    together = threading.Barrier(6)
    verdicts: list[str] = []

    def deliver() -> None:
        together.wait(30)
        verdicts.append(execute_run(sessions, run_id, settings, [step]))

    deliveries = [threading.Thread(target=deliver) for _ in range(6)]
    for delivery in deliveries:
        delivery.start()
    for delivery in deliveries:
        delivery.join(60)
    assert len(verdicts) == 6 and verdicts.count("executed") == 1
    assert set(verdicts) <= {"executed", "held", "finished"}
    assert step.calls == 1
    events = events_of(sessions, run_id)
    assert kinds(events).count("run.started") == 1
    assert kinds(events).count("run.finished") == 1
    assert run_of(sessions, run_id).attempts == 1
