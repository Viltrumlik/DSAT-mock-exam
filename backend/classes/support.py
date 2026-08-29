"""Support-booking rules.

The one rule the school stated: **a student may only book a support teacher assigned to a
classroom that student is in.** Everything here exists to make that true and to keep it true
when someone leaves a class.

Eligibility is computed from live membership on every call rather than snapshotted onto the
booking. A student removed from a class stops being able to book its support teachers
immediately, which is the point — a snapshot would keep the door open until someone noticed.
"""

from __future__ import annotations

import logging
from datetime import datetime, time as dt_time, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from access import constants as acc_const
from access.services import normalized_role
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone

from .models import Classroom, ClassroomMembership
from .models_support import SupportAvailability, SupportBooking

logger = logging.getLogger(__name__)

#: The support desk keeps school hours: bookable on the hour from 08:00, last session
#: starting at 17:00 and ending as the desk closes at 18:00, four days out including today.
#:
#: Every hour in that window is open **by default**. Before this, a support teacher had to
#: publish each slot by hand, so a student whose teacher had published nothing saw an empty
#: page and concluded there was no help to be had — which was never true. A published row now
#: means one of two exceptions to the default: a larger group (``capacity``), or an hour the
#: teacher has withdrawn (``is_cancelled``). Absence of a row means simply "free".
CALENDAR_DAYS = 4
CALENDAR_OPEN_HOUR = 8
CALENDAR_CLOSE_HOUR = 18
SLOT_MINUTES = 60

#: How many hours one student may hold at once.
#:
#: It exists because the desk is a shared, finite thing: every seat one student holds is an
#: hour another cannot book, and an unlimited calendar rewards whoever clicks first rather
#: than whoever needs it. MAX_UPCOMING stops a student sitting on the whole week.
#:
#: There used to be a third limit here, MAX_BOOKINGS_PER_WEEK = 3, counted over a rolling
#: seven days on ``booked_at``. **The school withdrew it.** It was never their number — it
#: was proposed with the rest of Support v2 and carried forward unchallenged — and it turned
#: out to be the wrong shape of rule: it charged a student for a session they had already
#: attended, so a student who used the desk properly on Monday, Tuesday and Wednesday was
#: locked out for the rest of the week even though they were holding nothing. The two limits
#: that remain are about what a student is HOLDING (upcoming) and about one afternoon
#: (per-day); neither punishes a student for having turned up.
#:
#: The number is the school's to set; it is named here so changing it is one edit and the UI
#: reads it off the API rather than hard-coding a second copy.
MAX_UPCOMING_BOOKINGS = 2

#: How many hours one student may hold on any single day. The school's rule: one.
#:
#: Counted on the DAY THE SESSION FALLS, not on when it was booked. "You can book support
#: once a day" is a statement about the desk's day, not about the student's clicking: a
#: student who books Monday and Tuesday in one sitting has used two different days and has
#: broken no rule, while one who takes 10:00 and 11:00 on Thursday has taken two hours out of
#: one afternoon, which is the thing being prevented. Counting by ``booked_at`` — the way the
#: withdrawn weekly cap counted — would get both of those backwards.
#:
#: It is the tighter of the two limits and therefore the one students will actually meet,
#: so the calendar greys out a whole day once one hour on it is taken, rather than letting
#: them pick a second and refusing it.
MAX_BOOKINGS_PER_DAY = 1


def _active_student_classroom_ids(student):
    """Classrooms this student is in, for the purpose of "may they book support here".

    ``NON_REMOVED_STATUSES``, not ``STATUS_ACTIVE`` alone. This was the odd one out: the rule
    stated on ``ClassroomMembership`` is that any query deciding whether a user may see or
    enter a classroom excludes REMOVED and nothing else, and every other sweep in this
    codebase follows it — ``notify_homework_due_soon`` even spells out why ("An INVITED student
    sees the assignment, so they are owed the reminder").

    So an INVITED student was shown their class, given its homework, and reminded about its
    deadlines, but the support page told them they had no support teacher. Zero accounts are
    in that state on production right now, which is the only reason this never surfaced as a
    report; it is corrected here rather than left as a trap for the first one that is.
    """
    return ClassroomMembership.objects.filter(
        user=student,
        role=ClassroomMembership.ROLE_STUDENT,
        status__in=ClassroomMembership.NON_REMOVED_STATUSES,
    ).values_list("classroom_id", flat=True)


#: A classroom TA membership alone does not make a support desk — the account has to be a
#: support teacher too. There are two doors onto ROLE_TA and only one of them checks:
#: ``SupportTeacherAssignView`` requires ``role == ROLE_SUPPORT_TEACHER``, while the roster's
#: "Make TA" button (``views_roster.MemberManageView``) lets an owner promote any member.
#:
#: That was harmless while slots had to be published: a plain student or teacher holding a TA
#: membership could never publish one, so they never appeared. Opt-out hours changed that —
#: they would be advertised as bookable 08:00–18:00 without lifting a finger, and every
#: endpoint that would let them see or withdraw those hours 403s on the same account role.
#: Students would book a desk nobody is going to attend.
SUPPORT_ACCOUNT_ROLE = acc_const.ROLE_SUPPORT_TEACHER


def _support_classroom_ids(support_teacher):
    if normalized_role(support_teacher) != SUPPORT_ACCOUNT_ROLE:
        return ClassroomMembership.objects.none().values_list("classroom_id", flat=True)
    return ClassroomMembership.objects.filter(
        user=support_teacher,
        role=ClassroomMembership.ROLE_TA,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).values_list("classroom_id", flat=True)


def shared_classrooms(student, support_teacher):
    """Classrooms where this student is taught and this support teacher is assigned."""
    return Classroom.objects.filter(
        id__in=set(_active_student_classroom_ids(student))
        & set(_support_classroom_ids(support_teacher))
    )


