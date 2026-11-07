from fastapi.testclient import TestClient

from forgemind_api.app import create_app
from forgemind_api.settings import Settings


def test_health_reports_a_reachable_database(database_url: str) -> None:
    client = TestClient(create_app(Settings(database_url=database_url)))
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["checks"] == {"database": "ok"}


def test_health_degrades_when_the_database_is_unreachable() -> None:
    unreachable = "postgresql+psycopg://fm:fm@127.0.0.1:1/fm"
    client = TestClient(create_app(Settings(database_url=unreachable)))
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"
    assert response.json()["checks"] == {"database": "unreachable"}
