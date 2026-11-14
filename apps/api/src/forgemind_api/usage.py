"""What an organization used. The figures are sums over the usage ledger,
which `append_event` enters from each event as it is recorded. `reconcile`
works the ledger out again from the events themselves and reports every place
the two disagree, so the figures can be shown to be the events' own."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import now
from forgemind_api.execution import parse_timestamp, wire_event
from forgemind_api.metering import UNIT, Measure, measure_event, total_usage
from forgemind_api.models import Artifact, ExecutionEvent, Run, UsageRecord
from forgemind_api.runstate import initial_run, reduce_run
from forgemind_api.settings import Prices

MILLISECOND = timedelta(milliseconds=1)
MICRODOLLAR = Decimal("0.000001")
OUTCOMES = ("succeeded", "partial", "failed", "unverified")


def timestamp(at: datetime) -> str:
    return at.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def period_at(at: datetime) -> tuple[datetime, datetime]:
    """The calendar month so far, in UTC: its first instant, and `at` to the
    millisecond, which is as finely as the contract compares times."""
    end = at.astimezone(UTC)
    end = end.replace(microsecond=end.microsecond // 1000 * 1000)
    return end.replace(day=1, hour=0, minute=0, second=0, microsecond=0), end


def estimated_cost(measures: Iterable[Measure], prices: Prices) -> dict[str, Any]:
    """What the usage comes to at the prices set on this server, or why that
    cannot be said. Always an estimate: this service reads no bill, so it has
    no actual cost to report."""
    amount = Decimal(0)
    models: set[str] = set()
    sandbox_unpriced = False
    for item in measures:
        if item.kind == "tokens":
            name = f"{item.provider}/{item.model}"
            price = prices.tokens.get(name)
            if price is None:
                models.add(name)
                continue
            rate = price.input if item.direction == "input" else price.output
            amount += item.quantity * rate / 1_000_000
        elif item.kind == "sandbox_seconds":
            if prices.sandbox_hour is None:
                sandbox_unpriced = True
                continue
            amount += item.quantity * prices.sandbox_hour / 3600
    unpriced = [*sorted(models), *(["sandbox time"] if sandbox_unpriced else [])]
    if unpriced:
        return {
            "kind": "unavailable",
            "reason": f"No price is set on this server for {_listed(unpriced)}.",
        }
    return {
        "kind": "estimate",
        "amountUsd": float(amount.quantize(MICRODOLLAR, ROUND_HALF_UP)),
    }


def _listed(names: list[str]) -> str:
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} or {names[-1]}"


def usage_summary(
    db: DbSession,
    organization_id: uuid.UUID,
    prices: Prices,
    at: datetime | None = None,
) -> dict[str, Any]:
    """The contract's usage summary for the month so far."""
    start, end = period_at(at or now())
    # Both ends belong to the period, at the millisecond.
    after = end + MILLISECOND
    sums = db.execute(
        select(
            UsageRecord.kind,
            UsageRecord.direction,
            UsageRecord.provider,
            UsageRecord.model,
            func.sum(UsageRecord.quantity),
        )
        .where(
            UsageRecord.organization_id == organization_id,
            UsageRecord.recorded_at >= start,
            UsageRecord.recorded_at < after,
        )
        .group_by(
            UsageRecord.kind,
            UsageRecord.direction,
            UsageRecord.provider,
            UsageRecord.model,
        )
    ).all()
    measures = [
        Measure(kind, int(total * UNIT), direction, provider, model)
        for kind, direction, provider, model, total in sums
    ]
    used = total_usage(measures)
    tokens = sum(row["input"] + row["output"] for row in used["tokens"])

    ended: dict[str | None, int] = {
        outcome: count
        for outcome, count in db.execute(
            select(Run.outcome, func.count())
            .where(
                Run.organization_id == organization_id,
                Run.started_at >= start,
                Run.started_at < after,
            )
            .group_by(Run.outcome)
        ).all()
    }
    started = sum(ended.values())
    running = db.scalar(
        select(func.count())
        .select_from(Run)
        .where(Run.organization_id == organization_id, Run.status == "running")
    )
    stored = db.scalar(
        select(func.coalesce(func.sum(Artifact.size_bytes), 0)).where(
            Artifact.organization_id == organization_id
        )
    )
    return {
        "period": {"from": timestamp(start), "to": timestamp(end)},
        **used,
        "runs": {
            "total": started,
            **{outcome: ended.get(outcome, 0) for outcome in OUTCOMES},
        },
        "storageBytes": int(stored or 0),
        "cost": estimated_cost(measures, prices),
        # Nothing on this server limits an organization yet: what a task may
        # use is bounded by its own budget.
        "quotas": {
            "concurrentRuns": {"used": running or 0, "max": None},
            "monthlyRuns": {"used": started, "max": None},
            "monthlyTokens": {"used": tokens, "max": None},
        },
    }


# --- the ledger against the events


