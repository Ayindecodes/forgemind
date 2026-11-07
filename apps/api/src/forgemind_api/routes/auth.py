"""Sign-in, the session, and sign-out."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from forgemind_api import auth
from forgemind_api.deps import Config, Current, Db, GitHub
from forgemind_api.schemas import (
    GitHubCallbackIn,
    GitHubRedirectOut,
    GitHubStartIn,
    OkOut,
    SessionOut,
)

router = APIRouter(tags=["auth"])


def set_session_cookie(response: Response, token: str, settings: Config) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86_400,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.api_origin.startswith("https://"),
    )


@router.get("/auth/session", response_model=SessionOut)
def session(current: Current) -> SessionOut:
    return current.out()


@router.post("/auth/sign-out", response_model=OkOut)
def sign_out(request: Request, response: Response, db: Db) -> OkOut:
    auth.sign_out(db, request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    return OkOut()


@router.post("/auth/github/start", response_model=GitHubRedirectOut)
def github_start(
    body: GitHubStartIn, db: Db, settings: Config, github: GitHub
) -> GitHubRedirectOut:
    state = auth.start_sign_in(db, body.next)
    redirect_uri = f"{settings.web_origin}/auth/github/callback"
    return GitHubRedirectOut(url=github.authorize_url(state, redirect_uri), state=state)


@router.post("/auth/github/callback", response_model=SessionOut)
def github_callback(
    body: GitHubCallbackIn,
    response: Response,
    db: Db,
    settings: Config,
    github: GitHub,
) -> SessionOut:
    token, principal, _next = auth.complete_sign_in(
        db, github, body.code, body.state, settings.session_days
    )
    set_session_cookie(response, token, settings)
    return principal.out()
