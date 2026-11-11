"""The contract's run state, folded from events: a line-for-line port of
packages/contract/src/reduce-run.ts, so what this service serves is exactly
what the events say. Keys are the contract's camelCase, because the folded
state goes on the wire as it is. Fixtures generated through the TypeScript
reducer prove the two folds agree."""

from __future__ import annotations

from typing import Any

STAGES = (
    "inspection",
    "planning",
    "implementation",
    "testing",
    "review",
    "verification",
    "approval",
)

Run = dict[str, Any]
Event = dict[str, Any]


def initial_run(run_id: str, task_id: str, base_commit: str) -> Run:
    return finalize(
        {
            "id": run_id,
            "taskId": task_id,
            "status": "queued",
            "outcome": None,
            "verification": "pending",
            "expectsPatch": True,
            "stages": [
                {"id": stage, "status": "pending", "attempts": []} for stage in STAGES
            ],
            "checks": [],
            "activeAgent": None,
            "currentOperation": None,
            "activeFiles": [],
            "retries": {"used": 0, "max": 0},
            "diff": None,
            "review": None,
            "resources": {"cpuSeconds": 0, "memoryPeakMb": 0, "sandboxSeconds": 0},
            "baseCommit": base_commit,
            "branch": None,
            "lastSeq": 0,
            "startedAt": None,
            "finishedAt": None,
            "error": None,
        }
    )


def is_finished(status: str) -> bool:
    return status in ("completed", "awaiting_approval", "cancelled")


def derive_verification(checks: list[dict[str, Any]], finished: bool) -> str:
    """The only way a run becomes verified: it has finished, and every
    required check ran and passed."""
    required = [check for check in checks if check["required"]]
    if any(check["status"] == "failed" for check in required):
        return "failed"
    if not finished:
        return "pending"
    if required and all(check["status"] == "passed" for check in required):
        return "verified"
    return "unverified"


def derive_outcome(run: Run) -> str | None:
    if not is_finished(run["status"]) or run["status"] == "cancelled":
        return None
    stage_failed = any(stage["status"] == "failed" for stage in run["stages"])
    diff = run["diff"]
    has_patch = diff is not None and diff["filesChanged"] > 0
    if run["error"]:
        return "unverified" if has_patch else "failed"
    if not has_patch:
        return "failed" if run["expectsPatch"] or stage_failed else "succeeded"
    verification = derive_verification(run["checks"], finished=True)
    required = [check for check in run["checks"] if check["required"]]
    if verification == "verified":
        return "partial" if stage_failed else "succeeded"
    if verification == "failed":
        return (
            "failed"
            if all(check["status"] == "failed" for check in required)
            else "partial"
        )
    return "unverified"


def finalize(run: Run) -> Run:
    out = dict(run)
    out["verification"] = derive_verification(out["checks"], is_finished(out["status"]))
    out["outcome"] = derive_outcome(out)
    return out


def reduce_run(run: Run, event: Event) -> Run:
    if event["seq"] <= run["lastSeq"]:
        return run
    return finalize(apply({**run, "lastSeq": event["seq"]}, event))


def _recent(paths: list[str], path: str) -> list[str]:
    seen: list[str] = []
    for item in [*paths, path]:
        if item not in seen:
            seen.append(item)
    return seen[-12:]


