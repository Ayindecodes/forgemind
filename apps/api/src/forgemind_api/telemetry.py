"""Traces and metrics, for the API, a worker and the sweeper alike. Each process
holds its own providers instead of the library's process-wide ones, so nothing
is set up by an import and a test can read what was recorded. Everything is
recorded always and sent only where an OTLP endpoint is configured, so turning
observability on is configuration.

A request is traced and timed by the FastAPI instrumentation."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
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

from forgemind_api.settings import Settings

log = logging.getLogger("forgemind_api.telemetry")

Service = Literal["forgemind-api", "forgemind-worker", "forgemind-sweeper"]

# The longest one export may take. Telemetry is never worth more of a job's
# time, or a request's, than this.
EXPORT_SECONDS = 5


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
