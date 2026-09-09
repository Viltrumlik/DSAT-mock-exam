"""The support desk's own history and its monthly numbers.

Pure aggregation — no DRF, no request, no permission. ``views_support_report`` is the thin
HTTP skin over this, and the tests read this module directly, which is the only way to pin
the arithmetic without dragging a client and a login through every assertion.

Two surfaces, and one number that outranks both.

**The history** is one row per booking, carrying everything a reader needs to judge the row
without a second request: when, whose desk, which student, which class the seat was booked
through, the topic, the outcome, who settled it and when, and — when the seat came from an
invitation — who brought them in. An hour published as a one-to-one that now has two names
on it has to explain itself.

**The month** is per support teacher: slots published, bookings taken, held, did not attend,
cancelled, still unsettled, distinct students helped, and the attendance rate.

**``unsettled`` is the number the report exists for.** A booking is settled when the support
teacher records HELD or NO_SHOW; until then it pays nobody — not the student, not anybody —
because ``rewards.hooks.sync_support_booking`` prices the hour on HELD and only on HELD. On
2026-09-09 production held 32 bookings still sitting in BOOKED whose hour was already over,
the oldest from 13 August. A support teacher who never settles their day is invisible in
every other figure here: their sessions look exactly like sessions that did not happen. So
the backlog is counted per teacher AND school-wide, it is reported ALL-TIME rather than only
inside the month being viewed (a September page must still be able to say "since 13 August"),
and it carries the date it reaches back to.

Two definitions worth stating because they are easy to get wrong:

* **Unsettled means BOOKED *and the hour is over*.** A booking for next Tuesday is not a
  backlog item — there is nothing to settle yet. Those are counted separately as
  ``upcoming``, so the five outcome counts still add up to ``bookings``.
* **A rate over an empty denominator is ``None``, never 0.** A teacher who held nothing and
  missed nothing has no attendance rate; rendering that as 0% accuses them of a failure that
  did not happen. The house rule, and it is enforced here rather than left to the page.
"""

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time as dt_time, timedelta

from django.db.models import Count, Min, Q
from django.db.models.functions import TruncMonth
from django.utils import timezone

from .models_support import SupportAvailability, SupportBooking

# ── Vocabulary ────────────────────────────────────────────────────────────────
#
# No raw DB enum ever reaches a screen. ``NO_SHOW`` is "Did not attend" — the school's own
# wording, chosen because it describes the hour rather than accusing the student. The labels
# are the model's, read from its choices so the two cannot drift.
STATUS_LABELS: dict[str, str] = dict(SupportBooking.STATUS_CHOICES)

#: A pseudo-status the history accepts as ``?status=`` alongside the four real ones. The
#: backlog is the headline of the monthly report, so a reader must be able to click straight
#: through to the rows behind it; without this they would filter on BOOKED and get next
#: week's appointments mixed in with August's unfinished ones.
STATUS_UNSETTLED = "UNSETTLED"

SESSION_STATUSES = tuple(s for s, _ in SupportBooking.STATUS_CHOICES)
HISTORY_STATUSES = SESSION_STATUSES + (STATUS_UNSETTLED,)

#: Page size for the history. A generous default because the desk is small — three teachers,
#: ~120 bookings all time — and a reader scanning a month should not have to page four times.
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def display_name(user) -> str:
    """A person's name for a report row.

    Its own copy rather than an import from ``views_rankings``, which pulls DRF in with it —
    this module is deliberately importable without the HTTP stack. Ends in a literal because
    both ``username`` and ``email`` are nullable on this model.
    """
    if user is None:
        return ""
    name = f"{getattr(user, 'first_name', '') or ''} {getattr(user, 'last_name', '') or ''}".strip()
    return name or getattr(user, "username", None) or getattr(user, "email", None) or "Student"


# ── Time, in the school's own timezone ────────────────────────────────────────
#
# Every window here is a LOCAL one. The desk keeps Tashkent hours; a UTC month boundary moves
# five hours of sessions into the wrong month, and a UTC "today" flips five hours early.

