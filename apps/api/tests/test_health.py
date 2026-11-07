import json
import logging

from fastapi.testclient import TestClient

from forgemind_api.app import REQUEST_ID_HEADER, create_app
from forgemind_api.logging import JsonFormatter
from forgemind_api.settings import Settings


def client() -> TestClient:
    return TestClient(create_app(Settings(version="1.2.3", commit="abc1234")))


def test_health_says_who_it_is() -> None:
    response = client().get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "forgemind-api",
        "version": "1.2.3",
        "commit": "abc1234",
        "environment": "development",
    }


def test_every_response_carries_a_request_id() -> None:
    fresh = client().get("/health")
    assert len(fresh.headers[REQUEST_ID_HEADER]) == 32

    echoed = client().get("/health", headers={REQUEST_ID_HEADER: "trace-42"})
    assert echoed.headers[REQUEST_ID_HEADER] == "trace-42"


def test_cors_is_limited_to_the_web_origin() -> None:
    allowed = client().options(
        "/health",
        headers={
            "origin": "http://localhost:3200",
            "access-control-request-method": "GET",
        },
    )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:3200"
    assert allowed.headers["access-control-allow-credentials"] == "true"

    other = client().options(
        "/health",
        headers={
            "origin": "https://evil.example",
            "access-control-request-method": "GET",
        },
    )
    assert "access-control-allow-origin" not in other.headers


def test_the_request_log_line_carries_the_request_id() -> None:
    lines: list[str] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(self.format(record))

    handler = Capture()
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("forgemind_api")
    logger.addHandler(handler)
    try:
        client().get("/health", headers={REQUEST_ID_HEADER: "trace-7"})
    finally:
        logger.removeHandler(handler)
    request_lines = [json.loads(line) for line in lines if "request" in line]
    assert request_lines[-1]["request_id"] == "trace-7"
    assert request_lines[-1]["path"] == "/health"
    assert request_lines[-1]["status"] == 200
