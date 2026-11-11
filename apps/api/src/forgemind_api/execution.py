"""Tasks, their runs, and the execution event log that is the record of what
happened. Appending an event is the only way a run changes: the fold in
runstate.py turns the log into the state the interface shows."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import Principal, now
from forgemind_api.errors import ApiFailure
from forgemind_api.models import ExecutionEvent, Notification, Run, Task
from forgemind_api.organizations import audit, require_org, require_role
from forgemind_api.queue import Dispatcher, dispatch_after_commit
from forgemind_api.repositories import repository_of
from forgemind_api.runstate import initial_run, reduce_run

DEFAULT_BUDGET = {"maxMinutes": 60, "maxRetries": 2, "maxTokens": 400_000}


def event_json(event: ExecutionEvent) -> dict[str, Any]:
    """The contract's event: the stored payload under its identity."""
    return {
        "id": f"{event.run_id}-{event.seq}",
        "runId": str(event.run_id),
        "seq": event.seq,
        "at": event.at.isoformat().replace("+00:00", "Z"),
        "type": event.type,
        **event.payload,
    }


def run_view(run: Run) -> dict[str, Any]:
    """The folded state the contract calls a Run."""
    if run.state:
        return run.state
    return initial_run(str(run.id), str(run.task_id), run.base_commit)


def sync_run_columns(run: Run, state: dict[str, Any]) -> None:
    run.state = state
    run.status = state["status"]
    run.outcome = state["outcome"]
    run.verification = state["verification"]
    run.expects_patch = state["expectsPatch"]
    run.branch = state["branch"]
    run.retries_used = state["retries"]["used"]
    run.retries_max = state["retries"]["max"]
    run.last_seq = state["lastSeq"]
    run.started_at = parse_timestamp(state["startedAt"])
    run.finished_at = parse_timestamp(state["finishedAt"])
    run.error = state["error"]


