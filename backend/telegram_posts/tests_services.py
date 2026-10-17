"""The console's verbs: create, edit, pause, resume, retry, send missed, delete from groups."""

from __future__ import annotations

from datetime import date, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from classes.telegram_group_api import TgResult
from telegram_posts import schedule, sender, services
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import TOKEN, at, fake_api, make_event, make_room, staff

D = GroupPostDelivery


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class ServiceTests(TestCase):
    def setUp(self):
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 Math", level="junior", chat="-1002")
        self.user = staff()

    def sent_post(self, **kw):
        kw.setdefault("text", "Mock!")
        kw.setdefault("when", GroupPost.WHEN_ONCE)
        kw.setdefault("send_at", at(2026, 10, 24, 18))
        kw.setdefault("last_run_on", date(2026, 10, 24))
        return GroupPost.objects.create(**kw)

    # ── create / edit ──────────────────────────────────────────────────────
    def test_a_now_post_goes_out_on_commit(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            post = services.create_post(data={"text": "Salom", "when": GroupPost.WHEN_NOW}, user=self.user)
        self.assertEqual(len(tg.messages), 2)
        post.refresh_from_db()
        self.assertEqual(post.last_run_on, timezone.localdate())
        self.assertEqual(post.created_by, self.user)

    def test_a_scheduled_post_waits(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            services.create_post(
                data={"text": "Keyin", "when": GroupPost.WHEN_ONCE, "send_at": timezone.now() + timedelta(days=1)},
                user=self.user,
            )
        self.assertEqual(tg.messages, [])

    def test_an_event_post_is_edited_through_its_event(self):
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=make_event())
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(post, {"text": "x"})
        self.assertEqual(caught.exception.code, "event_post")

    def test_a_post_that_has_gone_out_is_not_edited(self):
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(self.sent_post(), {"text": "x"})
        self.assertEqual(caught.exception.code, "already_sent")

    def test_a_schedule_edit_restarts_the_clock_and_a_new_picture_forgets_its_file_id(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            active_from=at(2026, 10, 1), image_file_id="OLD",
        )
        now = at(2026, 10, 24, 18, 30)
        services.update_post(post, {"weekdays": [4, 5], "image": None}, now=now)
        post.refresh_from_db()
        self.assertEqual(post.active_from, now)
        self.assertEqual(post.image_file_id, "")

    def test_an_edit_that_leaves_the_picture_keeps_its_file_id(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            active_from=at(2026, 10, 1), image_file_id="KEEP",
        )
        services.update_post(post, {"text": "b"}, now=at(2026, 10, 24, 18, 30))
        post.refresh_from_db()
        self.assertEqual(post.image_file_id, "KEEP")
        self.assertEqual(post.active_from, at(2026, 10, 1))

    def test_resume_skips_what_the_pause_covered(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        services.pause(post)
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 0)))
        services.resume(post, now=at(2026, 10, 24, 18, 30))
        self.assertIsNone(schedule.due(post, at(2026, 10, 24, 18, 31)))
        self.assertEqual(schedule.next_at(post, at(2026, 10, 24, 18, 31)), at(2026, 10, 31, 18, 0))

    # ── retry / missed ─────────────────────────────────────────────────────
    def test_retry_requeues_only_the_failed_rows_of_the_last_run(self):
        post = self.sent_post(when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT, message_id=5)
        old = D.objects.create(post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_FAILED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            result = services.retry_failed(post)
        self.assertEqual(result, {"queued": 1})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])
        old.refresh_from_db()
        self.assertEqual(old.status, D.STATUS_FAILED)

    def test_a_requeued_row_is_not_failed_as_stale_the_moment_it_is_queued(self):
        # `.update()` skips auto_now: without an explicit updated_at the row keeps the hours-old
        # stamp of its failure, and the stale-PENDING rule would fail it before the task ran.
        post = self.sent_post()
        row = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        D.objects.filter(pk=row.pk).update(updated_at=timezone.now() - timedelta(hours=5))
        services.retry_failed(post)  # the dispatch waits for commit: the row stays Pending here
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_PENDING)
        self.assertEqual(sender._fail_interrupted(timezone.now()), 0)
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_PENDING)

    def test_a_missed_row_put_back_is_not_failed_as_stale_either(self):
        post = self.sent_post()
        row = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_MISSED)
        D.objects.filter(pk=row.pk).update(updated_at=timezone.now() - timedelta(hours=5))
        services.send_missed_now(post)
        self.assertEqual(sender._fail_interrupted(timezone.now()), 0)
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_PENDING)

    def test_send_missed_now(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_MISSED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(services.send_missed_now(post), {"queued": 1})
        self.assertEqual(len(tg.messages), 1)

    def test_nothing_is_queued_with_the_flag_off(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), self.assertRaises(services.PostRefused) as caught:
            services.retry_failed(post)
        self.assertEqual(caught.exception.code, "off")

    def test_a_reminder_is_not_sent_after_its_event_started(self):
        event = make_event(starts_at=timezone.now() - timedelta(hours=1))
        post = GroupPost.objects.create(
            kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event, last_run_on=date(2026, 10, 24),
        )
        with self.assertRaises(services.PostRefused) as caught:
            services.send_missed_now(post)
        self.assertEqual(caught.exception.code, "too_late")

    # ── delete from groups ─────────────────────────────────────────────────
    def test_delete_from_groups(self):
        now = at(2026, 10, 24, 20)
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT, message_id=11, sent_at=now - timedelta(hours=1))
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT, message_id=12, sent_at=now - timedelta(hours=49))
        never = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1003", status=D.STATUS_FAILED)
        with fake_api() as tg:
            stats = services.delete_from_groups(post, now=now)
        self.assertEqual(stats, {"deleted": 1, "too_old": 1, "failed": 0})
        self.assertEqual(tg.deleted, [("-1001", 11)])
        post.refresh_from_db()
        self.assertEqual(post.deleted_at, now)
        never.refresh_from_db()
        self.assertEqual(never.status, D.STATUS_DELETED)
        self.assertEqual(post.deliveries.get(chat_id="-1002").status, D.STATUS_SENT)

    def test_a_message_already_gone_counts_as_deleted(self):
        now = at(2026, 10, 24, 20)
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT, message_id=11, sent_at=now)
        with fake_api() as tg:
            tg.script["delete:-1001"] = [TgResult(False, error_code=400, description="Bad Request: message to delete not found")]
            stats = services.delete_from_groups(post, now=now)
        self.assertEqual(stats["deleted"], 1)

    def test_a_deleted_weekly_post_never_sends_again(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with fake_api() as tg:
            services.delete_from_groups(post, now=at(2026, 10, 20))
            sender.sweep(now=at(2026, 10, 24, 18))
        self.assertEqual(tg.messages, [])

    # ── what the console shows ─────────────────────────────────────────────
    def test_counts_last_run_and_state(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_FAILED)
        counts = services.delivery_counts([post.pk])
        last = services.last_run(post, counts)
        self.assertEqual(
            last,
            {"run_on": date(2026, 10, 24), "total": 2, "sent": 1, "failed": 1, "missed": 0, "pending": 0, "deleted": 0},
        )
        self.assertEqual(services.post_state(post, last, at(2026, 10, 24, 19)), "failed")
        weekly = GroupPost.objects.create(text="w", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1))
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "scheduled")
        weekly.is_paused = True
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "paused")

    def test_runs_newest_first(self):
        post = self.sent_post()
        D.objects.create(post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_SENT)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT)
        runs = services.runs(post)
        self.assertEqual([r["run_on"] for r in runs], [date(2026, 10, 24), date(2026, 10, 17)])
        self.assertEqual([d.chat_id for d in runs[0]["deliveries"]], ["-1001", "-1002"])


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class SendRunTests(TestCase):
    """`sender.send_run`: what a retry or "send missed now" runs once the rows are Pending again."""

    def setUp(self):
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 Math", level="junior", chat="-1002")
        self.run_on = date(2026, 10, 24)
        self.post = GroupPost.objects.create(
            text="Mock!", when=GroupPost.WHEN_ONCE, send_at=at(2026, 10, 24, 18), last_run_on=self.run_on,
        )
        for chat in ("-1001", "-1002"):
            D.objects.create(post=self.post, run_on=self.run_on, chat_id=chat, status=D.STATUS_PENDING)

    def test_it_sends_the_pending_rows(self):
        with fake_api() as tg:
            result = sender.send_run(self.post.pk, self.run_on)
        self.assertEqual(result["sent"], 2)
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])

    def test_it_sends_nothing_with_the_flag_off(self):
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), fake_api() as tg:
            self.assertEqual(sender.send_run(self.post.pk, self.run_on), {})
        self.assertEqual(tg.messages, [])

    def test_it_sends_nothing_for_a_deleted_post(self):
        GroupPost.objects.filter(pk=self.post.pk).update(deleted_at=timezone.now())
        with fake_api() as tg:
            self.assertEqual(sender.send_run(self.post.pk, self.run_on), {})
        self.assertEqual(tg.messages, [])

    def test_it_sends_nothing_for_a_post_that_is_gone(self):
        with fake_api() as tg:
            self.assertEqual(sender.send_run(self.post.pk + 999, self.run_on), {})
        self.assertEqual(tg.messages, [])

    def test_an_error_fails_the_unsent_rows_and_never_escapes(self):
        with fake_api(), mock.patch("telegram_posts.sender.send_pending", side_effect=RuntimeError("boom")):
            with self.assertLogs("telegram_posts", level="ERROR"):
                result = sender.send_run(self.post.pk, self.run_on)
        self.assertEqual(result, {"sent": 0, "failed": 2, "skipped": 0})
        rows = list(self.post.deliveries.all())
        self.assertEqual({r.status for r in rows}, {D.STATUS_FAILED})
        self.assertEqual({r.error for r in rows}, {sender.NEVER_SENT})

    def test_an_error_reading_the_post_never_escapes(self):
        with fake_api(), mock.patch("telegram_posts.sender.GroupPost.objects") as objects:
            objects.select_related.side_effect = RuntimeError("db gone")
            with self.assertLogs("telegram_posts", level="ERROR"):
                self.assertEqual(sender.send_run(self.post.pk, self.run_on), {})

    def test_the_task_takes_the_date_as_text(self):
        from telegram_posts import tasks

        with fake_api() as tg:
            result = tasks.send_group_post_run(self.post.pk, "2026-10-24")
        self.assertEqual(result["sent"], 2)
        self.assertEqual(len(tg.messages), 2)
