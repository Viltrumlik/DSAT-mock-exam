"""Email a classroom's students when homework is assigned to them.

Mirrors ``classes.mail_homework`` on ``mail_midterm``: the send is claimed with a
conditional UPDATE on ``Assignment.notified_at`` so two concurrent requests cannot both
mail the class, and the fan-out runs off the request thread (Celery when a broker is
configured, else a daemon thread scheduled on commit) so a teacher setting homework never
waits on the class's mailboxes.

The email carries what a student needs the moment homework lands: the title and category,
the instructions, what is attached, the due date (this classroom's next-lesson deadline),
and a button straight to the homework detail page.
"""

from __future__ import annotations

import logging
import threading

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import connection, transaction
from django.template.loader import render_to_string
from django.utils import timezone

from core.mail import brand_context
from users.email_utils import is_deliverable_email

from .models import Assignment, ClassroomMembership

logger = logging.getLogger(__name__)

_CATEGORY_LABELS = {
    Assignment.CATEGORY_HOMEWORK: "Homework",
    Assignment.CATEGORY_CLASSWORK: "Classwork",
    Assignment.CATEGORY_QUIZ: "Quiz",
    Assignment.CATEGORY_PARTICIPATION: "Participation",
    Assignment.CATEGORY_PRACTICE_TEST: "Practice test",
    Assignment.CATEGORY_MOCK_EXAM: "Mock exam",
    Assignment.CATEGORY_PAST_PAPER: "Past paper",
}

# The student-facing homework detail page (App Router: /classes/<id>/assignments/<id>).
_DETAIL_PATH = "/classes/{classroom_id}/assignments/{assignment_id}"

# Instructions are shown in full on the page; the email carries a readable preview only.
_INSTRUCTIONS_PREVIEW_CHARS = 320


# ── content summary ──────────────────────────────────────────────────────────
def _contents(assignment: Assignment) -> list[str]:
    """Plain-language list of what is attached, for the "What's inside" block.

    Best-effort and defensive: a homework can bundle several contents, but a missing
    related table must never break the mail.
    """
    items: list[str] = []

    def _count_practice() -> int:
        n = 0
        if assignment.practice_test_id or assignment.practice_test_ids:
            n += 1
        packs = set()
        if assignment.practice_test_pack_id:
            packs.add(assignment.practice_test_pack_id)
        for x in (assignment.practice_test_pack_ids or []):
            try:
                packs.add(int(x))
            except (TypeError, ValueError):
                pass
        return n + len(packs)

    # The lesson video leads the list for the same reason it sits on top of the homework
    # page: a student who missed the lesson needs to watch it before anything else here
    # makes sense. An uploaded file and a link are the same thing to the reader.
    if assignment.video_file or assignment.video_url:
        items.append("The lesson video to watch")

    try:
        assessments = assignment.assessment_homeworks.count()
    except Exception:  # pragma: no cover - defensive
        assessments = 0
    if assessments:
        items.append(f"{assessments} assessment{'s' if assessments != 1 else ''} to complete")

    try:
        vocab = assignment.vocab_homeworks.count()
    except Exception:  # pragma: no cover - defensive
        vocab = 0
    if vocab:
        items.append(f"{vocab} vocabulary set{'s' if vocab != 1 else ''} to study")

    practice = _count_practice()
    if practice:
        items.append(f"{practice} practice test{'s' if practice != 1 else ''}")
    if assignment.mock_exam_id:
        items.append("A mock exam")
    if assignment.module_id:
        items.append("A module test")

    links = [u for u in (assignment.external_urls or []) if u] or ([assignment.external_url] if assignment.external_url else [])
    if links:
        items.append(f"{len(links)} link{'s' if len(links) != 1 else ''} to open")

    has_file = bool(assignment.attachment_file)
    if not has_file:
        try:
            has_file = assignment.extra_attachments.exists()
        except Exception:  # pragma: no cover - defensive
            has_file = False
    if has_file:
        items.append("A file to download")

    if getattr(assignment, "allow_file_upload", False):
        items.append("A file for you to hand in")
    return items


def _instructions_preview(assignment: Assignment) -> str:
    text = (assignment.instructions or "").strip()
    if len(text) <= _INSTRUCTIONS_PREVIEW_CHARS:
        return text
    return text[:_INSTRUCTIONS_PREVIEW_CHARS].rstrip() + "…"


def build_context(assignment: Assignment) -> dict:
    """Template context for one homework's notification."""
    due = assignment.due_at
    due_local = timezone.localtime(due) if due else None

    context = brand_context(
        homework_title=assignment.title,
        category_label=_CATEGORY_LABELS.get(assignment.category, "Homework"),
        classroom_name=assignment.classroom.name,
        instructions=_instructions_preview(assignment),
        contents=_contents(assignment),
        has_due=due_local is not None,
        due_date=due_local.strftime("%A, %d %B %Y").replace(" 0", " ") if due_local else "",
        due_time=due_local.strftime("%H:%M") if due_local else "",
        due_month=due_local.strftime("%b").upper() if due_local else "",
        due_day=str(due_local.day) if due_local else "",
        due_weekday=due_local.strftime("%a").upper() if due_local else "",
        timezone_label=str(timezone.get_current_timezone()),
    )
    context["homework_url"] = context["site_url"].rstrip("/") + _DETAIL_PATH.format(
        classroom_id=assignment.classroom_id, assignment_id=assignment.id
    )
    return context


