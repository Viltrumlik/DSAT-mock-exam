"""Issue a pastpaper certificate the moment the paper is finished.

Hung off `post_save` on the attempt rather than called from `complete_test`, for the reason
the reward hooks give: the write paths are plural. An attempt reaches COMPLETED through the
runner, through the auto-submit sweep, and through ops repair commands, and a call edited into
one of them is a call the other two do not make.

Safe because issuance is idempotent on the attempt — the signal fires on every save of the
row and the common case writes nothing at all.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender="exams.TestAttempt", dispatch_uid="pastpaper_certificate_issue")
def _on_test_attempt_saved(sender, instance, **kwargs):
    from .pastpaper_certificate import maybe_issue

    # `maybe_issue` swallows its own failures; this second guard is for anything that could
    # go wrong before it is even entered (a deleted practice_test, say).
    try:
        maybe_issue(instance)
    except Exception:
        logger.exception("pastpaper_certificate_signal_failed attempt=%s", instance.pk)