def _local_midnight(day: date):
    return timezone.make_aware(
        datetime.combine(day, dt_time()), timezone.get_current_timezone()
    )


def month_bounds(month: str) -> tuple[datetime, datetime]:
    """``(start, end)`` for a ``YYYY-MM`` string — local midnight to local midnight, end
    exclusive. Raises ``ValueError`` on anything that is not a month."""
    year, sep, mon = str(month or "").partition("-")
    if not sep:
        raise ValueError("A month looks like 2026-09.")
    try:
        y, m = int(year), int(mon)
    except (TypeError, ValueError):
        raise ValueError("A month looks like 2026-09.") from None
    if not (1 <= m <= 12) or not (2000 <= y <= 2999):
        raise ValueError("A month looks like 2026-09.")
    start = _local_midnight(date(y, m, 1))
    end = _local_midnight(date(y, m, monthrange(y, m)[1]) + timedelta(days=1))
    return start, end


def month_key(value) -> str:
    """``YYYY-MM`` for a datetime, read in the school's timezone."""
    local = timezone.localtime(value) if timezone.is_aware(value) else value
    return f"{local.year:04d}-{local.month:02d}"


def current_month(*, now=None) -> str:
    return month_key(timezone.localtime(now or timezone.now()))


def available_months(*, teacher_id=None, now=None) -> list[str]:
    """The months the picker may offer, newest first.

    Months that actually have a published hour behind them, **never a month in the future**.
    Every booking hangs off an availability row, so the slot table is the complete record of
    when this desk did anything.

    The current month is always included even when it is empty: a picker that cannot offer
    "this month" on the 1st is a picker that looks broken on the first of every month.
    """
    this_month = current_month(now=now)
    qs = SupportAvailability.objects.all()
    if teacher_id:
        qs = qs.filter(support_teacher_id=teacher_id)
    months = {
        month_key(value)
        for value in qs.annotate(m=TruncMonth("starts_at"))
        .values_list("m", flat=True)
        .distinct()
        if value is not None
    }
    months.add(this_month)
    return sorted((m for m in months if m <= this_month), reverse=True)


def default_month(*, now=None) -> str:
    """The month to open on. The current one — never a future one, whatever the calendar
    holds. A desk with October slots published must still open on September."""
    return current_month(now=now)


# ── Who runs the desk ─────────────────────────────────────────────────────────

def support_teacher_ids() -> set[int]:
    """Everyone whose desk this report covers.

    Two sources unioned, because either alone is wrong. The role alone misses somebody whose
    account was later changed but whose hours are still in the history; the availability table
    alone misses a newly appointed teacher who has not published anything yet and would leave
    them off the report rather than showing an honest row of zeros.
    """
    from django.contrib.auth import get_user_model

    from access import constants as acc_const
    from access.services import normalized_role

    ids = set(
        SupportAvailability.objects.values_list("support_teacher_id", flat=True).distinct()
    )
    User = get_user_model()
    # Narrowed in the database to a handful of rows, then re-checked in Python through
    # ``normalized_role``. Two halves, and both are needed: scanning every user would walk
    # the whole account table (every student carries a role), while trusting the LIKE alone
    # would accept a role that merely contains the words. ``normalized_role`` is the one
    # place that knows what a role really is, so it gets the last word.
    candidates = User.objects.filter(role__icontains=acc_const.ROLE_SUPPORT_TEACHER)
    for user in candidates.only("id", "role"):
        if normalized_role(user) == acc_const.ROLE_SUPPORT_TEACHER:
            ids.add(user.id)
    return ids


def _people(ids) -> dict[int, str]:
    from django.contrib.auth import get_user_model

    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {
        u.id: display_name(u)
        for u in get_user_model().objects.filter(id__in=ids).only(
            "id", "first_name", "last_name", "username", "email"
        )
    }