def bookable_support_teacher_ids(student) -> set[int]:
    """Support teachers the student is entitled to book — i.e. assigned to one of their
    classrooms. An empty set is the correct answer for a student in no classes."""
    classroom_ids = list(_active_student_classroom_ids(student))
    if not classroom_ids:
        return set()
    return set(
        ClassroomMembership.objects.filter(
            classroom_id__in=classroom_ids,
            role=ClassroomMembership.ROLE_TA,
            status=ClassroomMembership.STATUS_ACTIVE,
            # See SUPPORT_ACCOUNT_ROLE: the membership and the account must agree.
            user__role=SUPPORT_ACCOUNT_ROLE,
        ).values_list("user_id", flat=True)
    )


def open_slots_for(student, *, now=None):
    """Future, uncancelled slots the student may actually book.

    Seats are deliberately NOT filtered here — a full slot still belongs on the student's
    screen, shown as full. Hiding it makes a slot the student can see on Monday vanish on
    Tuesday with no explanation.
    """
    now = now or timezone.now()
    teacher_ids = bookable_support_teacher_ids(student)
    if not teacher_ids:
        return SupportAvailability.objects.none()
    return (
        SupportAvailability.objects.filter(
            support_teacher_id__in=teacher_ids,
            is_cancelled=False,
            starts_at__gt=now,
        )
        .select_related("support_teacher")
        .order_by("starts_at", "id")
    )


def booking_allowance(student, *, now=None, exclude_booking_id=None) -> dict:
    """How much of their allowance this student has left, and why.

    Returned rather than raised so the calendar can say "1 of 2 left" before the student
    picks an hour, instead of letting them choose one and then refusing it.

    A CANCELLED booking counts towards neither limit. Giving a seat back is the behaviour the
    limits are trying to encourage, so charging for it would punish exactly the student who
    did the right thing. ``exclude_booking_id`` lets the booking path ignore the row it is
    about to reuse — re-booking a slot updates the existing row, and counting it would make
    the student's own cancelled seat block them.
    """
    now = now or timezone.now()
    mine = SupportBooking.objects.filter(student=student).exclude(
        status=SupportBooking.STATUS_CANCELLED
    )
    if exclude_booking_id is not None:
        mine = mine.exclude(pk=exclude_booking_id)

    upcoming = mine.filter(
        status=SupportBooking.STATUS_BOOKED, availability__starts_at__gt=now
    ).count()

    # The local dates this student already has a session on, across the calendar window and
    # a little either side. Read in the school's timezone because MAX_BOOKINGS_PER_DAY is
    # about a calendar day as a person experiences it, not about a UTC one.
    #
    # Scoped to the window the calendar can show rather than to all of history: the answer is
    # for greying out days on screen, and a student with a year of sessions behind them
    # should not have that whole year serialised into every calendar response.
    horizon_start = _hour_start(calendar_dates(now)[0], 0)
    horizon_end = horizon_start + timedelta(days=CALENDAR_DAYS + 1)
    taken_days = sorted({
        timezone.localdate(starts_at)
        for starts_at in mine.filter(
            availability__starts_at__gte=horizon_start,
            availability__starts_at__lt=horizon_end,
        ).values_list("availability__starts_at", flat=True)
    })
    return {
        "upcoming": upcoming,
        "max_upcoming": MAX_UPCOMING_BOOKINGS,
        "max_per_day": MAX_BOOKINGS_PER_DAY,
        # ISO dates, because this crosses the API and a `date` would be serialised
        # inconsistently by the two paths that read it.
        "taken_days": [d.isoformat() for d in taken_days],
        # ``can_book`` answers only the standing question — "may this student book at all
        # right now". The per-day limit is deliberately NOT folded in: it is about a
        # particular day, and a student at their day's limit on Tuesday can still book
        # Wednesday. ``taken_days`` is what greys the days out.
        "can_book": upcoming < MAX_UPCOMING_BOOKINGS,
    }


def bookings_on_day(student, day, *, exclude_booking_id=None) -> int:
    """How many live sessions this student holds on one local date.

    Its own query rather than a read of ``booking_allowance``'s ``taken_days``: that list is
    bounded by the calendar horizon so the API response stays small, and the check that
    actually refuses a booking must not be bounded by anything.
    """
    mine = SupportBooking.objects.filter(student=student).exclude(
        status=SupportBooking.STATUS_CANCELLED
    )
    if exclude_booking_id is not None:
        mine = mine.exclude(pk=exclude_booking_id)
    day_start = _hour_start(day, 0)
    return mine.filter(
        availability__starts_at__gte=day_start,
        availability__starts_at__lt=day_start + timedelta(days=1),
    ).count()


def _check_booking_allowance(student, *, now=None, exclude_booking_id=None, for_date=None) -> None:
    """Raise a student-readable ValidationError when they are at a limit.

    ``for_date`` is the LOCAL date of the hour being claimed. Passing it adds the per-day
    check; leaving it out asks only the standing questions, which is what a caller with no
    particular slot in hand (a UI asking "can this student book at all") wants.
    """
    allowance = booking_allowance(
        student, now=now, exclude_booking_id=exclude_booking_id
    )
    # Checked first, and deliberately: it is the tightest limit, so it is the one a student
    # will actually hit, and being told "you already have a session that day" is a more
    # useful sentence than being told about a weekly total they are nowhere near.
    if for_date is not None and bookings_on_day(
        student, for_date, exclude_booking_id=exclude_booking_id
    ) >= MAX_BOOKINGS_PER_DAY:
        raise ValidationError(
            "You already have a support session that day. You can book one session a day — "
            "pick another day, or cancel the one you have."
        )
    if allowance["upcoming"] >= MAX_UPCOMING_BOOKINGS:
        raise ValidationError(
            f"You already have {allowance['upcoming']} support "
            f"session{'' if allowance['upcoming'] == 1 else 's'} booked. Attend one, or "
            f"cancel it, and you can book again."
        )


