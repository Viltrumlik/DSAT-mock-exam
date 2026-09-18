"""The four emails an event sends.

Shape copied from ``classes/mail_homework.py``: a pure context builder, a plain-text body
derived from the same context, a Celery task that sends off the request thread, and an
enqueue helper that falls back to a daemon thread when no broker is configured.

Two things differ, and both follow from the size of the audience. The announcement goes to
every student in the learning center — about 370 addresses — so the fan-out reuses ONE SMTP
connection rather than opening one per message, and the announcement alone skips students who
muted Events. The other three are about a seat the student is holding, so they go whatever
that switch says.
"""

from __future__ import annotations

import logging
import threading

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import connection as db_connection
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from core.mail import brand_context
from notifications import constants as note_const
from notifications.models import NotificationPreference
from users.email_utils import is_deliverable_email

from .models import Event

logger = logging.getLogger(__name__)

KIND_ANNOUNCEMENT = "announcement"
KIND_REMINDER = "reminder"
KIND_CHANGED = "changed"
KIND_CANCELLED = "cancelled"

_TEMPLATES = {
    KIND_ANNOUNCEMENT: "email/event_announcement.html",
    KIND_REMINDER: "email/event_reminder.html",
    KIND_CHANGED: "email/event_changed.html",
    KIND_CANCELLED: "email/event_cancelled.html",
}

#: The student-facing page. Relative here, absolute in the context: an email client has no
#: origin to resolve a bare path against.
_EVENTS_PATH = "/events"


def build_context(event: Event) -> dict:
    """Everything all four bodies need, in the reader's local time.

    The XP is read from the rule table at send time. A number written into the copy is a
    promise the ledger stops keeping the first time the learning center retunes it.
    """
    from rewards import constants as reward_const
    from rewards.services import pricing_for

    from .services import CANCEL_CUTOFF

    starts = timezone.localtime(event.starts_at)
    ends = timezone.localtime(event.ends_at)
    cancel_by = timezone.localtime(event.starts_at - CANCEL_CUTOFF)
    site = str(getattr(settings, "EMAIL_SITE_URL", "https://mastersat.uz")).rstrip("/")
    points, grants_xp = pricing_for(reward_const.EVENT_ATTENDED)
    seats = int(event.seats)
    # Named for the reader, not the offset: "+05" tells nobody in Fergana or Tashkent what
    # time they are reading, and %Z is not dependable across platforms for a zoneinfo name
    # in the first place.
    tz_name = str(getattr(settings, "TIME_ZONE", "Asia/Tashkent"))
    timezone_label = tz_name.rsplit("/", 1)[-1].replace("_", " ") or "local"

    return brand_context(
        event_title=event.title,
        description=(event.description or "").strip(),
        location=(event.location or "").strip(),
        month_label=starts.strftime("%b").upper(),
        day_number=starts.strftime("%d").lstrip("0"),
        # Short and uppercase: a spelled-out weekday overflows the 88px date chip.
        weekday_short=starts.strftime("%a").upper(),
        weekday_label=starts.strftime("%A"),
        # `starts.day` is never zero-padded: "3 October", never "03 October".
        date_label=f"{starts.day} {starts.strftime('%B')}",
        start_time=starts.strftime("%H:%M"),
        end_time=ends.strftime("%H:%M"),
        timezone_label=timezone_label,
        # With its day: the cancel deadline is not always on the event's own date.
        cancel_by_label=cancel_by.strftime("%a %d %b, %H:%M").replace(" 0", " "),
        seats=seats,
        seats_word="seat" if seats == 1 else "seats",
        xp_points=int(points),
        # Whether this earning also carries XP, per the same rule row `pricing_for` prices
        # it from — a rule the learning center has switched off (see `RewardRule.grants_xp`)
        # still pays points, and the copy must not promise XP it does not grant.
        grants_xp=bool(grants_xp),
        # Through the redirect, not the signed URL: media is private and every `.url`
        # expires within the hour, so a signed link in an inbox breaks by lunchtime.
        cover_url=f"{site}/api/events/{event.pk}/cover/" if event.cover_image else "",
        events_url=f"{site}{_EVENTS_PATH}",
    )


def subject_for(kind: str, context: dict) -> str:
    title = context["event_title"]
    if kind == KIND_ANNOUNCEMENT:
        return f"New event: {title}"
    if kind == KIND_REMINDER:
        return f"Reminder: {title}, {context['date_label']} at {context['start_time']}"
    if kind == KIND_CHANGED:
        return f"Event updated: {title}"
    return f"Event cancelled: {title}"


