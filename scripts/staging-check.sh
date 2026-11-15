#!/usr/bin/env bash
# Deploys this checkout the way staging is deployed (scripts/staging.sh, with
# a directory, a Compose project and ports of its own) behind a proxy that
# ends TLS, as the machine's own does for the real one. Then checks, from
# outside:
#
#   1. the deployment's directory is made closed to other users, and once;
#   2. a deployment builds the commit, brings an empty database to the schema
#      and answers over HTTPS as that commit, through one door;
#   3. a person signs in with GitHub, connects a repository and inspects it,
#      in a browser (apps/web/staging);
#   4. the session is kept from scripts and from plain HTTP, the session
#      development seeds opens nothing, and what signs a person in is not
#      written to a log;
#   5. a deployment takes a database that is behind forward and keeps what it
#      held;
#   6. a password can be asked of every visitor;
#   7. settings the deployment cannot use, and a migration that fails, end
#      it before it replaces anything;
#   8. with GitHub itself as the provider, each service is given the
#      credentials it uses and no other, and a webhook is held to its
#      signature and not to the visitors' password;
#   9. no secret is in a container's settings or in what the services logged.
#
#   scripts/staging-check.sh
#
# Uses ports 4295 and 4296, the Compose project forgemind-stagingcheck and a
# container named forgemind-stagingcheck-front, and removes what it made
# whether it passes or not. Needs the workspace installed (pnpm install),
# Chromium (pnpm --filter @forgemind/web exec playwright install chromium)
# and openssl.
set -euo pipefail

root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
staging=$root/scripts/staging.sh
project=forgemind-stagingcheck
front=$project-front
edge_port=4295
port=4296
site=https://localhost:$port
repository=staging-check/sample
services=(api worker sweeper migrate web edge postgres redis)

for busy in "$edge_port" "$port"; do
  if ss -ltn | grep -q ":$busy "; then
    echo "port $busy is busy; stop whatever listens there first" >&2
    exit 1
  fi
done
command -v openssl >/dev/null || {
  echo "openssl is needed, to make a key that stands for a GitHub App's" >&2
  exit 1
}

work=$(mktemp -d /tmp/forgemind-stagingcheck.XXXXXX)
dir=$work/deployment
jar=$work/jar
# Every value that must stay where it was put, one to a line.
private=$work/private
export FORGEMIND_STAGING_DIR=$dir FORGEMIND_STAGING_PROJECT=$project FORGEMIND_STAGING_ALLOW_DIRTY=1

# Only what carries this project's name or label is looked at.
remove_everything() {
  local label="label=com.docker.compose.project=$project"
  docker rm -f "$front" >/dev/null 2>&1 || true
  docker ps -aq --filter "$label" | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker volume ls -q --filter "$label" | xargs -r docker volume rm >/dev/null 2>&1 || true
  docker network ls -q --filter "$label" | xargs -r docker network rm >/dev/null 2>&1 || true
  docker image ls --format '{{.Repository}}:{{.Tag}}' |
    grep -E "^$project-(api|web|edge):" | xargs -r docker image rm >/dev/null 2>&1 || true
}

passed=0
cleanup() {
  local service
  if [[ $passed != 1 ]]; then
    for service in api worker sweeper web edge; do
      docker inspect "$project-$service-1" >/dev/null 2>&1 || continue
      echo "--- $service" >&2
      docker logs --tail 15 "$project-$service-1" 2>&1 | cut -c 1-400 >&2 || true
    done
  fi
  remove_everything
  rm -rf "$work"
}
trap cleanup EXIT
remove_everything