def calendar_dates(now=None, *, days: int = CALENDAR_DAYS) -> list:
    """The dates the calendar covers — today first, in the school's own timezone."""
    today = timezone.localdate(now or timezone.now())
    return [today + timedelta(days=i) for i in range(days)]


def _hour_start(day, hour: int):
    """An aware datetime for ``hour`` o'clock on ``day``, read in the school's timezone."""
    return timezone.make_aware(
        datetime.combine(day, dt_time(hour=hour)), timezone.get_current_timezone()
    )


# ── The standing weekly schedule ──────────────────────────────────────────────
#
# ``SupportWorkingHours`` is the rule; ``SupportAvailability`` is the dated exception. The two
# compose in ONE direction — the schedule can close an hour the exception would open, never
# the reverse. See the model docstring for why.


def weekly_hours_for(support_teacher) -> dict[int, tuple[bool, int, int]]:
    """``{weekday: (is_working, start_hour, end_hour)}`` for one teacher.

    An EMPTY dict is meaningful and is not the same as a dict of closed days: it means this
    teacher has never been configured, and :func:`_within_working_hours` reads it as the old
    open-all-week default so that shipping this does not empty every calendar in the school.
    """
    from .models_support import SupportWorkingHours

    return {
        int(row.weekday): (bool(row.is_working), int(row.start_hour), int(row.end_hour))
        for row in SupportWorkingHours.objects.filter(support_teacher=support_teacher)
    }


def weekly_hours_for_many(teacher_ids) -> dict[int, dict[int, tuple[bool, int, int]]]:
    """:func:`weekly_hours_for` for a whole calendar in one query rather than one per teacher.

    The student calendar renders every support teacher they may book across four days and ten
    hours; asking per teacher would put an N+1 on the page's hottest loop.

    Teachers with no rows are absent from the result, which the per-hour check then reads as
    "never configured" — the same meaning an empty dict carries above.
    """
    from .models_support import SupportWorkingHours

    out: dict[int, dict[int, tuple[bool, int, int]]] = {}
    for row in SupportWorkingHours.objects.filter(support_teacher_id__in=list(teacher_ids)):
        out.setdefault(int(row.support_teacher_id), {})[int(row.weekday)] = (
            bool(row.is_working), int(row.start_hour), int(row.end_hour)
        )
    return out


def read_weekly_schedule(support_teacher) -> tuple[list[dict], bool]:
    """All seven days, always — for the admin form to render. ``(days, configured)``.

    A teacher who has never been configured comes back as seven working days at the platform
    default, which is what their calendar *actually does* today. Returning three configured
    rows and leaving the form to invent the other four is how an admin ends up saving a
    schedule they never looked at.

    ``configured`` is carried so the UI can say "these are the defaults, nobody has set this
    yet" rather than implying a decision somebody made.
    """
    from .models_support import SupportWorkingHours

    stored = weekly_hours_for(support_teacher)
    configured = bool(stored)
    out = []
    for weekday, label in SupportWorkingHours.WEEKDAY_CHOICES:
        is_working, start_hour, end_hour = stored.get(
            weekday, (True, CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR)
        )
        out.append({
            "weekday": weekday,
            "label": label,
            # An unconfigured teacher is open by default; a configured one with no row for
            # this day is not working. Mirrors `_within_working_hours` exactly — the form has
            # to show the same answer the booking calendar will give.
            "is_working": is_working if (not configured or weekday in stored) else False,
            "start_hour": start_hour,
            "end_hour": end_hour,
        })
    return out, configured


@transaction.atomic
def write_weekly_schedule(support_teacher, days) -> list[dict]:
    """Replace a support teacher's standing schedule. All seven days in one save.

    Whole-week replacement rather than per-day PATCH, because the two halves of this rule are
    not independent: "Tuesday is off" and "no row for Tuesday" have to mean the same thing, and
    a per-day endpoint invites exactly the partial state
    :func:`_within_working_hours` has to fail closed on.

    Validation is strict about the one thing that cannot be recovered from — an end at or
    before the start would store a day that is silently never bookable — and lenient about
    hours outside the desk's own 08:00–18:00 window, which are simply clamped. A school that
    later opens at 07:00 changes two constants, and a schedule saved today should not have to
    be re-entered when they do.
    """
    from .models_support import SupportWorkingHours

    by_weekday = {}
    for raw in days or []:
        try:
            weekday = int(raw.get("weekday"))
        except (TypeError, ValueError):
            raise ValidationError("Each day needs a weekday from 0 (Monday) to 6 (Sunday).")
        if not (0 <= weekday <= 6):
            raise ValidationError("Weekday must be 0 (Monday) to 6 (Sunday).")

        is_working = bool(raw.get("is_working", True))
        try:
            start_hour = int(raw.get("start_hour", CALENDAR_OPEN_HOUR))
            end_hour = int(raw.get("end_hour", CALENDAR_CLOSE_HOUR))
        except (TypeError, ValueError):
            raise ValidationError("Working hours must be whole hours.")

        start_hour = max(0, min(23, start_hour))
        end_hour = max(1, min(24, end_hour))
        if end_hour <= start_hour:
            label = dict(SupportWorkingHours.WEEKDAY_CHOICES)[weekday]
            raise ValidationError(f"{label}: the finish time must be after the start time.")
        by_weekday[weekday] = (is_working, start_hour, end_hour)

    if not by_weekday:
        raise ValidationError("A schedule needs at least one day.")

    for weekday, (is_working, start_hour, end_hour) in by_weekday.items():
        SupportWorkingHours.objects.update_or_create(
            support_teacher=support_teacher,
            weekday=weekday,
            defaults={
                "is_working": is_working,
                "start_hour": start_hour,
                "end_hour": end_hour,
            },
        )
    # Days the caller did not mention are removed rather than left behind. Leaving them would
    # make a shortened week keep hours from a schedule the teacher has replaced.
    SupportWorkingHours.objects.filter(support_teacher=support_teacher).exclude(
        weekday__in=by_weekday.keys()
    ).delete()

    return read_weekly_schedule(support_teacher)[0]


