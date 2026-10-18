from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from . import conf

#: Beat fires once at 10:00; a person re-running it while it is still going is not doubled.
RUNNING_KEY = "sms:debt-warnings-running"


@shared_task(name="sms.tasks.debt_warnings")
def debt_warnings() -> dict:
    """Days 1..LCUP_DEBT_FREEZE_DAY-1: the warning SMS (``sms.debt_warnings``). Every other day the
    plan says "not a warning day" and nothing is sent — the day rule lives in one place, the code."""
    if not conf.debt_warnings_enabled():
        return {"skipped": "disabled"}
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    if not cache.add(RUNNING_KEY, "1", timeout=30 * 60):
        return {"skipped": "already running"}
    try:
        from . import debt_warnings as warnings
        from . import eskiz

        return warnings.send(eskiz.default_client(), timezone.now())
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="sms.tasks.check_statuses")
def check_statuses() -> dict:
    """eskiz's word on what went out in the last two days. With nothing to ask about, no request at
    all — and so no login on an account lc-up shares."""
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    from . import eskiz
    from .delivery import CHECK_WINDOW
    from .delivery import check_statuses as check
    from .models import SmsMessage

    now = timezone.now()
    if not SmsMessage.objects.filter(status=SmsMessage.STATUS_SENT, sent_at__gte=now - CHECK_WINDOW).exists():
        return {"skipped": "nothing to check"}
    return check(eskiz.default_client(), now)
