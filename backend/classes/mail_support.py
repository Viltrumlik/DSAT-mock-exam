"""Email a student that a classmate has added them to a support session.

The bell tells a student who is on the site; this tells one who is not. Both are sent, and
neither waits for the other — see ``support._announce_invitation``.

Structured like ``mail_midterm`` and ``mail_homework``: a pure context builder, a plain-text
body derived from the same context, and a Celery task that does the sending off the request
thread. There is no ``notified_at`` claim here, unlike homework, because an invitation is
addressed to one person and created by one act — the booking row's own existence is the claim,
and the invite path refuses a second invitation for a seat that is already taken.
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from core.mail import brand_context
from users.email_utils import is_deliverable_email

from .models_support import SupportBooking

logger = logging.getLogger(__name__)

#: The student-facing support page. Relative here and made absolute in the context, because
#: an email client has no origin to resolve a bare path against.
_SUPPORT_PATH = "/support"


def _name(user) -> str:
    full = (getattr(user, "get_full_name", lambda: "")() or "").strip()
    return full or (getattr(user, "username", "") or "").strip() or "A classmate"


def build_context(booking: SupportBooking, inviter) -> dict:
    """Everything both bodies need, in the recipient's local time.

    ``localtime`` rather than the raw UTC datetime: a student reading "13:00" has to be able
    to turn up at 13:00, and this school is one timezone.
    """
    slot = booking.availability
    starts = timezone.localtime(slot.starts_at)
    ends = timezone.localtime(slot.ends_at) if slot.ends_at else None
    site = str(getattr(settings, "EMAIL_SITE_URL", "https://mastersat.uz")).rstrip("/")

    return brand_context(
        inviter_name=_name(inviter),
        teacher_name=_name(slot.support_teacher),
        student_name=_name(booking.student),
        topic=(booking.topic or "").strip(),
        month_label=starts.strftime("%b").upper(),
        day_number=starts.strftime("%d").lstrip("0"),
        weekday_label=starts.strftime("%A"),
        # The date chip is 88px wide, so it gets the short form — "WEDNESDAY" overflows
        # it. The full name stays in the preheader and the body, where there is room.
        weekday_short=starts.strftime("%a").upper(),
        date_label=starts.strftime("%d %B"),
        start_time=starts.strftime("%H:%M"),
        end_time=ends.strftime("%H:%M") if ends else "",
        timezone_label=starts.strftime("%Z") or "local",
        support_url=f"{site}{_SUPPORT_PATH}",
    )


def _text_body(context: dict) -> str:
    lines = [
        f"{context['inviter_name']} added you to a support session.",
        "",
        f"{context['weekday_label']} {context['date_label']} at {context['start_time']}"
        + (f" (ends {context['end_time']})" if context["end_time"] else ""),
        f"With {context['teacher_name']}.",
    ]
    if context["topic"]:
        lines += ["", f"About: {context['topic']}"]
    lines += [
        "",
        "Nothing to accept — just turn up.",
        f"See the session: {context['support_url']}",
        "",
        "Can't make it? Cancel it on the support page so the hour goes back to somebody else.",
        "",
        "This message was sent automatically; please do not reply to it.",
    ]
    return "\n".join(lines)


@shared_task(name="classes.mail_support.send_support_invitation_email")
def send_support_invitation_email_task(booking_id: int, inviter_id: int) -> dict:
    """Send it. Best-effort: an invitation that was accepted must not be undone by a mailbox."""
    from django.contrib.auth import get_user_model

    booking = (
        SupportBooking.objects.select_related(
            "availability", "availability__support_teacher", "student"
        )
        .filter(pk=booking_id)
        .first()
    )
    if booking is None:
        return {"status": "noop", "reason": "missing", "booking_id": booking_id}

    address = getattr(booking.student, "email", None)
    if not is_deliverable_email(address):
        # A large share of this school signed up through Telegram and has no address. Not an
        # error — they were told in the bell, which is the channel that does not need one.
        return {"status": "noop", "reason": "no_address", "booking_id": booking_id}
    if not getattr(settings, "EMAIL_SENDING_ENABLED", False):
        return {"status": "noop", "reason": "disabled", "booking_id": booking_id}

    inviter = get_user_model().objects.filter(pk=inviter_id).first()
    context = build_context(booking, inviter)
    html = render_to_string("email/support_invitation.html", context)
    text = _text_body(context)

    try:
        msg = EmailMultiAlternatives(
            subject=f"{context['inviter_name']} added you to a support session",
            body=text,
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
            to=[address],
        )
        msg.attach_alternative(html, "text/html")
        msg.send(fail_silently=False)
    except Exception:
        logger.warning("support_invitation_email_failed booking=%s", booking_id)
        return {"status": "error", "booking_id": booking_id}
    return {"status": "sent", "booking_id": booking_id}


def send_support_invitation_email(booking: SupportBooking, inviter) -> None:
    """Queue the send. Called from ``support.invite_member`` on commit.

    Queued rather than sent inline for the same reason the homework mail is: a student adding
    a classmate should not wait on an SMTP round trip, and a mailbox that is down must not
    turn a successful booking into a 500.
    """
    booking_id = booking.pk
    inviter_id = getattr(inviter, "pk", None)

    def _spawn():
        try:
            send_support_invitation_email_task.delay(booking_id, inviter_id)
        except Exception:
            # No broker configured (dev, and any install without Celery). Sending inline here
            # would block the request; skipping is the honest degradation, and the in-app
            # notification has already landed.
            logger.info("support_invitation_email_not_queued booking=%s", booking_id)

    transaction.on_commit(_spawn)
