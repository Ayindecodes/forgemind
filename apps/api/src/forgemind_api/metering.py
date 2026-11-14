"""What a run used, read off its events: a port of
packages/contract/src/metering.ts. An event is measured against the run as it
stood before it, so each figure is counted once, by the event that carries it.
Fixtures measured through the TypeScript prove the two agree to the last
ten-thousandth, which is what lets the ledger written here be checked against
the events by anything that speaks the contract."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from forgemind_api.runstate import Event, Run, initial_run, reduce_run

UNIT = 10_000
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class Measure:
    kind: str
    # Ten-thousandths: whole numbers, which add up without drifting.
    units: int
    # For tokens: read by the model or written by it. Otherwise None.
    direction: str | None = None
    provider: str | None = None
    model: str | None = None

    @property
    def quantity(self) -> Decimal:
        return Decimal(self.units) / UNIT

    def json(self) -> dict[str, Any]:
        """The measure as the contract writes it."""
        return {
            "kind": self.kind,
            "quantity": self.units / UNIT,
            "direction": self.direction,
            "provider": self.provider,
            "model": self.model,
        }


def units(quantity: float) -> int:
    """A quantity in ten-thousandths, rounded as JavaScript's Math.round
    rounds: a half goes up."""
    scaled = quantity * UNIT
    whole = math.floor(scaled)
    return whole + 1 if scaled - whole >= 0.5 else whole


def measure(
    kind: str,
    quantity: float,
    direction: str | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> list[Measure]:
    counted = units(quantity)
    if counted <= 0:
        return []
    return [Measure(kind, counted, direction, provider, model)]


def milliseconds(at: str) -> int:
    """Milliseconds since 1970. Anything finer in the timestamp is dropped."""
    moment = datetime.fromisoformat(at.replace("Z", "+00:00"))
    return (moment - EPOCH) // timedelta(milliseconds=1)


def advance(previous: float, reading: float) -> float:
    """How far a running total moved. One that reads lower than it did has
    started again from zero, so all of the new reading counts."""
    return reading - previous if reading >= previous else reading


def seconds_between(start: str, end: str) -> float:
    return max(0, milliseconds(end) - milliseconds(start)) / 1000


def measure_event(run: Run, event: Event) -> list[Measure]:
    """What `event` adds to the usage of `run`, the run before the event."""
    if event["seq"] <= run["lastSeq"]:
        return []
    kind = event["type"]

    if kind == "model.called":
        source = (event["provider"], event["model"])
        return [
            *measure("tokens", event["inputTokens"], "input", *source),
            *measure("tokens", event["outputTokens"], "output", *source),
        ]

    if kind == "resources.sampled":
        resources = run["resources"]
        sandbox = advance(resources["sandboxSeconds"], event["sandboxSeconds"])
        return [
            *measure(
                "cpu_seconds", advance(resources["cpuSeconds"], event["cpuSeconds"])
            ),
            *measure("sandbox_seconds", sandbox),
            # The memory in use at the sample, held for the time since the last.
            *measure("memory_mb_hours", (event["memoryMb"] * sandbox) / 3600),
        ]

    # An attempt after the first is time spent because an earlier one failed.
    if kind == "stage.finished":
        if event["attempt"] < 2:
            return []
        attempt = next(
            (
                attempt
                for stage in run["stages"]
                if stage["id"] == event["stage"]
                for attempt in stage["attempts"]
                if attempt["number"] == event["attempt"]
                and attempt["status"] == "running"
            ),
            None,
        )
        if attempt is None:
            return []
        return measure(
            "retry_overhead_seconds", seconds_between(attempt["startedAt"], event["at"])
        )

    # A run that ends in the middle of a retry spent the time all the same.
    if kind == "run.finished":
        return measure(
            "retry_overhead_seconds",
            sum(
                seconds_between(attempt["startedAt"], event["at"])
                for stage in run["stages"]
                for attempt in stage["attempts"]
                if attempt["number"] >= 2 and attempt["status"] == "running"
            ),
        )

    return []


def meter_run(events: Iterable[Event]) -> list[tuple[Event, Measure]]:
    """Every measure in one run's events, in order, each with its event."""
    run: Run | None = None
    metered: list[tuple[Event, Measure]] = []
    for event in events:
        if run is None:
            run = initial_run(event["runId"], "", "")
        metered.extend((event, item) for item in measure_event(run, event))
        run = reduce_run(run, event)
    return metered


def total_usage(measures: Iterable[Measure]) -> dict[str, Any]:
    """Measures added up, tokens by the model that used them."""
    sums = {
        "sandbox_seconds": 0,
        "cpu_seconds": 0,
        "memory_mb_hours": 0,
        "retry_overhead_seconds": 0,
    }
    tokens: dict[str, dict[str, Any]] = {}
    for item in measures:
        if item.kind in sums:
            sums[item.kind] += item.units
            continue
        if item.kind != "tokens":
            continue
        if not item.provider or not item.model or not item.direction:
            continue
        row = tokens.setdefault(
            f"{item.provider}/{item.model}",
            {"provider": item.provider, "model": item.model, "input": 0, "output": 0},
        )
        row[item.direction] += item.units // UNIT
    return {
        "tokens": [row for _, row in sorted(tokens.items())],
        "sandboxSeconds": sums["sandbox_seconds"] / UNIT,
        "cpuSeconds": sums["cpu_seconds"] / UNIT,
        "memoryMbHours": sums["memory_mb_hours"] / UNIT,
        "retryOverheadSeconds": sums["retry_overhead_seconds"] / UNIT,
    }
