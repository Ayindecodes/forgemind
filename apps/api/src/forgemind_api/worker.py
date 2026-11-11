"""Executes runs. A worker claims a run in the database, keeps proving it still
holds it, and records what it does as events. Everything known about a run is
in those events, so a second worker can continue where a dead one stopped:
nothing a run did is recorded twice, and nothing recorded is lost."""

from __future__ import annotations

import logging
import os
import socket
import threading
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

from forgemind_api.auth import now
from forgemind_api.execution import (
    append_event,
    event_json,
    locked_run,
    parse_timestamp,
    run_view,
)
from forgemind_api.models import Run, Task
from forgemind_api.pipeline import PIPELINE, StageFailed, Step
from forgemind_api.settings import Settings

log = logging.getLogger("forgemind_api.worker")

Sessions = sessionmaker[DbSession]
Recorded = tuple[str, dict[str, Any]]

# What a delivery came to: the run was executed to its end here; it stopped
# being this worker's part-way; another worker holds it; it had already
# finished; it was ended instead of picked up again; or there is no such run.
Verdict = Literal["executed", "stopped", "held", "finished", "exhausted", "missing"]

INTERRUPTED = "The worker running this attempt stopped responding."
INTERRUPTED_CHECK = "The worker stopped responding before this check finished."


class RunStopped(Exception):
    """The run is no longer this worker's to continue: it was cancelled, it
    finished, or another worker holds it now."""


class BudgetExhausted(Exception):
    """The run's time budget ran out."""


class RecordingFailed(Exception):
    """An event could not be written. The run is left as it is recorded, for
    another attempt to continue."""


def new_worker_id() -> str:
    """Names one execution of one delivery. Never reused, so a lease cannot be
    mistaken for an earlier one from the same process."""
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def budget_error(minutes: int) -> str:
    return f"Stopped at the time budget of {minutes} minute{_s(minutes)}."


def _s(count: int) -> str:
    return "" if count == 1 else "s"


def lease_is_live(run: Run, at: datetime, settings: Settings) -> bool:
    if run.worker_id is None or run.heartbeat_at is None:
        return False
    return at - run.heartbeat_at < timedelta(seconds=settings.worker_stale_seconds)


def close_interrupted(db: DbSession, run: Run, at: datetime) -> None:
    """Ends, in the record, whatever a lost worker left in progress. Its check
    and its stage attempt did not finish, and the record should not go on
    saying they are running."""
    state = run_view(run)
    for check in state["checks"]:
        if check["status"] != "running":
            continue
        started = parse_timestamp(check["startedAt"])
        elapsed = (at - started).total_seconds() if started else 0
        append_event(
            db,
            run,
            "check.finished",
            {
                "checkId": check["id"],
                "status": "error",
                "durationMs": max(0, int(elapsed * 1000)),
                "summary": INTERRUPTED_CHECK,
                "counts": None,
            },
            at,
        )
    for stage in state["stages"]:
        for attempt in stage["attempts"]:
            if attempt["status"] != "running":
                continue
            append_event(
                db,
                run,
                "stage.finished",
                {
                    "stage": stage["id"],
                    "attempt": attempt["number"],
                    "status": "failed",
                    "summary": None,
                    "failureReason": INTERRUPTED,
                },
                at,
            )


def give_up(db: DbSession, run: Run, at: datetime, settings: Settings) -> bool:
    """Ends a run that may not be picked up again: it is out of time, or it
    has been picked up as often as allowed without finishing. True when it
    ended the run."""
    task = db.get(Task, run.task_id)
    minutes = task.budget_minutes if task else 0
    out_of_time = (
        task is not None
        and run.started_at is not None
        and at >= run.started_at + timedelta(minutes=minutes)
    )
    if out_of_time:
        error = budget_error(minutes)
    elif run.attempts >= settings.worker_max_attempts:
        error = (
            f"No worker finished this run in {run.attempts} "
            f"attempt{_s(run.attempts)}, so it was stopped."
        )
    else:
        return False
    close_interrupted(db, run, at)
    append_event(db, run, "run.finished", {"status": "completed", "error": error}, at)
    return True


