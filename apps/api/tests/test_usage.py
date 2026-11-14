"""Usage: what each event enters in the ledger, the summary an organization is
shown, and what it is estimated to cost."""

from __future__ import annotations

import json
import uuid
from collections import Counter
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from forgemind_api import usage
from forgemind_api.app import create_app
from forgemind_api.execution import append_event, parse_timestamp
from forgemind_api.metering import Measure, total_usage, units
from forgemind_api.models import (
    Artifact,
    ExecutionEvent,
    Organization,
    Run,
    Task,
    UsageRecord,
)
from forgemind_api.seed import seed
from forgemind_api.settings import Prices, Settings, TokenPrice
from forgemind_api.usage import estimated_cost, usage_summary
from tests.helpers import newcomer
from tests.test_execution import OWNER, REVIEWER, create, replay_fixture
from tests.test_models import seed as seed_run

FIXTURES = Path(__file__).parent / "fixtures" / "runs"
SCENARIOS = ("failed", "happy", "investigation", "partial", "retry-then-unverified")
# The scripted scenarios all happen on the sixth, a little after noon.
MID_NOVEMBER = datetime(2026, 11, 14, 9, 30, 0, 250_400, tzinfo=UTC)

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


def another_run(db: DbSession, task: Task) -> Run:
    number = db.scalar(select(func.count()).select_from(Run)) or 0
    run = Run(
        task_id=task.id,
        organization_id=task.organization_id,
        number=number + 1,
        expects_patch=True,
        base_commit=task.base_commit,
        retries_max=2,
    )
    db.add(run)
    db.flush()
    return run


def called(model: str, tokens_in: int, tokens_out: int = 0) -> dict[str, Any]:
    return {
        "agent": "developer",
        "provider": "example",
        "model": model,
        "inputTokens": tokens_in,
        "outputTokens": tokens_out,
    }


def measured(*played: dict[str, Any]) -> list[Measure]:
    """The measures the contract's TypeScript took of the scenarios."""
    return [
        Measure(
            item["kind"],
            units(item["quantity"]),
            item["direction"],
            item["provider"],
            item["model"],
        )
        for scenario in played
        for item in scenario["measures"]
    ]


def ledger(db: DbSession, run: Run) -> list[UsageRecord]:
    return list(
        db.scalars(
            select(UsageRecord)
            .where(UsageRecord.run_id == run.id)
            .order_by(UsageRecord.event_seq, UsageRecord.kind, UsageRecord.direction)
        ).all()
    )


def figures(summary: dict[str, Any]) -> dict[str, Any]:
    return {
        key: summary[key]
        for key in (
            "tokens",
            "sandboxSeconds",
            "cpuSeconds",
            "memoryMbHours",
            "retryOverheadSeconds",
        )
    }


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


# --- the summary


def test_the_summary_is_what_the_months_events_measure(session: DbSession) -> None:
    org, _, _, task, run = seed_run(session)
    played = [replay(session, run, SCENARIOS[0])]
    played += [replay(session, another_run(session, task), n) for n in SCENARIOS[1:]]
    # One more that has started and not ended.
    going = another_run(session, task)
    append_event(
        session, going, "run.started", START, datetime(2026, 11, 9, tzinfo=UTC)
    )
    session.add(
        Artifact(
            run_id=run.id,
            organization_id=org.id,
            kind="patch",
            storage_ref="artifacts/one.patch",
            content_type="text/x-diff",
            size_bytes=48_213,
            sha256="0" * 64,
            created_at=MID_NOVEMBER,
        )
    )
    session.flush()

    summary = usage_summary(session, org.id, Prices(), MID_NOVEMBER)
    expected = total_usage(measured(*played))
    tokens = sum(row["input"] + row["output"] for row in expected["tokens"])
    ended = Counter(scenario["run"]["outcome"] for scenario in played)

    assert tokens == 752_620 and expected["retryOverheadSeconds"] == 27.1
    assert figures(summary) == expected
    assert summary["period"] == {
        "from": "2026-11-01T00:00:00.000Z",
        "to": "2026-11-14T09:30:00.250Z",
    }
    # A run still going is one of the total and none of the outcomes.
    assert summary["runs"] == {
        "total": 6,
        "succeeded": ended["succeeded"],
        "partial": ended["partial"],
        "failed": ended["failed"],
        "unverified": ended["unverified"],
    }
    assert sum(ended.values()) == 5 and ended["succeeded"] == 2
    assert summary["storageBytes"] == 48_213
    assert summary["quotas"] == {
        "concurrentRuns": {"used": 1, "max": None},
        "monthlyRuns": {"used": 6, "max": None},
        "monthlyTokens": {"used": tokens, "max": None},
    }


