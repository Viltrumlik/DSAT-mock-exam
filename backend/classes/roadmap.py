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
"""

from __future__ import annotations

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

    sessions = list(journal.lessons.all())  # prefetched, ordered (journal_id, lesson_number)

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
            }
        )
    return lessons


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
                "levels": levels,
            }
        )

    return {"tracks": tracks}
