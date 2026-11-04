from datetime import date

from django.test import TestCase

from billing import ledger
from billing.models import Account, Entry, EntryKind, Seat, SeatState

MWF = [1, 3, 5]
PRICE = 500_000
OCT_5 = date(2026, 10, 5)


def make_seat(account=None, *, name="Junior G1", price=PRICE, days=None, group=1):
    account = account or Account.objects.create(name="A student")
    return Seat.objects.create(
        account=account, group_name=name, lcup_group_id=group, price=price, days=days or MWF, state=SeatState.ACTIVE
    )


class PostTests(TestCase):
    def setUp(self):
        self.account = Account.objects.create(name="A student")

    def test_the_balance_is_the_sum_of_the_rows(self):
        ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a")
        ledger.post(self.account, EntryKind.PAYMENT, 200_000, OCT_5, "b")
        self.assertEqual(ledger.balance(self.account), -300_000)

    def test_the_same_key_twice_writes_one_row(self):
        ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a")
        self.assertIsNone(ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a"))
        self.assertEqual(self.account.entries.count(), 1)

    def test_a_voided_row_stays_but_stops_counting(self):
        entry = ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a")
        ledger.void(entry, "wrong group")
        entry.refresh_from_db()
        self.assertEqual(entry.void_reason, "wrong group")
        self.assertIsNotNone(entry.voided_at)
        self.assertEqual(ledger.balance(self.account), 0)

    def test_a_voided_key_can_be_written_again(self):
        ledger.void(ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a"), "wrong")
        self.assertIsNotNone(ledger.post(self.account, EntryKind.CHARGE, -400_000, OCT_5, "a"))
        self.assertEqual(ledger.balance(self.account), -400_000)
        self.assertEqual(self.account.entries.count(), 2)

    def test_voiding_needs_a_reason(self):
        entry = ledger.post(self.account, EntryKind.CHARGE, -500_000, OCT_5, "a")
        with self.assertRaises(ValueError):
            ledger.void(entry, "  ")


class JoiningTests(TestCase):
    def test_joining_mid_month_pays_the_lessons_left(self):
        seat = make_seat()
        ledger.start_span(seat, date(2026, 10, 21), today=date(2026, 10, 21))
        row = seat.account.entries.get()
        self.assertEqual((row.kind, row.amount, row.month), (EntryKind.CHARGE, -192_000, "2026-10"))

    def test_a_start_seen_late_pays_every_month_since(self):
        seat = make_seat()
        ledger.start_span(seat, date(2026, 9, 30), today=date(2026, 10, 2))
        self.assertEqual(ledger.balance(seat.account), -538_000)

    def test_a_start_next_month_writes_nothing_until_then(self):
        seat = make_seat()
        ledger.start_span(seat, date(2026, 11, 16), today=date(2026, 10, 30))
        self.assertEqual(seat.account.entries.count(), 0)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(ledger.balance(seat.account), -269_000)

    def test_each_seat_pays_for_itself(self):
        seat = make_seat()
        other = make_seat(seat.account, name="Middle G2", group=2)
        ledger.start_span(seat, date(2026, 10, 1), today=date(2026, 10, 1))
        ledger.start_span(other, date(2026, 10, 1), today=date(2026, 10, 1))
        self.assertEqual(ledger.balance(seat.account), -1_000_000)


class FirstOfTheMonthTests(TestCase):
    def setUp(self):
        self.seat = make_seat()
        ledger.start_span(self.seat, date(2026, 10, 1), today=date(2026, 10, 1))

    def test_a_new_month_charges_the_whole_price(self):
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(ledger.balance(self.seat.account), -1_000_000)

    def test_running_it_again_charges_nothing_more(self):
        ledger.bill_open_spans(today=date(2026, 11, 1))
        ledger.bill_open_spans(today=date(2026, 11, 1))
        ledger.bill_open_spans(today=date(2026, 11, 2))
        self.assertEqual(ledger.balance(self.seat.account), -1_000_000)

    def test_a_missed_first_is_caught_up(self):
        ledger.bill_open_spans(today=date(2026, 12, 3))
        self.assertEqual(ledger.balance(self.seat.account), -1_500_000)

    def test_a_new_price_only_touches_the_next_charge(self):
        Seat.objects.filter(pk=self.seat.pk).update(price=600_000)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(ledger.balance(self.seat.account), -1_100_000)


class EndingTests(TestCase):
    def setUp(self):
        self.seat = make_seat()
        self.span = ledger.start_span(self.seat, date(2026, 10, 1), today=date(2026, 10, 1))

    def test_leaving_gives_back_the_lessons_not_reached(self):
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        credit = self.seat.account.entries.get(kind=EntryKind.CREDIT)
        self.assertEqual((credit.amount, credit.month, credit.day), (192_000, "2026-10", date(2026, 10, 19)))
        self.assertEqual(ledger.balance(self.seat.account), -308_000)

    def test_no_charge_after_leaving(self):
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(ledger.balance(self.seat.account), -308_000)

    def test_a_leave_entered_next_month_voids_that_months_charge(self):
        ledger.bill_open_spans(today=date(2026, 11, 1))
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 11, 3))
        self.assertEqual(ledger.balance(self.seat.account), -308_000)
        november = self.seat.account.entries.get(month="2026-11")
        self.assertIsNotNone(november.voided_at)
        self.assertIn("leave", november.void_reason)

    def test_freezing_and_coming_back_skips_the_months_between(self):
        ledger.end_span(self.span, date(2026, 10, 19), "freeze", today=date(2026, 10, 19))
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(ledger.balance(self.seat.account), -308_000)
        ledger.start_span(self.seat, date(2026, 12, 16), today=date(2026, 12, 16))
        self.assertEqual(ledger.balance(self.seat.account), -308_000 - 269_000)

    def test_frozen_and_back_in_one_month_pays_only_the_lessons_attended(self):
        ledger.end_span(self.span, date(2026, 10, 7), "freeze", today=date(2026, 10, 7))
        ledger.start_span(self.seat, date(2026, 10, 26), today=date(2026, 10, 26))
        self.assertEqual(ledger.balance(self.seat.account), -115_000 - 115_000)

    def test_a_new_price_does_not_change_what_a_whole_month_gives_back(self):
        Seat.objects.filter(pk=self.seat.pk).update(price=600_000)
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        self.assertEqual(ledger.balance(self.seat.account), -308_000)


