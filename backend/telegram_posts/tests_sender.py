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
from telegram_posts import render, schedule, sender
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
        post = self.post()
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), fake_api() as tg:
            sender.sweep(now=self.now)
        self.assertEqual(tg.messages, [])
        # Nothing was claimed either: switching the flag on later must still send it.
        post.refresh_from_db()
        self.assertIsNone(post.last_run_on)
        self.assertFalse(GroupPostDelivery.objects.exists())

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
        with fake_api() as tg, self.assertLogs("telegram_posts", "WARNING") as logs:
            tg.script["-1001"] = [TgResult(False, error_code=403, description="Forbidden: bot was kicked from the supergroup chat")]
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 1))
        self.assertIn("kicked", row.error)
        self.assertIn(f"telegram post {post.pk} → -1001 failed: ", logs.output[0])
        self.assertIn("kicked", logs.output[0])
        self.assertEqual([m[0] for m in tg.messages], ["-1002"])

    def test_a_network_failure_is_tried_three_times(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, description="URLError: timed out")] * 3
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 3))
        self.assertEqual(self.sleeps, [1, 2])

    def test_a_timeout_after_the_request_left_is_not_retried(self):
        # A read timeout may mean Telegram took the message: sending again would post it twice.
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, description="TimeoutError: The read operation timed out")]
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (FAILED, 1))
        self.assertIn("may have arrived", row.error)
        self.assertIn("TimeoutError", row.error)
        self.assertEqual(self.sleeps, [])
        self.assertEqual([m[0] for m in tg.messages], ["-1002"])

    def test_a_5xx_is_tried_again(self):
        post = self.post()
        with fake_api() as tg:
            tg.script["-1001"] = [TgResult(False, error_code=502, description="Bad Gateway")]
            sender.sweep(now=self.now)
        row = self.rows(post)["-1001"]
        self.assertEqual((row.status, row.attempts), (SENT, 2))
        self.assertEqual(self.sleeps, [1])

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

    # ── The two double-send guards ────────────────────────────────────────────────────────────

    def test_a_claim_from_a_stale_snapshot_is_refused(self):
        post = self.post()
        stale = GroupPost.objects.get(pk=post.pk)
        due = schedule.due(stale, self.now)
        GroupPost.objects.filter(pk=post.pk).update(last_run_on=date(2026, 10, 24))  # another worker won
        self.assertFalse(sender.claim_run(stale, due))
        self.assertIsNone(stale.last_run_on)
        post.refresh_from_db()
        self.assertEqual(post.last_run_on, date(2026, 10, 24))
        # ...and a claim never moves the date backwards.
        GroupPost.objects.filter(pk=post.pk).update(last_run_on=date(2026, 10, 25))
        self.assertFalse(sender.claim_run(stale, due))
        post.refresh_from_db()
        self.assertEqual(post.last_run_on, date(2026, 10, 25))

    def test_a_post_deleted_or_paused_after_the_snapshot_is_not_claimed(self):
        for change in ({"deleted_at": self.now}, {"is_paused": True}):
            with self.subTest(change=change):
                post = self.post()
                snapshot = GroupPost.objects.get(pk=post.pk)
                due = schedule.due(snapshot, self.now)
                GroupPost.objects.filter(pk=post.pk).update(**change)
                self.assertFalse(sender.claim_run(snapshot, due))
                post.refresh_from_db()
                self.assertIsNone(post.last_run_on)

    def test_a_row_taken_out_of_pending_mid_run_is_not_sent(self):
        post = self.post()
        with fake_api() as tg:
            real = tg.send_message

            def send_then_flip(chat_id, text, *, reply_markup=None):
                result = real(chat_id, text, reply_markup=reply_markup)
                if str(chat_id) == "-1001":
                    # Someone else sent the second group while this loop was on the first.
                    GroupPostDelivery.objects.filter(post=post, chat_id="-1002").update(status=SENT)
                return result

            tg.send_message = send_then_flip
            sender.sweep(now=self.now)
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])

    def test_a_weekly_post_swept_twice_on_one_day_sends_once_per_group(self):
        post = self.post(when=GroupPost.WHEN_WEEKLY, send_at=None, weekdays=[5], time_of_day=time(18, 0))
        with fake_api() as tg:
            sender.sweep(now=self.now)
            sender.sweep(now=self.now + timedelta(minutes=1))
            self.assertEqual(len(tg.messages), 2)
            # Even with the claim lost (last_run_on wiped), the rows already made are not sent again.
            GroupPost.objects.filter(pk=post.pk).update(last_run_on=None)
            stats = sender.sweep(now=self.now + timedelta(minutes=2))
        self.assertEqual(stats["runs"], 1)
        self.assertEqual(len(tg.messages), 2)
        self.assertEqual(post.deliveries.count(), 2)

    # ── A run must never be stranded ──────────────────────────────────────────────────────────

    def test_a_run_that_cannot_be_opened_is_unclaimed_and_sent_next_beat(self):
        post = self.post()
        real_open = sender.open_run

        def open_then_fail(p, due):
            real_open(p, due)  # the rows exist when it fails: they must go with the claim
            raise RuntimeError("database went away")

        with fake_api() as tg:
            with mock.patch("telegram_posts.sender.open_run", side_effect=open_then_fail), \
                    self.assertLogs("telegram_posts", "ERROR"):
                stats = sender.sweep(now=self.now)  # does not raise
            post.refresh_from_db()
            self.assertIsNone(post.last_run_on)
            self.assertFalse(post.deliveries.exists())
            self.assertEqual((stats["runs"], tg.messages), (0, []))
            sender.sweep(now=self.now + timedelta(minutes=1))
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])

    def test_an_error_while_sending_fails_that_posts_unsent_rows_and_not_the_others(self):
        good = self.post(text="Yaxshi")
        bad = self.post(text="Yomon")  # newest first: the broken one is reached first
        real_render = render.render

        def render_or_die(p):
            if p.pk == bad.pk:
                raise RuntimeError("render blew up")
            return real_render(p)

        with fake_api() as tg:
            with mock.patch.object(render, "render", side_effect=render_or_die), \
                    self.assertLogs("telegram_posts", "ERROR"):
                stats = sender.sweep(now=self.now)
        self.assertEqual(sorted(m[1] for m in tg.messages), ["Yaxshi", "Yaxshi"])
        bad_rows = list(bad.deliveries.all())
        self.assertEqual(len(bad_rows), 2)
        self.assertEqual({r.status for r in bad_rows}, {FAILED})
        self.assertEqual({r.error for r in bad_rows}, {sender.NEVER_SENT})
        self.assertIn("Never sent", sender.NEVER_SENT)
        self.assertEqual({r.status for r in good.deliveries.all()}, {SENT})
        self.assertEqual((stats["runs"], stats["sent"], stats["failed"]), (2, 2, 2))

    def test_a_post_the_scheduler_chokes_on_does_not_stop_the_others(self):
        good = self.post(text="Yaxshi")
        bad = self.post(text="Yomon")
        real_due = schedule.due

        def due_or_die(p, now):
            if p.pk == bad.pk:
                raise RuntimeError("bad schedule")
            return real_due(p, now)

        with fake_api() as tg:
            with mock.patch.object(schedule, "due", side_effect=due_or_die), \
                    self.assertLogs("telegram_posts", "ERROR"):
                sender.sweep(now=self.now)
        self.assertEqual(sorted(m[1] for m in tg.messages), ["Yaxshi", "Yaxshi"])
        self.assertEqual({r.status for r in good.deliveries.all()}, {SENT})
        self.assertFalse(bad.deliveries.exists())

    def test_an_error_mid_run_leaves_the_row_in_flight_to_the_interrupted_rule(self):
        post = self.post()
        with fake_api() as tg:
            real = tg.send_message

            def die_on_first(chat_id, text, *, reply_markup=None):
                if str(chat_id) == "-1001":
                    raise RuntimeError("worker died")
                return real(chat_id, text, reply_markup=reply_markup)

            tg.send_message = die_on_first
            with self.assertLogs("telegram_posts", "ERROR"):
                sender.sweep(now=self.now)
        rows = self.rows(post)
        # The first group may have received it: not Failed-and-retryable, not Sent.
        self.assertEqual(rows["-1001"].status, SENDING)
        # The second was never attempted, so it can safely be offered for Retry.
        self.assertEqual((rows["-1002"].status, rows["-1002"].error), (FAILED, sender.NEVER_SENT))
        self.assertEqual(tg.messages, [])

    def test_send_now_survives_a_run_that_cannot_be_opened(self):
        now = timezone.now()
        post = GroupPost.objects.create(text="Hozir!", when=GroupPost.WHEN_NOW, send_at=now, active_from=now)
        with fake_api() as tg:
            with mock.patch("telegram_posts.sender.open_run", side_effect=RuntimeError("down")), \
                    self.assertLogs("telegram_posts", "ERROR"):
                self.assertEqual(sender.send_post_now(post.pk), {})
            post.refresh_from_db()
            self.assertIsNone(post.last_run_on)
            sender.sweep(now=timezone.now())  # the beat is the safety net
        self.assertEqual(len(tg.messages), 2)

    def test_a_row_left_pending_for_over_an_hour_is_failed_and_a_young_one_left_alone(self):
        post = self.post(last_run_on=date(2026, 10, 24))
        old = GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001")
        young = GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002")
        GroupPostDelivery.objects.filter(pk=old.pk).update(updated_at=self.now - timedelta(minutes=61))
        GroupPostDelivery.objects.filter(pk=young.pk).update(updated_at=self.now - timedelta(minutes=30))
        with fake_api() as tg:
            sender.sweep(now=self.now)
        old.refresh_from_db()
        young.refresh_from_db()
        self.assertEqual((old.status, old.error), (FAILED, sender.NEVER_SENT))
        self.assertEqual(young.status, GroupPostDelivery.STATUS_PENDING)
        self.assertEqual(tg.messages, [])

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
        row = post.deliveries.get()
        self.assertEqual(row.status, MISSED)
        self.assertEqual(row.error, "Nothing to send: the event was cancelled or has started.")


class WiringTests(SimpleTestCase):
    def test_the_tasks_and_the_beat_entry(self):
        from telegram_posts import tasks

        self.assertEqual(tasks.sweep_group_posts.name, "telegram_posts.sweep")
        self.assertEqual(tasks.send_group_post_now.name, "telegram_posts.send_now")
        self.assertEqual(settings.CELERY_BEAT_SCHEDULE["telegram-posts-sweep"]["task"], "telegram_posts.sweep")