fail() {
  echo "staging check failed: $*" >&2
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

random() {
  head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Asks the site as a browser reaches it: over HTTPS, through the proxy.
ask() {
  curl -s --cacert "$work/front/root.crt" "$@"
}

status_of() {
  ask -o /dev/null -w '%{http_code}' "$@"
}

# The name and password a visitor gives, as curl reads them from `-K -`: an
# argument would show in the machine's process list.
visitor() {
  printf 'user = "%s:%s"\n' "$(<"$dir/secrets/gate_user")" "$(<"$dir/secrets/gate_password")"
}

deploy() {
  if ! "$staging" deploy >"$work/deploy.log" 2>&1; then
    cat "$work/deploy.log" >&2
    fail "the deployment did not go through"
  fi
}

# A deployment that must be refused, and for the reason given.
refused() {
  local why=$1 saying=$2
  if "$staging" deploy >"$work/deploy.log" 2>&1; then
    fail "a deployment went through $why"
  fi
  grep -qE -- "$saying" "$work/deploy.log" || {
    cat "$work/deploy.log" >&2
    fail "a deployment $why was refused without saying: $saying"
  }
}

running() {
  docker ps -q --no-trunc --filter "label=com.docker.compose.project=$project" | sort | tr '\n' ' '
}

provider() {
  ask -o /dev/null -D - "$site/api/health" | tr -d '\r' |
    awk 'tolower($1) == "x-forgemind-github:" { print $2 }'
}

networks_of() {
  docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$project-$1-1"
}

# The secrets a service's container was given, by name.
holds() {
  docker exec "$project-$1-1" sh -c 'ls /run/secrets 2>/dev/null | sort | tr "\n" " "'
}

revision() {
  "$staging" compose exec -T postgres psql -U forgemind -d forgemind -At \
    -c 'select version_num from alembic_version'
}

# The person's repositories as the API lists them for the session in the jar.
repositories() {
  ask -b "$jar" "$site/api/repositories" |
    json 'data.items.map((r) => [r.fullName, r.status, r.lastAnalyzedCommit].join(" ")).join(", ")'
}

browser() {
  (
    cd "$root"
    STAGING_URL=$site STAGING_OWN_CERTIFICATE=1 STAGING_REPOSITORY=$repository \
      STAGING_REPOSITORY_COMMIT=$commit STAGING_REPOSITORY_SHOWS=TypeScript,hono \
      pnpm --filter @forgemind/web exec playwright test -c playwright.staging.config.ts --reporter=line
  )
}

# Signs Sam Rivera in the way the pages do, with curl, so that the cookie
# and everything on the way to it can be looked at.
sign_in() {
  local start state back code session
  start=$(ask -H 'content-type: application/json' -d '{}' "$site/api/auth/github/start")
  state=$(json 'data.state' <<<"$start")
  [[ $(json 'data.url' <<<"$start") == "$site/api/auth/github/authorize?state=$state" ]] ||
    fail "signing in starts at: $(json 'data.url' <<<"$start")"
  back=$(ask -o /dev/null -w '%{redirect_url}' \
    "$site/api/auth/github/authorize/continue?state=$state&user=samrivera")
  [[ $back == "$site/auth/github/callback?code="*"&state=$state" ]] ||
    fail "GitHub sends the person back to: $back"
  code=${back#*code=}
  code=${code%%&*}
  printf '%s\n' "$state" "$code" >>"$private"
  # The page that takes the answer is the one that asks, so its address,
  # code and all, is what the browser names as the sender.
  ask -c "$jar" -D "$work/signed-in" -o /dev/null -H 'content-type: application/json' \
    -H "referer: $back" -d "{\"code\": \"$code\", \"state\": \"$state\"}" \
    "$site/api/auth/github/callback"
  session=$(awk '$6 == "fm_session" { print $7 }' "$jar")
  [[ -n $session ]] || fail "signing in set no session cookie"
  printf '%s\n' "$session" >>"$private"
}

has_logged() {
  local said
  said=$(docker logs "$project-$1-1" 2>&1)
  grep -qF -- "$2" <<<"$said"
}

# Fails if what a service logged, or the settings of its container, hold any
# of the values that must stay where they were put.
kept_private() {
  local service said
  [[ -s $private ]] && ! grep -q '^$' "$private" || fail "the list of private values is not usable"
  for service in "${services[@]}"; do
    said=$(docker logs "$project-$service-1" 2>&1)
    if grep -qF -f "$private" <<<"$said"; then
      fail "what $service logged holds a value that was to stay private"
    fi
    said=$(docker inspect "$project-$service-1")
    if grep -qF -f "$private" <<<"$said"; then
      fail "the settings of $service hold a value that was to stay private"
    fi
  done
}

release=$(git -C "$root" rev-parse HEAD)
if [[ -n $(git -C "$root" status --porcelain) ]]; then
  release+=-dirty
fi
# Said first: what Compose does with a deployment has differed between versions.
echo "with Docker $(docker version --format '{{.Server.Version}}') and Compose $(docker compose version --short)"

echo "## the deployment's directory is made closed to other users, and once"
"$staging" init "$site" "$edge_port" >/dev/null
[[ $(stat -c %a "$dir") == 700 && $(stat -c %a "$dir/secrets") == 700 ]] ||
  fail "the deployment's directory lets other users in"
[[ $(stat -c %a "$dir/staging.env") == 600 ]] || fail "staging.env can be read by other users"
password=$(<"$dir/secrets/postgres_password")
[[ ${#password} -ge 32 ]] || fail "the database's password is ${#password} characters long"
if "$staging" init "$site" "$edge_port" >/dev/null 2>&1; then
  fail "init made a deployment where there was one"
fi
[[ $(<"$dir/secrets/postgres_password") == "$password" ]] ||
  fail "the second init changed the database's password"
if "$staging" compose ps >/dev/null 2>&1; then
  fail "there is something to ask Compose about before anything is deployed"
fi
cat "$dir/secrets/postgres_password" >>"$private"
echo "$dir: closed, with a password of ${#password} characters for the database"

# A repository of this machine's for the person to connect: the simulated
# provider lists what the deployment's `repositories` directory holds.
(
  umask 022
  mkdir -p "$work/source/src" "$work/source/tests" "$dir/repositories/${repository%/*}"
  cd "$work/source"
  cat >package.json <<'EOF'
{
  "name": "sample",
  "version": "1.0.0",
  "scripts": { "test": "node --test" },
  "dependencies": { "hono": "^4.0.0" }
}
EOF
  printf '# sample\n\nA small service that the staging check connects and inspects.\n' >README.md
  printf 'export function add(a: number, b: number) {\n  return a + b;\n}\n' >src/index.ts
  printf "import { add } from '../src/index';\n\nconsole.assert(add(1, 2) === 3);\n" >tests/index.test.ts
  git init -q -b main
  git add .
  git -c user.name='Staging check' -c user.email=staging-check@example.com -c commit.gpgsign=false \
    commit -q -m 'A service to inspect'
  git clone -q --bare "$work/source" "$dir/repositories/$repository.git"
)
commit=$(git -C "$work/source" rev-parse HEAD)

echo "## a deployment builds the commit, migrates an empty database and serves it"
deploy
grep -qF "anyone who reaches $site can sign in" "$work/deploy.log" ||
  fail "nothing was said about a simulated GitHub that asks no password"
mkdir "$work/front"
cat >"$work/front/Caddyfile" <<EOF
{
	admin off
	auto_https disable_redirects
}

$site {
	tls internal
	reverse_proxy edge:8080
}
EOF
caddy=$(awk '$1 == "FROM" { print $2; exit }' "$root/deploy/staging/edge.Dockerfile")
docker run -d --name "$front" --network "${project}_default" -p "127.0.0.1:$port:$port" \
  -v "$work/front/Caddyfile:/etc/caddy/Caddyfile:ro" "$caddy" >/dev/null
wait_until "the proxy's certificate" 30 \
  docker cp "$front:/data/caddy/pki/authorities/local/root.crt" "$work/front/root.crt"
wait_until "the deployment over HTTPS" 30 ask -f "$site/api/health"
health=$(ask "$site/api/health")
[[ $(json '[data.status, data.environment, data.commit, data.checks.database, data.checks.queue].join(" ")' <<<"$health") == "ok staging $release ok ok" ]] ||
  fail "the deployment reports: $health"
headers=$(ask -o /dev/null -D - "$site/api/health" | tr -d '\r')
for header in 'x-forgemind-data: live' 'x-forgemind-github: simulated' 'x-content-type-options: nosniff'; do
  grep -qix -- "$header" <<<"$headers" || fail "the API answers without $header"
done
[[ $(ask "$site/api/openapi.json" | json 'data.servers.map((server) => server.url).join(" ")') == /api ]] ||
  fail "the API does not describe itself as served under /api"
# What the API writes of itself is the public address, scheme and all.
[[ $(ask -o /dev/null -w '%{redirect_url}' "$site/api/health/") == "$site/api/health" ]] ||
  fail "the API sends a browser to: $(ask -o /dev/null -w '%{redirect_url}' "$site/api/health/")"
[[ $(status_of "$site/sign-in") == 200 ]] || fail "the interface answered $(status_of "$site/sign-in")"
[[ $(revision) =~ ^[0-9a-f]+$ ]] || fail "the database is at no revision"
published=$(docker ps --filter "label=com.docker.compose.project=$project" --format '{{.Ports}}' |
  tr ',' '\n' | grep -- '->' | tr -d ' ' | sort -u | tr '\n' ' ')
[[ $published == "127.0.0.1:$edge_port->8080/tcp " ]] || fail "the deployment listens at: $published"
[[ $(docker network inspect -f '{{.Internal}}' "${project}_data") == true ]] ||
  fail "the network of the database and the queue reaches outside"
for service in postgres redis; do
  [[ $(networks_of "$service") == "${project}_data " ]] || fail "$service is on: $(networks_of "$service")"
done
for service in web edge; do
  [[ $(networks_of "$service") == "${project}_default " ]] || fail "$service is on: $(networks_of "$service")"
done
# Small and closed: a limit on the memory and the logs of every service, and
# no root, no capability and no way to one for what this repository's code runs in.
for service in api worker sweeper web edge postgres redis; do
  [[ $(docker inspect -f '{{.HostConfig.Memory}}' "$project-$service-1") -gt 0 ]] ||
    fail "$service may take all the memory there is"
  [[ $(docker inspect -f '{{index .HostConfig.LogConfig.Config "max-size"}}' "$project-$service-1") == 10m ]] ||
    fail "the log of $service may grow without end"
done
for service in api worker sweeper web; do
  user=$(docker exec "$project-$service-1" id -u) || fail "$service is not running"
  [[ $user != 0 ]] || fail "$service runs as root"
  [[ $(docker inspect -f '{{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}}' "$project-$service-1") == "[ALL] [no-new-privileges:true]" ]] ||
    fail "$service keeps capabilities, or may gain them"
done
echo "$release: at $site, on 127.0.0.1:$edge_port alone, the database at revision $(revision)"

echo "## a person signs in with GitHub, connects a repository and inspects it"
browser

echo "## the session is kept from scripts and from plain HTTP"
sign_in
cookie=$(tr -d '\r' <"$work/signed-in" | grep -i '^set-cookie: fm_session=') ||
  fail "signing in set no session cookie"
for flag in HttpOnly Secure SameSite=lax Path=/; do
  grep -qi -- "; $flag\(;\|\$\)" <<<"$cookie" || fail "the session cookie is not $flag"
done
[[ $(ask -b "$jar" "$site/api/auth/session" | json 'data.user.name') == "Sam Rivera" ]] ||
  fail "the session cookie does not open the session"
[[ $(status_of -b fm_session=dev-owner "$site/api/auth/session") == 401 ]] ||
  fail "the session development seeds is taken here"
[[ $(repositories) == "$repository connected $commit" ]] ||
  fail "the person's repositories are: $(repositories)"
# The requests that carried the code are in both logs, and the code in neither.
for path in /api/auth/github/authorize/continue /api/auth/github/callback; do
  wait_until "the edge's line for $path, without a query" 10 has_logged edge "\"uri\":\"$path\""
  wait_until "the API's line for $path" 10 has_logged api "\"path\": \"$path\""
done
if has_logged api '"logger": "uvicorn.access"'; then
  fail "the server writes a line of its own for each request, query and all"
fi
kept_private
echo "the cookie: HttpOnly, Secure, SameSite=lax; the code and the session: in no log"

echo "## a deployment takes a database that is behind forward, and keeps what it held"
newest=$(revision)
"$staging" compose run --rm --no-deps -T migrate python -c '
from forgemind_api.db import downgrade
from forgemind_api.settings import load_settings

url = load_settings(process="other").database_url
assert url is not None
downgrade(url, "-1")
' >/dev/null 2>&1 || fail "the database could not be taken a revision back"
behind=$(revision)
[[ -n $behind && $behind != "$newest" ]] || fail "the database stayed at $newest"
deploy
[[ $(revision) == "$newest" ]] || fail "the deployment left the database at $(revision), not $newest"
[[ $(repositories) == "$repository connected $commit" ]] ||
  fail "after the second deployment the person's repositories are: $(repositories)"
echo "revision $behind taken to $newest; the session and the repository kept"

echo "## a password can be asked of every visitor"
if ! "$staging" gate visitor >"$work/gate.log" 2>&1; then
  cat "$work/gate.log" >&2
  fail "the password could not be turned on"
fi
cat "$dir/secrets/gate_password" >>"$private"
if grep -qF -f "$private" "$work/gate.log"; then
  fail "the password was said where a terminal keeps it"
fi
[[ $(stat -c %a "$dir/secrets/gate_password") == 644 && $(stat -c %a "$dir/secrets") == 700 ]] ||
  fail "the password's file is not as the other secrets are"
challenge=$(ask -o /dev/null -D - "$site/sign-in" | tr -d '\r')
grep -q '^HTTP/[0-9.]* 401' <<<"$challenge" && grep -qi '^www-authenticate: Basic ' <<<"$challenge" ||
  fail "a visitor without the password was answered: $(head -n 1 <<<"$challenge")"
[[ $(status_of -b "$jar" "$site/api/repositories") == 401 ]] ||
  fail "the API is open to a person who is signed in and has not the password"
[[ $(printf 'user = "visitor:%s"\n' "$(random 12)" | status_of -K - "$site/sign-in") == 401 ]] ||
  fail "a wrong password was taken"
[[ $(visitor | status_of -K - "$site/sign-in") == 200 ]] || fail "the password was not taken"
[[ $(visitor | ask -K - -b "$jar" "$site/api/auth/session" | json 'data.user.name') == "Sam Rivera" ]] ||
  fail "behind the password, the session no longer opens"
[[ $(status_of "$site/api/health") == 200 ]] || fail "asking whether the deployment is up needs the password"
# The person comes back, through the password, to what they connected.
STAGING_VISITOR=$(<"$dir/secrets/gate_user"):$(<"$dir/secrets/gate_password") browser

echo "## settings the deployment cannot use, and a migration that fails, end it before it replaces anything"
before=$(running)
cat >>"$dir/staging.env" <<'EOF'
FORGEMIND_GITHUB_PROVIDER=github
FORGEMIND_GITHUB_APP_SLUG=forgemind-staging-check
FORGEMIND_GITHUB_APP_ID=424242
EOF
refused "with no secret of GitHub's" "the github provider needs $dir/secrets/github_client_secret"
(
  umask 022
  random 20 >"$dir/secrets/github_client_secret"
  random 20 >"$dir/secrets/github_webhook_secret"
  # A key of the kind a GitHub App signs with. It signs nothing here.
  openssl genrsa 2048 >"$dir/secrets/github_app_private_key" 2>/dev/null
)
grep -q 'PRIVATE KEY' "$dir/secrets/github_app_private_key" || fail "openssl made no key"
grep -hv -e '^$' -e '^-----' "$dir/secrets/github_client_secret" "$dir/secrets/github_webhook_secret" \
  "$dir/secrets/github_app_private_key" >>"$private"
chmod 600 "$dir/secrets/github_app_private_key"
refused "with a key no container could read" "github_app_private_key cannot be read by the user a container runs as"
chmod 644 "$dir/secrets/github_app_private_key"
# Read by the image that would run: the API is asked, and says what it lacks.
refused "with no client id for GitHub" '^invalid configuration: .*the github provider needs FORGEMIND_GITHUB_CLIENT_ID$'
# Settings the API takes, now, and a database at a revision this commit does
# not know: the migration fails, and it is run before anything is replaced.
echo 'FORGEMIND_GITHUB_CLIENT_ID=Iv1.stagingcheck' >>"$dir/staging.env"
at_revision() {
  "$staging" compose exec -T postgres psql -U forgemind -d forgemind -q \
    -c "update alembic_version set version_num = '$1'" >/dev/null
}
at_revision unknown
refused "onto a database it cannot migrate" 'the migration failed'
at_revision "$newest"
[[ $(running) == "$before" ]] || fail "a deployment that was refused replaced what was running"
[[ $(provider) == simulated ]] || fail "a deployment that was refused changed the provider to $(provider)"
[[ $(<"$dir/release") == "$release" ]] || fail "a deployment that was refused is recorded as $(<"$dir/release")"
echo "refused four times, and what was running left as it was"

echo "## with GitHub itself, each service is given the credentials it uses and no other"
deploy
[[ $(provider) == github ]] || fail "the API speaks to: $(provider)"
start=$(visitor | ask -K - -H 'content-type: application/json' -d '{}' "$site/api/auth/github/start")
[[ $(json '((url) => [url.origin + url.pathname, url.searchParams.get("client_id"), url.searchParams.get("redirect_uri")].join(" "))(new URL(data.url))' <<<"$start") == "https://github.com/login/oauth/authorize Iv1.stagingcheck $site/auth/github/callback" ]] ||
  fail "signing in starts at: $(json 'data.url' <<<"$start")"
[[ $(holds api) == "github_app_private_key github_client_secret github_webhook_secret postgres_password " ]] ||
  fail "the API holds: $(holds api)"
[[ $(holds worker) == "github_app_private_key postgres_password " ]] || fail "the worker holds: $(holds worker)"
for service in sweeper postgres; do
  [[ $(holds "$service") == "postgres_password " ]] || fail "$service holds: $(holds "$service")"
done
for service in web edge redis; do
  [[ -z $(holds "$service") ]] || fail "$service holds: $(holds "$service")"
done
# GitHub has no password to give, and is held to its signature instead.
delivery='{"zen": "Keep it logically awesome.", "hook_id": 1}'
unsigned=$(ask -D - -H 'content-type: application/json' -H 'x-github-event: ping' \
  -H 'x-hub-signature-256: sha256=00' -d "$delivery" "$site/api/github/webhooks" | tr -d '\r')
grep -q '^HTTP/[0-9.]* 401' <<<"$unsigned" && grep -qF '"code":"unauthorized"' <<<"$unsigned" ||
  fail "a webhook with a wrong signature was answered: $(head -n 1 <<<"$unsigned")"
if grep -qi '^www-authenticate:' <<<"$unsigned"; then
  fail "a webhook is asked for the visitors' password"
fi
signature=$(printf '%s' "$delivery" | node -e '
  const { createHmac } = require("crypto");
  const { readFileSync } = require("fs");
  const secret = readFileSync(process.argv[1], "utf8").trimEnd();
  console.log("sha256=" + createHmac("sha256", secret).update(readFileSync(0)).digest("hex"));
' "$dir/secrets/github_webhook_secret")
[[ $(status_of -H 'content-type: application/json' -H 'x-github-event: ping' \
  -H "x-hub-signature-256: $signature" -d "$delivery" "$site/api/github/webhooks") == 202 ]] ||
  fail "a webhook with the right signature was not taken"
[[ $(status_of "$site/sign-in") == 401 ]] || fail "the second deployment stopped asking for the password"
echo "the API holds three of GitHub's secrets, the worker one, nothing else any"

echo "## no secret is in a container's settings or in what the services logged"
kept_private
said=$("$staging" compose config)
if grep -qF -f "$private" <<<"$said"; then
  fail "what Compose is given holds a value that was to stay private"
fi
echo "$(wc -l <"$private") private lines looked for in ${#services[@]} containers: none found"

echo "## the password stops being asked"
"$staging" gate off >/dev/null 2>&1
[[ $(status_of "$site/sign-in") == 200 ]] || fail "a visitor is still asked for a password"
[[ ! -e $dir/secrets/gate_password && ! -e $dir/gate.caddy ]] || fail "the password was kept"

passed=1
echo
echo "staging check passed: $release"
