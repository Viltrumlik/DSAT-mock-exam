"""Tell a classroom's students that homework has been assigned to them.

Two legs, one announcement. ``notify_homework_assigned`` is the single entry point every
path that creates a live Assignment calls, and it does two things:

* writes an **in-app notification** — the bell — for every active student, and
* queues the **class email** for the ones who have a deliverable address.

They are deliberately not the same delivery. The email is gated on
``EMAIL_SENDING_ENABLED`` (off everywhere except production) and on
``is_deliverable_email`` (a large share of this school signed up through Telegram and has
no address at all); the bell is gated on neither, because "homework was set" has to be
visible to the people it was set for even when nothing can be posted to them.

What the two legs DO share is the claim. The send is claimed with a conditional UPDATE on
``Assignment.notified_at`` so two concurrent requests cannot both announce the class, and
so re-publishing an unarchived homework never announces it a second time. The claim is
taken *before* either leg and independently of ``EMAIL_SENDING_ENABLED``, so an
email-disabled install still claims, still rings the bell, and simply skips the mailbox.

The email fan-out runs off the request thread (Celery when a broker is configured, else a
daemon thread scheduled on commit) so a teacher setting homework never waits on the class's
mailboxes. The bell does not: see ``send_homework_assigned_notifications``.

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
# Used for both the email button and the notification's link_url — a notification's
# link_url is RELATIVE and resolves inside the recipient's own console, and every
# recipient here is a student, so this one path is correct for all of them.
_DETAIL_PATH = "/classes/{classroom_id}/assignments/{assignment_id}"

# Instructions are shown in full on the page; the email carries a readable preview only.
_INSTRUCTIONS_PREVIEW_CHARS = 320

# Hard limits from notifications.Notification. Truncating here rather than letting the
# field do it keeps a 200-char homework title from raising on a 160-char column.
_NOTIFICATION_TITLE_CHARS = 160
_NOTIFICATION_BODY_CHARS = 400


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
def _active_students(assignment: Assignment) -> list:
    """Everybody this homework was actually given to.

    The membership gate for BOTH legs, kept in one place so the bell and the mailbox can
    never disagree about who is in the class. Only students (never the teaching team), and
    only ACTIVE memberships — a REMOVED student has been taken off this class and an
    INVITED one has not joined it yet; neither is doing this homework.
    """
    members = ClassroomMembership.objects.filter(
        classroom_id=assignment.classroom_id,
        role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    ).select_related("user")
    return [m.user for m in members]


def _recipients(assignment: Assignment) -> list:
    """The subset of ``_active_students`` an email can actually reach.

    Telegram signups with no address are dropped here rather than failing at send time.
    This filter is the mailbox's alone — a student with no address is still in the class
    and still gets the bell.
    """
    return [
        u for u in _active_students(assignment)
        if is_deliverable_email(getattr(u, "email", None))
    ]


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


# ── in-app bell ──────────────────────────────────────────────────────────────
def _notification_title(assignment: Assignment) -> str:
    """"New homework: Unit 4 practice set" — the category, then what it is called.

    The category leads because a student triages the bell on it: a quiz landing is a
    different evening from classwork landing.
    """
    label = _CATEGORY_LABELS.get(assignment.category, "Homework").lower()
    return f"New {label}: {assignment.title}"[:_NOTIFICATION_TITLE_CHARS]


def _notification_body(assignment: Assignment) -> str:
    """Which class, and when it closes — the two facts a student plans around.

    A deadline-free homework (classwork, or a classroom with no readable lesson schedule)
    says nothing rather than inventing a date; ``due_at`` is genuinely null there and a
    fabricated deadline would be worse than none.
    """
    parts = [assignment.classroom.name]
    due = assignment.due_at
    if due:
        local = timezone.localtime(due)
        # " 0" → " " strips the leading zero from the day only; the clock keeps its own.
        date_text = local.strftime("%a %d %b").replace(" 0", " ")
        parts.append(f"due {date_text} at {local.strftime('%H:%M')}")
    return " · ".join(p for p in parts if p)[:_NOTIFICATION_BODY_CHARS]


def send_homework_assigned_notifications(assignment_id: int) -> int:
    """Ring the in-app bell for every active student. Returns how many were told.

    Not a Celery task, unlike its email twin, and that asymmetry is the point. The bell is
    the *guaranteed* leg of delivery — ``notifications.services`` writes the row first and
    treats the realtime hint and the phone push as best-effort on top of it — so a worker
    outage must not be able to swallow it. That is affordable because ``notify_many`` is
    set-shaped: a class costs a fixed handful of queries however many students are in it.
    Posting N emails is not affordable in a request, which is why only the mailbox is
    handed off.

    The ``dedupe_key`` is a callable rather than a string because it names the student as
    well as the homework; the callable form exists precisely so a per-recipient key can
    still ride the bulk path.
    """
    from notifications import constants as note_const
    from notifications.services import notify_many

    assignment = (
        Assignment.objects.select_related("classroom").filter(pk=assignment_id).first()
    )
    if assignment is None:
        return 0
    if assignment.status != Assignment.STATUS_PUBLISHED:
        # Un-published between the claim and here: there is nothing to announce.
        return 0

    try:
        students = _active_students(assignment)
    except Exception:  # pragma: no cover - defensive
        # notify_many swallows its own failures; resolving the roster is our own query and
        # would otherwise surface into whatever just created the homework.
        logger.exception("homework_notification roster failed assignment=%s", assignment_id)
        return 0
    if not students:
        return 0

    told = notify_many(
        students,
        event=note_const.EVENT_HOMEWORK_ASSIGNED,
        title=_notification_title(assignment),
        body=_notification_body(assignment),
        link_url=_DETAIL_PATH.format(
            classroom_id=assignment.classroom_id, assignment_id=assignment.pk
        ),
        # Names the homework AND the student, so re-running any of the four assign paths
        # over the same row is a no-op rather than a second bell.
        dedupe_key=lambda student: f"assigned:{assignment.pk}:{student.pk}",
    )
    logger.info(
        "homework_notification assignment=%s students=%s told=%s",
        assignment_id, len(students), told,
    )
    return told


def _notify_in_app_safely(assignment_id: int) -> None:
    try:
        send_homework_assigned_notifications(assignment_id)
    except Exception:  # pragma: no cover - best-effort; never surface to the caller
        logger.exception("in-app homework notification failed (assignment_id=%s)", assignment_id)


def enqueue_homework_assigned_notifications(assignment_id: int) -> None:
    """Ring the bell once the caller's transaction has actually committed.

    ``journals.delivery`` calls the assign path from inside a ``select_for_update`` block,
    so the assignment is not yet visible to anything else at claim time; without the
    on_commit hop the fan-out could read a homework that never persisted. Outside a
    transaction ``on_commit`` runs the callback immediately, so the two request paths that
    are already in autocommit pay nothing for the hop.
    """
    transaction.on_commit(lambda: _notify_in_app_safely(assignment_id))


def notify_homework_assigned(assignment: Assignment, *, force: bool = False) -> bool:
    """Announce a homework to its class: bell for everyone, email for the reachable.

    THE single entry point — every path that puts a live Assignment in front of students
    (``AssignmentViewSet.create``/``.publish``, the journal homework release, the journal
    classwork carrier, and the assessment assign view) calls this and nothing else, so
    there is exactly one place that decides who is told and what they are told.

    Returns True when THIS call claimed the announcement. Only a PUBLISHED homework is
    announced — a draft is not yet given to anyone. The claim is a conditional UPDATE, not
    a read-then-save, so two concurrent publishes cannot both announce, and it gates BOTH
    legs: a re-publish must not re-ring the bell any more than it re-mails the class.

    Note what the claim is *not*: it is taken before either leg and without consulting
    ``EMAIL_SENDING_ENABLED``, so an install with email switched off still claims and still
    notifies. (Gating the claim on the email settings would have made the bell silent
    everywhere the mailbox is.)

    Callers ignore the return value: whether a student was told is never something a
    teacher's request should fail on.
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
    enqueue_homework_assigned_notifications(assignment.pk)
    enqueue_homework_assigned_emails(assignment.pk)
    return True
