"""On the test copy every SMS, Telegram message, e-mail and push is captured, not sent (Part A, Task A2).

Each hook, with the copy on: the real network call is never made, and one ``CapturedMessage`` of its channel is
written. With it off: the real call is made, exactly as before."""

import json
import sys
import types
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from staging.models import CapturedMessage
from staging.tests_guard import copy_on

User = get_user_model()

#: The class bot's token on the copy is a dummy one ("so the code reaches the capture point").
CLASS_BOT = override_settings(TELEGRAM_BOT_TOKEN="123456:STAGING-DUMMY", CLASSROOM_TELEGRAM_BOT_TOKEN="")
TELEGRAM_OK = {"ok": True, "result": {"message_id": 7}}


class _Answer:
    """What ``urlopen`` hands back."""

    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def rows(channel=None):
    qs = CapturedMessage.objects.order_by("id")
    return list(qs.filter(channel=channel) if channel else qs)


class EskizTests(TestCase):
    def setUp(self):
        from sms import eskiz

        cache.delete_many([eskiz.TOKEN_KEY, eskiz.LOGIN_REFUSED_KEY, eskiz.LOCK_KEY])

    def test_on_the_copy_the_client_is_the_capture_and_counts_as_configured(self):
        from sms import conf, eskiz
        from staging.capture_eskiz import CaptureEskiz

        with copy_on():
            self.assertIsInstance(eskiz.default_client(), CaptureEskiz)
            self.assertTrue(conf.is_configured())  # the copy's eskiz credentials are blank
        self.assertIsInstance(eskiz.default_client(), eskiz.EskizClient)
        self.assertFalse(conf.is_configured())

    def test_an_sms_on_the_copy_is_captured_and_recorded_as_eskiz_took_it(self):
        from sms.delivery import deliver
        from sms.eskiz import default_client
        from sms.models import SmsMessage

        with copy_on(), mock.patch("requests.Session.request") as http:
            msg = deliver(
                default_client(), kind=SmsMessage.KIND_TEST, run_on=date(2026, 11, 25), dedupe_key="t1",
                phone="998901234567", text="Salom",
            )
        http.assert_not_called()
        msg.refresh_from_db()
        self.assertEqual(msg.status, SmsMessage.STATUS_SENT)
        self.assertTrue(msg.request_id)
        self.assertIsNotNone(msg.sent_at)
        [row] = rows()
        self.assertEqual((row.channel, row.to, row.body), ("sms", "998901234567", "Salom"))
        self.assertEqual(row.meta["user_sms_id"], f"m{msg.pk}")

    @override_settings(ESKIZ_EMAIL="ops@example.uz", ESKIZ_SECRET_KEY="key")
    def test_off_the_copy_the_sms_goes_to_eskiz(self):
        from sms.eskiz import ACCEPTED, default_client

        answers = {
            "/auth/login": {"data": {"token": "jwt"}},
            "/message/sms/send": {"id": "req-1", "status": "waiting"},
        }

        def request(method, url, **kwargs):
            body = next(answer for path, answer in answers.items() if url.endswith(path))
            return mock.Mock(status_code=200, json=mock.Mock(return_value=body))

        with mock.patch("requests.Session.request", side_effect=request) as http:
            result = default_client().send("998901234567", "Salom")
        self.assertEqual(result.outcome, ACCEPTED)
        self.assertEqual(http.call_count, 2)
        self.assertEqual(rows(), [])

    def test_the_captures_status_check_templates_and_balance(self):
        from sms import eskiz_templates
        from sms.models import EskizTemplate
        from staging.capture_eskiz import CaptureEskiz

        EskizTemplate.objects.create(
            eskiz_id=12, pattern="Salom %w", original="Salom {name}", status="service", synced_at=timezone.now()
        )
        client = CaptureEskiz()
        self.assertEqual(client.balance(), 999_999)
        self.assertEqual(client.status("stg-1").status, "DELIVERED")
        self.assertEqual(client.check("Hisobingiz"), {"forbidden": False, "keywords": []})
        self.assertEqual(
            client.templates(), [{"id": 12, "template": "Salom %w", "original_text": "Salom {name}", "status": "service"}]
        )
        # The 09:00 sync reads them back: nothing is marked gone.
        self.assertEqual(eskiz_templates.sync(client)["gone"], 0)
        self.assertEqual(EskizTemplate.objects.get(eskiz_id=12).status, "service")

    def test_a_template_submitted_on_the_copy_waits_in_moderation(self):
        from sms import eskiz_templates
        from staging.capture_eskiz import CaptureEskiz

        row, _counts = eskiz_templates.submit(CaptureEskiz(), "Yangi matn", None)
        self.assertEqual((row.original, row.status), ("Yangi matn", "moderation"))
        self.assertEqual(rows(), [])


