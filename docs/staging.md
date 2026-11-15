# Staging

A staging deployment is the interface, the API, a worker and the sweeper with their PostgreSQL and Redis, on one machine, built from one commit and reached at one address. `scripts/staging.sh` runs it and `deploy/staging` holds what it runs. `apps/dev-api` has no part in it: the development API stays what it was, a stand-in for local work.

## What runs

```
browser ── HTTPS ──▶ the machine's proxy ──▶ 127.0.0.1:4300 ──▶ edge ──┬─ /api/* ──▶ api
                                                                       └─ the rest ─▶ web
                                             api, worker, sweeper ──▶ postgres, redis
```

- **One address.** The interface is built to ask for the API at `/api` on the address it was loaded from, so there is no second origin, no CORS and one cookie. The edge takes `/api` off before it passes a request on, and the API is told its address (`FORGEMIND_API_ORIGIN`) so that every link it writes, and the simulated GitHub's pages, point back through the edge.
- **One door.** The edge is the only container with a port on the machine, and that port is on the loopback address: Docker publishes ports past the firewall, so nothing is published anywhere else. PostgreSQL and Redis are on a network with no route out of it, which the interface and the edge are not on.
- **TLS is the machine's.** The edge speaks plain HTTP to whatever proxy ends TLS for the public address, and believes what that proxy says about the scheme and the client. `deploy/staging/host.Caddyfile.example` is a site for a Caddy that already runs on the machine.
- **Small and closed.** Every container has a memory limit and a cap on its logs (three files of 10 MB). The API's processes and the interface run as users that are not root, with every capability dropped and no way to gain one.

## The deployment's directory

`scripts/staging.sh init <public-url> [port]` makes it, at `~/.config/forgemind/staging` unless `FORGEMIND_STAGING_DIR` names another place. Nothing in it belongs in a repository.

| Path            | What it is                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `staging.env`   | The settings: the public address, the port, and any setting of the API. No secret goes here.                 |
| `secrets/`      | One file to a secret. `postgres_password` is made by `init`; GitHub's are put there by hand.                 |
| `repositories/` | Optional. Bare git repositories, `owner/name.git`, that the simulated GitHub offers beside its made-up ones. |
| `gate.caddy`    | Written by `scripts/staging.sh gate`: the password asked of every visitor.                                   |
| `release`       | The commit that is deployed.                                                                                 |

The directory and `secrets/` let nobody in but their owner. The files inside `secrets/` are readable by anyone who gets that far, and have to be: a container reads its secrets as a user the machine does not know. A secret reaches a container as a file under `/run/secrets`, named by a `FORGEMIND_*_FILE` setting, and is never in a container's environment, in an image or on a command line. Each service is given the ones it uses: the API all of GitHub's, the worker the App's private key, the sweeper none of them, and the interface and the edge nothing at all.

The database's password is fixed in the database the first time the deployment starts. Changing the file afterwards does not change it there.

## Deploying

```sh
scripts/staging.sh init https://staging.example.com   # once
scripts/staging.sh deploy                             # every time
```

`deploy` deploys the commit that is checked out, and refuses a checkout with uncommitted changes. In order, it:

1. builds the three images, each tagged with the commit;
2. asks the new API image to read the settings as the API and as a worker would (`python -m forgemind_api check serve`), and stops here, with the names of the variables at fault and none of their values, if either would refuse to start;
3. migrates the database, alone, so that a migration that fails leaves the release that is running as it was;
4. starts the release and waits until the deployment answers as that commit through its own port, with its worker and its sweeper running;
5. removes the images of earlier releases.

Until step 4 the release that is running is left alone: a deployment refused at step 2, or whose migration fails at step 3, replaces none of it. Step 3 starts PostgreSQL and Redis, and makes them again only if their own definition changed. A deploy is not seamless: requests are refused for a few seconds while containers are replaced, and between steps 3 and 4 the previous release runs on the new schema, so a migration has to be one the previous release can live with for that long.

```sh
scripts/staging.sh status          # what runs, from which commit, and its health
scripts/staging.sh logs api worker # what the services have logged
scripts/staging.sh down            # stop it; the database is kept
scripts/staging.sh compose ...     # docker compose, on the deployment
```

`FORGEMIND_STAGING_PROJECT` names the Compose project and its images, for a second deployment beside the first.

## Reaching it

The deployment listens on `127.0.0.1:4300`. From another machine, without a public address, forward the port and use `http://localhost:4300` as the public URL:

```sh
ssh -N -L 4300:localhost:4300 <user>@<machine>
```

For a public address, point a host name at the machine, give the machine's proxy a site for it that passes requests on to `127.0.0.1:4300`, and `init` the deployment with that address. `FORGEMIND_PUBLIC_URL` has to be exactly what a browser shows: sign-in redirects, the session cookie and the API's links are made from it. With an `https` address the session cookie is marked `Secure`.

Anyone with an account on the machine can reach the port directly, and can say what they like in the headers the edge believes. The edge is not a boundary against the machine's own users.

## GitHub

