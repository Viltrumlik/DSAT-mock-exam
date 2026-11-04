import io
import uuid
from datetime import date, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing import conf, ledger
from billing.ledger import EntryRefused
from billing.models import Account, BillingState, Entry, EntryKind
from billing.tests_api import ADMIN_HOST
from billing.tests_ledger import make_seat
from billing.tests_shadow import NOW, Opened

User = get_user_model()
TODAY = date(2026, 11, 10)
OPENED = date(2026, 11, 4)


def rid() -> str:
    return str(uuid.uuid4())


class EntryCase(TestCase):
    def setUp(self):
        state = BillingState.get()
        state.opened_at = NOW
        state.save()
        self.account = Account.objects.create(name="A student")
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")

    def enter(self, kind=EntryKind.PAYMENT, amount=500_000, day=TODAY, *, method="Naqd pul", note="", request_id=None, account=None):
        return ledger.enter_money(
            account or self.account, kind, amount, day, request_id=request_id or rid(), today=TODAY,
            method=method, note=note, by=self.boss,
        )


class EnterMoneyTests(EntryCase):
    def test_a_payment_raises_the_balance_and_says_who_entered_it(self):
        row = self.enter(note="October and November")
        self.assertEqual(ledger.balance(self.account), 500_000)
        self.assertEqual(
            (row.kind, row.amount, row.method, row.note, row.created_by, row.day),
            (EntryKind.PAYMENT, 500_000, "Naqd pul", "October and November", self.boss, TODAY),
        )

    def test_a_refund_lowers_the_balance(self):
        row = self.enter(EntryKind.REFUND, 200_000, method="Plastik karta")
        self.assertEqual(row.amount, -200_000)
        self.assertEqual(ledger.balance(self.account), -200_000)

    def test_an_adjustment_goes_either_way(self):
        self.enter(EntryKind.ADJUST, 30_000, method="", note="lc-up gave a discount by hand")
        self.enter(EntryKind.ADJUST, -10_000, method="", note="Typed wrong in October")
        self.assertEqual(ledger.balance(self.account), 20_000)

    def test_an_adjustment_needs_a_reason(self):
        with self.assertRaisesMessage(EntryRefused, "reason"):
            self.enter(EntryKind.ADJUST, 30_000, method="", note="   ")

    def test_an_adjustment_of_nothing_is_refused(self):
        with self.assertRaises(EntryRefused):
            self.enter(EntryKind.ADJUST, 0, method="", note="nothing")

    def test_the_same_request_twice_writes_one_row(self):
        request_id = rid()
        first = self.enter(request_id=request_id)
        second = self.enter(request_id=request_id)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(ledger.balance(self.account), 500_000)

    def test_a_request_seen_again_after_its_row_was_voided_writes_nothing(self):
        request_id = rid()
        ledger.void_entered(self.enter(request_id=request_id), "typed wrong", by=self.boss)
        self.enter(request_id=request_id)
        self.assertEqual(self.account.entries.count(), 1)
        self.assertEqual(ledger.balance(self.account), 0)

    def test_one_request_cannot_reach_a_second_account(self):
        request_id = rid()
        self.enter(request_id=request_id)
        other = Account.objects.create(name="Another student")
        with self.assertRaises(EntryRefused):
            self.enter(request_id=request_id, account=other)
        self.assertEqual(ledger.balance(other), 0)

    def test_an_amount_must_be_a_whole_positive_number_of_soum(self):
        for amount in (0, -500, 12.5, "500000", True, None):
            with self.subTest(amount=amount), self.assertRaises(EntryRefused):
                self.enter(amount=amount)

    def test_an_impossible_amount_is_refused(self):
        with self.assertRaisesMessage(EntryRefused, "too large"):
            self.enter(amount=ledger.MAX_AMOUNT + 1)
        self.assertEqual(self.enter(amount=ledger.MAX_AMOUNT).amount, ledger.MAX_AMOUNT)

    def test_a_payment_needs_a_known_method(self):
        for method in ("", "Bitcoin"):
            with self.subTest(method=method), self.assertRaisesMessage(EntryRefused, "method"):
                self.enter(method=method)

    def test_a_day_ahead_is_refused(self):
        with self.assertRaisesMessage(EntryRefused, "future"):
            self.enter(day=TODAY + timedelta(days=1))

    def test_a_day_before_the_ledger_opened_is_refused(self):
        """That money is already inside the opening balance."""
        with self.assertRaisesMessage(EntryRefused, "opening"):
            self.enter(day=OPENED - timedelta(days=1))
        self.assertEqual(self.enter(day=OPENED).day, OPENED)

    def test_nothing_is_entered_before_the_ledger_opens(self):
        BillingState.objects.update(opened_at=None)
        with self.assertRaises(EntryRefused):
            self.enter()


