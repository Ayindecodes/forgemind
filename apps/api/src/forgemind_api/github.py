"""GitHub as the identity provider: the real one, and a simulated one that
serves look-alike pages for development and tests."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from html import escape
from typing import Literal, Protocol, cast
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse, RedirectResponse

from forgemind_api.errors import ApiFailure


@dataclass(frozen=True)
class GitHubIdentity:
    github_user_id: int
    login: str
    name: str
    email: str
    avatar_url: str | None


@dataclass(frozen=True)
class GitHubRepo:
    """A repository an installation can see."""

    github_id: int
    full_name: str
    private: bool
    default_branch: str
    description: str | None
    pushed_at: datetime
    languages: tuple[tuple[str, float], ...] = ()


@dataclass(frozen=True)
class InstallationInfo:
    installation_id: int
    account_login: str
    account_type: Literal["user", "organization"]
    repository_selection: Literal["all", "selected"]


# What the ForgeMind App asks GitHub for, and why, in the words the interface
# shows. Nothing here grants administration, actions or secrets.
APP_PERMISSIONS: tuple[dict[str, str], ...] = (
    {
        "name": "Metadata",
        "access": "read",
        "reason": "List the repositories you choose.",
    },
    {
        "name": "Contents",
        "access": "write",
        "reason": "Read code and push working branches. Never the default branch.",
    },
    {
        "name": "Pull requests",
        "access": "write",
        "reason": "Open pull requests for you to review.",
    },
    {"name": "Checks", "access": "read", "reason": "Read CI results on pull requests."},
    {
        "name": "Webhooks",
        "access": "read",
        "reason": "Hear about pushes and pull request changes.",
    },
)


class GitHubProvider(Protocol):
    def authorize_url(self, state: str, redirect_uri: str) -> str: ...
    def identity_for_code(self, code: str, state: str) -> GitHubIdentity: ...
    def install_url(self, state: str) -> str: ...
    def installation(self, installation_id: int) -> InstallationInfo: ...
    def installation_repositories(self, installation_id: int) -> list[GitHubRepo]: ...


class RealGitHub:
    """GitHub's OAuth web flow for a GitHub App's user authorization, and the
    App's own installation endpoints, authenticated with a short-lived JWT."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        *,
        app_id: str = "",
        private_key: str = "",
        slug: str = "forgemind",
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.app_id = app_id
        self.private_key = private_key.replace("\\n", "\n")
        self.slug = slug
        self.client = httpx.Client(transport=transport, timeout=10)

    def install_url(self, state: str) -> str:
        query = urlencode({"state": state})
        return f"https://github.com/apps/{self.slug}/installations/new?{query}"

    def app_jwt(self) -> str:
        """Identifies the App itself to GitHub for ten minutes at most."""
        issued = int(time.time())
        return jwt.encode(
            {"iat": issued - 60, "exp": issued + 540, "iss": self.app_id},
            self.private_key,
            algorithm="RS256",
        )

    def installation(self, installation_id: int) -> InstallationInfo:
        response = self.client.get(
            f"https://api.github.com/app/installations/{installation_id}",
            headers=self._app_headers(),
        )
        if not response.is_success:
            raise ApiFailure(
                "invalid", "GitHub does not know that installation. Try again."
            )
        data = as_object(response.json())
        account = as_object(data.get("account"))
        login = account.get("login")
        kind = str(account.get("type") or "User").lower()
        selection = data.get("repository_selection")
        if not isinstance(login, str):
            raise ApiFailure("invalid", "GitHub did not say whose installation it is.")
        return InstallationInfo(
            installation_id=installation_id,
            account_login=login,
            account_type="organization" if kind == "organization" else "user",
            repository_selection="all" if selection == "all" else "selected",
        )

    def installation_repositories(self, installation_id: int) -> list[GitHubRepo]:
        granted = self.client.post(
            f"https://api.github.com/app/installations/{installation_id}/access_tokens",
            headers=self._app_headers(),
        )
        token = as_object(granted.json() if granted.is_success else None).get("token")
        if not isinstance(token, str) or not token:
            raise ApiFailure("invalid", "GitHub refused an installation token.")
        headers = {
            "authorization": f"Bearer {token}",
            "accept": "application/vnd.github+json",
        }
        repos: list[GitHubRepo] = []
        page = 1
        while True:
            response = self.client.get(
                "https://api.github.com/installation/repositories",
                params={"per_page": 100, "page": page},
                headers=headers,
            )
            if not response.is_success:
                raise ApiFailure("invalid", "GitHub did not list the repositories.")
            body = as_object(response.json())
            raw_batch = body.get("repositories")
            if not isinstance(raw_batch, list):
                break
            batch = cast(list[object], raw_batch)
            for raw in batch:
                repo = as_object(raw)
                github_id = repo.get("id")
                full_name = repo.get("full_name")
                pushed = repo.get("pushed_at")
                if not isinstance(github_id, int) or not isinstance(full_name, str):
                    continue
                description = repo.get("description")
                branch = repo.get("default_branch")
                repos.append(
                    GitHubRepo(
                        github_id=github_id,
                        full_name=full_name,
                        private=bool(repo.get("private")),
                        default_branch=branch if isinstance(branch, str) else "main",
                        description=description
                        if isinstance(description, str)
                        else None,
                        pushed_at=parse_time(pushed),
                    )
                )
            if len(batch) < 100:
                break
            page += 1
        return repos

    def _app_headers(self) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self.app_jwt()}",
            "accept": "application/vnd.github+json",
        }

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        query = urlencode(
            {"client_id": self.client_id, "redirect_uri": redirect_uri, "state": state}
        )
        return f"https://github.com/login/oauth/authorize?{query}"

    def identity_for_code(self, code: str, state: str) -> GitHubIdentity:
        token = self.client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "state": state,
            },
            headers={"accept": "application/json"},
        )
        access = as_object(token.json() if token.is_success else None).get(
            "access_token"
        )
        if not isinstance(access, str) or not access:
            raise ApiFailure(
                "invalid", "The sign-in could not be completed. Try again."
            )
        headers = {
            "authorization": f"Bearer {access}",
            "accept": "application/vnd.github+json",
        }
        user = self.client.get("https://api.github.com/user", headers=headers)
        profile = as_object(user.json() if user.is_success else None)
        github_id = profile.get("id")
        login = profile.get("login")
        if not isinstance(github_id, int) or not isinstance(login, str):
            raise ApiFailure("invalid", "GitHub did not say who you are. Try again.")
        email = profile.get("email")
        if not isinstance(email, str) or not email:
            email = self._primary_email(headers)
        if email is None:
            raise ApiFailure(
                "invalid", "Your GitHub account has no verified email address."
            )
        name = profile.get("name")
        avatar = profile.get("avatar_url")
        return GitHubIdentity(
            github_user_id=github_id,
            login=login,
            name=name if isinstance(name, str) and name else login,
            email=email,
            avatar_url=avatar if isinstance(avatar, str) else None,
        )

    def _primary_email(self, headers: dict[str, str]) -> str | None:
        response = self.client.get(
            "https://api.github.com/user/emails", headers=headers
        )
        entries: object = response.json() if response.is_success else []
        if not isinstance(entries, list):
            return None
        for raw in cast(list[object], entries):
            entry = as_object(raw)
            address = entry.get("email")
            if (
                entry.get("primary") is True
                and entry.get("verified") is True
                and isinstance(address, str)
            ):
                return address
        return None


