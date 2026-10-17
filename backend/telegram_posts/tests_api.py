"""The ops console's API for group posts: who may use it, and what it does."""

from __future__ import annotations

import json
import tempfile
from datetime import date, time, timedelta
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom
from telegram_posts.models import GroupPost, GroupPostDelivery
from telegram_posts.testkit import PNG_1PX, TOKEN, fake_api, make_event, make_room, staff
from users.models import User

URL = "/api/telegram-posts/admin/"
_ADMIN_HOST = "admin.mastersat.uz"


@override_settings(
    TELEGRAM_GROUP_POSTS_ENABLED=True, CLASSROOM_TELEGRAM_BOT_TOKEN=TOKEN,
    CELERY_TASK_ALWAYS_EAGER=True, CELERY_BROKER_URL="", MEDIA_ROOT=tempfile.mkdtemp(),
)
class ApiFixture(TestCase):
    def setUp(self):
        self.admin = staff()
        self.teacher = User.objects.create_user("tp_teacher@t.com", "x", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH)
        self.student = User.objects.create_user("tp_student@t.com", "x", role=C.ROLE_STUDENT)
        make_room("Senior G1 Math", chat="-1001")
        make_room("Junior G2 English", subject=Classroom.SUBJECT_ENGLISH, level="junior", chat="-1002")
        self.client = APIClient()
        patch = mock.patch("telegram_posts.sender._sleep")
        patch.start()
        self.addCleanup(patch.stop)

    def as_(self, user):
        self.client.force_authenticate(user)
        return self.client


class AccessTests(ApiFixture):
    def test_students_and_teachers_are_refused(self):
        self.assertEqual(self.as_(self.student).get(URL).status_code, 403)
        self.assertEqual(self.as_(self.teacher).get(URL).status_code, 403)

    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get(URL).status_code, 401)

    def test_an_admin_is_let_in(self):
        self.assertEqual(self.as_(self.admin).get(URL).status_code, 200)

    @override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver", _ADMIN_HOST])
    def test_the_admin_console_host_is_not_refused_by_the_host_guard(self):
        """access.host_guard allowlists paths per console; a forgotten entry 403s before the
        view is reached, which a same-host test would never notice."""
        response = self.as_(self.admin).get(URL, HTTP_HOST=_ADMIN_HOST)
        self.assertEqual(response.status_code, 200)


class EveryRouteIsGuardedTests(ApiFixture):
    """Each view calls `_guard` by hand, so dropping it from one method would pass the tests that
    only look at `GET admin/`. This runs every route as an anonymous caller, a student and a
    teacher, and checks that the answer is a refusal AND that nothing happened behind it."""

    def _seed(self, *, paused: bool):
        """A post with a failed, a missed and a sent delivery, so every action would do something."""
        GroupPost.objects.all().delete()
        today = timezone.localdate()
        post = GroupPost.objects.create(
            text="Original", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0),
            last_run_on=today, is_paused=paused,
        )
        for chat, status, extra in [
            ("-1001", "FAILED", {}),
            ("-1002", "MISSED", {}),
            ("-1003", "SENT", {"message_id": 11, "sent_at": timezone.now()}),
        ]:
            GroupPostDelivery.objects.create(post=post, run_on=today, chat_id=chat, status=status, **extra)
        return post

    def _cases(self):
        by_id = lambda suffix="": (lambda post: f"{URL}{post.pk}/{suffix}")  # noqa: E731
        cases = [
            ("GET admin/", "get", lambda post: URL, None, False),
            ("POST admin/", "post", lambda post: URL, {"text": "Intruder", "when": "NOW"}, False),
            ("GET admin/groups/", "get", lambda post: f"{URL}groups/", None, False),
            ("GET admin/<id>/", "get", by_id(), None, False),
            ("PATCH admin/<id>/", "patch", by_id(), {"text": "Hijacked"}, False),
        ]
        for action in ("pause", "resume", "retry", "send-missed", "delete-from-groups"):
            # `resume` does nothing to a post that is not paused, so that one starts paused.
            cases.append((f"POST admin/<id>/{action}/", "post", by_id(f"{action}/"), None, action == "resume"))
        return cases

    def test_every_route_refuses_anonymous_students_and_teachers_and_does_nothing(self):
        callers = [("anonymous", None, 401), ("student", self.student, 403), ("teacher", self.teacher, 403)]
        for label, method, url_of, body, paused in self._cases():
            for who, user, expected in callers:
                with self.subTest(route=label, caller=who):
                    post = self._seed(paused=paused)
                    before = (post.is_paused, post.deleted_at, post.text)
                    deliveries = list(post.deliveries.order_by("id").values_list("chat_id", "status"))
                    client = self.as_(user) if user else APIClient()
                    kwargs = {"format": "json"} if body is not None else {}
                    with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
                        response = getattr(client, method)(url_of(post), body, **kwargs)
                    self.assertEqual(response.status_code, expected, response.content)
                    self.assertEqual(GroupPost.objects.count(), 1)  # nothing was created
                    post.refresh_from_db()
                    self.assertEqual((post.is_paused, post.deleted_at, post.text), before)
                    self.assertEqual(list(post.deliveries.order_by("id").values_list("chat_id", "status")), deliveries)
                    self.assertEqual((tg.messages, tg.photos, tg.deleted), ([], [], []))  # and nothing was sent


