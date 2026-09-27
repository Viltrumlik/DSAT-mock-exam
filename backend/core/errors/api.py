from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AppError(Exception):
    detail: str
    code: str | None = None
    status_code: int = 400
    context_id: str | None = None


# Each of these re-declares the FIELD rather than setting a class attribute. `AppError` is a
# dataclass, so its generated `__init__` assigns `status_code` on every instance from the
# field's default — a bare `status_code = 403` on the subclass was shadowed the moment the
# exception was constructed, and every refusal went out as 400. "You do not teach this class"
# read as a malformed request, and a feature switched off answered 400 rather than the 404
# that makes it invisible.
@dataclass(frozen=True)
class BadRequest(AppError):
    status_code: int = 400


@dataclass(frozen=True)
class Forbidden(AppError):
    status_code: int = 403


@dataclass(frozen=True)
class NotFound(AppError):
    status_code: int = 404


@dataclass(frozen=True)
class Conflict(AppError):
    status_code: int = 409