def parse_timestamp(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def sync_task(db: DbSession, run: Run, at: datetime) -> None:
    """The task follows its current run, dated to the event that moved it."""
    task = db.get(Task, run.task_id)
    if task is None or task.current_run_id != run.id:
        return
    status = run.status
    if status == "completed":
        task_status = "failed" if run.outcome == "failed" else "completed"
    else:
        task_status = status
    task.status = task_status
    task.branch = run.branch
    task.updated_at = run.finished_at or at


def locked_run(db: DbSession, run_id: uuid.UUID) -> Run | None:
    """The run as it is now, held until the transaction ends. Whoever decides
    something from a run's state and then records it reads the run this way,
    so two writers cannot both act on the same moment."""
    return db.scalars(
        select(Run)
        .where(Run.id == run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()


def append_event(
    db: DbSession,
    run: Run,
    event_type: str,
    payload: dict[str, Any],
    at: datetime | None = None,
) -> ExecutionEvent:
    """Records one thing that happened, folds it into the run, and moves the
    task and its notifications along. Events are never updated or removed.
    The run is locked first, so events are numbered one writer at a time."""
    db.flush()
    db.refresh(run, with_for_update=True)
    stamp = at or now()
    event = ExecutionEvent(
        run_id=run.id,
        seq=run.last_seq + 1,
        type=event_type,
        at=stamp,
        payload=payload,
    )
    db.add(event)
    db.flush()
    state = reduce_run(run_view(run), event_json(event))
    sync_run_columns(run, state)
    if run.status != "running":
        # Nobody is executing a run that is not running: the lease ends in
        # the same transaction as the run does.
        run.worker_id = None
        run.heartbeat_at = None
    sync_task(db, run, stamp)
    db.flush()
    if event_type == "approval.requested":
        task = db.get(Task, run.task_id)
        if task is not None:
            db.add(
                Notification(
                    organization_id=run.organization_id,
                    kind="task_awaiting_approval",
                    title=f"{task.title} is ready for review",
                    body=f"Outcome: {run.outcome or 'unknown'}.",
                    href=f"/tasks/{task.id}",
                    created_at=stamp,
                )
            )
            db.flush()
    return event


def events_after(db: DbSession, run_id: uuid.UUID, after: int) -> list[ExecutionEvent]:
    return list(
        db.scalars(
            select(ExecutionEvent)
            .where(ExecutionEvent.run_id == run_id, ExecutionEvent.seq > after)
            .order_by(ExecutionEvent.seq)
        ).all()
    )


# --- tasks


def create_task(
    db: DbSession,
    principal: Principal,
    repository_id: str,
    title: str,
    request: str,
    category: str,
    budget: dict[str, int] | None,
    dispatcher: Dispatcher,
) -> Task:
    organization_id = require_org(principal)
    require_role(principal, ("owner", "admin", "developer"))
    repo = repository_of(db, organization_id, repository_id)
    if repo.status == "revoked":
        raise ApiFailure("conflict", f"{repo.full_name} is no longer connected")
    if repo.last_analyzed_commit is None:
        raise ApiFailure(
            "conflict",
            f"{repo.full_name} is still being indexed; try again once it is connected",
        )
    limits = {**DEFAULT_BUDGET, **(budget or {})}
    task = Task(
        organization_id=organization_id,
        repository_id=repo.id,
        title=title,
        request=request,
        category=category,
        base_commit=repo.last_analyzed_commit,
        status="queued",
        budget_minutes=limits["maxMinutes"],
        budget_retries=limits["maxRetries"],
        budget_tokens=limits["maxTokens"],
        created_by=principal.user.id,
    )
    db.add(task)
    db.flush()
    run = Run(
        task_id=task.id,
        organization_id=organization_id,
        number=1,
        expects_patch=category != "investigate",
        base_commit=task.base_commit,
        retries_max=limits["maxRetries"],
    )
    db.add(run)
    db.flush()
    run.state = initial_run(str(run.id), str(task.id), task.base_commit)
    run.state["expectsPatch"] = run.expects_patch
    task.current_run_id = run.id
    db.flush()
    db.refresh(task)
    db.refresh(run)
    audit(
        db, organization_id, principal.user, "task.created", "task", str(task.id), title
    )
    dispatch_after_commit(db, dispatcher, run)
    return task


def task_of(db: DbSession, organization_id: uuid.UUID, task_id: str) -> Task:
    try:
        parsed = uuid.UUID(task_id)
    except ValueError:
        raise ApiFailure("not_found", "No such task") from None
    task = db.get(Task, parsed)
    if task is None or task.organization_id != organization_id:
        raise ApiFailure("not_found", "No such task")
    return task


def tasks_page(
    db: DbSession,
    organization_id: uuid.UUID,
    cursor: str | None,
    limit: int,
    repository_id: str | None,
    status: str | None,
) -> tuple[list[Task], str | None]:
    offset = _offset(cursor)
    query = select(Task).where(Task.organization_id == organization_id)
    if repository_id:
        try:
            query = query.where(Task.repository_id == uuid.UUID(repository_id))
        except ValueError:
            return [], None
    if status:
        query = query.where(Task.status == status)
    rows = db.scalars(
        query.order_by(Task.updated_at.desc(), Task.created_at.desc())
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return list(rows[:limit]), (str(offset + limit) if len(rows) > limit else None)


def cancel_task(db: DbSession, principal: Principal, task_id: str) -> Task:
    organization_id = require_org(principal)
    require_role(principal, ("owner", "admin", "developer"))
    task = task_of(db, organization_id, task_id)
    # Locked: a worker may be finishing this run at the same moment.
    run = locked_run(db, task.current_run_id) if task.current_run_id else None
    if run is None or run.status in ("completed", "cancelled"):
        raise ApiFailure("conflict", "The task has already finished")
    append_event(db, run, "run.finished", {"status": "cancelled", "error": None})
    audit(
        db,
        organization_id,
        principal.user,
        "task.cancelled",
        "task",
        str(task.id),
        task.title,
    )
    db.refresh(task)
    return task


# --- runs


def run_of(db: DbSession, organization_id: uuid.UUID, run_id: str) -> Run:
    try:
        parsed = uuid.UUID(run_id)
    except ValueError:
        raise ApiFailure("not_found", "No such run") from None
    run = db.get(Run, parsed)
    if run is None or run.organization_id != organization_id:
        raise ApiFailure("not_found", "No such run")
    return run


def runs_page(
    db: DbSession,
    organization_id: uuid.UUID,
    cursor: str | None,
    limit: int,
    task_id: str | None,
    repository_id: str | None,
    status: str | None,
    outcome: str | None,
) -> tuple[list[Run], str | None]:
    offset = _offset(cursor)
    query = select(Run).where(Run.organization_id == organization_id)
    try:
        if task_id:
            query = query.where(Run.task_id == uuid.UUID(task_id))
        if repository_id:
            query = query.join(Task, Task.id == Run.task_id).where(
                Task.repository_id == uuid.UUID(repository_id)
            )
    except ValueError:
        return [], None
    if status:
        query = query.where(Run.status == status)
    if outcome:
        query = query.where(Run.outcome == outcome)
    rows = db.scalars(
        query.order_by(Run.started_at.desc().nulls_last(), Run.created_at.desc())
        .offset(offset)
        .limit(limit + 1)
    ).all()
    return list(rows[:limit]), (str(offset + limit) if len(rows) > limit else None)


def task_runs(db: DbSession, organization_id: uuid.UUID, task_id: str) -> list[Run]:
    task = task_of(db, organization_id, task_id)
    return list(
        db.scalars(
            select(Run).where(Run.task_id == task.id).order_by(Run.number.desc())
        ).all()
    )


def _offset(cursor: str | None) -> int:
    try:
        offset = int(cursor) if cursor else 0
    except ValueError:
        raise ApiFailure("invalid", "Invalid cursor") from None
    if offset < 0:
        raise ApiFailure("invalid", "Invalid cursor")
    return offset


def task_json(task: Task) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "organizationId": str(task.organization_id),
        "repositoryId": str(task.repository_id),
        "title": task.title,
        "request": task.request,
        "category": task.category,
        "baseCommit": task.base_commit,
        "branch": task.branch,
        "status": task.status,
        "decision": task.decision,
        "runId": str(task.current_run_id) if task.current_run_id else "",
        "budget": {
            "maxMinutes": task.budget_minutes,
            "maxRetries": task.budget_retries,
            "maxTokens": task.budget_tokens,
        },
        "createdBy": str(task.created_by),
        "createdAt": task.created_at.isoformat().replace("+00:00", "Z"),
        "updatedAt": task.updated_at.isoformat().replace("+00:00", "Z"),
    }


# --- notifications


def notifications(db: DbSession, organization_id: uuid.UUID) -> list[Notification]:
    return list(
        db.scalars(
            select(Notification)
            .where(Notification.organization_id == organization_id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(100)
        ).all()
    )


def mark_notifications_read(
    db: DbSession, organization_id: uuid.UUID, ids: list[str]
) -> int:
    """Marks the organization's own notifications read; others are ignored."""
    parsed: list[uuid.UUID] = []
    for value in ids:
        try:
            parsed.append(uuid.UUID(value))
        except ValueError:
            continue
    if not parsed:
        return 0
    stamp = now()
    count = 0
    for note in db.scalars(
        select(Notification).where(
            Notification.organization_id == organization_id,
            Notification.id.in_(parsed),
            Notification.read_at.is_(None),
        )
    ):
        note.read_at = stamp
        count += 1
    db.flush()
    return count


def notification_json(note: Notification) -> dict[str, Any]:
    return {
        "id": str(note.id),
        "kind": note.kind,
        "title": note.title,
        "body": note.body,
        "href": note.href,
        "readAt": note.read_at.isoformat().replace("+00:00", "Z")
        if note.read_at
        else None,
        "createdAt": note.created_at.isoformat().replace("+00:00", "Z"),
    }
