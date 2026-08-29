"""Student roadmap: a per-subject level ladder.

Every subject the student studies becomes one **track**. Within a track we show every level
the *subject itself* teaches — foundation→senior for Math, junior→senior for English, which
has no Foundation course at all — but only the student's **own** level is openable: its
lessons are hydrated with the student's real classroom delivery state (upcoming / available
/ completed) and link to the actual released homework. Every other level is a read-only
outline: lesson number + title + midterm markers, and nothing openable.

Why the source differs per level:

* **Other levels** can *only* come from the Journal master templates. A classroom is
  bound to exactly its own ``(subject, level)`` journal (``journal_for_classroom``), so a
  student never has released homework — or dates — for any other level. All we can honestly
  show for a locked level is the template's ordered lesson sequence.
* **The own level** is that same template sequence, hydrated for the student's classroom
  via ``journals.delivery.lesson_plan`` (release state, dates) plus completion from
  ``classes.analytics._completion_map`` (the canonical "did the student finish it" signal,
  reused so the roadmap agrees with the gradebook and the assessments board).

**Locking is enforced here, server-side.** A locked lesson carries no ``assignment_id``
and its level is ``is_own_level=False``; the backend never emits an openable id for it.
The frontend greying is cosmetic — this omission is the real boundary.

Level is a property of the *classroom*, never the student (``users/models.py`` forbids a
student a subject). So "the student's own level" is derived from their non-removed STUDENT
memberships: for each subject, the most-recently-joined classroom that carries a level.

**The payload also answers three questions the dashboard asks**, computed here rather than
anywhere else because this is the only place that already holds both the ladder and the
student's per-lesson completion state:

* ``completion_rate`` — how far through their OWN level a student is, per track.
* ``next_level`` — the rung after theirs, or null when they are already at the top.
* ``current_week`` — which week the GROUP is in, counted in lessons held.
* ``months_to_sat`` — how long until they could sit the exam, summed from the journals'
  authored ``duration_months``. See ``_track_progress`` for what makes it null.

Each of those is null rather than a guess when the data cannot support it, because every one
of them is a claim a student will repeat to somebody.
"""

from __future__ import annotations

from datetime import timedelta

from .models import Classroom, ClassroomMembership

# Display order of the ladder — the union of every level any subject offers. Each track
# filters this through its own subject's offered set (see ``build_roadmap``); it is NOT the
# ladder any single subject gets.
_LEVEL_ORDER = [
    Classroom.LEVEL_FOUNDATION,
    Classroom.LEVEL_JUNIOR,
    Classroom.LEVEL_MIDDLE,
    Classroom.LEVEL_SENIOR,
]
_LEVEL_LABELS = dict(Classroom.LEVEL_CHOICES)

# (classroom subject constant, domain subject, human label). Ordered for stable display.
_SUBJECTS = [
    (Classroom.SUBJECT_MATH, "math", "Math"),
    (Classroom.SUBJECT_ENGLISH, "english", "English"),
]


def _lesson_title(session) -> str:
    """A never-blank display title (journal titles are often left blank)."""
    title = (session.title or "").strip()
    if title:
        return title
    if session.is_midterm:
        return f"Midterm {session.lesson_number}"
    return f"Lesson {session.lesson_number}"