**Simulated**, the default. The API serves pages that look like GitHub's and sign in one of two fixed people, and offers made-up repositories and those in `repositories/`. Nothing is asked of whoever signs in, so on a public address anyone can: turn the password on (below) before the address is known. The interface says "Simulated GitHub" wherever the difference matters, and every answer of the API carries `x-forgemind-github: simulated`.

**GitHub itself.** Register a GitHub App for the deployment, with:

| Setting                | Value                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Callback URL           | `<public-url>/auth/github/callback`                                                    |
| Setup URL              | `<public-url>/auth/github/installed`                                                   |
| Webhook URL            | `<public-url>/api/github/webhooks`                                                     |
| Webhook secret         | what `secrets/github_webhook_secret` holds                                             |
| Repository permissions | Metadata: read. Contents, Pull requests: read and write. Checks: read. Webhooks: read. |

The API asks GitHub for the signed-in person's profile and, when the profile shows no address, for their email addresses. Of the deliveries that carry the right signature it acts on an `installation` that is deleted, suspended or unsuspended and on repositories removed from one (`installation_repositories`), and answers every other with `202` and does nothing.

Then put the App's client secret, its private key and the webhook secret in `secrets/` as `github_client_secret`, `github_app_private_key` and `github_webhook_secret`, readable as the others are (`chmod 644`), and name the App in `staging.env`:

```sh
FORGEMIND_GITHUB_PROVIDER=github
FORGEMIND_GITHUB_APP_SLUG=<the name in the App's address>
FORGEMIND_GITHUB_APP_ID=<the App's id>
FORGEMIND_GITHUB_CLIENT_ID=<the App's client id>
```

`deploy` refuses to go on if a secret is missing, empty or unreadable, or if the API would not start with what it was given.

## A password for every visitor

```sh
scripts/staging.sh gate <name>   # ask; the password is made here and kept in secrets/gate_password
scripts/staging.sh gate off      # stop asking
```

The edge then asks every visitor for the name and the password (HTTP basic authentication) before anything else answers. Two paths are left open: `/api/health`, and `/api/github/webhooks`, where GitHub has no password to give and the API holds a delivery to its signature instead. The password stops at the edge and is not passed on to the API or the interface.

## Logs

Every service writes JSON lines to stdout, which Docker keeps. The API's lines are described in `apps/api/README.md`; under `/api` they name the path as the browser asked for it. The edge writes a line for each request with its path and without its query, and does the same to the address of the page that sent it and to the address a redirect sends it on to: on the way back from GitHub each holds the code a sign-in is completed with. Cookies and passwords are not in either log.

The machine's own proxy keeps its own log, and is not covered by any of this.

## Checking a deployment

`scripts/staging-check.sh`, a step of the gate, deploys the checkout as above with a directory, a project and ports of its own (4295 and 4296), behind a proxy that ends TLS with a certificate of its own making. It holds the deployment to what this page says: the directory's modes; the one loopback port and the closed network; the limits on memory and logs, and the users and capabilities of the containers; a database taken from empty, and from a revision behind, to the schema; the session cookie's flags; what the logs leave out; the password; the refusals; and, with GitHub itself as the provider and credentials made up for the purpose, which service holds which secret, where signing in starts and what a webhook is held to. In a browser, a person signs in, creates an organization, installs the App, connects a repository of the check's own making, waits for the worker to index it and reads its analysis. The check says first which Docker and which Compose it ran with; it has passed with Compose 2.38.2 and with 5.6.0.

The browser's part runs against any deployment that uses the simulated GitHub:

```sh
cd apps/web
STAGING_URL=https://staging.example.com STAGING_REPOSITORY=owner/name \
  pnpm exec playwright test -c playwright.staging.config.ts
```

`STAGING_VISITOR=name:password` gives the visitors' password, `STAGING_REPOSITORY_COMMIT` and `STAGING_REPOSITORY_SHOWS` say what the analysis must be of and must hold, and `STAGING_PERSON` chooses who signs in. It signs a person in and connects a repository for good; it is a check of a staging deployment and nothing to run against a deployment people use.

## What it does not do

- **GitHub itself has not been exercised.** The check proves the settings, the secrets and the addresses of a deployment that speaks to GitHub, and that a webhook is held to its signature. No request has been made to github.com with a registered App, so the table above is what the code asks GitHub for and not what GitHub has been seen to grant.
- **No TLS, no rate limit, no HSTS and no content security policy** at the edge. The first belongs to the machine's proxy; the others are not there.
- **One machine, one of each service**, and a deploy that interrupts. Redis has no password and keeps nothing on disk: it is reachable only on the closed network, and a message it loses is queued again by the sweeper.
- **No health check for the worker or the sweeper.** A deploy waits until both are running, which is all that is asked of them; whether the worker works is seen when it indexes a repository.
- **No backups** of the database, and no collector for the traces and metrics unless `FORGEMIND_OTEL_ENDPOINT` names one.
- **The build cache grows.** `deploy` removes the images of earlier releases and leaves Docker's build cache alone, since it is shared with everything else on the machine.
