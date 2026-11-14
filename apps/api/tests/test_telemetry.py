"""Every request and every job leaves a span, a count, a time and a log line
that leads back to the span. Read here from the process that recorded them,
and from what a process sends to a collector."""

from __future__ import annotations

import logging
import socket
import time
from typing import Any

import pytest
from celery.app.task import Context
from fastapi.testclient import TestClient
from opentelemetry.trace import SpanKind, StatusCode

from forgemind_api.app import REQUEST_ID_HEADER, create_app
from forgemind_api.logging import request_id_var
from forgemind_api.queue import EXECUTE_RUN, QUEUE
from forgemind_api.settings import Settings
from forgemind_api.telemetry import (
    JOB_DURATION,
    JOB_OUTCOME,
    JOBS,
    REQUEST_ID,
    REQUEST_ID_ATTRIBUTE,
    Telemetry,
    carried,
)
from forgemind_api.worker import SWEEP_RUNS, delivery, swept
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
from tests.workers import QUIET

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


def test_a_job_is_a_span_a_count_and_a_time_under_what_it_came_to() -> None:
    seen = observed(SETTINGS, "forgemind-sweeper")
    with seen.telemetry.job(SWEEP_RUNS) as job:
        job.outcome = "quiet"
    with seen.telemetry.job(SWEEP_RUNS) as job:
        job.outcome = "quiet"
    with seen.telemetry.job(SWEEP_RUNS, attributes={"why": "an example"}) as job:
        job.outcome = "swept"
    with seen.telemetry.job("forgemind.example"):
        pass
    spans = seen.spans()
    assert [
        (span.name, span.kind, dict(span.attributes or {})[JOB_OUTCOME])
        for span in spans
    ] == [
        (SWEEP_RUNS, SpanKind.INTERNAL, "quiet"),
        (SWEEP_RUNS, SpanKind.INTERNAL, "quiet"),
        (SWEEP_RUNS, SpanKind.INTERNAL, "swept"),
        ("forgemind.example", SpanKind.INTERNAL, "ok"),
    ]
    assert dict(spans[2].attributes or {})["why"] == "an example"
    assert len({trace_id_of(span) for span in spans}) == 4
    assert spans[0].resource.attributes["service.name"] == "forgemind-sweeper"
    counted = {
        (SWEEP_RUNS, "quiet"): 2,
        (SWEEP_RUNS, "swept"): 1,
        ("forgemind.example", "ok"): 1,
    }
    assert seen.points(JOBS, "job", "outcome") == counted
    assert seen.points(JOB_DURATION, "job", "outcome") == counted


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


def test_what_a_message_carries_is_the_trace_and_the_request_it_was_sent_in() -> None:
    assert carried() == {}
    seen = observed(SETTINGS)
    token = request_id_var.set("request-9")
    try:
        with seen.telemetry.job("forgemind.example"):
            carrier = carried()
        assert carried() == {REQUEST_ID: "request-9"}
    finally:
        request_id_var.reset(token)
    [span] = seen.spans()
    assert sorted(carrier) == [REQUEST_ID, "traceparent"]
    assert carrier[REQUEST_ID] == "request-9"
    # The W3C header: a version, the trace, the span sending, and flags.
    assert carrier["traceparent"].split("-")[:3] == [
        "00",
        trace_id_of(span),
        span_id_of(span),
    ]


def test_a_job_taken_from_the_queue_continues_the_trace_its_message_was_sent_in() -> (
    None
):
    sender, worker = observed(SETTINGS), observed(SETTINGS, "forgemind-worker")
    with sender.telemetry.job("forgemind.example"):
        carrier = carried()
    with worker.telemetry.job(EXECUTE_RUN, carrier):
        pass
    # A message from a sender that traced nothing, or wrote nonsense, is
    # still a delivery: it starts a trace of its own.
    with worker.telemetry.job(EXECUTE_RUN, {}):
        pass
    with worker.telemetry.job(EXECUTE_RUN, {"traceparent": "nonsense"}):
        pass
    [sent] = sender.spans()
    continued, alone, confused = worker.spans()
    assert (trace_id_of(continued), parent_id_of(continued)) == (
        trace_id_of(sent),
        span_id_of(sent),
    )
    assert [span.kind for span in worker.spans()] == [SpanKind.CONSUMER] * 3
    assert alone.parent is None
    assert confused.parent is None
    assert len({trace_id_of(span) for span in worker.spans()}) == 3


# --- a worker's deliveries, and the sweeper's sweeps

CARRYING = {"traceparent": TRACEPARENT, REQUEST_ID: "request-7"}


