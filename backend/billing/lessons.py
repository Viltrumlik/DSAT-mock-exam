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


# ── Pay per lesson (owner, 2026-11-22) ────────────────────────────────────────────────────────────────────
# "Birinchi kelgan o'quvchi uchun birinchi to'lovda to'liq 500 ming olinadi, bir oy o'qiganidan keyin hisob
# balansiga pul tushirib yuradi, har bir dars uchun ma'lum miqdorda pul yechilib." A new student's first month
# is the group's whole price; after it, each lesson day of the group is one lesson's price, taken from a
# balance topped up in advance. Like the monthly rule, absences do not change it.


def add_one_month(day: date) -> date:
    """The same day next month, or that month's last day when it has no such day (31 Jan → 28 Feb)."""
    year, number = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    return date(year, number, min(day.day, calendar.monthrange(year, number)[1]))


def lesson_days(days, start: date, end: date) -> list[date]:
    """Every lesson day from ``start`` to ``end``, both included; ``days`` are ISO weekdays."""
    wanted = set(days)
    if not wanted or end < start:
        return []
    out, day = [], start
    while day <= end:
        if day.isoweekday() in wanted:
            out.append(day)
        day = date.fromordinal(day.toordinal() + 1)
    return out


def seat_lesson_price(monthly_price: int, lessons_per_month: int) -> int:
    """One lesson: the seat's monthly price (a personal one when it has one) ÷ the lessons of a month, to the nearest
    500 so'm (owner, 2026-11-22: 500,000 ÷ 13 → 38,500; 400,000 → 31,000). A grant (0) is free."""
    if not monthly_price or lessons_per_month <= 0:
        return 0
    return round(monthly_price / lessons_per_month / 500) * 500