def claim(
    db: DbSession,
    run_id: uuid.UUID,
    worker_id: str,
    settings: Settings,
    at: datetime | None = None,
) -> Verdict | Literal["claimed"]:
    """Takes the run for `worker_id` if it is free to take, and records the
    start, or the resumption after a lost worker. One transaction, with the
    run locked: of any number of deliveries, one claims."""
    stamp = at or now()
    run = locked_run(db, run_id)
    if run is None:
        return "missing"
    if run.status not in ("queued", "running"):
        return "finished"
    if lease_is_live(run, stamp, settings):
        return "held"
    if give_up(db, run, stamp, settings):
        return "exhausted"
    resumed = run.status == "running"
    run.worker_id = worker_id
    run.heartbeat_at = stamp
    run.attempts += 1
    if resumed:
        append_event(
            db,
            run,
            "log",
            {
                "level": "warn",
                "text": (
                    "The worker running this stopped responding. Another "
                    f"worker is continuing from what was recorded (attempt "
                    f"{run.attempts} of {settings.worker_max_attempts})."
                ),
            },
            stamp,
        )
        close_interrupted(db, run, stamp)
    else:
        append_event(
            db,
            run,
            "run.started",
            {
                "baseCommit": run.base_commit,
                "branch": None,
                "expectsPatch": run.expects_patch,
                "maxRetries": run.retries_max,
            },
            stamp,
        )
    return "claimed"


