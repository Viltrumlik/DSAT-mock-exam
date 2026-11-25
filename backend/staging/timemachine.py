"""The toolbox's side of the time machine. The machine itself is ``deploy/staging/stg_timemachine.py``, run by root.

They meet in ``settings.STAGING_TM_DIR`` (``/var/www/satapp-staging/shared/timemachine`` on the server):

* ``requests/<time_ns>-<uuid>.json`` — one request, written here (as satapp) whole: a temporary name the machine does
  not read, then renamed. The machine takes requests one at a time and deletes each when it takes it.
  ``{"id", "action": "forward"|"back"|"today"|"refresh", "days"?, "checkpoint"?, "by"}``.
* ``state.json`` — written only by the machine: the clock's offset, the checkpoints, what it is doing (``busy``), the
  last result and the history. Read here.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import date
from pathlib import Path

from django.conf import settings
from django.utils import timezone

#: The machine's own limit (``stg_timemachine.MAX_DAYS``): days moved in one request.
MAX_DAYS = 60
ACTIONS = ("forward", "back", "today", "refresh")
#: Held (O_EXCL) while one worker writes a request, so two POSTs at the same moment cannot both queue one. Not
#: ``*.json``, so the machine never reads it. One older than STALE_LOCK_SECONDS was left by a worker that died.
LOCK = ".ask.lock"
STALE_LOCK_SECONDS = 30
BEING_MADE = "Another request is being made right now. Try again in a moment."


class ToolboxRefused(Exception):
    """Why the toolbox will not do this, in words for the person at it. ``status`` is the HTTP answer: 400 for a
    request that is wrong as it stands, 409 for one that clashes with what the time machine is doing now, 503 when its
    folder cannot be written."""

    def __init__(self, message: str, *, status: int = 400):
        super().__init__(message)
        self.status = status


def _dir() -> Path:
    return Path(settings.STAGING_TM_DIR)


def _requests() -> Path:
    return _dir() / "requests"


def _today() -> date:
    """The copy's today: its processes run under the time machine's clock (libfaketime)."""
    return timezone.localdate()


def read_state() -> dict:
    """``state.json`` as the machine last wrote it, with the machine's own defaults until it has written one. The test
    date is the copy's own today: the machine's copy of it is written when it saves, so after real midnight it is a
    day behind until the next save."""
    try:
        state = json.loads((_dir() / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    state.setdefault("offset_days", 0)
    state["test_date"] = _today().isoformat()
    state.setdefault("checkpoints", [])
    state.setdefault("busy", None)
    state.setdefault("last", None)
    state.setdefault("history", [])
    state.setdefault("saved_at", None)
    return state


def pending() -> bool:
    """A request is waiting for the machine to take it."""
    try:
        return any(_requests().glob("*.json"))
    except OSError:
        return False


def _lock_age(lock: Path) -> float:
    """Seconds since the lock was taken: by the time written in it (every worker reads the copy's one clock), else by
    the file's own time (taken this instant and not written yet)."""
    try:
        return time.time() - float(lock.read_text(encoding="utf-8"))
    except ValueError:
        return time.time() - lock.stat().st_mtime


@contextmanager
def _asking():
    """One worker at a time writes a request; the lock goes when it is done, whatever happened."""
    lock = _requests() / LOCK
    for _ in range(2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o660)
        except FileExistsError:
            try:
                fresh = _lock_age(lock) < STALE_LOCK_SECONDS
            except FileNotFoundError:
                continue  # let go meanwhile: take it
            if fresh:
                raise ToolboxRefused(BEING_MADE, status=409) from None
            lock.unlink(missing_ok=True)  # left by a worker that died while writing
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(repr(time.time()))
        break
    else:
        raise ToolboxRefused(BEING_MADE, status=409)
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def ask(action: str, *, by: str, days: int | None = None, checkpoint: int | None = None) -> str:
    """Leave one request for the machine and return its id. Raises :class:`ToolboxRefused` for a request the machine
    would refuse (days not 1..MAX_DAYS, a checkpoint it does not hold), while it is busy, while a request waits or is
    being made, and (503) when its folder cannot be written."""
    if action not in ACTIONS:
        raise ToolboxRefused(f"Unknown action {action!r}.")
    if action == "forward" and (type(days) is not int or not 1 <= days <= MAX_DAYS):
        raise ToolboxRefused(f"Move 1 to {MAX_DAYS} days at a time.")
    try:
        folder = _requests()
        folder.mkdir(parents=True, exist_ok=True)
        with _asking():
            return _leave(folder, action, by=by, days=days, checkpoint=checkpoint)
    except OSError as exc:
        reason = exc.strerror or type(exc).__name__
        raise ToolboxRefused(f"The time machine's folder cannot be written ({reason}).", status=503) from None


def _leave(folder: Path, action: str, *, by: str, days: int | None, checkpoint: int | None) -> str:
    state = read_state()
    request = {"id": uuid.uuid4().hex, "action": action, "by": by}
    if action == "forward":
        request["days"] = days
    if action == "back":
        held = {cp.get("id") for cp in state["checkpoints"] if isinstance(cp, dict)}
        if type(checkpoint) is not int or checkpoint not in held:
            raise ToolboxRefused(f"There is no checkpoint {checkpoint}.")
        request["checkpoint"] = checkpoint
    if state["busy"]:
        raise ToolboxRefused("The time machine is working on another request. Wait for it to finish.", status=409)
    if pending():
        raise ToolboxRefused("A request is already waiting for the time machine.", status=409)
    name = f"{time.time_ns()}-{request['id']}"
    temporary = folder / f".{name}.tmp"  # not *.json: the machine never reads a half-written request
    temporary.write_text(json.dumps(request), encoding="utf-8")
    os.replace(temporary, folder / f"{name}.json")
    return request["id"]
