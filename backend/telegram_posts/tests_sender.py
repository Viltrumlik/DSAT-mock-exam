"""Sending: each group once, late runs never, retries only where they can help."""

from __future__ import annotations

import tempfile
from datetime import date, time, timedelta
from unittest import mock

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from classes.telegram_group_api import TgResult
from events.models import Event
from telegram_posts import sender
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import PNG_1PX, TOKEN, at, fake_api, make_event, make_room

SENT = GroupPostDelivery.STATUS_SENT
FAILED = GroupPostDelivery.STATUS_FAILED
MISSED = GroupPostDelivery.STATUS_MISSED
SENDING = GroupPostDelivery.STATUS_SENDING


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN, MEDIA_ROOT=tempfile.mkdtemp(),
)
class SweepTests(TestCase):
    def setUp(self):
        self.sleeps: list = []
        patch = mock.patch("telegram_posts.sender._sleep", side_effect=self.sleeps.append)
        patch.start()
        self.addCleanup(patch.stop)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 Math", level="junior", chat="-1002")
        self.now = at(2026, 10, 24, 18, 0)

    def post(self, **kw):
        kw.setdefault("text", "Ertaga yakshanba soat 10:00 da mock!")
        kw.setdefault("when", GroupPost.WHEN_ONCE)
        kw.setdefault("send_at", self.now)
        kw.setdefault("active_from", at(2026, 10, 20))
        return GroupPost.objects.create(**kw)

    def rows(self, post):
        return {r.chat_id: r for r in post.deliveries.all()}

    def test_nothing_goes_out_with_the_flag_off(self):
        self.post()
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(tg.messages, [])

    def test_a_due_post_reaches_every_group_once(self):
        post = self.post()
        with fake_api() as tg:
            sender.sweep(now=self.now)
            sender.sweep(now=self.now + timedelta(minutes=1))
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])
        rows = self.rows(post)
        self.assertEqual({r.status for r in rows.values()}, {SENT})
        self.assertTrue(all(r.message_id and r.sent_at and r.attempts == 1 for r in rows.values()))

    def test_two_classes_in_one_group_get_one_message(self):
        make_room("Senior G5 Math", chat="-1001")
        post = self.post()
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(len(tg.messages), 2)
        self.assertEqual(self.rows(post)["-1001"].group_names, "Senior G1 Math, Senior G5 Math")

    def test_more_than_an_hour_late_is_missed_not_sent(self):
        post = self.post()
        with fake_api() as tg:
            stats = sender.sweep(now=self.now + timedelta(minutes=61))
        self.assertEqual(tg.messages, [])
        self.assertEqual({r.status for r in self.rows(post).values()}, {MISSED})
        self.assertEqual(stats["missed"], 2)

    def test_a_429_waits_as_told_and_tries_again(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=429, description="Too Many Requests", retry_after=3)]
            sender.sweep(now=self.now)
        self.assertEqual(self.sleeps, [3])
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (SENT, 2))

    def test_a_long_wait_is_capped(self):
        self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=429, description="Too Many Requests", retry_after=300)]
            sender.sweep(now=self.now)
        self.assertEqual(self.sleeps, [sender.RETRY_AFTER_CAP])

    def test_a_403_is_not_retried_and_the_other_groups_still_get_it(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=403, description="Forbidden: bot was kicked from the supergroup chat")]
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 1))
        self.assertIn("kicked", row.error)
        self.assertEqual([m[0] for m in tg.messages], ["-1002"])

    def test_a_network_failure_is_tried_three_times(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, description="URLError: timed out")] * 3
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 3))
        self.assertEqual(self.sleeps, [1, 2])

    def test_the_picture_is_uploaded_once(self):
        post = self.post(image=SimpleUploadedFile("mock.png", PNG_1PX, content_type="image/png"))
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual([p[2] for p in tg.photos], ["upload", "FID-big"])
        post.refresh_from_db()
        self.assertEqual(post.image_file_id, "FID-big")

    def test_the_button_rides_along(self):
        self.post(button_text="Ro'yxat", button_url="https://mastersat.uz/events")
        with fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(
            tg.messages[0][2],
            {"inline_keyboard": [[{"text": "Ro'yxat", "url": "https://mastersat.uz/events"}]]},
        )

    def test_an_interrupted_send_is_marked_failed_and_not_resent(self):
        post = self.post(last_run_on=date(2026, 10, 24))
        row = GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=SENDING)
        GroupPostDelivery.objects.filter(pk=row.pk).update(updated_at=self.now - timedelta(minutes=11))
        with fake_api() as tg:
            sender.sweep(now=self.now)
        row.refresh_from_db()
        self.assertEqual(row.status, FAILED)
        self.assertIn("Interrupted", row.error)
        self.assertEqual(tg.messages, [])

    def test_a_weekly_post_goes_each_week(self):
        post = self.post(when=GroupPost.WHEN_WEEKLY, send_at=None, weekdays=[5], time_of_day=time(18, 0))
        with fake_api() as tg:
            sender.sweep(now=self.now)
            sender.sweep(now=self.now + timedelta(days=7))
        self.assertEqual(len(tg.messages), 4)
        self.assertEqual(
            sorted({r.run_on for r in post.deliveries.all()}), [date(2026, 10, 24), date(2026, 10, 31)]
        )

    def test_send_now_sends_a_now_post_at_once(self):
        # The real clock: send_post_now reads timezone.now(), not the sweep's `now`.
        now = timezone.now()
        post = GroupPost.objects.create(text="Hozir!", when=GroupPost.WHEN_NOW, send_at=now, active_from=now)
        with fake_api() as tg:
            sender.send_post_now(post.pk)
            sender.send_post_now(post.pk)  # a second dispatch finds the run claimed
        self.assertEqual(len(tg.messages), 2)

    def test_a_reminder_for_an_event_cancelled_mid_run_is_not_sent(self):
        event = make_event()
        post = GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event,
            last_run_on=date(2026, 10, 24),
        )
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        Event.objects.filter(pk=event.pk).update(status=Event.STATUS_CANCELLED)
        with fake_api() as tg:
            stats = sender.send_pending(GroupPost.objects.get(pk=post.pk), date(2026, 10, 24))
        self.assertEqual(tg.messages, [])
        self.assertEqual(stats["skipped"], 1)
        self.assertEqual(post.deliveries.get().status, MISSED)


class WiringTests(SimpleTestCase):
    def test_the_tasks_and_the_beat_entry(self):
        from telegram_posts import tasks

        self.assertEqual(tasks.sweep_group_posts.name, "telegram_posts.sweep")
        self.assertEqual(tasks.send_group_post_now.name, "telegram_posts.send_now")
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["telegram-posts-sweep"]["task"], "telegram_posts.sweep")