class Heartbeat:
    """Proves on a timer that this worker still holds the run, and notices
    when it no longer does."""

    def __init__(
        self, sessions: Sessions, run_id: uuid.UUID, worker_id: str, seconds: float
    ) -> None:
        self.lost = threading.Event()
        self._sessions = sessions
        self._run_id = run_id
        self._worker_id = worker_id
        self._seconds = seconds
        self._done = threading.Event()
        self._thread = threading.Thread(
            target=self._beat, name=f"heartbeat-{run_id}", daemon=True
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
        self._thread.join(timeout=self._seconds + 5)

    def _beat(self) -> None:
        while not self._done.wait(self._seconds):
            try:
                with self._sessions() as db, db.begin():
                    held = db.execute(
                        update(Run)
                        .where(
                            Run.id == self._run_id,
                            Run.worker_id == self._worker_id,
                            Run.status == "running",
                        )
                        .values(heartbeat_at=now())
                        .returning(Run.id)
                    ).first()
            except SQLAlchemyError:
                # Keep trying: if this lasts, the lease lapses by itself.
                log.warning(
                    "heartbeat not recorded",
                    extra={"run_id": str(self._run_id)},
                    exc_info=True,
                )
                continue
            if held is None:
                self.lost.set()
                return


class RunContext:
    """A claimed run, as its steps see it. Every write checks, with the run
    locked, that this worker still holds it, so a worker that lost the run
    without noticing cannot add to its record."""

    def __init__(
        self,
        sessions: Sessions,
        run_id: uuid.UUID,
        worker_id: str,
        deadline: datetime | None,
        budget_minutes: int,
        lost: threading.Event,
    ) -> None:
        self.run_id = run_id
        self._sessions = sessions
        self._worker_id = worker_id
        self._deadline = deadline
        self._budget_minutes = budget_minutes
        self._lost = lost

    def remaining_seconds(self) -> float:
        if self._deadline is None:
            return float("inf")
        return (self._deadline - now()).total_seconds()

    def budget_error(self) -> str:
        return budget_error(self._budget_minutes)

    def check(self) -> None:
        if self._lost.is_set():
            raise RunStopped
        if self.remaining_seconds() <= 0:
            raise BudgetExhausted

    def emit(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.check()
        return self.record((event_type, payload))[-1]

    def record(self, *events: Recorded) -> list[dict[str, Any]]:
        """Writes `events` together or not at all, whatever the time budget
        says: this is how a run's end gets recorded once the budget is gone."""
        try:
            with self._sessions() as db, db.begin():
                run = locked_run(db, self.run_id)
                held = (
                    run is not None
                    and run.status == "running"
                    and run.worker_id == self._worker_id
                )
                if run is None or not held:
                    self._lost.set()
                    raise RunStopped
                run.heartbeat_at = now()
                return [
                    event_json(append_event(db, run, event_type, payload))
                    for event_type, payload in events
                ]
        except SQLAlchemyError as error:
            raise RecordingFailed(str(self.run_id)) from error

    def finish(self, error: str | None, *before: Recorded) -> None:
        """Ends the run, recording `before` and the end together."""
        self.record(*before, ("run.finished", {"status": "completed", "error": error}))

    def state(self) -> dict[str, Any]:
        with self._sessions() as db:
            run = db.get(Run, self.run_id)
            if run is None:
                raise RunStopped
            return run_view(run)


def run_stage(context: RunContext, step: Step) -> bool:
    """Runs one stage, unless the record shows it done. False when the run
    ended here."""
    stage = next(s for s in context.state()["stages"] if s["id"] == step.stage)
    if stage["status"] in ("passed", "skipped"):
        return True
    # A failed stage in a run that is still going is one a lost worker left
    # unfinished: a stage that fails for itself ends the run with it.
    attempt = len(stage["attempts"]) + 1
    started = False
    summary: str | None = None
    error: str | None = None
    try:
        context.emit(
            "stage.started",
            {"stage": step.stage, "attempt": attempt, "agent": step.agent},
        )
        started = True
        summary = step.run(context)
        context.record(
            (
                "stage.finished",
                {
                    "stage": step.stage,
                    "attempt": attempt,
                    "status": "passed",
                    "summary": summary,
                    "failureReason": None,
                },
            )
        )
        return True
    except (RunStopped, RecordingFailed):
        raise
    except BudgetExhausted:
        reason = "Stopped at the run's time budget."
        error = context.budget_error()
    except StageFailed as failure:
        reason, summary = failure.reason, failure.summary
    except Exception as fault:
        # The fault goes to the log. People see only that there was one.
        log.exception(
            "stage stopped on an internal error",
            extra={"run_id": str(context.run_id), "stage": step.stage},
        )
        reason = f"Stopped on an internal error ({type(fault).__name__})."
        error = f"The {step.stage} stage stopped on an internal error."
    closing: list[Recorded] = []
    if started:
        closing.append(
            (
                "stage.finished",
                {
                    "stage": step.stage,
                    "attempt": attempt,
                    "status": "failed",
                    "summary": summary,
                    "failureReason": reason,
                },
            )
        )
    context.finish(error, *closing)
    return False


def conclude(context: RunContext) -> None:
    """Ends a run the steps left going: it stops, and says so, at the first
    stage this server has no step for."""
    state = context.state()
    if state["status"] != "running":
        return
    waiting = next(
        (stage["id"] for stage in state["stages"] if stage["status"] == "pending"),
        None,
    )
    context.finish(
        f"The {waiting} stage is not available on this server yet, "
        "so the run stopped there."
        if waiting
        else "The run ended without reaching a result."
    )


def release(
    sessions: Sessions, run_id: uuid.UUID, worker_id: str, unfinished: bool = False
) -> None:
    """Lets go of the run if this worker still holds it. Left `unfinished`,
    the run is also marked as off the queue, so the next sweep puts it back
    instead of waiting for a message that is not coming."""
    values: dict[str, Any] = {"worker_id": None, "heartbeat_at": None}
    if unfinished:
        values["dispatched_at"] = None
    try:
        with sessions() as db, db.begin():
            db.execute(
                update(Run)
                .where(Run.id == run_id, Run.worker_id == worker_id)
                .values(**values)
            )
    except SQLAlchemyError:
        log.warning(
            "lease not released; it will lapse",
            extra={"run_id": str(run_id)},
            exc_info=True,
        )


def execute_run(
    sessions: Sessions,
    run_id: uuid.UUID,
    settings: Settings,
    pipeline: Sequence[Step] = PIPELINE,
    worker_id: str | None = None,
) -> Verdict:
    """Handles one delivery of a run. Safe to call any number of times, at
    once or one after another: the claim lets one caller through, and each
    stage runs only if the record does not show it done."""
    holder = worker_id or new_worker_id()
    with sessions() as db, db.begin():
        verdict = claim(db, run_id, holder, settings)
        if verdict != "claimed":
            return verdict
        run = db.get_one(Run, run_id)
        task = db.get_one(Task, run.task_id)
        minutes = task.budget_minutes
        deadline = (
            run.started_at + timedelta(minutes=minutes) if run.started_at else None
        )
    heartbeat = Heartbeat(sessions, run_id, holder, settings.worker_heartbeat_seconds)
    context = RunContext(sessions, run_id, holder, deadline, minutes, heartbeat.lost)
    heartbeat.start()
    settled = False
    try:
        for step in pipeline:
            if not run_stage(context, step):
                break
        else:
            conclude(context)
        settled = True
        return "executed"
    except RunStopped:
        settled = True
        log.info("run stopped under this worker", extra={"run_id": str(run_id)})
        return "stopped"
    finally:
        # Anything else that ends the delivery leaves the run unfinished, for
        # another attempt to continue.
        heartbeat.stop()
        release(sessions, run_id, holder, unfinished=not settled)
