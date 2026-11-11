"""What the worker tests share: a run to work on, steps that do what a test
tells them, a worker that died, and the record as a test wants to read it."""

from __future__ import annotations

import base64
import contextlib
import json
import os
import signal
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Generator, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any

from redis import Redis
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api.auth import now, principal_for_token
from forgemind_api.db import run_after_commit
from forgemind_api.execution import (
    append_event,
    cancel_task,
    create_task,
    event_json,
    events_after,
    locked_run,
)
from forgemind_api.models import Repository, Run, Task
from forgemind_api.pipeline import StepContext
from forgemind_api.queue import QUEUE, Dispatcher, NoQueue
from forgemind_api.settings import ENV_PREFIX, Settings
from forgemind_api.worker import Recorded, claim

Sessions = sessionmaker[Session]

API_ROOT = Path(__file__).resolve().parent.parent

# What a sweep that found nothing to do reports.
QUIET = {"recovered": 0, "stopped": 0, "queued": 0, "undelivered": 0}


def settings_for(database_url: str, **overrides: Any) -> Settings:
    """Test settings with a worker quick enough to watch: it proves itself
    every tenth of a second and is given up on after one."""
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": database_url,
        "worker_heartbeat_seconds": 0.1,
        "worker_stale_seconds": 1,
        "worker_sweep_seconds": 0.2,
        "worker_redispatch_seconds": 60,
        "worker_concurrency": 1,
        **overrides,
    }
    return Settings(**values)


@dataclass
class Scripted:
    """A step that does what the test says."""

    stage: str
    work: Callable[[StepContext], str | None]
    agent: str | None = None
    calls: int = 0

    def run(self, context: StepContext) -> str | None:
        self.calls += 1
        return self.work(context)


def says(text: str) -> Callable[[StepContext], str | None]:
    """Work that records one line and succeeds with it as its summary."""

    def work(context: StepContext) -> str | None:
        context.emit("log", {"level": "info", "text": text})
        return text

    return work


def started(stage: str, attempt: int = 1, agent: str | None = None) -> Recorded:
    return ("stage.started", {"stage": stage, "attempt": attempt, "agent": agent})


def passed(stage: str, attempt: int = 1, summary: str | None = None) -> Recorded:
    return (
        "stage.finished",
        {
            "stage": stage,
            "attempt": attempt,
            "status": "passed",
            "summary": summary,
            "failureReason": None,
        },
    )


class Flaky(sessionmaker[Session]):
    """Sessions on a database that can be made to go away."""

    broken = False

    def __call__(self, **local_kw: Any) -> Session:
        if self.broken:
            raise OperationalError("connect", {}, Exception("the database is gone"))
        return super().__call__(**local_kw)


@dataclass
class Recorder:
    """A queue that remembers what it was given, or refuses it."""

    accepts: bool = True
    dispatched: list[uuid.UUID] = field(default_factory=list[uuid.UUID])

    def dispatch(self, run_id: uuid.UUID) -> bool:
        if self.accepts:
            self.dispatched.append(run_id)
        return self.accepts


def queued_run(
    sessions: Sessions,
    dispatcher: Dispatcher | None = None,
    category: str = "fix_bug",
    budget: dict[str, int] | None = None,
) -> uuid.UUID:
    """A task created the way the API creates one, committed. Its run's id."""
    with sessions() as db:
        with db.begin():
            repository = db.scalars(
                select(Repository)
                .where(
                    Repository.status == "connected",
                    Repository.last_analyzed_commit.is_not(None),
                )
                .order_by(Repository.full_name)
            ).first()
            assert repository is not None
            task = create_task(
                db,
                principal_for_token(db, "dev-owner"),
                str(repository.id),
                "Fix retry budget overflow",
                "Stop retrying past the budget the task allows.",
                category,
                budget,
                dispatcher or NoQueue(),
            )
            run_id = task.current_run_id
        run_after_commit(db)
    assert run_id is not None
    return run_id


