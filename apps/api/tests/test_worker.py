"""A worker executing runs in this process: what it records, what it will not
repeat, and what becomes of a run whose worker is gone."""

from __future__ import annotations

import contextlib
import json
import logging
import threading
import time
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api.auth import now
from forgemind_api.errors import ApiFailure
from forgemind_api.execution import append_event, locked_run
from forgemind_api.models import Run
from forgemind_api.pipeline import StageFailed, StepContext
from forgemind_api.runstate import run_from_events
from forgemind_api.settings import Settings
from forgemind_api.worker import (
    INTERRUPTED,
    INTERRUPTED_CHECK,
    ProcessSessions,
    RecordingFailed,
    RunStopped,
    execute_run,
    sweep,
)
from tests.workers import (
    QUIET,
    Flaky,
    Recorder,
    Scripted,
    cancel,
    events_of,
    kinds,
    lost_worker,
    passed,
    queued_run,
    run_of,
    says,
    settings_for,
    stage_of,
    started,
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


# --- continuing after a lost worker


def test_a_run_whose_worker_died_is_continued_from_what_was_recorded(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(
        sessions,
        run_id,
        settings,
        timedelta(seconds=30),
        [
            started("inspection"),
            passed("inspection", summary="Read 12 files"),
            started("planning"),
            ("log", {"level": "info", "text": "half a plan"}),
        ],
    )
    before = events_of(sessions, run_id)
    inspection = Scripted("inspection", says("Read it all again"))
    planning = Scripted("planning", says("Three steps"))
    pipeline = [inspection, planning]
    assert execute_run(sessions, run_id, settings, pipeline) == "executed"
    after = events_of(sessions, run_id)
    # Everything the dead worker recorded is still there, unchanged.
    assert after[: len(before)] == before
    assert [event["seq"] for event in after] == list(range(1, len(after) + 1))
    added = after[len(before) :]
    assert kinds(added) == [
        "log",
        "stage.finished",
        "stage.started",
        "log",
        "stage.finished",
        "run.finished",
    ]
    resumed, closed, again = added[:3]
    assert resumed["level"] == "warn" and "attempt 2 of 3" in resumed["text"]
    assert (closed["stage"], closed["attempt"]) == ("planning", 1)
    assert (closed["status"], closed["failureReason"]) == ("failed", INTERRUPTED)
    assert (again["stage"], again["attempt"]) == ("planning", 2)
    # The stage that had finished is not run again; the interrupted one is.
    assert (inspection.calls, planning.calls) == (0, 1)
    assert kinds(after).count("run.started") == 1
    assert len(stage_of(sessions, run_id, "inspection")["attempts"]) == 1
    assert [
        attempt["status"]
        for attempt in stage_of(sessions, run_id, "planning")["attempts"]
    ] == ["failed", "passed"]
    assert run_of(sessions, run_id).attempts == 2


def test_a_check_the_lost_worker_left_running_is_closed_as_an_error(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(
        sessions,
        run_id,
        settings,
        timedelta(seconds=30),
        [
            started("testing"),
            (
                "check.started",
                {
                    "checkId": "unit",
                    "kind": "tests",
                    "label": "Unit tests",
                    "command": "pytest",
                    "required": True,
                },
            ),
        ],
    )
    assert execute_run(sessions, run_id, settings) == "executed"
    events = events_of(sessions, run_id)
    closed = next(event for event in events if event["type"] == "check.finished")
    assert (closed["checkId"], closed["status"]) == ("unit", "error")
    assert closed["summary"] == INTERRUPTED_CHECK and closed["counts"] is None
    assert closed["durationMs"] >= 29_000
    run = run_of(sessions, run_id)
    assert run.state["checks"][0]["status"] == "error"
    # A check that did not finish verifies nothing.
    assert run.verification == "unverified"


def test_a_run_out_of_time_when_picked_up_again_is_ended_instead(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions, budget={"maxMinutes": 1})
    lost_worker(
        sessions, run_id, settings, timedelta(seconds=90), [started("inspection")]
    )
    step = Scripted("inspection", says("never reached"))
    assert execute_run(sessions, run_id, settings, [step]) == "exhausted"
    events = events_of(sessions, run_id)
    assert kinds(events) == [
        "run.started",
        "stage.started",
        "stage.finished",
        "run.finished",
    ]
    assert events[2]["failureReason"] == INTERRUPTED
    assert events[3]["error"] == "Stopped at the time budget of 1 minute."
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome) == ("completed", "failed")
    assert (run.worker_id, run.attempts, step.calls) == (None, 1, 0)


def test_a_run_no_worker_could_finish_is_ended_at_the_attempt_limit(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    for attempt, ago in enumerate((30, 20, 10), start=1):
        lost_worker(
            sessions,
            run_id,
            settings,
            timedelta(seconds=ago),
            [started("inspection", attempt)],
        )
    step = Scripted("inspection", says("never reached"))
    assert execute_run(sessions, run_id, settings, [step]) == "exhausted"
    events = events_of(sessions, run_id)
    assert events[-1]["type"] == "run.finished"
    assert (
        events[-1]["error"]
        == "No worker finished this run in 3 attempts, so it was stopped."
    )
    assert kinds(events).count("run.finished") == 1
    assert [
        attempt["status"]
        for attempt in stage_of(sessions, run_id, "inspection")["attempts"]
    ] == ["failed", "failed", "failed"]
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome, run.attempts) == ("completed", "failed", 3)
    assert step.calls == 0
    assert task_of(sessions, run_id).status == "failed"


def test_a_worker_that_cannot_record_leaves_the_run_to_be_continued(
    sessions: Sessions, settings: Settings
) -> None:
    flaky = Flaky(**sessions.kw)
    run_id = queued_run(sessions)

    def lose_the_database(context: StepContext) -> str | None:
        flaky.broken = True
        context.emit("log", LINE)
        return None

    step = Scripted("inspection", lose_the_database)
    with pytest.raises(RecordingFailed):
        execute_run(flaky, run_id, settings, [step])
    flaky.broken = False
    before = events_of(sessions, run_id)
    assert kinds(before) == ["run.started", "stage.started"]
    # It could not even let go of the run, so its lease has to lapse.
    held = run_of(sessions, run_id)
    assert held.status == "running" and held.worker_id is not None
    recorder = Recorder()
    later = now() + timedelta(seconds=settings.worker_stale_seconds + 1)
    assert sweep(sessions, settings, recorder, at=later) == QUIET | {"recovered": 1}
    again = Scripted("inspection", says("Read 12 files"))
    assert execute_run(sessions, run_id, settings, [again]) == "executed"
    after = events_of(sessions, run_id)
    assert after[: len(before)] == before
    assert [
        attempt["status"]
        for attempt in stage_of(sessions, run_id, "inspection")["attempts"]
    ] == ["failed", "passed"]


def test_a_run_left_unfinished_is_queued_again_at_the_next_sweep(
    sessions: Sessions, settings: Settings
) -> None:
    flaky = Flaky(**sessions.kw)
    recorder = Recorder()
    run_id = queued_run(sessions, recorder)

    def fail_one_write(context: StepContext) -> str | None:
        flaky.broken = True
        try:
            context.emit("log", LINE)
        finally:
            flaky.broken = False
        return None

    step = Scripted("inspection", fail_one_write)
    with pytest.raises(RecordingFailed):
        execute_run(flaky, run_id, settings, [step])
    # Let go of, and marked as off the queue: no waiting for a message that
    # was already consumed.
    left = run_of(sessions, run_id)
    assert (left.status, left.worker_id, left.dispatched_at) == ("running", None, None)
    assert sweep(sessions, settings, recorder) == QUIET | {"queued": 1}
    assert recorder.dispatched == [run_id, run_id]


# --- stopping a worker that no longer holds the run


def test_a_worker_that_lost_the_run_cannot_add_to_its_record(
    sessions: Sessions, own_database_url: str
) -> None:
    # A heartbeat too slow to notice: the write itself has to refuse.
    settings = settings_for(
        own_database_url, worker_heartbeat_seconds=20, worker_stale_seconds=40
    )
    run_id = queued_run(sessions)

    def lose_it_then_write(context: StepContext) -> str | None:
        take_from_its_worker(sessions, run_id)
        context.emit("log", LINE)
        return "finished anyway"

    step = Scripted("inspection", lose_it_then_write)
    assert execute_run(sessions, run_id, settings, [step]) == "stopped"
    assert kinds(events_of(sessions, run_id)) == ["run.started", "stage.started"]
    # And it does not let go of a lease that is no longer its own.
    run = run_of(sessions, run_id)
    assert (run.status, run.worker_id) == ("running", "another-worker")


def test_a_step_that_ignores_being_stopped_still_cannot_finish_its_stage(
    sessions: Sessions, own_database_url: str
) -> None:
    settings = settings_for(
        own_database_url, worker_heartbeat_seconds=20, worker_stale_seconds=40
    )
    run_id = queued_run(sessions)

    def carry_on_regardless(context: StepContext) -> str | None:
        take_from_its_worker(sessions, run_id)
        with contextlib.suppress(Exception):
            context.emit("log", LINE)
        return "finished anyway"

    step = Scripted("inspection", carry_on_regardless)
    assert execute_run(sessions, run_id, settings, [step]) == "stopped"
    assert kinds(events_of(sessions, run_id)) == ["run.started", "stage.started"]
    assert stage_of(sessions, run_id, "inspection")["status"] == "running"


def test_a_worker_notices_it_lost_the_run_without_writing_anything(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    noticed: list[str] = []

    def work_without_writing(context: StepContext) -> str | None:
        take_from_its_worker(sessions, run_id)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                context.check()
            except RunStopped:
                noticed.append("stopped")
                raise
            time.sleep(0.02)
        return None

    step = Scripted("inspection", work_without_writing)
    assert execute_run(sessions, run_id, settings, [step]) == "stopped"
    assert noticed == ["stopped"]


def test_cancelling_a_run_stops_its_worker(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)

    def cancelled_under_it(context: StepContext) -> str | None:
        cancel(sessions, run_id)
        context.emit("log", LINE)
        return "finished anyway"

    planning = Scripted("planning", says("never reached"))
    pipeline = [Scripted("inspection", cancelled_under_it), planning]
    assert execute_run(sessions, run_id, settings, pipeline) == "stopped"
    events = events_of(sessions, run_id)
    assert kinds(events) == ["run.started", "stage.started", "run.finished"]
    assert events[-1]["status"] == "cancelled"
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome, run.worker_id) == ("cancelled", None, None)
    assert task_of(sessions, run_id).status == "cancelled"
    assert planning.calls == 0


def test_a_run_that_ends_is_nobodys_from_that_moment(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(sessions, run_id, settings, timedelta(seconds=0))
    assert run_of(sessions, run_id).worker_id == "lost-worker"
    # No worker is left to let go of it: the end of the run does.
    cancel(sessions, run_id)
    run = run_of(sessions, run_id)
    assert (run.status, run.worker_id, run.heartbeat_at) == ("cancelled", None, None)


def test_a_step_is_stopped_when_the_time_budget_runs_out(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions, budget={"maxMinutes": 1})
    # Started 58.5 seconds ago by a worker that is gone: 1.5 seconds remain.
    lost_worker(sessions, run_id, settings, timedelta(seconds=58.5))
    left: list[float] = []

    def outlast_the_budget(context: StepContext) -> str | None:
        left.append(context.remaining_seconds())
        for _ in range(500):  # ten seconds: far longer than the budget has left
            context.check()
            time.sleep(0.02)
        return "nobody stopped this step"

    step = Scripted("inspection", outlast_the_budget)
    assert execute_run(sessions, run_id, settings, [step]) == "executed"
    assert 0 < left[0] <= 1.5
    events = events_of(sessions, run_id)
    assert kinds(events[-2:]) == ["stage.finished", "run.finished"]
    assert events[-2]["status"] == "failed"
    assert events[-2]["failureReason"] == "Stopped at the run's time budget."
    assert events[-1]["error"] == "Stopped at the time budget of 1 minute."
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome) == ("completed", "failed")


def test_a_long_stage_keeps_its_run_while_its_worker_keeps_proving_it_is_there(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    recorder = Recorder()
    seen: dict[str, object] = {}

    def outlast_the_stale_limit(context: StepContext) -> str | None:
        time.sleep(settings.worker_stale_seconds * 1.5)
        seen["sweep"] = sweep(sessions, settings, recorder)
        seen["delivery"] = execute_run(sessions, run_id, settings)
        return None

    step = Scripted("inspection", outlast_the_stale_limit)
    assert execute_run(sessions, run_id, settings, [step]) == "executed"
    assert seen == {"sweep": QUIET, "delivery": "held"}
    assert recorder.dispatched == []
    assert (run_of(sessions, run_id).attempts, step.calls) == (1, 1)


# --- the sweeper


def test_the_sweeper_queues_again_a_run_whose_worker_went_quiet(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(
        sessions, run_id, settings, timedelta(seconds=5), [started("inspection")]
    )
    before = events_of(sessions, run_id)
    recorder = Recorder()
    assert sweep(sessions, settings, recorder) == QUIET | {"recovered": 1}
    assert recorder.dispatched == [run_id]
    run = run_of(sessions, run_id)
    assert (run.status, run.worker_id, run.heartbeat_at) == ("running", None, None)
    assert run.dispatched_at is not None
    # The record is the next worker's to continue, not the sweeper's.
    assert events_of(sessions, run_id) == before
    # Already back on the queue: the next sweep does not pile on a second.
    assert sweep(sessions, settings, recorder) == QUIET
    assert recorder.dispatched == [run_id]


def test_the_sweeper_ends_a_run_that_used_its_last_attempt(
    sessions: Sessions, own_database_url: str
) -> None:
    settings = settings_for(own_database_url, worker_max_attempts=1)
    run_id = queued_run(sessions)
    lost_worker(
        sessions, run_id, settings, timedelta(seconds=5), [started("inspection")]
    )
    before = events_of(sessions, run_id)
    recorder = Recorder()
    assert sweep(sessions, settings, recorder) == QUIET | {"stopped": 1}
    assert recorder.dispatched == []
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
    assert task_of(sessions, run_id).status == "failed"
    assert sweep(sessions, settings, recorder) == QUIET


def test_the_sweeper_queues_a_run_that_never_reached_the_queue(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions, Recorder(accepts=False))
    assert run_of(sessions, run_id).dispatched_at is None
    recorder = Recorder()
    assert sweep(sessions, settings, recorder) == QUIET | {"queued": 1}
    assert recorder.dispatched == [run_id]
    assert run_of(sessions, run_id).dispatched_at is not None
    assert kinds(events_of(sessions, run_id)) == []
    # Queued a moment ago: a worker may yet take it.
    assert sweep(sessions, settings, recorder) == QUIET
    # Still not taken long after: the message is presumed lost.
    patience = timedelta(seconds=settings.worker_redispatch_seconds + 1)
    assert sweep(sessions, settings, recorder, at=now() + patience) == QUIET | {
        "queued": 1
    }
    assert recorder.dispatched == [run_id, run_id]


def test_a_run_the_queue_would_not_take_is_offered_again_at_the_next_sweep(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions, Recorder(accepts=False))
    refused = sweep(sessions, settings, Recorder(accepts=False))
    assert refused == QUIET | {"queued": 1, "undelivered": 1}
    assert run_of(sessions, run_id).dispatched_at is None
    recorder = Recorder()
    assert sweep(sessions, settings, recorder) == QUIET | {"queued": 1}
    assert recorder.dispatched == [run_id]


def test_the_sweeper_leaves_alone_runs_that_are_being_looked_after(
    sessions: Sessions, own_database_url: str
) -> None:
    settings = settings_for(
        own_database_url, worker_heartbeat_seconds=5, worker_stale_seconds=30
    )
    recorder = Recorder()
    waiting = queued_run(sessions, recorder)
    working = queued_run(sessions, recorder)
    lost_worker(sessions, working, settings, timedelta(seconds=2))
    finished = queued_run(sessions, recorder)
    assert execute_run(sessions, finished, settings) == "executed"
    assert recorder.dispatched == [waiting, working, finished]
    assert sweep(sessions, settings, recorder) == QUIET
    assert recorder.dispatched == [waiting, working, finished]
    assert run_of(sessions, working).worker_id == "lost-worker"


def test_the_sweeper_ends_a_run_past_its_time_budget_whatever_its_worker_says(
    sessions: Sessions, own_database_url: str
) -> None:
    settings = settings_for(
        own_database_url, worker_heartbeat_seconds=5, worker_stale_seconds=30
    )
    run_id = queued_run(sessions, budget={"maxMinutes": 1})
    lost_worker(
        sessions, run_id, settings, timedelta(seconds=120), [started("inspection")]
    )
    began = run_of(sessions, run_id).started_at
    assert began is not None
    with sessions() as db, db.begin():
        # Its worker is still proving itself, 85 seconds in.
        db.execute(
            update(Run)
            .where(Run.id == run_id)
            .values(heartbeat_at=began + timedelta(seconds=85))
        )
    recorder = Recorder()
    # Twenty seconds over: the worker is given the chance to stop itself.
    early = began + timedelta(seconds=80)
    assert sweep(sessions, settings, recorder, at=early) == QUIET
    late = began + timedelta(seconds=95)
    assert sweep(sessions, settings, recorder, at=late) == QUIET | {"stopped": 1}
    events = events_of(sessions, run_id)
    assert kinds(events[-2:]) == ["stage.finished", "run.finished"]
    assert events[-1]["error"] == "Stopped at the time budget of 1 minute."
    run = run_of(sessions, run_id)
    assert (run.status, run.outcome, run.worker_id) == ("completed", "failed", None)
    assert recorder.dispatched == []


def test_the_sweeper_does_not_wait_for_a_run_someone_is_writing_to(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(sessions, run_id, settings, timedelta(seconds=5))
    recorder = Recorder()
    swept: list[dict[str, int]] = []
    sweeping = threading.Thread(
        target=lambda: swept.append(sweep(sessions, settings, recorder))
    )
    with sessions() as db, db.begin():
        assert locked_run(db, run_id) is not None
        sweeping.start()
        sweeping.join(5)
        waited = sweeping.is_alive()
    sweeping.join(30)
    assert not waited, "the sweep waited for the writer to finish"
    assert swept == [QUIET]
    assert sweep(sessions, settings, recorder) == QUIET | {"recovered": 1}


# --- writers at the same moment


def test_two_writers_never_give_two_events_the_same_number(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(sessions, run_id, settings, timedelta(seconds=0))
    together = threading.Barrier(2)
    failures: list[Exception] = []

    def write(name: str) -> None:
        together.wait(30)
        for number in range(25):
            try:
                with sessions() as db, db.begin():
                    run = db.get_one(Run, run_id)
                    text = f"{name} {number}"
                    append_event(db, run, "log", {"level": "info", "text": text})
            except Exception as error:
                failures.append(error)

    writers = [threading.Thread(target=write, args=(name,)) for name in ("a", "b")]
    for writer in writers:
        writer.start()
    for writer in writers:
        writer.join(60)
    assert failures == []
    events = events_of(sessions, run_id)
    assert [event["seq"] for event in events] == list(range(1, 52))
    run = run_of(sessions, run_id)
    assert (run.last_seq, run.state["lastSeq"]) == (51, 51)


def test_a_cancel_arriving_as_the_run_finishes_waits_and_is_refused(
    sessions: Sessions, settings: Settings
) -> None:
    run_id = queued_run(sessions)
    lost_worker(sessions, run_id, settings, timedelta(seconds=0))
    refused: list[str] = []

    def cancel_it() -> None:
        try:
            cancel(sessions, run_id)
        except ApiFailure as failure:
            refused.append(failure.code)

    canceller = threading.Thread(target=cancel_it)
    with sessions() as db, db.begin():
        run = locked_run(db, run_id)
        assert run is not None
        canceller.start()
        canceller.join(0.5)
        assert canceller.is_alive()  # waiting for whoever is writing
        append_event(db, run, "run.finished", {"status": "completed", "error": None})
    canceller.join(30)
    assert refused == ["conflict"]
    events = events_of(sessions, run_id)
    assert kinds(events).count("run.finished") == 1
    assert run_of(sessions, run_id).status == "completed"


def test_each_process_gets_its_own_sessions_and_keeps_them(
    own_database_url: str,
) -> None:
    sessions = ProcessSessions(own_database_url)
    factory = sessions()
    try:
        assert sessions() is factory
    finally:
        factory.kw["bind"].dispose()
