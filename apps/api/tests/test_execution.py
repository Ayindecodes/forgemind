"""Tasks, runs, the event log, and the stream that replays and follows it."""

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api import execution
from forgemind_api.app import create_app
from forgemind_api.models import Run
from forgemind_api.seed import seed
from forgemind_api.settings import Settings
from tests.helpers import newcomer, session_for

OWNER = {"cookie": "fm_session=dev-owner"}
REVIEWER = {"cookie": "fm_session=dev-reviewer"}


@pytest.fixture(scope="module")
def client(database_url: str, engine: Engine) -> Iterator[TestClient]:
    settings = Settings(environment="test", database_url=database_url)
    seed(engine, settings)
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()


def analysed_repository(client: TestClient) -> dict[str, Any]:
    items = client.get("/repositories", headers=OWNER).json()["items"]
    return next(r for r in items if r["status"] == "connected")


def create(
    client: TestClient, headers: dict[str, str], **overrides: Any
) -> dict[str, Any]:
    body = {
        "repositoryId": analysed_repository(client)["id"],
        "title": "Fix retry budget overflow",
        "request": "Stop retrying past the budget the task allows.",
        "category": "fix_bug",
        **overrides,
    }
    response = client.post("/tasks", json=body, headers=headers)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def test_a_task_starts_queued_with_a_run_and_the_default_budget(
    client: TestClient,
) -> None:
    task = create(client, OWNER)
    assert task["status"] == "queued"
    assert task["decision"] is None
    assert task["budget"] == {"maxMinutes": 60, "maxRetries": 2, "maxTokens": 400_000}
    assert task["baseCommit"] == "a1b2c3d"
    assert task["runId"]
    run = client.get(f"/runs/{task['runId']}", headers=OWNER).json()
    assert run["status"] == "queued" and run["lastSeq"] == 0
    assert run["taskId"] == task["id"] and run["expectsPatch"] is True
    assert [s["id"] for s in run["stages"]][:2] == ["inspection", "planning"]
    assert run["verification"] == "pending" and run["outcome"] is None
    latest = client.get("/audit", headers=OWNER).json()["items"][0]
    assert (
        latest["action"] == "task.created"
        and latest["target"]["label"] == task["title"]
    )
    assert (
        client.get(f"/repositories/{task['repositoryId']}", headers=OWNER).json()[
            "latestTaskId"
        ]
        == task["id"]
    )


def test_budgets_and_categories_are_honoured(client: TestClient) -> None:
    task = create(
        client,
        OWNER,
        category="investigate",
        budget={"maxMinutes": 15, "maxTokens": 5000},
    )
    assert task["budget"] == {"maxMinutes": 15, "maxRetries": 2, "maxTokens": 5000}
    run = client.get(f"/runs/{task['runId']}", headers=OWNER).json()
    assert run["expectsPatch"] is False
    too_small = client.post(
        "/tasks",
        json={
            **{k: task[k] for k in ("repositoryId", "title", "request", "category")},
            "budget": {"maxTokens": 10},
        },
        headers=OWNER,
    )
    assert too_small.status_code == 400


def test_who_may_create_and_on_which_repositories(client: TestClient) -> None:
    refused = client.post(
        "/tasks",
        json={
            "repositoryId": analysed_repository(client)["id"],
            "title": "x",
            "request": "y",
            "category": "docs",
        },
        headers=REVIEWER,
    )
    assert refused.status_code == 403
    items = client.get("/repositories", headers=OWNER).json()["items"]
    revoked = next(r for r in items if r["status"] == "revoked")
    gone = client.post(
        "/tasks",
        json={
            "repositoryId": revoked["id"],
            "title": "x",
            "request": "y",
            "category": "docs",
        },
        headers=OWNER,
    )
    assert (
        gone.status_code == 409
        and "no longer connected" in gone.json()["error"]["message"]
    )
    connected = client.post(
        "/repositories",
        json={"githubId": 811006, "fullName": "forgemind/docs"},
        headers=OWNER,
    ).json()
    indexing = client.post(
        "/tasks",
        json={
            "repositoryId": connected["id"],
            "title": "x",
            "request": "y",
            "category": "docs",
        },
        headers=OWNER,
    )
    assert (
        indexing.status_code == 409
        and "still being indexed" in indexing.json()["error"]["message"]
    )
    client.delete(f"/repositories/{connected['id']}", headers=OWNER)


