"""When a post goes out. 2026-10-24 is a Saturday; every time is Tashkent wall-clock."""

from __future__ import annotations

from datetime import date, time

from django.test import SimpleTestCase

from events.models import Event
from telegram_posts import schedule
from telegram_posts.models import GroupPost
from telegram_posts.testkit import at

SAT, FRI = 5, 4


def once(send_at, **kw):
    kw.setdefault("active_from", at(2026, 10, 1))
    return GroupPost(when=GroupPost.WHEN_ONCE, send_at=send_at, **kw)


def weekly(**kw):
    kw.setdefault("weekdays", [SAT])
    kw.setdefault("time_of_day", time(18, 0))
    kw.setdefault("active_from", at(2026, 10, 1))
    return GroupPost(when=GroupPost.WHEN_WEEKLY, **kw)


class OnceTests(SimpleTestCase):
    def test_not_before_its_time(self):
        self.assertIsNone(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 17, 59)))

    def test_on_time(self):
        d = schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 18, 0))
        self.assertEqual((d.run_on, d.late), (date(2026, 10, 24), False))

    def test_an_hour_late_is_still_on_time_and_a_minute_more_is_missed(self):
        self.assertFalse(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 19, 0)).late)
        self.assertTrue(schedule.due(once(at(2026, 10, 24, 18)), at(2026, 10, 24, 19, 1)).late)

    def test_only_once(self):
        post = once(at(2026, 10, 24, 18), last_run_on=date(2026, 10, 24))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 5)))
        self.assertIsNone(schedule.next_at(post, at(2026, 10, 24, 18, 5)))

    def test_paused_or_deleted_is_never_due(self):
        self.assertIsNone(schedule.due(once(at(2026, 10, 24, 18), is_paused=True), at(2026, 10, 24, 18)))
        self.assertIsNone(
            schedule.due(once(at(2026, 10, 24, 18), deleted_at=at(2026, 10, 23)), at(2026, 10, 24, 18))
        )

    def test_now_posts_behave_like_once(self):
        post = GroupPost(when=GroupPost.WHEN_NOW, send_at=at(2026, 10, 24, 10), active_from=at(2026, 10, 24, 10))
        self.assertEqual(schedule.due(post, at(2026, 10, 24, 10)).run_on, date(2026, 10, 24))


class WeeklyTests(SimpleTestCase):
    def test_its_day_and_hour(self):
        self.assertEqual(schedule.due(weekly(), at(2026, 10, 24, 18, 0)).run_on, date(2026, 10, 24))

    def test_not_before_the_hour_nor_on_other_days(self):
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 24, 17, 59)))
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 23, 18, 30)))  # Friday
        self.assertIsNone(schedule.due(weekly(), at(2026, 10, 25, 18, 30)))  # Sunday

    def test_once_a_week(self):
        post = weekly(last_run_on=date(2026, 10, 24))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 30)))
        self.assertEqual(schedule.due(post, at(2026, 10, 31, 18, 0)).run_on, date(2026, 10, 31))

    def test_a_post_made_after_its_hour_waits_a_week(self):
        post = weekly(active_from=at(2026, 10, 24, 18, 30))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 31)))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 24, 18, 31)), at(2026, 10, 31, 18, 0))

    def test_several_days(self):
        post = weekly(weekdays=[FRI, SAT])
        self.assertEqual(schedule.due(post, at(2026, 10, 23, 18, 0)).run_on, date(2026, 10, 23))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 21, 12)), at(2026, 10, 23, 18, 0))

    def test_next_at(self):
        self.assertEqual(schedule.next_at(weekly(), at(2026, 10, 21, 12)), at(2026, 10, 24, 18, 0))
        sent = weekly(last_run_on=date(2026, 10, 24))
        self.assertEqual(schedule.next_at(sent, at(2026, 10, 24, 18, 5)), at(2026, 10, 31, 18, 0))
        # Today's slot is more than an hour gone: the next one is next week.
        self.assertEqual(schedule.next_at(weekly(), at(2026, 10, 24, 19, 30)), at(2026, 10, 31, 18, 0))

    def test_no_days_means_never(self):
        self.assertIsNone(schedule.next_at(weekly(weekdays=[]), at(2026, 10, 21)))


class EventReminderTests(SimpleTestCase):
    def event(self, **kw):
        kw.setdefault("status", Event.STATUS_PUBLISHED)
        kw.setdefault("starts_at", at(2026, 10, 25, 10))
        return Event(title="Workshop", ends_at=at(2026, 10, 25, 12), seats=30, **kw)

    def post(self, event, **kw):
        kw.setdefault("active_from", at(2026, 10, 20, 9))
        return GroupPost(kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event, **kw)

    def test_the_evening_before(self):
        event = self.event()
        self.assertEqual(schedule.reminder_at(event), at(2026, 10, 24, 18, 0))
        self.assertEqual(schedule.due(self.post(event), at(2026, 10, 24, 18, 0)).run_on, date(2026, 10, 24))

    def test_published_after_that_evening_gets_none(self):
        post = self.post(self.event(), active_from=at(2026, 10, 24, 19))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 19, 5)))
        self.assertIsNone(schedule.next_at(post, at(2026, 10, 24, 19, 5)))

    def test_a_cancelled_event_gets_none(self):
        self.assertIsNone(schedule.due(self.post(self.event(status=Event.STATUS_CANCELLED)), at(2026, 10, 24, 18)))

    def test_a_moved_start_moves_it(self):
        post = self.post(self.event(starts_at=at(2026, 10, 26, 10)), last_run_on=date(2026, 10, 24))
        self.assertEqual(schedule.due(post, at(2026, 10, 25, 18, 0)).run_on, date(2026, 10, 25))

    def test_next_at(self):
        self.assertEqual(schedule.next_at(self.post(self.event()), at(2026, 10, 21)), at(2026, 10, 24, 18, 0))
