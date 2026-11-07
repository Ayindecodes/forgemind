from fastapi.testclient import TestClient

from forgemind_api.app import create_app
from forgemind_api.settings import Settings


def test_health_reports_a_reachable_database(database_url: str) -> None:
    app = create_app(Settings(database_url=database_url))
    try:
        response = TestClient(app).get("/health")
    finally:
        app.state.engine.dispose()
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["checks"] == {"database": "ok"}


def test_health_degrades_when_the_database_is_unreachable() -> None:
    unreachable = "postgresql+psycopg://fm:fm@127.0.0.1:1/fm"
    app = create_app(Settings(database_url=unreachable))
    try:
        response = TestClient(app).get("/health")
    finally:
        app.state.engine.dispose()
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"] == {"database": "unreachable"}
