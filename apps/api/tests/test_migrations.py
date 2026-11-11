from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, inspect, text

from forgemind_api.db import downgrade, migrate
from forgemind_api.models import Base

EXPECTED_TABLES = set(Base.metadata.tables)


def test_head_creates_every_table_the_models_declare(engine: Engine) -> None:
    present = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert present == EXPECTED_TABLES
    assert len(EXPECTED_TABLES) == 21


def test_enum_columns_are_enforced_by_check_constraints(engine: Engine) -> None:
    with engine.connect() as connection:
        count = connection.execute(
            text("select count(*) from pg_constraint where contype = 'c'")
        ).scalar()
    assert count is not None and count >= 30


def test_downgrade_removes_everything_and_upgrade_rebuilds_it(
    database_url: str, engine: Engine
) -> None:
    downgrade(database_url)
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    migrate(database_url)
    present = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert present == EXPECTED_TABLES


def test_the_migrations_build_exactly_what_the_models_declare(engine: Engine) -> None:
    with engine.connect() as connection:
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        differences = compare_metadata(context, Base.metadata)
    assert differences == []
