from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from . import conf

#: One run at a time: the beat, a retry and "Send now" from /ops/sms are never doubled.
RUNNING_KEY = "sms:debt-warnings-running"
#: After the hour set in /ops/sms, this many hourly runs send again only what never left (FAILED).
RETRY_HOURS = 2


@shared_task(name="sms.tasks.debt_warnings_tick")
def debt_warnings_tick() -> dict:
    """Every hour at :00. At ``SmsSettings.debt_hour`` (10:00 unless /ops/sms changed it) the warning
    run; the next RETRY_HOURS hours only what that run could not get out — never a new warning, the
    owner's time is the hour he set. Days 1..LCUP_DEBT_FREEZE_DAY-1 it warns; on any other day the
    plan says "not a warning day" and nothing is sent — the day rule lives in one place, the code."""
    return _tick(timezone.now())


def _tick(now) -> dict:
    from . import switchboard

    hour, start = timezone.localtime(now).hour, switchboard.current().debt_hour
    if hour == start:
        return _warn(retry_only=False)
    if start < hour <= start + RETRY_HOURS:
        return _warn(retry_only=True)
    return {"skipped": "not the hour"}


@shared_task(name="sms.tasks.debt_warnings_now")
def debt_warnings_now() -> dict:
    """"Send now" from /ops/sms: today's warning run, at once, through the same ``send``. Whatever it
    sent, today's later scheduled run finds the rows and sends nothing again."""
    return _send_now(timezone.now())


def _send_now(now) -> dict:
    from . import debt_warnings as warnings

    if not warnings.switched_on():
        return {"skipped": "disabled"}
    if not warnings.is_warning_day(timezone.localdate(now)):
        return {"skipped": "not a warning day"}
    return _warn(retry_only=False)


@shared_task(name="sms.tasks.debt_warnings")
def debt_warnings() -> dict:
    """The warning run by hand (``celery call``); the beat uses ``debt_warnings_tick``."""
    return _warn(retry_only=False)


@shared_task(name="sms.tasks.retry_debt_warnings")
def retry_debt_warnings() -> dict:
    """Only what today's run could not get out (FAILED) goes again — never a new warning, and never
    one that may already have left. By hand; the beat's retries are ``debt_warnings_tick``'s."""
    return _warn(retry_only=True)


def _warn(*, retry_only: bool) -> dict:
    from . import switchboard

    if not switchboard.debt_enabled():
        return {"skipped": "disabled"}
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    if not cache.add(RUNNING_KEY, "1", timeout=30 * 60):
        return {"skipped": "already running"}
    try:
        from . import debt_warnings as warnings
        from . import eskiz

        return warnings.send(eskiz.default_client(), timezone.now(), retry_only=retry_only)
    finally:
        cache.delete(RUNNING_KEY)


@shared_task(name="sms.tasks.sync_templates")
def sync_templates() -> dict:
    """09:00: eskiz's template list into ``EskizTemplate``, so a template moderated overnight shows in
    /ops/sms. One read; a login only if no token is cached."""
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    from . import eskiz, eskiz_templates

    try:
        return eskiz_templates.sync(eskiz.default_client())
    except eskiz.EskizError as exc:
        return {"error": str(exc)}


@shared_task(name="sms.tasks.send_due_campaigns")
def send_due_campaigns() -> dict:
    """Every minute, and at once after a "now" campaign is created: every campaign whose time has
    come goes out, each claimed once (``campaigns.dispatch_due``). Nothing due, no client at all."""
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    from . import campaigns, eskiz

    now = timezone.now()
    if not campaigns.due(now).exists():
        return {"skipped": "nothing due"}
    return {"sent": campaigns.dispatch_due(eskiz.default_client(), now)}


@shared_task(name="sms.tasks.retry_campaign")
def retry_campaign(campaign_id: int) -> dict:
    """"Retry failed" on a campaign: its SMS that never left go again (``campaigns.retry_failed``)."""
    if not conf.is_configured():
        return {"skipped": "eskiz is not configured"}
    from . import campaigns, eskiz
    from .models import SmsCampaign

    campaign = SmsCampaign.objects.filter(pk=campaign_id).select_related("created_by").first()
    if campaign is None:
        return {"skipped": "no such campaign"}
    try:
        return {"sent_again": campaigns.retry_failed(campaign, eskiz.default_client())}
    except campaigns.CampaignRefused as exc:
        return {"skipped": exc.code}


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
