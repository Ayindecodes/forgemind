"""Traces and metrics, for the API, a worker and the sweeper alike. Each process
holds its own providers instead of the library's process-wide ones, so nothing
is set up by an import and a test can read what was recorded. Everything is
recorded always and sent only where an OTLP endpoint is configured, so turning
observability on is configuration.

A request is traced and timed by the FastAPI instrumentation. A job, which is
a delivery a worker handles or a sweep, is traced and counted here. A message
on the queue carries the trace it was sent in, so a run's delivery belongs to
the trace of the request, or the sweep, that queued it."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Literal

from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    MetricReader,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, SpanKind
from opentelemetry.trace.propagation.tracecontext import (
    TraceContextTextMapPropagator,
)

from forgemind_api.logging import request_id_var
from forgemind_api.settings import Settings

log = logging.getLogger("forgemind_api.telemetry")

Service = Literal["forgemind-api", "forgemind-worker", "forgemind-sweeper"]

# What a queue message carries of whatever sent it.
TRACEPARENT = "traceparent"
REQUEST_ID = "forgemind_request_id"

JOBS = "forgemind.jobs"
JOB_DURATION = "forgemind.job.duration"
JOB_OUTCOME = "forgemind.job.outcome"
# On a request's span, the id its log lines and its response carry.
REQUEST_ID_ATTRIBUTE = "forgemind.request_id"

# The longest one export may take. Telemetry is never worth more of a job's
# time, or a request's, than this.
EXPORT_SECONDS = 5

_PROPAGATOR = TraceContextTextMapPropagator()


def carried() -> dict[str, str]:
    """What a message takes with it from whatever is sending it: the trace it
    is part of, and the id of the request where there is one."""
    carrier: dict[str, str] = {}
    _PROPAGATOR.inject(carrier)
    request_id = request_id_var.get()
    if request_id:
        carrier[REQUEST_ID] = request_id
    return carrier


@dataclass
class Job:
    """One piece of background work, while it is being done."""

    name: str
    span: Span
    # What it came to. Whoever does the work says; "error" if it raised.
    outcome: str = "ok"
    started: float = field(default_factory=time.monotonic)

    def seconds(self) -> float:
        return time.monotonic() - self.started

    def elapsed_ms(self) -> int:
        return round(self.seconds() * 1000)


class Telemetry:
    """One process's tracer and meter. `span_processors` and `metric_readers`
    are added to the ones the settings ask for; tests read through them."""

    def __init__(
        self,
        settings: Settings,
        service: Service,
        span_processors: Sequence[SpanProcessor] = (),
        metric_readers: Sequence[MetricReader] = (),
    ) -> None:
        resource = Resource.create(
            {
                "service.name": service,
                "service.version": settings.version,
                # Several workers are one service; their counters are not one.
                "service.instance.id": uuid.uuid4().hex,
                "deployment.environment": settings.environment,
            }
        )
        self.service: Service = service
        self.tracer_provider = TracerProvider(resource=resource)
        for processor in span_processors:
            self.tracer_provider.add_span_processor(processor)
        readers = list(metric_readers)
        if settings.otel_endpoint:
            from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
                OTLPMetricExporter,
            )
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            self.tracer_provider.add_span_processor(
                BatchSpanProcessor(
                    OTLPSpanExporter(
                        endpoint=f"{settings.otel_endpoint}/v1/traces",
                        timeout=EXPORT_SECONDS,
                    )
                )
            )
            readers.append(
                PeriodicExportingMetricReader(
                    OTLPMetricExporter(
                        endpoint=f"{settings.otel_endpoint}/v1/metrics",
                        timeout=EXPORT_SECONDS,
                    )
                )
            )
        self.meter_provider = MeterProvider(metric_readers=readers, resource=resource)
        self._tracer = self.tracer_provider.get_tracer("forgemind_api")
        meter = self.meter_provider.get_meter("forgemind_api")
        self._jobs = meter.create_counter(
            JOBS,
            unit="{job}",
            description="Background jobs handled, by job and by what they came to.",
        )
        self._job_seconds = meter.create_histogram(
            JOB_DURATION,
            unit="s",
            description="How long a background job took.",
        )

    def instrument(self, app: FastAPI) -> None:
        """Traces and times every request `app` serves: one span each."""
        FastAPIInstrumentor.instrument_app(
            app,
            tracer_provider=self.tracer_provider,
            meter_provider=self.meter_provider,
            # Otherwise a span for every message of a response as well, and
            # an event stream is nothing but messages.
            exclude_spans=["receive", "send"],
        )

    @contextmanager
    def job(
        self,
        name: str,
        carrier: Mapping[str, str] | None = None,
        attributes: Mapping[str, str] | None = None,
    ) -> Generator[Job]:
        """A span around one job, and its count and its time once it ends,
        under what it came to. A job taken from the queue gives the `carrier`
        its message came with, and continues the trace the message was sent
        in; a job this process set itself gives none."""
        delivered = carrier is not None
        with self._tracer.start_as_current_span(
            name,
            context=_PROPAGATOR.extract(carrier) if delivered else None,
            kind=SpanKind.CONSUMER if delivered else SpanKind.INTERNAL,
            attributes=attributes,
        ) as span:
            job = Job(name, span)
            try:
                yield job
            except BaseException as fault:
                job.outcome = "error"
                # The span keeps the traceback; this line says where to look.
                log.error(
                    "job failed",
                    extra={
                        "job": name,
                        "error": type(fault).__name__,
                        "duration_ms": job.elapsed_ms(),
                    },
                )
                raise
            finally:
                span.set_attribute(JOB_OUTCOME, job.outcome)
                labels = {"job": name, "outcome": job.outcome}
                self._jobs.add(1, labels)
                self._job_seconds.record(job.seconds(), labels)

    def flush(self) -> None:
        """Sends what has been recorded and not yet sent, waiting no longer
        than one export may take for each of traces and metrics. A process
        that may be ended without warning calls this after each job."""
        try:
            self.tracer_provider.force_flush(EXPORT_SECONDS * 1000)
            self.meter_provider.force_flush(EXPORT_SECONDS * 1000)
        except Exception:
            # Work is never failed for the sake of its telemetry.
            log.warning("telemetry not sent", exc_info=True)

    def shutdown(self) -> None:
        """Sends what is left and stops. Once."""
        try:
            self.tracer_provider.shutdown()
            self.meter_provider.shutdown(EXPORT_SECONDS * 2000)
        except Exception:
            log.warning("telemetry not shut down cleanly", exc_info=True)
