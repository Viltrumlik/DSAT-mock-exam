"""Notifications: the inbox, its sections, read state, and the push registration behind them.

Two properties matter more than the rest, and both are about failure. `notify` must never
raise into its caller — nobody's grade should fail to save because a bell failed to ring — and
a deployment with no VAPID keys must never ask a student for notification permission, because
a refusal is permanent per origin and burns the one chance to ask.
"""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from notifications import constants
from notifications.models import Notification, NotificationPreference, PushSubscription
from notifications.services import mark_read, notify, notify_many, unread_summary

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class NotifyTests(TestCase):
    def setUp(self):
        self.student = _u("nt_student@t.com")

    def test_it_writes_a_row_in_the_right_section(self):
        note = notify(
            self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked",
        )

        self.assertEqual(note.category, constants.CATEGORY_GRADES)
        self.assertFalse(note.is_read)

    def test_an_unknown_event_lands_in_system_rather_than_raising(self):
        """A notification that cannot be categorised should still reach the student."""
        note = notify(self.student, event="SOMETHING_NEW", title="Hello")
        self.assertEqual(note.category, constants.CATEGORY_SYSTEM)

    def test_a_muted_category_writes_nothing(self):
        NotificationPreference.objects.create(
            user=self.student, muted_categories=[constants.CATEGORY_REWARDS]
        )

        self.assertIsNone(
            notify(self.student, event=constants.EVENT_REWARD_EARNED, title="Points!")
        )
        self.assertEqual(Notification.objects.count(), 0)

    def test_muting_one_section_does_not_mute_another(self):
        NotificationPreference.objects.create(
            user=self.student, muted_categories=[constants.CATEGORY_REWARDS]
        )

        self.assertIsNotNone(
            notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked")
        )

    def test_a_dedupe_key_collapses_a_repeat(self):
        """Four items in one bundle each trigger a grade write. That is one piece of news."""
        notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked", dedupe_key="g:1")
        notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked again", dedupe_key="g:1")

        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Notification.objects.get().title, "Marked again")

    def test_a_repeat_outside_the_window_is_news_again(self):
        first = notify(
            self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked", dedupe_key="g:2"
        )
        Notification.objects.filter(pk=first.pk).update(
            created_at=timezone.now() - timedelta(hours=5)
        )

        notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Re-marked", dedupe_key="g:2")

        self.assertEqual(Notification.objects.count(), 2)

    def test_a_collapsed_repeat_becomes_unread_again(self):
        note = notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="A", dedupe_key="g:3")
        mark_read(self.student, ids=[note.pk])

        notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="B", dedupe_key="g:3")

        note.refresh_from_db()
        self.assertFalse(note.is_read)

    def test_it_never_raises_into_its_caller(self):
        """The property every hook site depends on."""
        with patch(
            "notifications.models.Notification.objects.create", side_effect=RuntimeError("boom")
        ):
            self.assertIsNone(
                notify(self.student, event=constants.EVENT_SYSTEM, title="Anything")
            )

    def test_a_realtime_failure_does_not_lose_the_notification(self):
        """The hint is best-effort; the row is the product."""
        with patch("realtime.services.emit_to_user", side_effect=RuntimeError("redis down")):
            note = notify(self.student, event=constants.EVENT_SYSTEM, title="Still saved")

        self.assertIsNotNone(note)
        self.assertEqual(Notification.objects.count(), 1)

    def test_notify_many_reports_how_many_landed(self):
        muted = _u("nt_muted@t.com")
        NotificationPreference.objects.create(
            user=muted, muted_categories=[constants.CATEGORY_SYSTEM]
        )
        others = [self.student, _u("nt_other@t.com"), muted]

        self.assertEqual(notify_many(others, event=constants.EVENT_SYSTEM, title="Notice"), 2)

    def test_an_empty_title_writes_nothing(self):
        self.assertIsNone(notify(self.student, event=constants.EVENT_SYSTEM, title=""))


class ReadStateTests(TestCase):
    def setUp(self):
        self.student = _u("nr_student@t.com")
        self.other = _u("nr_other@t.com")
        self.graded = notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="A")
        self.support = notify(self.student, event=constants.EVENT_SUPPORT_BOOKED, title="B")

    def test_the_summary_counts_per_section(self):
        summary = unread_summary(self.student)

        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["by_category"][constants.CATEGORY_GRADES], 1)

    def test_marking_one_section_leaves_the_others(self):
        mark_read(self.student, category=constants.CATEGORY_GRADES)

        summary = unread_summary(self.student)
        self.assertEqual(summary["total"], 1)
        self.assertNotIn(constants.CATEGORY_GRADES, summary["by_category"])

    def test_marking_everything_clears_the_badge(self):
        mark_read(self.student)
        self.assertEqual(unread_summary(self.student)["total"], 0)

    def test_an_id_belonging_to_somebody_else_matches_nothing(self):
        """Scoped by construction, so there is no ownership check that could be forgotten."""
        theirs = notify(self.other, event=constants.EVENT_SYSTEM, title="Theirs")

        self.assertEqual(mark_read(self.student, ids=[theirs.pk]), 0)
        theirs.refresh_from_db()
        self.assertFalse(theirs.is_read)


class NotificationApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("na_student@t.com")
        notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked")
        notify(self.student, event=constants.EVENT_SUPPORT_BOOKED, title="Booked")

    def test_it_requires_a_login(self):
        self.assertEqual(self.client.get("/api/notifications/").status_code, 401)

    def test_the_inbox_carries_the_counts_and_the_sections(self):
        self.client.force_authenticate(self.student)

        body = self.client.get("/api/notifications/").json()

        self.assertEqual(len(body["notifications"]), 2)
        self.assertEqual(body["unread_total"], 2)
        self.assertIn(constants.CATEGORY_GRADES, body["unread_by_category"])
        self.assertTrue(any(c["value"] == constants.CATEGORY_GRADES for c in body["categories"]))

    def test_it_filters_by_section(self):
        self.client.force_authenticate(self.student)

        body = self.client.get(
            f"/api/notifications/?category={constants.CATEGORY_SUPPORT}"
        ).json()

        self.assertEqual([n["title"] for n in body["notifications"]], ["Booked"])

    def test_a_student_never_sees_somebody_elses(self):
        other = _u("na_other@t.com")
        notify(other, event=constants.EVENT_SYSTEM, title="Not yours")
        self.client.force_authenticate(self.student)

        titles = [n["title"] for n in self.client.get("/api/notifications/").json()["notifications"]]

        self.assertNotIn("Not yours", titles)

    def test_marking_read_over_http(self):
        self.client.force_authenticate(self.student)

        body = self.client.post("/api/notifications/read/", {}, format="json").json()

        self.assertEqual(body["marked"], 2)
        self.assertEqual(body["total"], 0)

    def test_the_summary_endpoint_does_not_return_a_list(self):
        """The bell polls this to draw a dot — fetching 50 rows to render one would be waste."""
        self.client.force_authenticate(self.student)

        body = self.client.get("/api/notifications/summary/").json()

        self.assertEqual(body["total"], 2)
        self.assertNotIn("notifications", body)

    def test_preferences_round_trip(self):
        self.client.force_authenticate(self.student)

        self.client.patch("/api/notifications/preferences/", {
            "muted_categories": [constants.CATEGORY_REWARDS, "NONSENSE"],
            "push_enabled": False,
        }, format="json")
        body = self.client.get("/api/notifications/preferences/").json()

        # The unknown value is dropped rather than 400ing — a stale client should not be able
        # to make the preferences screen unusable.
        self.assertEqual(body["muted_categories"], [constants.CATEGORY_REWARDS])
        self.assertFalse(body["push_enabled"])


class PushTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = _u("np_student@t.com")

    def test_push_reports_itself_disabled_without_keys(self):
        """The load-bearing one. A client that asked for permission here would burn the
        platform's single, permanent chance to ask."""
        self.client.force_authenticate(self.student)

        with self.settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            body = self.client.get("/api/notifications/push/config/").json()

        self.assertFalse(body["enabled"])
        self.assertEqual(body["public_key"], "")

    def test_subscribing_stores_the_browsers_keys(self):
        self.client.force_authenticate(self.student)

        response = self.client.post("/api/notifications/push/subscribe/", {
            "endpoint": "https://push.example/abc",
            "keys": {"p256dh": "key", "auth": "secret"},
        }, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(PushSubscription.objects.get().user, self.student)

    def test_resubscribing_the_same_device_updates_rather_than_duplicating(self):
        """Keyed on endpoint, so a student who re-subscribes does not get duplicate buzzes."""
        self.client.force_authenticate(self.student)
        payload = {
            "endpoint": "https://push.example/abc",
            "keys": {"p256dh": "key", "auth": "secret"},
        }
        self.client.post("/api/notifications/push/subscribe/", payload, format="json")
        self.client.post("/api/notifications/push/subscribe/", payload, format="json")

        self.assertEqual(PushSubscription.objects.count(), 1)

    def test_an_incomplete_subscription_is_refused(self):
        self.client.force_authenticate(self.student)

        response = self.client.post("/api/notifications/push/subscribe/", {
            "endpoint": "https://push.example/abc",
        }, format="json")

        self.assertEqual(response.status_code, 400)

    def test_unsubscribing_only_touches_your_own_device(self):
        other = _u("np_other@t.com")
        PushSubscription.objects.create(
            user=other, endpoint="https://push.example/theirs", p256dh="k", auth="a"
        )
        self.client.force_authenticate(self.student)

        body = self.client.post("/api/notifications/push/unsubscribe/", {
            "endpoint": "https://push.example/theirs",
        }, format="json").json()

        self.assertEqual(body["deleted"], 0)
        self.assertEqual(PushSubscription.objects.count(), 1)

    def test_nothing_is_queued_when_push_is_unconfigured(self):
        from notifications.tasks import send_push_for_notification

        note = notify(self.student, event=constants.EVENT_HOMEWORK_GRADED, title="Marked")

        with self.settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            result = send_push_for_notification(note.pk)

        self.assertEqual(result["sent"], 0)
