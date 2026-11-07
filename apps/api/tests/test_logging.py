import json
import logging

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
