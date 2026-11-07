"""OpenTelemetry wiring. Traces are recorded always and exported only when an
OTLP endpoint is configured, so turning observability on is configuration."""

from __future__ import annotations

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from forgemind_api.settings import Settings


def configure_telemetry(app: FastAPI, settings: Settings) -> TracerProvider:
    """Attach a tracer provider for this service to the app."""
    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": "forgemind-api",
                "service.version": settings.version,
                "deployment.environment": settings.environment,
            }
        )
    )
    if settings.otel_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=f"{settings.otel_endpoint}/v1/traces")
            )
        )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    return provider
