"""What a worker holds in the database while it works on something: a name no
other execution has, and a heartbeat that proves it is still there."""

from __future__ import annotations

import logging
import os
import socket
import threading
import uuid
from collections.abc import Callable

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import sessionmaker

log = logging.getLogger("forgemind_api.leases")

Sessions = sessionmaker[DbSession]


def new_worker_id() -> str:
    """Names one execution of one delivery. Never reused, so a lease cannot be
    mistaken for an earlier one from the same process."""
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


class Heartbeat:
    """Proves on a timer that this worker still holds what it claimed, and
    notices when it no longer does. `beat` renews the claim in the session it
    is given and says whether there was still a claim to renew."""

    def __init__(
        self,
        sessions: Sessions,
        holding: str,
        seconds: float,
        beat: Callable[[DbSession], bool],
    ) -> None:
        self.lost = threading.Event()
        self._sessions = sessions
        self._holding = holding
        self._seconds = seconds
        self._beat = beat
        self._done = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name=f"heartbeat-{holding}", daemon=True
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._done.set()
        self._thread.join(timeout=self._seconds + 5)

    def _run(self) -> None:
        while not self._done.wait(self._seconds):
            try:
                with self._sessions() as db, db.begin():
                    held = self._beat(db)
            except SQLAlchemyError:
                # Keep trying: if this lasts, the lease lapses by itself.
                log.warning(
                    "heartbeat not recorded",
                    extra={"holding": self._holding},
                    exc_info=True,
                )
                continue
            if not held:
                self.lost.set()
                return