def as_object(value: object) -> dict[str, object]:
    """A JSON object as a typed mapping; anything else is empty."""
    return cast(dict[str, object], value) if isinstance(value, dict) else {}


# The people the simulated GitHub can sign in as. Ayinde owns the seeded
# organization; Sam is new to ForgeMind and goes through onboarding.
PERSONAS: tuple[GitHubIdentity, ...] = (
    GitHubIdentity(
        github_user_id=90000001,
        login="Ayindecodes",
        name="Ayinde",
        email="ayindegraphicscreation@gmail.com",
        avatar_url=None,
    ),
    GitHubIdentity(
        github_user_id=90000005,
        login="samrivera",
        name="Sam Rivera",
        email="sam@example.com",
        avatar_url=None,
    ),
)


@dataclass(frozen=True)
class SimulatedAccount:
    login: str
    account_type: Literal["user", "organization"]
    repositories: tuple[GitHubRepo, ...]


def _repo(
    github_id: int,
    full_name: str,
    languages: tuple[tuple[str, float], ...],
    pushed_minutes_ago: int,
    private: bool = True,
) -> GitHubRepo:
    return GitHubRepo(
        github_id=github_id,
        full_name=full_name,
        private=private,
        default_branch="main",
        description=f"{full_name.split('/')[1]} service",
        pushed_at=datetime.now(UTC) - timedelta(minutes=pushed_minutes_ago),
        languages=languages,
    )


# Which GitHub account each persona installs the App on.
PERSONA_ACCOUNTS: dict[str, str] = {
    "Ayindecodes": "forgemind",
    "samrivera": "samrivera",
}