def _own_level_lessons(classroom, user, journal) -> list[dict]:
    """Own-level lessons hydrated with this student's real delivery + completion state.

    Built from the journal's sessions overlaid with the classroom's ``ClassroomLesson``
    delivery rows — NOT from a journal binding. Release creates the delivery rows directly
    (a teacher can hand out homework without ever opening the Lessons tab), so gating on the
    ``ClassroomJournal`` binding would miss released homework. The binding is consulted only
    for the *provisional* date of an undelivered lesson; a delivered lesson carries its own
    frozen ``scheduled_for``. Read-only throughout (``create_binding=False``) — viewing a
    roadmap must never bind a class as a side effect.
    """
    from journals.models import ClassroomLesson, JournalLesson
    from journals.delivery import get_binding
    from classes.lesson_schedule import lesson_starts
    from .analytics import _completion_map

    delivered = {
        d.journal_lesson_id: d
        for d in ClassroomLesson.objects.filter(classroom=classroom).select_related("assignment")
    }

    # Which of this student's deliveries they have already marked read. One query for the
    # whole ladder rather than one per lesson — the roadmap renders every session at once.
    from journals.models import RoadmapRead

    read_delivery_ids = set(
        RoadmapRead.objects.filter(
            student=user, classroom_lesson_id__in=[d.id for d in delivered.values()]
        ).values_list("classroom_lesson_id", flat=True)
    )

    sessions = list(
        journal.lessons.prefetch_related("roadmap__sections")
    )  # ordered (journal_id, lesson_number) by the model's Meta

    # Provisional dates for not-yet-delivered lessons, when the class is bound. Derived
    # straight from the schedule (session N → the N-th meeting) rather than re-deriving the
    # whole plan via lesson_plan(), which would re-query ClassroomLesson and hydrate the
    # journal's classwork/assessments we never use. A delivered lesson keeps its own frozen
    # scheduled_for regardless. Read-only: get_binding(create=False) never writes.
    planned_date: dict[int, object] = {}
    binding = get_binding(classroom, create=False)
    if binding is not None:
        starts = lesson_starts(classroom, len(sessions), anchor=binding.starts_on)
        planned_date = {s.id: dt for s, dt in zip(sessions, starts)}

    released_assignments = [
        d.assignment
        for d in delivered.values()
        if d.homework_released_at and d.assignment_id and d.assignment
    ]
    completed_ids: set[int] = set()
    if released_assignments:
        # The one canonical completion primitive (Submission SUBMITTED/REVIEWED + a graded
        # AssessmentResult), scoped to this classroom + this student.
        completed_ids = _completion_map(classroom, [user.id], released_assignments).get(user.id, set())

    lessons: list[dict] = []
    for session in sessions:
        d = delivered.get(session.id)
        # Hide lessons still being authored (DRAFT) — a PUBLISHED journal can hold DRAFT
        # lessons (a session added or reset after publish). But never hide a lesson the
        # student has actually received: a delivered row wins even if its template was since
        # reset to DRAFT.
        if session.status != JournalLesson.STATUS_PUBLISHED and d is None:
            continue
        # "released" also requires the assignment to still exist: a homework deleted after
        # release leaves homework_released_at set but assignment_id NULL (SET_NULL). Treat
        # that as upcoming, not a dead "Open" the student can't click.
        released = bool(d and d.homework_released_at and d.assignment_id)
        assignment_id = d.assignment_id if released else None
        scheduled = (d.scheduled_for if (d and d.scheduled_for) else planned_date.get(session.id))

        if session.is_midterm:
            # Midterms aren't homework; they're milestones. "available" once the classroom
            # has been granted the sitting (a start code is still needed to actually begin,
            # which the student handles on the Midterm page — not from the roadmap).
            state = "available" if (d and d.midterm_schedule_id) else "upcoming"
            assignment_id = None
        elif not released:
            state = "upcoming"
        elif assignment_id in completed_ids:
            state = "completed"
        else:
            state = "available"

        lessons.append(
            {
                "lesson_number": session.lesson_number,
                "title": _lesson_title(session),
                "lesson_type": session.lesson_type,
                "is_midterm": session.is_midterm,
                "accessible": True,
                "state": state,
                "assignment_id": assignment_id,
                "scheduled_for": scheduled.isoformat() if scheduled else None,
                # ── the reading attached to this session ──────────────────────────
                #
                # `delivery_id` is what the reading endpoints address, and it is emitted
                # ONLY for the own level: a locked level has no delivery row at all, so
                # there is nothing to open and nothing to mark. That omission is the real
                # boundary here, exactly as it is for `assignment_id` above.
                "delivery_id": d.id if d else None,
                "has_roadmap": session.has_roadmap,
                "roadmap_read": bool(d and d.id in read_delivery_ids),
            }
        )
    return lessons


def _current_week(classroom) -> int | None:
    """Which week of the course this GROUP is in — week 1 on the first meeting.

    Counted in **lessons held**, not in calendar weeks, so it agrees with the attendance
    register rather than with a wall calendar. A group that started on a Wednesday has met
    twice by the end of that week and is a third of the way through week one; counting
    calendar weeks would call the following Monday "week 2" while the register still shows
    four lessons.

    Returns ``None`` rather than 1 when it cannot be worked out — a class with no
    ``start_date``, an unreadable ``lesson_days`` (which project history shows does happen)
    or a start date in the future. "Week 1" is a specific claim and a class that has not met
    yet has not earned it.
    """
    from django.utils import timezone as dj_timezone
    from .lesson_schedule import lesson_weekdays

    start = getattr(classroom, "start_date", None)
    if not start:
        return None
    weekdays = lesson_weekdays(classroom)
    if not weekdays:
        return None

    today = dj_timezone.localtime().date()
    if today < start:
        return None

    per_week = len(weekdays)
    # Count the meetings that have actually happened, including today's.
    held = sum(
        1
        for offset in range((today - start).days + 1)
        if (start + timedelta(days=offset)).weekday() in weekdays
    )
    if held <= 0:
        return None
    # Lesson 1 is week 1; the week rolls over on the meeting AFTER a full week's worth.
    return (held - 1) // per_week + 1


