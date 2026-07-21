"""The "your midterm is scheduled" email, fanned out to a whole classroom.

Granting a class access to a midterm is the one moment every student has to hear about at
the same time, and it is the first message this codebase sends to more than one person.
``users.email_verification.deliver_code`` sends inside the request; with ``EMAIL_TIMEOUT``
at 10s a 25-student class could hold a teacher's request open for four minutes, so the
fan-out goes to Celery when a broker is configured and to a daemon thread scheduled on
commit when it is not — the same shape as ``question_reports.tasks``.

Two properties the callers depend on:

* **Once per schedule.** ``MidtermSchedule.notified_at`` is claimed with a conditional
  UPDATE *before* anything is queued, so a teacher re-saving the window (or two teachers
  pressing the button at the same instant) cannot mail the class twice. Moving the exam
  afterwards deliberately does NOT re-notify: a class that gets three of these learns to
  ignore all of them, and the teacher is in the room to say so.
* **One bad address never costs the rest.** Every send is isolated; a Telegram signup with
  no address is skipped by ``is_deliverable_email`` rather than raising.
"""

from __future__ import annotations

import logging
import threading
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from django.template.loader import render_to_string
from django.utils import timezone

from core.mail import brand_context
from users.email_utils import is_deliverable_email

from .models import ClassroomMembership
from .models_schedule import MidtermSchedule

logger = logging.getLogger(__name__)

# How early students are told to be in their seat. The exam itself starts on the minute;
# this is the buffer for logging in, going fullscreen and hearing the access code.
SEATED_BEFORE_MINUTES = 15

_SUBJECT_LABELS = {
    "READING_WRITING": "English",
    "MATH": "Math",
    "ENGLISH": "English",
}


# ── content ──────────────────────────────────────────────────────────────────
def _legacy_facts(exam) -> dict:
    """Title / subject / length for a legacy ``exams.MockExam`` midterm.

    The new ``Midterm`` carries its own duration and question count; the legacy exam keeps
    them on its modules, so they are summed here. Both can legitimately come out empty (an
    unprovisioned midterm), which the template renders as a missing row rather than a zero.
    """
    from exams.models import Module, Question

    modules = Module.objects.filter(practice_test__mock_exam_id=exam.pk)
    minutes = sum(m.time_limit_minutes or 0 for m in modules)
    questions = Question.objects.filter(module__practice_test__mock_exam_id=exam.pk).count()
    scale = getattr(exam, "midterm_scoring_scale", "") or ""
    subject = getattr(exam, "midterm_subject", "") or ""
    level = str(getattr(exam, "midterm_level", "") or "").lower()
    return {
        "title": exam.title or f"Midterm #{exam.pk}",
        "subject": subject,
        "duration_minutes": minutes or None,
        "question_count": questions or None,
        "scoring_scale": scale,
        "pass_mark": getattr(exam, "midterm_pass_mark", None),
        "is_graded": str(getattr(exam, "midterm_type", "") or "").upper() != "PRE_MIDTERM",
        "is_retake": str(getattr(exam, "midterm_type", "") or "").upper() == "RETAKE",
        # Mirror Midterm.calculator_enabled without importing it: Math at middle/senior.
        "calculator_enabled": subject.upper() == "MATH" and level in ("middle", "senior"),
    }


def _midterm_facts(midterm) -> dict:
    return {
        "title": midterm.title or f"Midterm #{midterm.pk}",
        "subject": midterm.subject,
        "duration_minutes": midterm.duration_minutes or None,
        "question_count": midterm.display_question_count() or None,
        "scoring_scale": midterm.scoring_scale,
        "pass_mark": midterm.effective_pass_mark,
        "is_graded": midterm.is_graded,
        "is_retake": midterm.midterm_type == midterm.TYPE_RETAKE,
        "calculator_enabled": bool(midterm.calculator_enabled),
    }


def _facts(schedule: MidtermSchedule) -> dict | None:
    """The exam behind a schedule row, in one shape whichever identity it carries."""
    if schedule.midterm_id:
        return _midterm_facts(schedule.midterm)
    if schedule.mock_exam_id:
        return _legacy_facts(schedule.mock_exam)
    return None


