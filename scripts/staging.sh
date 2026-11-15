#!/usr/bin/env bash
# Runs the staging deployment (deploy/staging) on this machine: the interface,
# the API, a worker and the sweeper with their PostgreSQL and Redis, built
# from this checkout and reached through one port on the loopback address.
#
#   scripts/staging.sh init <public-url> [port]  make the deployment's directory
#   scripts/staging.sh deploy                    build this commit, migrate, run it
#   scripts/staging.sh status                    what runs, and from which commit
#   scripts/staging.sh logs [service...]         what the services have logged
#   scripts/staging.sh gate <user>               ask every visitor for a password
#   scripts/staging.sh gate off                  stop asking
#   scripts/staging.sh down                      stop it; the data is kept
#   scripts/staging.sh compose ...               docker compose, on the deployment
#
# The deployment's directory is ~/.config/forgemind/staging unless
# FORGEMIND_STAGING_DIR names another. It holds staging.env, the settings,
# and secrets/, one file to a secret; nothing in it belongs in a repository.
# FORGEMIND_STAGING_PROJECT names the Compose project and its images, for a
# second deployment beside the first. docs/staging.md explains the whole.
set -euo pipefail

root=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
files=$root/deploy/staging
dir=${FORGEMIND_STAGING_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/forgemind/staging}
project=${FORGEMIND_STAGING_PROJECT:-forgemind-staging}
env_file=$dir/staging.env
secrets=$dir/secrets
gate_file=$dir/gate.caddy
released=$dir/release
address='^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'

die() {
  echo "staging: $*" >&2
  exit 1
}

say() {
  echo "staging: $*"
}