class VoidEnteredTests(EntryCase):
    def test_it_stays_with_its_reason_and_who_voided_it(self):
        row = self.enter()
        ledger.void_entered(row, "Typed the wrong student", by=self.boss)
        row.refresh_from_db()
        self.assertEqual((row.void_reason, row.voided_by), ("Typed the wrong student", self.boss))
        self.assertEqual(ledger.balance(self.account), 0)

    def test_it_needs_a_reason(self):
        with self.assertRaises(EntryRefused):
            ledger.void_entered(self.enter(), "  ", by=self.boss)

    def test_it_is_voided_once(self):
        row = self.enter()
        ledger.void_entered(row, "wrong", by=self.boss)
        with self.assertRaises(EntryRefused):
            ledger.void_entered(row, "wrong again", by=self.boss)

    def test_a_charge_is_not_voided_by_hand(self):
        """The next tick would only write it again: a wrong charge is put right with an adjustment."""
        ledger.start_span(make_seat(self.account), date(2026, 11, 2), today=TODAY)
        with self.assertRaises(EntryRefused):
            ledger.void_entered(self.account.entries.get(kind=EntryKind.CHARGE), "wrong", by=self.boss)

    def test_a_copied_lc_up_payment_is_not_voided_by_hand(self):
        row = ledger.post(self.account, EntryKind.PAYMENT, 100, TODAY, "lcup-payment:5")
        with self.assertRaises(EntryRefused):
            ledger.void_entered(row, "wrong", by=self.boss)

    def test_the_opening_balance_is_not_voided_by_hand(self):
        row = ledger.post(self.account, EntryKind.OPENING, -100, TODAY, "opening:1")
        with self.assertRaises(EntryRefused):
            ledger.void_entered(row, "wrong", by=self.boss)


class PaymentsOpenTests(TestCase):
    def test_closed_by_default(self):
        self.assertFalse(conf.payments_open())

    @override_settings(BILLING_PAYMENTS_OPEN=True)
    def test_opened_by_its_own_switch(self):
        self.assertTrue(conf.payments_open())

    @override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=True)
    def test_never_while_the_ledger_still_follows_lc_up(self):
        """A payment would be entered here and copied from lc-up too."""
        self.assertFalse(conf.payments_open())


class EntryApiCase(Opened):
    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")

    def post(self, path, body, *, user=None, host=ADMIN_HOST, authenticate=True):
        api = APIClient()
        if authenticate:
            api.force_authenticate(user or self.boss)
        with override_settings(ALLOWED_HOSTS=[host]):
            return api.post(path, body, format="json", HTTP_HOST=host)

    def get(self, path):
        api = APIClient()
        api.force_authenticate(self.boss)
        with override_settings(ALLOWED_HOSTS=[ADMIN_HOST]):
            return api.get(path, HTTP_HOST=ADMIN_HOST)

    def url(self):
        return f"/api/billing/accounts/{self.account().pk}/entries/"

    def body(self, **over):
        return {"kind": "payment", "amount": 500_000, "method": "Naqd pul", "request_id": rid(), **over}


class ClosedApiTests(EntryApiCase, TestCase):
    def test_entering_money_is_refused_while_closed(self):
        response = self.post(self.url(), self.body())
        self.assertEqual(response.status_code, 403)
        self.assertIn("lc-up", response.json()["detail"])
        self.assertEqual(self.account().entries.filter(kind=EntryKind.PAYMENT).count(), 0)

    def test_voiding_is_refused_while_closed(self):
        row = ledger.post(self.account(), EntryKind.PAYMENT, 100, TODAY, "manual:x")
        self.assertEqual(self.post(f"/api/billing/entries/{row.pk}/void/", {"reason": "wrong"}).status_code, 403)
        row.refresh_from_db()
        self.assertIsNone(row.voided_at)

    def test_the_account_says_it_is_closed(self):
        body = self.get(f"/api/billing/accounts/{self.account().pk}/").json()
        self.assertFalse(body["payments_open"])


