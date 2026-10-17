"""An event's Telegram half (plan 2026-10-17): the form's choice, the posts Publish creates,
and the summary the ops row shows. Students never see any of it."""

from __future__ import annotations

import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom
from events.models import Event
from telegram_posts import audience, schedule, services as telegram_posts
from telegram_posts.models import GroupPost
from telegram_posts.testkit import TOKEN, fake_api, make_room, staff
from users.models import User


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="",
)
class EventTelegramTests(TestCase):
    def setUp(self):
        self.admin = staff()
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 English", subject=Classroom.SUBJECT_ENGLISH, level="junior", chat="-1002")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.now = timezone.now()
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)

    def body(self, **over):
        body = {
            "title": "Admission Workshop", "description": "Bring questions.",
            "starts_at": (self.now + timedelta(days=3)).isoformat(),
            "ends_at": (self.now + timedelta(days=3, hours=2)).isoformat(),
            "location": "MasterSAT, Room 2", "seats": 30,
        }
        body.update(over)
        return body

    def draft(self, **kw):
        return Event.objects.create(
            title="Admission Workshop", starts_at=self.now + timedelta(days=3),
            ends_at=self.now + timedelta(days=3, hours=2), seats=30, created_by=self.admin, **kw,
        )

    def publish(self, event):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(f"/api/events/admin/{event.pk}/publish/")
        return response, tg

    # ── the form ───────────────────────────────────────────────────────────
    def test_the_form_takes_the_telegram_choice(self):
        response = self.client.post(
            "/api/events/admin/",
            self.body(telegram_post=False, telegram_audience={"subjects": ["MATH"], "levels": []}),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        event = Event.objects.get(pk=response.json()["id"])
        self.assertEqual((event.telegram_post, event.telegram_audience), (False, {"subjects": ["MATH"], "levels": []}))

    def test_multipart_carries_the_audience_as_a_json_string(self):
        response = self.client.post(
            "/api/events/admin/",
            self.body(telegram_post="true", telegram_audience=json.dumps({"subjects": [], "levels": ["senior"]})),
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            Event.objects.get(pk=response.json()["id"]).telegram_audience, {"subjects": [], "levels": ["senior"]}
        )

    def test_a_multipart_form_without_the_box_still_posts(self):
        # DRF reads a missing multipart boolean as False unless the field has a default.
        response = self.client.post("/api/events/admin/", self.body(), format="multipart")
        self.assertTrue(Event.objects.get(pk=response.json()["id"]).telegram_post)

    def test_an_unknown_subject_is_refused(self):
        response = self.client.post(
            "/api/events/admin/", self.body(telegram_audience={"subjects": ["PHYSICS"]}), format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("telegram_audience", response.json())

    # ── publishing ─────────────────────────────────────────────────────────
    def test_publishing_posts_to_the_groups_and_plans_the_reminder(self):
        event = self.draft(telegram_audience={"subjects": ["MATH"], "levels": []})
        response, tg = self.publish(event)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])
        self.assertTrue(tg.messages[0][1].startswith("📢 <b>Admission Workshop</b>"))
        reminder = GroupPost.objects.get(event=event, kind=GroupPost.KIND_EVENT_REMINDER)
        self.assertEqual((reminder.when, reminder.subjects), (GroupPost.WHEN_EVENT, ["MATH"]))

    def test_publishing_twice_posts_once(self):
        event = self.draft()
        self.publish(event)
        _response, tg = self.publish(event)
        self.assertEqual(tg.messages, [])
        self.assertEqual(GroupPost.objects.filter(event=event).count(), 2)

    def test_no_posts_when_the_box_is_unticked(self):
        _response, tg = self.publish(self.draft(telegram_post=False))
        self.assertEqual((tg.messages, GroupPost.objects.count()), ([], 0))

    @override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False)
    def test_no_posts_with_the_flag_off(self):
        _response, tg = self.publish(self.draft())
        self.assertEqual((tg.messages, GroupPost.objects.count()), ([], 0))

    def test_a_telegram_failure_never_breaks_publishing(self):
        event = self.draft()
        with mock.patch("telegram_posts.services.on_event_published", side_effect=RuntimeError("boom")):
            with self.assertLogs("events.services", "ERROR") as logged:
                response = self.client.post(f"/api/events/admin/{event.pk}/publish/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["announced"])
        self.assertIn("event_telegram_posts_failed", logged.output[0])
        self.assertIn("boom", "\n".join(logged.output))

    def test_on_event_published_twice_makes_two_posts_and_sends_once(self):
        event = self.draft(status=Event.STATUS_PUBLISHED, published_at=self.now)
        with fake_api() as tg:
            # on-commit callbacks run when each block closes, so each call is sent (or not) in turn
            with self.captureOnCommitCallbacks(execute=True):
                first = telegram_posts.on_event_published(event, now=self.now)
            sent_after_first = list(tg.messages)
            with self.captureOnCommitCallbacks(execute=True):
                second = telegram_posts.on_event_published(event, now=self.now)
        self.assertEqual(second.pk, first.pk)
        self.assertEqual(GroupPost.objects.filter(event=event).count(), 2)
        self.assertEqual(sorted(m[0] for m in sent_after_first), ["-1001", "-1002"])
        self.assertEqual(tg.messages, sent_after_first)  # the second call sent nothing

    # ── the reminder reads the event when it goes out ──────────────────────
    def test_the_reminder_follows_a_changed_audience(self):
        event = self.draft(telegram_audience={"subjects": ["MATH"], "levels": []})
        self.publish(event)
        reminder = GroupPost.objects.get(event=event, kind=GroupPost.KIND_EVENT_REMINDER)
        self.assertEqual([t.chat_id for t in audience.for_post(reminder)], ["-1001"])
        Event.objects.filter(pk=event.pk).update(telegram_audience={"subjects": ["ENGLISH"], "levels": []})
        reminder = GroupPost.objects.select_related("event").get(pk=reminder.pk)
        self.assertEqual([t.chat_id for t in audience.for_post(reminder)], ["-1002"])
        # The announcement was sent at Publish and keeps what it was sent to.
        announce = GroupPost.objects.select_related("event").get(event=event, kind=GroupPost.KIND_EVENT_ANNOUNCE)
        self.assertEqual([t.chat_id for t in audience.for_post(announce)], ["-1001"])

    def test_the_console_labels_a_reminder_with_the_groups_it_will_reach(self):
        event = self.draft(telegram_audience={"subjects": ["MATH"], "levels": []})
        self.publish(event)
        reminder = GroupPost.objects.get(event=event, kind=GroupPost.KIND_EVENT_REMINDER)
        announce = GroupPost.objects.get(event=event, kind=GroupPost.KIND_EVENT_ANNOUNCE)

        def rows():
            posts = self.client.get("/api/telegram-posts/admin/").json()["posts"]
            return {p["id"]: p for p in posts}

        self.assertEqual(rows()[reminder.pk]["audience_label"], "Math · all levels")
        Event.objects.filter(pk=event.pk).update(telegram_audience={"subjects": ["ENGLISH"], "levels": []})
        row = rows()[reminder.pk]
        self.assertEqual((row["audience_label"], row["subjects"], row["levels"]), ("English · all levels", ["ENGLISH"], []))
        self.assertEqual(row["classroom_ids"], [])
        detail = self.client.get(f"/api/telegram-posts/admin/{reminder.pk}/").json()
        self.assertEqual((detail["audience_label"], detail["subjects"]), ("English · all levels", ["ENGLISH"]))
        # The announcement was sent to Math and says so.
        sent = rows()[announce.pk]
        self.assertEqual((sent["audience_label"], sent["subjects"]), ("Math · all levels", ["MATH"]))

    def test_unticking_the_box_after_publishing_cancels_the_reminder(self):
        event = self.draft()
        self.publish(event)
        reminder = GroupPost.objects.select_related("event").get(event=event, kind=GroupPost.KIND_EVENT_REMINDER)
        evening = schedule.reminder_at(reminder.event)
        self.assertIsNotNone(schedule.due(reminder, evening))
        Event.objects.filter(pk=event.pk).update(telegram_post=False)
        reminder = GroupPost.objects.select_related("event").get(pk=reminder.pk)
        self.assertIsNone(schedule.due(reminder, evening))
        self.assertIsNone(schedule.next_at(reminder, self.now))

    # ── what the ops row shows ─────────────────────────────────────────────
    def test_the_ops_payload_carries_the_summary(self):
        event = self.draft()
        self.publish(event)
        row = self.client.get("/api/events/admin/").json()["events"][0]
        summary = row["telegram"]
        self.assertEqual((summary["sent"], summary["failed"], summary["total"]), (2, 0, 2))
        self.assertEqual(row["telegram_audience"], {"subjects": [], "levels": []})
        self.assertTrue(row["telegram_post"])
        detail = self.client.get(f"/api/events/admin/{event.pk}/").json()
        self.assertEqual(detail["telegram"]["post_id"], summary["post_id"])

    def test_students_never_see_it(self):
        self.publish(self.draft())
        student = User.objects.create_user("ev_tg_student@t.com", "x", role=C.ROLE_STUDENT)
        self.client.force_authenticate(student)
        rows = self.client.get("/api/events/").json()["events"]
        self.assertTrue(rows)
        for key in ("telegram", "telegram_post", "telegram_audience"):
            self.assertNotIn(key, rows[0])