# ── 1. Session history ────────────────────────────────────────────────────────

def _is_unsettled(booking, now) -> bool:
    return (
        booking.status == SupportBooking.STATUS_BOOKED
        and booking.availability.ends_at <= now
    )


def session_row(booking, *, now=None) -> dict:
    """One booking, flattened for a report table.

    Everything a reader needs to judge the row is on it. The point of the flattening is that
    a row is never ambiguous on its own: the status carries its human label beside it, the
    slot's own times come along, and ``invited_by`` is present rather than implied.
    """
    now = now or timezone.now()
    slot = booking.availability
    teacher = slot.support_teacher
    return {
        "id": booking.id,
        "starts_at": slot.starts_at,
        "ends_at": slot.ends_at,
        "slot_id": slot.id,
        "slot_note": slot.note,
        "capacity": slot.capacity,
        "support_teacher_id": teacher.id if teacher else None,
        "support_teacher": display_name(teacher),
        "student_id": booking.student_id,
        "student": display_name(booking.student),
        "classroom_id": booking.classroom_id,
        "classroom_name": booking.classroom.name if booking.classroom else None,
        "topic": booking.topic,
        "status": booking.status,
        # Never the raw enum on screen. NO_SHOW reads as "Did not attend".
        "status_label": STATUS_LABELS.get(booking.status, booking.status),
        "booked_at": booking.booked_at,
        "settled_at": booking.settled_at,
        "settled_by_id": booking.settled_by_id,
        "settled_by": display_name(booking.settled_by) if booking.settled_by_id else None,
        # Null for the ordinary case of a student booking themselves. Present so an hour with
        # two names on it explains where the second one came from.
        "invited_by_id": booking.invited_by_id,
        "invited_by": display_name(booking.invited_by) if booking.invited_by_id else None,
        "cancel_reason": booking.cancel_reason,
        "cancelled_at": booking.cancelled_at,
        "teacher_note": booking.teacher_note,
        "rating": booking.rating,
        "rating_comment": booking.rating_comment,
        # The row's own copy of the headline. A reader scanning the history should be able to
        # see the backlog without cross-referencing the summary.
        "is_unsettled": _is_unsettled(booking, now),
    }


