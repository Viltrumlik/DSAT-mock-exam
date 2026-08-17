"""Strikes: the attendance streak, and the part of it a student can spend.

The rule, as the school states it: **turn up and your strike goes up; miss a lesson and it
goes back to zero.** PRESENT and LATE both count — being late is still turning up — and
everything else, including EXCUSED, breaks the run.

That last part is worth being explicit about, because EXCUSED is treated gently everywhere
else on the platform (attendance scoring drops it from the denominator entirely rather than
counting it against a student). Here it breaks the streak, because the school asked for
"present or late, otherwise it resets" and a streak that survives absence is not a streak. It
is one entry in :data:`STREAK_STATUSES` if they change their mind.

**Recomputed from the register, never incremented.** Every other approach breaks on the thing
that actually happens: a teacher finalizes a session, then corrects a mark three days later.
An incremental counter would have to know how to unwind, and it would have to be right the
first time. Re-deriving the whole streak from attendance history is idempotent, self-correcting,
and cheap — a student has a few hundred attendance records, not a few million.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError
from django.db import transaction

from .models import StrikeTransaction, StudentStrike

logger = logging.getLogger(__name__)

#: Marks that keep a streak alive. Everything else — ABSENT, EXCUSED — breaks it.
STREAK_STATUSES = ("PRESENT", "LATE")


def record_for(student) -> StudentStrike:
    record, _ = StudentStrike.objects.get_or_create(student=student)
    return record


def _attended_history(student):
    """``[(date, status)]`` over every marked session, oldest first.

    This counted only FINALIZED sessions until production showed what that meant: **111
    attendance sessions, every one of them OPEN, not a single finalize in the platform's
    history** — so all 45 strike records sat at 0 while 57 students had real marks against
    them. The streak was not conservative, it was dead, and the shop that spends strikes was
    unusable for everybody.

    The old reasoning was that a teacher toggles P/A/L/E freely while marking and a streak
    moving on each toggle would break and rebuild itself under their cursor. That is still
    true and is still a real cost. It is simply the smaller one: a streak that wobbles for a
    minute while a register is being filled in beats a streak that is permanently zero.

    It is also now the only answer consistent with points, which pay the moment a mark is
    saved. Leaving this gated would tell a student they earned 5 points for a lesson that did
    not count toward their attendance streak, which is indefensible from the student's side of
    the screen.
    """
    from classes.models_attendance import AttendanceRecord

    return list(
        AttendanceRecord.objects.filter(student=student)
        .order_by("session__date", "session_id")
        .values_list("session__date", "status")
    )


def compute_streak(history) -> tuple[int, int, object]:
    """``(current, best, last_date)`` from an oldest-first history. Pure — no DB, no writes."""
    current = best = 0
    last_date = None
    for date, status in history:
        if status in STREAK_STATUSES:
            current += 1
            best = max(best, current)
        else:
            current = 0
        last_date = date
    return current, best, last_date


@transaction.atomic
def recompute(student, *, actor=None) -> StudentStrike:
    """Re-derive a student's streak from the register and settle what that does to their spend.

    Two cases the arithmetic has to get right:

    **The streak broke.** `spent_in_streak` resets with it. Anything they had already spent is
    spent — a reset does not refund and does not leave a debt to work off, which would mean a
    student came back from an absence owing the shop three lessons' attendance.

    **The streak shrank without breaking** — a teacher corrects one PRESENT in the middle of a
    run to ABSENT, and a 10-streak becomes 4. If they had spent 6, the spend now exceeds the
    streak. `spent_in_streak` is clamped to the new streak rather than left above it: the
    balance is floored at zero either way, and carrying an invisible overdraft would silently
    eat the next lessons they attend.
    """
    record = StudentStrike.objects.select_for_update().filter(student=student).first()
    if record is None:
        record = StudentStrike.objects.create(student=student)
        record = StudentStrike.objects.select_for_update().get(pk=record.pk)

    previous_balance = record.balance
    current, best, last_date = compute_streak(_attended_history(student))
    broke = current == 0 and record.current_streak > 0

    record.current_streak = current
    record.best_streak = max(int(record.best_streak), best)
    record.spent_in_streak = 0 if current == 0 else min(int(record.spent_in_streak), current)
    record.last_counted_date = last_date
    record.save(update_fields=[
        "current_streak", "best_streak", "spent_in_streak", "last_counted_date", "updated_at",
    ])

    # Only a break worth something is worth a row. Resetting a streak of zero, or one the
    # student had already spent to nothing, is not an event they need explained.
    if broke and previous_balance > 0:
        StrikeTransaction.objects.create(
            student=student, kind=StrikeTransaction.KIND_RESET,
            amount=-previous_balance, balance_after=0,
            reference="A missed lesson reset the streak.", actor=actor,
        )
    return record


@transaction.atomic
def spend(student, amount: int, *, reference: str, actor=None) -> StrikeTransaction:
    """Take strikes out of a student's balance. Raises ``ValidationError`` if short.

    Does **not** recompute first. The register is the slow-moving input here — it changes when
    a teacher finalizes a session, and the hook has already run by then — while a purchase is
    a click. Recomputing inside a spend would put an attendance-history scan on the hot path
    of every shop transaction for an answer that is already correct.
    """
    amount = int(amount)
    if amount <= 0:
        raise ValidationError("Spend a positive number of strikes.")

    record = StudentStrike.objects.select_for_update().filter(student=student).first()
    if record is None or record.balance < amount:
        available = record.balance if record else 0
        raise ValidationError(
            f"Not enough strikes: {available} available, {amount} needed."
        )

    record.spent_in_streak = int(record.spent_in_streak) + amount
    record.save(update_fields=["spent_in_streak", "updated_at"])
    return StrikeTransaction.objects.create(
        student=student, kind=StrikeTransaction.KIND_SPEND,
        amount=-amount, balance_after=record.balance,
        reference=reference, actor=actor,
    )


@transaction.atomic
def refund(student, amount: int, *, reference: str, actor=None) -> StrikeTransaction | None:
    """Give spent strikes back — a cancelled order, an admin undoing a mistake.

    Refunds into the *current* streak, and only as far as it goes. If the streak broke between
    the purchase and the cancellation there is nothing to refund into, and this returns None
    rather than inventing strikes the student's attendance no longer supports. The coins half
    of a mixed order is refunded separately and unconditionally, because coins do keep.
    """
    amount = int(amount)
    if amount <= 0:
        raise ValidationError("Refund a positive number of strikes.")

    record = StudentStrike.objects.select_for_update().filter(student=student).first()
    if record is None or record.spent_in_streak == 0:
        return None

    give_back = min(amount, int(record.spent_in_streak))
    record.spent_in_streak = int(record.spent_in_streak) - give_back
    record.save(update_fields=["spent_in_streak", "updated_at"])
    return StrikeTransaction.objects.create(
        student=student, kind=StrikeTransaction.KIND_ADMIN_GRANT,
        amount=give_back, balance_after=record.balance,
        reference=reference, actor=actor,
    )


def state(student) -> dict:
    """What a strike display needs."""
    record = record_for(student)
    return {
        "current_streak": int(record.current_streak),
        "best_streak": int(record.best_streak),
        "strikes": record.balance,
        "spent_in_streak": int(record.spent_in_streak),
        "last_counted_date": record.last_counted_date,
    }


def sync_from_attendance(record, *, actor=None) -> None:
    """Hook entry point: one attendance mark changed, so re-derive that student's streak.

    Wrapped by the caller so a strike failure can never break a teacher's save — same
    discipline as the reward hooks next door.

    No FINALIZED gate: see :func:`_attended_history` for why one here left every strike in
    production at zero. A mark is the fact; finalizing is paperwork the school does not do.
    """
    recompute(record.student, actor=actor)
