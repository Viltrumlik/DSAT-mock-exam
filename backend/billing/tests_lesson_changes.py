"""A lesson cancelled or moved, in money (owner, 2026-11-25): a cancelled day is not charged, one already charged is
voided with the reason, and a moved lesson is charged once, on its new day. Undo charges the day again.

December 2026: Monday 7, Tuesday 8, Wednesday 9, Thursday 10, Friday 11. The class is ODD (Mon/Wed/Fri) at 500,000 a
month, so a lesson is 38,500. The students here came before pay per lesson (an opening balance), so every lesson is
charged from their first day, except in ``FirstMonthTests``. Today is passed in, never read from the clock.
"""

from datetime import date
from unittest import mock

from django.contrib.auth import get_user_model
from django.db.models.query import QuerySet
from django.test import TestCase, override_settings

from billing import ledger
from billing.models import Account, EndReason, Entry, EntryKind, Span, SpanRule
from billing.tests_lesson_rule import LESSON_MODE, MWF, TTS, seat_for, student
from billing.tests_seat_class import make_room
from billing.views import _row_label
from classes import lesson_changes as L
from classes.models_lesson_changes import LessonChange
from users import audience as A

User = get_user_model()

PRICE = 38_500
NOV_30 = date(2026, 11, 30)
DEC_2, DEC_4 = date(2026, 12, 2), date(2026, 12, 4)
MON, TUE, WED, THU, FRI = (date(2026, 12, d) for d in (7, 8, 9, 10, 11))
LEDGER_OURS = override_settings(BILLING_PAYMENTS_OPEN=True, BILLING_SHADOW_ENABLED=False)


def key(prefix, span, day):
    return f"{prefix}{span.pk}:{day.isoformat()}"


