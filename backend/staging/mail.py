"""The test copy's e-mail backend (``EMAIL_BACKEND=staging.mail.CaptureEmailBackend`` in its environment).

It never sends. On the copy each message is written to the toolbox's Messages; anywhere else (the backend named by
mistake on prod) it logs a warning and sends nothing, so a wrong environment loses mail rather than leaking it."""

from __future__ import annotations

import logging

from django.core.mail.backends.base import BaseEmailBackend

from .outbound import capture, captured

logger = logging.getLogger(__name__)


class CaptureEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages) -> int:
        messages = list(email_messages or [])
        if not captured():
            logger.warning(
                "staging.mail.CaptureEmailBackend is set outside the test copy: %s message(s) not sent", len(messages)
            )
            return 0
        for message in messages:
            capture(
                "email",
                ", ".join(message.recipients()),
                message.body,
                subject=message.subject,
                meta={"from": message.from_email},
            )
        return len(messages)
