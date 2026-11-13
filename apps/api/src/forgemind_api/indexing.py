"""Indexes a connected repository: what it is, found by reading it.

A repository that is "analyzing" waits for a worker. The worker clones it at
the commit its default branch is at, into a workspace nothing can write to,
inspects the files without running any of them, and stores what it found
against that commit.

As with runs, the queue only delivers the request and the database decides
who works on it. A request may be lost, repeated or late without a repository
being left waiting for ever, indexed by two workers at once, or written to by
a worker it no longer belongs to.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session as DbSession

from forgemind_api import workspace
from forgemind_api.auth import now
from forgemind_api.db import after_commit
from forgemind_api.github import GitHubProvider
from forgemind_api.inspection import Inspection, inspect_tree
from forgemind_api.leases import Heartbeat, Sessions, new_worker_id
from forgemind_api.models import GitHubInstallation, Repository, RepositoryAnalysis
from forgemind_api.queue import Dispatcher
from forgemind_api.settings import Settings
from forgemind_api.workspace import RepositoryUnavailable

log = logging.getLogger("forgemind_api.indexing")

INDEXING = "Indexing the repository"
NOT_INSTALLED = (
    "The GitHub App is not installed for this organization, so the repository "
    "cannot be read."
)
INTERNAL = "Indexing stopped on an internal error."

# What a delivery came to: the repository was indexed; it cannot be, and says
# why; this attempt failed and another is due; another worker holds it; it is
# not waiting to be indexed; it stopped being this worker's part-way; or there
# is no such repository.
Verdict = Literal["indexed", "failed", "retry", "held", "skipped", "lost", "missing"]


@dataclass(frozen=True)
class Claimed:
    """What a worker needs to know about the repository it has claimed."""

    full_name: str
    default_branch: str
    installation_id: int


@dataclass(frozen=True)
class Found:
    """What reading the repository at `commit` found."""

    commit: str
    files: int
    size: int
    inspection: Inspection


@dataclass(frozen=True)
class Failure:
    """Why an attempt did not index the repository, for people to read, and
    whether another attempt could."""

    reason: str
    permanent: bool


class NoLongerHeld(Exception):
    """The repository stopped being this worker's while it worked."""


def _s(count: int) -> str:
    return "" if count == 1 else "s"


def exhausted(attempts: int) -> str:
    return (
        f"No worker finished indexing this repository in {attempts} "
        f"attempt{_s(attempts)}, so it was stopped."
    )


def mark_undelivered(db: DbSession, repository_id: uuid.UUID) -> None:
    """Records that the request is not on the queue, so the next sweep puts it
    there instead of waiting out the usual grace."""
    db.execute(
        update(Repository)
        .where(Repository.id == repository_id, Repository.status == "analyzing")
        .values(index_dispatched_at=None)
    )


def request_indexing(db: DbSession, repo: Repository, dispatcher: Dispatcher) -> None:
    """Leaves `repo` waiting to be indexed, and queues it once the transaction
    has committed: a worker must never be handed a repository it cannot see
    yet. Whatever worker held it before holds it no longer."""
    repo.status = "analyzing"
    repo.status_message = INDEXING
    repo.index_attempts = 0
    repo.index_worker_id = None
    repo.index_heartbeat_at = None
    repo.index_dispatched_at = now()
    db.flush()
    repository_id = repo.id
    bind = db.get_bind()

    def send() -> None:
        if dispatcher.dispatch_indexing(repository_id):
            return
        with DbSession(bind) as other, other.begin():
            mark_undelivered(other, repository_id)

    after_commit(db, send)


