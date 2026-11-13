# Build the environment with uv, then run it on a slim image as a non-root user.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim AS build
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev

FROM python:3.13-slim-bookworm
ARG COMMIT=unknown
# git clones the repositories a worker indexes. Nothing in them is run.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 forgemind
WORKDIR /app
COPY --from=build --chown=forgemind:forgemind /app /app
USER forgemind
ENV PATH="/app/.venv/bin:$PATH" FORGEMIND_COMMIT=$COMMIT FORGEMIND_PORT=4200
EXPOSE 4200
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:4200/health', timeout=2).status == 200 else 1)"
CMD ["python", "-m", "forgemind_api"]