def _scoring_label(facts: dict) -> str:
    from midterms.outcomes import default_pass_mark, scale_bounds

    ceiling = scale_bounds(facts["scoring_scale"])[1]
    if not facts["is_graded"]:
        return f"Out of {ceiling} — practice, not pass/fail"
    pass_mark = facts["pass_mark"]
    if pass_mark is None:
        pass_mark = default_pass_mark(facts["scoring_scale"])
    return f"Out of {ceiling} · pass at {pass_mark}"


def _pass_mark_label(facts: dict) -> str:
    """"60 / 100"-style pass mark for the retake rule, or "" for an ungraded pre-midterm."""
    from midterms.outcomes import default_pass_mark, scale_bounds

    if not facts["is_graded"]:
        return ""
    ceiling = scale_bounds(facts["scoring_scale"])[1]
    pass_mark = facts["pass_mark"]
    if pass_mark is None:
        pass_mark = default_pass_mark(facts["scoring_scale"])
    return f"{pass_mark} / {ceiling}"


def build_context(schedule: MidtermSchedule) -> dict | None:
    """Template context for one schedule, or ``None`` when it cannot be described.

    Every date is formatted here rather than in the template: a mail client has no locale
    negotiation and the classroom timezone is the only one that means anything to a student
    who has to be in a room at that hour.
    """
    facts = _facts(schedule)
    if facts is None or schedule.starts_at is None:
        return None

    start = timezone.localtime(schedule.starts_at)
    seated = start - timedelta(minutes=SEATED_BEFORE_MINUTES)
    duration = facts["duration_minutes"]
    end = start + timedelta(minutes=duration) if duration else None

    # The rules block mirrors the runner's start screen (MidtermRulesScreen). The off-screen
    # numbers come from the same backend constants the runner reads, so the email can never
    # promise a student a different grace than the exam enforces.
    from midterms.proctoring import GRACE_SECONDS, VIOLATION_LIMIT

    context = brand_context(
        headline="Your retake is scheduled" if facts["is_retake"] else "Your midterm is scheduled",
        is_retake=facts["is_retake"],
        midterm_title=facts["title"],
        classroom_name=schedule.classroom.name,
        subject_label=_SUBJECT_LABELS.get(facts["subject"], facts["subject"] or "—"),
        question_label=f"{facts['question_count']} questions" if facts["question_count"] else "—",
        scoring_label=_scoring_label(facts),
        month_label=start.strftime("%b").upper(),
        day_number=str(start.day),
        weekday_label=start.strftime("%A"),
        date_label=start.strftime("%d %B %Y").lstrip("0"),
        start_time=start.strftime("%H:%M"),
        end_time=end.strftime("%H:%M") if end else "",
        duration_label=f"{duration} minutes" if duration else "",
        seated_by=seated.strftime("%H:%M"),
        timezone_label=str(timezone.get_current_timezone()),
        # Rule flags — mirror the runner's rules screen so the two never disagree.
        is_graded=facts["is_graded"],
        calculator_enabled=facts["calculator_enabled"],
        # A classroom midterm always hands out a code (this mail is classroom-only).
        requires_code=True,
        pass_mark_label=_pass_mark_label(facts),
        offscreen_grace_seconds=GRACE_SECONDS,
        offscreen_warnings=VIOLATION_LIMIT - 1,
    )
    context["midterm_url"] = f"{context['site_url']}/midterm"
    return context


def _subject_line(context: dict) -> str:
    return f"{context['headline']}: {context['midterm_title']}"


