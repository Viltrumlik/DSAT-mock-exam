"""APNs — the iOS app's push transport."""

from __future__ import annotations

from unittest import mock

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C

from . import apns
from .models import ApnsDevice, Notification
from .tasks import send_apns_for_notifications

User = get_user_model()

_PRIVATE = ec.generate_private_key(ec.SECP256R1())
_PEM = _PRIVATE.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
).decode()
TOKEN_A = "a" * 64
TOKEN_B = "b" * 64

CONFIGURED = dict(APNS_KEY_ID="KEY1234567", APNS_TEAM_ID="TEAM123456", APNS_AUTH_KEY=_PEM, APNS_TOPIC="uz.mastersat.app")


class RegisterTests(TestCase):
    def setUp(self):
        self.anna = User.objects.create_user("apns_anna@t.com", "secret123", role=C.ROLE_STUDENT)
        self.ben = User.objects.create_user("apns_ben@t.com", "secret123", role=C.ROLE_STUDENT)
        self.client = APIClient(HTTP_X_MASTERSAT_CLIENT="ios-test")

    def register(self, user, token=TOKEN_A, **extra):
        self.client.force_authenticate(user)
        return self.client.post(
            "/api/notifications/push/apns/register/",
            {"token": token, "environment": "sandbox", "bundle_id": "uz.mastersat.app", "app_version": "1.1.0", **extra},
            format="json",
        )

    def test_register_then_reregister_moves_the_phone_to_whoever_is_signed_in(self):
        self.assertEqual(self.register(self.anna).status_code, 201)
        device = ApnsDevice.objects.get()
        self.assertEqual((device.user, device.environment, device.app_version), (self.anna, "sandbox", "1.1.0"))
        # The same phone, now signed in as someone else.
        self.assertEqual(self.register(self.ben).status_code, 200)
        self.assertEqual(ApnsDevice.objects.get().user, self.ben)

    def test_a_reregistration_clears_a_previous_failure(self):
        self.register(self.anna)
        ApnsDevice.objects.update(failed_at="2026-09-01T00:00:00Z", failure_reason="Unregistered")
        self.register(self.anna)
        device = ApnsDevice.objects.get()
        self.assertIsNone(device.failed_at)
        self.assertEqual(device.failure_reason, "")

    def test_bad_tokens_are_refused(self):
        for bad in ("", "xyz", "a" * 10, "Z" * 64):
            self.assertEqual(self.register(self.anna, token=bad).status_code, 400, bad)

    def test_unregister_is_scoped_to_the_caller(self):
        self.register(self.anna)
        self.client.force_authenticate(self.ben)
        res = self.client.post("/api/notifications/push/apns/unregister/", {"token": TOKEN_A}, format="json")
        self.assertEqual(res.json()["deleted"], 0)
        self.client.force_authenticate(self.anna)
        res = self.client.post("/api/notifications/push/apns/unregister/", {"token": TOKEN_A}, format="json")
        self.assertEqual(res.json()["deleted"], 1)

    def test_config_reports_apns_separately(self):
        self.client.force_authenticate(self.anna)
        self.assertFalse(self.client.get("/api/notifications/push/config/").json()["apns_enabled"])
        with override_settings(**CONFIGURED), mock.patch.object(apns, "_transport_available", return_value=True):
            self.assertTrue(self.client.get("/api/notifications/push/config/").json()["apns_enabled"])