def bookings_outside_schedule(support_teacher, *, now=None):
    """Live bookings this teacher holds at hours their standing schedule no longer covers.

    Narrowing a week does not cancel anything — see the note in ``SupportWorkingHoursView.put``
    for why that is the admin's call and not a side effect. This is what lets the console
    *show* them the appointments they have just scheduled around, which is the difference
    between a quiet data problem and a decision somebody gets to make.

    Future bookings only. A session that already happened at an hour the teacher has since
    stopped working is not a clash, it is history.
    """
    now = now or timezone.now()
    schedule = weekly_hours_for(support_teacher)
    if not schedule:
        return []
    rows = (
        SupportBooking.objects.filter(
            availability__support_teacher=support_teacher,
            status=SupportBooking.STATUS_BOOKED,
            availability__starts_at__gt=now,
        )
        .select_related("availability", "student")
        .order_by("availability__starts_at")
    )
    out = []
    for booking in rows:
        local = timezone.localtime(booking.availability.starts_at)
        if not _within_working_hours(schedule, local.date(), local.hour):
            out.append(booking)
    return out


def _within_working_hours(schedule: dict, day, hour: int) -> bool:
    """Is ``hour`` on ``day`` inside this teacher's standing schedule?

    ``schedule`` is one teacher's ``{weekday: (is_working, start, end)}``.

    Two defaults, and they point in opposite directions on purpose:

    * **No schedule at all → open.** Nobody has configured this teacher, so behave exactly as
      the platform did before schedules existed. Failing closed here would take every support
      teacher off the calendar on deploy day.
    * **A schedule that omits this weekday → closed.** Once a teacher has been configured, an
      absent day is a day they did not choose. Failing open there would put students in front
      of an empty desk, which is the failure that actually costs somebody their afternoon.
    """
    if not schedule:
        return True
    entry = schedule.get(day.weekday())
    if entry is None:
        return False
    is_working, start_hour, end_hour = entry
    return bool(is_working) and start_hour <= hour < end_hour


def _row_covering(candidates, hour_start, hour_end):
    """The published row that governs one hour of the calendar, if any.

    **Overlap, not equality.** Keying on the exact hour instant was wrong: the teacher's form
    takes free-form start/end datetimes, so a 14:00–17:00 block only ever matched its first
    hour. Withdrawing that block left 15:00 and 16:00 reading "open" and bookable — a student
    could take a seat inside the block their teacher had just closed. Off-the-hour rows
    (09:30–10:30) matched nothing at all and were invisible.

    A withdrawal wins over a publication: if any part of the hour is blocked, the hour is not
    free.

    Among publications, **the most recently touched one governs**. Ordering by earliest start
    instead was a regression this same overlap change introduced: the write path keys on the
    exact ``starts_at``, so a teacher who published 14:00–17:00 and then narrowed 15:00–16:00
    got a second row that no hour ever consulted — the older, wider block kept winning and the
    edit read as a silent no-op.

    ``updated_at``, not ``created_at`` or ``id``: republishing an hour updates the row in
    place, so creation order stops tracking what the teacher last said. ``id`` breaks the tie
    for two rows saved in the same tick, which keeps the answer a total order.
    """
    hits = [r for r in candidates if r.starts_at < hour_end and r.ends_at > hour_start]
    if not hits:
        return None
    blocked = [r for r in hits if r.is_cancelled]
    return max(blocked or hits, key=lambda r: (r.updated_at, r.id))