def test_tasks_are_listed_newest_first_and_filtered(client: TestClient) -> None:
    first = create(client, OWNER, title="Older")
    second = create(client, OWNER, title="Newer")
    listed = client.get("/tasks", headers=REVIEWER).json()
    ids = [t["id"] for t in listed["items"]]
    assert ids.index(second["id"]) < ids.index(first["id"])
    queued = client.get("/tasks", params={"status": "queued"}, headers=OWNER).json()[
        "items"
    ]
    assert all(t["status"] == "queued" for t in queued)
    by_repo = client.get(
        "/tasks", params={"repositoryId": first["repositoryId"]}, headers=OWNER
    ).json()["items"]
    assert {t["repositoryId"] for t in by_repo} == {first["repositoryId"]}
    assert (
        client.get(
            "/tasks", params={"repositoryId": str(uuid.uuid4())}, headers=OWNER
        ).json()["items"]
        == []
    )
    two = client.get("/tasks", params={"limit": 2}, headers=OWNER).json()
    assert len(two["items"]) == 2 and two["nextCursor"] == "2"
    assert client.get(f"/tasks/{uuid.uuid4()}", headers=OWNER).status_code == 404
    assert client.get("/tasks/nope", headers=OWNER).status_code == 404


def test_cancelling_records_the_end_and_cannot_happen_twice(client: TestClient) -> None:
    task = create(client, OWNER)
    refused = client.post(f"/tasks/{task['id']}/cancel", headers=REVIEWER)
    assert refused.status_code == 403
    cancelled = client.post(f"/tasks/{task['id']}/cancel", headers=OWNER)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    run = client.get(f"/runs/{task['runId']}", headers=OWNER).json()
    assert run["status"] == "cancelled" and run["finishedAt"] and run["lastSeq"] == 1
    assert all(stage["status"] == "skipped" for stage in run["stages"])
    events = client.get(f"/runs/{task['runId']}/events", headers=OWNER).json()
    assert [e["type"] for e in events] == ["run.finished"]
    assert events[0]["status"] == "cancelled" and events[0]["seq"] == 1
    assert (
        events[0]["id"] == f"{task['runId']}-1" and events[0]["runId"] == task["runId"]
    )
    again = client.post(f"/tasks/{task['id']}/cancel", headers=OWNER)
    assert again.status_code == 409
    assert again.json()["error"]["message"] == "The task has already finished"
    latest = client.get("/audit", headers=OWNER).json()["items"][0]
    assert latest["action"] == "task.cancelled"


def replay_fixture(
    engine: Engine, run_id: str, name: str = "happy"
) -> list[dict[str, Any]]:
    """Appends a scenario's events to a run the way a worker will."""
    from pathlib import Path

    events: list[dict[str, Any]] = json.loads(
        (Path(__file__).parent / "fixtures" / "runs" / f"{name}.json").read_text()
    )["events"]
    with DbSession(engine) as db, db.begin():
        run = db.scalars(select(Run).where(Run.id == uuid.UUID(run_id))).one()
        for event in events:
            payload = {
                k: v
                for k, v in event.items()
                if k not in ("id", "runId", "seq", "at", "type")
            }
            execution.append_event(
                db,
                run,
                event["type"],
                payload,
                at=execution.parse_timestamp(event["at"]),
            )
    return events


