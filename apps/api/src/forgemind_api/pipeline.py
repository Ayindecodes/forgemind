"""What a run does, stage by stage. A step does one stage's work and records
it through its context. The worker owns each stage's start and end, so every
stage is recorded the same way whatever its step does."""

from __future__ import annotations

import uuid
from typing import Any, Protocol


class StageFailed(Exception):
    """The stage ran and did not succeed. `reason` is shown to people."""

    def __init__(self, reason: str, summary: str | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.summary = summary


class StepContext(Protocol):
    """What a step may do to the run it is working on."""

    run_id: uuid.UUID

    def emit(self, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Records one thing that happened and returns the event. Raises when
        the run is no longer this worker's, or its time budget has run out."""
        ...

    def check(self) -> None:
        """Raises under the same conditions as emit, recording nothing. A step
        calls this between units of long work so it stops promptly."""
        ...

    def remaining_seconds(self) -> float:
        """What is left of the run's time budget."""
        ...


class Step(Protocol):
    """One stage's executor."""

    @property
    def stage(self) -> str: ...

    @property
    def agent(self) -> str | None: ...

    def run(self, context: StepContext) -> str | None:
        """Does the stage's work and returns its summary. Raises StageFailed
        when the stage did not succeed."""
        ...


# The stages this server can execute, in order. A run stops, and says so, at
# the first stage that has no step here.
PIPELINE: tuple[Step, ...] = ()