def test_the_month_is_counted_from_its_first_instant_to_this_millisecond(
    session: DbSession,
) -> None:
    org, _, _, _, run = seed_run(session)
    append_event(session, run, "run.started", START, datetime(2026, 10, 30, tzinfo=UTC))
    for tokens, at in (
        (1, "2026-10-31T23:59:59.999999Z"),
        (10, "2026-11-01T00:00:00.000000Z"),
        # Finer than a millisecond is not compared: this is still the last one.
        (100, "2026-11-14T09:30:00.250999Z"),
        (1000, "2026-11-14T09:30:00.251000Z"),
    ):
        append_event(
            session, run, "model.called", called("model-a", tokens), parse_timestamp(at)
        )
    summary = usage_summary(session, org.id, Prices(), MID_NOVEMBER)
    assert summary["tokens"] == [
        {"provider": "example", "model": "model-a", "input": 110, "output": 0}
    ]
    # The run started in October, so it is not one of November's.
    assert summary["runs"]["total"] == 0

    october = usage_summary(
        session, org.id, Prices(), datetime(2026, 10, 31, 23, 59, 59, 999_999, UTC)
    )
    assert october["period"] == {
        "from": "2026-10-01T00:00:00.000Z",
        "to": "2026-10-31T23:59:59.999Z",
    }
    assert october["tokens"][0]["input"] == 1 and october["runs"]["total"] == 1

    december = usage_summary(
        session, org.id, Prices(), datetime(2026, 12, 1, tzinfo=UTC)
    )
    assert december["tokens"] == [] and december["quotas"]["monthlyTokens"]["used"] == 0


def test_an_organization_is_shown_only_its_own_usage(session: DbSession) -> None:
    org, _, _, _, run = seed_run(session)
    other, _, _, _, theirs = seed_run(session)
    played = replay(session, run, "happy")
    replay(session, theirs, "partial")
    mine = usage_summary(session, org.id, Prices(), MID_NOVEMBER)
    assert figures(mine) == played["usage"]
    assert mine["runs"]["total"] == 1 and mine["runs"]["succeeded"] == 1
    assert (
        figures(usage_summary(session, other.id, Prices(), MID_NOVEMBER))
        == (fixture("partial")["usage"])
    )
    nobody = Organization(name="Nobody yet", slug=f"nobody-{uuid.uuid4().hex[:6]}")
    session.add(nobody)
    session.flush()
    empty = usage_summary(session, nobody.id, PRICES, MID_NOVEMBER)
    assert figures(empty) == {
        "tokens": [],
        "sandboxSeconds": 0,
        "cpuSeconds": 0,
        "memoryMbHours": 0,
        "retryOverheadSeconds": 0,
    }
    assert empty["runs"]["total"] == 0 and empty["storageBytes"] == 0
    assert empty["cost"] == {"kind": "estimate", "amountUsd": 0}


# --- what it costs


def test_a_cost_is_estimated_from_the_prices_set_on_the_server() -> None:
    cost = estimated_cost(measured(fixture("happy")), PRICES)
    # 68,800 in and 4,750 out at 2 and 10; 69,900 in and 8,190 out at 0.5 and
    # 2.5; 23 seconds of sandbox at 0.36 an hour.
    assert cost == {"kind": "estimate", "amountUsd": 0.242825}


def test_an_estimate_is_rounded_to_a_millionth_of_a_dollar() -> None:
    one = [Measure("tokens", units(1), "input", "example", "model-a")]
    half = Prices(
        tokens={"example/model-a": TokenPrice(input=Decimal("0.5"), output=Decimal(0))}
    )
    assert estimated_cost(one, half) == {"kind": "estimate", "amountUsd": 0.000001}
    less = Prices(
        tokens={"example/model-a": TokenPrice(input=Decimal("0.49"), output=Decimal(0))}
    )
    assert estimated_cost(one, less) == {"kind": "estimate", "amountUsd": 0}


def test_what_has_no_price_makes_the_cost_unavailable_and_says_what() -> None:
    used = measured(fixture("happy"))
    assert estimated_cost(used, Prices()) == {
        "kind": "unavailable",
        "reason": (
            "No price is set on this server for anthropic/claude-opus-5-5, "
            "anthropic/claude-sonnet-5-5 or sandbox time."
        ),
    }
    only_opus = Prices(
        tokens={
            "anthropic/claude-opus-5-5": PRICES.tokens["anthropic/claude-opus-5-5"]
        },
        sandbox_hour=PRICES.sandbox_hour,
    )
    assert estimated_cost(used, only_opus) == {
        "kind": "unavailable",
        "reason": "No price is set on this server for anthropic/claude-sonnet-5-5.",
    }
    no_sandbox = Prices(tokens=PRICES.tokens)
    assert estimated_cost(used, no_sandbox)["reason"] == (
        "No price is set on this server for sandbox time."
    )


