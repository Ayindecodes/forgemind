#!/usr/bin/env bash
# The gate: every check the repository must pass, in order, stopping at the
# first failure. Run it before calling any change done.
#
#   scripts/gate.sh          checks the current checkout (what CI does)
#   scripts/gate.sh --fresh  clones HEAD into a temporary directory first, so
#                            nothing uncommitted or stale can help it pass
#
# The browser steps start their own servers on ports 3110 and 4110 and need
# Chromium: pnpm --filter @forgemind/web exec playwright install chromium
set -euo pipefail

export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0

root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
if [[ "${1:-}" == "--fresh" ]]; then
  fresh=$(mktemp -d /tmp/forgemind-gate.XXXXXX)
  trap 'rm -rf "$fresh"' EXIT
  git clone -q "$root" "$fresh"
  root=$fresh
fi
cd "$root"
echo "gate: $(git rev-parse --short HEAD) in $root"

step() {
  local name=$1; shift
  echo
  echo "### $name"
  local started=$SECONDS
  "$@"
  echo "### $name passed in $((SECONDS - started))s"
}

step install   pnpm install --frozen-lockfile
step format    pnpm format:check
step typecheck pnpm typecheck
step lint      pnpm lint
step unit      pnpm test
step build     pnpm build
step visual    pnpm --filter @forgemind/web exec playwright test -c playwright.visual.config.ts --workers 2 --reporter=line
step e2e       pnpm --filter @forgemind/web exec playwright test --workers 2 --reporter=line

echo
echo "gate passed: $(git rev-parse --short HEAD)"