class CreateTests(ApiFixture):
    def test_a_now_post_goes_out(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, {"text": "Ertaga mock!", "when": "NOW"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(sorted(m[0] for m in tg.messages), ["-1001", "-1002"])

    def test_multipart_with_a_picture_and_json_string_lists(self):
        body = {
            "text": "Mock", "when": "NOW", "subjects": json.dumps(["MATH"]), "levels": "[]",
            "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png"),
        }
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, body, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["subjects"], ["MATH"])
        self.assertEqual([(p[0], p[2]) for p in tg.photos], [("-1001", "upload")])

    def test_the_rules(self):
        cases = [
            ({"text": "  ", "when": "NOW"}, "text"),
            ({"text": "x" * 4097, "when": "NOW"}, "text"),
            ({"text": "a", "when": "NOW", "button_text": "Go"}, "button_url"),
            ({"text": "a", "when": "NOW", "button_text": "Go", "button_url": "http://x.uz"}, "button_url"),
            ({"text": "a", "when": "WEEKLY", "time_of_day": "18:00"}, "weekdays"),
            ({"text": "a", "when": "WEEKLY", "weekdays": [5]}, "time_of_day"),
            ({"text": "a", "when": "ONCE", "send_at": (timezone.now() - timedelta(hours=1)).isoformat()}, "send_at"),
            ({"text": "a", "when": "NOW", "classroom_ids": [99999]}, "classroom_ids"),
            ({"text": "a", "when": "NOW", "subjects": ["PHYSICS"]}, "subjects"),
        ]
        for body, field in cases:
            with self.subTest(field=field, body=body):
                response = self.as_(self.admin).post(URL, body, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_a_caption_is_held_to_1024(self):
        body = {"text": "x" * 1025, "when": "NOW", "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png")}
        response = self.as_(self.admin).post(URL, body, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("text", response.json())

    def test_the_length_is_counted_in_utf16_units_like_the_consoles_counter(self):
        """An emoji is 2 units: 520 of them are 1040, over a picture's 1024, though Python's len says 520."""
        emoji = {"text": "\U0001F600" * 520, "when": "NOW", "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png")}
        refused = self.as_(self.admin).post(URL, emoji, format="multipart")
        self.assertEqual(refused.status_code, 400)
        self.assertIn("this is 1040", refused.json()["text"][0])
        plain = {"text": "x" * 1010, "when": "NOW", "image": SimpleUploadedFile("m.png", PNG_1PX, content_type="image/png")}
        with fake_api(), self.captureOnCommitCallbacks(execute=True):
            accepted = self.as_(self.admin).post(URL, plain, format="multipart")
        self.assertEqual(accepted.status_code, 201, accepted.content)

    def test_a_post_without_when_is_refused_not_sent_to_everyone(self):
        """`when` has no default on create: a forgotten field must never mean "now, to every group"."""
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, {"text": "Ertaga mock!"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["when"], ["Choose when it goes out."])
        self.assertEqual(GroupPost.objects.count(), 0)
        self.assertEqual((tg.messages, tg.photos), ([], []))

    def test_the_audience_lists_are_deduplicated_in_first_seen_order(self):
        room = Classroom.objects.get(name="Senior G1 Math")
        body = {
            "text": "Mock", "when": "ONCE", "send_at": (timezone.now() + timedelta(days=2)).isoformat(),
            "subjects": ["MATH", "ENGLISH", "MATH"], "levels": ["senior", "junior", "senior"],
            "classroom_ids": [room.pk, room.pk],
        }
        payload = self.as_(self.admin).post(URL, body, format="json").json()
        self.assertEqual(payload["subjects"], ["MATH", "ENGLISH"])
        self.assertEqual(payload["levels"], ["senior", "junior"])
        self.assertEqual(payload["classroom_ids"], [room.pk])
        self.assertEqual(payload["audience_label"], "1 chosen group")  # not "2 chosen groups"

    @override_settings(TELEGRAM_GROUP_POSTS_ENABLED=False)
    def test_with_the_flag_off_it_is_saved_but_not_sent(self):
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            response = self.as_(self.admin).post(URL, {"text": "a", "when": "NOW"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(tg.messages, [])
        self.assertFalse(self.as_(self.admin).get(URL).json()["enabled"])


class ReadTests(ApiFixture):
    def test_the_list(self):
        GroupPost.objects.create(
            text="Ertaga yakshanba mock!", when=GroupPost.WHEN_WEEKLY, weekdays=[5],
            time_of_day=time(18, 0), created_by=self.admin,
        )
        payload = self.as_(self.admin).get(URL).json()
        self.assertTrue(payload["enabled"])
        row = payload["posts"][0]
        self.assertEqual(row["audience_label"], "All groups")
        self.assertEqual(row["state"], "scheduled")
        self.assertEqual(row["preview"], "Ertaga yakshanba mock!")
        self.assertIsNotNone(row["next_send_at"])
        self.assertIsNone(row["last_run"])

    def test_the_detail_has_runs(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=date(2026, 10, 24))
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1001", status="SENT", group_names="Senior G1 Math")
        GroupPostDelivery.objects.create(post=post, run_on=date(2026, 10, 24), chat_id="-1002", status="FAILED", error="403: Forbidden")
        payload = self.as_(self.admin).get(f"{URL}{post.pk}/").json()
        self.assertEqual(payload["runs"][0]["run_on"], "2026-10-24")
        self.assertEqual([d["status"] for d in payload["runs"][0]["deliveries"]], ["SENT", "FAILED"])
        self.assertEqual(payload["last_run"]["failed"], 1)
        self.assertEqual(payload["state"], "failed")

    def test_the_groups(self):
        payload = self.as_(self.admin).get(f"{URL}groups/").json()
        self.assertTrue(payload["enabled"])
        self.assertEqual([g["chat_id"] for g in payload["groups"]], ["-1001", "-1002"])

    def test_an_event_post_shows_the_event(self):
        # A fixed start would stop rendering once the real clock passes it (render.event_reminder).
        event = make_event(title="Admission Workshop", starts_at=timezone.now() + timedelta(days=3))
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_REMINDER, when=GroupPost.WHEN_EVENT, event=event)
        row = self.as_(self.admin).get(f"{URL}{post.pk}/").json()
        self.assertEqual((row["event_id"], row["event_title"]), (event.pk, "Admission Workshop"))
        self.assertTrue(row["preview"].startswith("⏰"))


class EditAndActionTests(ApiFixture):
    def test_an_event_post_is_edited_through_its_event(self):
        post = GroupPost.objects.create(kind=GroupPost.KIND_EVENT_ANNOUNCE, event=make_event())
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "x"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "event_post"))

    def test_a_sent_post_is_not_edited(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=date(2026, 10, 24))
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "x"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "already_sent"))

    def test_editing_a_weekly_post(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "Yangi matn"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["text"], "Yangi matn")

    def test_a_patch_does_not_need_when(self):
        """`when` is required to create a post, not to edit one."""
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now() + timedelta(days=2))
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", {"text": "Yangi matn"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["text"], response.json()["when"]), ("Yangi matn", "ONCE"))

    def test_a_weekly_post_that_has_run_cannot_become_a_once_post(self):
        post = GroupPost.objects.create(
            text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0), last_run_on=date(2026, 10, 24)
        )
        body = {"when": "ONCE", "send_at": (timezone.now() + timedelta(days=2)).isoformat()}
        response = self.as_(self.admin).patch(f"{URL}{post.pk}/", body, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "already_ran"))
        post.refresh_from_db()
        self.assertEqual(post.when, GroupPost.WHEN_WEEKLY)

    def test_pause_and_resume(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_WEEKLY, weekdays=[5], time_of_day=time(18, 0))
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/pause/").json()["post"]["state"], "paused")
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/resume/").json()["post"]["state"], "scheduled")

    def test_delete_from_groups(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=timezone.localdate())
        GroupPostDelivery.objects.create(post=post, run_on=timezone.localdate(), chat_id="-1001", status="SENT", message_id=11, sent_at=timezone.now())
        with fake_api() as tg:
            payload = self.as_(self.admin).post(f"{URL}{post.pk}/delete-from-groups/").json()
        self.assertEqual(payload["result"], {"deleted": 1, "too_old": 0, "failed": 0, "in_flight": 0})
        self.assertEqual(payload["post"]["state"], "deleted")
        self.assertEqual(tg.deleted, [("-1001", 11)])

    def test_retry(self):
        post = GroupPost.objects.create(text="a", when=GroupPost.WHEN_ONCE, send_at=timezone.now(), last_run_on=timezone.localdate())
        GroupPostDelivery.objects.create(post=post, run_on=timezone.localdate(), chat_id="-1001", status="FAILED")
        with fake_api() as tg, self.captureOnCommitCallbacks(execute=True):
            payload = self.as_(self.admin).post(f"{URL}{post.pk}/retry/").json()
        self.assertEqual(payload["result"], {"queued": 1})
        self.assertEqual([m[0] for m in tg.messages], ["-1001"])

    def test_an_unknown_action_is_404(self):
        post = GroupPost.objects.create(text="a")
        self.assertEqual(self.as_(self.admin).post(f"{URL}{post.pk}/explode/").status_code, 404)