# ── delivery ─────────────────────────────────────────────────────────────────
def _recipients(assignment: Assignment) -> list:
    """Active students of the classroom with a deliverable address.

    Only students are mailed (never the teaching team), only ACTIVE memberships (a removed
    or not-yet-joined student is not doing this homework), and Telegram signups with no
    address are dropped here rather than failing at send time.
    """
    members = ClassroomMembership.objects.filter(
        classroom_id=assignment.classroom_id,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).select_related("user")
    return [m.user for m in members if is_deliverable_email(getattr(m.user, "email", None))]


def _subject_line(context: dict) -> str:
    return f"New {context['category_label'].lower()}: {context['homework_title']}"


def _text_body(context: dict) -> str:
    lines = [
        _subject_line(context),
        "",
        f"{context['category_label']} — {context['classroom_name']}",
    ]
    if context["has_due"]:
        lines.append(f"Due by {context['due_date']} at {context['due_time']} ({context['timezone_label']}).")
    else:
        lines.append("No fixed deadline — check with your teacher.")
    if context["instructions"]:
        lines += ["", context["instructions"]]
    if context["contents"]:
        lines += ["", "What's inside:"] + [f"- {c}" for c in context["contents"]]
    lines += [
        "",
        f"Open your homework: {context['homework_url']}",
        "",
        "This message was sent automatically; please do not reply to it.",
    ]
    return "\n".join(lines)


def _send_one(*, address: str, subject: str, text: str, html: str) -> None:
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        to=[address],
    )
    msg.attach_alternative(html, "text/html")
    msg.send(fail_silently=False)


@shared_task(name="classes.mail_homework.send_homework_assigned_emails")
def send_homework_assigned_emails(assignment_id: int) -> dict:
    """Mail every active student of the classroom. Best-effort, per-address isolated."""
    assignment = (
        Assignment.objects.select_related("classroom").filter(pk=assignment_id).first()
    )
    if assignment is None:
        return {"status": "noop", "reason": "missing", "assignment_id": assignment_id}
    if assignment.status != Assignment.STATUS_PUBLISHED:
        # A homework un-published between claim and send has nothing to announce.
        return {"status": "noop", "reason": "not_published", "assignment_id": assignment_id}

    # Gate on the explicit flag, never on EMAIL_BACKEND (see mail_midterm for why).
    if not getattr(settings, "EMAIL_SENDING_ENABLED", False):
        logger.info("homework_email not sent (EMAIL_SENDING_ENABLED off) assignment=%s", assignment_id)
        return {"status": "noop", "reason": "sending_disabled", "assignment_id": assignment_id}

    context = build_context(assignment)
    subject = _subject_line(context)
    text = _text_body(context)
    html = render_to_string("email/homework_assigned.html", context)

    sent = failed = 0
    for student in _recipients(assignment):
        try:
            _send_one(address=student.email, subject=subject, text=text, html=html)
            sent += 1
        except Exception:
            failed += 1
            logger.exception("homework_email failed assignment=%s student=%s", assignment_id, student.pk)
    logger.info("homework_email assignment=%s sent=%s failed=%s", assignment_id, sent, failed)
    return {"status": "ok", "assignment_id": assignment_id, "sent": sent, "failed": failed}


def _deliver_off_thread(assignment_id: int) -> None:
    try:
        send_homework_assigned_emails(assignment_id)
    except Exception:  # pragma: no cover - best-effort; never surface to the request
        logger.exception("inline homework notification failed (assignment_id=%s)", assignment_id)
    finally:
        connection.close()


def enqueue_homework_assigned_emails(assignment_id: int) -> None:
    """Celery when a broker is configured, else a daemon thread scheduled on commit.

    The on_commit hop matters: without it the thread can read the assignment before the
    teacher's transaction commits and mail a homework that never persisted.
    """
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        send_homework_assigned_emails.delay(assignment_id)
        return

    def _spawn() -> None:
        threading.Thread(
            target=_deliver_off_thread,
            args=(assignment_id,),
            name=f"homework-notify-{assignment_id}",
            daemon=True,
        ).start()

    transaction.on_commit(_spawn)


def notify_homework_assigned(assignment: Assignment, *, force: bool = False) -> bool:
    """Claim ``notified_at`` and queue the class email. True when THIS call claimed it.

    Only a PUBLISHED homework is announced — a draft is not yet given to anyone. The claim
    is a conditional UPDATE, not a read-then-save, so two concurrent publishes cannot both
    send. Callers ignore the return value: whether a student's mail went out is never
    something a teacher's request should fail on.
    """
    if assignment is None or assignment.pk is None:
        return False
    if assignment.status != Assignment.STATUS_PUBLISHED:
        return False
    rows = Assignment.objects.filter(pk=assignment.pk)
    if not force:
        rows = rows.filter(notified_at__isnull=True)
    now = timezone.now()
    if not rows.update(notified_at=now):
        return False
    assignment.notified_at = now
    enqueue_homework_assigned_emails(assignment.pk)
    return True
