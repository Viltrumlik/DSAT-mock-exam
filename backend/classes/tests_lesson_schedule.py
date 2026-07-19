"""classes.lesson_schedule: lesson_time parsing + next-lesson/homework-deadline derivation.

Homework has no manual deadline — it is due at the START of the classroom's next lesson,
or has no deadline at all when the classroom's schedule can't be parsed.
"""
from __future__ import annotations

from datetime import date, datetime, time

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as acc_const
from classes.lesson_schedule import (
    homework_due_at,
    lesson_starts,
    next_lesson_start_after,
    parse_lesson_time,
)
from classes.models import Classroom

User = get_user_model()


class ParseLessonTimeTests(TestCase):
    def test_plain_24h(self):
        self.assertEqual(parse_lesson_time("18:00"), time(18, 0))
        self.assertEqual(parse_lesson_time("08:30"), time(8, 30))

    def test_12_hour_forms(self):
        self.assertEqual(parse_lesson_time("4:00 PM"), time(16, 0))
        self.assertEqual(parse_lesson_time("9am"), time(9, 0))
        self.assertEqual(parse_lesson_time("12am"), time(0, 0))
        self.assertEqual(parse_lesson_time("12:30 pm"), time(12, 30))

    def test_range_takes_the_start(self):
        # Production data contains ranges — the lesson starts at the left side.
        self.assertEqual(parse_lesson_time("08:00-10:00"), time(8, 0))
        self.assertEqual(parse_lesson_time("16:00 – 18:00"), time(16, 0))
        self.assertEqual(parse_lesson_time("9am to 11am"), time(9, 0))

    def test_unusable_values(self):
        for raw in ("", None, "   ", "whenever", "25:00", "10:75"):
            self.assertIsNone(parse_lesson_time(raw), raw)


class NextLessonTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="sched@test.com", password="x", role=acc_const.ROLE_SUPER_ADMIN
        )

    def _classroom(self, **over):
        kwargs = dict(
            name="Sched",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,  # Mon/Wed/Fri
            lesson_time="18:00",
            created_by=self.admin,
        )
        kwargs.update(over)
        return Classroom.objects.create(**kwargs)

    def _aware(self, y, m, d, hh, mm):
        return timezone.make_aware(
            datetime(y, m, d, hh, mm), timezone.get_current_timezone()
        )

    def test_same_day_later_lesson(self):
        c = self._classroom()
        # 2026-07-13 is a Monday (an ODD day); 16:00 is before the 18:00 lesson.
        got = next_lesson_start_after(c, self._aware(2026, 7, 13, 16, 0))
        self.assertEqual(got, self._aware(2026, 7, 13, 18, 0))

    def test_rolls_to_next_lesson_day(self):
        c = self._classroom()
        # Monday 19:00 (after that day's lesson) -> Wednesday 18:00.
        got = next_lesson_start_after(c, self._aware(2026, 7, 13, 19, 0))
        self.assertEqual(got, self._aware(2026, 7, 15, 18, 0))

    def test_even_group_uses_tue_thu_sat(self):
        c = self._classroom(lesson_days=Classroom.DAYS_EVEN, lesson_time="16:00")
        # Monday -> Tuesday for an EVEN group.
        got = next_lesson_start_after(c, self._aware(2026, 7, 13, 19, 0))
        self.assertEqual(got, self._aware(2026, 7, 14, 16, 0))

    def test_result_is_timezone_aware(self):
        c = self._classroom()
        got = next_lesson_start_after(c, self._aware(2026, 7, 13, 16, 0))
        self.assertIsNotNone(got.tzinfo)

    def test_start_date_floor_is_respected(self):
        c = self._classroom(start_date=date(2026, 8, 1))
        got = next_lesson_start_after(c, self._aware(2026, 7, 13, 8, 0))
        self.assertIsNotNone(got)
        self.assertGreaterEqual(got.date(), date(2026, 8, 1))

    def test_unparseable_lesson_time_means_no_deadline(self):
        c = self._classroom(lesson_time="whenever")
        self.assertIsNone(next_lesson_start_after(c, self._aware(2026, 7, 13, 8, 0)))


class LessonStartsTests(NextLessonTests):
    """`lesson_starts` lays a Journal's session list onto real classroom dates."""

    def test_counts_meetings_from_start_date(self):
        # 2026-08-03 is a Monday. ODD = Mon/Wed/Fri.
        c = self._classroom(start_date=date(2026, 8, 3))
        got = lesson_starts(c, 4)
        self.assertEqual(
            got,
            [
                self._aware(2026, 8, 3, 18, 0),   # Mon
                self._aware(2026, 8, 5, 18, 0),   # Wed
                self._aware(2026, 8, 7, 18, 0),   # Fri
                self._aware(2026, 8, 10, 18, 0),  # next Mon
            ],
        )

    def test_start_date_that_is_not_a_lesson_day_rolls_forward(self):
        # 2026-08-02 is a Sunday — belongs to neither group, so lesson 1 is Monday.
        c = self._classroom(start_date=date(2026, 8, 2))
        self.assertEqual(lesson_starts(c, 1)[0], self._aware(2026, 8, 3, 18, 0))

    def test_even_group_uses_its_own_weekdays(self):
        c = self._classroom(
            lesson_days=Classroom.DAYS_EVEN, lesson_time="16:00", start_date=date(2026, 8, 3)
        )
        got = lesson_starts(c, 3)
        self.assertEqual(
            got,
            [
                self._aware(2026, 8, 4, 16, 0),  # Tue
                self._aware(2026, 8, 6, 16, 0),  # Thu
                self._aware(2026, 8, 8, 16, 0),  # Sat
            ],
        )

    def test_unusable_schedule_yields_all_none_of_the_right_length(self):
        # Callers zip this against sessions, so the length must hold even when unusable.
        c = self._classroom(lesson_time="whenever")
        self.assertEqual(lesson_starts(c, 3), [None, None, None])

    def test_zero_and_negative_counts(self):
        c = self._classroom(start_date=date(2026, 8, 3))
        self.assertEqual(lesson_starts(c, 0), [])
        self.assertEqual(lesson_starts(c, -2), [])

    def test_long_term_stays_bounded_and_complete(self):
        # A 2-year journal must not hit the internal scan cap and pad with None.
        c = self._classroom(start_date=date(2026, 8, 3))
        got = lesson_starts(c, 200)
        self.assertEqual(len(got), 200)
        self.assertTrue(all(g is not None for g in got))
        self.assertEqual(got, sorted(got))

    def test_blank_lesson_time_means_no_deadline(self):
        c = self._classroom(lesson_time="")
        self.assertIsNone(next_lesson_start_after(c, self._aware(2026, 7, 13, 8, 0)))

    def test_homework_due_at_matches_next_lesson(self):
        """The user's rule: homework set after Monday's 18:00 lesson closes when the
        next lesson starts (Wednesday 18:00)."""
        c = self._classroom()
        released = self._aware(2026, 7, 13, 18, 0)
        self.assertEqual(homework_due_at(c, released), self._aware(2026, 7, 15, 18, 0))

    def test_homework_due_at_uses_next_lesson_time_not_release_time(self):
        # Lesson ends 18:00 Monday; next lesson starts 16:00 -> deadline is 16:00.
        c = self._classroom(lesson_time="16:00")
        released = self._aware(2026, 7, 13, 18, 0)
        self.assertEqual(homework_due_at(c, released), self._aware(2026, 7, 15, 16, 0))
