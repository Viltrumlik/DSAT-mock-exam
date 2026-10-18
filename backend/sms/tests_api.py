"""``/api/sms/admin/``: who may use it, and that each answer is the shape the panel is built to
(``docs/superpowers/plans/2026-10-18-sms-ops-panel-api.md``)."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import URLPattern
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import LcupStudentLink, LinkStatus
from sms import eskiz, urls, views
from sms import templates as T
from sms.eskiz import FAILED
from sms.models import EskizTemplate, SmsCampaign, SmsMessage, SmsSettings
from sms.testing import FakeEskiz
from users.models import User

API = "/api/sms/admin/"
_ADMIN_HOST = "admin.mastersat.uz"
CONFIGURED = {"ESKIZ_EMAIL": "ops@example.uz", "ESKIZ_SECRET_KEY": "key"}
ORIGINAL_64942 = (
    "MASTER SAT'dan yozyabmiz. (STUDENT), sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun zudlik bilan "
    "administratsiyaga uchrang!"
)
TEMPLATE_ROWS = [
    {"id": 64942, "template": T.DEBT_WARNING.text, "original_text": ORIGINAL_64942, "status": "service"},
    {"id": 52393, "template": T.DEBT_LAST_DAY.text, "original_text": "Bugun oxirgi kun! (STUDENT), …", "status": "service"},
    {"id": 64950, "template": "Hurmatli %w{1,4} %d so'm qarzingiz bor.",
     "original_text": "Hurmatli (STUDENT) (SUM) so'm qarzingiz bor.", "status": "reklama"},
    {"id": 70000, "template": "Ertaga %w{1,3} soat %d da dars.", "original_text": "Ertaga (GROUP) soat (TIME) da dars.",
     "status": "service"},
    {"id": 80000, "template": "", "original_text": "Kutilmoqda (STUDENT)", "status": "moderation"},
]
MESSAGE_KEYS = {
    "id", "created_at", "sent_at", "kind", "status", "eskiz_status", "phone", "text", "parts", "request_id", "error",
    "user", "lcup_student_id", "campaign_id", "created_by_name",
}
CAMPAIGN_KEYS = {
    "id", "status", "template_eskiz_id", "pattern", "original", "slot_roles", "slot_texts", "audience", "audience_ids",
    "audience_label", "scheduled_at", "created_at", "started_at", "finished_at", "created_by_name", "error", "result",
}
RESULT_KEYS = {"sent", "failed", "rejected", "uncertain", "delivered", "undelivered", "errors", "skipped"}
TEMPLATE_KEYS = {
    "eskiz_id", "status", "pattern", "original", "slots", "guessed_roles", "parts", "ascii", "usable", "synced_at",
    "submitted_by_name", "submitted_at",
}
SETTINGS_KEYS = {
    "debt_enabled", "debt_hour", "warning_template_id", "warning_pattern", "warning_slots", "last_day_template_id",
    "last_day_pattern", "last_day_slots", "updated_at", "updated_by_name", "env_enabled", "freeze_enabled", "freeze_day",
}
_OFFSET = re.compile(r"[+-]\d\d:\d\d$")


@override_settings(
    SMS_DEBT_WARNINGS_ENABLED=True, LCUP_DEBT_FREEZE_ENABLED=True, LCUP_DEBT_FREEZE_DAY=6, SMS_PRICE_PER_PART=170,
    **CONFIGURED,
)
class ApiFixture(TestCase):
    def setUp(self):
        for key in (views.BALANCE_KEY, eskiz.TOKEN_KEY, eskiz.LOGIN_REFUSED_KEY):
            cache.delete(key)
        self.admin = User.objects.create_user(None, password=None, username="boss", role=C.ROLE_ADMIN, first_name="Bo", last_name="Ss")
        self.super = User.objects.create_user(None, password=None, username="root", role=C.ROLE_SUPER_ADMIN)
        self.teacher = User.objects.create_user(None, password=None, username="t", role=C.ROLE_TEACHER, subject="math")
        self.student = User.objects.create_user(None, password=None, username="pupil", role=C.ROLE_STUDENT)
        self.fake = FakeEskiz(template_rows=TEMPLATE_ROWS)
        now = timezone.now()
        for row in TEMPLATE_ROWS:
            EskizTemplate.objects.create(
                eskiz_id=row["id"], pattern=row["template"], original=row["original_text"], status=row["status"],
                synced_at=now,
            )
        self.room = Classroom.objects.create(
            name="Junior G21 | Math", subject=Classroom.SUBJECT_MATH, level="junior", lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        self.malika = self.learner(101, "malika", balance=-150000, room=self.room)
        for target, value in (
            ("sms.eskiz.default_client", self.fake),
        ):
            patcher = mock.patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.queued = {}
        for name in ("send_due_campaigns", "retry_campaign", "debt_warnings_now"):
            patcher = mock.patch(f"sms.tasks.{name}.delay")
            self.queued[name] = patcher.start()
            self.addCleanup(patcher.stop)
        self.api = APIClient()

    def learner(self, lcup_id, username, *, balance, phone="998901234567", room=None, name=None):
        user = User.objects.create_user(
            None, password=None, username=username, role=C.ROLE_STUDENT, first_name=username.title(), last_name="Karimova",
        )
        LcupStudentLink.objects.create(
            lcup_student_id=lcup_id, name=name or f"Karimova {username.title()}", user=user,
            status=LinkStatus.CONFIRMED, phone=phone, balance=Decimal(balance), balance_seen_at=timezone.now(),
        )
        if room is not None:
            ClassroomMembership.objects.create(classroom=room, user=user, role=ClassroomMembership.ROLE_STUDENT)
        return user

    def as_(self, user=None):
        self.api.force_authenticate(user or self.admin)
        return self.api

    def get(self, path, user=None, **params):
        return self.as_(user).get(API + path, params)

    def post(self, path, body=None, user=None):
        return self.as_(user).post(API + path, body or {}, format="json")

    def patch(self, path, body, user=None):
        return self.as_(user).patch(API + path, body, format="json")

    def draft(self, **extra):
        body = {
            "template_id": 64942, "slot_roles": ["student"], "slot_texts": [""],
            "audience": "student", "audience_ids": [self.malika.pk], "scheduled_at": None,
        }
        body.update(extra)
        return body


class AccessTests(ApiFixture):
    def test_signed_out_is_401(self):
        self.assertEqual(APIClient().get(API + "overview/").status_code, 401)

    def test_students_and_teachers_are_refused(self):
        self.assertEqual(self.get("overview/", self.student).status_code, 403)
        self.assertEqual(self.get("overview/", self.teacher).status_code, 403)

    def test_admins_are_let_in(self):
        self.assertEqual(self.get("overview/", self.admin).status_code, 200)
        self.assertEqual(self.get("overview/", self.super).status_code, 200)

    @override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver", _ADMIN_HOST])
    def test_the_admin_console_host_is_not_refused_by_the_host_guard(self):
        """access.host_guard allowlists paths per console; a forgotten entry 403s before the view."""
        response = self.as_().get(API + "overview/", HTTP_HOST=_ADMIN_HOST)
        self.assertEqual(response.status_code, 200)


class EveryRouteIsGuardedTests(ApiFixture):
    """Every route in ``sms.urls``, every method its view has, as an anonymous caller, a student and a
    teacher: a refusal, and nothing done behind it — no row, no SMS, no submit, nothing queued."""

    BODIES = {
        "sms-admin-campaigns": None,  # filled in setUp: a valid draft
        "sms-admin-campaign-preview": None,
        "sms-admin-settings": {"debt_enabled": False, "debt_hour": 9},
        "sms-admin-templates": {"text": "Salom (STUDENT)!"},
        "sms-admin-test": {"phone": "998901234567", "template_id": 64942},
    }

    def setUp(self):
        super().setUp()
        self.scheduled = SmsCampaign.objects.create(
            template_eskiz_id=64942, pattern=T.DEBT_WARNING.text, slot_roles=["student"], slot_texts=[""],
            audience="debtors", scheduled_at=timezone.now() + timedelta(hours=1), created_by=self.admin,
        )
        self.done = SmsCampaign.objects.create(
            template_eskiz_id=64942, pattern=T.DEBT_WARNING.text, slot_roles=["student"], slot_texts=[""],
            audience="debtors", scheduled_at=timezone.now(), status=SmsCampaign.STATUS_DONE, created_by=self.admin,
        )
        SmsMessage.objects.create(
            kind="campaign", run_on=date(2026, 10, 18), dedupe_key=f"campaign:{self.done.pk}:student:101",
            phone="998901234567", text="x", status=SmsMessage.STATUS_FAILED, campaign=self.done,
        )

    def _routes(self):
        for pattern in urls.urlpatterns:
            self.assertIsInstance(pattern, URLPattern)
            view = pattern.callback.view_class
            pk = self.scheduled.pk if pattern.name == "sms-admin-campaign-cancel" else self.done.pk
            path = "/api/sms/" + re.sub(r"<int:pk>", str(pk), str(pattern.pattern))
            for method in ("get", "post", "patch", "put", "delete"):
                if hasattr(view, method):
                    body = self.BODIES.get(pattern.name) or (self.draft() if "campaign" in pattern.name else {})
                    yield pattern.name, method, path, body

    def _state(self):
        settings = SmsSettings.get()
        return (
            list(SmsMessage.objects.order_by("id").values_list("id", "status", "attempts")),
            list(SmsCampaign.objects.order_by("id").values_list("id", "status")),
            list(EskizTemplate.objects.order_by("eskiz_id").values_list("eskiz_id", "status", "submitted_by")),
            (settings.debt_enabled, settings.debt_hour, settings.updated_by_id),
        )

    def test_every_route_refuses_anonymous_students_and_teachers_and_does_nothing(self):
        routes = list(self._routes())
        self.assertGreaterEqual(len(routes), 19)
        callers = [("anonymous", None, 401), ("student", self.student, 403), ("teacher", self.teacher, 403)]
        before = self._state()
        for name, method, path, body in routes:
            for who, user, expected in callers:
                with self.subTest(route=f"{method.upper()} {name}", caller=who):
                    client = APIClient()
                    if user:
                        client.force_authenticate(user)
                    kwargs = {"format": "json"} if method != "get" else {}
                    with self.captureOnCommitCallbacks(execute=True):
                        response = getattr(client, method)(path, body if method != "get" else None, **kwargs)
                    self.assertEqual(response.status_code, expected, response.content)
        self.assertEqual(self._state(), before)
        self.assertEqual((self.fake.sent, self.fake.submitted, self.fake.balance_calls), ([], [], 0))
        for name, delay in self.queued.items():
            self.assertFalse(delay.called, name)


class OverviewTests(ApiFixture):
    def test_the_shape(self):
        SmsMessage.objects.create(
            kind="test", run_on=timezone.localdate(), dedupe_key="test:1", phone="998901234567", text="x",
            status=SmsMessage.STATUS_DELIVERED, error="",
        )
        SmsMessage.objects.create(
            kind="test", run_on=timezone.localdate(), dedupe_key="test:2", phone="998901234567", text="x",
            status=SmsMessage.STATUS_REJECTED, error="HTTP 422: mobile_phone: …",
        )
        with mock.patch("sms.views._today", return_value=date(2026, 10, 18)):
            data = self.get("overview/").json()
        self.assertEqual(set(data), {"configured", "balance", "price_per_part", "sender", "eskiz", "debt", "today", "last7"})
        self.assertEqual((data["configured"], data["balance"], data["price_per_part"], data["sender"]), (True, 125000, 170, "4546"))
        self.assertEqual(data["eskiz"], {"token_cached": False, "login_refused": False, "last_error": "HTTP 422: mobile_phone: …"})
        self.assertEqual(data["debt"], {
            "enabled": True, "env_enabled": True, "db_enabled": True, "freeze_enabled": True, "hour": 10,
            "next_day": "2026-11-01", "next_count": 1,
        })
        self.assertEqual(data["today"], {"total": 2, "by_status": {"DELIVERED": 1, "REJECTED": 1}})
        self.assertEqual(data["last7"]["total"], 2)

    def test_the_next_day_is_today_on_a_warning_day(self):
        with mock.patch("sms.views._today", return_value=date(2026, 11, 5)):
            debt = self.get("overview/").json()["debt"]
        self.assertEqual((debt["next_day"], debt["next_count"]), ("2026-11-05", 1))

    @override_settings(LCUP_DEBT_FREEZE_ENABLED=False)
    def test_no_next_day_while_the_freeze_is_off(self):
        with mock.patch("sms.views._today", return_value=date(2026, 11, 3)):
            debt = self.get("overview/").json()["debt"]
        self.assertEqual((debt["enabled"], debt["freeze_enabled"], debt["next_day"], debt["next_count"]), (False, False, None, 0))

    def test_no_next_day_while_the_panel_switch_is_off(self):
        self.patch("settings/", {"debt_enabled": False})
        with mock.patch("sms.views._today", return_value=date(2026, 11, 3)):
            debt = self.get("overview/").json()["debt"]
        self.assertEqual((debt["enabled"], debt["db_enabled"], debt["next_day"], debt["next_count"]), (False, False, None, 0))

    def test_the_balance_is_cached(self):
        self.get("overview/")
        self.get("overview/")
        self.assertEqual(self.fake.balance_calls, 1)

    def test_no_login_for_the_balance_after_a_refused_one(self):
        cache.set(eskiz.LOGIN_REFUSED_KEY, "1")
        data = self.get("overview/").json()
        self.assertIsNone(data["balance"])
        self.assertTrue(data["eskiz"]["login_refused"])
        self.assertEqual(self.fake.balance_calls, 0)

    def test_an_unanswered_balance_is_null(self):
        self.fake.account_error = "HTTP 500"
        self.assertIsNone(self.get("overview/").json()["balance"])

    @override_settings(ESKIZ_EMAIL="", SMS_DEBT_WARNINGS_ENABLED=False)
    def test_not_configured_and_the_env_switch_off(self):
        data = self.get("overview/").json()
        self.assertEqual((data["configured"], data["balance"]), (False, None))
        self.assertEqual((data["debt"]["enabled"], data["debt"]["env_enabled"], data["debt"]["db_enabled"]), (False, False, True))


class MessagesTests(ApiFixture):
    def setUp(self):
        super().setUp()
        self.old = SmsMessage.objects.create(
            kind="debt_warning", run_on=date(2026, 9, 1), dedupe_key="student:101", phone="998901234567",
            text="MASTER SAT'dan yozyabmiz. Karimova Malika, sizda…", user=self.malika, lcup_student_id=101,
            status=SmsMessage.STATUS_DELIVERED,
        )
        SmsMessage.objects.filter(pk=self.old.pk).update(created_at=timezone.now() - timedelta(days=40))
        self.test_sms = SmsMessage.objects.create(
            kind="test", run_on=timezone.localdate(), dedupe_key="test:1", phone="998880032508", text="Test Testov, sizda",
            status=SmsMessage.STATUS_SENT, created_by=self.admin,
        )

    def test_the_row(self):
        data = self.get("messages/").json()
        self.assertEqual(set(data), {"count", "page", "pages", "page_size", "results", "filters"})
        newest, oldest = data["results"]
        self.assertEqual(set(newest), MESSAGE_KEYS)
        self.assertEqual((newest["id"], newest["user"], newest["created_by_name"], newest["parts"]), (self.test_sms.pk, None, "Bo Ss", 1))
        self.assertRegex(newest["created_at"], _OFFSET)
        self.assertEqual(oldest["user"], {"id": self.malika.pk, "name": "Malika Karimova"})

    def test_newest_first_by_when_it_was_written_not_by_id(self):
        backdated = SmsMessage.objects.create(
            kind="test", run_on=date(2026, 9, 2), dedupe_key="test:late", phone="998901234567", text="x",
        )
        SmsMessage.objects.filter(pk=backdated.pk).update(created_at=timezone.now() - timedelta(days=20))
        ids = [r["id"] for r in self.get("messages/").json()["results"]]
        self.assertEqual(ids, [self.test_sms.pk, backdated.pk, self.old.pk])

    def test_filters_and_their_counts(self):
        data = self.get("messages/", kind="test").json()
        self.assertEqual([r["id"] for r in data["results"]], [self.test_sms.pk])
        kind = next(f for f in data["filters"] if f["key"] == "kind")
        self.assertEqual(kind["selected"], "test")
        self.assertEqual({o["value"]: o["count"] for o in kind["options"]}, {"debt_warning": 1, "campaign": 0, "test": 1})
        self.assertEqual([f["key"] for f in data["filters"]], ["kind", "status", "when"])
        self.assertEqual(self.get("messages/", when="30d").json()["count"], 1)
        self.assertEqual(self.get("messages/", status="DELIVERED").json()["count"], 1)

    def test_search_by_phone_and_lcup_name(self):
        self.assertEqual(self.get("messages/", q="998880032508").json()["count"], 1)
        self.assertEqual(self.get("messages/", q="Karimova Malika").json()["count"], 1)

    def test_pages(self):
        for i in range(30):
            SmsMessage.objects.create(kind="test", run_on=timezone.localdate(), dedupe_key=f"test:p{i}", phone="998901234567", text="x")
        data = self.get("messages/", page_size=25, page=2).json()
        self.assertEqual((data["count"], data["page"], data["pages"], data["page_size"], len(data["results"])), (32, 2, 2, 25, 7))


class CampaignApiTests(ApiFixture):
    def test_preview(self):
        data = self.post("campaigns/preview/", self.draft()).json()
        self.assertEqual(set(data), {"count", "over_limit", "limit", "samples", "parts_total", "cost", "skipped"})
        self.assertEqual((data["count"], data["over_limit"], data["limit"], data["parts_total"], data["cost"]), (1, False, 300, 1, 170))
        self.assertEqual(data["samples"][0]["text"][:40], "MASTER SAT'dan yozyabmiz. Karimova Malik")
        self.assertEqual(set(data["samples"][0]), {"name", "phone", "text", "parts"})
        self.assertEqual(set(data["skipped"]), {"no_link", "no_phone", "not_debtor", "bad_text"})

    def test_create_queues_a_now_campaign(self):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post("campaigns/", self.draft())
        self.assertEqual(response.status_code, 201, response.content)
        campaign = response.json()["campaign"]
        self.assertEqual(set(campaign), CAMPAIGN_KEYS)
        self.assertEqual(set(campaign["result"]), RESULT_KEYS)
        self.assertEqual((campaign["status"], campaign["audience_label"], campaign["created_by_name"]), (
            "SCHEDULED", "Student: Malika Karimova", "Bo Ss",
        ))
        self.queued["send_due_campaigns"].assert_called_once_with()

    def test_create_refusals_carry_a_code(self):
        cases = [
            ({"template_id": 80000}, "template"),
            ({"slot_roles": []}, "slots"),
            ({"audience": "group", "audience_ids": [999]}, "audience"),
            ({"scheduled_at": (timezone.now() - timedelta(hours=1)).isoformat()}, "past"),
            ({"audience": "student", "audience_ids": [self.student.pk]}, "empty"),  # no lc-up link
        ]
        for extra, code in cases:
            with self.subTest(code=code):
                response = self.post("campaigns/", self.draft(**extra))
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], code)
                self.assertTrue(response.json()["detail"])
        self.assertEqual(SmsCampaign.objects.count(), 0)

    def test_list_detail_cancel(self):
        later = (timezone.now() + timedelta(hours=2)).isoformat()
        first = self.post("campaigns/", self.draft(scheduled_at=later)).json()["campaign"]
        second = self.post("campaigns/", self.draft(audience="group", audience_ids=[self.room.pk], scheduled_at=later)).json()["campaign"]
        self.assertEqual([c["id"] for c in self.get("campaigns/").json()["campaigns"]], [second["id"], first["id"]])
        self.assertEqual(second["audience_label"], "Group: Junior G21 | Math")
        detail = self.get(f"campaigns/{first['id']}/").json()
        self.assertEqual((set(detail), detail["messages"]), ({"campaign", "messages"}, []))
        cancelled = self.post(f"campaigns/{first['id']}/cancel/").json()["campaign"]
        self.assertEqual(cancelled["status"], "CANCELLED")
        again = self.post(f"campaigns/{first['id']}/cancel/")
        self.assertEqual((again.status_code, again.json()["code"]), (400, "not_scheduled"))
        self.assertEqual(self.get("campaigns/999/").status_code, 404)

    def test_retry(self):
        with self.captureOnCommitCallbacks(execute=True):
            campaign = self.post("campaigns/", self.draft()).json()["campaign"]
        refused = self.post(f"campaigns/{campaign['id']}/retry/")
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "not_done"))
        from sms import campaigns

        campaigns.dispatch_due(FakeEskiz(FAILED), timezone.now())
        detail = self.get(f"campaigns/{campaign['id']}/").json()
        self.assertEqual((detail["campaign"]["status"], detail["campaign"]["result"]["failed"]), ("DONE", 1))
        self.assertEqual(set(detail["messages"][0]), MESSAGE_KEYS)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.post(f"campaigns/{campaign['id']}/retry/")
        self.assertEqual(response.json(), {"queued": 1})
        self.queued["retry_campaign"].assert_called_once_with(campaign["id"])

    def test_live_delivered_counts(self):
        with self.captureOnCommitCallbacks(execute=True):
            campaign = self.post("campaigns/", self.draft()).json()["campaign"]
        from sms import campaigns

        campaigns.dispatch_due(FakeEskiz(), timezone.now())
        SmsMessage.objects.update(status=SmsMessage.STATUS_DELIVERED)
        result = self.get(f"campaigns/{campaign['id']}/").json()["campaign"]["result"]
        self.assertEqual((result["sent"], result["delivered"], result["undelivered"]), (1, 1, 0))


class SettingsApiTests(ApiFixture):
    def test_get_is_the_live_defaults(self):
        data = self.get("settings/").json()
        self.assertEqual(set(data), SETTINGS_KEYS)
        self.assertEqual(
            (data["debt_enabled"], data["debt_hour"], data["warning_template_id"], data["last_day_template_id"]),
            (True, 10, 64942, 52393),
        )
        self.assertEqual((data["warning_pattern"], data["warning_slots"]), (T.DEBT_WARNING.text, ["student"]))
        self.assertEqual((data["updated_at"], data["updated_by_name"]), (None, ""))
        self.assertEqual((data["env_enabled"], data["freeze_enabled"], data["freeze_day"]), (True, True, 6))

    def test_the_hour_range(self):
        for hour in (7, 21, "10", True):
            with self.subTest(hour=hour):
                response = self.patch("settings/", {"debt_hour": hour})
                self.assertEqual((response.status_code, response.json()["code"]), (400, "hour"))
        data = self.patch("settings/", {"debt_hour": 9, "debt_enabled": False}).json()
        self.assertEqual((data["debt_hour"], data["debt_enabled"], data["updated_by_name"]), (9, False, "Bo Ss"))
        self.assertRegex(data["updated_at"], _OFFSET)

    def test_only_the_hour_or_the_switch_with_no_templates_cached(self):
        EskizTemplate.objects.all().delete()
        self.assertEqual(self.patch("settings/", {"debt_hour": 11}).status_code, 200)
        data = self.patch("settings/", {"debt_enabled": False}).json()
        self.assertEqual((data["debt_hour"], data["debt_enabled"], data["warning_template_id"]), (11, False, 64942))
        self.assertEqual(data["warning_pattern"], T.DEBT_WARNING.text)

    def test_a_word_slot_may_hold_the_debt_and_a_number_slot_only_the_debt(self):
        data = self.patch("settings/", {"warning_template_id": 64950, "warning_slots": ["debt", "debt"]}).json()
        self.assertEqual(data["warning_slots"], ["debt", "debt"])
        refused = self.patch("settings/", {"warning_template_id": 64950, "warning_slots": ["student", "student"]})
        self.assertEqual((refused.status_code, refused.json()["code"]), (400, "slots"))

    def test_a_template_is_copied_in_with_its_slots(self):
        data = self.patch("settings/", {"warning_template_id": 64950, "warning_slots": ["student", "debt"]}).json()
        self.assertEqual(
            (data["warning_template_id"], data["warning_pattern"], data["warning_slots"]),
            (64950, "Hurmatli %w{1,4} %d so'm qarzingiz bor.", ["student", "debt"]),
        )
        self.assertEqual(SmsSettings.get().warning_pattern, "Hurmatli %w{1,4} %d so'm qarzingiz bor.")

    def test_template_and_slot_refusals(self):
        cases = [
            ({"warning_template_id": 80000, "warning_slots": ["student"]}, "template"),  # still in moderation
            ({"warning_template_id": 1, "warning_slots": []}, "template"),
            ({"warning_template_id": 70000, "warning_slots": ["text", "debt"]}, "slots"),  # nothing is typed in
            ({"warning_template_id": 64950, "warning_slots": ["student"]}, "slots"),  # 2 slots
            ({"warning_template_id": 64950, "warning_slots": ["debt", "student"]}, "slots"),  # a name in a %d
            ({"last_day_slots": ["debt", "debt"]}, "slots"),
        ]
        for body, code in cases:
            with self.subTest(body=body):
                response = self.patch("settings/", body)
                self.assertEqual((response.status_code, response.json()["code"]), (400, code))
        self.assertEqual(SmsSettings.get().warning_template_id, 64942)


class DebtApiTests(ApiFixture):
    def test_preview_of_the_next_warning_day(self):
        with mock.patch("sms.views._today", return_value=date(2026, 10, 18)):
            data = self.get("debt/preview/").json()
        self.assertEqual(set(data), {"day", "is_last_day", "blocked", "skipped", "count", "cost", "warnings"})
        self.assertEqual((data["day"], data["is_last_day"], data["blocked"], data["count"], data["cost"]), ("2026-11-01", False, "", 1, 170))
        self.assertEqual(data["warnings"][0], {
            "lcup_student_id": 101, "name": "Karimova Malika", "phone": "998901234567", "debt": 150000,
            "text": "MASTER SAT'dan yozyabmiz. Karimova Malika, sizda qarzdorlik mavjud. To'lovni amalga oshirish uchun "
                    "zudlik bilan administratsiyaga uchrang!",
            "parts": 1,
        })

    def test_preview_defaults_to_today_on_a_warning_day(self):
        """The panel shows "Send now" only when the day returned is today."""
        with mock.patch("sms.views._today", return_value=date(2026, 11, 3)):
            data = self.get("debt/preview/").json()
        self.assertEqual((data["day"], data["is_last_day"], data["count"]), ("2026-11-03", False, 1))
        with mock.patch("sms.views._today", return_value=date(2026, 11, 6)):
            self.assertEqual(self.get("debt/preview/").json()["day"], "2026-12-01")
        with mock.patch("sms.views._today", return_value=date(2026, 12, 20)):
            self.assertEqual(self.get("debt/preview/").json()["day"], "2027-01-01")

    def test_preview_of_a_given_day(self):
        data = self.get("debt/preview/", day="2026-11-05").json()
        self.assertTrue(data["is_last_day"])
        self.assertTrue(data["warnings"][0]["text"].startswith("Bugun oxirgi kun!"))
        self.assertEqual(self.get("debt/preview/", day="tomorrow").json()["code"], "day")

    def test_send_now_on_a_warning_day(self):
        with mock.patch("sms.views._today", return_value=date(2026, 11, 3)), self.captureOnCommitCallbacks(execute=True):
            response = self.post("debt/send-now/")
        self.assertEqual((response.status_code, response.json()), (202, {"queued": True}))
        self.queued["debt_warnings_now"].assert_called_once_with()

    def test_send_now_refused_off_a_warning_day(self):
        with mock.patch("sms.views._today", return_value=date(2026, 11, 6)):
            response = self.post("debt/send-now/")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_a_warning_day"))
        self.queued["debt_warnings_now"].assert_not_called()

    def test_send_now_refused_while_switched_off(self):
        self.patch("settings/", {"debt_enabled": False})
        with mock.patch("sms.views._today", return_value=date(2026, 11, 3)):
            response = self.post("debt/send-now/")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "disabled"))

    def test_runs(self):
        SmsMessage.objects.create(
            kind="debt_warning", run_on=timezone.localdate(), dedupe_key="student:101", phone="998901234567",
            text="x", status=SmsMessage.STATUS_DELIVERED,
        )
        runs = self.get("debt/runs/").json()["runs"]
        self.assertEqual(runs, [{"run_on": timezone.localdate().isoformat(), "total": 1, "by_status": {"DELIVERED": 1}, "parts": 1, "cost": 170}])


class TemplatesApiTests(ApiFixture):
    def test_usable_first_then_newest(self):
        data = self.get("templates/").json()
        self.assertEqual(set(data), {"templates", "synced_at"})
        self.assertEqual([t["eskiz_id"] for t in data["templates"]], [70000, 64950, 64942, 52393, 80000])
        row = next(t for t in data["templates"] if t["eskiz_id"] == 64942)
        self.assertEqual(set(row), TEMPLATE_KEYS)
        self.assertEqual(
            (row["slots"], row["guessed_roles"], row["parts"], row["ascii"], row["usable"]),
            ([{"kind": "w", "min": 1, "max": 4}], ["student"], 1, True, True),
        )

    def test_sync(self):
        EskizTemplate.objects.filter(eskiz_id=52393).delete()
        self.assertEqual(self.post("templates/sync/").json(), {"added": 1, "updated": 4, "gone": 0, "total": 5})

    def test_sync_when_eskiz_cannot_be_read(self):
        self.fake.account_error = "HTTP 500 on /user/templates"
        response = self.post("templates/sync/")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "eskiz"))

    def test_submit(self):
        response = self.post("templates/", {"text": "Salom (STUDENT)! Ertaga dars bor."})
        self.assertEqual(response.status_code, 201, response.content)
        data = response.json()
        self.assertEqual(set(data), {"template", "sync"})
        self.assertEqual((data["template"]["status"], data["template"]["submitted_by_name"]), ("moderation", "Bo Ss"))
        self.assertEqual(self.fake.submitted, ["Salom (STUDENT)! Ertaga dars bor."])

    def test_submit_refusals(self):
        self.assertEqual(self.post("templates/", {"text": " "}).json()["code"], "text")
        self.assertEqual(self.post("templates/", {"text": "x" * 1001}).json()["code"], "text")
        self.fake.account_error = "HTTP 422: template: taken"
        response = self.post("templates/", {"text": "Salom"})
        self.assertEqual((response.status_code, response.json()["code"], response.json()["detail"]), (400, "eskiz", "HTTP 422: template: taken"))


class TestSmsApiTests(ApiFixture):
    def test_a_test_sms_is_delivered_and_signed(self):
        response = self.post("test/", {"phone": "+998 88 003 25 08", "template_id": 64942, "slot_texts": [""]})
        self.assertEqual(response.status_code, 200, response.content)
        message = response.json()["message"]
        self.assertEqual(set(message), MESSAGE_KEYS)
        self.assertEqual((message["kind"], message["status"], message["phone"], message["created_by_name"]), (
            "test", "SENT", "998880032508", "Bo Ss",
        ))
        self.assertEqual(message["text"], T.render(T.DEBT_WARNING, T.SAMPLE_VALUES))
        self.assertEqual(SmsMessage.objects.get().created_by, self.admin)
        self.assertEqual(len(self.fake.sent), 1)

    def test_non_text_slots_come_from_the_sample_and_ignore_what_was_sent(self):
        # #64950: "(STUDENT) (SUM)" — guessed student and text; the client sends "" for the student slot.
        message = self.post("test/", {"phone": "998880032508", "template_id": 64950, "slot_texts": ["", "5000"]}).json()["message"]
        self.assertEqual(message["text"], "Hurmatli Test Testov, 5000 so'm qarzingiz bor.")
        message = self.post("test/", {"phone": "998880032508", "template_id": 64950, "slot_texts": ["Hacker Name", "7"]}).json()["message"]
        self.assertEqual(message["text"], "Hurmatli Test Testov, 7 so'm qarzingiz bor.")

    def test_the_student_is_the_sample_whatever_follows_the_placeholder(self):
        EskizTemplate.objects.create(
            eskiz_id=94973, pattern="Tabriklaymiz, %w{1,4} Siz o'tdingiz.", original="Tabriklaymiz, (STUDENT)! Siz o'tdingiz.",
            status="service", synced_at=timezone.now(),
        )
        message = self.post("test/", {"phone": "998880032508", "template_id": 94973, "slot_texts": [""]}).json()["message"]
        self.assertEqual(message["text"], "Tabriklaymiz, Test Testov, Siz o'tdingiz.")

    def test_a_text_slot(self):
        message = self.post("test/", {"phone": "998880032508", "template_id": 70000, "slot_texts": ["Junior G21", "15"]}).json()["message"]
        self.assertEqual(message["text"], "Ertaga Junior G21 soat 15 da dars.")

    def test_refusals(self):
        cases = [
            ({"phone": "12345", "template_id": 64942}, "phone"),
            ({"phone": "998880032508", "template_id": 80000}, "template"),
            ({"phone": "998880032508", "template_id": 70000, "slot_texts": ["Junior", ""]}, "slots"),
            ({"phone": "998880032508", "template_id": 70000, "slot_texts": ["Junior", "soon"]}, "slots"),
        ]
        for body, code in cases:
            with self.subTest(code=code):
                response = self.post("test/", body)
                self.assertEqual((response.status_code, response.json()["code"]), (400, code))
        self.assertEqual(self.fake.sent, [])

    @override_settings(ESKIZ_EMAIL="")
    def test_not_configured(self):
        response = self.post("test/", {"phone": "998880032508", "template_id": 64942})
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_configured"))


class AudienceTests(ApiFixture):
    def test_classrooms_with_student_and_phone_counts(self):
        nophone = self.learner(102, "nophone", balance=0, phone="", room=self.room)
        teacher_seat = ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        Classroom.objects.create(
            name="Archived", subject=Classroom.SUBJECT_MATH, level="junior", lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin, is_active=False,
        )
        data = self.get("audience/classrooms/").json()
        self.assertEqual(data, {"classrooms": [{"id": self.room.pk, "name": "Junior G21 | Math", "students": 2, "with_phone": 1}]})
        self.assertTrue(nophone and teacher_seat)

    def test_students_search(self):
        self.learner(102, "aziza", balance=0, phone="998902222222", name="Toshmatova Aziza")
        User.objects.create_user(None, password=None, username="unlinked", role=C.ROLE_STUDENT, first_name="Aziza")
        data = self.get("audience/students/", q="toshmatova").json()
        self.assertEqual(data["students"], [{
            "id": User.objects.get(username="aziza").pk, "name": "Aziza Karimova", "lcup_name": "Toshmatova Aziza",
            "phone": "998902222222", "balance": 0,
        }])
        self.assertEqual(len(self.get("audience/students/").json()["students"]), 2)
