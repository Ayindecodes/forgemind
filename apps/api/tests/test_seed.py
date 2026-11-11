import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session as DbSession

from forgemind_api.models import Organization, OrganizationMember, Session, User
from forgemind_api.seed import seed
from forgemind_api.settings import Settings, SettingsError


def counts(engine: Engine) -> tuple[int, ...]:
    with DbSession(engine) as db:
        return tuple(
            db.scalar(select(func.count()).select_from(table)) or 0
            for table in (User, Organization, OrganizationMember, Session)
        )


def test_the_seed_can_run_again_without_duplicating(
    database_url: str, engine: Engine
) -> None:
    settings = Settings(environment="test", database_url=database_url)
    seed(engine, settings)
    first = counts(engine)
    seed(engine, settings)
    assert counts(engine) == first
    users, organizations, members, sessions = first
    assert users >= 5 and organizations >= 1 and members >= 4 and sessions >= 4


def test_the_seed_refuses_outside_development_and_test(
    database_url: str, engine: Engine
) -> None:
    settings = Settings(
        environment="staging",
        database_url=database_url,
        redis_url="redis://queue:6379/0",
    )
    with pytest.raises(SettingsError, match="development and test"):
        seed(engine, settings)