def open_calendar_for(student, *, now=None, days: int = CALENDAR_DAYS) -> list[dict]:
    """The bookable week ahead, one entry per support teacher the student may book.

    Every hour of the window is reported, including the ones that cannot be booked — an hour
    that is full or withdrawn is a fact the student needs, and silently dropping it makes the
    calendar look sparse for no stated reason.
    """
    now = now or timezone.now()
    teacher_ids = bookable_support_teacher_ids(student)
    if not teacher_ids:
        return []

    dates = calendar_dates(now, days=days)
    window_start = _hour_start(dates[0], CALENDAR_OPEN_HOUR)
    window_end = _hour_start(dates[-1], CALENDAR_CLOSE_HOUR)

    # Rows that OVERLAP the window, not just ones that start inside it — a block running from
    # before the window into it still governs the hours it covers.
    rows = list(
        SupportAvailability.objects.filter(
            support_teacher_id__in=teacher_ids,
            starts_at__lt=window_end,
            ends_at__gt=window_start,
        )
    )
    by_teacher: dict[int, list] = {}
    for r in rows:
        by_teacher.setdefault(r.support_teacher_id, []).append(r)
    row_ids = [r.id for r in rows]
    taken = dict(
        SupportBooking.objects.filter(
            availability_id__in=row_ids, status__in=SupportBooking.OCCUPYING_STATUSES
        )
        .values("availability_id")
        .annotate(n=Count("id"))
        .values_list("availability_id", "n")
    )
    mine = dict(
        SupportBooking.objects.filter(
            availability_id__in=row_ids, student=student, status=SupportBooking.STATUS_BOOKED
        ).values_list("availability_id", "id")
    )

    schedules = weekly_hours_for_many(teacher_ids)

    # Days this student has already spent, across EVERY support teacher — the per-day limit
    # is a property of the student's day, not of one teacher's column, so it has to be
    # resolved once here rather than inside the per-teacher loop.
    taken_days = {
        timezone.localdate(starts_at)
        for starts_at in SupportBooking.objects.filter(student=student)
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .filter(availability__starts_at__gte=window_start - timedelta(hours=CALENDAR_OPEN_HOUR),
                availability__starts_at__lt=window_end + timedelta(days=1))
        .values_list("availability__starts_at", flat=True)
    }

    teachers = get_user_model().objects.filter(id__in=teacher_ids).order_by("first_name", "id")
    out = []
    for teacher in teachers:
        candidates = by_teacher.get(teacher.id, [])
        schedule = schedules.get(teacher.id, {})
        days_out = []
        for day in dates:
            hours = []
            for hour in range(CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR):
                starts_at = _hour_start(day, hour)
                ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
                row = _row_covering(candidates, starts_at, ends_at)
                capacity = int(row.capacity) if row else 1
                seats_left = max(0, capacity - taken.get(row.id, 0)) if row else capacity
                booking_id = mine.get(row.id) if row else None
                working = _within_working_hours(schedule, day, hour)

                if booking_id is not None:
                    # Ahead of the schedule check on purpose: a teacher who narrows their
                    # hours after a student booked must not make that student's confirmed
                    # appointment disappear from their own calendar with no explanation.
                    # Their booking stands until somebody cancels it deliberately.
                    state = "mine"
                elif starts_at <= now:
                    state = "past"
                elif day in taken_days:
                    # One session a day (MAX_BOOKINGS_PER_DAY). Ranked above the teacher-side
                    # states on purpose: the student cannot book ANY hour that day, and a day
                    # rendered as a mixture of "he's not in" and "full" hides the one reason
                    # that actually applies to them. The hour they do hold still shows as
                    # "mine", so the day says plainly where their session is and why the rest
                    # of it is shut.
                    state = "day_taken"
                elif not working:
                    # Outside the standing schedule. Distinct from "closed": nobody withdrew
                    # this hour, it was never a working hour, and the student is owed that
                    # difference — one reads as "he cancelled", the other as "he's not in".
                    state = "off"
                elif row is not None and row.is_cancelled:
                    state = "closed"
                elif seats_left <= 0:
                    state = "full"
                else:
                    state = "open"

                hours.append({
                    "starts_at": starts_at,
                    "ends_at": ends_at,
                    "state": state,
                    "capacity": capacity,
                    "seats_left": seats_left,
                    "note": row.note if row else "",
                    "availability_id": row.id if row else None,
                    "booking_id": booking_id,
                })
            days_out.append({"date": day, "hours": hours})
        out.append({
            "teacher": teacher,
            "classrooms": list(shared_classrooms(student, teacher)),
            "days": days_out,
        })
    return out


def teacher_calendar_for(support_teacher, *, now=None, days: int = CALENDAR_DAYS) -> list[dict]:
    """The same week the students see, from behind the desk.

    The teacher's job on this calendar is not "publish hours" — every hour is open by
    default — it is to see who is coming and to withdraw the hours they cannot do. So each
    hour carries its bookings, not just a seat count, and ``state`` names what the teacher
    needs to act on: ``booked`` outranks ``open`` because a booked hour is an appointment,
    and ``closed`` outranks everything because a withdrawn hour is a decision they made.
    """
    now = now or timezone.now()
    dates = calendar_dates(now, days=days)
    window_start = _hour_start(dates[0], CALENDAR_OPEN_HOUR)
    window_end = _hour_start(dates[-1], CALENDAR_CLOSE_HOUR)

    rows = list(
        SupportAvailability.objects.filter(
            support_teacher=support_teacher,
            starts_at__lt=window_end,
            ends_at__gt=window_start,
        )
    )
    bookings_by_row: dict[int, list] = {}
    for b in (
        SupportBooking.objects.filter(availability_id__in=[r.id for r in rows])
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .select_related("student", "classroom")
        .order_by("id")
    ):
        bookings_by_row.setdefault(b.availability_id, []).append(b)

    schedule = weekly_hours_for(support_teacher)

    out = []
    for day in dates:
        hours = []
        for hour in range(CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR):
            starts_at = _hour_start(day, hour)
            ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
            row = _row_covering(rows, starts_at, ends_at)
            capacity = int(row.capacity) if row else 1
            booked = [
                b for b in bookings_by_row.get(row.id, [])
                if b.status == SupportBooking.STATUS_BOOKED
            ] if row else []
            settled = [
                b for b in bookings_by_row.get(row.id, [])
                if b.status != SupportBooking.STATUS_BOOKED
            ] if row else []
            working = _within_working_hours(schedule, day, hour)

            if row is not None and row.is_cancelled:
                state = "closed"
            elif booked or settled:
                # Ahead of "off", though not of "closed" — the existing precedence is left
                # exactly as it was. What matters here is that an appointment made before a
                # schedule change stays visible to the person who has to keep it; ranking
                # "off" above it would drop a real booking off the teacher's own day.
                state = "booked"
            elif not working:
                state = "off"
            elif starts_at <= now:
                state = "past"
            else:
                state = "open"

            hours.append({
                "starts_at": starts_at,
                "ends_at": ends_at,
                "state": state,
                "capacity": capacity,
                "seats_left": max(0, capacity - len(booked)),
                "note": row.note if row else "",
                "availability_id": row.id if row else None,
                "bookings": booked + settled,
            })
        out.append({"date": day, "hours": hours})
    return out


