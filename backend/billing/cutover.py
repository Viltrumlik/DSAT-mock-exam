"""Leaving lc-up (owner, 2026-11-22: "Leave lc-up"; 2026-11-23: "1-dekabrdan o'zimizni sistemada ishlaymiz, api
orqali barcha ma'lumotlarni ovolishingiz kerak").

The steps, on the evening before the first day (30 Nov for 1 Dec), each its own command so a person sees each result:

1. ``prepare`` while lc-up is still the master: the last full pull (every archive window read again, the last sync,
   the shadow tick, lc-up's past payments copied), then each account is set to lc-up's balance with one adjustment
   row dated the day before, so the ledger starts its first day exactly where lc-up ended. Without ``--apply`` it pulls
   and lists the differences only.
2. The environment is switched (``deploy/cutover-env.sh on``): lc-up off, the ledger the master, per lesson.
3. ``finish``: every running monthly seat moves to per lesson from the first day, then the first tick, which freezes
   whoever owes — held for a person when that is more than ``ledger.MAX_FREEZES_PER_TICK`` (``--allow-mass``).

It runs before midnight on purpose: lc-up may charge the new month at midnight, and a balance read after that would
charge December twice (lc-up's month and our lessons).

``reverse`` goes back after ``deploy/cutover-env.sh off``: money entered here by hand since the first day is listed (to
be entered in lc-up) and voided, per-lesson seats go back to the month (that month already lc-up's), and a ``prepare``
then sets every balance to lc-up's again. Expenses stay: they are the centre's own.
"""

from __future__ import annotations

from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from lcup.conf import lcup_enabled

from . import ledger, shadow
from .history import copy_past_payments
from .models import Account, BillingRun, BillingState, EndReason, Entry, EntryKind, Span, SpanRule
from .reads import balances

#: Every switch once the centre has left lc-up.
LEFT_LCUP = {
    "LCUP_ENABLED": False,
    "LCUP_ARCHIVE_ENABLED": False,
    "LCUP_ATTENDANCE_PULL_ENABLED": False,
    "LCUP_ATTENDANCE_PUSH_ENABLED": False,
    "LCUP_ATTENDANCE_CHECKS_ENABLED": False,
    "LCUP_PROFILE_SYNC_ENABLED": False,
    "LCUP_DEBT_FREEZE_ENABLED": False,
    "SMS_DEBT_WARNINGS_ENABLED": False,
    "BILLING_SHADOW_ENABLED": False,
    "BILLING_PAYMENTS_OPEN": True,
    "BILLING_MODE": "lesson",
}
#: What ``reverse`` needs back: lc-up the master, the ledger following it by the month.
WITH_LCUP = {"LCUP_ENABLED": True, "BILLING_SHADOW_ENABLED": True, "BILLING_PAYMENTS_OPEN": False, "BILLING_MODE": "month"}
#: Differences and freezes kept on a run's row for the owner to read.
ROWS_KEPT = 1000


class CutoverRefused(Exception):
    """Why this step cannot run now, in words."""


def flags() -> dict:
    return {name: getattr(settings, name, None) for name in LEFT_LCUP}


def mismatches(target: dict) -> list[str]:
    now = flags()
    return [f"{name} is {now.get(name)!r}, needs {want!r}" for name, want in target.items() if now.get(name) != want]


def _check_day(day: date, today: date) -> None:
    """The first day is today, or tomorrow: the evening before is when it should run."""
    if day not in (today, today + timedelta(days=1)):
        raise CutoverRefused(f"--day must be today ({today}) or tomorrow; run it on the evening before {day}.")


def _record(step: str, day: date, report: dict, rows: list | None = None, *, ok: bool = True) -> BillingRun:
    return BillingRun.objects.create(
        kind=BillingRun.Kind.CUTOVER, day=day, finished_at=timezone.now(), ok=ok,
        counts={"step": step, **{k: v for k, v in report.items() if not isinstance(v, (list, dict))}},
        alerts=[str(a) for a in report.get("alerts", [])][:50], rows=(rows or [])[:ROWS_KEPT],
    )


# ── 1. prepare ────────────────────────────────────────────────────────────────────────────────────────────────


