#!/usr/bin/env bash
# Runs the interface's browser tests against the real API instead of the dev
# API: a throwaway PostgreSQL and Redis, the API image migrated and seeded on
# the port the browser tests expect, and a worker and the sweeper beside it so
# that what the interface connects is indexed. Any Playwright arguments pass
# through.
#
#   scripts/web-against-api.sh e2e/auth.spec.ts --grep "signing in"
#
# Needs the image: docker build -t forgemind-api:gate apps/api
set -euo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
cd "$root"
tag=${FORGEMIND_API_IMAGE:-forgemind-api:gate}
net=forgemind-webcheck
names=(webcheck-db webcheck-redis webcheck-api webcheck-worker webcheck-sweeper)
if ss -ltn | grep -qE ':(3110|4110) '; then
  echo "ports 3110 or 4110 are busy; stop whatever listens there first" >&2
  exit 1
fi
settings=(
  -e FORGEMIND_ENVIRONMENT=test
  -e FORGEMIND_DATABASE_URL=postgresql+psycopg://fm:fm@webcheck-db:5432/fm
  -e FORGEMIND_REDIS_URL=redis://webcheck-redis:6379/0
)
cleanup() {
  docker rm -f "${names[@]}" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm -f "${names[@]}" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null 2>&1 || true
docker run -d --network "$net" --name webcheck-db \
  -e POSTGRES_USER=fm -e POSTGRES_PASSWORD=fm -e POSTGRES_DB=fm postgres:17-alpine >/dev/null
docker run -d --network "$net" --name webcheck-redis \
  redis:7-alpine redis-server --save '' --appendonly no >/dev/null
# Over TCP: the socket answers while the database is still being set up.
for _ in $(seq 1 60); do docker exec webcheck-db pg_isready -h 127.0.0.1 -U fm -d fm >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 30); do docker exec webcheck-redis redis-cli ping >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network "$net" "${settings[@]}" "$tag" python -m forgemind_api migrate >/dev/null
docker run --rm --network "$net" "${settings[@]}" "$tag" python -m forgemind_api seed >/dev/null
docker run -d --network "$net" --name webcheck-api -p 127.0.0.1:4110:4200 "${settings[@]}" \
  -e FORGEMIND_API_ORIGIN=http://localhost:4110 -e FORGEMIND_WEB_ORIGIN=http://localhost:3110 "$tag" >/dev/null
docker run -d --network "$net" --name webcheck-worker --no-healthcheck "${settings[@]}" \
  "$tag" python -m forgemind_api worker >/dev/null
docker run -d --network "$net" --name webcheck-sweeper --no-healthcheck "${settings[@]}" \
  "$tag" python -m forgemind_api sweeper >/dev/null
for _ in $(seq 1 30); do curl -sf http://localhost:4110/health >/dev/null && break; sleep 1; done
echo "## interface against $tag"
cd apps/web
pnpm exec playwright test --project=chromium --workers 2 --reporter=line "$@"