@override_settings(BILLING_PAYMENTS_OPEN=True)
class OpenApiTests(EntryApiCase, TestCase):
    def test_a_payment_is_entered_and_the_new_balance_comes_back(self):
        response = self.post(self.url(), self.body())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["balance"], 0)
        row = self.account().entries.get(kind=EntryKind.PAYMENT)
        self.assertEqual((row.created_by, row.day), (self.boss, timezone.localdate()))

    def test_a_retried_request_writes_one_row(self):
        body = self.body()
        self.post(self.url(), body)
        self.assertEqual(self.post(self.url(), body).status_code, 201)
        self.assertEqual(self.account().entries.filter(kind=EntryKind.PAYMENT).count(), 1)

    def test_a_refund_and_an_adjustment_go_through(self):
        self.post(self.url(), self.body(kind="refund", amount=100_000))
        response = self.post(self.url(), self.body(kind="adjust", amount=-5_000, method="", note="Rounding in October"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["balance"], -605_000)

    def test_a_day_can_be_named(self):
        day = timezone.localdate().isoformat()
        self.post(self.url(), self.body(day=day))
        self.assertEqual(self.account().entries.get(kind=EntryKind.PAYMENT).day.isoformat(), day)

    def test_what_is_wrong_comes_back_in_words(self):
        for body in (
            self.body(kind="charge"),
            self.body(kind="opening"),
            self.body(amount=0),
            self.body(amount="500000"),
            self.body(method="Bitcoin"),
            self.body(request_id="not-a-uuid"),
            self.body(request_id=None),
            self.body(day="yesterday"),
            self.body(day=(timezone.localdate() + timedelta(days=1)).isoformat()),
            self.body(kind="adjust", amount=100, method="", note=""),
        ):
            with self.subTest(body=body):
                response = self.post(self.url(), body)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json()["detail"])
        self.assertEqual(self.account().entries.exclude(kind=EntryKind.OPENING).count(), 0)

    def test_an_unknown_account_is_not_found(self):
        self.assertEqual(self.post("/api/billing/accounts/999999/entries/", self.body()).status_code, 404)

    def test_a_teacher_is_refused(self):
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.assertEqual(self.post(self.url(), self.body(), user=teacher, host="mastersat.uz").status_code, 403)

    def test_a_student_is_refused(self):
        student = User.objects.create_user(None, password=None, username="s", role="student")
        self.assertEqual(self.post(self.url(), self.body(), user=student, host="mastersat.uz").status_code, 403)

    def test_nobody_signed_in_is_refused(self):
        self.assertEqual(self.post(self.url(), self.body(), authenticate=False, host="mastersat.uz").status_code, 401)

    def test_any_admin_can_void_a_row_someone_else_entered(self):
        self.post(self.url(), self.body())
        row = self.account().entries.get(kind=EntryKind.PAYMENT)
        other = User.objects.create_user(None, password=None, username="other", role="admin")
        response = self.post(f"/api/billing/entries/{row.pk}/void/", {"reason": "Wrong student"}, user=other)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["balance"], -500_000)
        row.refresh_from_db()
        self.assertEqual((row.voided_by, row.void_reason), (other, "Wrong student"))

    def test_voiding_without_a_reason_is_refused(self):
        self.post(self.url(), self.body())
        row = self.account().entries.get(kind=EntryKind.PAYMENT)
        self.assertEqual(self.post(f"/api/billing/entries/{row.pk}/void/", {"reason": " "}).status_code, 400)

    def test_a_teacher_cannot_void(self):
        self.post(self.url(), self.body())
        row = self.account().entries.get(kind=EntryKind.PAYMENT)
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        response = self.post(f"/api/billing/entries/{row.pk}/void/", {"reason": "x"}, user=teacher, host="mastersat.uz")
        self.assertEqual(response.status_code, 403)

    def test_voiding_an_unknown_row_is_not_found(self):
        self.assertEqual(self.post("/api/billing/entries/999999/void/", {"reason": "x"}).status_code, 404)

    def test_the_account_says_which_rows_can_be_voided_and_who_voided_them(self):
        self.post(self.url(), self.body())
        self.post(self.url(), self.body(amount=1_000))
        small = self.account().entries.get(amount=1_000)
        self.post(f"/api/billing/entries/{small.pk}/void/", {"reason": "Wrong student"})
        body = self.get(f"/api/billing/accounts/{self.account().pk}/").json()
        self.assertTrue(body["payments_open"])
        rows = {row["amount"]: row for row in body["rows"]}
        self.assertFalse(rows[-500_000]["can_void"])
        self.assertTrue(rows[500_000]["can_void"])
        self.assertFalse(rows[1_000]["can_void"])
        self.assertEqual(rows[1_000]["voided_by"], "boss")
        self.assertEqual(rows[500_000]["by"], "boss")


class AdjustCommandTests(Opened, TestCase):
    """While the ledger follows lc-up the form stays closed, but a difference lc-up cannot explain still has to
    be written down, with a reason and a name."""

    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")

    def run_command(self, *args):
        out = io.StringIO()
        with mock.patch("django.utils.timezone.now", return_value=NOW + timedelta(days=1)):
            call_command("billing_adjust", *args, stdout=out)
        return out.getvalue()

    def test_it_writes_an_adjustment_with_a_reason_and_a_name(self):
        pk = str(self.account().pk)
        self.run_command("--account", pk, "--amount=-5000", "--reason", "lc-up discount by hand", "--by", "boss")
        row = self.account().entries.get(kind=EntryKind.ADJUST)
        self.assertEqual((row.amount, row.note, row.created_by), (-5_000, "lc-up discount by hand", self.boss))
        self.assertEqual(ledger.balance(self.account()), -505_000)

    def test_it_needs_someone_who_is_an_admin(self):
        pk = str(self.account().pk)
        User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        with self.assertRaises(CommandError):
            self.run_command("--account", pk, "--amount", "100", "--reason", "x", "--by", "t")
        with self.assertRaises(CommandError):
            self.run_command("--account", pk, "--amount", "100", "--reason", "x", "--by", "nobody")

    def test_a_refused_adjustment_says_why(self):
        pk = str(self.account().pk)
        with self.assertRaisesMessage(CommandError, "reason"):
            self.run_command("--account", pk, "--amount", "100", "--reason", "  ", "--by", "boss")
        self.assertFalse(Entry.objects.filter(kind=EntryKind.ADJUST).exists())
