"""``AttemptLite`` — the small attempt summary every v1 read and write returns.

    {id, kind, ref_id, state, version,
     module: {id, order, duration_ms} | null, module_ids: [m1, m2],
     timing: {server_now, deadline_at | null, remaining_ms | null, paused},
     results_ready, score | null, midterm: null | {...}}

``module`` is the live module, or the one about to start (NOT_STARTED), and null once the
paper is handed in. ``deadline_at`` is null while paused, not started, or handed in. The clock
is the server's: past papers use the same anchors and banked pause seconds as
``exams.attempt_timing``; midterms the module deadline of ``midterms.views._module_deadline``.
No questions are ever loaded here.
"""

from __future__ import annotations

import datetime as _dt

from django.db.models import Count, Prefetch
from django.utils import timezone

from exams.attempt_timing import _module_started_anchor
from exams.models import Module, TestAttempt
from midterms.models import MidtermAttempt
from midterms.proctoring import GRACE_SECONDS as OFFSCREEN_GRACE_SECONDS
from midterms.proctoring import VIOLATION_LIMIT as OFFSCREEN_VIOLATION_LIMIT
from midterms.state_machine import (
    STATE_ACTIVE,
    STATE_MODULE_2_ACTIVE,
    STATE_NOT_STARTED,
    WIRE_STATE,
)
from midterms.views import LATE_ANSWER_GRACE_SECONDS, _module_deadline

from .conventions import iso, ms

KIND_PASTPAPER = "pastpaper"
KIND_MIDTERM = "midterm"

_PP_ACTIVE = (TestAttempt.STATE_MODULE_1_ACTIVE, TestAttempt.STATE_MODULE_2_ACTIVE)
_MT_ACTIVE = (STATE_ACTIVE, STATE_MODULE_2_ACTIVE)


def _timing(*, now, deadline_at, remaining_ms, paused) -> dict:
    return {
        "server_now": iso(now),
        "deadline_at": iso(deadline_at),
        "remaining_ms": remaining_ms,
        "paused": bool(paused),
    }


# ── past papers ──────────────────────────────────────────────────────────────────────────
def modules_with_counts():
    """Modules annotated with ``question_count`` — one query for a whole paper (or library)."""
    return Module.objects.annotate(question_count=Count("questions"))


def pastpaper_attempts():
    """The queryset every v1 past-paper summary is built from: the paper and its modules
    (with question counts) in two queries, never the questions themselves."""
    return TestAttempt.objects.select_related("practice_test").prefetch_related(
        Prefetch("practice_test__modules", queryset=modules_with_counts())
    )


def fresh_pastpaper(attempt_id: int) -> TestAttempt:
    return pastpaper_attempts().get(pk=attempt_id)


def _all_modules(attempt: TestAttempt) -> list[Module]:
    return sorted(attempt.practice_test.modules.all(), key=lambda m: (m.module_order, m.id))


def pastpaper_modules(attempt: TestAttempt) -> list[Module]:
    """The paper's SITTABLE modules in order.

    A module with no questions is left out: a single-module paper keeps an empty Module 2 row,
    and the engine skips it (``submit_module_1`` goes straight to SCORING), so the app must
    never be handed a module it would have to render empty. Counts come from the
    ``modules_with_counts`` prefetch; without it every module is kept.
    """
    return [m for m in _all_modules(attempt) if getattr(m, "question_count", None) != 0]


def pastpaper_live_module(attempt: TestAttempt, modules: list[Module]) -> Module | None:
    """The module the attempt is on — or the one it will start on. Never queries if the
    modules are already loaded."""
    by_order = {m.module_order: m for m in modules}
    state = attempt.current_state
    if state == TestAttempt.STATE_NOT_STARTED:
        return by_order.get(1)
    if state in _PP_ACTIVE:
        if attempt.current_module_id:
            for m in modules:
                if m.id == attempt.current_module_id:
                    return m
        return by_order.get(1 if state == TestAttempt.STATE_MODULE_1_ACTIVE else 2)
    return None