@pytest.mark.parametrize(
    "request_",
    [
        # As a worker hands a task its request: what the message carried is
        # lifted onto it, beside Celery's own.
        Context({"id": "message-1", "task": EXECUTE_RUN, **CARRYING}),
        # As a task called in this process finds it: kept together.
        Context({"id": "message-1", "task": EXECUTE_RUN, "headers": CARRYING}),
    ],
    ids=["from the queue", "called in process"],
)
def test_a_delivery_is_a_job_in_the_senders_trace_logged_under_the_senders_request(
    request_: Context,
) -> None:
    seen = observed(SETTINGS, "forgemind-worker")
    with (
        log_lines() as lines,
        delivery(
            seen.telemetry, request_, EXECUTE_RUN, {"forgemind.run_id": "run-1"}
        ) as job,
    ):
        job.outcome = "executed"
        logging.getLogger("forgemind_api.worker").info("delivery handled")
    # The request it was logged under ends with the delivery.
    assert request_id_var.get() is None
    [span] = seen.spans()
    assert (span.name, span.kind) == (EXECUTE_RUN, SpanKind.CONSUMER)
    assert (trace_id_of(span), parent_id_of(span)) == (TRACE_ID, CALLER_SPAN_ID)
    assert dict(span.attributes or {}) == {
        "messaging.destination.name": QUEUE,
        "messaging.message.id": "message-1",
        "forgemind.run_id": "run-1",
        JOB_OUTCOME: "executed",
    }
    [line] = lines
    assert (line["message"], line["request_id"], line["trace_id"], line["span_id"]) == (
        "delivery handled",
        "request-7",
        TRACE_ID,
        span_id_of(span),
    )
    assert seen.points(JOBS, "job", "outcome") == {(EXECUTE_RUN, "executed"): 1}


def test_a_delivery_that_carried_nothing_is_a_job_with_a_trace_of_its_own() -> None:
    seen = observed(SETTINGS, "forgemind-worker")
    with (
        log_lines() as lines,
        delivery(seen.telemetry, Context(), EXECUTE_RUN, {}) as job,
    ):
        logging.getLogger("forgemind_api.worker").info("delivery handled")
    [span] = seen.spans()
    assert (span.kind, span.parent) == (SpanKind.CONSUMER, None)
    assert dict(span.attributes or {}) == {
        "messaging.destination.name": QUEUE,
        JOB_OUTCOME: job.outcome,
    }
    assert (lines[0]["request_id"], lines[0]["trace_id"]) == (None, trace_id_of(span))


def test_a_delivery_that_fails_still_ends_the_request_it_was_logged_under() -> None:
    seen = observed(SETTINGS, "forgemind-worker")
    request = Context({"id": "message-1", **CARRYING})
    with (
        log_lines() as lines,
        pytest.raises(RuntimeError),
        delivery(seen.telemetry, request, EXECUTE_RUN, {}),
    ):
        raise RuntimeError("the database went away")
    assert request_id_var.get() is None
    assert [(line["message"], line["request_id"]) for line in lines] == [
        ("job failed", "request-7")
    ]
    assert seen.points(JOBS, "job", "outcome") == {(EXECUTE_RUN, "error"): 1}


def test_a_sweep_that_did_something_says_so_aloud_and_a_quiet_one_quietly() -> None:
    seen = observed(SETTINGS, "forgemind-sweeper")
    with log_lines("forgemind_api.worker") as lines:
        with seen.telemetry.job(SWEEP_RUNS) as job:
            swept(job, "swept", {**QUIET, "queued": 1})
        with seen.telemetry.job(SWEEP_RUNS) as job:
            swept(job, "swept", QUIET)
    busy, quiet = seen.spans()
    assert [
        (line["level"], line["message"], line["queued"], line["trace_id"])
        for line in lines
    ] == [
        ("INFO", "swept", 1, trace_id_of(busy)),
        ("DEBUG", "swept", 0, trace_id_of(quiet)),
    ]
    assert all(isinstance(line["duration_ms"], int) for line in lines)
    assert dict(busy.attributes or {}) == {
        "forgemind.sweep.recovered": 0,
        "forgemind.sweep.stopped": 0,
        "forgemind.sweep.queued": 1,
        "forgemind.sweep.undelivered": 0,
        JOB_OUTCOME: "swept",
    }
    assert dict(quiet.attributes or {})[JOB_OUTCOME] == "quiet"
    assert seen.points(JOBS, "job", "outcome") == {
        (SWEEP_RUNS, "swept"): 1,
        (SWEEP_RUNS, "quiet"): 1,
    }


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


def test_what_is_left_is_sent_when_telemetry_shuts_down() -> None:
    with collector() as receiving:
        settings = Settings(otel_endpoint=receiving.url)
        telemetry = Telemetry(settings, "forgemind-sweeper")
        with telemetry.job(SWEEP_RUNS) as job:
            job.outcome = "quiet"
        telemetry.shutdown()
        assert [(s.service, s.name, s.kind) for s in receiving.spans()] == [
            ("forgemind-sweeper", SWEEP_RUNS, "internal")
        ]
        assert receiving.points("forgemind-sweeper", JOBS, "job", "outcome") == {
            (SWEEP_RUNS, "quiet"): 1
        }
        # Shutting down twice is no harm: a process may be asked more than once.
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
