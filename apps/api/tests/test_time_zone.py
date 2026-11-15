"""Times leave the API in UTC whatever zone the database is set to. The
contract's timestamps are UTC only, and the interface refuses anything else."""

import re
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from forgemind_api.app import create_app
from forgemind_api.db import make_engine
from forgemind_api.settings import Settings
from tests.conftest import _administer  # pyright: ignore[reportPrivateUsage]

OWNER = {"cookie": "fm_session=dev-owner"}
TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def times_in(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [time for item in value.values() for time in times_in(item)]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(value, list):
        return [time for item in value for time in times_in(item)]  # pyright: ignore[reportUnknownVariableType]
    return [value] if isinstance(value, str) and TIME.match(value) else []


def zone(engine: Any) -> str:
    with engine.connect() as connection:
        return connection.execute(text("show timezone")).scalar_one()


def test_a_database_in_another_zone_is_still_read_in_utc(
    database_url: str, own_database_url: str
) -> None:
    name = make_url(own_database_url).database
    _administer(database_url, f"ALTER DATABASE {name} SET timezone TO 'Asia/Tokyo'")

    # What a connection is given when nothing is asked of it: the test means
    # something only if this is not UTC.
    plain = create_engine(own_database_url, poolclass=NullPool)
    assert zone(plain) == "Asia/Tokyo"
    plain.dispose()

    engine = make_engine(own_database_url)
    assert zone(engine) == "UTC"
    engine.dispose()

    app = create_app(Settings(environment="test", database_url=own_database_url))
    try:
        client = TestClient(app)
        bodies = [
            client.get(path, headers=OWNER).json()
            for path in ("/auth/session", "/repositories", "/tasks", "/usage")
        ]
    finally:
        app.state.engine.dispose()
    times = times_in(bodies)
    assert len(times) > 10
    assert [time for time in times if not time.endswith("Z")] == []