def _text_rules(context: dict) -> str:
    """The rules as plain text, grouped exactly like the HTML part and the runner screen.

    The off-screen numbers come from the same context the HTML reads, so a client that shows
    only the text part can never promise a different grace than the exam enforces.
    """
    grace = context["offscreen_grace_seconds"]
    warnings = context["offscreen_warnings"]
    warn_word = "warning" if warnings == 1 else "warnings"

    bring = ["- A fully charged device that stays on for 1-2 hours.",
             "- A stable internet connection (answers save automatically)."]
    if context.get("requires_code"):
        bring.append("- The 6-digit access code your teacher reads out — enter it right before you start.")

    allowed = ["- Blank scratch paper and a pen or pencil.",
               "- Flagging questions to review before time runs out."]
    if context.get("calculator_enabled"):
        allowed.append("- The built-in Desmos calculator from the toolbar. No physical calculator.")

    not_allowed = [
        "- Other apps, tabs, or programs — close everything else first.",
        "- Notes, books, or any other reference material.",
        "- Phones, smartwatches, headphones, or earbuds.",
        "- Any camera, screen recorder, or recording device.",
        f"- Leaving full screen or switching windows. You get {grace} seconds to come back, "
        f"and only {warnings} {warn_word}; after that your paper is submitted immediately.",
    ]

    if context.get("is_retake"):
        one = ("- This is your retake, offered because you didn't reach the pass mark first time. "
               "You sit a midterm once; there is no retake of a retake.")
    else:
        need = f"You need {context['pass_mark_label']} to pass. " if context.get("pass_mark_label") else ""
        one = (f"- One attempt. {need}You sit this midterm once — if you finish below the pass mark, "
               "your teacher can open a retake for you.")

    return (
        "BRING & HAVE READY\n" + "\n".join(bring) + "\n\n"
        "ALLOWED\n" + "\n".join(allowed) + "\n\n"
        "NOT ALLOWED\n" + "\n".join(not_allowed) + "\n\n"
        "The timer starts when you begin and cannot be paused or reset; you cannot submit early.\n"
        + one + "\n"
    )


def _text_body(context: dict) -> str:
    """Plain-text part. Some clients show only this, and a student who cannot read when to
    turn up has learned nothing from the message."""
    timing = f"Starts at {context['start_time']} ({context['timezone_label']})"
    if context["end_time"]:
        timing += f", ends {context['end_time']} — {context['duration_label']}"
    return (
        f"{context['headline']}\n\n"
        f"{context['midterm_title']} — {context['classroom_name']}\n"
        f"{context['weekday_label']}, {context['date_label']}\n"
        f"{timing}.\n"
        f"Be seated and logged in by {context['seated_by']}.\n\n"
        f"Subject: {context['subject_label']}\n"
        f"Questions: {context['question_label']}\n"
        f"Scoring: {context['scoring_label']}\n\n"
        + _text_rules(context)
        + f"\nOpen the midterm page: {context['midterm_url']}\n\n"
        "Can't attend? Tell your teacher before the start time.\n\n"
        "This message was sent automatically; please do not reply to it.\n"
    )


# ── delivery ─────────────────────────────────────────────────────────────────
def _recipients(schedule: MidtermSchedule) -> list:
    """Active students of the classroom who have an address worth trying.

    Removed and invited memberships are excluded: neither is sitting this exam. Telegram
    signups have no address at all and are dropped here rather than failing at send time.

    A RETAKE is narrowed further, to the students who failed its parent: they are the only
    ones it is granted to, so mailing the rest would summon students who already passed to
    an exam they cannot open.
    """
    members = ClassroomMembership.objects.filter(
        classroom_id=schedule.classroom_id,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).select_related("user")
    users = [m.user for m in members if is_deliverable_email(getattr(m.user, "email", None))]

    eligible_ids = _retake_eligible_ids(schedule)
    if eligible_ids is not None:
        users = [u for u in users if u.pk in eligible_ids]
    return users


def _retake_eligible_ids(schedule: MidtermSchedule):
    """Ids allowed to sit this schedule's midterm when it is a retake, else ``None``.

    ``None`` means "no narrowing applies" (not a retake, a legacy mock_exam schedule, or a
    retake with no parent recorded — which degrades to an ordinary midterm everywhere else).
    """
    if not schedule.midterm_id:
        return None
    try:
        from midterms.access import retake_eligible_students
        from midterms.models import Midterm

        midterm = Midterm.objects.filter(pk=schedule.midterm_id).first()
        if midterm is None or midterm.midterm_type != Midterm.TYPE_RETAKE or not midterm.retake_of_id:
            return None
        return set(retake_eligible_students(midterm).values_list("pk", flat=True))
    except Exception:  # pragma: no cover - a mail-scoping lookup must never break the send
        logger.exception("midterm_mail_retake_scope_failed schedule_id=%s", schedule.pk)
        return None