class MovedDateTests(TestCase):
    def setUp(self):
        self.seat = make_seat()
        self.span = ledger.start_span(self.seat, date(2026, 10, 1), today=date(2026, 10, 1))

    def test_a_corrected_leave_date_voids_the_old_row_and_writes_a_new_one(self):
        ledger.end_span(self.span, date(2026, 10, 19), "leave", today=date(2026, 10, 19))
        ledger.move_span(self.span, end=date(2026, 10, 12), today=date(2026, 10, 20), reason="lc-up changed the date")
        self.assertEqual(ledger.balance(self.seat.account), -192_000)
        voided = self.seat.account.entries.filter(voided_at__isnull=False)
        self.assertEqual(sorted(voided.values_list("amount", flat=True)), [-500_000, 192_000])
        self.assertEqual(set(voided.values_list("void_reason", flat=True)), {"lc-up changed the date"})

    def test_a_corrected_start_date_writes_the_right_charge(self):
        ledger.move_span(self.span, start=date(2026, 10, 21), today=date(2026, 10, 25), reason="lc-up changed the date")
        self.assertEqual(ledger.balance(self.seat.account), -192_000)

    def test_moving_to_the_same_dates_changes_nothing(self):
        before = Entry.objects.count()
        ledger.move_span(self.span, start=date(2026, 10, 1), today=date(2026, 10, 25), reason="same")
        self.assertEqual(Entry.objects.count(), before)


class OpeningMonthTests(TestCase):
    """The month the ledger opens is inside the opening balance: lc-up already charged it."""

    def setUp(self):
        self.seat = make_seat()
        self.span = ledger.start_span(
            self.seat, date(2026, 9, 1), today=date(2026, 11, 4), opening_month="2026-11"
        )

    def test_nothing_is_charged_for_the_opening_month_or_before(self):
        self.assertEqual(self.seat.account.entries.count(), 0)

    def test_the_next_month_is_charged(self):
        ledger.bill_open_spans(today=date(2026, 12, 1))
        self.assertEqual(ledger.balance(self.seat.account), -500_000)

    def test_leaving_in_the_opening_month_still_gives_lessons_back(self):
        ledger.end_span(self.span, date(2026, 11, 9), "leave", today=date(2026, 11, 9))
        self.assertEqual(ledger.balance(self.seat.account), 346_000)
