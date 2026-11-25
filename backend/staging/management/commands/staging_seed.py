"""``manage.py staging_seed [--json]`` — what the test copy needs after each fresh copy of prod. The time machine's
"Refresh from prod" runs it; running it again changes nothing. Only on the copy (``staging.guard.toolbox_on``).

Today that is the balance warnings (Part D, the balance SMS), where that code is installed: eskiz never sees the copy,
so their two templates are made here as eskiz would list them once approved, the SMS settings point at them, and the
panel's switch is on (``SMS_BALANCE_WARNINGS_ENABLED`` in the environment still has the last word).

The templates' ids are far above any eskiz gives, so they never meet a real template. They cannot be negative:
``EskizTemplate.eskiz_id`` is a PositiveIntegerField, which the database checks (``eskiz_id >= 0``)."""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from staging.guard import toolbox_on

LOW_TEMPLATE_ID = 2_000_001_001
FROZEN_TEMPLATE_ID = 2_000_001_002
#: The texts proposed for eskiz's moderation (plan, Design §5).
LOW_PATTERN = (
    "MASTER SAT: %w{1,4} hisobingizda %w{1,3} so'm qoldi. Darslar to'xtab qolmasligi uchun hisobni to'ldiring "
    "(kamida 160 000 so'm)."
)
FROZEN_PATTERN = (
    "MASTER SAT: %w{1,4} hisobingiz minusga tushgani uchun darslarga kirish to'xtatildi. Hisobni to'ldirsangiz darhol "
    "ochiladi (kamida 160 000 so'm)."
)
#: What fills the slots, in order. A template names one role a slot, so the frozen text (one slot) takes the first.
ROLES = ("student", "balance")
#: ``SmsSettings``' fields for the balance warnings (Part D).
BALANCE_FIELDS = (
    "balance_enabled", "low_template_id", "low_pattern", "low_slots", "frozen_template_id", "frozen_pattern",
    "frozen_slots",
)


def balance_warnings_installed() -> bool:
    from sms.models import SmsSettings

    return all(hasattr(SmsSettings, name) for name in BALANCE_FIELDS)


def slots_for(pattern: str) -> list[str]:
    from sms import templates as T

    return list(ROLES[: len(T.slots(pattern))])


def ensure_templates() -> list[int]:
    """The two templates, as eskiz would list them once approved; the same two rows however often it runs."""
    from sms.models import EskizTemplate

    now = timezone.now()
    for eskiz_id, pattern, alias in (
        (LOW_TEMPLATE_ID, LOW_PATTERN, "TEST: balance low"),
        (FROZEN_TEMPLATE_ID, FROZEN_PATTERN, "TEST: frozen"),
    ):
        EskizTemplate.objects.update_or_create(
            eskiz_id=eskiz_id,
            defaults={"pattern": pattern, "original": pattern, "status": EskizTemplate.STATUS_SERVICE, "alias": alias,
                      "synced_at": now},
        )
    return [LOW_TEMPLATE_ID, FROZEN_TEMPLATE_ID]


def seed() -> dict:
    if not balance_warnings_installed():
        return {"templates": [], "balance_enabled": None, "skipped": "the balance warnings are not installed"}
    from sms.models import SmsSettings

    ids = ensure_templates()
    row = SmsSettings.get()
    SmsSettings.objects.filter(pk=row.pk).update(
        low_template_id=LOW_TEMPLATE_ID, low_pattern=LOW_PATTERN, low_slots=slots_for(LOW_PATTERN),
        frozen_template_id=FROZEN_TEMPLATE_ID, frozen_pattern=FROZEN_PATTERN, frozen_slots=slots_for(FROZEN_PATTERN),
        balance_enabled=True,
    )
    return {"templates": ids, "balance_enabled": True}


class Command(BaseCommand):
    help = "The test copy only: what it needs after a fresh copy of prod (the balance warnings' templates)."

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="Print the result as one JSON line.")

    def handle(self, *args, **options):
        if not toolbox_on():
            raise CommandError("staging_seed runs only on the test copy (STAGING_TOOLBOX and its own database).")
        result = seed()
        self.stdout.write(json.dumps(result, ensure_ascii=False) if options["json"] else str(result))