def _track_progress(levels: list[dict], own_level: str | None) -> dict:
    """How far through the ladder this track is, and roughly how long is left.

    Everything here is derived from ``levels`` — which was just built — rather than
    re-queried, so the number under the ring can never disagree with the ring itself.

    **Completion rate is the OWN level only, not the whole ladder.** A student in Junior has
    not "completed 25% of Math" in any sense they would recognise; they have completed some
    of Junior. The ladder position is already carried by ``own_level`` and ``next_level``.
    Midterm markers count — sitting the midterm is part of finishing the level.

    **Months remaining** is the unfinished part of the current level plus the whole of every
    level above it, using each journal's own ``duration_months``. The current level is
    prorated by lessons rather than by elapsed time because elapsed time is not recorded
    anywhere per student, and a student who joined late would otherwise be told they are
    further along than they are.

    Returns ``months_remaining=None`` rather than a wrong number whenever the estimate would
    be dishonest: no own level, no published journal for it, or a remaining ladder whose
    durations have all been zeroed by hand. A missing estimate is a card the dashboard hides;
    a confident 0 is a promise the school did not make.
    """
    if not own_level:
        return {
            "completed_lessons": 0,
            "total_lessons": 0,
            "completion_rate": None,
            "next_level": None,
            "next_level_label": None,
            "months_remaining": None,
        }

    codes = [lv["level"] for lv in levels]
    try:
        own_index = codes.index(own_level)
    except ValueError:
        # The safety valve above keeps a mis-tagged own level in the ladder, so this is
        # unreachable in practice. Fail soft rather than 500 a student's roadmap.
        own_index = -1

    own = levels[own_index] if own_index >= 0 else None
    lessons = (own or {}).get("lessons") or []
    total = len(lessons)
    done = sum(1 for l in lessons if l.get("state") == "completed")
    # A level whose journal is not published yet has no lessons, so it has no rate — 0/0 is
    # "we don't know", not "you have done none of it".
    rate = round(done / total, 4) if total else None

    remaining = levels[own_index + 1 :] if own_index >= 0 else []
    nxt = remaining[0] if remaining else None

    # The unfinished share of the current level, plus every level still ahead.
    own_months = float((own or {}).get("duration_months") or 0)
    ahead_months = sum(float(lv.get("duration_months") or 0) for lv in remaining)
    share_left = (1 - (done / total)) if total else 1.0
    months = own_months * share_left + ahead_months
    # All zeroes means the school has not filled in `duration_months` on the journals that
    # are left, not that the student finishes today.
    knowable = (own_months + ahead_months) > 0
    finished = own_index >= 0 and not remaining and total > 0 and done == total

    return {
        "completed_lessons": done,
        "total_lessons": total,
        "completion_rate": rate,
        "next_level": nxt["level"] if nxt else None,
        "next_level_label": nxt["level_label"] if nxt else None,
        "months_remaining": 0 if finished else (round(months, 1) if knowable else None),
    }


def _template_outline(journal) -> list[dict]:
    """The bare, inert outline of a journal — the only thing a locked level ever exposes.

    PUBLISHED lessons only: a locked level must never leak another level's in-authoring
    (DRAFT) sessions to a student.
    """
    from journals.models import JournalLesson

    return [
        {
            "lesson_number": s.lesson_number,
            "title": _lesson_title(s),
            "lesson_type": s.lesson_type,
            "is_midterm": s.is_midterm,
        }
        for s in journal.lessons.all()  # prefetched; Meta ordering is (journal_id, lesson_number)
        if s.status == JournalLesson.STATUS_PUBLISHED
    ]