def _text_body(kind: str, context: dict) -> str:
    when = (
        f"{context['weekday_label']} {context['date_label']} at {context['start_time']} "
        f"(ends {context['end_time']}, {context['timezone_label']} time)"
    )
    place = f"Where: {context['location']}" if context["location"] else ""
    lines = [subject_for(kind, context), "", when]
    if place:
        lines.append(place)

    if kind == KIND_ANNOUNCEMENT:
        lines += ["", f"{context['seats']} {context['seats_word']}."]
        if context["xp_points"]:
            unit = "XP" if context.get("grants_xp") else "points"
            lines.append(f"Coming earns you {context['xp_points']} {unit}.")
        if context["description"]:
            lines += ["", context["description"]]
        lines += ["", f"Sign up: {context['events_url']}"]
    elif kind == KIND_REMINDER:
        # No promise of a ticket here: tickets are built in a later, separate PR, and until
        # that ships "Open my ticket" would point at nothing.
        lines += [
            "",
            f"Can't come? Cancel by {context['cancel_by_label']} so someone else can take "
            "your seat.",
            "",
            f"See the event: {context['events_url']}",
        ]
    elif kind == KIND_CHANGED:
        lines += ["", "That's the new time and place.", "", f"See it: {context['events_url']}"]
    else:
        lines += [
            "",
            "This event has been cancelled and your registration has been closed.",
            "",
            f"Other events: {context['events_url']}",
        ]

    lines += ["", "This message was sent automatically; please do not reply to it."]
    return "\n".join(line for line in lines if line is not None)


def _mailable(students, *, skip_muted: bool):
    """The students an email can actually reach.

    Telegram signups have no address and are dropped here rather than failing at send time —
    they are not dropped from the bell. `skip_muted` is the announcement's alone.
    """
    reachable = [s for s in students if is_deliverable_email(getattr(s, "email", None))]
    if not skip_muted or not reachable:
        return reachable
    muted = {
        pref.user_id
        for pref in NotificationPreference.objects.filter(
            user_id__in=[s.pk for s in reachable]
        ).only("user", "muted_categories")
        if pref.is_muted(note_const.CATEGORY_EVENTS)
    }
    return [s for s in reachable if s.pk not in muted]


def _send_batch(recipients, *, subject: str, text: str, html: str) -> dict:
    """One message per address over ONE connection. Each send isolated.

    The announcement is the first message this codebase sends to every student at once. A
    connection per message would have the worker — which runs `--concurrency 2` — holding a
    slot for several minutes while it shook hands with Mailgun 370 times.
    """
    if not recipients:
        return {"sent": 0, "failed": 0}

    sent = failed = 0
    connection = get_connection()
    try:
        connection.open()
    except Exception:
        logger.exception("event_email connection failed")
        return {"sent": 0, "failed": len(recipients)}
    try:
        for student in recipients:
            message = EmailMultiAlternatives(
                subject=subject,
                body=text,
                from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
                to=[student.email],
                connection=connection,
            )
            message.attach_alternative(html, "text/html")
            try:
                message.send(fail_silently=False)
                sent += 1
            except Exception:
                # A dropped connection leaves the backend holding a dead socket, after which
                # `.open()` is a no-op and every remaining message in the batch would fail
                # with it — losing the rest of an ~370-student announcement for good, since
                # publish only fires this once. Close it, reopen a fresh one, and give THIS
                # message a single retry before it counts as failed.
                logger.warning(
                    "event_email send failed, retrying once student=%s", student.pk
                )
                try:
                    connection.close()
                except Exception:
                    pass
                try:
                    connection.open()
                    message.send(fail_silently=False)
                    sent += 1
                except Exception:
                    failed += 1
                    logger.exception("event_email failed student=%s", student.pk)
    finally:
        connection.close()
    return {"sent": sent, "failed": failed}


def _render(event: Event, kind: str):
    context = build_context(event)
    return (
        subject_for(kind, context),
        _text_body(kind, context),
        render_to_string(_TEMPLATES[kind], context),
    )


def _live_event(event_id: int, *, statuses) -> Event | None:
    event = Event.objects.filter(pk=event_id).first()
    if event is None or event.status not in statuses:
        return None
    return event


def _students_by_id(student_ids):
    from django.contrib.auth import get_user_model

    rows = get_user_model().objects.filter(pk__in=list(student_ids))
    by_id = {u.pk: u for u in rows}
    return [by_id[pk] for pk in student_ids if pk in by_id]


