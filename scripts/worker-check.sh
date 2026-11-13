#!/usr/bin/env bash
# Runs the API image the way it is deployed: the API, a worker and the sweeper
# as separate containers on PostgreSQL and Redis. Then checks, from outside:
#
#   1. a task created through the API is executed by the worker;
#   2. a repository connected through the API is cloned and indexed by the
#      worker, which keeps nothing of the checkout;
#   3. a run and an indexing whose messages the queue lost are put back by the
#      sweeper and done once;
#   4. the worker and the sweeper stop cleanly when asked to.
#
#   scripts/worker-check.sh [TAG]    TAG defaults to forgemind-api:gate
#
# Uses port 4297 and containers named workercheck-*, and removes what it
# started whether it passes or not.
set -euo pipefail

tag=${1:-forgemind-api:gate}
port=4297
net=forgemind-workercheck
base="http://127.0.0.1:$port"
names=(workercheck-db workercheck-redis workercheck-api workercheck-sweeper workercheck-worker-1 workercheck-worker-2)

if ss -ltn | grep -q ":$port "; then
  echo "port $port is busy; stop whatever listens there first" >&2
  exit 1
fi

passed=0
cleanup() {
  if [[ $passed != 1 ]]; then
    for name in workercheck-api workercheck-sweeper workercheck-worker-1 workercheck-worker-2; do
      docker inspect "$name" >/dev/null 2>&1 || continue
      echo "--- $name" >&2
      docker logs --tail 40 "$name" >&2 2>&1 || true
    done
  fi
  docker rm -f "${names[@]}" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker rm -f "${names[@]}" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null

# Quick enough to watch: a run waits eight seconds on the queue before the
# sweeper, looking every second, puts it there again.
settings=(
  -e FORGEMIND_ENVIRONMENT=test
  -e FORGEMIND_DATABASE_URL=postgresql+psycopg://fm:fm@workercheck-db:5432/fm
  -e FORGEMIND_REDIS_URL=redis://workercheck-redis:6379/0
  -e FORGEMIND_WORKER_HEARTBEAT_SECONDS=1
  -e FORGEMIND_WORKER_STALE_SECONDS=5
  -e FORGEMIND_WORKER_SWEEP_SECONDS=1
  -e FORGEMIND_WORKER_REDISPATCH_SECONDS=8
)

fail() {
  echo "worker check failed: $*" >&2
  exit 1
}

wait_until() {
  local what=$1 seconds=$2
  shift 2
  for _ in $(seq 1 $((seconds * 2))); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  fail "timed out after ${seconds}s waiting for $what"
}

# Reads JSON on stdin and prints the value of a JavaScript expression on it.
json() {
  node -e '
    const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const value = new Function("data", `return (${process.argv[1]})`)(data);
    console.log(typeof value === "string" ? value : JSON.stringify(value));
  ' "$1"
}

api() {
  curl -sf -H 'cookie: fm_session=dev-owner' "$@"
}

background() {
  local name=$1
  shift
  docker run -d --network "$net" --name "$name" --no-healthcheck "${settings[@]}" "$tag" "$@" >/dev/null
}

# Asks the container to stop the way a deploy does, and expects it to have
# finished by itself rather than been killed at the end of the grace period.
stops_cleanly() {
  local name=$1 code
  docker stop -t 30 "$name" >/dev/null
  code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
  [[ $code == 0 ]] || fail "$name exited with $code when asked to stop"
  docker rm "$name" >/dev/null
}

create_task() {
  api -H 'content-type: application/json' "$base/tasks" -d "{
    \"repositoryId\": \"$repository\",
    \"title\": \"Fix retry budget overflow\",
    \"request\": \"Stop retrying past the budget the task allows.\",
    \"category\": \"fix_bug\"
  }" | json 'data.runId'
}

run_status() {
  api "$base/runs/$1" | json 'data.status'
}

run_finished() {
  [[ $(run_status "$1") == completed ]]
}

# The whole record of a run this server cannot take past its first stage:
# started once, ended once, saying where it stopped and why.
expect_record() {
  local run_id=$1 events types error
  events=$(api "$base/runs/$run_id/events")
  types=$(json 'data.map((event) => `${event.seq}:${event.type}`).join(" ")' <<<"$events")
  [[ $types == "1:run.started 2:run.finished" ]] || fail "run $run_id recorded: $types"
  error=$(json 'data[1].error' <<<"$events")
  [[ $error == "The inspection stage is not available on this server yet, so the run stopped there." ]] ||
    fail "run $run_id ended with: $error"
}

connect() {
  api -H 'content-type: application/json' "$base/repositories" \
    -d "{\"githubId\": $1, \"fullName\": \"$2\"}" | json 'data.id'
}

repository_status() {
  api "$base/repositories/$1" | json 'data.status'
}

