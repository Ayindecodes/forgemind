"""The database connection and the migrations that shape it."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

# Shipped inside the package, so a container or a wheel carries its schema.
MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def make_engine(url: str) -> Engine:
    """A pooled engine that notices dead connections and does not hang."""
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        connect_args={"connect_timeout": 3},
    )


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)


def database_reachable(engine: Engine) -> bool:
    """True when a trivial statement round-trips."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def alembic_config(url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    config.set_main_option("sqlalchemy.url", url)
    return config


def migrate(url: str, revision: str = "head") -> None:
    """Bring the database at `url` to `revision`."""
    command.upgrade(alembic_config(url), revision)


def downgrade(url: str, revision: str = "base") -> None:
    command.downgrade(alembic_config(url), revision)
