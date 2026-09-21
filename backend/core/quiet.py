"""Run a block of work without telling anybody about it.

There is exactly one thing this exists for: a **backfill**. A backfill replays facts that are
already true — a paper finished three weeks ago, a homework handed in the same evening — and
the student has long since moved on. Producing the rows those facts should have produced is
correct; ringing a bell about them in September is not. A student who opens the app to
"You earned 15 points" forty times for work they did in August learns that the bell is noise,
and the bell is the only way a real deadline ever reaches them.

**Why a context flag rather than an argument.** The producers here are signal receivers. The
caller hands them a model instance and nothing else — there is no parameter to thread a
``notify=False`` through, and adding one to every hook between the command and
``notifications.services.notify`` would mean editing code that has nothing to do with
backfilling. The flag is read at the point of delivery instead, which is the only place that
has to know.

``ContextVar`` and not a module global, for the same reason ``core.actor`` uses one: a global
would leak across threads, and the platform's web workers are threaded. Set here, it applies
to this call stack and nothing else.

**What it silences is delivery, never the record.** Points are still awarded, certificates
still minted, submissions still handed in — the student sees every one of them the next time
they open the page. Only the interruption is dropped: the in-app notification and the realtime
nudge that makes an open tab refetch. It is not a "dry run" and must never be used as one.

**This is read at two chokepoints, so every caller in the codebase now passes through it**:
``notifications.services.notify`` / ``notify_many``, and ``realtime.services.emit_to_user`` /
``emit_to_users`` (through which ``emit_to_classroom_members`` funnels). Every notification and
every realtime emit the platform sends is one of those four calls, which is the point — a check
the hooks had to opt into would be a check the next hook forgets.

Putting a condition in front of all of them is safe because for all of them it is false.
``_QUIET`` is a ``ContextVar`` with ``default=False``; nothing sets it but :func:`quiet_delivery`,
which today has exactly one caller — ``classes.management.commands.backfill_finished_pastpapers``
— and which restores the previous value in a ``finally``. A ``ContextVar`` is per-thread and
per-task, so a request being served on another worker thread cannot observe a backfill's flag,
and a backfill cannot leave it set for whatever runs on its thread next. The failure mode this
would have if it were a module global — one silent sweep muting the bell for every student
mid-run — is precisely what a ``ContextVar`` rules out. The cost on the ordinary path is one
``ContextVar.get()``.
"""

from __future__ import annotations

import contextlib
from contextvars import ContextVar

#: Truthy while a caller is inside :func:`quiet_delivery`.
_QUIET: ContextVar[bool] = ContextVar("core_quiet_delivery", default=False)


def is_quiet() -> bool:
    """Whether notifications and realtime nudges should be dropped on this call stack."""
    return bool(_QUIET.get())


@contextlib.contextmanager
def quiet_delivery():
    """Suppress in-app notifications and realtime nudges for the duration of the block.

    Reentrant, and restores whatever was in force before — a nested block cannot accidentally
    un-quiet an outer one.
    """
    token = _QUIET.set(True)
    try:
        yield
    finally:
        _QUIET.reset(token)


def preserving(fn):
    """Wrap a callback so it runs later under the quiet state in force **now**.

    ``ContextVar`` and ``transaction.on_commit`` do not compose. A hook that defers its
    notification to commit time has already decided what kind of work it is doing — but the
    callback runs after the ``with`` block has been left, in whatever context the commit happens
    to occur in, and would ring the bell a backfill went out of its way to silence. Capturing
    the flag at *registration* is the honest reading: the decision belongs to the moment the
    award was written, not to the moment the database got round to committing it.
    """
    quiet_now = is_quiet()

    def _wrapped():
        if not quiet_now:
            return fn()
        with quiet_delivery():
            return fn()

    return _wrapped


__all__ = ["is_quiet", "preserving", "quiet_delivery"]
