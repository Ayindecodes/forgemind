"""Failures the API reports, in the contract's error shape."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

ErrorCode = Literal[
    "unauthorized",
    "forbidden",
    "not_found",
    "invalid",
    "conflict",
    "rate_limited",
    "internal",
]

STATUS: dict[ErrorCode, int] = {
    "unauthorized": 401,
    "forbidden": 403,
    "not_found": 404,
    "invalid": 400,
    "conflict": 409,
    "rate_limited": 429,
    "internal": 500,
}


class ApiFailure(Exception):
    """An error with a contract code, a sentence for the person, and details."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
        self.details = details

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return {"error": error}


def unauthorized(reason: Literal["signed_out", "expired"]) -> ApiFailure:
    return ApiFailure(
        "unauthorized",
        "Your session has expired" if reason == "expired" else "Sign in to continue",
        {"reason": reason},
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiFailure)
    async def _failure(_request: Request, failure: ApiFailure) -> JSONResponse:
        return JSONResponse(failure.body(), status_code=STATUS[failure.code])

    @app.exception_handler(RequestValidationError)
    async def _invalid(
        _request: Request, error: RequestValidationError
    ) -> JSONResponse:
        issues = [
            {
                "path": ".".join(str(part) for part in issue["loc"] if part != "body"),
                "message": issue["msg"],
            }
            for issue in error.errors()
        ]
        failure = ApiFailure("invalid", "The request is not valid", {"issues": issues})
        return JSONResponse(failure.body(), status_code=STATUS["invalid"])
