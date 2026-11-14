import json
import logging

from opentelemetry.sdk.trace import TracerProvider

from forgemind_api.logging import JsonFormatter, request_id_var


def test_log_lines_are_json_with_the_request_id() -> None:
    record = logging.LogRecord(
        "forgemind_api", logging.INFO, __file__, 1, "request", (), None
    )
    record.status = 200
    token = request_id_var.set("trace-42")
    try:
        line = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)
    assert line["message"] == "request"
    assert line["level"] == "INFO"
    assert line["request_id"] == "trace-42"
    assert line["status"] == 200
    assert line["time"].endswith("+00:00")
    # Written outside any span, it names none.
    assert "trace_id" not in line and "span_id" not in line


def test_a_line_written_inside_a_span_names_the_span_and_its_trace() -> None:
    record = logging.LogRecord(
        "forgemind_api", logging.INFO, __file__, 1, "x", (), None
    )
    with TracerProvider().get_tracer("test").start_as_current_span("work") as span:
        line = json.loads(JsonFormatter().format(record))
    context = span.get_span_context()
    # The ids as a trace viewer shows them: lower-case hex, zero-padded.
    assert line["trace_id"] == format(context.trace_id, "032x")
    assert line["span_id"] == format(context.span_id, "016x")
    assert (len(line["trace_id"]), len(line["span_id"])) == (32, 16)