@LESSON_MODE
class Case(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.room = make_room()  # ODD: Mon/Wed/Fri

    def old_student(self, room=None, *, name="ali", days=MWF, personal=None, start=DEC_2, today=WED, group=1):
        """Someone with an opening balance of 0, seated in ``room`` from ``start``: every lesson is charged."""
        user, account = student(name)
        Entry.objects.create(account=account, kind=EntryKind.OPENING, amount=0, day=NOV_30, key=f"open:{name}")
        seat = seat_for(account, days=days, personal=personal, group=group)
        seat.classroom = room or self.room
        seat.save(update_fields=["classroom"])
        return user, account, ledger.start_span(seat, start, today=today)

    def charged(self, account):
        """The live charges, by day."""
        return sorted(account.entries.filter(voided_at__isnull=True, kind=EntryKind.CHARGE).values_list("day", "amount"))

    def cancel(self, day, *, room=None, today=WED, reason="Teacher ill"):
        return L.cancel(room or self.room, day, reason, by=self.admin, today=today)

    def move(self, day, new_day, *, today=WED, reason="Teacher at a seminar"):
        return L.move(self.room, day, new_day, reason, by=self.admin, today=today)


class CancelTests(Case):
    def test_1_a_future_day_cancelled_is_never_charged(self):
        _, account, span = self.old_student(today=MON)
        self.assertEqual(self.cancel(WED, today=MON).money["voided"], 0)
        ledger.own_tick(WED)
        ledger.own_tick(FRI)
        self.assertEqual([day for day, _ in self.charged(account)], [DEC_2, DEC_4, MON, FRI])
        self.assertFalse(Entry.objects.filter(key=key("lesson:", span, WED)).exists())

    def test_2_a_day_already_charged_is_voided_with_the_reason(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        change = self.cancel(MON)
        row = Entry.objects.get(key=key("lesson:", span, MON))
        self.assertEqual((row.void_reason, row.voided_by, row.amount), ("Lesson cancelled: Teacher ill", self.admin, -PRICE))
        self.assertIsNotNone(row.voided_at)
        self.assertEqual(ledger.balance(account), before + PRICE)
        self.assertEqual(
            change.money,
            {"voided": 1, "students": 1, "amount": PRICE, "charged": 0, "charged_amount": 0, "unfrozen": 0},
        )
        ledger.own_tick(FRI)  # the tick does not charge it again
        self.assertEqual(Entry.objects.filter(key=key("lesson:", span, MON)).count(), 1)

    @LEDGER_OURS
    def test_3_a_debt_frozen_student_given_the_lesson_back_is_unfrozen(self):
        user, account, _ = self.old_student(start=MON, today=MON)
        self.assertEqual(ledger.balance(account), -PRICE)
        self.assertEqual(ledger.apply_debt_freeze(account), "frozen")
        change = self.cancel(MON, today=MON)
        user.refresh_from_db()
        self.assertEqual((ledger.balance(account), user.is_frozen, user.frozen_reason), (0, False, ""))
        self.assertEqual(change.money["unfrozen"], 1)

    @LEDGER_OURS
    def test_3c_an_undo_below_zero_never_freezes_the_next_tick_does(self):
        # A lesson change only lifts a debt freeze; freezing stays the 15-minute tick's, with its 40-at-once guard.
        user, account, _ = self.old_student(start=MON, today=MON)
        change = self.cancel(MON, today=MON)
        self.assertEqual(ledger.balance(account), 0)
        undone = L.undo(change, by=self.admin, today=MON)
        user.refresh_from_db()
        self.assertEqual((ledger.balance(account), user.is_frozen, "frozen" in undone.money), (-PRICE, False, False))
        ledger.own_tick(MON)
        user.refresh_from_db()
        self.assertEqual((user.is_frozen, user.frozen_reason), (True, A.FROZEN_LCUP_DEBT))

    def test_3b_while_lc_up_keeps_the_ledger_no_freeze_is_touched(self):
        user, account, _ = self.old_student(start=MON, today=MON)
        user.is_frozen, user.frozen_reason = True, A.FROZEN_LCUP_DEBT
        user.save(update_fields=["is_frozen", "frozen_reason"])
        self.assertEqual(self.cancel(MON, today=MON).money["unfrozen"], 0)
        user.refresh_from_db()
        self.assertTrue(user.is_frozen)

    def test_11_a_personal_price_gives_back_the_rows_own_amount(self):
        _, account, span = self.old_student(personal=400_000)
        change = self.cancel(MON)
        self.assertEqual(Entry.objects.get(key=key("lesson:", span, MON)).amount, -31_000)
        self.assertEqual(change.money["amount"], 31_000)

    def test_11b_a_price_changed_since_does_not_change_what_comes_back(self):
        _, account, span = self.old_student()
        ledger.set_personal_price(span.seat, 400_000, reason="sibling", by=None, today=WED)
        self.assertEqual(self.cancel(MON).money["amount"], PRICE)


class MoveTests(Case):
    def test_4_a_move_between_two_days_gone_by_voids_one_and_charges_the_other(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        change = self.move(MON, TUE)
        monday = Entry.objects.get(key=key("lesson:", span, MON))
        self.assertEqual(monday.void_reason, "Lesson moved to 2026-12-08: Teacher at a seminar")
        moved = Entry.objects.get(key=key("moved:", span, MON))
        self.assertEqual(
            (moved.day, moved.amount, moved.month, moved.seat_id, moved.note, moved.voided_at),
            (TUE, -PRICE, "2026-12", span.seat_id, "Lesson 2026-12-07 moved to 2026-12-08", None),
        )
        self.assertEqual(ledger.balance(account), before)
        self.assertEqual(
            change.money,
            {"voided": 1, "students": 1, "amount": PRICE, "charged": 1, "charged_amount": PRICE, "unfrozen": 0},
        )
        ledger.own_tick(THU)
        self.assertEqual(Entry.objects.filter(key__in=[key("lesson:", span, MON), key("moved:", span, MON)]).count(), 2)
        self.assertEqual(ledger.balance(account), before)

    def test_5_a_move_to_a_day_ahead_is_charged_on_that_day(self):
        _, account, span = self.old_student(today=MON)
        self.move(WED, THU, today=MON)
        ledger.own_tick(WED)
        self.assertFalse(Entry.objects.filter(key__in=[key("lesson:", span, WED), key("moved:", span, WED)]).exists())
        ledger.own_tick(THU)
        self.assertEqual(Entry.objects.get(key=key("moved:", span, WED)).day, THU)
        self.assertEqual([day for day, _ in self.charged(account)], [DEC_2, DEC_4, MON, THU])

    def test_a_student_who_came_after_the_old_day_pays_for_the_lesson_on_its_new_day(self):
        _, account, span = self.old_student(start=TUE, today=THU)
        self.move(MON, THU, today=THU)
        self.assertEqual([day for day, _ in self.charged(account)], [WED, THU])

    def test_10_leaving_before_the_new_day_voids_the_moved_lesson(self):
        _, account, span = self.old_student(today=WED)
        self.move(MON, TUE)
        ledger.end_span(span, MON, EndReason.LEAVE, today=WED)
        moved = Entry.objects.get(key=key("moved:", span, MON))
        self.assertEqual(moved.void_reason, "leave: the seat ended on 2026-12-07")
        self.assertEqual([day for day, _ in self.charged(account)], [DEC_2, DEC_4])

    def test_10b_leaving_on_the_new_day_keeps_it(self):
        _, account, span = self.old_student(today=WED)
        self.move(MON, TUE)
        ledger.end_span(span, TUE, EndReason.LEAVE, today=WED)
        self.assertEqual([day for day, _ in self.charged(account)], [DEC_2, DEC_4, TUE])


class UndoTests(Case):
    def test_6_undoing_a_cancel_charges_the_day_again_beside_the_voided_row(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        L.undo(self.cancel(MON), by=self.admin, today=WED)
        ledger.bill_span(span, WED)
        rows = Entry.objects.filter(key=key("lesson:", span, MON)).order_by("id")
        self.assertEqual([row.voided_at is None for row in rows], [False, True])
        self.assertEqual(rows[0].void_reason, "Lesson cancelled: Teacher ill")
        self.assertEqual(ledger.balance(account), before)

    def test_6b_undoing_a_cancel_ahead_waits_for_the_day(self):
        _, account, span = self.old_student(today=MON)
        L.undo(self.cancel(WED, today=MON), by=self.admin, today=MON)
        self.assertFalse(Entry.objects.filter(key=key("lesson:", span, WED)).exists())
        ledger.own_tick(WED)
        self.assertTrue(Entry.objects.filter(key=key("lesson:", span, WED), voided_at__isnull=True).exists())

    def test_7_undoing_a_move_voids_the_moved_lesson_and_charges_the_old_day_again(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        change = self.move(MON, TUE)
        undone = L.undo(change, by=self.admin, today=WED)
        moved = Entry.objects.get(key=key("moved:", span, MON))
        self.assertEqual((moved.void_reason, moved.voided_by), ("Move undone: Teacher at a seminar", self.admin))
        monday = Entry.objects.filter(key=key("lesson:", span, MON)).order_by("id")
        self.assertEqual([row.voided_at is None for row in monday], [False, True])
        self.assertEqual(ledger.balance(account), before)
        self.assertEqual(
            undone.money,
            {"voided": 1, "students": 1, "amount": PRICE, "charged": 1, "charged_amount": PRICE, "unfrozen": 0},
        )


class HolidayTests(Case):
    def test_8_a_holiday_hits_every_class_meeting_that_weekday_and_no_other(self):
        even = make_room("Middle G2")
        even.lesson_days = "EVEN"
        even.save(update_fields=["lesson_days"])
        _, odd_account, odd_span = self.old_student(name="ali")
        _, even_account, even_span = self.old_student(even, name="vali", days=TTS)
        even_before = self.charged(even_account)
        change = L.cancel(None, MON, "Independence Day", by=self.admin, today=WED)
        self.assertEqual(Entry.objects.get(key=key("lesson:", odd_span, MON)).void_reason, "Lesson cancelled: Independence Day")
        self.assertEqual(self.charged(even_account), even_before)
        self.assertEqual((change.money["voided"], change.money["students"]), (1, 1))
        # A holiday ahead: Tuesday 15 is never charged to the EVEN class; the ODD class never met on it.
        L.cancel(None, date(2026, 12, 15), "Teachers' day", by=self.admin, today=WED)
        ledger.own_tick(date(2026, 12, 16))
        self.assertNotIn(date(2026, 12, 15), [day for day, _ in self.charged(even_account)])
        self.assertIn(date(2026, 12, 16), [day for day, _ in self.charged(odd_account)])

    def test_a_seat_with_no_class_has_the_holiday_too(self):
        _, account, span = self.old_student()
        span.seat.classroom = None
        span.seat.save(update_fields=["classroom"])
        L.cancel(None, MON, "Independence Day", by=self.admin, today=WED)
        self.assertIsNotNone(Entry.objects.get(key=key("lesson:", span, MON)).voided_at)
        L.undo(LessonChange.objects.get(), by=self.admin, today=WED)
        self.assertTrue(Entry.objects.filter(key=key("lesson:", span, MON), voided_at__isnull=True).exists())

    def test_one_student_in_two_groups_that_day_is_one_student(self):
        other = make_room("Middle G2")
        _, account, span = self.old_student(name="ali")
        seat = seat_for(account, group=2)
        seat.classroom = other
        seat.save(update_fields=["classroom"])
        ledger.start_span(seat, DEC_2, today=WED)
        money = L.cancel(None, MON, "Independence Day", by=self.admin, today=WED).money
        self.assertEqual((money["voided"], money["students"], money["amount"]), (2, 1, 2 * PRICE))

    def test_undoing_a_holiday_charges_the_day_again(self):
        _, account, span = self.old_student()
        before = ledger.balance(account)
        holiday = L.cancel(None, MON, "Independence Day", by=self.admin, today=WED)
        L.undo(holiday, by=self.admin, today=WED)
        self.assertEqual(ledger.balance(account), before)
        self.assertEqual(Entry.objects.filter(key=key("lesson:", span, MON)).count(), 2)


class FirstMonthTests(Case):
    def test_9_a_cancel_inside_a_new_students_first_month_changes_nothing(self):
        _, account = student("new")
        seat = seat_for(account)
        seat.classroom = self.room
        seat.save(update_fields=["classroom"])
        ledger.start_span(seat, NOV_30, today=WED)  # 500,000 for 30 Nov - 29 Dec
        rows = list(account.entries.values_list("key", "amount", "voided_at"))
        change = self.cancel(MON)
        self.assertEqual(
            change.money, {"voided": 0, "students": 0, "amount": 0, "charged": 0, "charged_amount": 0, "unfrozen": 0}
        )
        ledger.own_tick(FRI)
        L.undo(change, by=self.admin, today=FRI)
        ledger.own_tick(FRI)
        self.assertEqual(list(account.entries.values_list("key", "amount", "voided_at")), rows)


class MonthRuleTests(TestCase):
    """Paid by the month (lc-up's rule, prod today): a lesson called off changes no money."""

    def test_a_seat_paid_by_the_month_is_untouched(self):
        admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        room = make_room()
        account = Account.objects.create(name="Old")
        seat = seat_for(account)
        seat.classroom = room
        seat.save(update_fields=["classroom"])
        span = ledger.start_span(seat, DEC_2, today=WED)
        self.assertEqual(span.rule, SpanRule.MONTH)
        money = L.cancel(room, MON, "Teacher ill", by=admin, today=WED).money
        self.assertEqual((money["voided"], ledger.balance(account)), (0, -500_000))


class LabelTests(TestCase):
    def test_a_moved_lesson_reads_lesson_moved(self):
        self.assertEqual(_row_label(Entry(key="moved:3:2026-12-07", kind=EntryKind.CHARGE)), "Lesson (moved)")
        self.assertEqual(_row_label(Entry(key="lesson:3:2026-12-07", kind=EntryKind.CHARGE)), "Lesson")


class FirstMonthMoveTests(Case):
    """A moved lesson's charge follows its old day (ruling of 2026-11-25): one inside a new student's flat first month
    stays free wherever it goes, and one after it is charged on its new day even inside the month. A move changes the
    day of a charge, never what a student pays. The new students start on Monday 30 November: their month covers
    30 Nov - 29 Dec, so Monday 28 December is covered and Wednesday 30 December is the first lesson paid per lesson."""

    def new_student(self, name, room):
        return self.new_student_on(name, room, NOV_30)

    def new_student_on(self, name, room, day):
        _, account = student(name)
        seat = seat_for(account)
        seat.classroom = room
        seat.save(update_fields=["classroom"])
        ledger.start_span(seat, day, today=day)
        return account

    def test_a_covered_lesson_moved_past_the_first_month_stays_free(self):
        moved, still = self.new_student("new1", self.room), self.new_student("new2", make_room("Junior G2"))
        jan_2 = date(2027, 1, 2)
        L.move(self.room, date(2026, 12, 28), jan_2, "Room taken", by=self.admin, today=jan_2)
        ledger.own_tick(jan_2)
        self.assertEqual(ledger.balance(moved), ledger.balance(still))
        self.assertFalse(Entry.objects.filter(key__startswith="moved:").exists())

    def test_a_charged_lesson_moved_into_the_first_month_is_charged_once_on_its_new_day(self):
        moved, still = self.new_student("new1", self.room), self.new_student("new2", make_room("Junior G2"))
        dec_29, dec_30 = date(2026, 12, 29), date(2026, 12, 30)
        L.move(self.room, dec_30, dec_29, "Teacher away", by=self.admin, today=dec_29)
        ledger.own_tick(date(2027, 1, 2))
        self.assertEqual(ledger.balance(moved), ledger.balance(still))
        row = Entry.objects.get(key__startswith="moved:")
        self.assertEqual((row.day, row.amount, row.voided_at), (dec_29, -PRICE, None))

    def test_a_student_who_joins_after_the_old_day_follows_the_new_day_inside_the_month(self):
        # Monday 7 Dec moved to Thursday 10 Dec; a new student starts Tuesday 8 Dec, after the old day. Thursday is in
        # their flat first month, so it is covered: no moved row, the same total as a twin in a class with no move.
        joined = self.new_student_on("new1", self.room, TUE)
        twin = self.new_student_on("new2", make_room("Junior G2"), TUE)
        L.move(self.room, MON, THU, "Teacher away", by=self.admin, today=TUE)
        ledger.own_tick(THU)
        self.assertEqual(ledger.balance(joined), ledger.balance(twin))
        self.assertFalse(Entry.objects.filter(key__startswith="moved:").exists())

    def test_a_not_new_student_who_joins_between_the_old_and_the_new_day_is_charged_once_on_the_new_day(self):
        _, account, span = self.old_student(name="late", start=TUE, today=TUE)
        L.move(self.room, MON, THU, "Teacher away", by=self.admin, today=TUE)
        ledger.own_tick(THU)
        ledger.own_tick(THU)
        rows = Entry.objects.filter(key=key("moved:", span, MON))
        self.assertEqual([(row.day, row.amount, row.voided_at) for row in rows], [(THU, -PRICE, None)])
        self.assertFalse(Entry.objects.filter(key=key("lesson:", span, MON)).exists())


class PriceTests(Case):
    """A lesson already written keeps its price (``set_personal_price``): an undo charges the day again at the voided
    row's own amount, and a moved lesson carries the price its old day was charged at."""

    def test_an_undo_after_a_price_change_ends_where_it_started(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        change = self.cancel(MON)
        ledger.set_personal_price(span.seat, 400_000, reason="sibling", by=None, today=WED)
        undone = L.undo(change, by=self.admin, today=WED)
        self.assertEqual(ledger.balance(account), before)
        rows = Entry.objects.filter(key=key("lesson:", span, MON)).order_by("id")
        self.assertEqual(
            [(row.amount, row.day, row.note, row.voided_at is None) for row in rows],
            [(-PRICE, MON, "Lesson 2026-12-07", False), (-PRICE, MON, "Lesson 2026-12-07", True)],
        )
        self.assertEqual((undone.money["charged"], undone.money["charged_amount"]), (1, PRICE))

    def test_a_move_after_a_price_change_keeps_the_lessons_own_price(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        ledger.set_personal_price(span.seat, 400_000, reason="sibling", by=None, today=WED)
        change = self.move(MON, TUE)
        self.assertEqual(Entry.objects.get(key=key("moved:", span, MON)).amount, -PRICE)
        self.assertEqual((ledger.balance(account), change.money["charged_amount"]), (before, PRICE))
        L.undo(change, by=self.admin, today=WED)
        self.assertEqual(ledger.balance(account), before)

    def test_a_move_undone_puts_its_lesson_back_at_what_the_moved_lesson_was_charged(self):
        # Moved before Wednesday came: no Wednesday row to void or copy. Thursday's tick charges the moved lesson.
        _, account, span = self.old_student(today=MON)
        change = self.move(WED, THU, today=MON)
        ledger.own_tick(THU)
        before = ledger.balance(account)
        ledger.set_personal_price(span.seat, 400_000, reason="sibling", by=None, today=THU)
        undone = L.undo(change, by=self.admin, today=THU)
        self.assertEqual(ledger.balance(account), before)
        rows = Entry.objects.filter(key=key("lesson:", span, WED))
        self.assertEqual(
            [(row.amount, row.day, row.note, row.voided_at is None) for row in rows],
            [(-PRICE, WED, "Lesson 2026-12-09", True)],
        )
        self.assertEqual(
            undone.money,
            {"voided": 1, "students": 1, "amount": PRICE, "charged": 1, "charged_amount": PRICE, "unfrozen": 0},
        )


class SpanLockTests(Case):
    """A lesson change and a tick billing the same span take turns on the span's row (``select_for_update``), so the
    second sees the first's work: a charge the tick wrote first is voided by the cancel that waited for it, and a cancel
    committed first keeps the tick off the day. The real two-connection race runs in ``tests_lesson_changes_race`` on
    PostgreSQL (SQLite takes no row locks)."""

    def locked(self, call):
        seen, real = [], QuerySet.select_for_update

        def spy(queryset, *args, **kwargs):
            seen.append(queryset.model)
            return real(queryset, *args, **kwargs)

        with mock.patch.object(QuerySet, "select_for_update", autospec=True, side_effect=spy):
            call()
        return seen

    def test_the_tick_and_a_change_both_lock_the_span(self):
        _, _, span = self.old_student(today=DEC_4)
        self.assertIn(Span, self.locked(lambda: ledger.bill_span(span, MON)))
        self.assertIn(Span, self.locked(lambda: self.cancel(MON, today=MON)))

    def test_a_charge_written_first_is_voided_by_the_cancel_after_it(self):
        _, _, span = self.old_student(today=DEC_4)
        ledger.bill_span(span, MON)
        self.cancel(MON, today=MON)
        ledger.own_tick(FRI)
        self.assertFalse(Entry.objects.filter(key=key("lesson:", span, MON), voided_at__isnull=True).exists())

    def test_a_cancel_committed_first_keeps_the_tick_off_the_day(self):
        _, _, span = self.old_student(today=DEC_4)
        self.cancel(MON, today=MON)
        ledger.bill_span(span, MON)
        ledger.own_tick(FRI)
        self.assertFalse(Entry.objects.filter(key=key("lesson:", span, MON)).exists())


class MoreChangeTests(Case):
    def test_moving_a_day_again_after_an_undo_reuses_its_key(self):
        _, account, span = self.old_student(today=FRI)
        before = ledger.balance(account)
        L.undo(self.move(MON, TUE, today=FRI), by=self.admin, today=FRI)
        self.move(MON, THU, today=FRI)
        rows = Entry.objects.filter(key=key("moved:", span, MON)).order_by("id")
        self.assertEqual([(row.day, row.voided_at is None) for row in rows], [(TUE, False), (THU, True)])
        self.assertEqual(ledger.balance(account), before)

    def test_a_holiday_after_a_class_cancel_the_same_day(self):
        _, account, span = self.old_student(today=WED)
        before = ledger.balance(account)
        cancel = self.cancel(MON)
        holiday = L.cancel(None, MON, "Independence Day", by=self.admin, today=WED)
        self.assertEqual(holiday.money["voided"], 0)  # this class's Monday was voided already
        L.undo(cancel, by=self.admin, today=WED)
        self.assertEqual(ledger.balance(account), before + PRICE)  # still a holiday: not charged again
        L.undo(holiday, by=self.admin, today=WED)
        self.assertEqual(ledger.balance(account), before)
        self.assertEqual(Entry.objects.filter(key=key("lesson:", span, MON), voided_at__isnull=True).count(), 1)

    def test_a_moved_lesson_landing_on_a_day_off_is_not_charged(self):
        # Past the rules (they refuse a move onto a holiday, and a holiday on a moved-in day), the ledger still skips it.
        _, _, span = self.old_student(today=WED)
        LessonChange.objects.create(classroom=self.room, day=MON, kind=LessonChange.Kind.MOVE, new_day=TUE, reason="r")
        LessonChange.objects.create(day=TUE, kind=LessonChange.Kind.CANCEL, reason="Closed")
        ledger.bill_span(span, WED)
        self.assertFalse(Entry.objects.filter(key=key("moved:", span, MON)).exists())
