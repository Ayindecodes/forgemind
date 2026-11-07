"""Alembic runs with the URL from its config, which forgemind_api.db sets."""

from __future__ import annotations

from alembic import context
from sqlalchemy import engine_from_config, pool

from forgemind_api.models import Base

config = context.config
target_metadata = Base.metadata

# `alembic -x url=postgresql+psycopg://... upgrade head` targets another database.
_override = context.get_x_argument(as_dictionary=True).get("url")
if _override:
    config.set_main_option("sqlalchemy.url", _override)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
