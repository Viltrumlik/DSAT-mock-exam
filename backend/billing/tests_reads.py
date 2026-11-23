"""Leaving lc-up (owner, 2026-11-22): once the ledger is the master, every money read comes from it, in lc-up's shapes."""

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from billing import ledger, reads
from billing.models import Account, Entry, EntryKind, Seat, SeatState
from lcup import finance
from users.people_parts import history_part
from users.views_people import _owes_q

User = get_user_model()
OURS = override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False, BILLING_MODE="lesson")


def student(username="ali"):
    user = User.objects.create_user(None, password=None, username=username, role="student", first_name="Ali")
    account = Account.objects.create(name="Ali Valiyev", user=user, phone="998901112233")
    Seat.objects.create(account=account, group_name="Junior G1", price=500_000, days=[1, 3, 5], state=SeatState.ACTIVE)
    return user, account


class LcupStaysTheMasterTests(TestCase):
    def test_until_the_cutover_the_student_page_reads_lc_up(self):
        user, account = student()
        ledger.post(account, EntryKind.CHARGE, -38_500, date(2026, 12, 2), "c1")
        self.assertEqual(finance.student_finance(user), {"linked": False})  # no lc-up link: as before


@OURS
class LedgerIsTheMasterTests(TestCase):
    def setUp(self):
        self.user, self.account = student()
        ledger.post(self.account, EntryKind.CHARGE, -500_000, date(2026, 12, 1), "first")
        ledger.post(
            self.account, EntryKind.PAYMENT, 300_000, date(2026, 12, 2), "p1", method="Naqd pul",
            seat=self.account.seats.get(),
        )

    def test_the_students_own_page_reads_the_ledger(self):
        data = finance.student_finance(self.user)
        self.assertEqual((data["balance"], data["debt"], data["rule"], data["lesson_price"]), (-200_000, 200_000, "lesson", 38_500))
        self.assertTrue(data["debt_notice"])
        self.assertEqual(data["payments"][0]["amount"], 300_000)
        self.assertEqual(data["payments"][0]["group"], "Junior G1")
        self.assertEqual(data["groups"], [{"name": "Junior G1", "monthly_cost": 500_000, "lesson_price": 38_500}])

    def test_a_frozen_student_gets_no_ticker(self):
        self.user.is_frozen = True
        self.user.save()
        self.assertFalse(finance.student_finance(self.user)["debt_notice"])

    def test_debtors_come_from_the_ledger_and_lc_up_unknowns_have_no_link(self):
        rows = finance.debtors()
        self.assertEqual([(r["name"], r["debt"], r["link_id"], r["last_payment_on"]) for r in rows], [("Ali Valiyev", 200_000, None, "2026-12-02")])

    def test_the_months_payments_and_summary(self):
        self.assertEqual([r["amount"] for r in finance.payments_in("2026-12")], [300_000])
        s = finance.summary("2026-12")
        self.assertEqual((s["paid"], s["total_debt"], s["debtors"], s["by_method"]), (300_000, 200_000, 1, {"Naqd pul": 300_000}))
        self.assertEqual(s["freeze"]["rule"], "lesson")

    def test_the_students_list_owes_filter_reads_the_ledger(self):
        other = User.objects.create_user(None, password=None, username="paid", role="student")
        Account.objects.create(name="Paid", user=other)
        self.assertEqual(list(User.objects.filter(_owes_q()).values_list("username", flat=True)), ["ali"])

    def test_the_history_lists_ledger_payments(self):
        titles = [item["title"] for item in history_part(self.user)["items"] if item["kind"] == "payment"]
        self.assertEqual(titles, ["Payment 300,000 UZS (Naqd pul)"])

    def test_balances_by_user_gives_zero_for_an_account_with_no_rows(self):
        other = User.objects.create_user(None, password=None, username="new", role="student")
        Account.objects.create(name="New", user=other)
        self.assertEqual(reads.balances_by_user([self.user.pk, other.pk]), {self.user.pk: -200_000, other.pk: 0})


class PersonPageTests(TestCase):
    def test_before_the_cutover_no_lc_up_link_means_no_money_section(self):
        from users.people_detail import _lcup

        user, _ = student()
        self.assertIsNone(_lcup(user))

    @OURS
    def test_after_it_a_student_lc_up_never_knew_has_one(self):
        from users.people_detail import _lcup

        user, account = student()
        ledger.post(account, EntryKind.CHARGE, -38_500, date(2026, 12, 2), "c1")
        section = _lcup(user)
        self.assertEqual(
            (section["balance"], section["status"], section["lcup_student_id"], section["freeze_on"], section["rule"]),
            (-38_500, "", None, True, "lesson"),
        )