def test_what_is_not_priced_and_not_used_does_not_matter() -> None:
    cpu_only = [Measure("cpu_seconds", units(5.5)), Measure("memory_mb_hours", 7750)]
    assert estimated_cost(cpu_only, Prices()) == {"kind": "estimate", "amountUsd": 0}
    assert estimated_cost([], Prices()) == {"kind": "estimate", "amountUsd": 0}


def test_a_price_of_nothing_is_a_price() -> None:
    free = Prices(
        tokens={
            name: TokenPrice(input=Decimal(0), output=Decimal(0))
            for name in PRICES.tokens
        },
        sandbox_hour=Decimal(0),
    )
    assert estimated_cost(measured(fixture("happy")), free) == {
        "kind": "estimate",
        "amountUsd": 0,
    }


@pytest.mark.parametrize("prices", [Prices(), PRICES])
@pytest.mark.parametrize("name", SCENARIOS)
def test_no_cost_is_ever_called_actual(prices: Prices, name: str) -> None:
    assert estimated_cost(measured(fixture(name)), prices)["kind"] != "actual"


# --- over HTTP


@pytest.fixture(scope="module")
def client(database_url: str, engine: Engine) -> Iterator[TestClient]:
    settings = Settings(environment="test", database_url=database_url, prices=PRICES)
    seed(engine, settings)
    app = create_app(settings)
    yield TestClient(app)
    app.state.engine.dispose()


@pytest.fixture
def mid_november(monkeypatch: pytest.MonkeyPatch) -> None:
    """The scripted scenarios are dated; so, for these tests, is the clock."""
    monkeypatch.setattr(usage, "now", lambda: MID_NOVEMBER)


@pytest.mark.usefixtures("mid_november")
def test_usage_follows_the_events_and_is_priced_as_configured(
    client: TestClient, engine: Engine
) -> None:
    before = client.get("/usage", headers=OWNER)
    assert before.status_code == 200, before.text
    task = create(client, OWNER, title="Metered")
    replay_fixture(engine, task["runId"], "happy")
    after = client.get("/usage", headers=REVIEWER).json()

    def tokens(summary: dict[str, Any]) -> dict[str, tuple[int, int]]:
        return {
            row["model"]: (row["input"], row["output"]) for row in summary["tokens"]
        }

    was, now = tokens(before.json()), tokens(after)
    assert {
        model: (now[model][0] - was.get(model, (0, 0))[0])
        for model in ("claude-opus-5-5", "claude-sonnet-5-5")
    } == {"claude-opus-5-5": 68_800, "claude-sonnet-5-5": 69_900}
    assert now["claude-sonnet-5-5"][1] - was.get("claude-sonnet-5-5", (0, 0))[1] == 8190
    for key, added in (("sandboxSeconds", 23), ("cpuSeconds", 5.5)):
        assert round(after[key] - before.json()[key], 4) == added
    assert after["runs"]["total"] == before.json()["runs"]["total"] + 1
    assert after["runs"]["succeeded"] == before.json()["runs"]["succeeded"] + 1
    assert after["period"]["from"] == "2026-11-01T00:00:00.000Z"
    assert after["cost"]["kind"] == before.json()["cost"]["kind"] == "estimate"
    assert round(
        after["cost"]["amountUsd"] - before.json()["cost"]["amountUsd"], 6
    ) == (0.242825)


@pytest.mark.usefixtures("mid_november")
def test_usage_is_for_members_and_only_of_their_own_organization(
    client: TestClient, engine: Engine
) -> None:
    task = create(client, OWNER, title="Not theirs")
    replay_fixture(engine, task["runId"], "failed")
    assert client.get("/usage").status_code == 401
    riley = newcomer(engine, "Riley Chen")
    assert client.get("/usage", headers=riley).status_code == 403
    client.post("/organization", json={"name": "Chen Works"}, headers=riley)
    theirs = client.get("/usage", headers=riley).json()
    assert theirs["tokens"] == [] and theirs["runs"]["total"] == 0
    assert (
        theirs["sandboxSeconds"] == 0 and theirs["quotas"]["monthlyRuns"]["used"] == 0
    )
    assert theirs["cost"] == {"kind": "estimate", "amountUsd": 0}
    assert client.get("/usage", headers=OWNER).json()["tokens"] != []
