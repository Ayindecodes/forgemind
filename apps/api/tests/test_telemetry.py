"""Every request and every job leaves a span, a count, a time and a log line
that leads back to the span. Read here from the process that recorded them,
and from what a process sends to a collector."""

from __future__ import annotations

import socket
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from opentelemetry.trace import SpanKind, StatusCode

from forgemind_api.app import REQUEST_ID_HEADER, create_app
from forgemind_api.queue import EXECUTE_RUN
from forgemind_api.settings import Settings
from forgemind_api.telemetry import (
    JOB_DURATION,
    JOB_OUTCOME,
    JOBS,
    REQUEST_ID_ATTRIBUTE,
    Telemetry,
)
from tests.observing import (
    CALLER_SPAN_ID,
    TRACE_ID,
    TRACEPARENT,
    Observed,
    SentSpan,
    collector,
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


# --- jobs


def test_a_job_that_raises_is_an_error_everywhere_it_is_recorded() -> None:
    seen = observed(SETTINGS, "forgemind-worker")
    with (
        log_lines() as lines,
        pytest.raises(RuntimeError),
        seen.telemetry.job(EXECUTE_RUN) as job,
    ):
        job.outcome = "executed"
        raise RuntimeError("the database went away")
    [span] = seen.spans()
    assert dict(span.attributes or {})[JOB_OUTCOME] == "error"
    assert span.status.status_code is StatusCode.ERROR
    [event] = span.events
    assert dict(event.attributes or {})["exception.message"] == (
        "the database went away"
    )
    assert seen.points(JOBS, "job", "outcome") == {(EXECUTE_RUN, "error"): 1}
    assert seen.points(JOB_DURATION, "job", "outcome") == {(EXECUTE_RUN, "error"): 1}
    [line] = lines
    assert (line["level"], line["message"], line["job"], line["error"]) == (
        "ERROR",
        "job failed",
        EXECUTE_RUN,
        "RuntimeError",
    )
    assert (line["trace_id"], line["span_id"]) == (trace_id_of(span), span_id_of(span))
    assert isinstance(line["duration_ms"], int)


# --- sending


def test_with_an_endpoint_set_spans_and_metrics_are_sent_to_it() -> None:
    with collector() as receiving:
        settings = Settings(version="1.2.3", otel_endpoint=receiving.url)
        telemetry = Telemetry(settings, "forgemind-worker")
        try:
            with telemetry.job(
                EXECUTE_RUN, {"traceparent": TRACEPARENT}, {"forgemind.run_id": "run-1"}
            ) as job:
                job.outcome = "executed"
            assert receiving.spans() == []
            telemetry.flush()
            [span] = receiving.spans()
            assert span == SentSpan(
                "forgemind-worker",
                EXECUTE_RUN,
                "consumer",
                TRACE_ID,
                span.span_id,
                CALLER_SPAN_ID,
                {"forgemind.run_id": "run-1", JOB_OUTCOME: "executed"},
            )
            sent = ("forgemind-worker", JOBS, "job", "outcome")
            assert receiving.points(*sent) == {(EXECUTE_RUN, "executed"): 1}
            assert receiving.points(
                "forgemind-worker", JOB_DURATION, "job", "outcome"
            ) == {(EXECUTE_RUN, "executed"): 1}

            with telemetry.job(EXECUTE_RUN, {}) as job:
                job.outcome = "executed"
            telemetry.flush()
            assert len(receiving.spans("forgemind-worker")) == 2
            assert receiving.points(*sent) == {(EXECUTE_RUN, "executed"): 2}
            assert receiving.spans("forgemind-api") == []
        finally:
            telemetry.shutdown()


def test_a_collector_that_is_not_there_costs_a_job_a_bounded_wait_and_nothing_else(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("forgemind_api.telemetry.EXPORT_SECONDS", 1)
    with socket.socket() as listening:
        # A port nothing answers on: bound, and never listened on.
        listening.bind(("127.0.0.1", 0))
        endpoint = f"http://127.0.0.1:{listening.getsockname()[1]}"
        telemetry = Telemetry(Settings(otel_endpoint=endpoint), "forgemind-worker")
        try:
            started = time.monotonic()
            with telemetry.job(EXECUTE_RUN, {}) as job:
                job.outcome = "executed"
            telemetry.flush()
            assert time.monotonic() - started < 6
        finally:
            telemetry.shutdown()
