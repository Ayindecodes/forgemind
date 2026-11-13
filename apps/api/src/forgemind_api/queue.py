"""The queue between the API and its workers. A message only says that a run,
or a repository waiting to be indexed, wants a worker; the database decides
who gets it. So a message may be lost, repeated or late without anything
being skipped or done twice."""

from __future__ import annotations

import logging
import uuid
from typing import Protocol

from celery import Celery
from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry
from sqlalchemy import update
from sqlalchemy.orm import Session as DbSession

from forgemind_api.auth import now
from forgemind_api.db import after_commit
from forgemind_api.models import Run
from forgemind_api.settings import Settings, SettingsError

log = logging.getLogger("forgemind_api.queue")

QUEUE = "forgemind"
EXECUTE_RUN = "forgemind.execute_run"
INDEX_REPOSITORY = "forgemind.index_repository"

# A caller waits no longer than this for the queue; the sweeper covers a miss.
CONNECT_SECONDS = 2
# No delivery may occupy a worker for longer than the longest budget a task
# can ask for, and a little. Past it the pool ends the process, and the
# sweeper ends the run.
HARD_LIMIT_SECONDS = (480 + 10) * 60


def make_celery(settings: Settings) -> Celery:
    """The Celery application the API publishes with and the workers consume
    with. Results are not kept: the event log is the record of a run."""
    if settings.redis_url is None:
        raise SettingsError("FORGEMIND_REDIS_URL is required to use the queue")
    celery = Celery("forgemind", broker=settings.redis_url)
    celery.conf.update(
        task_default_queue=QUEUE,
        task_ignore_result=True,
        task_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        broker_connection_retry_on_startup=True,
        broker_transport_options={
            "socket_connect_timeout": CONNECT_SECONDS,
            "socket_timeout": 10,
        },
        # One run at a time per process: a second message is not held back
        # behind a run that takes an hour.
        worker_prefetch_multiplier=1,
        worker_hijack_root_logger=False,
        task_time_limit=HARD_LIMIT_SECONDS,
    )
    return celery


def make_publisher(settings: Settings) -> Celery:
    """The application as the API and the sweeper use it, only to publish. It
    gives up on the queue at the first failure where a worker would wait for
    it to come back: someone is waiting on the request, and the next sweep
    covers the miss."""
    celery = make_celery(settings)
    celery.conf.broker_transport_options = {
        **celery.conf.broker_transport_options,
        "max_retries": 0,
    }
    return celery


class Dispatcher(Protocol):
    """Puts a run, or a repository to index, on the queue. True when the
    queue took it."""

    def dispatch(self, run_id: uuid.UUID) -> bool: ...

    def dispatch_indexing(self, repository_id: uuid.UUID) -> bool: ...


class CeleryDispatcher:
    def __init__(self, celery: Celery) -> None:
        self._celery = celery

    def dispatch(self, run_id: uuid.UUID) -> bool:
        try:
            self._celery.send_task(EXECUTE_RUN, args=[str(run_id)], retry=False)
        except Exception:
            # Whatever the queue's trouble, the run is safe in the database.
            log.warning("run not queued", extra={"run_id": str(run_id)}, exc_info=True)
            return False
        return True

    def dispatch_indexing(self, repository_id: uuid.UUID) -> bool:
        try:
            self._celery.send_task(
                INDEX_REPOSITORY, args=[str(repository_id)], retry=False
            )
        except Exception:
            # The repository is recorded as waiting; the sweeper asks again.
            log.warning(
                "indexing not queued",
                extra={"repository_id": str(repository_id)},
                exc_info=True,
            )
            return False
        return True


class NoQueue:
    """No queue is configured: runs and repositories to index are recorded
    and wait for one."""

    def dispatch(self, run_id: uuid.UUID) -> bool:
        return False

    def dispatch_indexing(self, repository_id: uuid.UUID) -> bool:
        return False


def make_dispatcher(settings: Settings) -> Dispatcher:
    if settings.redis_url is None:
        return NoQueue()
    return CeleryDispatcher(make_publisher(settings))


def queue_reachable(redis_url: str) -> bool:
    """True when the queue's Redis answers a ping."""
    try:
        client = Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
            redis_url,
            socket_connect_timeout=CONNECT_SECONDS,
            socket_timeout=CONNECT_SECONDS,
            retry=Retry(NoBackoff(), 0),  # one try: this is a health probe
        )
        try:
            return bool(client.ping())  # pyright: ignore[reportUnknownMemberType]
        finally:
            client.close()
    except Exception:
        return False


def mark_undelivered(db: DbSession, run_id: uuid.UUID) -> None:
    """Records that the run is not on the queue, so the next sweep puts it
    there instead of waiting out the usual grace."""
    db.execute(update(Run).where(Run.id == run_id).values(dispatched_at=None))


def dispatch_after_commit(db: DbSession, dispatcher: Dispatcher, run: Run) -> None:
    """Queues `run` once the transaction that created it has committed: a
    worker must never be handed a run it cannot see yet."""
    run.dispatched_at = now()
    run_id = run.id
    bind = db.get_bind()

    def send() -> None:
        if dispatcher.dispatch(run_id):
            return
        with DbSession(bind) as other, other.begin():
            mark_undelivered(other, run_id)

    after_commit(db, send)