def _send_one(*, address: str, subject: str, text: str, html: str) -> bool:
    """One message, one connection. Sharing an SMTP connection across the class would be
    fewer handshakes, but a single broken send can leave that connection unusable and take
    the rest of the class with it — and this runs off the request, where the handshakes cost
    nobody anything."""
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        to=[address],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)
    return True


@shared_task(name="classes.mail_midterm.send_midterm_scheduled_emails")
def send_midterm_scheduled_emails(schedule_id: int) -> dict:
    """Mail every active student of the classroom. Best-effort, per-address isolated."""
    schedule = (
        MidtermSchedule.objects.select_related("classroom", "midterm", "mock_exam")
        .filter(pk=schedule_id)
        .first()
    )
    if schedule is None:
        return {"status": "noop", "reason": "missing", "schedule_id": schedule_id}

    context = build_context(schedule)
    if context is None:
        logger.warning("midterm_scheduled_email skipped: schedule %s has no exam/start", schedule_id)
        return {"status": "noop", "reason": "not_describable", "schedule_id": schedule_id}

    # Gate on the explicit flag, never on EMAIL_BACKEND: Django always defines that, so
    # testing it opens an SMTP connection to a host with no MTA on every send.
    if not getattr(settings, "EMAIL_SENDING_ENABLED", False):
        logger.info("midterm_scheduled_email not sent (EMAIL_SENDING_ENABLED off) schedule=%s", schedule_id)
        return {"status": "noop", "reason": "sending_disabled", "schedule_id": schedule_id}

    subject = _subject_line(context)
    text = _text_body(context)
    html = render_to_string("email/midterm_scheduled.html", context)

    sent = failed = 0
    for student in _recipients(schedule):
        try:
            _send_one(address=student.email, subject=subject, text=text, html=html)
            sent += 1
        except Exception:
            # One unreachable mailbox must not cost the rest of the class their notice.
            failed += 1
            logger.exception(
                "midterm_scheduled_email failed schedule=%s student=%s", schedule_id, student.pk
            )
    logger.info("midterm_scheduled_email schedule=%s sent=%s failed=%s", schedule_id, sent, failed)
    return {"status": "ok", "schedule_id": schedule_id, "sent": sent, "failed": failed}


def _deliver_off_thread(schedule_id: int) -> None:
    """Run the fan-out in a throwaway thread and always release its DB connection."""
    try:
        send_midterm_scheduled_emails(schedule_id)
    except Exception:  # pragma: no cover - best-effort; never surface to the request
        logger.exception("inline midterm-scheduled notification failed (schedule_id=%s)", schedule_id)
    finally:
        connection.close()


def enqueue_midterm_scheduled_emails(schedule_id: int) -> None:
    """Hand the fan-out to Celery, or to a daemon thread scheduled on commit.

    Without the on_commit hop the thread can read the schedule row before the teacher's
    transaction commits and mail a window that never existed.
    """
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        send_midterm_scheduled_emails.delay(schedule_id)
        return

    def _spawn() -> None:
        threading.Thread(
            target=_deliver_off_thread,
            args=(schedule_id,),
            name=f"midterm-notify-{schedule_id}",
            daemon=True,
        ).start()

    transaction.on_commit(_spawn)


def notify_class_midterm_scheduled(schedule: MidtermSchedule, *, force: bool = False) -> bool:
    """Claim ``notified_at`` and queue the class email. True when THIS call claimed it.

    The claim is a conditional UPDATE rather than a read-then-save so concurrent callers
    cannot both decide they are the first. Callers ignore the return value: whether a
    student's mail went out is not something a teacher's request should fail on.
    """
    if schedule is None or schedule.pk is None or schedule.starts_at is None:
        return False
    rows = MidtermSchedule.objects.filter(pk=schedule.pk)
    if not force:
        rows = rows.filter(notified_at__isnull=True)
    now = timezone.now()
    if not rows.update(notified_at=now):
        return False
    schedule.notified_at = now
    enqueue_midterm_scheduled_emails(schedule.pk)
    return True
