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

    def ran_weekly(self, **kw):
        kw.setdefault("text", "a")
        return GroupPost.objects.create(
            when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            active_from=at(2026, 10, 1), last_run_on=date(2026, 10, 24), **kw,
        )

    def test_a_post_that_has_run_cannot_become_a_once_post(self):
        post = self.ran_weekly()
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(
                post, {"when": GroupPost.WHEN_ONCE, "send_at": at(2026, 10, 31, 18)}, now=at(2026, 10, 24, 19),
            )
        self.assertEqual(caught.exception.code, "already_ran")
        post.refresh_from_db()
        self.assertEqual(post.when, GroupPost.WHEN_WEEKLY)

    def test_a_post_that_has_run_cannot_become_a_now_post(self):
        post = self.ran_weekly()
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(services.PostRefused) as caught:
                services.update_post(post, {"when": GroupPost.WHEN_NOW}, now=at(2026, 10, 24, 19))
        self.assertEqual(caught.exception.code, "already_ran")
        self.assertEqual(tg.messages, [])

    def test_a_weekly_post_that_has_not_run_can_become_now_and_goes_out(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            services.update_post(post, {"when": GroupPost.WHEN_NOW})
        self.assertEqual(len(tg.messages), 2)
        post.refresh_from_db()
        self.assertEqual(post.last_run_on, timezone.localdate())

    def test_a_weekly_days_and_time_edit_after_a_run_is_still_allowed(self):
        post = self.ran_weekly()
        now = at(2026, 10, 24, 19)
        services.update_post(post, {"weekdays": [4, 5], "time_of_day": time(19, 0), "text": "b"}, now=now)
        post.refresh_from_db()
        self.assertEqual((post.weekdays, post.time_of_day, post.text), ([4, 5], time(19, 0), "b"))
        self.assertEqual(post.active_from, now)
        self.assertEqual(post.last_run_on, date(2026, 10, 24))

    def test_the_already_sent_refusal_points_to_what_can_be_done(self):
        with self.assertRaises(services.PostRefused) as caught:
            services.update_post(self.sent_post(), {"text": "x"})
        self.assertEqual(caught.exception.message, "This post's time has passed. Write a new post, or use Send missed now.")

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

    def test_resume_on_a_post_that_is_not_paused_changes_nothing(self):
        # A stray Resume at 18:00:30 must not move active_from past the 18:00 run still due.
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        just_after = at(2026, 10, 24, 18, 0) + timedelta(seconds=30)
        services.resume(post, now=just_after)
        post.refresh_from_db()
        self.assertEqual(post.active_from, at(2026, 10, 1))
        self.assertIsNotNone(schedule.due(post, just_after))

    # ── a paused post cannot be stranded (I3) ──────────────────────────────
    def paused_weekly(self):
        return GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            active_from=at(2026, 10, 1), is_paused=True,
        )

    def test_a_paused_post_cannot_be_moved_to_now_or_once(self):
        # NOW or ONCE would set a send time the claim then refuses (the post is paused) and a
        # later resume moves active_from past it: the post would never go out.
        for data in (
            {"when": GroupPost.WHEN_NOW},
            {"when": GroupPost.WHEN_ONCE, "send_at": timezone.now() + timedelta(days=1)},
        ):
            with self.subTest(when=data["when"]):
                post = self.paused_weekly()
                with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
                    with self.assertRaises(services.PostRefused) as caught:
                        services.update_post(post, data)
                self.assertEqual(caught.exception.code, "paused")
                self.assertEqual(caught.exception.message, "Resume the post first, then change when it goes out.")
                self.assertEqual(tg.messages, [])
                post.refresh_from_db()
                self.assertEqual(post.when, GroupPost.WHEN_WEEKLY)

    def test_a_paused_weekly_post_can_still_change_its_text_and_days(self):
        post = self.paused_weekly()
        services.update_post(post, {"text": "b", "weekdays": [4]})
        post.refresh_from_db()
        self.assertEqual((post.text, post.weekdays, post.is_paused), ("b", [4], True))

    def test_a_post_that_is_not_paused_can_still_become_once(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        services.update_post(post, {"when": GroupPost.WHEN_ONCE, "send_at": timezone.now() + timedelta(days=1)})
        post.refresh_from_db()
        self.assertEqual(post.when, GroupPost.WHEN_ONCE)

    # ── "Now" is refused while posting is off (I4) ─────────────────────────
    def test_a_now_post_is_refused_while_posting_is_off_and_nothing_is_created(self):
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), self.assertRaises(services.PostRefused) as caught:
            services.create_post(data={"text": "Salom", "when": GroupPost.WHEN_NOW}, user=self.user)
        self.assertEqual(caught.exception.code, "off")
        self.assertEqual(
            caught.exception.message,
            "Posting to Telegram groups is switched off on this server — a Now post can't go out.",
        )
        self.assertEqual(GroupPost.objects.count(), 0)

    def test_a_scheduled_post_is_still_saved_while_posting_is_off(self):
        data = {"text": "Keyin", "when": GroupPost.WHEN_ONCE, "send_at": timezone.now() + timedelta(days=1)}
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False):
            post = services.create_post(data=data, user=self.user)
            weekly = services.create_post(
                data={"text": "w", "when": GroupPost.WHEN_WEEKLY, "weekdays": [5], "time_of_day": time(18, 0)},
                user=self.user,
            )
        self.assertEqual(GroupPost.objects.filter(pk__in=[post.pk, weekly.pk]).count(), 2)

    def test_an_edit_to_now_is_refused_while_posting_is_off_and_changes_nothing(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False), self.assertRaises(services.PostRefused) as caught:
            services.update_post(post, {"when": GroupPost.WHEN_NOW, "text": "changed"})
        self.assertEqual(caught.exception.code, "off")
        self.assertEqual((post.when, post.text), (GroupPost.WHEN_WEEKLY, "a"))  # not even in memory
        post.refresh_from_db()
        self.assertEqual((post.when, post.text, post.send_at), (GroupPost.WHEN_WEEKLY, "a", None))

    # ── an edit saves only what it touched (I6) ────────────────────────────
    def test_an_edit_does_not_overwrite_what_another_query_wrote_since_the_load(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        stale = GroupPost.objects.get(pk=post.pk)  # loaded before the sweep claimed a run
        deleted = timezone.now()
        GroupPost.objects.filter(pk=post.pk).update(last_run_on=date(2026, 10, 24), deleted_at=deleted)
        services.update_post(stale, {"text": "b", "weekdays": [4, 5]}, now=at(2026, 10, 24, 19))
        post.refresh_from_db()
        self.assertEqual((post.text, post.weekdays), ("b", [4, 5]))
        self.assertEqual(post.last_run_on, date(2026, 10, 24))  # the claim survived the edit
        self.assertEqual(post.deleted_at, deleted)  # so did the delete
        self.assertEqual(post.active_from, at(2026, 10, 24, 19))  # a schedule edit restarts the clock

    def test_an_edit_writes_only_the_fields_it_names(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with mock.patch.object(GroupPost, "save", autospec=True) as save:
            services.update_post(post, {"text": "b", "image": None, "not_a_field": 1}, now=at(2026, 10, 24, 19))
        self.assertEqual(
            sorted(save.call_args.kwargs["update_fields"]), ["image", "image_file_id", "text", "updated_at"]
        )

    def test_a_now_edit_also_writes_the_send_time_and_the_schedule_clock(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1),
        )
        with mock.patch.object(GroupPost, "save", autospec=True) as save, \
                self.captureOnCommitCallbacks(execute=False):
            services.update_post(post, {"when": GroupPost.WHEN_NOW}, now=at(2026, 10, 24, 19))
        self.assertEqual(
            sorted(save.call_args.kwargs["update_fields"]), ["active_from", "send_at", "updated_at", "when"]
        )

    # ── what an event's summary counts (small c) ───────────────────────────
    def test_event_summaries_leave_deleted_rows_out_and_count_them_apart(self):
        event = make_event()
        announce = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event, last_run_on=date(2026, 10, 24))
        for chat, status in [("-1001", D.STATUS_SENT), ("-1002", D.STATUS_FAILED), ("-1003", D.STATUS_DELETED)]:
            D.objects.create(post=announce, run_on=date(2026, 10, 24), chat_id=chat, status=status)
        self.assertEqual(
            services.event_summaries([event.pk]),
            {event.pk: {"post_id": announce.pk, "sent": 1, "failed": 1, "total": 2, "deleted": 1}},
        )

    def test_a_fully_deleted_announcement_has_no_total_and_a_deleted_count(self):
        event = make_event()
        announce = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=event, last_run_on=date(2026, 10, 24))
        for chat in ("-1001", "-1002"):
            D.objects.create(post=announce, run_on=date(2026, 10, 24), chat_id=chat, status=D.STATUS_DELETED)
        summary = services.event_summaries([event.pk])[event.pk]
        self.assertEqual((summary["total"], summary["sent"], summary["deleted"]), (0, 0, 2))

    # ── retry / missed ─────────────────────────────────────────────────────
    def test_retry_requeues_only_the_failed_rows_of_the_last_run(self):
        post = self.sent_post(when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED)
        D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_SENT, message_id=5)
        old = D.objects.create(post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_FAILED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            result = services.retry_failed(post)
        self.assertEqual(result, {"queued": 1, "uncertain": 0})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])
        old.refresh_from_db()
        self.assertEqual(old.status, D.STATUS_FAILED)

    def failed_row(self, post, chat, error):
        return D.objects.create(
            post=post, run_on=date(2026, 10, 24), chat_id=chat, status=D.STATUS_FAILED, error=error
        )

    def test_retry_never_resends_a_row_that_may_already_be_in_its_group(self):
        post = self.sent_post()
        certain = self.failed_row(post, "-1001", "403: Forbidden")
        interrupted = self.failed_row(post, "-1002", sender.INTERRUPTED)
        no_answer = self.failed_row(post, "-1003", sender.NO_ANSWER.format("timed out"))
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            result = services.retry_failed(post)
        self.assertEqual(result, {"queued": 1, "uncertain": 2})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])  # the two uncertain groups got nothing
        for row in (interrupted, no_answer):
            row.refresh_from_db()
            self.assertEqual(row.status, D.STATUS_FAILED)
            self.assertTrue(sender.is_uncertain(row.error))  # still readable by the page, untouched
        certain.refresh_from_db()
        self.assertEqual(certain.status, D.STATUS_SENT)

    def test_retry_with_only_uncertain_rows_queues_nothing(self):
        post = self.sent_post()
        row = self.failed_row(post, "-1001", sender.INTERRUPTED)
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            result = services.retry_failed(post)
        self.assertEqual(result, {"queued": 0, "uncertain": 1})
        self.assertEqual(tg.messages, [])
        row.refresh_from_db()
        self.assertEqual((row.status, row.error), (D.STATUS_FAILED, sender.INTERRUPTED))

    def test_retry_of_a_post_that_never_ran_reports_zero_of_both(self):
        self.assertEqual(
            services.retry_failed(self.sent_post(last_run_on=None)), {"queued": 0, "uncertain": 0}
        )

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
        self.assertEqual(stats, {"deleted": 1, "too_old": 1, "failed": 0, "in_flight": 0, "unknown": 0})
        self.assertEqual(tg.deleted, [("-1001", 11)])
        post.refresh_from_db()
        self.assertEqual(post.deleted_at, now)
        never.refresh_from_db()
        self.assertEqual(never.status, D.STATUS_DELETED)
        self.assertEqual(post.deliveries.get(chat_id="-1002").status, D.STATUS_SENT)

    def test_delete_leaves_uncertain_failed_rows_failed_and_counts_them_unknown(self):
        now = at(2026, 10, 24, 20)
        post = self.sent_post()
        refused = D.objects.create(
            post=post, run_on=date(2026, 10, 24), chat_id="-1001", status=D.STATUS_FAILED, error="403: Forbidden"
        )
        interrupted = D.objects.create(
            post=post, run_on=date(2026, 10, 24), chat_id="-1002", status=D.STATUS_FAILED, error=sender.INTERRUPTED
        )
        no_answer = D.objects.create(
            post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_FAILED,
            error=sender.NO_ANSWER.format("timed out"),
        )
        pending = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1003", status=D.STATUS_PENDING)
        missed = D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1004", status=D.STATUS_MISSED)
        with fake_api() as tg:
            stats = services.delete_from_groups(post, now=now)
        self.assertEqual(stats, {"deleted": 0, "too_old": 0, "failed": 0, "in_flight": 0, "unknown": 2})
        self.assertEqual(tg.deleted, [])
        for row in (refused, pending, missed):
            row.refresh_from_db()
            self.assertEqual(row.status, D.STATUS_DELETED)
        for row in (interrupted, no_answer):
            row.refresh_from_db()
            self.assertEqual(row.status, D.STATUS_FAILED)
            self.assertIsNone(row.deleted_at)
        post.refresh_from_db()
        self.assertEqual(post.deleted_at, now)  # the post itself is stopped for good all the same

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
            {
                "run_on": date(2026, 10, 24), "total": 2, "sent": 1, "failed": 1, "missed": 0,
                "pending": 0, "deleted": 0, "uncertain": 0,
            },
        )
        self.assertEqual(services.post_state(post, last, at(2026, 10, 24, 19)), "failed")
        weekly = GroupPost.objects.create(text="w", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), active_from=at(2026, 10, 1))
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "scheduled")
        weekly.is_paused = True
        self.assertEqual(services.post_state(weekly, None, at(2026, 10, 21)), "paused")

    def test_last_run_counts_the_uncertain_failures_inside_failed(self):
        post = self.sent_post()
        for chat, error in [
            ("-1001", "403: Forbidden"), ("-1002", sender.INTERRUPTED), ("-1003", sender.NO_ANSWER.format("x")),
        ]:
            D.objects.create(post=post, run_on=date(2026, 10, 24), chat_id=chat, status=D.STATUS_FAILED, error=error)
        D.objects.create(  # an older run's uncertain row is not this run's
            post=post, run_on=date(2026, 10, 17), chat_id="-1001", status=D.STATUS_FAILED, error=sender.INTERRUPTED
        )
        last = services.last_run(post, services.delivery_counts([post.pk]))
        self.assertEqual((last["total"], last["failed"], last["uncertain"]), (3, 3, 2))

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


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class DeleteDuringSendTests(TestCase):
    """A row SENDING when "Delete from groups" runs finishes as SENT: the sender takes it down."""

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

    def row(self, chat, status):
        return D.objects.create(post=self.post, run_on=self.run_on, chat_id=chat, status=status)

    def delete_inside_the_first_send(self, tg):
        """Make the fake's send_message delete the post, as an admin's click would mid-send."""
        seen = {}
        real_send = tg.send_message

        def send_then_delete(chat_id, text, *, reply_markup=None):
            if not seen:
                seen["stats"] = services.delete_from_groups(self.post)
            return real_send(chat_id, text, reply_markup=reply_markup)

        tg.send_message = send_then_delete
        return seen

    def test_a_row_still_sending_is_reported_in_flight(self):
        sending = self.row("-1001", D.STATUS_SENDING)
        with fake_api() as tg:
            stats = services.delete_from_groups(self.post, now=at(2026, 10, 24, 20))
        self.assertEqual(stats, {"deleted": 0, "too_old": 0, "failed": 0, "in_flight": 1, "unknown": 0})
        self.assertEqual(tg.deleted, [])
        sending.refresh_from_db()
        self.assertEqual(sending.status, D.STATUS_SENDING)

    def test_a_send_that_finishes_after_the_delete_takes_its_message_down(self):
        first, second = self.row("-1001", D.STATUS_PENDING), self.row("-1002", D.STATUS_PENDING)
        with fake_api() as tg:
            seen = self.delete_inside_the_first_send(tg)
            sender.send_pending(self.post, self.run_on)
        self.assertEqual(seen["stats"]["in_flight"], 1)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.status, D.STATUS_DELETED)
        self.assertIsNotNone(first.deleted_at)
        self.assertEqual(tg.deleted, [("-1001", first.message_id)])
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])  # the other group was never sent to
        self.assertEqual(second.status, D.STATUS_DELETED)

    def test_a_message_already_gone_still_ends_deleted(self):
        row = self.row("-1001", D.STATUS_PENDING)
        with fake_api() as tg:
            self.delete_inside_the_first_send(tg)
            tg.script["delete:-1001"] = [TgResult(False, error_code=400, description="Bad Request: message to delete not found")]
            sender.send_pending(self.post, self.run_on)
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_DELETED)

    def test_a_take_down_that_fails_leaves_the_row_sent_with_the_reason(self):
        row = self.row("-1001", D.STATUS_PENDING)
        with fake_api() as tg:
            self.delete_inside_the_first_send(tg)
            tg.script["delete:-1001"] = [TgResult(False, error_code=403, description="Forbidden: bot was kicked")]
            sender.send_pending(self.post, self.run_on)
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_SENT)
        self.assertIn("Delete failed", row.error)
        self.assertIn("kicked", row.error)

    def test_a_take_down_that_raises_does_not_break_the_send(self):
        row = self.row("-1001", D.STATUS_PENDING)
        with fake_api() as tg:
            self.delete_inside_the_first_send(tg)
            tg.delete_message = mock.Mock(side_effect=RuntimeError("boom"))
            with self.assertLogs("telegram_posts", level="ERROR"):
                stats = sender.send_pending(self.post, self.run_on)
        self.assertEqual(stats["sent"], 1)
        row.refresh_from_db()
        self.assertEqual(row.status, D.STATUS_SENT)

    def test_a_post_that_was_not_deleted_is_never_taken_down(self):
        self.row("-1001", D.STATUS_PENDING)
        with fake_api() as tg:
            sender.send_pending(self.post, self.run_on)
        self.assertEqual(tg.deleted, [])
        self.assertEqual(self.post.deliveries.get().status, D.STATUS_SENT)