# What each GitHub account can show an installation, keyed by the account's
# login, the same as the dev API's seed so the interface's tests mean the
# same thing here.
SIMULATED_ACCOUNTS: dict[str, SimulatedAccount] = {
    "forgemind": SimulatedAccount(
        login="forgemind",
        account_type="organization",
        repositories=(
            _repo(
                811001,
                "forgemind/api",
                (("TypeScript", 0.88), ("SQL", 0.07), ("Shell", 0.05)),
                30,
            ),
            _repo(
                811002,
                "forgemind/web",
                (("TypeScript", 0.94), ("CSS", 0.06)),
                90,
                private=False,
            ),
            _repo(
                811003,
                "forgemind/workers",
                (("Python", 0.76), ("Dockerfile", 0.14), ("Shell", 0.1)),
                300,
            ),
            _repo(811004, "acme/payments", (("Go", 0.81), ("HCL", 0.19)), 2 * 1440),
            _repo(
                811005,
                "acme/legacy-portal",
                (("PHP", 0.9), ("JavaScript", 0.1)),
                60 * 1440,
            ),
            _repo(
                811006,
                "forgemind/docs",
                (("MDX", 0.9), ("TypeScript", 0.1)),
                600,
                private=False,
            ),
            _repo(811007, "forgemind/infra", (("HCL", 0.8), ("Shell", 0.2)), 3000),
            _repo(
                811008, "forgemind/cli", (("TypeScript", 0.85), ("Shell", 0.15)), 1400
            ),
        ),
    ),
    "samrivera": SimulatedAccount(
        login="samrivera",
        account_type="user",
        repositories=(
            _repo(
                920001, "samrivera/notes-api", (("TypeScript", 0.95), ("SQL", 0.05)), 90
            ),
            _repo(
                920002,
                "samrivera/shop-web",
                (("TypeScript", 0.8), ("CSS", 0.2)),
                400,
                private=False,
            ),
            _repo(
                920003,
                "samrivera/data-pipeline",
                (("Python", 0.97), ("Shell", 0.03)),
                2000,
            ),
            _repo(
                920004,
                "samrivera/dotfiles",
                (("Shell", 0.7), ("Lua", 0.3)),
                9000,
                private=False,
            ),
            _repo(
                920005,
                "samrivera/legacy-cms",
                (("PHP", 0.9), ("JavaScript", 0.1)),
                30000,
            ),
        ),
    ),
}


class ResolveInstall(Protocol):
    """Who started an install state and for which organization: (login, name)."""

    def __call__(self, state: str) -> tuple[str, str]: ...


class ResolveAccount(Protocol):
    """The GitHub account login a stored installation belongs to, if any."""

    def __call__(self, installation_id: int) -> str | None: ...


def account_for_persona(login: str) -> SimulatedAccount:
    account = SIMULATED_ACCOUNTS.get(PERSONA_ACCOUNTS.get(login, ""))
    if account is None:
        raise ApiFailure("not_found", f"No simulated GitHub account for {login!r}")
    return account