def apply(run: Run, event: Event) -> Run:
    kind = event["type"]
    if kind == "run.started":
        return {
            **run,
            "status": "running",
            "startedAt": event["at"],
            "baseCommit": event["baseCommit"],
            "branch": event["branch"],
            "expectsPatch": event["expectsPatch"],
            "retries": {"used": 0, "max": event["maxRetries"]},
        }
    if kind == "stage.started":
        attempt = {
            "number": event["attempt"],
            "status": "running",
            "agent": event["agent"],
            "startedAt": event["at"],
            "finishedAt": None,
            "summary": None,
            "failureReason": None,
        }
        return {
            **run,
            "stages": [
                {
                    **stage,
                    "status": "running",
                    "attempts": [*stage["attempts"], attempt],
                }
                if stage["id"] == event["stage"]
                else stage
                for stage in run["stages"]
            ],
            "activeAgent": event["agent"],
            "currentOperation": None,
            "activeFiles": [],
        }
    if kind == "stage.finished":
        return {
            **run,
            "stages": [
                {
                    **stage,
                    "status": event["status"],
                    "attempts": [
                        {
                            **attempt,
                            "status": event["status"],
                            "finishedAt": event["at"],
                            "summary": event["summary"],
                            "failureReason": event["failureReason"],
                        }
                        if attempt["number"] == event["attempt"]
                        else attempt
                        for attempt in stage["attempts"]
                    ],
                }
                if stage["id"] == event["stage"]
                else stage
                for stage in run["stages"]
            ],
        }
    if kind == "operation":
        return {
            **run,
            "currentOperation": event["text"],
            "activeAgent": event["agent"]
            if event["agent"] is not None
            else run["activeAgent"],
        }
    if kind == "file.inspected":
        return {**run, "activeFiles": _recent(run["activeFiles"], event["path"])}
    if kind == "file.changed":
        diff = run["diff"] or {"filesChanged": 0, "additions": 0, "deletions": 0}
        return {
            **run,
            "activeFiles": _recent(run["activeFiles"], event["path"]),
            "diff": {
                "filesChanged": diff["filesChanged"] + 1,
                "additions": diff["additions"] + event["additions"],
                "deletions": diff["deletions"] + event["deletions"],
            },
        }
    if kind == "check.started":
        return {
            **run,
            "checks": [
                *[check for check in run["checks"] if check["id"] != event["checkId"]],
                {
                    "id": event["checkId"],
                    "kind": event["kind"],
                    "label": event["label"],
                    "command": event["command"],
                    "required": event["required"],
                    "status": "running",
                    "startedAt": event["at"],
                    "finishedAt": None,
                    "durationMs": None,
                    "summary": None,
                    "counts": None,
                    "outputArtifactId": None,
                },
            ],
        }
    if kind == "check.finished":
        return {
            **run,
            "checks": [
                {
                    **check,
                    "status": event["status"],
                    "finishedAt": event["at"],
                    "durationMs": event["durationMs"],
                    "summary": event["summary"],
                    "counts": event["counts"],
                }
                if check["id"] == event["checkId"]
                else check
                for check in run["checks"]
            ],
        }
    if kind == "retry.scheduled":
        # A retry re-runs the stages from implementation. Their checks run again.
        return {
            **run,
            "retries": {**run["retries"], "used": run["retries"]["used"] + 1},
            "checks": [],
            "diff": None,
            "review": None,
        }
    if kind == "review.finished":
        return {
            **run,
            "review": {
                "verdict": event["verdict"],
                "concerns": event["concerns"],
                "acceptanceCriteriaMet": event["acceptanceCriteriaMet"],
            },
        }
    if kind == "resources.sampled":
        return {
            **run,
            "resources": {
                "cpuSeconds": event["cpuSeconds"],
                "memoryPeakMb": max(
                    run["resources"]["memoryPeakMb"], event["memoryMb"]
                ),
                "sandboxSeconds": event["sandboxSeconds"],
            },
        }
    if kind == "approval.requested":
        return {
            **run,
            "status": "awaiting_approval",
            "activeAgent": None,
            "currentOperation": None,
        }
    if kind == "run.finished":
        return {
            **run,
            "status": event["status"],
            "finishedAt": event["at"],
            "error": event["error"],
            "activeAgent": None,
            "currentOperation": None,
            "stages": [
                {**stage, "status": "skipped"}
                if stage["status"] in ("pending", "running")
                else stage
                for stage in run["stages"]
            ],
        }
    # agent.note, command.*, log: a record, not a change of state.
    return run


def run_from_events(
    run_id: str, task_id: str, base_commit: str, events: list[Event]
) -> Run:
    run = initial_run(run_id, task_id, base_commit)
    for event in events:
        run = reduce_run(run, event)
    return run