@CLASS_BOT
class ClassBotTests(TestCase):
    def test_on_the_copy_a_message_is_captured_and_telegram_is_never_called(self):
        from classes import telegram_group_api as api

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            sent = api.send_message(-1001, "<b>Salom</b>", reply_markup={"inline_keyboard": []})
        urlopen.assert_not_called()
        self.assertTrue(sent.ok)
        self.assertIsInstance(sent.result["message_id"], int)
        [row] = rows()
        self.assertEqual((row.channel, row.to, row.body), ("telegram", "-1001", "<b>Salom</b>"))
        self.assertEqual(row.meta["method"], "sendMessage")

    def test_a_photo_is_captured_with_its_caption(self):
        from classes import telegram_group_api as api

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            sent = api.send_photo(-1002, caption="Ochiq dars", photo=b"\xff\xd8\xff", filename="p.jpg")
        urlopen.assert_not_called()
        self.assertTrue(sent.ok)
        self.assertEqual(api.largest_photo_file_id(sent.result), "")
        [row] = rows()
        self.assertEqual((row.to, row.body, row.meta["method"]), ("-1002", "Ochiq dars", "sendPhoto"))

    def test_an_invite_link_is_a_dummy_one(self):
        from classes import telegram_group_api as api

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            made = api.create_one_time_invite_link("-1003", name="c1-u2", expire_unix=1, member_limit=1)
        urlopen.assert_not_called()
        self.assertEqual(made.result["invite_link"], "https://t.me/+STAGING")
        [row] = rows()
        self.assertEqual((row.to, row.body), ("-1003", "createChatInviteLink"))

    def test_a_kick_is_captured(self):
        from classes import telegram_group_api as api

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            self.assertTrue(api.kick_chat_member("-1004", 555).ok)
        urlopen.assert_not_called()
        self.assertEqual([r.meta["method"] for r in rows()], ["banChatMember", "unbanChatMember"])
        self.assertEqual(rows()[0].meta["user_id"], "555")

    def test_reads_answer_what_the_site_believes_and_are_not_messages(self):
        from classes import telegram_group_api as api
        from classes.models import Classroom
        from classes.models_telegram import ClassroomTelegramMember

        admin = User.objects.create_user("tg_admin@t.com", "x", role="admin")
        room = Classroom.objects.create(
            name="G1", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=admin,
            telegram_chat_id="-1005",
        )
        ClassroomTelegramMember.objects.create(
            classroom=room, telegram_user_id=777, status=ClassroomTelegramMember.STATUS_JOINED
        )
        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            bot = api.get_chat_member("-1005", 123456)
            member = api.get_chat_member("-1005", 777)
            stranger = api.get_chat_member("-1005", 888)
            chat = api.get_chat("-1005")
            count = api.get_chat_member_count("-1005")
            me = api.get_me()
        urlopen.assert_not_called()
        self.assertEqual(
            (bot.result["status"], bot.result["can_invite_users"], bot.result["can_restrict_members"]),
            ("administrator", True, True),
        )
        self.assertEqual(member.result["status"], "member")
        self.assertEqual(stranger.result["status"], "left")
        self.assertTrue(chat.ok and isinstance(chat.result, dict))
        self.assertTrue(count.ok)
        self.assertEqual(me.result["username"], "")  # no deep link to a bot that is not ours
        self.assertEqual(rows(), [])

    def test_off_the_copy_telegram_is_called(self):
        from classes import telegram_group_api as api

        with mock.patch("urllib.request.urlopen", return_value=_Answer(TELEGRAM_OK)) as urlopen:
            sent = api.send_message(-1001, "Salom")
        urlopen.assert_called_once()
        self.assertEqual(sent.result, {"message_id": 7})
        self.assertEqual(rows(), [])


class ReportBotTests(TestCase):
    def test_on_the_copy_the_report_is_captured(self):
        from question_reports.telegram import edit_telegram_message, send_telegram_message

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            message_id = send_telegram_message(token="9:STAGING-DUMMY", chat_id="-100500", text="Report #3")
            edited = edit_telegram_message(token="9:STAGING-DUMMY", chat_id="-100500", message_id=1, text="Fixed")
        urlopen.assert_not_called()
        self.assertIsInstance(message_id, int)
        self.assertTrue(edited)
        self.assertEqual(
            [(r.channel, r.to, r.body, r.meta["method"]) for r in rows()],
            [("telegram", "-100500", "Report #3", "sendMessage"), ("telegram", "-100500", "Fixed", "editMessageText")],
        )

    def test_off_the_copy_telegram_is_called(self):
        from question_reports.telegram import send_telegram_message

        with mock.patch("urllib.request.urlopen", return_value=_Answer(TELEGRAM_OK)) as urlopen:
            self.assertEqual(send_telegram_message(token="9:REAL", chat_id="-100500", text="Report #3"), 7)
        urlopen.assert_called_once()
        self.assertEqual(rows(), [])


