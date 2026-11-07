#!/usr/bin/env bash
# Checks a running service against the contract, twice: the dev API, which
# implements everything, proves the harness; the real API image proves what
# it has implemented so far and lists the rest.
#
#   scripts/conformance.sh            both
#   scripts/conformance.sh dev-api    only the dev API
#   scripts/conformance.sh image TAG  only the API image TAG (default forgemind-api:gate)
set -euo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
cd "$root"
harness=(packages/conformance/node_modules/.bin/tsx packages/conformance/src/cli.ts)

dev_api() {
  local port=4120
  if ss -ltn | grep -q ":$port "; then
    echo "port $port is busy; stop whatever listens there first" >&2
    return 1
  fi
  (cd apps/dev-api && PORT=$port DEV_API_SPEED=Infinity WEB_ORIGIN=http://localhost:3120 DEV_API_ORIGIN=http://localhost:$port exec node_modules/.bin/tsx src/index.ts > /tmp/conformance-dev-api.log 2>&1) &
  local pid=$!
  for _ in $(seq 1 60); do curl -sf "http://localhost:$port/health" >/dev/null && break; sleep 0.5; done
  echo "## dev API"
  local status=0
  "${harness[@]}" --base-url "http://localhost:$port" --cookie fm_session=dev-owner --data-source demo --all-implemented || status=$?
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  return "$status"
}

image() {
  local tag=${1:-forgemind-api:gate} port=4298
  if ss -ltn | grep -q ":$port "; then
    echo "port $port is busy; stop whatever listens there first" >&2
    return 1
  fi
  local id
  id=$(docker run -d --rm -p "127.0.0.1:$port:4200" "$tag")
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/health" >/dev/null && break; sleep 1; done
  echo "## API image $tag"
  local status=0
  "${harness[@]}" --base-url "http://127.0.0.1:$port" --data-source live || status=$?
  docker stop "$id" >/dev/null 2>&1 || true
  return "$status"
}

case "${1:-both}" in
  dev-api) dev_api ;;
  image) image "${2:-}" ;;
  both) dev_api; image ;;
  *) echo "usage: $0 [dev-api|image TAG|both]" >&2; exit 2 ;;
esac
