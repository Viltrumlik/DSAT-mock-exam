"""The texts eskiz has approved, and how a value goes into one.

eskiz sends only a text that matches a moderated template character for character. Its variable
parts are ``%d`` (a number), ``%w`` (one word) and ``%w{a,b}`` (a to b words). So a template here is
the cabinet's ``original_text`` copied VERBATIM — ``manage.py eskiz_account`` prints it with
``repr`` so a stray space or apostrophe shows — plus the names of the values filling its slots, in
order. Never retype one: a template that differs by a character is refused.

Values go in as plain ASCII words (``'`` for o'/g'). The template text itself is left as eskiz
approved it, but one ``ʻ`` or ``‘`` in it makes every SMS UCS-2 — 70 characters a part instead of
160, about twice the price — which is why ``is_gsm_safe`` is reported wherever a text is shown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SLOT = re.compile(r"%(d|w)(?:\{(\d+),(\d+)\})?")
_DIGITS = re.compile(r"^[0-9]+$")
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})
#: Values that name one student: a template using one is sent per student, not per phone.
PERSONAL_VALUES = frozenset({"first_name", "last_name"})


class TemplateError(ValueError):
    pass


@dataclass(frozen=True)
class SmsTemplate:
    key: str
    text: str
    slots: tuple[str, ...]

    def __post_init__(self):
        found = len(SLOT.findall(self.text))
        if found != len(self.slots):
            raise TemplateError(f"{self.key}: the text has {found} slots and {len(self.slots)} values are named")

    @property
    def names_a_student(self) -> bool:
        return any(slot in PERSONAL_VALUES for slot in self.slots)


def is_gsm_safe(text) -> bool:
    """Plain ASCII — what keeps an SMS at 160 characters a part."""
    return all(ord(ch) < 128 for ch in str(text))


def render(template: SmsTemplate, values: dict) -> str:
    slots = iter(template.slots)

    def fill(match) -> str:
        name = next(slots)
        if name not in values:
            raise TemplateError(f"{template.key}: no value for {name}")
        value = str(values[name])
        if match.group(1) == "d":
            if not _DIGITS.match(value):
                raise TemplateError(f"{template.key}: {name} is not a whole number")
            return value
        words = value.translate(_APOSTROPHES).split()
        if not words:
            raise TemplateError(f"{template.key}: {name} is empty")
        return " ".join(words[: int(match.group(3)) if match.group(3) else 1])

    return SLOT.sub(fill, template.text)


#: The warning on days 1..LCUP_DEBT_FREEZE_DAY-1 (``debt_warnings``). None until the approved text is
#: copied in from ``manage.py eskiz_account`` (plan Task 7); while None nothing is sent.
DEBT_WARNING: SmsTemplate | None = None

#: What ``manage.py sms_test`` fills a template with.
SAMPLE_VALUES = {"first_name": "Test", "last_name": "Testov", "debt": 100000, "freeze_day": 6, "days_left": 1}
