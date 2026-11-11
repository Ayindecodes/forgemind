"""A real worker whose stages wait where a test tells them to, so that the
test can kill it part-way through a run. Run as a process:

    python -m tests.slow_worker

FORGEMIND_* configure it like any worker. SLOW_HOLD names the stage that
waits, and SLOW_RELEASE the file whose appearance lets it go on."""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

from forgemind_api.pipeline import StepContext
from forgemind_api.settings import load_settings
from forgemind_api.worker import run_worker
from tests.workers import Scripted


def work(stage: str) -> Callable[[StepContext], str | None]:
    def run(context: StepContext) -> str | None:
        context.emit("log", {"level": "info", "text": f"{stage} at work"})
        if os.environ.get("SLOW_HOLD") == stage:
            release = Path(os.environ["SLOW_RELEASE"])
            while not release.exists():
                context.check()
                time.sleep(0.05)
        return f"{stage} done"

    return run


if __name__ == "__main__":
    stages = ("inspection", "planning")
    sys.exit(
        run_worker(load_settings(), [Scripted(stage, work(stage)) for stage in stages])
    )
