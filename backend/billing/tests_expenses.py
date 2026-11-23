"""The centre's expenses on /ops/finance (leaving lc-up, owner 2026-11-22: "No, move them too"; design "Yes, approved")."""

import uuid
from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access.models import Permission, UserPermission
from billing.models import Expense, ExpenseCategory

User = get_user_model()
HOST = "admin.mastersat.uz"
TODAY = date(2026, 12, 10)
OURS = override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False, ALLOWED_HOSTS=[HOST, "testserver"])


@OURS
class Fixture(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(None, password=None, username="owner", role="super_admin", first_name="Owner")
        self.accountant = User.objects.create_user(None, password=None, username="acc", role="accountant", first_name="Dilnoza")
        self.desk = User.objects.create_user(None, password=None, username="desk", role="admin", first_name="Desk")
        self.student = User.objects.create_user(None, password=None, username="s", role="student")
        self.rent = ExpenseCategory.objects.create(name="Rent")
        self.salary = ExpenseCategory.objects.create(name="Salary")
        patcher = mock.patch("billing.views_expenses.timezone.localdate", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)

    def api(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def add(self, user=None, **fields):
        body = {
            "day": "2026-12-05", "amount": 4_000_000, "category": self.rent.pk, "method": "Bank hisobi",
            "spent_by": self.accountant.pk, "reason": "December rent", "request_id": str(uuid.uuid4()), **fields,
        }
        return self.api(user or self.accountant).post("/api/billing/expenses/", body, format="json", HTTP_HOST=HOST)

    def listing(self, user=None, **params):
        return self.api(user or self.accountant).get("/api/billing/expenses/", params, HTTP_HOST=HOST)


class EnterTests(Fixture):
    def test_the_accountant_enters_one_and_it_is_listed_with_the_total(self):
        response = self.add()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(
            (response.json()["category"]["name"], response.json()["spent_by"]["name"], response.json()["created_by"]),
            ("Rent", "Dilnoza", "Dilnoza"),
        )
        self.add(amount=1_500_000, category=self.salary.pk, reason="Cleaner, December")
        body = self.listing().json()
        self.assertEqual((body["from"], body["to"], body["count"], body["total"]), ("2026-12-01", "2026-12-31", 2, 5_500_000))
        self.assertEqual([(c["name"], c["total"]) for c in body["by_category"]], [("Rent", 4_000_000), ("Salary", 1_500_000)])

    def test_the_same_form_twice_is_one_row(self):
        request_id = str(uuid.uuid4())
        self.assertEqual(self.add(request_id=request_id).status_code, 201)
        self.assertEqual(self.add(request_id=request_id).status_code, 200)
        self.assertEqual(Expense.objects.count(), 1)

    def test_what_is_refused_in_words(self):
        self.salary.retired_at = self.salary.created_at
        self.salary.save()
        cases = [
            ({"day": "2026-12-11"}, "future"),
            ({"amount": 0}, "above zero"),
            ({"amount": "1000"}, "above zero"),
            ({"category": None}, "Choose a category"),
            ({"category": self.salary.pk}, "no longer used"),
            ({"method": "cash"}, "how it was paid"),
            ({"spent_by": self.student.pk}, "who spent it"),
            ({"reason": "  "}, "what it was for"),
            ({"request_id": "x"}, "out of date"),
        ]
        for fields, words in cases:
            response = self.add(**fields)
            self.assertEqual(response.status_code, 400, fields)
            self.assertIn(words, response.json()["detail"], fields)
        self.assertFalse(Expense.objects.exists())

    def test_the_filters(self):
        self.add(day="2026-11-28")
        self.add(category=self.salary.pk, spent_by=self.owner.pk, reason="Bonus")
        self.assertEqual(self.listing(**{"from": "2026-11-01", "to": "2026-12-31"}).json()["count"], 2)
        self.assertEqual(self.listing().json()["count"], 1)  # this month by default
        self.assertEqual(self.listing(category=self.rent.pk, **{"from": "2026-11-01"}).json()["count"], 1)
        self.assertEqual(self.listing(spent_by=self.owner.pk).json()["rows"][0]["reason"], "Bonus")
        self.assertEqual(self.listing(**{"from": "2026-12-10", "to": "2026-12-01"}).status_code, 400)


class VoidTests(Fixture):
    def test_a_voided_expense_leaves_the_total_and_waits_in_the_archive(self):
        expense_id = self.add().json()["id"]

        def void(reason):
            return self.api(self.accountant).post(
                f"/api/billing/expenses/{expense_id}/void/", {"reason": reason}, format="json", HTTP_HOST=HOST
            )

        self.assertEqual(void(" ").status_code, 400)
        self.assertEqual(void("Typed twice").status_code, 200)
        self.assertEqual(self.listing().json()["total"], 0)
        archive = self.listing(archived=1).json()
        self.assertEqual((archive["count"], archive["rows"][0]["void_reason"], archive["rows"][0]["voided_by"]), (1, "Typed twice", "Dilnoza"))
        self.assertIn("already", void("Again").json()["detail"])
        self.assertTrue(Expense.objects.filter(pk=expense_id).exists())  # never deleted


class WhoMayTests(Fixture):
    def test_the_desk_reads_but_does_not_enter(self):
        self.add()
        self.assertEqual(self.listing(self.desk).status_code, 200)
        self.assertEqual(self.add(self.desk).status_code, 403)
        meta = self.api(self.desk).get("/api/billing/expenses/meta/", HTTP_HOST=HOST).json()
        self.assertFalse(meta["can_manage"])

    def test_the_owner_ticks_it_on_for_one_admin(self):
        permission = Permission.objects.create(codename="manage_expenses", name="Manage expenses")
        UserPermission.objects.create(user=self.desk, permission=permission, granted=True)
        self.assertEqual(self.add(self.desk).status_code, 201)

    def test_the_owner_enters_too(self):
        self.assertEqual(self.add(self.owner).status_code, 201)

    def test_a_teacher_or_a_student_sees_nothing(self):
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        for user in (teacher, self.student):
            self.assertEqual(self.listing(user).status_code, 403)

    @override_settings(BILLING_PAYMENTS_OPEN=False)
    def test_nothing_is_entered_before_the_cutover(self):
        response = self.add()
        self.assertEqual(response.status_code, 403)
        self.assertIn("lc-up", response.json()["detail"])


class CategoryTests(Fixture):
    def post(self, user, name):
        return self.api(user).post("/api/billing/expense-categories/", {"name": name}, format="json", HTTP_HOST=HOST)

    def patch(self, category, **body):
        return self.api(self.accountant).patch(f"/api/billing/expense-categories/{category.pk}/", body, format="json", HTTP_HOST=HOST)

    def test_added_renamed_retired_and_back(self):
        self.assertEqual(self.post(self.accountant, "  Internet ").json()["name"], "Internet")
        self.assertEqual(self.post(self.accountant, "rent").status_code, 400)  # taken, whatever the case
        self.add()
        self.assertEqual(self.patch(self.rent, name="Rent and service").json()["used"], 1)
        self.assertEqual(self.listing().json()["rows"][0]["category"]["name"], "Rent and service")
        self.assertTrue(self.patch(self.rent, retired=True).json()["retired"])
        self.assertEqual(self.add().status_code, 400)
        self.assertFalse(self.patch(self.rent, retired=False).json()["retired"])
        self.assertEqual(self.patch(self.rent, retired="yes").status_code, 400)

    def test_the_meta_lists_them_in_use_first(self):
        self.patch(self.rent, retired=True)
        meta = self.api(self.accountant).get("/api/billing/expenses/meta/", HTTP_HOST=HOST).json()
        self.assertEqual([(c["name"], c["retired"]) for c in meta["categories"]], [("Salary", False), ("Rent", True)])
        self.assertIn({"id": self.accountant.pk, "name": "Dilnoza"}, meta["staff"])
        self.assertNotIn(self.student.pk, [s["id"] for s in meta["staff"]])
        self.assertTrue(meta["can_manage"] and meta["open"])

    def test_the_desk_cannot_change_the_list(self):
        self.assertEqual(self.post(self.desk, "Internet").status_code, 403)