# The value staging.env gives a name, or nothing. The file is read, never run.
setting() {
  local line
  line=$(grep -E "^$1=" "$env_file" | tail -n 1) || true
  line=${line#*=}
  if [[ $line =~ ^\"(.*)\"$ || $line =~ ^\'(.*)\'$ ]]; then
    line=${BASH_REMATCH[1]}
  fi
  printf '%s' "$line"
}

random() {
  head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# A secret is a file of its own. The container it is given to reads it as a
# user this machine does not know, so the file is readable by anyone who can
# reach it, and the directory it is in lets nobody in but its owner.
keep_secret() {
  (
    umask 022
    printf '%s\n' "$2" >"$secrets/$1"
  )
}

# A secret the deployment is about to be given: a file that holds something
# and that a container's user can read.
secret_file() {
  local file=$secrets/$1
  [[ -s $file ]] || die "${2:-the deployment} needs $file, and it is missing or empty"
  [[ $(stat -c %A "$file") == ???????r?? ]] ||
    die "$file cannot be read by the user a container runs as; its directory keeps everyone else out, so: chmod 644 $file"
}

# What the deployment's directory says: where it is reached, on which port,
# which GitHub it speaks to and what was last deployed.
load() {
  [[ -f $env_file ]] ||
    die "there is no deployment at $dir; make one with: scripts/staging.sh init <public-url>"
  public_url=$(setting FORGEMIND_PUBLIC_URL)
  [[ $public_url =~ $address ]] ||
    die "FORGEMIND_PUBLIC_URL in $env_file must be an address like https://staging.example.com, with no path and no closing slash"
  port=$(setting FORGEMIND_STAGING_PORT)
  port=${port:-4300}
  [[ $port =~ ^[0-9]+$ ]] || die "FORGEMIND_STAGING_PORT in $env_file must be a number"
  provider=$(setting FORGEMIND_GITHUB_PROVIDER)
  provider=${provider:-simulated}
  [[ $provider == simulated || $provider == github ]] ||
    die "FORGEMIND_GITHUB_PROVIDER in $env_file must be simulated or github"
  release=
  if [[ -f $released ]]; then
    release=$(<"$released")
  fi
}

# docker compose on the deployment, with the files its settings ask for.
compose() {
  [[ -n $release ]] || die "nothing has been deployed yet; scripts/staging.sh deploy does that"
  local overlays=(-f "$files/compose.yaml")
  if [[ $provider == github ]]; then
    overlays+=(-f "$files/compose.github.yaml")
  elif [[ -d $dir/repositories ]]; then
    overlays+=(-f "$files/compose.repositories.yaml")
  fi
  if [[ -f $gate_file ]]; then
    overlays+=(-f "$files/compose.gate.yaml")
  fi
  FORGEMIND_API_IMAGE=$project-api:$release \
    FORGEMIND_WEB_IMAGE=$project-web:$release \
    FORGEMIND_EDGE_IMAGE=$project-edge:$release \
    FORGEMIND_PUBLIC_URL=$public_url \
    FORGEMIND_STAGING_PORT=$port \
    FORGEMIND_STAGING_ENV=$env_file \
    FORGEMIND_STAGING_SECRETS=$secrets \
    FORGEMIND_STAGING_REPOSITORIES=$dir/repositories \
    FORGEMIND_STAGING_GATE=$gate_file \
    docker compose -p "$project" --project-directory "$files" "${overlays[@]}" "$@"
}

# Asks the deployment's own port for a path and prints the status of the
# answer. With `as-visitor`, gives the password a visitor would.
status_of() {
  local path=$1 who=${2:-}
  if [[ $who == as-visitor && -f $gate_file ]]; then
    # On standard input: an argument would show in the machine's process list.
    printf 'user = "%s:%s"\n' "$(<"$secrets/gate_user")" "$(<"$secrets/gate_password")" |
      curl -s -o /dev/null -w '%{http_code}' -K - "http://127.0.0.1:$port$path" || true
  else
    curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port$path" || true
  fi
}

init() {
  local url=${1:-} port=${2:-4300}
  [[ $url =~ $address ]] ||
    die "init needs the address people will reach the deployment at, like https://staging.example.com, with no path and no closing slash"
  [[ $port =~ ^[0-9]+$ ]] || die "the port must be a number"
  [[ ! -e $env_file ]] ||
    die "$env_file is there already; change it, or remove $dir to start again"
  mkdir -p "$dir" "$secrets"
  chmod 700 "$dir" "$secrets"
  (
    umask 077
    while IFS= read -r line; do
      case $line in
        FORGEMIND_PUBLIC_URL=*) echo "FORGEMIND_PUBLIC_URL=$url" ;;
        FORGEMIND_STAGING_PORT=*) echo "FORGEMIND_STAGING_PORT=$port" ;;
        *) printf '%s\n' "$line" ;;
      esac
    done <"$files/staging.env.example" >"$env_file"
  )
  [[ $(setting FORGEMIND_PUBLIC_URL) == "$url" && $(setting FORGEMIND_STAGING_PORT) == "$port" ]] ||
    die "$files/staging.env.example no longer sets the address and the port"
  # The database's password. It is fixed in the database the first time the
  # deployment starts; changing the file afterwards does not change it there.
  if [[ ! -e $secrets/postgres_password ]]; then
    keep_secret postgres_password "$(random 24)"
  fi
  say "made $dir"
  say "it will listen on 127.0.0.1:$port for $url; deploy with: scripts/staging.sh deploy"
}

# The images of one commit, each named for the deployment and the commit.
build() {
  local name
  previous=()
  for name in api web edge; do
    previous+=("$(docker image inspect -f '{{.Id}}' "$project-$name:$release" 2>/dev/null || true)")
  done
  say "building the API"
  docker build -q --build-arg "COMMIT=$release" -t "$project-api:$release" "$root/apps/api" >/dev/null
  say "building the interface"
  docker build -q --build-arg "COMMIT=$release" -t "$project-web:$release" \
    -f "$root/apps/web/Dockerfile" "$root" >/dev/null
  say "building the edge"
  docker build -q --build-arg "COMMIT=$release" -t "$project-edge:$release" \
    -f "$files/edge.Dockerfile" "$files" >/dev/null
}

# Removes the images of earlier deployments. Only images under this
# deployment's own names are looked at, and one still in use stays.
forget_earlier_images() {
  local name image id index=0
  for name in api web edge; do
    while IFS= read -r image; do
      if [[ $image != "$project-$name:$release" ]]; then
        docker image rm "$image" >/dev/null 2>&1 || true
      fi
    done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' "$project-$name")
    # The same name built again, which is what an uncommitted change does.
    id=${previous[$index]}
    if [[ -n $id && $id != "$(docker image inspect -f '{{.Id}}' "$project-$name:$release")" ]]; then
      docker image rm "$id" >/dev/null 2>&1 || true
    fi
    index=$((index + 1))
  done
}

# Waits until the deployment answers, through its own port, as this release.
answers() {
  local health code
  for _ in $(seq 1 60); do
    health=$(curl -s "http://127.0.0.1:$port/api/health" || true)
    code=$(status_of /sign-in as-visitor)
    if grep -q '"status":"ok"' <<<"$health" &&
      grep -qF "\"commit\":\"$release\"" <<<"$health" && [[ $code == 200 ]]; then
      return 0
    fi
    sleep 1
  done
  echo "staging: the deployment does not answer as $release" >&2
  echo "staging: /api/health said: ${health:-nothing}; /sign-in answered ${code:-nothing}" >&2
  return 1
}

deploy() {
  load
  local name
  release=$(git -C "$root" rev-parse HEAD)
  if [[ -n $(git -C "$root" status --porcelain) ]]; then
    [[ ${FORGEMIND_STAGING_ALLOW_DIRTY:-} == 1 ]] ||
      die "the checkout has changes that are not committed, and a deployment is of a commit (FORGEMIND_STAGING_ALLOW_DIRTY=1 deploys them, marked as such)"
    release+=-dirty
  fi
  secret_file postgres_password
  if [[ $provider == github ]]; then
    for name in github_client_secret github_app_private_key github_webhook_secret; do
      secret_file "$name" "the github provider"
    done
    if [[ -d $dir/repositories ]]; then
      say "$dir/repositories is left out: the github provider clones from GitHub"
    fi
  fi

  build

  # Asked of the new images before anything running is touched: settings the
  # API or a worker would refuse to start with end the deployment here.
  say "checking the settings"
  compose run --rm --no-deps -T api python -m forgemind_api check serve
  compose run --rm --no-deps -T worker python -m forgemind_api check worker

  # The schema first, alone, so that a migration that fails leaves the
  # release that is running as it was.
  say "migrating the database"
  compose up -d --wait postgres redis
  compose run --rm -T migrate ||
    die "the migration failed; the release that was running is left as it was"

  say "starting $release"
  printf '%s\n' "$release" >"$released"
  if ! compose up -d --remove-orphans --wait --wait-timeout 180 || ! answers; then
    compose ps -a >&2 || true
    compose logs --tail 40 api worker sweeper web edge >&2 || true
    die "the deployment of $release did not come up; what the services logged is above"
  fi
  forget_earlier_images
  say "$release is deployed at $public_url (127.0.0.1:$port on this machine)"
  if [[ $provider == simulated && ! -f $gate_file ]]; then
    say "GitHub is simulated and no password is asked: anyone who reaches $public_url can sign in"
  fi
}

status() {
  load
  echo "deployment  $dir"
  echo "address     $public_url (127.0.0.1:$port on this machine)"
  echo "github      $provider"
  if [[ -f $gate_file ]]; then
    echo "password    asked of every visitor, as $(<"$secrets/gate_user")"
  else
    echo "password    none asked"
  fi
  if [[ -z $release ]]; then
    echo "release     nothing has been deployed"
    return 0
  fi
  echo "release     $release"
  echo "health      $(curl -s "http://127.0.0.1:$port/api/health" || echo "no answer")"
  compose ps -a
}

gate() {
  load
  local user=${1:-} password hash caddy
  case $user in
    '') die "gate needs the name visitors will give, or off" ;;
    off)
      rm -f "$gate_file" "$secrets/gate_user" "$secrets/gate_password"
      say "no password is asked of a visitor"
      ;;
    *)
      [[ $user =~ ^[A-Za-z0-9_.-]+$ ]] || die "the name may hold letters, digits, dots, dashes and underscores"
      caddy=$(awk '$1 == "FROM" { print $2; exit }' "$files/edge.Dockerfile")
      password=$(random 12)
      # On standard input: an argument would show in the machine's process list.
      hash=$(printf '%s\n' "$password" | docker run --rm -i "$caddy" caddy hash-password)
      [[ $hash == \$2* ]] || die "could not hash the password"
      keep_secret gate_user "$user"
      keep_secret gate_password "$password"
      (
        umask 022
        cat >"$gate_file" <<EOF
# Written by scripts/staging.sh gate. Every visitor is asked for a password,
# but not GitHub delivering a webhook, whose signature the API checks, nor
# whoever asks whether the deployment is up.
@visitor not path /api/github/webhooks /api/health
basic_auth @visitor {
	$user $hash
}

# The password is this door's and goes no further in.
request_header -Authorization
EOF
      )
      # Not said here: what a terminal shows is kept by more than the terminal.
      say "visitors are asked for the name $user and the password in $secrets/gate_password"
      ;;
  esac
  if [[ -n $release ]]; then
    # Made again: the edge holds the file it started with.
    compose up -d --no-deps --force-recreate --wait edge
  fi
}

command=${1:-}
shift || true
case $command in
  init) init "$@" ;;
  deploy) deploy ;;
  status) status ;;
  gate) gate "$@" ;;
  logs)
    load
    compose logs --tail 200 "$@"
    ;;
  down)
    load
    compose down --remove-orphans
    ;;
  compose)
    load
    compose "$@"
    ;;
  *)
    sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//' >&2
    exit 2
    ;;
esac