def test_appending_events_folds_the_run_and_moves_the_task(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Replayed happily")
    events = replay_fixture(engine, task["runId"], "happy")
    run = client.get(f"/runs/{task['runId']}", headers=OWNER).json()
    assert run["lastSeq"] == len(events)
    assert run["status"] == "awaiting_approval"
    assert run["outcome"] == "succeeded" and run["verification"] == "verified"
    assert run["diff"]["filesChanged"] > 0
    assert run["startedAt"] and run["finishedAt"] is None
    after = client.get(f"/tasks/{task['id']}", headers=OWNER).json()
    assert after["status"] == "awaiting_approval"
    assert after["branch"] == "forgemind/task-1"
    stored = client.get(
        f"/runs/{task['runId']}/events",
        params={"after": len(events) - 2},
        headers=OWNER,
    ).json()
    assert [e["seq"] for e in stored] == [len(events) - 1, len(events)]
    assert [
        r["id"] for r in client.get(f"/tasks/{task['id']}/runs", headers=OWNER).json()
    ] == [task["runId"]]
    waiting = client.get(
        "/runs", params={"status": "awaiting_approval"}, headers=OWNER
    ).json()["items"]
    assert task["runId"] in {r["id"] for r in waiting}
    note = client.get("/notifications", headers=OWNER).json()
    assert any(
        n["kind"] == "task_awaiting_approval" and n["href"] == f"/tasks/{task['id']}"
        for n in note
    )


def test_a_failed_run_marks_the_task_failed(client: TestClient, engine: Engine) -> None:
    task = create(client, OWNER, title="Replayed badly")
    replay_fixture(engine, task["runId"], "failed")
    assert (
        client.get(f"/tasks/{task['id']}", headers=OWNER).json()["status"] == "failed"
    )
    run = client.get(f"/runs/{task['runId']}", headers=OWNER).json()
    assert run["status"] == "completed" and run["outcome"] == "failed"
    done = client.get("/runs", params={"outcome": "failed"}, headers=OWNER).json()[
        "items"
    ]
    assert task["runId"] in {r["id"] for r in done}


def test_the_stream_replays_then_ends_when_the_run_has_finished(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Streamed")
    events = replay_fixture(engine, task["runId"], "failed")
    messages: list[tuple[str, str, dict[str, Any]]] = []
    with client.stream(
        "GET", f"/runs/{task['runId']}/events/stream", headers=OWNER
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        block: dict[str, str] = {}
        for line in response.iter_lines():
            if line == "":
                if block:
                    messages.append(
                        (block.get("id", ""), block["event"], json.loads(block["data"]))
                    )
                block = {}
                continue
            key, _, value = line.partition(": ")
            block[key] = value
    assert len(messages) == len(events)
    assert [m[0] for m in messages] == [str(e["seq"]) for e in events]
    assert [m[1] for m in messages] == [e["type"] for e in events]
    assert messages[-1][1] == "run.finished"


def test_the_stream_resumes_after_the_last_event_seen(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Resumed")
    events = replay_fixture(engine, task["runId"], "failed")
    seen: list[int] = []
    with client.stream(
        "GET",
        f"/runs/{task['runId']}/events/stream",
        params={"after": 3},
        headers={**OWNER, "Last-Event-ID": str(len(events) - 2)},
    ) as response:
        for line in response.iter_lines():
            if line.startswith("id: "):
                seen.append(int(line[4:]))
    assert seen == [len(events) - 1, len(events)]


def test_one_organization_never_sees_anothers_tasks_or_runs(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Private")
    riley = newcomer(engine, "Riley Chen")
    client.post("/organization", json={"name": "Chen Works"}, headers=riley)
    assert client.get("/tasks", headers=riley).json()["items"] == []
    assert client.get(f"/tasks/{task['id']}", headers=riley).status_code == 404
    assert client.post(f"/tasks/{task['id']}/cancel", headers=riley).status_code == 404
    assert client.get(f"/runs/{task['runId']}", headers=riley).status_code == 404
    assert client.get(f"/runs/{task['runId']}/events", headers=riley).status_code == 404
    assert (
        client.get(f"/runs/{task['runId']}/events/stream", headers=riley).status_code
        == 404
    )
    developer = session_for(engine, "chidi@example.com")
    assert client.get(f"/tasks/{task['id']}", headers=developer).status_code == 200
