# Caddy with the deployment's routing in it, so that a deployment runs the
# routing of the commit it was built from.
#   docker build -f deploy/staging/edge.Dockerfile deploy/staging
FROM caddy:2.10-alpine
COPY Caddyfile gate.caddy /etc/caddy/
ARG COMMIT=unknown
LABEL org.opencontainers.image.revision=$COMMIT
