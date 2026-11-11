"""Tasks, their runs, and the event log behind each run."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, Path, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import Field
from starlette.concurrency import run_in_threadpool

from forgemind_api import execution as service
from forgemind_api.deps import Current, Db
from forgemind_api.models import Run
from forgemind_api.organizations import require_org
from forgemind_api.schemas import Wire

router = APIRouter(tags=["tasks"])

TaskId = Annotated[str, Path(description="The task's id")]
RunId = Annotated[str, Path(description="The run's id")]

HEARTBEAT_SECONDS = 15
POLL_SECONDS = 0.3

Category = Literal[
    "investigate",
    "fix_bug",
    "add_tests",
    "security",
    "dependencies",
    "refactor",
    "docs",
    "validation",
]
TaskStatus = Literal[
    "queued", "running", "awaiting_approval", "completed", "cancelled", "failed"
]
RunStatus = Literal["queued", "running", "awaiting_approval", "completed", "cancelled"]
Outcome = Literal["succeeded", "partial", "failed", "unverified"]


class BudgetIn(Wire):
    max_minutes: int | None = Field(default=None, ge=1, le=480)
    max_retries: int | None = Field(default=None, ge=0, le=10)
    max_tokens: int | None = Field(default=None, ge=1000)


class CreateTaskIn(Wire):
    repository_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=200)
    request: str = Field(min_length=1, max_length=5000)
    category: Category
    budget: BudgetIn | None = None


def page(items: list[dict[str, Any]], next_cursor: str | None) -> dict[str, Any]:
    return {"items": items, "nextCursor": next_cursor}


@router.get("/tasks")
def tasks(
    db: Db,
    current: Current,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    repository_id: Annotated[str | None, Query(alias="repositoryId")] = None,
    status: Annotated[TaskStatus | None, Query()] = None,
) -> dict[str, Any]:
    items, next_cursor = service.tasks_page(
        db, require_org(current), cursor, limit, repository_id, status
    )
    return page([service.task_json(task) for task in items], next_cursor)


@router.post("/tasks", status_code=201)
def create_task(body: CreateTaskIn, db: Db, current: Current) -> dict[str, Any]:
    budget = (
        {
            key: value
            for key, value in {
                "maxMinutes": body.budget.max_minutes,
                "maxRetries": body.budget.max_retries,
                "maxTokens": body.budget.max_tokens,
            }.items()
            if value is not None
        }
        if body.budget
        else None
    )
    task = service.create_task(
        db, current, body.repository_id, body.title, body.request, body.category, budget
    )
    return service.task_json(task)


@router.get("/tasks/{id}")
def task(id: TaskId, db: Db, current: Current) -> dict[str, Any]:
    return service.task_json(service.task_of(db, require_org(current), id))


@router.post("/tasks/{id}/cancel")
def cancel_task(id: TaskId, db: Db, current: Current) -> dict[str, Any]:
    return service.task_json(service.cancel_task(db, current, id))


@router.get("/tasks/{id}/runs")
def task_runs(id: TaskId, db: Db, current: Current) -> list[dict[str, Any]]:
    return [
        service.run_view(run) for run in service.task_runs(db, require_org(current), id)
    ]


@router.get("/runs")
def runs(
    db: Db,
    current: Current,
    cursor: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    task_id: Annotated[str | None, Query(alias="taskId")] = None,
    repository_id: Annotated[str | None, Query(alias="repositoryId")] = None,
    status: Annotated[RunStatus | None, Query()] = None,
    outcome: Annotated[Outcome | None, Query()] = None,
) -> dict[str, Any]:
    items, next_cursor = service.runs_page(
        db, require_org(current), cursor, limit, task_id, repository_id, status, outcome
    )
    return page([service.run_view(run) for run in items], next_cursor)


@router.get("/runs/{id}")
def run(id: RunId, db: Db, current: Current) -> dict[str, Any]:
    return service.run_view(service.run_of(db, require_org(current), id))


@router.get("/runs/{id}/events")
def run_events(
    id: RunId,
    db: Db,
    current: Current,
    after: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    found = service.run_of(db, require_org(current), id)
    return [
        service.event_json(event) for event in service.events_after(db, found.id, after)
    ]


def sse(event: str, data: str, event_id: str | None = None) -> bytes:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {data}\n\n".encode()


@router.get("/runs/{id}/events/stream")
def run_event_stream(
    id: RunId,
    request: Request,
    db: Db,
    current: Current,
    after: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    """Server-sent events: everything after `after` or Last-Event-ID, then
    each new event as it is recorded, a heartbeat while nothing happens, and
    the end once the run has finished."""
    found = service.run_of(db, require_org(current), id)
    run_id = found.id
    start = after
    if last_event_id and last_event_id.isdigit():
        start = max(start, int(last_event_id))
    factory = request.app.state.session_factory

    def read(since: int) -> tuple[list[dict[str, Any]], bool]:
        with factory() as session:
            events = [
                service.event_json(e)
                for e in service.events_after(session, run_id, since)
            ]
            current_run = session.get(Run, run_id)
            finished = current_run is not None and current_run.status in (
                "completed",
                "cancelled",
            )
            return events, finished

    async def stream() -> AsyncIterator[bytes]:
        last_sent = start
        quiet = 0.0
        while True:
            if await request.is_disconnected():
                return
            events, finished = await run_in_threadpool(read, last_sent)
            for event in events:
                yield sse(event["type"], json.dumps(event), str(event["seq"]))
                last_sent = event["seq"]
                quiet = 0.0
                if event["type"] == "run.finished":
                    return
            if finished:
                return
            await asyncio.sleep(POLL_SECONDS)
            quiet += POLL_SECONDS
            if quiet >= HEARTBEAT_SECONDS:
                yield sse("heartbeat", str(last_sent))
                quiet = 0.0

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
