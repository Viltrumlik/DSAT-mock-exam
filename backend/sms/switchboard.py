"""What /ops/sms has set, read in one place: the debt warning's switch, hour and templates, and the
price an estimate is counted at.

``SMS_DEBT_WARNINGS_ENABLED`` (env) stays the master switch: with it off nothing goes out, whatever
the panel says — the one way to stop every warning without a person reaching the panel. With it on,
``SmsSettings.debt_enabled`` decides. The templates are the patterns copied into ``SmsSettings``
when an admin picked them; until then they are #64942 / #52393, the texts live since #300.
"""

from __future__ import annotations

from django.conf import settings

from . import conf
from . import templates as T
from .models import EskizTemplate, SmsSettings

#: eskiz's price for one SMS part, in so'm, measured on 2026-10-18; ``SMS_PRICE_PER_PART`` overrides it.
DEFAULT_PRICE_PER_PART = 170
#: The values a debt warning can fill: it goes to every debtor at once, so nothing is typed in.
DEBT_ROLES = frozenset({T.ROLE_STUDENT, T.ROLE_DEBT})
#: lc-up's "(STUDENT), sizda…": what #64942 and #52393 put after the name, and the answer while a
#: template's original text is not cached.
LIVE_NAME_SUFFIX = ","


def current() -> SmsSettings:
    return SmsSettings.get()


def env_enabled() -> bool:
    return conf.debt_warnings_enabled()


def debt_enabled(row: SmsSettings | None = None) -> bool:
    return env_enabled() and (row or current()).debt_enabled


def debt_templates(row: SmsSettings | None = None) -> tuple[T.SmsTemplate, T.SmsTemplate]:
    """(the warning, the last day's). Raises ``TemplateError`` when a pattern and its slots disagree."""
    row = row or current()
    return (
        T.SmsTemplate("debt_warning", row.warning_pattern, tuple(row.warning_slots or ())),
        T.SmsTemplate("debt_last_day", row.last_day_pattern, tuple(row.last_day_slots or ())),
    )


def name_suffix(template_id: int, template: T.SmsTemplate) -> str:
    """The punctuation after the student's name in ``template``, read from the text lc-up submitted
    (``EskizTemplate.original``): "," for "(STUDENT), sizda", "!" for "(STUDENT)!"."""
    original = EskizTemplate.objects.filter(eskiz_id=template_id).values_list("original", flat=True).first()
    if not original or T.ROLE_STUDENT not in template.slots or not T.placeholders_match(original, template.text):
        return LIVE_NAME_SUFFIX
    return T.role_suffixes(original, template.text)[template.slots.index(T.ROLE_STUDENT)]


def price_per_part() -> int:
    try:
        price = int(getattr(settings, "SMS_PRICE_PER_PART", None) or DEFAULT_PRICE_PER_PART)
    except (TypeError, ValueError):
        return DEFAULT_PRICE_PER_PART
    return price if price > 0 else DEFAULT_PRICE_PER_PART
