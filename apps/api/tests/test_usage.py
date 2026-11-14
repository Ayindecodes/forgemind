"""Usage: what each event enters in the ledger."""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from forgemind_api.app import create_app
from forgemind_api.execution import append_event, parse_timestamp
from forgemind_api.models import ExecutionEvent, Run, UsageRecord
from forgemind_api.seed import seed
from forgemind_api.settings import Prices, Settings, TokenPrice
from tests.test_execution import OWNER, create
from tests.test_models import seed as seed_run

FIXTURES = Path(__file__).parent / "fixtures" / "runs"
SCENARIOS = ("failed", "happy", "investigation", "partial", "retry-then-unverified")

# Invented for these tests; nobody's rates.
PRICES = Prices(
    tokens={
        "anthropic/claude-opus-5-5": TokenPrice(input=Decimal(2), output=Decimal(10)),
        "anthropic/claude-sonnet-5-5": TokenPrice(
            input=Decimal("0.5"), output=Decimal("2.5")
        ),
    },
    sandbox_hour=Decimal("0.36"),
)

START = {"baseCommit": "abc1234", "branch": None, "expectsPatch": True, "maxRetries": 2}


def fixture(name: str) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text())
    return loaded


def replay(db: DbSession, run: Run, name: str) -> dict[str, Any]:
    """Records a scenario's events on `run`, when the scenario says they
    happened, and returns the scenario."""
    played = fixture(name)
    for event in played["events"]:
        payload = {
            key: value
            for key, value in event.items()
            if key not in ("id", "runId", "seq", "at", "type")
        }
        append_event(db, run, event["type"], payload, parse_timestamp(event["at"]))
    return played


def called(model: str, tokens_in: int, tokens_out: int = 0) -> dict[str, Any]:
    return {
        "agent": "developer",
        "provider": "example",
        "model": model,
        "inputTokens": tokens_in,
        "outputTokens": tokens_out,
    }


def ledger(db: DbSession, run: Run) -> list[UsageRecord]:
    return list(
        db.scalars(
            select(UsageRecord)
            .where(UsageRecord.run_id == run.id)
            .order_by(UsageRecord.event_seq, UsageRecord.kind, UsageRecord.direction)
        ).all()
    )


# --- the ledger


@pytest.mark.parametrize("name", SCENARIOS)
def test_each_event_enters_what_it_used_and_nothing_else(
    session: DbSession, name: str
) -> None:
    org, _, _, _, run = seed_run(session)
    played = replay(session, run, name)
    rows = ledger(session, run)
    assert sorted(
        (
            (row.event_seq, row.kind, row.direction, row.provider, row.model)
            for row in rows
        ),
        key=repr,
    ) == sorted(
        (
            (
                item["seq"],
                item["kind"],
                item["direction"],
                item["provider"],
                item["model"],
            )
            for item in played["measures"]
        ),
        key=repr,
    )
    wanted = {
        (item["seq"], item["kind"], item["direction"]): item
        for item in played["measures"]
    }
    for row in rows:
        item = wanted[(row.event_seq, row.kind, row.direction)]
        assert float(row.quantity) == item["quantity"]
        assert row.recorded_at == parse_timestamp(item["at"])
        assert row.organization_id == org.id
        # A cost is worked out when it is asked for, never stored as a fact.
        assert (row.cost_usd, row.cost_kind) == (None, None)


def test_an_event_that_used_nothing_enters_nothing(session: DbSession) -> None:
    _, _, _, _, run = seed_run(session)
    append_event(session, run, "run.started", START)
    append_event(session, run, "log", {"level": "info", "text": "Nothing to count"})
    append_event(session, run, "model.called", called("model-a", 0, 0))
    append_event(session, run, "run.finished", {"status": "completed", "error": None})
    assert ledger(session, run) == []


def test_an_event_cannot_be_entered_twice(session: DbSession) -> None:
    org, _, _, _, run = seed_run(session)
    append_event(session, run, "run.started", START)
    append_event(
        session,
        run,
        "resources.sampled",
        {"cpuSeconds": 2, "memoryMb": 0, "sandboxSeconds": 0},
    )
    (first,) = ledger(session, run)
    assert (first.kind, first.direction, first.event_seq) == ("cpu_seconds", None, 2)
    with pytest.raises(IntegrityError), session.begin_nested():
        # The same event and kind, with no direction to tell them apart.
        session.add(
            UsageRecord(
                organization_id=org.id,
                run_id=run.id,
                event_seq=2,
                kind="cpu_seconds",
                quantity=Decimal(2),
            )
        )
        session.flush()
    assert len(ledger(session, run)) == 1
    # Entries tied to no event are not the index's business.
    for _ in range(2):
        session.add(
            UsageRecord(organization_id=org.id, kind="cpu_seconds", quantity=Decimal(2))
        )
    session.flush()


def test_an_event_that_is_not_recorded_enters_nothing(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Rolled back")
    run_id = uuid.UUID(task["runId"])
    with DbSession(engine) as db:
        run = db.get_one(Run, run_id)
        append_event(db, run, "run.started", START)
        append_event(db, run, "model.called", called("model-a", 1200, 340))
        assert len(ledger(db, run)) == 2
        db.rollback()
    with DbSession(engine) as db:
        run = db.get_one(Run, run_id)
        assert ledger(db, run) == []
        assert (
            db.scalars(
                select(ExecutionEvent).where(ExecutionEvent.run_id == run_id)
            ).all()
            == []
        )


@pytest.fixture(scope="module")
def client(database_url: str, engine: Engine) -> Iterator[TestClient]:
    settings = Settings(environment="test", database_url=database_url, prices=PRICES)
    seed(engine, settings)
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()