def lost_worker(
    sessions: Sessions,
    run_id: uuid.UUID,
    settings: Settings,
    ago: timedelta,
    events: Sequence[Recorded] = (),
) -> None:
    """Leaves the run as a worker that died `ago` would have: claimed, with
    `events` recorded, and silent since."""
    stamp = now() - ago
    with sessions() as db, db.begin():
        assert claim(db, run_id, "lost-worker", settings, at=stamp) == "claimed"
        run = locked_run(db, run_id)
        assert run is not None
        for event_type, payload in events:
            append_event(db, run, event_type, payload, stamp)


def cancel(sessions: Sessions, run_id: uuid.UUID) -> None:
    """Cancels the run's task the way its owner would."""
    with sessions() as db, db.begin():
        task_id = db.get_one(Run, run_id).task_id
        cancel_task(db, principal_for_token(db, "dev-owner"), str(task_id))


def events_of(sessions: Sessions, run_id: uuid.UUID) -> list[dict[str, Any]]:
    with sessions() as db:
        return [event_json(event) for event in events_after(db, run_id, 0)]


def kinds(events: Sequence[dict[str, Any]]) -> list[str]:
    return [event["type"] for event in events]


def run_of(sessions: Sessions, run_id: uuid.UUID) -> Run:
    with sessions() as db:
        return db.get_one(Run, run_id)


def task_of(sessions: Sessions, run_id: uuid.UUID) -> Task:
    with sessions() as db:
        return db.get_one(Task, db.get_one(Run, run_id).task_id)


def stage_of(sessions: Sessions, run_id: uuid.UUID, stage: str) -> dict[str, Any]:
    state = run_of(sessions, run_id).state
    return next(s for s in state["stages"] if s["id"] == stage)


def wait_for(
    predicate: Callable[[], bool],
    what: str,
    seconds: float = 30,
    describe: Callable[[], str] = lambda: "",
) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out after {seconds}s waiting for {what}\n{describe()}")


# --- real processes and the real queue


@contextlib.contextmanager
def worker_process(
    settings: Settings, log: Path, *module: str, **extra: str
) -> Generator[subprocess.Popen[bytes]]:
    """`python -m <module>` configured by `settings`, in a process group of
    its own so that it can be killed whole. Whatever is left of it when the
    block ends is killed. Its output goes to `log`."""
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(ENV_PREFIX)
    }
    for name, value in settings.model_dump().items():
        if value is not None:
            environment[f"{ENV_PREFIX}{name.upper()}"] = str(value)
    environment.update(extra)
    with log.open("ab") as output:
        process = subprocess.Popen(
            [sys.executable, "-m", *module],
            cwd=API_ROOT,
            env=environment,
            stdout=output,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            yield process
        finally:
            kill(process)


def kill(process: subprocess.Popen[bytes]) -> None:
    """Ends the process and everything it started, with no warning: what a
    machine that loses power does to a worker."""
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(10)


def ask_to_stop(process: subprocess.Popen[bytes], seconds: float = 30) -> int:
    """Asks the process to stop the way a container runtime does, and returns
    its exit code."""
    process.send_signal(signal.SIGTERM)
    return process.wait(seconds)


def queued_messages(redis_url: str) -> list[tuple[str, list[Any]]]:
    """What is on the queue: each message's task name and arguments."""
    client = Redis.from_url(redis_url)  # pyright: ignore[reportUnknownMemberType]
    try:
        raw: Any = client.lrange(QUEUE, 0, -1)  # pyright: ignore[reportUnknownMemberType]
    finally:
        client.close()
    messages: list[tuple[str, list[Any]]] = []
    for item in raw:
        message = json.loads(item)
        arguments = json.loads(base64.b64decode(message["body"]))[0]
        messages.append((message["headers"]["task"], arguments))
    return messages
