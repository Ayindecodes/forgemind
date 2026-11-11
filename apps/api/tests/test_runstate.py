"""The Python fold must arrive exactly where the contract's TypeScript fold
does, for every scripted scenario the dev API plays."""

import json
from pathlib import Path

import pytest

from forgemind_api.runstate import initial_run, reduce_run, run_from_events

FIXTURES = sorted((Path(__file__).parent / "fixtures" / "runs").glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_the_fold_matches_the_contract(path: Path) -> None:
    fixture = json.loads(path.read_text())
    folded = run_from_events("run-1", "task-1", "abc1234", fixture["events"])
    assert folded == fixture["run"]


def test_every_scenario_is_covered() -> None:
    assert {p.stem for p in FIXTURES} == {
        "happy",
        "retry-then-unverified",
        "partial",
        "failed",
        "investigation",
    }


def test_events_fold_one_at_a_time_and_old_ones_are_ignored() -> None:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "runs" / "happy.json").read_text()
    )
    run = initial_run("run-1", "task-1", "abc1234")
    assert run["status"] == "queued" and run["verification"] == "pending"
    for event in fixture["events"]:
        run = reduce_run(run, event)
    assert run == fixture["run"]
    replayed = reduce_run(run, fixture["events"][0])
    assert replayed == run


def test_verification_is_never_set_only_derived() -> None:
    fixture = json.loads(
        (Path(__file__).parent / "fixtures" / "runs" / "partial.json").read_text()
    )
    run = fixture["run"]
    required = [c for c in run["checks"] if c["required"]]
    assert any(c["status"] == "failed" for c in required)
    assert run["verification"] == "failed" and run["outcome"] == "partial"
