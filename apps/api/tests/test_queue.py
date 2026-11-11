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

from forgemind_api.app import create_app
from forgemind_api.models import Task
from forgemind_api.queue import (
    EXECUTE_RUN,
    CeleryDispatcher,
    NoQueue,
    make_dispatcher,
    make_publisher,
)
from tests.workers import queued_messages, settings_for

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