def locked_repository(db: DbSession, repository_id: uuid.UUID) -> Repository | None:
    """The repository as it is now, held until the transaction ends."""
    return db.scalars(
        select(Repository)
        .where(Repository.id == repository_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).one_or_none()


def claim_is_live(repo: Repository, at: datetime, settings: Settings) -> bool:
    if repo.index_worker_id is None or repo.index_heartbeat_at is None:
        return False
    stale = timedelta(seconds=settings.worker_stale_seconds)
    return at - repo.index_heartbeat_at < stale


def release(repo: Repository) -> None:
    repo.index_worker_id = None
    repo.index_heartbeat_at = None
    repo.index_dispatched_at = None


def fail(repo: Repository, reason: str) -> None:
    """Ends the indexing with the reason people will read."""
    repo.status = "error"
    repo.status_message = reason
    release(repo)


def claim(
    db: DbSession,
    repository_id: uuid.UUID,
    holder: str,
    settings: Settings,
    at: datetime | None = None,
) -> Verdict | Claimed:
    """Takes the repository's indexing for `holder` if it is free to take. One
    transaction, with the repository locked: of any number of deliveries, one
    claims."""
    stamp = at or now()
    repo = locked_repository(db, repository_id)
    if repo is None:
        return "missing"
    if repo.status != "analyzing":
        return "skipped"
    if claim_is_live(repo, stamp, settings):
        return "held"
    if repo.index_attempts >= settings.worker_max_attempts:
        fail(repo, exhausted(repo.index_attempts))
        return "failed"
    installation_id = (
        db.scalar(
            select(GitHubInstallation.installation_id).where(
                GitHubInstallation.id == repo.installation_id
            )
        )
        if repo.installation_id is not None
        else None
    )
    if installation_id is None:
        fail(repo, NOT_INSTALLED)
        return "failed"
    repo.index_attempts += 1
    repo.index_worker_id = holder
    repo.index_heartbeat_at = stamp
    return Claimed(repo.full_name, repo.default_branch, installation_id)


def indexing_heartbeat(
    sessions: Sessions, repository_id: uuid.UUID, holder: str, seconds: float
) -> Heartbeat:
    """Proves on a timer that this worker still holds the repository."""

    def beat(db: DbSession) -> bool:
        held = db.execute(
            update(Repository)
            .where(
                Repository.id == repository_id,
                Repository.index_worker_id == holder,
                Repository.status == "analyzing",
            )
            .values(index_heartbeat_at=now())
            .returning(Repository.id)
        ).first()
        return held is not None

    return Heartbeat(sessions, f"indexing-{repository_id}", seconds, beat)


def read_repository(
    claimed: Claimed,
    settings: Settings,
    provider: GitHubProvider,
    lost: threading.Event,
) -> Found:
    """Clones the repository at the commit its default branch is at and
    inspects the files. Nothing in the repository is run."""
    workspace.remove_stale(settings.workspace_root, settings.indexing_seconds)
    with (
        provider.clone_access(claimed.installation_id, claimed.full_name) as source,
        workspace.checkout(
            source,
            branch=claimed.default_branch,
            root=settings.workspace_root,
            seconds=settings.indexing_seconds,
            max_bytes=settings.workspace_megabytes * 1_000_000,
        ) as checked_out,
    ):
        if lost.is_set():
            raise NoLongerHeld
        return Found(
            commit=checked_out.commit,
            files=checked_out.files,
            size=checked_out.size,
            inspection=inspect_tree(checked_out.path),
        )


def record_analysis(
    db: DbSession,
    repo: Repository,
    commit: str,
    inspection: Inspection,
    at: datetime,
) -> RepositoryAnalysis:
    """Stores what was found at `commit` as the repository's latest analysis.
    A commit analysed before keeps its one record, brought up to date."""
    analysis = db.scalars(
        select(RepositoryAnalysis).where(
            RepositoryAnalysis.repository_id == repo.id,
            RepositoryAnalysis.commit == commit,
        )
    ).first()
    if analysis is None:
        analysis = RepositoryAnalysis(
            repository_id=repo.id,
            commit=commit,
            analyzed_at=at,
            summary=inspection.summary,
            data=inspection.data,
        )
        db.add(analysis)
    else:
        analysis.analyzed_at = at
        analysis.summary = inspection.summary
        analysis.data = inspection.data
    repo.languages = inspection.languages
    repo.last_analyzed_commit = commit
    repo.last_analyzed_at = at
    return analysis


def conclude(
    sessions: Sessions,
    repository_id: uuid.UUID,
    holder: str,
    settings: Settings,
    outcome: Found | Failure,
) -> Verdict:
    """Writes what the attempt came to, if the repository is still this
    worker's to write to. Disconnected, connected again or taken over by
    another worker in the meantime, it is left exactly as they have it."""
    stamp = now()
    with sessions() as db, db.begin():
        repo = locked_repository(db, repository_id)
        if repo is None or repo.status != "analyzing" or repo.index_worker_id != holder:
            return "lost"
        if isinstance(outcome, Found):
            record_analysis(db, repo, outcome.commit, outcome.inspection, stamp)
            repo.status = "connected"
            repo.status_message = None
            release(repo)
            return "indexed"
        if outcome.permanent:
            fail(repo, outcome.reason)
            return "failed"
        if repo.index_attempts >= settings.worker_max_attempts:
            tried = f"Tried {repo.index_attempts} time{_s(repo.index_attempts)}."
            fail(repo, f"{outcome.reason} {tried}")
            return "failed"
        # Another attempt is due. It is left to the sweeper, which waits as
        # long as it would for a worker to pick up a request: time enough
        # for what was in the way to pass.
        repo.index_worker_id = None
        repo.index_heartbeat_at = None
        repo.index_dispatched_at = stamp
        return "retry"


def let_go(sessions: Sessions, repository_id: uuid.UUID, holder: str) -> None:
    """Gives the claim up if this worker still has it, with the repository
    marked as off the queue, so the next sweep puts it back instead of waiting
    for the claim to lapse."""
    try:
        with sessions() as db, db.begin():
            db.execute(
                update(Repository)
                .where(
                    Repository.id == repository_id,
                    Repository.index_worker_id == holder,
                )
                .values(
                    index_worker_id=None,
                    index_heartbeat_at=None,
                    index_dispatched_at=None,
                )
            )
    except SQLAlchemyError:
        log.warning(
            "indexing claim not released; it will lapse",
            extra={"repository_id": str(repository_id)},
            exc_info=True,
        )


def index_repository(
    sessions: Sessions,
    repository_id: uuid.UUID,
    settings: Settings,
    provider: GitHubProvider,
    worker_id: str | None = None,
) -> Verdict:
    """Handles one delivery of a repository to index. Safe to call any number
    of times, at once or one after another: the claim lets one caller through,
    and only the worker that still holds the claim writes a result."""
    holder = worker_id or new_worker_id()
    with sessions() as db, db.begin():
        claimed = claim(db, repository_id, holder, settings)
    if not isinstance(claimed, Claimed):
        return claimed
    heartbeat = indexing_heartbeat(
        sessions, repository_id, holder, settings.worker_heartbeat_seconds
    )
    heartbeat.start()
    began = time.monotonic()
    settled = False
    try:
        outcome: Found | Failure
        try:
            outcome = read_repository(claimed, settings, provider, heartbeat.lost)
        except NoLongerHeld:
            settled = True
            return "lost"
        except RepositoryUnavailable as unavailable:
            outcome = Failure(unavailable.reason, unavailable.permanent)
        except Exception:
            # The fault goes to the log. People see only that there was one.
            log.exception(
                "indexing stopped on an internal error",
                extra={"repository_id": str(repository_id)},
            )
            outcome = Failure(INTERNAL, permanent=False)
        verdict = conclude(sessions, repository_id, holder, settings, outcome)
        settled = True
        extra: dict[str, object] = {
            "repository_id": str(repository_id),
            "verdict": verdict,
            "seconds": round(time.monotonic() - began, 3),
        }
        if isinstance(outcome, Found):
            extra.update(commit=outcome.commit, files=outcome.files, bytes=outcome.size)
        else:
            extra.update(reason=outcome.reason)
        log.info("indexing attempt ended", extra=extra)
        return verdict
    finally:
        # Anything else that ends the delivery leaves the repository waiting,
        # for another attempt.
        heartbeat.stop()
        if not settled:
            let_go(sessions, repository_id, holder)


def sweep_indexing(
    sessions: Sessions,
    settings: Settings,
    dispatcher: Dispatcher,
    at: datetime | None = None,
) -> dict[str, int]:
    """Looks after repositories waiting to be indexed that nobody is looking
    after. One whose worker went quiet is queued again, or ended if it may not
    be picked up again; one that never reached a worker, or whose last attempt
    failed for a reason that may pass, is queued. Returns how many of each,
    and how many the queue would not take."""
    stamp = at or now()
    grace = timedelta(seconds=settings.worker_stale_seconds)
    patience = stamp - timedelta(seconds=settings.worker_redispatch_seconds)
    counts = {"recovered": 0, "stopped": 0, "queued": 0, "undelivered": 0}
    wanted: list[uuid.UUID] = []
    with sessions() as db, db.begin():
        candidates = db.scalars(
            select(Repository)
            .where(
                Repository.status == "analyzing",
                or_(
                    Repository.index_worker_id.is_(None),
                    Repository.index_heartbeat_at.is_(None),
                    Repository.index_heartbeat_at <= stamp - grace,
                ),
            )
            .order_by(Repository.connected_at)
            .with_for_update(skip_locked=True)
        ).all()
        for repo in candidates:
            abandoned = repo.index_worker_id is not None
            if abandoned:
                log.warning(
                    "indexing lost its worker",
                    extra={
                        "repository_id": str(repo.id),
                        "worker_id": repo.index_worker_id,
                    },
                )
                repo.index_worker_id = None
                repo.index_heartbeat_at = None
            elif (
                repo.index_dispatched_at is not None
                and repo.index_dispatched_at > patience
            ):
                continue  # queued recently enough; a worker may yet take it
            if repo.index_attempts >= settings.worker_max_attempts:
                fail(repo, exhausted(repo.index_attempts))
                counts["stopped"] += 1
                continue
            repo.index_dispatched_at = stamp
            wanted.append(repo.id)
            counts["recovered" if abandoned else "queued"] += 1
    undelivered = [
        repository_id
        for repository_id in wanted
        if not dispatcher.dispatch_indexing(repository_id)
    ]
    if undelivered:
        with sessions() as db, db.begin():
            for repository_id in undelivered:
                mark_undelivered(db, repository_id)
    counts["undelivered"] = len(undelivered)
    return counts
