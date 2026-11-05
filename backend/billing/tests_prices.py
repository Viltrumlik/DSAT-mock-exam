from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from billing import ledger, shadow
from billing.ledger import EntryRefused
from billing.models import EntryKind, Seat, SeatPriceChange
from billing.tests_api import ADMIN_HOST
from billing.tests_ledger import make_seat
from billing.tests_shadow import Opened, at

User = get_user_model()
OCT_1 = date(2026, 10, 1)


class PersonalPriceCase(TestCase):
    def setUp(self):
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.seat = make_seat()
        self.span = ledger.start_span(self.seat, OCT_1, today=OCT_1)

    def set_price(self, price, *, today=OCT_1, reason="Agreed with the family"):
        ledger.set_personal_price(self.seat, price, reason=reason, by=self.boss, today=today)
        self.seat.refresh_from_db()

    def balance(self):
        return ledger.balance(self.seat.account)


class SetPersonalPriceTests(PersonalPriceCase):
    def test_this_months_charge_is_voided_and_written_again(self):
        self.set_price(400_000)
        self.assertEqual(self.balance(), -400_000)
        rows = self.seat.account.entries.filter(kind=EntryKind.CHARGE)
        self.assertEqual(sorted(rows.values_list("amount", flat=True)), [-500_000, -400_000])
        self.assertIn("Agreed with the family", rows.get(amount=-500_000).void_reason)

    def test_the_next_month_charges_the_personal_price(self):
        self.set_price(400_000)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), -800_000)

    def test_a_grant_charges_nothing_from_this_month_on(self):
        self.set_price(0)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), 0)

    def test_going_back_to_the_group_price(self):
        self.set_price(400_000)
        self.set_price(None)
        self.assertEqual(self.balance(), -500_000)
        self.assertIsNone(self.seat.personal_price)

    def test_part_of_a_month_uses_the_personal_price(self):
        self.set_price(400_000)
        late = make_seat(self.seat.account, name="Middle G2", group=2)
        ledger.set_personal_price(late, 400_000, reason="Agreed", by=self.boss, today=OCT_1)
        late.refresh_from_db()
        ledger.start_span(late, date(2026, 10, 21), today=date(2026, 10, 21))
        self.assertEqual(self.balance(), -400_000 - 154_000)

    def test_leaving_gives_back_by_the_personal_price(self):
        self.set_price(400_000)
        self.span.refresh_from_db()
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        self.assertEqual(self.balance(), -246_000)

    def test_a_group_price_change_does_not_touch_a_personal_price(self):
        self.set_price(400_000)
        Seat.objects.filter(pk=self.seat.pk).update(price=600_000)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), -800_000)

    def test_every_change_says_who_when_and_why(self):
        self.set_price(400_000)
        self.set_price(None, reason="The agreement ended")
        first, second = SeatPriceChange.objects.order_by("id")
        self.assertEqual((first.old_price, first.new_price, first.reason, first.changed_by), (None, 400_000, "Agreed with the family", self.boss))
        self.assertEqual((second.old_price, second.new_price, second.reason), (400_000, None, "The agreement ended"))
        self.assertEqual(first.seat, self.seat)

    def test_the_same_price_changes_nothing(self):
        self.set_price(400_000)
        rows = self.seat.account.entries.count()
        self.set_price(400_000)
        self.assertEqual(self.seat.account.entries.count(), rows)
        self.assertEqual(SeatPriceChange.objects.count(), 1)

    def test_a_reason_is_required(self):
        with self.assertRaisesMessage(EntryRefused, "reason"):
            self.set_price(400_000, reason="  ")
        self.assertIsNone(Seat.objects.get(pk=self.seat.pk).personal_price)

    def test_a_price_must_be_a_whole_number_of_soum_or_nothing(self):
        for price in (-1, 12.5, "400000", True, ledger.MAX_AMOUNT + 1):
            with self.subTest(price=price), self.assertRaises(EntryRefused):
                self.set_price(price)

    def test_an_ended_span_is_not_written_again(self):
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        before = self.balance()
        self.set_price(400_000, today=date(2026, 10, 25))
        self.assertEqual(self.balance(), before)

    def test_last_months_charge_stays(self):
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.set_price(400_000, today=date(2026, 11, 3))
        self.assertEqual(self.balance(), -900_000)


