"""A real PostgreSQL for the database tests, started once per session in a
throwaway container and migrated to head. Each test runs in a transaction
that is rolled back, so tests never see each other's rows.

The worker tests cannot work that way: a worker commits, and is read from
other connections and other processes. Each of them gets a database of its
own, copied from a migrated and seeded template, and a real Redis."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from redis import Redis
from sqlalchemy import Engine, create_engine, make_url, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

from forgemind_api.db import make_engine, make_session_factory, migrate
from forgemind_api.seed import seed
from forgemind_api.settings import Settings

TEMPLATE = "forgemind_template"


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    with PostgresContainer("postgres:17-alpine", driver="psycopg") as postgres:
        url = postgres.get_connection_url()
        migrate(url)
        yield url


@pytest.fixture(scope="session")
def engine(database_url: str) -> Iterator[Engine]:
    engine = make_engine(database_url)
    yield engine
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


def _named(database_url: str, name: str) -> str:
    return (
        make_url(database_url).set(database=name).render_as_string(hide_password=False)
    )


def _administer(database_url: str, statement: str) -> None:
    """Runs a statement that cannot run inside a transaction."""
    admin = create_engine(
        database_url, isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    with admin.connect() as connection:
        connection.execute(text(statement))
    admin.dispose()


@pytest.fixture(scope="session")
def template_database(database_url: str) -> str:
    """A migrated, seeded database that exists only to be copied."""
    _administer(database_url, f"CREATE DATABASE {TEMPLATE}")
    url = _named(database_url, TEMPLATE)
    migrate(url)
    seeding = create_engine(url, poolclass=NullPool)
    seed(seeding, Settings(environment="test", database_url=url))
    seeding.dispose()
    return TEMPLATE


@pytest.fixture
def own_database_url(database_url: str, template_database: str) -> Iterator[str]:
    """A database nothing else uses, seeded, dropped when the test ends."""
    name = f"forgemind_{uuid.uuid4().hex[:12]}"
    _administer(database_url, f"CREATE DATABASE {name} TEMPLATE {template_database}")
    yield _named(database_url, name)
    _administer(database_url, f"DROP DATABASE {name} WITH (FORCE)")


@pytest.fixture
def sessions(own_database_url: str) -> Iterator[sessionmaker[Session]]:
    engine = make_engine(own_database_url)
    yield make_session_factory(engine)
    engine.dispose()


@pytest.fixture(scope="session")
def redis_server() -> Iterator[str]:
    with RedisContainer("redis:7-alpine") as redis:
        host = redis.get_container_host_ip()
        yield f"redis://{host}:{redis.get_exposed_port(6379)}"


@pytest.fixture
def redis_url(redis_server: str) -> Iterator[str]:
    """An empty queue."""
    url = f"{redis_server}/0"
    client = Redis.from_url(url)  # pyright: ignore[reportUnknownMemberType]
    client.flushdb()  # pyright: ignore[reportUnknownMemberType]
    yield url
    client.close()