def _sending_on() -> bool:
    # Gate on the explicit flag, never on EMAIL_BACKEND: Django always supplies one, so
    # checking it opens an SMTP connection to a host with no MTA.
    return bool(getattr(settings, "EMAIL_SENDING_ENABLED", False))


@shared_task(name="events.mail.send_event_announcement_emails")
def send_event_announcement_emails(event_id: int) -> dict:
    from . import services

    event = _live_event(event_id, statuses={Event.STATUS_PUBLISHED})
    if event is None:
        return {"status": "noop", "reason": "not_published", "event_id": event_id}
    if not _sending_on():
        return {"status": "noop", "reason": "sending_disabled", "event_id": event_id}

    subject, text, html = _render(event, KIND_ANNOUNCEMENT)
    stats = _send_batch(
        _mailable(services.active_students(), skip_muted=True),
        subject=subject, text=text, html=html,
    )
    logger.info("event_announcement_email event=%s %s", event_id, stats)
    return {"status": "ok", "event_id": event_id, **stats}


@shared_task(name="events.mail.send_event_changed_emails")
def send_event_changed_emails(event_id: int) -> dict:
    from . import services

    event = _live_event(event_id, statuses={Event.STATUS_PUBLISHED})
    if event is None:
        return {"status": "noop", "reason": "not_published", "event_id": event_id}
    if not _sending_on():
        return {"status": "noop", "reason": "sending_disabled", "event_id": event_id}

    subject, text, html = _render(event, KIND_CHANGED)
    stats = _send_batch(
        _mailable(services.registered_students(event), skip_muted=False),
        subject=subject, text=text, html=html,
    )
    return {"status": "ok", "event_id": event_id, **stats}


@shared_task(name="events.mail.send_event_cancelled_emails")
def send_event_cancelled_emails(event_id: int, student_ids) -> dict:
    # The seats are already closed by the time this runs, so the recipients are passed in.
    event = _live_event(event_id, statuses={Event.STATUS_CANCELLED})
    if event is None:
        return {"status": "noop", "reason": "not_cancelled", "event_id": event_id}
    if not _sending_on():
        return {"status": "noop", "reason": "sending_disabled", "event_id": event_id}

    subject, text, html = _render(event, KIND_CANCELLED)
    stats = _send_batch(
        _mailable(_students_by_id(student_ids), skip_muted=False),
        subject=subject, text=text, html=html,
    )
    return {"status": "ok", "event_id": event_id, **stats}


@shared_task(name="events.mail.send_event_reminder_emails")
def send_event_reminder_emails(event_id: int, student_ids) -> dict:
    event = _live_event(event_id, statuses={Event.STATUS_PUBLISHED})
    if event is None:
        return {"status": "noop", "reason": "not_published", "event_id": event_id}
    if not _sending_on():
        return {"status": "noop", "reason": "sending_disabled", "event_id": event_id}

    subject, text, html = _render(event, KIND_REMINDER)
    stats = _send_batch(
        _mailable(_students_by_id(student_ids), skip_muted=False),
        subject=subject, text=text, html=html,
    )
    return {"status": "ok", "event_id": event_id, **stats}


def _enqueue(task, *args) -> None:
    """Celery when a broker is configured, else a daemon thread scheduled on commit.

    The on_commit hop matters for the thread path: without it the thread can read the event
    before the ops console's transaction commits and mail one that never persisted.
    """
    broker = str(getattr(settings, "CELERY_BROKER_URL", "") or "").strip()
    eager = bool(getattr(settings, "CELERY_TASK_ALWAYS_EAGER", False))
    if broker or eager:
        task.delay(*args)
        return

    def _run() -> None:
        try:
            task(*args)
        except Exception:  # pragma: no cover - best effort; never surface to the request
            logger.exception("inline event email failed task=%s args=%s", task.name, args)
        finally:
            db_connection.close()

    def _spawn() -> None:
        threading.Thread(target=_run, name=f"event-mail-{args[0]}", daemon=True).start()

    transaction.on_commit(_spawn)


def enqueue_event_announcement(event_id: int) -> None:
    _enqueue(send_event_announcement_emails, event_id)


def enqueue_event_changed(event_id: int) -> None:
    _enqueue(send_event_changed_emails, event_id)


def enqueue_event_cancelled(event_id: int, student_ids) -> None:
    _enqueue(send_event_cancelled_emails, event_id, list(student_ids))


def enqueue_event_reminder(event_id: int, student_ids) -> None:
    _enqueue(send_event_reminder_emails, event_id, list(student_ids))