@override_settings(**CONFIGURED)
@mock.patch.object(apns, "_transport_available", return_value=True)
class SendTests(TestCase):
    def setUp(self):
        apns.reset_for_tests()
        self.anna = User.objects.create_user("apns_send@t.com", "secret123", role=C.ROLE_STUDENT)
        self.device = ApnsDevice.objects.create(user=self.anna, token=TOKEN_A, environment="production")
        self.notification = Notification.objects.create(
            recipient=self.anna, category="GRADES", event="HOMEWORK_GRADED",
            title="Your homework was marked", body="Essay — 8/10", link_url="/classes/3",
        )

    def test_a_push_carries_the_link_the_badge_and_a_signed_token(self, _transport):
        with mock.patch.object(apns, "_post", return_value=(200, "")) as post:
            ok = apns.send_to_device(self.device, apns.payload_for(self.notification, badge=4))
        self.assertTrue(ok)
        url, headers, body = post.call_args.args
        self.assertEqual(url, f"https://api.push.apple.com/3/device/{TOKEN_A}")
        self.assertEqual(headers["apns-topic"], "uz.mastersat.app")
        self.assertEqual(headers["apns-push-type"], "alert")
        token = headers["authorization"].split(" ", 1)[1]
        self.assertEqual(jwt.get_unverified_header(token)["kid"], "KEY1234567")
        claims = jwt.decode(token, _PRIVATE.public_key(), algorithms=["ES256"])
        self.assertEqual(claims["iss"], "TEAM123456")
        import json

        payload = json.loads(body)
        self.assertEqual(payload["link"], "/classes/3")
        self.assertEqual(payload["aps"]["badge"], 4)
        self.assertEqual(payload["aps"]["thread-id"], "GRADES")

    def test_a_sandbox_device_goes_to_the_sandbox_host(self, _transport):
        self.device.environment = ApnsDevice.ENV_SANDBOX
        with mock.patch.object(apns, "_post", return_value=(200, "")) as post:
            apns.send_to_device(self.device, {"aps": {}})
        self.assertTrue(post.call_args.args[0].startswith("https://api.sandbox.push.apple.com/"))

    def test_a_dead_token_is_marked_and_not_retried(self, _transport):
        for status, reason in ((410, "Unregistered"), (400, "BadDeviceToken")):
            ApnsDevice.objects.filter(pk=self.device.pk).update(failed_at=None, failure_reason="")
            self.device.refresh_from_db()
            with mock.patch.object(apns, "_post", return_value=(status, reason)) as post:
                self.assertFalse(apns.send_to_device(self.device, {"aps": {}}))
            self.assertEqual(post.call_count, 1)
            self.device.refresh_from_db()
            self.assertIsNotNone(self.device.failed_at)
            self.assertEqual(self.device.failure_reason, reason)

    def test_an_expired_provider_token_is_resigned_once(self, _transport):
        with mock.patch.object(apns, "_post", side_effect=[(403, "ExpiredProviderToken"), (200, "")]) as post:
            self.assertTrue(apns.send_to_device(self.device, {"aps": {}}))
        self.assertEqual(post.call_count, 2)

    def test_a_network_error_is_swallowed(self, _transport):
        with mock.patch.object(apns, "_post", side_effect=OSError("boom")):
            self.assertFalse(apns.send_to_device(self.device, {"aps": {}}))

    def test_the_task_sends_to_live_devices_with_the_unread_count(self, _transport):
        ApnsDevice.objects.create(user=self.anna, token=TOKEN_B, failed_at="2026-09-01T00:00:00Z")
        Notification.objects.create(recipient=self.anna, category="HOMEWORK", event="HOMEWORK_ASSIGNED", title="t")
        with mock.patch.object(apns, "_post", return_value=(200, "")) as post:
            result = send_apns_for_notifications([self.notification.pk])
        self.assertEqual(result["sent"], 1)  # the failed device is skipped
        import json

        self.assertEqual(json.loads(post.call_args.args[2])["aps"]["badge"], 2)

    def test_the_task_does_nothing_when_not_configured(self, _transport):
        with override_settings(APNS_KEY_ID=""), mock.patch.object(apns, "_post") as post:
            self.assertEqual(send_apns_for_notifications([self.notification.pk])["skipped"], "not configured")
        post.assert_not_called()


class QueueTests(TestCase):
    def test_a_push_event_queues_the_apns_task_after_commit(self):
        from . import services

        user = User.objects.create_user("apns_queue@t.com", "secret123", role=C.ROLE_STUDENT)
        with override_settings(**CONFIGURED), mock.patch.object(apns, "_transport_available", return_value=True), \
                mock.patch("notifications.tasks.send_apns_for_notifications.delay") as apns_delay, \
                mock.patch("notifications.tasks.send_push_for_notification.delay"):
            with self.captureOnCommitCallbacks(execute=True):
                notification = services.notify(
                    user, event="HOMEWORK_ASSIGNED", title="New homework", link_url="/classes/1/assignments/2"
                )
        self.assertIsNotNone(notification)
        apns_delay.assert_called_once_with([notification.pk])

    def test_nothing_is_queued_for_apns_when_it_is_not_configured(self):
        from . import services

        user = User.objects.create_user("apns_queue_off@t.com", "secret123", role=C.ROLE_STUDENT)
        with mock.patch("notifications.tasks.send_apns_for_notifications.delay") as apns_delay, \
                mock.patch("notifications.tasks.send_push_for_notification.delay"):
            with self.captureOnCommitCallbacks(execute=True):
                services.notify(user, event="HOMEWORK_ASSIGNED", title="New homework")
        apns_delay.assert_not_called()
