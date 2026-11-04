import io
import json
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from billing import ledger, shadow, tasks
from billing.models import Account, BillingRun, BillingState, EntryKind
from billing.tests_shadow import NOW, Fixture, Opened, at
from lcup.models import LcupMembership, LcupStudentLink

User = get_user_model()
ADMIN_HOST = "admin.mastersat.uz"


class ApiCase(Opened):
    def setUp(self):
        super().setUp()
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")

    def get(self, path, *, user=None, host=ADMIN_HOST, authenticate=True):
        api = APIClient()
        if authenticate:
            api.force_authenticate(user or self.admin)
        with override_settings(ALLOWED_HOSTS=[host]):
            return api.get(path, HTTP_HOST=host)


class AccessTests(ApiCase, TestCase):
    PATHS = ("/api/billing/summary/", "/api/billing/accounts/")

    def test_an_admin_gets_in(self):
        for path in self.PATHS:
            self.assertEqual(self.get(path).status_code, 200, path)

    def test_a_super_admin_gets_in(self):
        boss = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        self.assertEqual(self.get("/api/billing/summary/", user=boss).status_code, 200)

    def test_a_teacher_is_refused(self):
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        for path in self.PATHS:
            self.assertEqual(self.get(path, user=teacher, host="mastersat.uz").status_code, 403, path)

    def test_a_student_is_refused(self):
        student = User.objects.create_user(None, password=None, username="s", role="student")
        for path in self.PATHS:
            self.assertEqual(self.get(path, user=student, host="mastersat.uz").status_code, 403, path)

    def test_nobody_signed_in_is_refused(self):
        self.assertEqual(self.get("/api/billing/summary/", authenticate=False, host="mastersat.uz").status_code, 401)

    def test_the_teacher_portal_does_not_serve_it(self):
        boss = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        self.assertEqual(self.get("/api/billing/summary/", user=boss, host="teacher.mastersat.uz").status_code, 403)


class SummaryTests(ApiCase, TestCase):
    def test_it_says_whether_the_ledger_is_open_and_how_many_accounts(self):
        self.student(lcup_id=2, balance=-120_000)
        Account.objects.create(name="Former", lcup_student_id=2)
        body = self.get("/api/billing/summary/").json()
        self.assertFalse(body["enabled"])
        self.assertIsNotNone(body["opened_at"])
        self.assertEqual((body["accounts"], body["former"]), (2, 1))

    def test_before_the_opening_it_says_so(self):
        BillingState.objects.update(opened_at=None)
        self.assertIsNone(self.get("/api/billing/summary/").json()["opened_at"])

    def test_no_comparison_yet_is_null(self):
        self.assertIsNone(self.get("/api/billing/summary/").json()["comparison"])

    def test_the_latest_comparison_and_its_differences(self):
        LcupStudentLink.objects.filter(pk=self.link.pk).update(balance=-400_000)
        shadow.compare(NOW)
        comparison = self.get("/api/billing/summary/").json()["comparison"]
        self.assertEqual(comparison["day"], "2026-11-04")
        self.assertEqual(comparison["counts"]["big"], 1)
        self.assertEqual(comparison["rows"][0]["diff"], -100_000)

    def test_recent_problems_are_listed(self):
        BillingRun.objects.create(kind=BillingRun.Kind.TICK, ok=False, errors=["membership 1: boom"], alerts=["many ended"])
        problems = self.get("/api/billing/summary/").json()["problems"]
        self.assertEqual(problems[0]["errors"], ["membership 1: boom"])
        self.assertEqual(problems[0]["alerts"], ["many ended"])

    def test_a_clean_run_is_not_a_problem(self):
        BillingRun.objects.create(kind=BillingRun.Kind.TICK, counts={"rows": 1})
        self.assertEqual(self.get("/api/billing/summary/").json()["problems"], [])


class AccountListTests(ApiCase, TestCase):
    def setUp(self):
        super().setUp()
        self.former = Account.objects.create(name="Former", lcup_student_id=2)
        ledger.post(self.former, EntryKind.OPENING, -900_000, date(2026, 11, 4), "opening:2")

    def test_everyone_with_their_balance_most_owed_first(self):
        rows = self.get("/api/billing/accounts/").json()["accounts"]
        self.assertEqual([(r["name"], r["balance"]) for r in rows], [("Former", -900_000), ("A Student", -500_000)])

    def test_the_former_students_alone(self):
        rows = self.get("/api/billing/accounts/?scope=former").json()["accounts"]
        self.assertEqual([r["name"] for r in rows], ["Former"])
        self.assertTrue(rows[0]["former"])

    def test_the_current_students_alone(self):
        rows = self.get("/api/billing/accounts/?scope=current").json()["accounts"]
        self.assertEqual([r["name"] for r in rows], ["A Student"])
        self.assertFalse(rows[0]["former"])