@dataclass(frozen=True)
class Difference:
    """One place where what is recorded is not what the events say."""

    run_id: str | None
    event_seq: int | None
    what: str
    # What the events say and what is recorded; None where there is nothing.
    expected: str | None
    recorded: str | None


@dataclass(frozen=True)
class Reconciliation:
    runs: int
    events: int
    records: int
    differences: list[Difference]


def _plain(quantity: Decimal) -> str:
    return format(quantity.normalize(), "f")


def _subject(kind: str, direction: str | None) -> str:
    return f"{kind}.{direction}" if direction else kind


def _source(provider: str | None, model: str | None) -> str | None:
    return f"{provider}/{model}" if provider or model else None


def reconcile(
    db: DbSession, organization_id: uuid.UUID | None = None
) -> Reconciliation:
    """Measures every run's events again and compares the result with the
    ledger, entry by entry, and with the columns of the run that usage is
    counted from. Of one organization, or of them all."""
    differences: list[Difference] = []
    events = 0
    records = 0
    runs = db.execute(
        select(
            Run.id,
            Run.task_id,
            Run.organization_id,
            Run.base_commit,
            Run.started_at,
            Run.outcome,
        )
        .where(*([Run.organization_id == organization_id] if organization_id else []))
        .order_by(Run.created_at, Run.id)
    ).all()
    for run_id, task_id, owner, base_commit, started_at, outcome in runs:
        state = initial_run(str(run_id), str(task_id), base_commit)
        expected: dict[tuple[int, str, str | None], tuple[Measure, datetime]] = {}
        for seq, at, event_type, payload in db.execute(
            select(
                ExecutionEvent.seq,
                ExecutionEvent.at,
                ExecutionEvent.type,
                ExecutionEvent.payload,
            )
            .where(ExecutionEvent.run_id == run_id)
            .order_by(ExecutionEvent.seq)
        ):
            event = wire_event(run_id, seq, at, event_type, payload)
            for item in measure_event(state, event):
                expected[(seq, item.kind, item.direction)] = (item, at)
            state = reduce_run(state, event)
            events += 1

        def differs(
            seq: int | None,
            what: str,
            expected: str | None,
            recorded: str | None,
            run_id: uuid.UUID = run_id,
        ) -> None:
            differences.append(Difference(str(run_id), seq, what, expected, recorded))

        for record in db.execute(
            select(
                UsageRecord.event_seq,
                UsageRecord.kind,
                UsageRecord.direction,
                UsageRecord.quantity,
                UsageRecord.provider,
                UsageRecord.model,
                UsageRecord.organization_id,
                UsageRecord.recorded_at,
            )
            .where(UsageRecord.run_id == run_id)
            .order_by(UsageRecord.event_seq, UsageRecord.kind, UsageRecord.direction)
        ):
            records += 1
            subject = _subject(record.kind, record.direction)
            entry = (
                expected.pop((record.event_seq, record.kind, record.direction), None)
                if record.event_seq is not None
                else None
            )
            if entry is None:
                # No event measures this: the events do not account for it.
                differs(record.event_seq, subject, None, _plain(record.quantity))
                continue
            item, at = entry
            if int(record.quantity * UNIT) != item.units:
                differs(
                    record.event_seq,
                    subject,
                    _plain(item.quantity),
                    _plain(record.quantity),
                )
            if (record.provider, record.model) != (item.provider, item.model):
                differs(
                    record.event_seq,
                    f"{subject} model",
                    _source(item.provider, item.model),
                    _source(record.provider, record.model),
                )
            if record.organization_id != owner:
                differs(
                    record.event_seq,
                    f"{subject} organization",
                    str(owner),
                    str(record.organization_id),
                )
            if record.recorded_at != at:
                differs(
                    record.event_seq,
                    f"{subject} time",
                    at.isoformat(),
                    record.recorded_at.isoformat(),
                )
        for (seq, kind, direction), (item, _) in expected.items():
            differs(seq, _subject(kind, direction), _plain(item.quantity), None)

        # Runs are counted by when they started and how they ended.
        began = parse_timestamp(state["startedAt"])
        if started_at != began:
            differs(
                None,
                "run started",
                began.isoformat() if began else None,
                started_at.isoformat() if started_at else None,
            )
        if outcome != state["outcome"]:
            differs(None, "run outcome", state["outcome"], outcome)

    # An entry that names no run names no event either.
    for record in db.execute(
        select(
            UsageRecord.event_seq,
            UsageRecord.kind,
            UsageRecord.direction,
            UsageRecord.quantity,
        )
        .where(
            UsageRecord.run_id.is_(None),
            *(
                [UsageRecord.organization_id == organization_id]
                if organization_id
                else []
            ),
        )
        .order_by(UsageRecord.recorded_at, UsageRecord.id)
    ):
        records += 1
        differences.append(
            Difference(
                None,
                record.event_seq,
                _subject(record.kind, record.direction),
                None,
                _plain(record.quantity),
            )
        )
    return Reconciliation(len(runs), events, records, differences)