class OpeningMonthPriceTests(TestCase):
    def test_a_charge_inside_the_opening_balance_is_not_rewritten(self):
        boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        seat = make_seat()
        ledger.start_span(seat, date(2026, 9, 1), today=date(2026, 11, 4), opening_month="2026-11")
        ledger.set_personal_price(seat, 400_000, reason="Agreed", by=boss, today=date(2026, 11, 5))
        self.assertEqual(ledger.balance(seat.account), 0)
        ledger.bill_open_spans(today=date(2026, 12, 1))
        self.assertEqual(ledger.balance(seat.account), -400_000)


class WatcherKeepsThePriceTests(Opened, TestCase):
    def test_the_watcher_leaves_a_personal_price_alone(self):
        boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        seat = self.seat()
        ledger.set_personal_price(seat, 400_000, reason="Agreed", by=boss, today=date(2026, 11, 5))
        shadow.watch(at(2026, 11, 5))
        seat.refresh_from_db()
        self.assertEqual((seat.price, seat.personal_price), (500_000, 400_000))


class PersonalPriceApiTests(Opened, TestCase):
    def setUp(self):
        super().setUp()
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")

    def post(self, body, *, user=None, host=ADMIN_HOST, authenticate=True, pk=None):
        api = APIClient()
        if authenticate:
            api.force_authenticate(user or self.boss)
        with override_settings(ALLOWED_HOSTS=[host]):
            return api.post(f"/api/billing/seats/{pk or self.seat().pk}/price/", body, format="json", HTTP_HOST=host)

    @override_settings(BILLING_SHADOW_ENABLED=True)
    def test_it_is_open_while_the_ledger_follows_lc_up(self):
        response = self.post({"price": 400_000, "reason": "Agreed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.seat().personal_price, 400_000)
        self.assertEqual(response.json()["balance"], -500_000)

    def test_null_goes_back_to_the_group_price(self):
        self.post({"price": 400_000, "reason": "Agreed"})
        self.assertEqual(self.post({"price": None, "reason": "Ended"}).status_code, 200)
        self.assertIsNone(self.seat().personal_price)

    def test_what_is_wrong_comes_back_in_words(self):
        for body in ({"price": 400_000, "reason": ""}, {"price": "400000", "reason": "x"}, {"reason": "x"}):
            with self.subTest(body=body):
                response = self.post(body)
                self.assertEqual(response.status_code, 400)
                self.assertTrue(response.json()["detail"])

    def test_an_unknown_seat_is_not_found(self):
        self.assertEqual(self.post({"price": 1, "reason": "x"}, pk=999999).status_code, 404)

    def test_a_teacher_is_refused(self):
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.assertEqual(self.post({"price": 1, "reason": "x"}, user=teacher, host="mastersat.uz").status_code, 403)

    def test_a_student_is_refused(self):
        student = User.objects.create_user(None, password=None, username="s", role="student")
        self.assertEqual(self.post({"price": 1, "reason": "x"}, user=student, host="mastersat.uz").status_code, 403)

    def test_nobody_signed_in_is_refused(self):
        self.assertEqual(self.post({"price": 1, "reason": "x"}, authenticate=False, host="mastersat.uz").status_code, 401)

    def test_the_account_shows_the_price_and_its_history(self):
        self.post({"price": 400_000, "reason": "Agreed"})
        api = APIClient()
        api.force_authenticate(self.boss)
        with override_settings(ALLOWED_HOSTS=[ADMIN_HOST]):
            body = api.get(f"/api/billing/accounts/{self.account().pk}/", HTTP_HOST=ADMIN_HOST).json()
        seat = body["seats"][0]
        self.assertEqual((seat["price"], seat["personal_price"]), (500_000, 400_000))
        self.assertEqual(seat["price_changes"][0]["reason"], "Agreed")
        self.assertEqual(seat["price_changes"][0]["by"], "boss")
