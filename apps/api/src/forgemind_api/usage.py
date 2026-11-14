"""What an organization used. The figures are sums over the usage ledger,
which `append_event` enters from each event as it is recorded."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import now
from forgemind_api.metering import UNIT, Measure, total_usage
from forgemind_api.models import Artifact, Run, UsageRecord
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