def session_history(
    *,
    teacher_id=None,
    date_from: date | None = None,
    date_to: date | None = None,
    status: str | None = None,
    student_id=None,
    offset: int = 0,
    limit: int = DEFAULT_PAGE_SIZE,
    now=None,
) -> dict:
    """Bookings newest first, paginated, with the total behind the page.

    ``date_from`` / ``date_to`` are LOCAL dates and both **inclusive** — a reader asking for
    the 1st to the 30th means the whole of the 30th, and an exclusive end silently drops the
    last day of every month anyone ever types.

    Ordered by the hour the session was for, not by when it was booked: this is a history of
    a desk's days, and a session booked a fortnight in advance belongs where it was held.
    """
    now = now or timezone.now()
    qs = (
        SupportBooking.objects.select_related(
            "availability",
            "availability__support_teacher",
            "student",
            "classroom",
            "settled_by",
            "invited_by",
        )
        .order_by("-availability__starts_at", "-id")
    )
    if teacher_id:
        qs = qs.filter(availability__support_teacher_id=teacher_id)
    if student_id:
        qs = qs.filter(student_id=student_id)
    if date_from is not None:
        qs = qs.filter(availability__starts_at__gte=_local_midnight(date_from))
    if date_to is not None:
        qs = qs.filter(
            availability__starts_at__lt=_local_midnight(date_to + timedelta(days=1))
        )
    if status:
        status = str(status).strip().upper()
        if status == STATUS_UNSETTLED:
            qs = qs.filter(
                status=SupportBooking.STATUS_BOOKED, availability__ends_at__lte=now
            )
        elif status in SESSION_STATUSES:
            qs = qs.filter(status=status)
        else:
            raise ValueError(
                "Unknown status. Use one of: " + ", ".join(HISTORY_STATUSES) + "."
            )

    limit = max(1, min(int(limit or DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE))
    offset = max(0, int(offset or 0))
    total = qs.count()
    rows = [session_row(b, now=now) for b in qs[offset: offset + limit]]
    return {
        "results": rows,
        "count": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < total,
    }


# ── 2. The month ──────────────────────────────────────────────────────────────

def attendance_rate(held: int, no_show: int) -> float | None:
    """``held / (held + no_show)``, or ``None`` when nobody was expected.

    The house rule, in the one place that can enforce it: a rate over an empty denominator is
    not zero. Zero means "they all missed it"; there is a real difference between a teacher
    whose students never turn up and a teacher who has not run a session yet, and a report
    that renders both as 0% is accusing the second of the first's problem.
    """
    settled = int(held) + int(no_show)
    if settled <= 0:
        return None
    return round(int(held) / settled, 4)


def _empty_counts() -> dict:
    return {
        "slots_published": 0,
        "bookings": 0,
        "held": 0,
        "no_show": 0,
        "cancelled": 0,
        "upcoming": 0,
        "unsettled": 0,
        "unsettled_oldest": None,
        "students_helped": 0,
        "students_booked": 0,
    }


def _oldest(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return min(a, b)


def monthly_summary(*, month: str | None = None, teacher_id=None, now=None) -> dict:
    """The month, per support teacher, plus a total row and the backlog banner.

    ``teacher_id`` narrows **everything** — the rows, the total and the backlog alike. A
    filtered page whose banner still showed the school's backlog would read as that one
    teacher's, which is exactly the misattribution this report exists to avoid.

    The five outcome counts (``held``, ``no_show``, ``cancelled``, ``upcoming``,
    ``unsettled``) partition ``bookings`` exactly, so a reader can check the row adds up.

    ``unsettled`` here is the month's share of the backlog. ``backlog`` at the top level, and
    ``backlog_unsettled`` / ``backlog_oldest`` on each row, are **all time** and do not move
    when the month does — a September page still has to be able to say the desk has bookings
    unsettled since August.
    """
    now = now or timezone.now()
    month = str(month or "").strip() or default_month(now=now)
    start, end = month_bounds(month)

    teacher_id = int(teacher_id) if teacher_id else None
    ids = support_teacher_ids()
    if teacher_id is not None:
        ids = {teacher_id}

    over = Q(availability__starts_at__gte=start, availability__starts_at__lt=end)
    settled_late = Q(status=SupportBooking.STATUS_BOOKED, availability__ends_at__lte=now)

    bookings = SupportBooking.objects.filter(over)
    slots = SupportAvailability.objects.filter(starts_at__gte=start, starts_at__lt=end)
    # All time, deliberately unbounded by the month. See the docstring.
    backlog_qs = SupportBooking.objects.filter(settled_late)
    if teacher_id is not None:
        bookings = bookings.filter(availability__support_teacher_id=teacher_id)
        slots = slots.filter(support_teacher_id=teacher_id)
        backlog_qs = backlog_qs.filter(availability__support_teacher_id=teacher_id)

    per: dict[int, dict] = {}

    def bucket(tid: int) -> dict:
        return per.setdefault(int(tid), _empty_counts())

    # A withdrawn hour was never on offer, so it is not a published slot. Rows minted by a
    # student booking an hour off the open calendar ARE counted: from the desk's point of
    # view that hour was available and somebody took it.
    for row in (
        slots.filter(is_cancelled=False)
        .values("support_teacher_id")
        .annotate(n=Count("id"))
    ):
        bucket(row["support_teacher_id"])["slots_published"] = row["n"]

    for row in bookings.values("availability__support_teacher_id").annotate(
        total=Count("id"),
        held=Count("id", filter=Q(status=SupportBooking.STATUS_HELD)),
        no_show=Count("id", filter=Q(status=SupportBooking.STATUS_NO_SHOW)),
        cancelled=Count("id", filter=Q(status=SupportBooking.STATUS_CANCELLED)),
        unsettled=Count("id", filter=settled_late),
        upcoming=Count(
            "id",
            filter=Q(status=SupportBooking.STATUS_BOOKED, availability__ends_at__gt=now),
        ),
        oldest_unsettled=Min("availability__starts_at", filter=settled_late),
        students_booked=Count("student_id", distinct=True),
        students_helped=Count(
            "student_id", distinct=True, filter=Q(status=SupportBooking.STATUS_HELD)
        ),
    ):
        entry = bucket(row["availability__support_teacher_id"])
        entry.update(
            bookings=row["total"],
            held=row["held"],
            no_show=row["no_show"],
            cancelled=row["cancelled"],
            unsettled=row["unsettled"],
            upcoming=row["upcoming"],
            unsettled_oldest=row["oldest_unsettled"],
            students_booked=row["students_booked"],
            students_helped=row["students_helped"],
        )

    backlog_by_teacher: dict[int, dict] = {}
    for row in backlog_qs.values("availability__support_teacher_id").annotate(
        n=Count("id"), oldest=Min("availability__starts_at")
    ):
        backlog_by_teacher[int(row["availability__support_teacher_id"])] = {
            "unsettled": row["n"],
            "oldest": row["oldest"],
        }

    ids |= set(per) | set(backlog_by_teacher)
    names = _people(ids)

    rows: list[dict] = []
    for tid in sorted(ids, key=lambda i: (names.get(i, "").lower(), i)):
        counts = per.get(tid, _empty_counts())
        back = backlog_by_teacher.get(tid, {"unsettled": 0, "oldest": None})
        rows.append({
            "support_teacher_id": tid,
            "support_teacher": names.get(tid, "Support teacher"),
            **counts,
            "attendance_rate": attendance_rate(counts["held"], counts["no_show"]),
            "backlog_unsettled": back["unsettled"],
            "backlog_oldest": back["oldest"],
        })

    total = _empty_counts()
    for row in rows:
        for field in (
            "slots_published", "bookings", "held", "no_show",
            "cancelled", "upcoming", "unsettled",
        ):
            total[field] += row[field]
        total["unsettled_oldest"] = _oldest(total["unsettled_oldest"], row["unsettled_oldest"])
    # Distinct heads, counted once school-wide rather than summed across teachers: a student
    # who saw two support teachers this month is one student helped, not two. Summing the
    # per-teacher figures is the mean-of-means mistake one column over.
    total["students_booked"] = bookings.values("student_id").distinct().count()
    total["students_helped"] = (
        bookings.filter(status=SupportBooking.STATUS_HELD)
        .values("student_id")
        .distinct()
        .count()
    )
    total["attendance_rate"] = attendance_rate(total["held"], total["no_show"])

    backlog_total = sum(b["unsettled"] for b in backlog_by_teacher.values())
    backlog_oldest = None
    for b in backlog_by_teacher.values():
        backlog_oldest = _oldest(backlog_oldest, b["oldest"])

    return {
        "month": month,
        "months": available_months(now=now),
        "generated_at": now,
        "teacher_id": teacher_id,
        "teachers": rows,
        "total": total,
        # The banner. All time, so it cannot be paged away, and never a bare count: a reader
        # who sees "32 unsettled" without "oldest 13 August" does not know it is a backlog
        # rather than this afternoon's paperwork.
        "backlog": {
            "unsettled": backlog_total,
            "oldest": backlog_oldest,
            "teachers": sorted(
                (
                    {
                        "support_teacher_id": tid,
                        "support_teacher": names.get(tid, "Support teacher"),
                        "unsettled": b["unsettled"],
                        "oldest": b["oldest"],
                    }
                    for tid, b in backlog_by_teacher.items()
                ),
                key=lambda r: (-r["unsettled"], r["support_teacher"].lower()),
            ),
        },
        "status_labels": STATUS_LABELS,
    }