def slot_for(support_teacher, starts_at, *, now=None, days: int = CALENDAR_DAYS):
    """Turn an open hour on the calendar into a real row, so a booking has something to hold.

    The window is re-checked here rather than trusted from the client: the calendar the
    student is looking at may have been rendered yesterday, and the hour they are clicking may
    since have fallen out of the window or into the past.
    """
    now = now or timezone.now()
    local = timezone.localtime(starts_at)
    if local.minute or local.second or local.microsecond:
        raise ValidationError("Support sessions start on the hour.")
    if not (CALENDAR_OPEN_HOUR <= local.hour < CALENDAR_CLOSE_HOUR):
        raise ValidationError(
            f"The support desk is open {CALENDAR_OPEN_HOUR:02d}:00–{CALENDAR_CLOSE_HOUR:02d}:00."
        )
    allowed = calendar_dates(now, days=days)
    if local.date() not in allowed:
        raise ValidationError(f"You can book up to {days} days ahead.")
    # The docstring above promised this and the code did not do it: a student who left the
    # page open across an hour boundary could click 09:00 at 09:05 and mint a row for an hour
    # already gone, which ``book`` would then refuse.
    if starts_at <= now:
        raise ValidationError("That hour has already started.")

    # The standing schedule is enforced HERE, not only painted on the calendar. Rendering an
    # hour as "off" and still accepting a POST for it would make the schedule advisory, and
    # this endpoint takes a teacher id and a timestamp straight from the client — a stale tab
    # is enough to reach an hour that stopped being a working hour this morning.
    if not _within_working_hours(weekly_hours_for(support_teacher), local.date(), local.hour):
        raise ValidationError("That support teacher does not work at that time.")

    ends_at = starts_at + timedelta(minutes=SLOT_MINUTES)
    # An hour already governed by a published block belongs to that block — including a block
    # the teacher withdrew. Minting a fresh row here would hand the student a seat inside a
    # closed afternoon, because a new row is never cancelled.
    existing = _row_covering(
        SupportAvailability.objects.filter(
            support_teacher=support_teacher, starts_at__lt=ends_at, ends_at__gt=starts_at
        ),
        starts_at,
        ends_at,
    )
    if existing is not None:
        return existing

    slot, _ = SupportAvailability.objects.get_or_create(
        support_teacher=support_teacher,
        starts_at=starts_at,
        defaults={"ends_at": ends_at, "capacity": 1},
    )
    return slot


@transaction.atomic
def book_at(student, support_teacher, starts_at, *, classroom=None, topic: str = "", now=None):
    """Book an hour off the calendar, materialising its row only if the booking sticks.

    One transaction on purpose. ``slot_for`` used to run outside it, so every refused
    booking — wrong class, slot full, already settled — left behind an availability row the
    teacher never published and cannot see.
    """
    slot = slot_for(support_teacher, starts_at, now=now)
    return book(student, slot, classroom=classroom, topic=topic, now=now)


@transaction.atomic
def book(student, availability, *, classroom=None, topic: str = "", now=None) -> SupportBooking:
    """Claim a seat. Raises ``ValidationError`` with a student-readable message."""
    now = now or timezone.now()

    # Re-read under a lock: two students clicking the last seat at once must not both win.
    availability = SupportAvailability.objects.select_for_update().get(pk=availability.pk)

    if availability.is_cancelled:
        raise ValidationError("That slot has been cancelled.")
    if availability.starts_at <= now:
        raise ValidationError("That slot has already started.")

    shared = shared_classrooms(student, availability.support_teacher)
    if not shared.exists():
        raise ValidationError(
            "You can only book a support teacher assigned to one of your classes."
        )
    if classroom is not None and classroom.id not in {c.id for c in shared}:
        raise ValidationError("That class is not one you share with this support teacher.")
    if classroom is None:
        # One shared class is the common case and needs no question; with several, the
        # booking is simply not attributed rather than guessing wrong.
        classroom = shared.first() if shared.count() == 1 else None

    existing = SupportBooking.objects.filter(
        availability=availability, student=student
    ).first()
    if existing is not None and existing.status == SupportBooking.STATUS_BOOKED:
        raise ValidationError("You have already booked that slot.")
    if existing is not None and existing.status in (
        SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW
    ):
        # A settled session is the teacher's record. Re-booking reuses the row, so allowing
        # it here would let a student erase a NO_SHOW — or overwrite a HELD and silently
        # revoke their own 10 points — by pressing Book again.
        raise ValidationError("That session has already been settled.")

    # After the entitlement checks and before the seat is taken. Checked here rather than in
    # the view so book() and book_at() cannot diverge, and so a management path gets the same
    # answer as a student clicking a chip.
    _check_booking_allowance(
        student,
        now=now,
        exclude_booking_id=existing.pk if existing else None,
        for_date=timezone.localdate(availability.starts_at),
    )

    taken = SupportBooking.objects.filter(
        availability=availability, status__in=SupportBooking.OCCUPYING_STATUSES
    ).count()
    if taken >= int(availability.capacity):
        raise ValidationError("That slot is full.")

    if existing is not None:
        # Re-booking after a cancellation reuses the row, so the reward key stays stable.
        existing.status = SupportBooking.STATUS_BOOKED
        existing.classroom = classroom
        existing.topic = topic or existing.topic
        existing.settled_at = None
        existing.settled_by = None
        # The previous cancellation is history the moment the seat is retaken. Leaving it
        # behind would show the teacher a live booking labelled with why it was called off.
        existing.cancel_reason = ""
        existing.cancelled_at = None
        existing.cancelled_by = None
        existing.save(update_fields=[
            "status", "classroom", "topic", "settled_at", "settled_by",
            "cancel_reason", "cancelled_at", "cancelled_by", "updated_at",
        ])
        return existing

    return SupportBooking.objects.create(
        availability=availability, student=student, classroom=classroom,
        topic=topic, status=SupportBooking.STATUS_BOOKED,
    )