class SimulatedGitHub:
    """Pages that look like GitHub's and sign in a chosen persona."""

    def __init__(
        self,
        api_origin: str,
        web_origin: str,
        resolve_account: ResolveAccount | None = None,
    ) -> None:
        self.api_origin = api_origin
        self.web_origin = web_origin
        self.codes: dict[str, tuple[str, GitHubIdentity]] = {}
        self.installations: dict[int, SimulatedAccount] = {}
        self._next_installation = 7000
        # Installations made before this process started, or seeded, are not
        # in memory; the service knows which account each one belongs to.
        self.resolve_account = resolve_account

    def install_url(self, state: str) -> str:
        return f"{self.api_origin}/auth/github/install?{urlencode({'state': state})}"

    def issue_installation(self, login: str) -> int:
        account = account_for_persona(login)
        self._next_installation += 1
        self.installations[self._next_installation] = account
        return self._next_installation

    def _account(self, installation_id: int) -> SimulatedAccount:
        account = self.installations.get(installation_id)
        if account is None and self.resolve_account is not None:
            login = self.resolve_account(installation_id)
            account = SIMULATED_ACCOUNTS.get(login) if login else None
            if account is not None:
                self.installations[installation_id] = account
        if account is None:
            raise ApiFailure(
                "invalid", "GitHub does not know that installation. Try again."
            )
        return account

    def installation(self, installation_id: int) -> InstallationInfo:
        account = self._account(installation_id)
        return InstallationInfo(
            installation_id=installation_id,
            account_login=account.login,
            account_type=account.account_type,
            repository_selection="selected",
        )

    def installation_repositories(self, installation_id: int) -> list[GitHubRepo]:
        return list(self._account(installation_id).repositories)

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        return f"{self.api_origin}/auth/github/authorize?{urlencode({'state': state})}"

    def issue_code(self, state: str, login: str) -> str:
        persona = next((p for p in PERSONAS if p.login == login), None)
        if persona is None:
            raise ApiFailure("not_found", f"No simulated GitHub account {login!r}")
        code = secrets.token_urlsafe(16)
        self.codes[code] = (state, persona)
        return code

    def identity_for_code(self, code: str, state: str) -> GitHubIdentity:
        issued = self.codes.pop(code, None)
        if issued is None or issued[0] != state:
            raise ApiFailure(
                "invalid", "The sign-in could not be completed. Try again."
            )
        return issued[1]

    def router(self, is_new: IsNew, resolve_install: ResolveInstall) -> APIRouter:
        router = APIRouter(include_in_schema=False)

        @router.get("/auth/github/install", response_class=HTMLResponse)
        def install(state: str = Query(min_length=1)) -> str:
            login, organization = resolve_install(state)
            account = account_for_persona(login)
            query = urlencode({"state": state})
            return page(
                f"Install ForgeMind on {account.login}",
                f"This installs the ForgeMind GitHub App on the {account.account_type} "
                f'{account.login}, for the ForgeMind organization "{organization}". '
                "It asks only for what is listed below.",
                [("Install", f"/auth/github/install/continue?{query}")],
                permissions=APP_PERMISSIONS,
            )

        @router.get("/auth/github/install/continue")
        def install_continue(state: str = Query(min_length=1)) -> RedirectResponse:
            login, _organization = resolve_install(state)
            installation_id = self.issue_installation(login)
            query = urlencode({"installation_id": installation_id, "state": state})
            return RedirectResponse(
                f"{self.web_origin}/auth/github/installed?{query}", status_code=302
            )

        @router.get("/auth/github/authorize", response_class=HTMLResponse)
        def authorize(state: str = Query(min_length=1)) -> str:
            actions: list[tuple[str, str]] = []
            for persona in PERSONAS:
                note = ", new to ForgeMind" if is_new(persona) else ""
                query = urlencode({"state": state, "user": persona.login})
                actions.append(
                    (
                        f"Authorize as {persona.name} ({persona.login}{note})",
                        f"/auth/github/authorize/continue?{query}",
                    )
                )
            return page(
                "Authorize ForgeMind",
                "ForgeMind wants to read your GitHub identity and email address. "
                "Nothing else is granted here; repository access is a separate, "
                "later step.",
                actions,
            )

        @router.get("/auth/github/authorize/continue")
        def authorize_continue(
            state: str = Query(min_length=1), user: str = Query(min_length=1)
        ) -> RedirectResponse:
            code = self.issue_code(state, user)
            query = urlencode({"code": code, "state": state})
            return RedirectResponse(
                f"{self.web_origin}/auth/github/callback?{query}", status_code=302
            )

        return router


class IsNew(Protocol):
    def __call__(self, persona: GitHubIdentity) -> bool: ...


STYLE = """
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif;
         background: #0d1117; color: #e6edf3; }
  .banner { background: #9e6a03; color: #0d1117; font-weight: 600;
            text-align: center; padding: 8px 16px; }
  main { max-width: 36rem; margin: 48px auto; padding: 0 24px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { color: #8d96a0; }
  .button { display: block; margin: 12px 0; padding: 10px 16px;
            border-radius: 6px; background: #238636; color: #fff;
            text-decoration: none; font-weight: 600; }
"""


def page(
    title: str,
    intro: str,
    actions: list[tuple[str, str]],
    permissions: tuple[dict[str, str], ...] = (),
) -> str:
    links = "".join(
        f'<a class="button" href="{escape(href)}">{escape(label)}</a>'
        for label, href in actions
    )
    rows = "".join(
        f"<tr><th>{escape(p['name'])}</th><td>{escape(p['access'])}</td>"
        f"<td>{escape(p['reason'])}</td></tr>"
        for p in permissions
    )
    table = f"<table>{rows}</table>" if rows else ""
    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">',
            f"<title>{escape(title)} · Simulated GitHub</title>",
            f"<style>{STYLE}</style>",
            "</head>",
            "<body>",
            '<div class="banner" role="note">'
            "Simulated GitHub. Nothing here reaches github.com.</div>",
            "<main>",
            f"<h1>{escape(title)}</h1>",
            f"<p>{escape(intro)}</p>",
            table,
            links,
            "</main>",
            "</body>",
            "</html>",
        ]
    )


def parse_time(value: object) -> datetime:
    """GitHub's ISO timestamps; now when absent."""
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(UTC)
