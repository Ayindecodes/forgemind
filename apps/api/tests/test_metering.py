"""The Python measures must be exactly the ones the contract's TypeScript
takes, for every scripted scenario the dev API plays: the ledger is written
with these, and anything that speaks the contract may check it."""

import json
from pathlib import Path
from typing import Any

import pytest

from forgemind_api.metering import (
    Measure,
    measure_event,
    meter_run,
    total_usage,
    units,
)
from forgemind_api.runstate import initial_run, reduce_run

FIXTURES = sorted((Path(__file__).parent / "fixtures" / "runs").glob("*.json"))

START = {
    "type": "run.started",
    "baseCommit": "abc",
    "branch": "fix/x",
    "expectsPatch": True,
    "maxRetries": 2,
}


def log(*templates: dict[str, Any]) -> list[dict[str, Any]]:
    """Events numbered from one, a second apart unless they say when."""
    return [
        {
            "id": f"e{index}",
            "runId": "run-1",
            "seq": index,
            "at": f"2026-11-02T00:00:{index - 1:02d}.000Z",
            **template,
        }
        for index, template in enumerate(templates, start=1)
    ]


def sampled(cpu: float, memory: float, sandbox: float) -> dict[str, Any]:
    return {
        "type": "resources.sampled",
        "cpuSeconds": cpu,
        "memoryMb": memory,
        "sandboxSeconds": sandbox,
    }


def started(attempt: int, at: str) -> dict[str, Any]:
    return {
        "type": "stage.started",
        "stage": "implementation",
        "attempt": attempt,
        "agent": "developer",
        "at": at,
    }


def finished(attempt: int, at: str) -> dict[str, Any]:
    return {
        "type": "stage.finished",
        "stage": "implementation",
        "attempt": attempt,
        "status": "failed",
        "summary": None,
        "failureReason": "tests failed",
        "at": at,
    }


def quantities(events: list[dict[str, Any]]) -> list[tuple[int, str, str]]:
    return [
        (event["seq"], item.kind, str(item.quantity))
        for event, item in meter_run(events)
    ]


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_the_measures_match_the_contract(path: Path) -> None:
    fixture = json.loads(path.read_text())
    metered = meter_run(fixture["events"])
    assert [
        {**item.json(), "runId": event["runId"], "seq": event["seq"], "at": event["at"]}
        for event, item in metered
    ] == fixture["measures"]
    assert total_usage(item for _, item in metered) == fixture["usage"]


def test_the_scenarios_between_them_measure_every_kind() -> None:
    measured = {
        (item["kind"], item["direction"])
        for path in FIXTURES
        for item in json.loads(path.read_text())["measures"]
    }
    assert measured == {
        ("tokens", "input"),
        ("tokens", "output"),
        ("cpu_seconds", None),
        ("sandbox_seconds", None),
        ("memory_mb_hours", None),
        ("retry_overhead_seconds", None),
    }


def test_a_half_rounds_up_as_it_does_in_javascript() -> None:
    # Python's own round sends these halves to the even neighbour: 2, 4 and 0.
    assert [units(0.00025), units(0.00045), units(0.00005)] == [3, 5, 1]
    assert [units(1200), units(0.1 + 0.2), units(512 * 14 / 3600)] == [
        12_000_000,
        3000,
        19911,
    ]
    assert quantities(
        log(START, sampled(0.00025, 0, 0.00005), sampled(0.0007, 0, 0.0005))
    ) == [
        (2, "cpu_seconds", "0.0003"),
        (2, "sandbox_seconds", "0.0001"),
        (3, "cpu_seconds", "0.0005"),
        (3, "sandbox_seconds", "0.0005"),
    ]


def test_a_total_that_fell_has_started_again_from_zero() -> None:
    assert quantities(log(START, sampled(8, 400, 30), sampled(1.5, 200, 6))) == [
        (2, "cpu_seconds", "8"),
        (2, "sandbox_seconds", "30"),
        (2, "memory_mb_hours", "3.3333"),
        (3, "cpu_seconds", "1.5"),
        (3, "sandbox_seconds", "6"),
        (3, "memory_mb_hours", "0.3333"),
    ]


def test_times_are_read_to_the_millisecond_however_fine_they_are_written() -> None:
    # This service writes microseconds, the dev API milliseconds.
    assert quantities(
        log(
            START,
            started(2, "2026-11-02T00:01:00.000900Z"),
            finished(2, "2026-11-02T00:01:01.000100Z"),
        )
    ) == [(3, "retry_overhead_seconds", "1")]
    assert quantities(
        log(
            START,
            started(2, "2026-11-02T00:01:00+00:00"),
            finished(2, "2026-11-02T00:01:48.250Z"),
        )
    ) == [(3, "retry_overhead_seconds", "48.25")]


def test_only_attempts_after_the_first_are_retry_overhead() -> None:
    assert (
        quantities(
            log(
                START,
                started(1, "2026-11-02T00:00:10Z"),
                finished(1, "2026-11-02T00:00:40Z"),
            )
        )
        == []
    )


def test_a_retry_the_run_ended_in_the_middle_of_still_counts() -> None:
    events = log(
        START,
        started(1, "2026-11-02T00:00:10Z"),
        finished(1, "2026-11-02T00:00:40Z"),
        started(2, "2026-11-02T00:01:00Z"),
        {
            "type": "run.finished",
            "status": "cancelled",
            "error": None,
            "at": "2026-11-02T00:01:12.500Z",
        },
    )
    assert quantities(events) == [(5, "retry_overhead_seconds", "12.5")]


def test_an_event_the_run_has_taken_in_measures_nothing() -> None:
    first, call = log(
        START,
        {
            "type": "model.called",
            "agent": "developer",
            "provider": "anthropic",
            "model": "model-a",
            "inputTokens": 1200,
            "outputTokens": 0,
        },
    )
    before = reduce_run(initial_run("run-1", "task-1", "abc"), first)
    assert measure_event(before, call) == [
        Measure("tokens", 12_000_000, "input", "anthropic", "model-a")
    ]
    assert measure_event(reduce_run(before, call), call) == []


def test_totals_ignore_a_kind_they_have_no_place_for() -> None:
    assert total_usage(
        [Measure("storage_bytes", 10_000), Measure("cpu_seconds", 15_000)]
    ) == {
        "tokens": [],
        "sandboxSeconds": 0,
        "cpuSeconds": 1.5,
        "memoryMbHours": 0,
        "retryOverheadSeconds": 0,
    }
