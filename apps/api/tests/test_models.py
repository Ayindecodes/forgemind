import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from forgemind_api.models import (
    ExecutionEvent,
    Organization,
    OrganizationMember,
    Repository,
    Run,
    Task,
    User,
)


def seed(session: Session) -> tuple[Organization, User, Repository, Task, Run]:
    org = Organization(name="Ayinde Creations", slug=f"ayinde-{uuid.uuid4().hex[:6]}")
    user = User(email=f"{uuid.uuid4().hex[:8]}@example.com", name="Ayinde")
    session.add_all([org, user])
    session.flush()
    session.add(
        OrganizationMember(organization_id=org.id, user_id=user.id, role="owner")
    )
    repo = Repository(
        organization_id=org.id,
        github_id=811001,
        full_name="forgemind/api",
        private=True,
        default_branch="main",
        url="https://github.com/forgemind/api",
        status="connected",
    )
    session.add(repo)
    session.flush()
    task = Task(
        organization_id=org.id,
        repository_id=repo.id,
        title="Fix retry budget overflow",
        request="Stop retrying past the budget.",
        category="fix_bug",
        base_commit="abc1234",
        budget_minutes=60,
        budget_retries=2,
        budget_tokens=400_000,
        created_by=user.id,
    )
    session.add(task)
    session.flush()
    run = Run(
        task_id=task.id,
        organization_id=org.id,
        number=1,
        expects_patch=True,
        base_commit="abc1234",
        retries_max=2,
    )
    session.add(run)
    session.flush()
    task.current_run_id = run.id
    session.flush()
    return org, user, repo, task, run


def test_a_task_points_at_its_current_run_and_the_run_back_at_the_task(
    session: Session,
) -> None:
    _, _, _, task, run = seed(session)
    assert task.current_run_id == run.id
    assert run.task_id == task.id
    assert task.status == "queued"
    assert run.verification == "pending"


def test_execution_events_are_unique_per_run_and_sequence(session: Session) -> None:
    _, _, _, _, run = seed(session)
    now = datetime.now(UTC)
    session.add(
        ExecutionEvent(run_id=run.id, seq=1, type="run.started", at=now, payload={})
    )
    session.flush()
    session.add(
        ExecutionEvent(run_id=run.id, seq=1, type="run.started", at=now, payload={})
    )
    with pytest.raises(IntegrityError):
        session.flush()


def test_an_unknown_status_is_rejected_in_python_and_in_the_database(
    session: Session,
) -> None:
    _, _, _, task, _ = seed(session)
    # The column type refuses the value before it reaches the database...
    task.status = "exploded"
    with pytest.raises(StatementError):
        session.flush()
    session.rollback()
    # ...and the CHECK constraint refuses it even when the type is bypassed.
    _, _, _, task, _ = seed(session)
    with pytest.raises(IntegrityError):
        session.execute(
            text("update tasks set status = 'exploded' where id = :id"),
            {"id": task.id},
        )


def test_emails_are_unique_regardless_of_case(session: Session) -> None:
    _, user, _, _, _ = seed(session)
    session.add(User(email=user.email.upper(), name="Twin"))
    with pytest.raises(IntegrityError):
        session.flush()


def test_a_repository_is_connected_once_per_organization(session: Session) -> None:
    org, _, repo, _, _ = seed(session)
    session.add(
        Repository(
            organization_id=org.id,
            github_id=repo.github_id,
            full_name=repo.full_name,
            private=True,
            default_branch="main",
            url=repo.url,
            status="connected",
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()


def test_a_task_needs_a_repository_that_exists(session: Session) -> None:
    org, user, _, _, _ = seed(session)
    session.add(
        Task(
            organization_id=org.id,
            repository_id=uuid.uuid4(),
            title="Orphan",
            request="No repository.",
            category="docs",
            base_commit="abc1234",
            budget_minutes=1,
            budget_retries=0,
            budget_tokens=1000,
            created_by=user.id,
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