def build_roadmap(user) -> dict:
    """The full roadmap payload for ``user``: one track per subject they study."""
    memberships = list(
        ClassroomMembership.objects.filter(
            user=user,
            role=ClassroomMembership.ROLE_STUDENT,
            status__in=ClassroomMembership.NON_REMOVED_STATUSES,
        )
        .select_related("classroom")
        .order_by("-joined_at", "-id")  # most-recent first → wins the per-subject tie-break
    )

    studied: set[str] = set()  # classroom subject constants (MATH/ENGLISH) the student is in
    own_classroom: dict[str, Classroom] = {}  # subject const → the classroom that sets own level
    for m in memberships:
        c = m.classroom
        if not c or not c.subject:
            continue
        studied.add(c.subject)
        # First (most-recent) membership with a real level wins; a blank-level class never
        # sets an own level.
        if c.level and c.subject not in own_classroom:
            own_classroom[c.subject] = c

    if not studied:
        return {"tracks": []}

    # One query for every published journal we might render. Deliberately NOT filtered by
    # level, so the bound stays 2 subjects × 4 levels even though English only teaches
    # three: a stray row (a hand-inserted ENGLISH/foundation journal, say) is fetched here
    # but then never looked up, because the ladder below decides which (subject, level)
    # keys get asked for and it is built from the curriculum, not from this dict.
    from journals.models import Journal

    journals = {
        (j.subject, j.level): j
        for j in Journal.objects.filter(
            subject__in=studied, status=Journal.STATUS_PUBLISHED
        ).prefetch_related("lessons")
    }

    tracks: list[dict] = []
    for subj_const, domain, label in _SUBJECTS:
        if subj_const not in studied:
            continue
        own_c = own_classroom.get(subj_const)
        own_level = own_c.level if own_c else None

        # This subject's ladder = the display order filtered through the subject's OWN
        # offered levels. English has no Foundation course, so an English track emits no
        # Foundation rung at all — not a greyed "not offered" one, not an empty one. A rung
        # the school never teaches is not a level the student is "not yet at"; showing it
        # invents a step on their path. Driven off ``Classroom.LEVELS_BY_SUBJECT`` (the same
        # tuple the classroom/assessment level pickers use) so a curriculum change lands in
        # one place instead of being re-hardcoded here.
        rungs = set(Classroom.allowed_levels_for_subject(subj_const))
        # Safety valve for mis-tagged data: if the student's classroom carries a level the
        # subject does not offer (e.g. an English class left on "foundation" from before the
        # curriculum settled), keep that one rung. Filtering it away would leave that student
        # with a roadmap where NO rung is theirs and their real released homework is
        # unreachable — a silent hole, which is worse than one odd-looking rung. It affects
        # only the student actually enrolled in such a class; every other English roadmap
        # still starts at Junior.
        if own_level:
            rungs.add(own_level)
        ladder = [lv for lv in _LEVEL_ORDER if lv in rungs]

        levels: list[dict] = []
        for level in ladder:
            journal = journals.get((subj_const, level))
            is_own = bool(own_level) and level == own_level

            if is_own and journal is not None:
                # Own level: the journal outline hydrated with the student's real state.
                lessons = _own_level_lessons(own_c, user, journal)
            elif journal is not None:
                lessons = _template_outline(journal)  # locked: inert, no openable id
            else:
                lessons = []  # a rung whose journal isn't published yet ("coming soon")

            # No "offered" flag: every rung we emit is one the subject genuinely offers, so
            # the flag had become a constant True and the frontend's greyed "not offered"
            # branch was dead code. A level the subject doesn't teach is absent, not greyed.
            levels.append(
                {
                    "level": level,
                    "level_label": _LEVEL_LABELS.get(level, level.title()),
                    "is_own_level": is_own,
                    "journal_published": journal is not None,
                    "lesson_count": len(lessons),
                    # How long the school says this level takes. Never blank in practice:
                    # `journals.services.create_journal` takes it from the curriculum map in
                    # `journals.structure` (Foundation 1 month, Junior 3, Middle 2, Senior 2),
                    # so the SAT estimate works with no admin input at all. A zero only
                    # appears if somebody clears the field by hand, which is why the estimate
                    # below treats an all-zero remainder as unknown rather than as "no time
                    # left".
                    "duration_months": int(getattr(journal, "duration_months", 0) or 0),
                    "lessons": lessons,
                }
            )

        tracks.append(
            {
                "subject": domain,
                "subject_label": label,
                "own_level": own_level,
                "own_level_label": _LEVEL_LABELS.get(own_level) if own_level else None,
                "own_classroom_id": own_c.id if own_c else None,
                # Which week the GROUP is in — a property of the classroom's schedule, not of
                # this student's progress through it. A student who joined late is in the
                # group's week 6, not their own week 1, and that is the number their teacher
                # and their classmates use.
                "current_week": _current_week(own_c) if own_c else None,
                **_track_progress(levels, own_level),
                "levels": levels,
            }
        )

    # ── How long until this student can sit the SAT ───────────────────────────
    #
    # The MAXIMUM across tracks, never the sum and never one subject's figure. The SAT is one
    # exam with both sections in it, so a student is ready when the SLOWER half of their
    # course finishes; adding Math's remaining months to English's would describe a student
    # who studies one subject at a time, which nobody here does.
    #
    # Tracks we cannot estimate are left out rather than counted as zero — counting them as
    # zero is what would turn "we don't know about English" into "English is already done".
    # If that leaves nothing, the answer is None and the card does not render. It is also
    # deliberately NOT reconciled with the student's own `sat_exam_date`: that is the date
    # they intend to sit, this is how long the course has left, and the two disagreeing is
    # information rather than a bug.
    known = [t["months_remaining"] for t in tracks if t["months_remaining"] is not None]

    return {
        "tracks": tracks,
        "months_to_sat": max(known) if known else None,
        # Which subjects the figure actually accounts for, so a UI can say "based on Math"
        # rather than implying it covers a course it could not see.
        "months_to_sat_basis": [
            t["subject"] for t in tracks if t["months_remaining"] is not None
        ],
    }