def invitable_classmates(booking, *, limit: int = 200):
    """Who the holder of ``booking`` may add to it.

    Deliberately NARROW rather than a general roster endpoint. It answers exactly one
    question — "who can go in this seat?" — and it answers it with the same rule
    :func:`invite_member` enforces, so the picker cannot offer a name the invite would then
    refuse. Students who already hold a live seat on the slot are excluded for the same
    reason: offering them is offering a click that fails.

    A student may only see classmates of a class THEY are in that this support teacher also
    covers, which is the same set of names the classroom leaderboard already shows them.
    """
    availability = booking.availability
    teacher_class_ids = set(
        ClassroomMembership.objects.filter(
            user=availability.support_teacher,
            role=ClassroomMembership.ROLE_TA,
            status=ClassroomMembership.STATUS_ACTIVE,
        ).values_list("classroom_id", flat=True)
    )
    my_class_ids = set(_active_student_classroom_ids(booking.student))
    shared_ids = teacher_class_ids & my_class_ids
    if not shared_ids:
        return []

    already = set(
        SupportBooking.objects.filter(
            availability=availability, status__in=SupportBooking.OCCUPYING_STATUSES
        ).values_list("student_id", flat=True)
    )
    already.add(booking.student_id)

    User = get_user_model()
    return list(
        User.objects.filter(
            class_memberships__classroom_id__in=shared_ids,
            class_memberships__role=ClassroomMembership.ROLE_STUDENT,
            class_memberships__status=ClassroomMembership.STATUS_ACTIVE,
        )
        .exclude(pk__in=already)
        .distinct()
        .order_by("first_name", "last_name", "id")[:limit]
    )


@transaction.atomic
def invite_member(booking, invitee, *, actor=None, now=None) -> SupportBooking:
    """Bring a classmate into a support hour somebody has already booked.

    Returns the invitee's own ``SupportBooking``. They get a real seat with their own row,
    their own cancellation and their own rating — not a passenger on the inviter's booking.
    That matters at settle time: the teacher marks each student HELD or NO_SHOW separately,
    and the 10-point award is per student.

    **An invitation widens the hour by one seat.** A support hour is capacity 1 by default and
    only staff may change that, so an invite to a one-to-one has to either fail or make room.
    The school chose make-room: a student who wants to bring the classmate they are stuck on
    the same topic with should not have to ask an administrator first. The cost is real and is
    the reason ``invited_by`` is shown to the teacher — an hour they published as a
    one-to-one can grow, so it has to be obvious who did it and who they brought.

    **The invitee's per-day cap still applies.** It is about the invitee's own afternoon, and
    being pulled into a second hour on a day they already have one is precisely what the
    school asked to make impossible. The *upcoming* cap is not enforced, because it exists to
    stop one student sitting on the whole calendar, and a seat they did not ask for is not
    them hoarding. (A weekly cap was enforced here too until the school withdrew it — see
    MAX_UPCOMING_BOOKINGS.) The error names the invitee so the inviter can read it — they are
    the one looking at the screen, and "You already have a session that day" said about
    somebody else would be nonsense to them.
    """
    now = now or timezone.now()

    availability = SupportAvailability.objects.select_for_update().get(
        pk=booking.availability_id
    )
    booking = SupportBooking.objects.select_related("student").get(pk=booking.pk)

    if booking.status != SupportBooking.STATUS_BOOKED:
        raise ValidationError("You can only add someone to a booking that is still going ahead.")
    if availability.is_cancelled:
        raise ValidationError("That slot has been cancelled.")
    if availability.starts_at <= now:
        raise ValidationError("That session has already started.")
    if invitee.id == booking.student_id:
        raise ValidationError("You are already in this session.")

    # Same entitlement rule as booking it yourself. An invitation must not become a way to put
    # a student in front of a support teacher who does not teach them.
    shared = shared_classrooms(invitee, availability.support_teacher)
    if not shared.exists():
        raise ValidationError(
            f"{_display(invitee)} isn't in a class with this support teacher."
        )

    existing = SupportBooking.objects.filter(
        availability=availability, student=invitee
    ).first()
    if existing is not None and existing.status == SupportBooking.STATUS_BOOKED:
        raise ValidationError(f"{_display(invitee)} is already in this session.")
    if existing is not None and existing.status in (
        SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW
    ):
        raise ValidationError("That session has already been settled.")

    # The per-day cap, on the invitee's own day — see the docstring.
    if bookings_on_day(
        invitee,
        timezone.localdate(availability.starts_at),
        exclude_booking_id=existing.pk if existing else None,
    ) >= MAX_BOOKINGS_PER_DAY:
        raise ValidationError(
            f"{_display(invitee)} already has a support session that day."
        )

    taken = SupportBooking.objects.filter(
        availability=availability, status__in=SupportBooking.OCCUPYING_STATUSES
    ).count()
    if taken >= int(availability.capacity):
        # Make room rather than refuse. Locked above, so two simultaneous invites widen by
        # two seats rather than racing to widen by one.
        availability.capacity = taken + 1
        availability.save(update_fields=["capacity", "updated_at"])

    classroom = shared.first() if shared.count() == 1 else None

    if existing is not None:
        # A previously cancelled seat is reused, so the reward key stays stable.
        existing.status = SupportBooking.STATUS_BOOKED
        existing.classroom = classroom
        existing.topic = booking.topic
        existing.invited_by = booking.student
        existing.settled_at = None
        existing.settled_by = None
        existing.cancel_reason = ""
        existing.cancelled_at = None
        existing.cancelled_by = None
        existing.save(update_fields=[
            "status", "classroom", "topic", "invited_by", "settled_at", "settled_by",
            "cancel_reason", "cancelled_at", "cancelled_by", "updated_at",
        ])
        guest = existing
    else:
        guest = SupportBooking.objects.create(
            availability=availability, student=invitee, classroom=classroom,
            topic=booking.topic, status=SupportBooking.STATUS_BOOKED,
            invited_by=booking.student,
        )

    # Told after the seat exists, and never inside the lock's critical path: a notification
    # that fails must not undo a booking that succeeded. `notify` already swallows its own
    # errors; the email helper is queued on commit.
    transaction.on_commit(lambda: _announce_invitation(guest, booking.student))
    return guest