def last_pull(now) -> dict:
    """Everything lc-up serves, read once more: every archive window (also those done long ago), the sync, the shadow
    tick, and lc-up's past payments copied. Refused on any failure: the true-up must stand on a whole pull."""
    if not lcup_enabled():
        raise CutoverRefused("lc-up is switched off already: there is nothing left to pull.")
    from lcup.models import LcupSyncRun
    from lcup.tasks import _exclusive, archive_exclusive

    archive = archive_exclusive(dry_run=False, full=True)
    if archive is None:
        raise CutoverRefused("Another archive pass is running. Try again when it ends.")
    if not archive.ok:
        raise CutoverRefused(f"The archive pass failed: {'; '.join(archive.errors)[:400]}")
    sync = _exclusive(dry_run=False)
    if "skipped" in sync:
        raise CutoverRefused("A sync is running. Try again in a few minutes.")
    last = LcupSyncRun.objects.filter(dry_run=False).order_by("-started_at").first()
    if not (last and last.ok):
        raise CutoverRefused("The last sync failed; see /ops/lcup.")
    tick = shadow.tick(now)
    if "skipped" in tick:
        raise CutoverRefused(f"The shadow tick did not run: {tick['skipped']}.")
    return {"archive_run": archive.pk, "sync_run": last.pk, "tick": tick, "history": copy_past_payments(apply=True)}


def differences() -> list[dict]:
    """Every account whose ledger balance is not lc-up's, and everyone lc-up holds money for with no account here."""
    people, ours = shadow.lcup_people(), balances()
    rows, known = [], set()
    for account in Account.objects.filter(lcup_student_id__isnull=False):
        known.add(account.lcup_student_id)
        person = people.get(account.lcup_student_id)
        if person is None or person.balance is None:
            continue
        mine = ours.get(account.pk, 0)
        if mine != person.balance:
            rows.append({"account_id": account.pk, "lcup_id": account.lcup_student_id, "name": account.name,
                         "ours": mine, "lcup": person.balance, "diff": mine - person.balance})
    for lcup_id, person in people.items():
        if lcup_id not in known and person.balance:
            rows.append({"account_id": None, "lcup_id": lcup_id, "name": person.name, "ours": 0,
                         "lcup": person.balance, "diff": -person.balance})
    rows.sort(key=lambda row: (-abs(row["diff"]), row["name"]))
    return rows


def true_up(day: date, rows: list[dict], *, token: str, by=None) -> dict:
    """One adjustment row per difference, dated the day before ``day``, that leaves the account at lc-up's balance."""
    on = day - timedelta(days=1)
    written, moved = 0, 0
    for row in rows:
        account = Account.objects.filter(pk=row["account_id"]).first() if row["account_id"] else shadow._account_of(row["lcup_id"])
        amount = row["lcup"] - row["ours"]
        if not amount:
            continue
        entry = ledger.post(
            account, EntryKind.ADJUST, amount, on, f"cutover:{token}:{account.pk}", by=by,
            note=f"Cutover: lc-up's balance on {on.isoformat()} was {row['lcup']:,} so'm",
        )
        if entry:
            written += 1
            moved += amount
    return {"adjustments": written, "net_moved": moved}


def prepare(day: date, *, today: date, apply: bool, pull: bool = True, by=None) -> dict:
    _check_day(day, today)
    if BillingState.get().opened_at is None:
        raise CutoverRefused("The ledger has not opened.")
    report = {"day": day.isoformat(), "applied": apply, "alerts": []}
    if pull:
        report["pull"] = last_pull(timezone.now())
    rows = differences()
    report["differences"] = len(rows)
    report["lcup_total"] = sum(row["lcup"] for row in rows)
    with transaction.atomic():
        report.update(true_up(day, rows, token=timezone.now().strftime("%Y%m%d%H%M%S"), by=by))
        if not apply:
            transaction.set_rollback(True)
    run = _record("prepare", day, report, rows)
    report["run"], report["biggest"] = run.pk, rows[:15]
    return report


# ── 3. finish ─────────────────────────────────────────────────────────────────────────────────────────────────