class OpsAlertTests(TestCase):
    def test_on_the_copy_the_alert_is_captured(self):
        from config.ops_alerting import _telegram_send

        with copy_on(), mock.patch("urllib.request.urlopen") as urlopen:
            _telegram_send(token="1:X", chat_id="-42", text="Disk 90%")
        urlopen.assert_not_called()
        [row] = rows()
        self.assertEqual((row.channel, row.to, row.body), ("telegram", "-42", "Disk 90%"))

    def test_off_the_copy_telegram_is_called(self):
        from config.ops_alerting import _telegram_send

        with mock.patch("urllib.request.urlopen", return_value=_Answer(TELEGRAM_OK)) as urlopen:
            _telegram_send(token="1:X", chat_id="-42", text="Disk 90%")
        urlopen.assert_called_once()
        self.assertEqual(rows(), [])


def fake_pywebpush():
    """pywebpush as ``notifications.push`` imports it: ``webpush`` and ``WebPushException``."""
    module = types.ModuleType("pywebpush")
    module.webpush = mock.Mock()
    module.WebPushException = type("WebPushException", (Exception,), {})
    return module


class PushTests(TestCase):
    def setUp(self):
        from notifications.models import ApnsDevice, Notification, PushSubscription

        self.user = User.objects.create_user("stg_push@t.com", "x", role="student")
        self.subscription = PushSubscription.objects.create(
            user=self.user, endpoint="https://push.example/abc", p256dh="key", auth="auth"
        )
        self.device = ApnsDevice.objects.create(user=self.user, token="a" * 64, environment="production")
        self.notification = Notification.objects.create(
            recipient=self.user, category="GRADES", event="HOMEWORK_GRADED", title="Homework marked", body="Essay 8/10",
            link_url="/classes/3",
        )
        self.payload = {"title": "Homework marked", "body": "Essay 8/10", "url": "/classes/3", "category": "GRADES", "id": 1}

    def test_on_the_copy_a_web_push_is_captured(self):
        from notifications import push

        library = fake_pywebpush()
        with copy_on(), mock.patch.dict(sys.modules, {"pywebpush": library}):
            self.assertTrue(push.send_to_subscription(self.subscription, self.payload))
        library.webpush.assert_not_called()
        [row] = rows()
        self.assertEqual((row.channel, row.subject, row.body), ("push", "Homework marked", "Essay 8/10"))
        self.assertEqual((row.meta["user_id"], row.meta["transport"]), (self.user.pk, "web"))

    def test_off_the_copy_a_web_push_goes_out(self):
        from notifications import push

        library = fake_pywebpush()
        with override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv"), \
                mock.patch.dict(sys.modules, {"pywebpush": library}):
            self.assertTrue(push.send_to_subscription(self.subscription, self.payload))
        library.webpush.assert_called_once()
        self.assertEqual(rows(), [])

    def test_on_the_copy_an_apns_push_is_captured(self):
        from notifications import apns

        apns.reset_for_tests()
        with copy_on(), mock.patch.object(apns, "_post") as post:
            self.assertTrue(apns.send_to_device(self.device, apns.payload_for(self.notification, badge=2)))
        post.assert_not_called()
        [row] = rows()
        self.assertEqual((row.channel, row.subject, row.body), ("push", "Homework marked", "Essay 8/10"))
        self.assertEqual(row.meta["transport"], "apns")

    def test_off_the_copy_an_apns_push_goes_out(self):
        from notifications import apns
        from notifications.tests_apns import CONFIGURED

        apns.reset_for_tests()
        with override_settings(**CONFIGURED), mock.patch.object(apns, "_transport_available", return_value=True), \
                mock.patch.object(apns, "_post", return_value=(200, "")) as post:
            self.assertTrue(apns.send_to_device(self.device, apns.payload_for(self.notification)))
        post.assert_called_once()
        self.assertEqual(rows(), [])

    def test_on_the_copy_the_fan_outs_reach_the_capture_without_keys(self):
        """The copy has no VAPID or APNs keys (credentials stay blank), so the fan-outs must not stop there."""
        from notifications.tasks import send_apns_for_notifications, send_push_for_notification

        with copy_on():
            self.assertEqual(send_push_for_notification(self.notification.pk), {"sent": 1})
            self.assertEqual(send_apns_for_notifications([self.notification.pk])["sent"], 1)
        self.assertEqual(sorted(r.meta["transport"] for r in rows("push")), ["apns", "web"])

    def test_off_the_copy_the_fan_outs_still_need_keys(self):
        from notifications.tasks import send_apns_for_notifications, send_push_for_notification

        self.assertEqual(send_push_for_notification(self.notification.pk), {"sent": 0, "skipped": "not configured"})
        self.assertEqual(send_apns_for_notifications([self.notification.pk]), {"sent": 0, "skipped": "not configured"})
        self.assertEqual(rows(), [])
