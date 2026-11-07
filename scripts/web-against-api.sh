#!/usr/bin/env bash
# Runs the interface's browser tests against the real API instead of the dev
# API: a throwaway PostgreSQL, the API image migrated and seeded, on the port
# the browser tests expect. Any Playwright arguments pass through.
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
if ss -ltn | grep -qE ':(3110|4110) '; then
  echo "ports 3110 or 4110 are busy; stop whatever listens there first" >&2
  exit 1
fi
db='postgresql+psycopg://fm:fm@webcheck-db:5432/fm'
docker network create "$net" >/dev/null 2>&1 || true
db_id=$(docker run -d --rm --network "$net" --name webcheck-db -e POSTGRES_USER=fm -e POSTGRES_PASSWORD=fm -e POSTGRES_DB=fm postgres:17-alpine)
api_id=""
cleanup() {
  docker stop "$api_id" "$db_id" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
for _ in $(seq 1 30); do docker exec "$db_id" pg_isready -U fm -d fm >/dev/null 2>&1 && break; sleep 1; done
docker run --rm --network "$net" -e FORGEMIND_ENVIRONMENT=test -e "FORGEMIND_DATABASE_URL=$db" "$tag" python -m forgemind_api migrate >/dev/null
docker run --rm --network "$net" -e FORGEMIND_ENVIRONMENT=test -e "FORGEMIND_DATABASE_URL=$db" "$tag" python -m forgemind_api seed >/dev/null
api_id=$(docker run -d --rm --network "$net" -p 127.0.0.1:4110:4200 \
  -e FORGEMIND_ENVIRONMENT=test -e "FORGEMIND_DATABASE_URL=$db" \
  -e FORGEMIND_API_ORIGIN=http://localhost:4110 -e FORGEMIND_WEB_ORIGIN=http://localhost:3110 "$tag")
for _ in $(seq 1 30); do curl -sf http://localhost:4110/health >/dev/null && break; sleep 1; done
echo "## interface against $tag"
cd apps/web
pnpm exec playwright test --project=chromium --workers 2 --reporter=line "$@"
