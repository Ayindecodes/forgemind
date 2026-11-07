"""GitHub as the identity provider: the real one, and a simulated one that
serves look-alike pages for development and tests."""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from html import escape
from typing import Protocol, cast
from urllib.parse import urlencode

import httpx
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


class GitHubProvider(Protocol):
    def authorize_url(self, state: str, redirect_uri: str) -> str: ...
    def identity_for_code(self, code: str, state: str) -> GitHubIdentity: ...


class RealGitHub:
    """GitHub's OAuth web flow for a GitHub App's user authorization."""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.client = httpx.Client(transport=transport, timeout=10)

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


class SimulatedGitHub:
    """Pages that look like GitHub's and sign in a chosen persona."""

    def __init__(self, api_origin: str, web_origin: str) -> None:
        self.api_origin = api_origin
        self.web_origin = web_origin
        self.codes: dict[str, tuple[str, GitHubIdentity]] = {}

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

    def router(self, is_new: IsNew) -> APIRouter:
        router = APIRouter(include_in_schema=False)

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


def page(title: str, intro: str, actions: list[tuple[str, str]]) -> str:
    links = "".join(
        f'<a class="button" href="{escape(href)}">{escape(label)}</a>'
        for label, href in actions
    )
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
            links,
            "</main>",
            "</body>",
            "</html>",
        ]
    )