def _display(user) -> str:
    """A name to put in an error message a classmate will read."""
    full = (getattr(user, "get_full_name", lambda: "")() or "").strip()
    return full or (getattr(user, "username", "") or "").strip() or "That student"


def _announce_invitation(guest: SupportBooking, inviter) -> None:
    """Tell the invited student, in the bell and by email.

    Two channels because they answer different situations: a student who is on the site sees
    the bell immediately, and a student who is not gets an email about an hour that may be
    tomorrow. Neither is gated on the other, and a large share of this school signed up
    through Telegram and has no address at all — so the bell must never depend on the mailbox.
    """
    from notifications import constants as n_const
    from notifications.services import notify

    when = timezone.localtime(guest.availability.starts_at)
    teacher = _display(guest.availability.support_teacher)
    notify(
        guest.student,
        event=n_const.EVENT_SUPPORT_BOOKED,
        title=f"{_display(inviter)} added you to a support session",
        body=(
            f"{when.strftime('%a %d %b, %H:%M')} with {teacher}"
            + (f" — {guest.topic}" if guest.topic else "")
        ),
        link_url="/support",
        dedupe_key=f"support-invite:{guest.pk}",
    )
    try:
        from .mail_support import send_support_invitation_email

        send_support_invitation_email(guest, inviter)
    except Exception:  # pragma: no cover - mail must never break a booking
        logger.warning("support_invite_email_failed booking=%s", guest.pk)


@transaction.atomic
def cancel(booking, *, actor=None, reason: str = "", now=None) -> SupportBooking:
    """Give the seat back, on the record. Settled bookings are history and cannot be
    cancelled.

    ``reason`` is optional *here* on purpose: the view requires one from a student, but the
    slot-withdrawal path cancels other people's bookings on their behalf and supplies its
    own. A blank reason from a student would be a bug in the view, not in this function.
    """
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status in (SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW):
        raise ValidationError("That session has already been settled.")
    booking.status = SupportBooking.STATUS_CANCELLED
    booking.settled_at = None
    booking.cancel_reason = (reason or "").strip()[:280]
    booking.cancelled_at = now or timezone.now()
    booking.cancelled_by = actor
    booking.save(update_fields=[
        "status", "settled_at", "cancel_reason", "cancelled_at", "cancelled_by", "updated_at",
    ])
    return booking


@transaction.atomic
def settle(booking, status: str, *, actor=None, now=None, teacher_note: str = "") -> SupportBooking:
    """Record whether the session actually happened.

    ``HELD`` is what earns the student their points, which is why only the support teacher
    (or an admin) may set it — enforced by the view, since this function is also used by
    management paths.
    """
    if status not in (SupportBooking.STATUS_HELD, SupportBooking.STATUS_NO_SHOW):
        raise ValidationError("A session is settled as held or not attended.")
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status == SupportBooking.STATUS_CANCELLED:
        raise ValidationError("That booking was cancelled.")
    booking.status = status
    booking.settled_at = now or timezone.now()
    booking.settled_by = actor
    note = (teacher_note or "").strip()[:500]
    fields = ["status", "settled_at", "settled_by", "updated_at"]
    if note:
        # Only overwritten when something was typed: re-settling to fix a mis-click must not
        # silently wipe the note the teacher wrote the first time.
        booking.teacher_note = note
        fields.append("teacher_note")
    booking.save(update_fields=fields)
    return booking


@transaction.atomic
def rate(booking, rating: int, *, comment: str = "", now=None) -> SupportBooking:
    """The student's verdict on the hour they were given.

    Only a HELD session can be rated — there is nothing to judge about a session that was
    cancelled, missed, or has not happened yet. Re-rating overwrites, so a student who
    misclicks 1 is not stuck with it.

    This deliberately does not touch points. Settling as HELD is what pays, whatever the
    rating says; making the money depend on the review would put the teacher's interest
    against the student's honesty.
    """
    booking = SupportBooking.objects.select_for_update().get(pk=booking.pk)
    if booking.status != SupportBooking.STATUS_HELD:
        raise ValidationError("You can rate a session once your teacher marks it attended.")
    try:
        value = int(rating)
    except (TypeError, ValueError):
        raise ValidationError("Choose a rating from 1 to 5.") from None
    if not (SupportBooking.RATING_MIN <= value <= SupportBooking.RATING_MAX):
        raise ValidationError("Choose a rating from 1 to 5.")

    booking.rating = value
    booking.rating_comment = (comment or "").strip()[:500]
    booking.rated_at = now or timezone.now()
    booking.save(update_fields=["rating", "rating_comment", "rated_at", "updated_at"])
    return booking


def rating_summary(support_teacher) -> dict:
    """Average rating and count for one support teacher's settled sessions."""
    rated = SupportBooking.objects.filter(
        availability__support_teacher=support_teacher,
        status=SupportBooking.STATUS_HELD,
        rating__isnull=False,
    )
    stats = rated.aggregate(avg=Avg("rating"), n=Count("id"))
    return {
        "average": round(stats["avg"], 2) if stats["avg"] is not None else None,
        "count": stats["n"],
    }


def bookings_for_teacher(support_teacher, *, upcoming_only=False, now=None):
    """A support teacher's diary."""
    qs = (
        SupportBooking.objects.filter(availability__support_teacher=support_teacher)
        .exclude(status=SupportBooking.STATUS_CANCELLED)
        .select_related("availability", "student", "classroom")
        .order_by("availability__starts_at", "id")
    )
    if upcoming_only:
        qs = qs.filter(
            Q(availability__starts_at__gt=(now or timezone.now()))
            | Q(status=SupportBooking.STATUS_BOOKED)
        )
    return qs
