"""What the telemetry tests share: telemetry that can be read back in the
process that recorded it, a stand-in for a collector to read what a process
sent, and log lines as they are written."""

from __future__ import annotations

import contextlib
import gzip
import json
import logging
import threading
from collections.abc import Generator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.common.v1.common_pb2 import KeyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span as WireSpan
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from forgemind_api.logging import JsonFormatter
from forgemind_api.settings import Settings
from forgemind_api.telemetry import Service, Telemetry

# A trace as a caller would send it: `traceparent`, and the ids inside it.
TRACE_ID = "0af7651916cd43dd8448eb211c80319c"
CALLER_SPAN_ID = "b7ad6b7169203331"
TRACEPARENT = f"00-{TRACE_ID}-{CALLER_SPAN_ID}-01"


def trace_id_of(span: ReadableSpan) -> str:
    context = span.get_span_context()
    assert context is not None
    return format(context.trace_id, "032x")


def span_id_of(span: ReadableSpan) -> str:
    context = span.get_span_context()
    assert context is not None
    return format(context.span_id, "016x")


def parent_id_of(span: ReadableSpan) -> str | None:
    return format(span.parent.span_id, "016x") if span.parent else None


@dataclass
class Observed:
    """Telemetry that keeps what it records where a test can read it."""

    telemetry: Telemetry
    exporter: InMemorySpanExporter
    reader: InMemoryMetricReader

    def spans(self) -> list[ReadableSpan]:
        """The spans that have ended, in the order they ended."""
        return list(self.exporter.get_finished_spans())

    def points(self, metric: str, *keys: str) -> dict[tuple[Any, ...], float]:
        """What `metric` has come to so far under each combination of the
        attributes named: a sum's value, or how many times a histogram was
        recorded."""
        found: dict[tuple[Any, ...], float] = {}
        data = self.reader.get_metrics_data()
        resources: list[Any] = list(data.resource_metrics) if data else []
        for resource in resources:
            for scope in resource.scope_metrics:
                for item in scope.metrics:
                    if item.name != metric:
                        continue
                    for point in item.data.data_points:
                        attributes: dict[str, Any] = dict(point.attributes or {})
                        key = tuple(attributes.get(name) for name in keys)
                        amount: Any = getattr(point, "count", None)
                        if amount is None:
                            amount = getattr(point, "value", 0)
                        found[key] = found.get(key, 0) + amount
        return found


def observed(settings: Settings, service: Service = "forgemind-api") -> Observed:
    exporter = InMemorySpanExporter()
    reader = InMemoryMetricReader()
    telemetry = Telemetry(settings, service, [SimpleSpanProcessor(exporter)], [reader])
    return Observed(telemetry, exporter, reader)


@contextlib.contextmanager
def log_lines(logger: str = "forgemind_api") -> Generator[list[dict[str, Any]]]:
    """Every line `logger` and those under it write inside the block, as the
    JSON it would be written as."""
    lines: list[dict[str, Any]] = []

    class Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(json.loads(self.format(record)))

    handler = Capture(logging.DEBUG)
    handler.setFormatter(JsonFormatter())
    target = logging.getLogger(logger)
    level = target.level
    target.addHandler(handler)
    target.setLevel(logging.DEBUG)
    try:
        yield lines
    finally:
        target.setLevel(level)
        target.removeHandler(handler)


# --- what a process sent


@dataclass(frozen=True)
class SentSpan:
    service: str
    name: str
    kind: str
    trace_id: str
    span_id: str
    parent_id: str | None
    attributes: dict[str, Any]


@dataclass(frozen=True)
class SentPoint:
    service: str
    metric: str
    attributes: dict[str, Any]
    # A sum's value, or how many times a histogram was recorded.
    amount: float


def _plain(attributes: Any) -> dict[str, Any]:
    plain: dict[str, Any] = {}
    item: KeyValue
    for item in attributes:
        which = item.value.WhichOneof("value")
        plain[item.key] = getattr(item.value, which) if which else None
    return plain


@dataclass
class Collector:
    """Takes what is sent to it over OTLP/HTTP, the way a collector would,
    and keeps it. Listens on a port the machine picks, on this machine only."""

    url: str = ""
    _spans: list[SentSpan] = field(default_factory=list[SentSpan])
    _points: dict[tuple[str, str, str], SentPoint] = field(
        default_factory=dict[tuple[str, str, str], SentPoint]
    )
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def spans(self, service: str | None = None) -> list[SentSpan]:
        with self._lock:
            return [s for s in self._spans if service in (None, s.service)]

    def points(
        self, service: str, metric: str, *keys: str
    ) -> dict[tuple[Any, ...], float]:
        """The latest of `metric` from `service`, as `Observed.points`."""
        found: dict[tuple[Any, ...], float] = {}
        with self._lock:
            for point in self._points.values():
                if (point.service, point.metric) != (service, metric):
                    continue
                key = tuple(point.attributes.get(name) for name in keys)
                found[key] = found.get(key, 0) + point.amount
        return found

    def take_traces(self, body: bytes) -> None:
        request = ExportTraceServiceRequest.FromString(body)
        with self._lock:
            for resource in request.resource_spans:
                service = _plain(resource.resource.attributes).get("service.name", "")
                for scope in resource.scope_spans:
                    for span in scope.spans:
                        kind = WireSpan.SpanKind.Name(span.kind)
                        self._spans.append(
                            SentSpan(
                                service,
                                span.name,
                                kind.removeprefix("SPAN_KIND_").lower(),
                                span.trace_id.hex(),
                                span.span_id.hex(),
                                span.parent_span_id.hex() or None,
                                _plain(span.attributes),
                            )
                        )

    def take_metrics(self, body: bytes) -> None:
        request = ExportMetricsServiceRequest.FromString(body)
        with self._lock:
            for resource in request.resource_metrics:
                described = _plain(resource.resource.attributes)
                service = described.get("service.name", "")
                instance = described.get("service.instance.id", "")
                for scope in resource.scope_metrics:
                    for metric in scope.metrics:
                        kind = metric.WhichOneof("data")
                        if kind == "sum":
                            points = [
                                (_plain(p.attributes), p.as_int or p.as_double)
                                for p in metric.sum.data_points
                            ]
                        elif kind == "histogram":
                            points = [
                                (_plain(p.attributes), p.count)
                                for p in metric.histogram.data_points
                            ]
                        else:
                            continue
                        for attributes, amount in points:
                            # Each export repeats the running total: the
                            # latest from each process replaces the last.
                            key = (
                                instance,
                                metric.name,
                                json.dumps(attributes, sort_keys=True),
                            )
                            self._points[key] = SentPoint(
                                service, metric.name, attributes, amount
                            )


@contextlib.contextmanager
def collector() -> Generator[Collector]:
    receiving = Collector()

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            body = self.rfile.read(int(self.headers.get("content-length", 0)))
            if self.headers.get("content-encoding") == "gzip":
                body = gzip.decompress(body)
            if self.path == "/v1/traces":
                receiving.take_traces(body)
            elif self.path == "/v1/metrics":
                receiving.take_metrics(body)
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", "application/x-protobuf")
            self.send_header("content-length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    receiving.url = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield receiving
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)
