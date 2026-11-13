"""The queue between the API and its workers: what goes on it, when, and what
happens to a run, or to a repository waiting to be indexed, when the queue
cannot be reached."""

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
from forgemind_api.indexing import sweep_indexing
from forgemind_api.models import Repository, Run, Task
from forgemind_api.queue import (
    EXECUTE_RUN,
    INDEX_REPOSITORY,
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
# A repository the seeded installation can see and nobody has connected.
DOCS = {"githubId": 811006, "fullName": "forgemind/docs"}
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


def test_a_repository_to_index_is_one_message_naming_it(
    own_database_url: str, redis_url: str
) -> None:
    celery = make_publisher(settings_for(own_database_url, redis_url=redis_url))
    repository_id = uuid.uuid4()
    assert CeleryDispatcher(celery).dispatch_indexing(repository_id) is True
    celery.close()
    assert queued_messages(redis_url) == [(INDEX_REPOSITORY, [str(repository_id)])]


def test_a_queue_that_cannot_be_reached_is_reported_promptly_and_not_raised(
    own_database_url: str,
) -> None:
    celery = make_publisher(settings_for(own_database_url, redis_url=UNREACHABLE))
    dispatcher = CeleryDispatcher(celery)
    for dispatch in (dispatcher.dispatch, dispatcher.dispatch_indexing):
        began = time.monotonic()
        assert dispatch(uuid.uuid4()) is False
        assert time.monotonic() - began < 5
    celery.close()


def test_without_a_queue_runs_are_recorded_and_nothing_is_dispatched(
    own_database_url: str,
) -> None:
    dispatcher = make_dispatcher(settings_for(own_database_url))
    assert isinstance(dispatcher, NoQueue)
    assert dispatcher.dispatch(uuid.uuid4()) is False
    assert dispatcher.dispatch_indexing(uuid.uuid4()) is False


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


def test_connecting_a_repository_puts_it_on_the_queue_to_be_indexed(
    app: FastAPI, sessions: Sessions, redis_url: str
) -> None:
    created = TestClient(app).post("/repositories", json=DOCS, headers=OWNER)
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "analyzing"
    repository_id = created.json()["id"]
    assert queued_messages(redis_url) == [(INDEX_REPOSITORY, [repository_id])]
    with sessions() as db:
        stored = db.get_one(Repository, uuid.UUID(repository_id))
        assert stored.index_dispatched_at is not None
        assert (stored.index_attempts, stored.index_worker_id) == (0, None)


def test_a_repository_is_queued_only_once_a_worker_could_read_it(
    app: FastAPI, sessions: Sessions
) -> None:
    visible: list[bool] = []

    class Looking:
        def dispatch_indexing(self, repository_id: uuid.UUID) -> bool:
            with sessions() as other:
                visible.append(other.get(Repository, repository_id) is not None)
            return True

    app.state.dispatcher = Looking()
    created = TestClient(app).post("/repositories", json=DOCS, headers=OWNER)
    assert created.status_code == 201
    assert visible == [True]


def test_a_connection_refused_after_all_queues_nothing(
    app: FastAPI, sessions: Sessions
) -> None:
    recorder = Recorder()
    app.state.dispatcher = recorder
    client = TestClient(app)
    # A reviewer may not connect; an owner may not connect what is not there.
    reviewer = {"cookie": "fm_session=dev-reviewer"}
    assert client.post("/repositories", json=DOCS, headers=reviewer).status_code == 403
    unseen = {"githubId": 920001, "fullName": "forgemind/docs"}
    assert client.post("/repositories", json=unseen, headers=OWNER).status_code == 404
    assert recorder.indexing == []
    created = client.post("/repositories", json=DOCS, headers=OWNER)
    assert recorder.indexing == [uuid.UUID(created.json()["id"])]
    # Connected already, it is not asked for twice.
    assert client.post("/repositories", json=DOCS, headers=OWNER).status_code == 409
    assert len(recorder.indexing) == 1


def test_a_repository_is_still_connected_when_the_queue_cannot_be_reached(
    own_database_url: str, sessions: Sessions
) -> None:
    settings = settings_for(own_database_url, redis_url=UNREACHABLE)
    app = create_app(settings)
    try:
        began = time.monotonic()
        created = TestClient(app).post("/repositories", json=DOCS, headers=OWNER)
        assert time.monotonic() - began < 5
    finally:
        app.state.engine.dispose()
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "analyzing"
    repository_id = uuid.UUID(created.json()["id"])
    # Recorded as not on the queue, so the next sweep puts it there.
    with sessions() as db:
        assert db.get_one(Repository, repository_id).index_dispatched_at is None
    recorder = Recorder()
    assert sweep_indexing(sessions, settings, recorder) == QUIET | {"queued": 1}
    assert recorder.indexing == [repository_id]


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
