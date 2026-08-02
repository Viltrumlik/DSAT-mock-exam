"""The invigilated mock sitting: request a place, be approved, start together.

One module owns every state change a session can undergo, because four surfaces drive them
(the student's code screen, the teacher's console, the admin's console, and the reaper) and
a rule enforced in only three of them is not a rule.

The shape, in order:

    create   admin, for one date, mints the 6-digit code
    request  student types the code -> a PENDING place
    approve  teacher (or admin) admits them -> APPROVED
    start    teacher presses Start -> one paper per approved place, ONE clock zero
    end      the room closes -> every unfinished paper is drained and scored

``start`` is the only place a session attempt is ever created. A student cannot conjure one
by POSTing to the attempt endpoint, which is what keeps "approved" meaningful.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import MockAttempt, MockSession, MockSessionParticipant

logger = logging.getLogger(__name__)

# Why a join request was refused. The student sees the mapped sentence, never the key.
REASON_BAD_CODE = "bad_code"
REASON_NOT_TODAY = "session_not_today"
REASON_ALREADY_STARTED = "session_already_started"
REASON_CLOSED = "session_closed"
REASON_REJECTED = "session_rejected"

REASON_DETAIL = {
    REASON_BAD_CODE: "That code doesn't match a sitting today. Check it with your teacher.",
    REASON_NOT_TODAY: "That code was for a different day.",
    REASON_ALREADY_STARTED: "This sitting has already started, so no one else can join it.",
    REASON_CLOSED: "This sitting is closed.",
    REASON_REJECTED: "Your request for this sitting was not approved.",
}


def find_session_by_code(code, *, today=None):
    """The session a code opens TODAY, or None.

    Scoped to the date on purpose: a code is good for one day, so last week's slip of paper
    cannot walk a student into this week's sitting.
    """
    cleaned = str(code or "").strip()
    if len(cleaned) != 6 or not cleaned.isdigit():
        return None
    today = today or timezone.localdate()
    return (
        MockSession.objects.filter(access_code=cleaned, session_date=today)
        .exclude(status=MockSession.STATUS_CANCELLED)
        .select_related("mock")
        .first()
    )


def request_place(user, code, *, today=None) -> tuple[MockSessionParticipant | None, str]:
    """Ask for a place in the sitting a code opens. Returns ``(participant, reason)``.

    Idempotent: typing the code twice returns the SAME row rather than a second request,
    so a student refreshing the page does not fill the teacher's queue with duplicates.
    A previously REJECTED student stays rejected — re-typing the code is not an appeal.
    """
    session = find_session_by_code(code, today=today)
    if session is None:
        return None, REASON_BAD_CODE
    if session.status == MockSession.STATUS_STARTED:
        # An existing place still resolves — this is how an approved student who reloads
        # during the sitting finds their way back in.
        existing = MockSessionParticipant.objects.filter(session=session, student=user).first()
        if existing is not None:
            return existing, "ok"
        return None, REASON_ALREADY_STARTED
    if not session.accepts_requests(today=today):
        return None, REASON_CLOSED if session.status != MockSession.STATUS_OPEN else REASON_NOT_TODAY

    try:
        with transaction.atomic():
            place, _created = MockSessionParticipant.objects.get_or_create(
                session=session, student=user
            )
    except IntegrityError:  # pragma: no cover - lost race on the unique constraint
        place = MockSessionParticipant.objects.get(session=session, student=user)
    return place, "ok"


def decide_place(place, *, approve: bool, actor) -> MockSessionParticipant:
    """Admit or refuse one request. Idempotent and re-decidable until the room starts."""
    place.status = (
        MockSessionParticipant.STATUS_APPROVED if approve else MockSessionParticipant.STATUS_REJECTED
    )
    place.decided_at = timezone.now()
    place.decided_by = actor
    place.save(update_fields=["status", "decided_at", "decided_by", "updated_at"])
    return place


def start_session(session, *, actor=None) -> dict:
    """Open the paper for every approved place, on ONE clock.

    All attempts share a single ``started_at``, so the room's deadlines are identical to the
    microsecond rather than smeared across the write loop. Idempotent: pressing Start twice
    seats anyone approved in between and leaves the running papers untouched (``start_attempt``
    no-ops once past NOT_STARTED, and the per-session unique constraint stops a second paper).
    """
    now = timezone.now()
    seated, resumed = 0, 0
    with transaction.atomic():
        locked = MockSession.objects.select_for_update().get(pk=session.pk)
        started_at = locked.started_at or now
        approved = list(
            MockSessionParticipant.objects.select_for_update()
            .filter(session=locked, status=MockSessionParticipant.STATUS_APPROVED)
        )
        for place in approved:
            attempt = place.attempt
            if attempt is None:
                attempt = MockAttempt.objects.filter(
                    session=locked, student_id=place.student_id
                ).first()
            if attempt is None:
                attempt = MockAttempt.objects.create(
                    mock_id=locked.mock_id, student_id=place.student_id, session=locked
                )
                seated += 1
            else:
                resumed += 1
            if attempt.start_attempt(at=started_at):
                pass
            if place.attempt_id != attempt.pk:
                place.attempt = attempt
                place.save(update_fields=["attempt", "updated_at"])

        MockSession.objects.filter(pk=locked.pk).update(
            status=MockSession.STATUS_STARTED,
            started_at=started_at,
            started_by=actor if locked.started_by_id is None else locked.started_by,
            updated_at=now,
        )
    logger.info(
        "mock_session_started session_id=%s seated=%s resumed=%s actor=%s",
        session.pk, seated, resumed, getattr(actor, "pk", None),
    )
    session.refresh_from_db()
    return {"seated": seated, "already_seated": resumed, "started_at": started_at.isoformat()}


def end_session(session, *, actor=None) -> dict:
    """Close the room: every unfinished paper is taken in and scored.

    Uses the reaper's own drain so a session ending and an attempt being abandoned produce
    the identical outcome — walked to SCORING without accepting any late answers.
    """
    from .reaper import drain
    from .tasks import enqueue_mock_scoring
    from .state_machine import STATE_SCORING

    now = timezone.now()
    to_score: list[int] = []
    with transaction.atomic():
        locked = MockSession.objects.select_for_update().get(pk=session.pk)
        for attempt in MockAttempt.objects.select_for_update().filter(
            session=locked, is_completed=False
        ):
            drain(attempt)
            if attempt.current_state == STATE_SCORING:
                to_score.append(attempt.pk)
        MockSession.objects.filter(pk=locked.pk).update(
            status=MockSession.STATUS_ENDED, ended_at=now, updated_at=now
        )
    # Enqueue outside the row locks (runs synchronously when there is no broker).
    for attempt_id in to_score:
        enqueue_mock_scoring(attempt_id=attempt_id, request=None)
    logger.info(
        "mock_session_ended session_id=%s drained=%s actor=%s",
        session.pk, len(to_score), getattr(actor, "pk", None),
    )
    session.refresh_from_db()
    return {"drained": len(to_score)}