repository_indexed() {
  [[ $(repository_status "$1") == connected ]]
}

# What indexing leaves behind: the commit that was read, what was found in it,
# and nothing of the checkout on the worker that made it.
expect_analysis() {
  local id=$1 worker=$2 repository commit analysed languages left
  repository=$(api "$base/repositories/$id")
  commit=$(json 'data.lastAnalyzedCommit' <<<"$repository")
  [[ $commit =~ ^[0-9a-f]{40}$ ]] || fail "repository $id was indexed at: $commit"
  languages=$(json 'data.languages.length' <<<"$repository")
  [[ $languages -gt 0 ]] || fail "repository $id was indexed with no language found"
  analysed=$(api "$base/repositories/$id/analysis" | json 'data.commit')
  [[ $analysed == "$commit" ]] || fail "repository $id is at $commit, its analysis at $analysed"
  left=$(docker exec "$worker" sh -c 'ls -d /tmp/forgemind-workspace-* 2>/dev/null | wc -l')
  [[ $left == 0 ]] || fail "$worker kept $left checkouts"
}

docker run -d --rm --network "$net" --name workercheck-db \
  -e POSTGRES_USER=fm -e POSTGRES_PASSWORD=fm -e POSTGRES_DB=fm postgres:17-alpine >/dev/null
docker run -d --rm --network "$net" --name workercheck-redis \
  redis:7-alpine redis-server --save '' --appendonly no >/dev/null
# Over TCP: the socket answers while the database is still being set up.
wait_until "PostgreSQL" 60 docker exec workercheck-db pg_isready -h 127.0.0.1 -U fm -d fm
wait_until "Redis" 30 docker exec workercheck-redis redis-cli ping
docker run --rm --network "$net" "${settings[@]}" "$tag" python -m forgemind_api migrate >/dev/null
docker run --rm --network "$net" "${settings[@]}" "$tag" python -m forgemind_api seed >/dev/null
docker run -d --rm --network "$net" --name workercheck-api -p "127.0.0.1:$port:4200" \
  "${settings[@]}" -e "FORGEMIND_API_ORIGIN=$base" -e FORGEMIND_WEB_ORIGIN=http://localhost:3120 "$tag" >/dev/null
wait_until "the API" 30 curl -sf "$base/health"
queue=$(curl -sf "$base/health" | json 'data.checks.queue')
[[ $queue == ok ]] || fail "the API reports its queue as: $queue"
repository=$(api "$base/repositories" | json 'data.items.find((r) => r.status === "connected" && r.lastAnalyzedCommit).id')

echo "## a task is executed by the worker"
background workercheck-sweeper python -m forgemind_api sweeper
background workercheck-worker-1 python -m forgemind_api worker
first=$(create_task)
wait_until "the worker to finish run $first" 60 run_finished "$first"
expect_record "$first"
echo "run $first: started and ended by the worker"

echo "## a repository is cloned and indexed by the worker"
docs=$(connect 811006 forgemind/docs)
wait_until "the worker to index repository $docs" 60 repository_indexed "$docs"
expect_analysis "$docs" workercheck-worker-1
echo "repository $docs: indexed at $(api "$base/repositories/$docs" | json 'data.lastAnalyzedCommit')"

echo "## the worker stops when asked to"
stops_cleanly workercheck-worker-1
echo "exit 0"

echo "## what the queue lost is queued again by the sweeper"
second=$(create_task)
infra=$(connect 811007 forgemind/infra)
waiting=$(docker exec workercheck-redis redis-cli llen forgemind)
[[ $waiting == 2 ]] || fail "expected two messages waiting for a worker, found $waiting"
docker exec workercheck-redis redis-cli del forgemind >/dev/null
[[ $(run_status "$second") == queued ]] || fail "run $second started with no worker to start it"
[[ $(repository_status "$infra") == analyzing ]] ||
  fail "repository $infra was indexed with no worker to index it"
background workercheck-worker-2 python -m forgemind_api worker
wait_until "the sweeper to queue run $second again and the worker to finish it" 60 run_finished "$second"
expect_record "$second"
docker logs workercheck-sweeper 2>&1 | grep -q '"message": "swept".*"queued": 1' ||
  fail "the sweeper did not report queueing a run"
echo "run $second: queued again, started and ended once"
wait_until "the sweeper to queue repository $infra again and the worker to index it" 60 repository_indexed "$infra"
expect_analysis "$infra" workercheck-worker-2
docker logs workercheck-sweeper 2>&1 | grep -q '"message": "swept indexing".*"queued": 1' ||
  fail "the sweeper did not report queueing an indexing"
echo "repository $infra: queued again and indexed"

echo "## the sweeper stops when asked to"
stops_cleanly workercheck-sweeper
stops_cleanly workercheck-worker-2
echo "exit 0"

passed=1
echo
echo "worker check passed: $tag"
