"""Every request leaves a span, a count, a time and a log line that leads back
to the span. Read here from the process that recorded them."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from opentelemetry.trace import SpanKind, StatusCode

from forgemind_api.app import REQUEST_ID_HEADER, create_app
from forgemind_api.settings import Settings
from forgemind_api.telemetry import REQUEST_ID_ATTRIBUTE, Telemetry
from tests.observing import (
    CALLER_SPAN_ID,
    TRACE_ID,
    TRACEPARENT,
    Observed,
    log_lines,
    observed,
    parent_id_of,
    span_id_of,
    trace_id_of,
)

SETTINGS = Settings(version="1.2.3", commit="abc1234")

REQUESTS = "http.server.duration"


def serving(seen: Observed, **options: Any) -> TestClient:
    return TestClient(create_app(SETTINGS, seen.telemetry), **options)


# --- requests


def test_a_request_is_one_span_that_says_what_was_asked_and_answered() -> None:
    seen = observed(SETTINGS)
    serving(seen).get("/health", headers={REQUEST_ID_HEADER: "request-7"})
    [span] = seen.spans()
    assert (span.name, span.kind) == ("GET /health", SpanKind.SERVER)
    attributes = dict(span.attributes or {})
    assert attributes["http.method"] == "GET"
    assert attributes["http.route"] == "/health"
    assert attributes["http.status_code"] == 200
    assert attributes[REQUEST_ID_ATTRIBUTE] == "request-7"
    described = dict(span.resource.attributes)
    assert described["service.name"] == "forgemind-api"
    assert described["service.version"] == "1.2.3"
    assert described["deployment.environment"] == "development"
    assert len(str(described["service.instance.id"])) == 32


def test_a_request_continues_the_trace_its_caller_sent() -> None:
    seen = observed(SETTINGS)
    client = serving(seen)
    client.get("/health", headers={"traceparent": TRACEPARENT})
    client.get("/health")
    continued, fresh = seen.spans()
    assert (trace_id_of(continued), parent_id_of(continued)) == (
        TRACE_ID,
        CALLER_SPAN_ID,
    )
    assert trace_id_of(fresh) != TRACE_ID
    assert fresh.parent is None


def test_requests_are_counted_and_timed_by_route_and_status() -> None:
    seen = observed(SETTINGS)
    client = serving(seen)
    client.get("/health")
    client.get("/health")
    client.get("/no-such-thing")
    client.get("/usage")
    assert seen.points(REQUESTS, "http.method", "http.target", "http.status_code") == {
        ("GET", "/health", 200): 2,
        # Nothing is served there, so there is no route to count it under.
        ("GET", None, 404): 1,
        ("GET", "/usage", 500): 1,
    }


def test_the_request_log_line_says_how_long_it_took_and_which_trace_it_is_in() -> None:
    seen = observed(SETTINGS)
    with log_lines() as lines:
        serving(seen).get(
            "/health",
            headers={REQUEST_ID_HEADER: "request-7", "traceparent": TRACEPARENT},
        )
    [line] = [line for line in lines if line["message"] == "request"]
    [span] = seen.spans()
    assert (line["request_id"], line["path"], line["status"]) == (
        "request-7",
        "/health",
        200,
    )
    assert (line["trace_id"], line["span_id"]) == (TRACE_ID, span_id_of(span))
    assert isinstance(line["duration_ms"], int)
    assert 0 <= line["duration_ms"] < 5000


def test_a_request_nothing_answers_for_is_logged_traced_and_counted_all_the_same() -> (
    None
):
    seen = observed(SETTINGS)
    app = create_app(SETTINGS, seen.telemetry)

    @app.get("/broken")
    def broken() -> None:  # pyright: ignore[reportUnusedFunction]
        raise RuntimeError("no handler takes this")

    with log_lines() as lines:
        response = TestClient(app, raise_server_exceptions=False).get(
            "/broken", headers={REQUEST_ID_HEADER: "request-8"}
        )
    assert response.status_code == 500
    [line] = [line for line in lines if line["message"] == "request"]
    [span] = seen.spans()
    assert (line["level"], line["status"], line["request_id"]) == (
        "ERROR",
        500,
        "request-8",
    )
    assert "RuntimeError: no handler takes this" in line["exception"]
    assert line["trace_id"] == trace_id_of(span)
    assert isinstance(line["duration_ms"], int)
    assert span.status.status_code is StatusCode.ERROR
    assert dict(span.attributes or {})["http.status_code"] == 500
    assert [event.name for event in span.events] == ["exception"]
    assert seen.points(REQUESTS, "http.target", "http.status_code") == {
        ("/broken", 500): 1
    }


def test_each_application_records_into_its_own_telemetry() -> None:
    one, other = observed(SETTINGS), observed(SETTINGS)
    serving(one).get("/health")
    assert len(one.spans()) == 1
    assert other.spans() == []
    assert other.points(REQUESTS) == {}
    # An application nobody hands telemetry makes its own.
    assert isinstance(create_app(SETTINGS).state.telemetry, Telemetry)