def would_freeze() -> list[dict]:
    """Who the first tick freezes: an account with a platform user, below zero, not frozen already."""
    totals = balances()
    out = []
    for account in Account.objects.filter(user__isnull=False, user__is_frozen=False).select_related("user"):
        balance = totals.get(account.pk, 0)
        if balance < 0:
            out.append({"account_id": account.pk, "user_id": account.user_id, "name": account.name, "balance": balance})
    return sorted(out, key=lambda row: row["balance"])


def finish(day: date, *, today: date, apply: bool, allow_mass: bool = False) -> dict:
    problems = mismatches(LEFT_LCUP)
    if problems:
        raise CutoverRefused("The environment is not switched yet (deploy/cutover-env.sh on): " + "; ".join(problems))
    _check_day(day, today)
    from .management.commands.billing_lessons_switch import switch

    report = {"day": day.isoformat(), "applied": apply, "allow_mass": allow_mass, "alerts": []}
    freezes = would_freeze()
    report["owing_unfrozen"] = len(freezes)
    with transaction.atomic():
        report["switch"] = switch(day, today)
        tick = ledger.own_tick(today, allow_mass=allow_mass)
        report["tick"], report["alerts"] = tick["counts"], tick["alerts"] + tick["errors"]
        if not apply:
            transaction.set_rollback(True)
    run = _record("finish", day, report, freezes)
    report["run"], report["freeze_list"] = run.pk, freezes[:15]
    return report


# ── reverse ───────────────────────────────────────────────────────────────────────────────────────────────────


def reverse(day: date, *, since: date, today: date, apply: bool, by=None) -> dict:
    """Back to lc-up from ``day`` (the first day billed by the month again). ``since`` is the cutover's first day."""
    problems = mismatches(WITH_LCUP)
    if problems:
        raise CutoverRefused("The environment is not switched back yet (deploy/cutover-env.sh off): " + "; ".join(problems))
    if day > today:
        raise CutoverRefused("--day cannot be later than today.")
    report = {"day": day.isoformat(), "since": since.isoformat(), "applied": apply, "alerts": []}
    by_hand = list(
        Entry.objects.filter(key__startswith=ledger.MANUAL_KEY, day__gte=since, voided_at__isnull=True)
        .select_related("account").order_by("day", "id")
    )
    listed = [
        {"account_id": e.account_id, "name": e.account.name, "kind": e.kind, "amount": e.amount, "day": e.day.isoformat(),
         "method": e.method, "note": e.note}
        for e in by_hand
    ]
    with transaction.atomic():
        for entry in by_hand:
            ledger.void(entry, "Cutover reversed: lc-up is the master again, so this is entered there", by=by)
        moved = 0
        for span in Span.objects.filter(rule=SpanRule.LESSON, end__isnull=True).select_related("seat").order_by("id"):
            start = max(day, span.start)  # a seat that had not begun goes back to the month from its own start
            ledger.end_span(span, start - timedelta(days=1), EndReason.SWITCH, today=today)
            ledger.start_span(span.seat, start, today=today, rule=SpanRule.MONTH, opening_month=ledger.month_of(start))
            moved += 1
        report.update({"entered_here_voided": len(by_hand), "seats_back_to_month": moved})
        if not apply:
            transaction.set_rollback(True)
    run = _record("reverse", day, report, listed)
    report["run"], report["enter_in_lcup"] = run.pk, listed
    report["next"] = "After the next lc-up sync: billing_cutover prepare --day <today> --apply, to set every balance to lc-up's."
    return report


def status() -> dict:
    state = BillingState.get()
    runs = BillingRun.objects.filter(kind=BillingRun.Kind.CUTOVER).order_by("-started_at")[:10]
    return {
        "flags": flags(),
        "left_lcup": not mismatches(LEFT_LCUP),
        "missing_to_leave": mismatches(LEFT_LCUP),
        "ledger_opened": state.opened_at.isoformat() if state.opened_at else None,
        "last_tick": state.last_tick_at.isoformat() if state.last_tick_at else None,
        "runs": [{"id": r.pk, "at": r.started_at.isoformat(), "day": r.day, "ok": r.ok, **r.counts} for r in runs],
    }
