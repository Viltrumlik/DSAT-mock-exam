"""How much of a month's price a stretch of days is.

The rule is lc-up's, measured on prod on 2026-11-04 and kept by the owner: a whole month is the exact
price; part of one is the price × its lessons ÷ the month's lessons, by the group's weekdays, to the
nearest 1,000 so'm. Holidays and absences do not change it.
"""

import calendar
from datetime import date


def lessons_in_month(month: str, days) -> list[date]:
    """Every lesson day of ``month`` ("YYYY-MM"); ``days`` are ISO weekdays (Monday = 1)."""
    year, number = (int(part) for part in month.split("-"))
    wanted = set(days)
    every_day = (date(year, number, day) for day in range(1, calendar.monthrange(year, number)[1] + 1))
    return [day for day in every_day if day.isoweekday() in wanted]


def month_amount(price: int, days, month: str, *, start: date | None = None, end: date | None = None) -> int:
    """What the lessons of ``month`` from ``start`` to ``end``, both included, cost."""
    lessons = lessons_in_month(month, days)
    if not lessons:
        return 0
    kept = [day for day in lessons if (start is None or day >= start) and (end is None or day <= end)]
    if len(kept) == len(lessons):
        return price
    return round(price * len(kept) / len(lessons) / 1000) * 1000