class AccountDetailTests(ApiCase, TestCase):
    def detail(self):
        return self.get(f"/api/billing/accounts/{self.account().pk}/").json()

    def test_each_row_carries_the_balance_after_it(self):
        self.payment(5, 1, 200_000)
        shadow.mirror_payments(shadow.Result())
        rows = self.detail()["rows"]
        self.assertEqual([(r["kind"], r["amount"], r["running"]) for r in rows], [
            ("opening", -500_000, -500_000), ("payment", 200_000, -300_000),
        ])

    def test_a_voided_row_is_shown_and_does_not_count(self):
        self.payment(5, 1, 200_000)
        shadow.mirror_payments(shadow.Result())
        ledger.void(self.account().entries.get(kind=EntryKind.PAYMENT), "typed wrong")
        body = self.detail()
        self.assertEqual(body["balance"], -500_000)
        row = body["rows"][1]
        self.assertEqual((row["void_reason"], row["running"]), ("typed wrong", -500_000))
        self.assertIsNotNone(row["voided_at"])

    def test_it_lists_the_seats(self):
        seat = self.detail()["seats"][0]
        self.assertEqual((seat["group_name"], seat["state"], seat["price"]), ("Junior G1", "active", 500_000))

    def test_an_unknown_account_is_not_found(self):
        self.assertEqual(self.get("/api/billing/accounts/999999/").status_code, 404)


class TaskTests(Opened, TestCase):
    def tearDown(self):
        cache.delete(tasks.RUNNING_KEY)

    def test_the_tick_is_off_by_default(self):
        self.assertEqual(tasks.shadow_tick(), {"skipped": "disabled"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_a_tick_still_going_is_not_doubled(self):
        cache.add(tasks.RUNNING_KEY, "1")
        self.assertEqual(tasks.shadow_tick(), {"skipped": "already running"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_a_tick_lets_go_of_its_lock(self):
        with mock.patch("billing.shadow.tick", return_value={"rows": 1}):
            self.assertEqual(tasks.shadow_tick(), {"rows": 1})
        self.assertTrue(cache.add(tasks.RUNNING_KEY, "1"))

    def test_the_comparison_is_off_by_default(self):
        self.assertEqual(tasks.compare(), {"skipped": "disabled"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_the_comparison_waits_for_the_opening(self):
        BillingState.objects.update(opened_at=None)
        self.assertEqual(tasks.compare(), {"skipped": "not opened"})

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_the_comparison_keeps_a_run(self):
        real = shadow.compare
        with mock.patch("billing.shadow.compare", side_effect=lambda: real(NOW)):
            result = tasks.compare()
        self.assertTrue(result["ok"])
        self.assertEqual(BillingRun.objects.filter(kind="compare").count(), 1)


class OpenCommandTests(Fixture, TestCase):
    def setUp(self):
        self.member(self.group(), self.student(balance=-500_000))

    def run_command(self, *args):
        out = io.StringIO()
        with mock.patch("django.utils.timezone.now", return_value=NOW):
            call_command("billing_open", *args, stdout=out)
        return json.loads(out.getvalue())

    def test_by_default_it_only_reports(self):
        self.healthy_sync()
        report = self.run_command()
        self.assertEqual(report["accounts"], 1)
        self.assertFalse(report["applied"])
        self.assertFalse(Account.objects.exists())

    def test_apply_opens(self):
        self.healthy_sync()
        report = self.run_command("--apply")
        self.assertTrue(report["applied"])
        self.assertIsNotNone(BillingState.get().opened_at)
        self.assertEqual(Account.objects.count(), 1)

    def test_not_ready_says_why(self):
        with self.assertRaisesMessage(CommandError, "sync"):
            self.run_command()


class TickCommandTests(Opened, TestCase):
    @mock.patch("billing.shadow.MAX_ENDS_PER_TICK", 0)
    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_allow_mass_lets_a_held_tick_through(self):
        LcupMembership.objects.filter(pk=self.seat_row.pk).update(left_at=at(2026, 11, 9))
        self.healthy_sync(at(2026, 11, 10))
        out = io.StringIO()
        with mock.patch("django.utils.timezone.now", return_value=at(2026, 11, 10)):
            call_command("billing_tick", "--allow-mass", stdout=out)
        self.assertEqual(json.loads(out.getvalue())["ended"], 1)