def pastpaper_lite(attempt: TestAttempt, *, now: _dt.datetime | None = None) -> dict:
    now = now or timezone.now()
    modules = pastpaper_modules(attempt)
    live = pastpaper_live_module(attempt, _all_modules(attempt))
    state = attempt.current_state
    paused = attempt.pause_started_at is not None
    module_block = None
    deadline_at = None
    remaining_ms = None
    if live is not None:
        limit = int(live.time_limit_minutes or 0) * 60
        duration_ms = limit * 1000
        module_block = {"id": live.id, "order": int(live.module_order), "duration_ms": duration_ms}
        if state == TestAttempt.STATE_NOT_STARTED:
            remaining_ms = duration_ms
        elif limit > 0:
            anchor = _module_started_anchor(attempt, live) or attempt.current_module_start_time
            if anchor is not None:
                order = int(live.module_order)
                banked = int(
                    (attempt.module_1_paused_seconds if order == 1 else attempt.module_2_paused_seconds) or 0
                )
                # The deadline moves out by every second already spent paused in this module.
                base_deadline = anchor + _dt.timedelta(seconds=limit + banked)
                if paused:
                    # Frozen: what was left when the pause began. No deadline while paused.
                    remaining_ms = max(0, ms(base_deadline - attempt.pause_started_at))
                else:
                    deadline_at = base_deadline
                    remaining_ms = max(0, ms(base_deadline - now))
    completed = bool(attempt.is_completed and state == TestAttempt.STATE_COMPLETED)
    return {
        "id": attempt.id,
        "kind": KIND_PASTPAPER,
        "ref_id": attempt.practice_test_id,
        "state": state,
        "version": int(attempt.version_number or 0),
        "module": module_block,
        "module_ids": [m.id for m in modules],
        "timing": _timing(now=now, deadline_at=deadline_at, remaining_ms=remaining_ms, paused=paused and live is not None),
        "results_ready": completed,
        "score": attempt.score if completed else None,
        "midterm": None,
    }


# ── midterms ─────────────────────────────────────────────────────────────────────────────
def midterm_module_ids(attempt: MidtermAttempt) -> list[int]:
    ids = []
    m1 = attempt.effective_module_for_order(1)
    if m1 is not None:
        ids.append(m1.id)
    if attempt.module_count() >= 2:
        m2 = attempt.effective_module_for_order(2)
        if m2 is not None:
            ids.append(m2.id)
    return ids


def midterm_live_order(attempt: MidtermAttempt) -> int | None:
    state = attempt.current_state
    if state == STATE_MODULE_2_ACTIVE:
        return 2
    if state in (STATE_NOT_STARTED, STATE_ACTIVE):
        return 1
    return None


def midterm_block(attempt: MidtermAttempt, *, desktop_required: bool) -> dict:
    return {
        "offscreen_violations": int(attempt.offscreen_violations or 0),
        "offscreen_limit": OFFSCREEN_VIOLATION_LIMIT,
        "offscreen_grace_seconds": OFFSCREEN_GRACE_SECONDS,
        "terminated_reason": attempt.terminated_reason or None,
        "desktop_required": bool(desktop_required),
        "late_grace_seconds": LATE_ANSWER_GRACE_SECONDS,
    }


def midterm_lite(attempt: MidtermAttempt, *, now: _dt.datetime | None = None) -> dict:
    from desktop import lockdown as desktop_lockdown

    now = now or timezone.now()
    midterm = attempt.midterm
    order = midterm_live_order(attempt)
    module_block = None
    deadline_at = None
    remaining_ms = None
    if order is not None:
        module = attempt.effective_module_for_order(order)
        duration_ms = int(midterm.duration_for_order(order)) * 60 * 1000
        if module is not None:
            module_block = {"id": module.id, "order": order, "duration_ms": duration_ms}
        if attempt.current_state == STATE_NOT_STARTED:
            remaining_ms = duration_ms
        else:
            deadline_at = _module_deadline(attempt, order)
            if deadline_at is not None:
                remaining_ms = max(0, ms(deadline_at - now))
    completed = bool(attempt.is_completed)
    return {
        "id": attempt.id,
        "kind": KIND_MIDTERM,
        "ref_id": attempt.midterm_id,
        "state": WIRE_STATE.get(attempt.current_state, attempt.current_state),
        "version": int(attempt.version_number or 0),
        "module": module_block,
        "module_ids": midterm_module_ids(attempt),
        "timing": _timing(now=now, deadline_at=deadline_at, remaining_ms=remaining_ms, paused=False),
        "results_ready": completed,
        # Never on the runner path: the release-gated score is only in the result endpoint.
        "score": None,
        "midterm": midterm_block(attempt, desktop_required=desktop_lockdown.applies_to(attempt)),
    }


def lite_for(attempt) -> dict:
    if isinstance(attempt, MidtermAttempt):
        return midterm_lite(attempt)
    return pastpaper_lite(attempt)


def fresh_midterm(attempt_id: int) -> MidtermAttempt:
    """A midterm attempt with everything its summary and bundle read, joined once. Never
    used under ``select_for_update`` (the paper modules and version are nullable joins)."""
    return MidtermAttempt.objects.select_related(
        "midterm", "version", "paper_module", "paper_module_2"
    ).get(pk=attempt_id)
