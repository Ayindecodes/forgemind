"""The queue between the API and its workers: what goes on it, when, and what
happens to a run when the queue cannot be reached."""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable, Iterator, MutableMapping
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from forgemind_api import execution
from forgemind_api.app import create_app
from forgemind_api.deps import Current, Db, Queue
from forgemind_api.errors import ApiFailure
from forgemind_api.models import Run, Task
from forgemind_api.queue import (
    EXECUTE_RUN,
    CeleryDispatcher,
    NoQueue,
    make_dispatcher,
    make_publisher,
)
from forgemind_api.settings import Settings
from forgemind_api.worker import sweep
from tests.workers import QUIET, Recorder, queued_messages, run_of, settings_for

Sessions = sessionmaker[Session]

OWNER = {"cookie": "fm_session=dev-owner"}
# Nothing listens here, and the refusal is immediate.
UNREACHABLE = "redis://127.0.0.1:1/0"

Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


@pytest.fixture
def app(own_database_url: str, redis_url: str) -> Iterator[FastAPI]:
    app = create_app(settings_for(own_database_url, redis_url=redis_url))
    yield app
    app.state.engine.dispose()


def new_task(client: TestClient) -> dict[str, Any]:
    repositories = client.get("/repositories", headers=OWNER).json()["items"]
    repository = next(r for r in repositories if r["status"] == "connected")
    return {
        "repositoryId": repository["id"],
        "title": "Fix retry budget overflow",
        "request": "Stop retrying past the budget the task allows.",
        "category": "fix_bug",
    }


def task_count(sessions: Sessions) -> int:
    with sessions() as db:
        return db.scalar(select(func.count()).select_from(Task)) or 0


def test_dispatching_puts_one_message_naming_the_run_on_the_queue(
    own_database_url: str, redis_url: str
) -> None:
    celery = make_publisher(settings_for(own_database_url, redis_url=redis_url))
    run_id = uuid.uuid4()
    assert CeleryDispatcher(celery).dispatch(run_id) is True
    celery.close()
    assert queued_messages(redis_url) == [(EXECUTE_RUN, [str(run_id)])]


def test_a_queue_that_cannot_be_reached_is_reported_promptly_and_not_raised(
    own_database_url: str,
) -> None:
    celery = make_publisher(settings_for(own_database_url, redis_url=UNREACHABLE))
    began = time.monotonic()
    assert CeleryDispatcher(celery).dispatch(uuid.uuid4()) is False
    assert time.monotonic() - began < 5
    celery.close()


def test_without_a_queue_runs_are_recorded_and_nothing_is_dispatched(
    own_database_url: str,
) -> None:
    dispatcher = make_dispatcher(settings_for(own_database_url))
    assert isinstance(dispatcher, NoQueue)
    assert dispatcher.dispatch(uuid.uuid4()) is False


def test_creating_a_task_puts_its_run_on_the_queue(
    app: FastAPI, sessions: Sessions, redis_url: str
) -> None:
    client = TestClient(app)
    created = client.post("/tasks", json=new_task(client), headers=OWNER)
    assert created.status_code == 201, created.text
    run_id = created.json()["runId"]
    assert queued_messages(redis_url) == [(EXECUTE_RUN, [run_id])]
    assert run_of(sessions, uuid.UUID(run_id)).dispatched_at is not None


def test_a_run_is_queued_only_once_a_worker_could_read_it(
    app: FastAPI, sessions: Sessions
) -> None:
    visible: list[bool] = []

    class Looking:
        """Looks for the run the way a worker would: on a connection of its
        own, at the moment the message is sent."""

        def dispatch(self, run_id: uuid.UUID) -> bool:
            with sessions() as other:
                visible.append(other.get(Run, run_id) is not None)
            return True

    app.state.dispatcher = Looking()
    client = TestClient(app)
    assert (
        client.post("/tasks", json=new_task(client), headers=OWNER).status_code == 201
    )
    assert visible == [True]


def test_a_request_that_fails_after_creating_a_task_queues_nothing(
    app: FastAPI, sessions: Sessions
) -> None:
    recorder = Recorder()
    app.state.dispatcher = recorder

    @app.post("/changes-its-mind")
    def changes_its_mind(  # pyright: ignore[reportUnusedFunction]
        body: dict[str, str], db: Db, current: Current, queue: Queue
    ) -> None:
        execution.create_task(
            db,
            current,
            body["repositoryId"],
            body["title"],
            body["request"],
            body["category"],
            None,
            queue,
        )
        raise ApiFailure("conflict", "Changed its mind")

    client = TestClient(app)
    before = task_count(sessions)
    response = client.post("/changes-its-mind", json=new_task(client), headers=OWNER)
    assert response.status_code == 409
    assert task_count(sessions) == before
    assert recorder.dispatched == []


def test_a_task_is_still_created_when_the_queue_cannot_be_reached(
    own_database_url: str, sessions: Sessions
) -> None:
    settings = settings_for(own_database_url, redis_url=UNREACHABLE)
    app = create_app(settings)
    try:
        client = TestClient(app)
        body = new_task(client)
        began = time.monotonic()
        created = client.post("/tasks", json=body, headers=OWNER)
        assert time.monotonic() - began < 5
    finally:
        app.state.engine.dispose()
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "queued"
    run_id = uuid.UUID(created.json()["runId"])
    # Recorded as not on the queue, so the next sweep puts it there.
    assert run_of(sessions, run_id).dispatched_at is None
    recorder = Recorder()
    assert sweep(sessions, settings, recorder) == QUIET | {"queued": 1}
    assert recorder.dispatched == [run_id]


def test_a_write_is_committed_before_its_response_starts(
    app: FastAPI, sessions: Sessions
) -> None:
    counted: list[int] = []

    async def watching(scope: Message, receive: Receive, send: Send) -> None:
        async def counting(message: Message) -> None:
            if message["type"] == "http.response.start" and scope["method"] == "POST":
                counted.append(task_count(sessions))
            await send(message)

        await app(scope, receive, counting)

    client = TestClient(watching)
    body = new_task(client)
    before = task_count(sessions)
    assert client.post("/tasks", json=body, headers=OWNER).status_code == 201
    # Whoever is told the task exists can read it straight away.
    assert counted == [before + 1]


def test_health_reports_the_queue(app: FastAPI) -> None:
    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "queue": "ok"}


def test_health_degrades_promptly_when_the_queue_cannot_be_reached(
    own_database_url: str,
) -> None:
    app = create_app(Settings(database_url=own_database_url, redis_url=UNREACHABLE))
    try:
        began = time.monotonic()
        response = TestClient(app).get("/health")
        assert time.monotonic() - began < 3
    finally:
        app.state.engine.dispose()
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"] == {"database": "ok", "queue": "unreachable"}
