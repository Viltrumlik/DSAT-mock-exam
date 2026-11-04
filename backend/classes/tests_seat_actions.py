"""Seat actions and what they do to the money. October 2026 on Mon/Wed/Fri is 13 lessons (2 5 7 9 12 14 16 19 21
23 26 28 30); on Tue/Thu/Sat it is 14. The price is 500,000, so 5 lessons left is 192,000."""

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from access.models import UserAccess
from billing import ledger
from billing.models import Account, EndReason, Entry, EntryKind, Seat, SeatPriceChange, SeatState, Span
from classes import seat_actions as S
from classes.models import Classroom, ClassroomMembership as M
from classes.models_membership_audit import ClassroomMembershipEvent as Event
from lcup.models import LcupStudentLink
from users import audience as A
from users.models import RoleChange

User = get_user_model()


def oct_(day):
    return date(2026, 10, day)


class SeatCase(TestCase):
    def setUp(self):
        self.boss = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = self.make_room()
        self.student = User.objects.create_user(
            None, password=None, username="ali", role="student", first_name="Ali", last_name="Valiyev", phone_number="998901112233"
        )

    def make_room(self, name="Junior G1", days="ODD", price=500_000, **fields):
        return Classroom.objects.create(
            name=name, subject=Classroom.SUBJECT_MATH, lesson_days=days, monthly_price=price, teacher=self.teacher,
            created_by=self.teacher, **fields,
        )

    def row(self, room=None, user=None):
        return M.objects.get(classroom=room or self.room, user=user or self.student)

    def seat(self, room=None, user=None):
        return Seat.objects.get(account__user=user or self.student, classroom=room or self.room)

    def balance(self, user=None):
        return ledger.balance(Account.objects.get(user=user or self.student))

    def live_charges(self, user=None):
        rows = Entry.objects.filter(account__user=user or self.student, voided_at__isnull=True, kind=EntryKind.CHARGE)
        return sorted(rows.values_list("amount", flat=True))

    def add(self, status="active", day=oct_(1), *, today=None, room=None, user=None):
        return S.add_student(room or self.room, user or self.student, status, day, today=today or day, by=self.boss)

    def freeze(self, day=oct_(19), today=None):
        return S.freeze(self.room, self.student, day, today=today or day, by=self.boss)

    def leave(self, day=oct_(19), today=None, *, room=None):
        return S.leave(room or self.room, self.student, day, today=today or day, by=self.boss)

    def refused(self, words):
        return self.assertRaisesMessage(S.SeatRefused, words)


class AddTests(SeatCase):
    def test_a_trial_writes_no_money(self):
        self.add("trial", oct_(19))
        self.assertEqual(self.balance(), 0)
        self.assertFalse(Span.objects.exists())
        self.assertEqual(self.seat().state, SeatState.TRIAL)
        row = self.row()
        self.assertEqual((row.status, row.seat_status, row.seat_start_date), (M.STATUS_ACTIVE, M.SEAT_TRIAL, oct_(19)))

    def test_an_active_seat_from_the_first_pays_the_whole_month(self):
        self.add("active", oct_(1))
        self.assertEqual(self.balance(), -500_000)
        self.assertEqual(self.row().seat_status, M.SEAT_ACTIVE)
        self.assertEqual(self.seat().state, SeatState.ACTIVE)

    def test_five_lessons_left_cost_192_000(self):
        self.add("active", oct_(21))
        self.assertEqual(self.balance(), -192_000)

    def test_odd_days_are_monday_wednesday_friday(self):
        self.add("trial", oct_(1))
        self.assertEqual(self.seat().days, [1, 3, 5])

    def test_even_days_are_tuesday_thursday_saturday(self):
        room = self.make_room("Middle G2", days="EVEN")
        self.add("active", oct_(19), room=room)
        self.assertEqual(self.seat(room).days, [2, 4, 6])
        self.assertEqual(self.balance(), -214_000)  # 20 22 24 27 29 31 of 14

    def test_a_student_with_no_ledger_account_gets_one(self):
        self.add("trial", oct_(1))
        account = Account.objects.get(user=self.student)
        self.assertIsNone(account.lcup_student_id)
        self.assertEqual((account.name, account.phone), ("Ali Valiyev", "998901112233"))

    def test_an_account_they_already_have_is_used(self):
        account = Account.objects.create(user=self.student, name="From lc-up", lcup_student_id=5)
        self.add("trial", oct_(1))
        self.assertEqual(self.seat().account, account)
        self.assertEqual(Account.objects.count(), 1)

    def test_the_seat_found_is_the_one_linked_to_the_class(self):
        account = Account.objects.create(user=self.student, name="From lc-up", lcup_student_id=5)
        seat = Seat.objects.create(
            account=account, group_name="G1", lcup_group_id=10, classroom=self.room, price=500_000, days=[1, 3, 5], state=SeatState.LEFT
        )
        self.add("active", oct_(21))
        self.assertEqual(self.seat(), seat)
        self.assertEqual(Seat.objects.count(), 1)
        self.assertEqual(self.balance(), -192_000)

    def test_joining_grants_the_class_subject(self):
        self.add("trial", oct_(1))
        self.assertTrue(UserAccess.objects.filter(user=self.student, subject="math", classroom=self.room).exists())

    def test_the_join_goes_through_the_audit(self):
        self.add("trial", oct_(1))
        self.assertTrue(Event.objects.filter(classroom=self.room, student=self.student, action=Event.ACTION_ADDED).exists())

    def test_someone_who_left_comes_back_on_the_same_row(self):
        self.add("active", oct_(1))
        self.leave(oct_(9))
        self.add("active", oct_(21), today=oct_(21))
        row = self.row()
        self.assertEqual((row.status, row.seat_left_on, row.seat_start_date), (M.STATUS_ACTIVE, None, oct_(21)))
        self.assertTrue(Event.objects.filter(student=self.student, action=Event.ACTION_REINSTATED).exists())
        self.assertEqual(M.objects.filter(classroom=self.room, user=self.student).count(), 1)
        self.assertEqual(Seat.objects.count(), 1)
        # 2 5 7 9 = 154,000 then 21 23 26 28 30 = 192,000
        self.assertEqual(self.balance(), -346_000)

    def test_a_ledger_seat_still_running_is_ended_rather_than_doubled(self):
        self.add("active", oct_(1))
        M.objects.filter(classroom=self.room, user=self.student).update(status=M.STATUS_REMOVED)  # an old roster path
        self.add("active", oct_(21), today=oct_(21))
        self.assertEqual(self.seat().spans.filter(end__isnull=True).count(), 1)
        # Up to 20 Oct = 2..19 = 8 lessons = 308,000, then 192,000.
        self.assertEqual(self.balance(), -500_000)

    def test_a_class_with_no_price_refuses_a_paid_seat(self):
        room = self.make_room("Free", price=None)
        with self.refused("no monthly price"):
            self.add("active", oct_(1), room=room)
        self.assertFalse(M.objects.filter(classroom=room, user=self.student).exists())

    def test_a_price_of_nothing_is_no_price(self):
        room = self.make_room("Free", price=0)
        with self.refused("no monthly price"):
            self.add("active", oct_(1), room=room)

    def test_a_class_with_no_lesson_days_refuses_a_paid_seat(self):
        room = self.make_room("Nodays", days="")
        with self.refused("no lesson days"):
            self.add("active", oct_(1), room=room)

    def test_a_trial_needs_neither(self):
        room = self.make_room("Free", price=None, days="")
        self.add("trial", oct_(1), room=room)
        self.assertEqual(self.row(room).seat_status, M.SEAT_TRIAL)

    def test_clicking_twice_adds_once(self):
        self.add("active", oct_(1))
        with self.refused("already in"):
            self.add("active", oct_(1))
        self.assertEqual(self.balance(), -500_000)
        self.assertEqual(Span.objects.count(), 1)

    def test_only_trial_or_active(self):
        with self.refused("trial or active"):
            self.add("frozen", oct_(1))

    def test_an_archived_class_takes_nobody(self):
        room = self.make_room("Old", is_active=False)
        with self.refused("archived"):
            self.add("trial", oct_(1), room=room)

    def test_a_full_class_takes_nobody_new(self):
        room = self.make_room("Small", max_students=1)
        other = User.objects.create_user(None, password=None, username="b", role="student")
        self.add("trial", oct_(1), room=room, user=other)
        with self.refused("full"):
            self.add("trial", oct_(1), room=room)

    def test_someone_who_teaches_the_class_is_refused(self):
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_TA)
        with self.refused("staff"):
            self.add("trial", oct_(1))

    def test_a_staff_account_is_refused(self):
        with self.refused("student"):
            self.add("trial", oct_(1), user=self.teacher)

    def test_a_public_account_new_to_the_centre_is_refused(self):
        User.objects.filter(pk=self.student.pk).update(role="public_student")
        self.student.refresh_from_db()
        with self.refused("New student"):
            self.add("trial", oct_(1))
        self.assertFalse(M.objects.filter(user=self.student).exists())

    def test_a_date_years_away_is_a_slip_of_the_hand(self):
        with self.refused("a year"):
            self.add("active", date(2006, 10, 1), today=oct_(1))
        with self.refused("a year"):
            self.add("active", date(2062, 10, 1), today=oct_(1))

    def test_a_start_next_week_is_fine(self):
        self.add("active", oct_(21), today=oct_(14))
        self.assertEqual(self.balance(), -192_000)


class ActivateTests(SeatCase):
    def activate(self, day=oct_(21), today=None):
        return S.activate(self.room, self.student, day, today=today or day, by=self.boss)

    def test_a_trial_starts_paying_from_the_date(self):
        self.add("trial", oct_(14))
        self.activate()
        self.assertEqual(self.balance(), -192_000)
        row = self.row()
        self.assertEqual((row.seat_status, row.seat_start_date), (M.SEAT_ACTIVE, oct_(21)))
        self.assertEqual(self.seat().state, SeatState.ACTIVE)

    def test_clicking_twice_charges_once(self):
        self.add("trial", oct_(14))
        self.activate()
        with self.refused("not on trial"):
            self.activate()
        self.assertEqual(self.balance(), -192_000)

    def test_someone_active_is_not_on_trial(self):
        self.add("active", oct_(1))
        with self.refused("not on trial"):
            self.activate()

    def test_someone_who_left_is_refused(self):
        self.add("trial", oct_(14))
        self.leave(oct_(14))
        with self.refused("left"):
            self.activate()

    def test_someone_never_here_is_refused(self):
        with self.refused("not in this group"):
            self.activate()

    def test_a_class_with_no_price_refuses(self):
        room = self.make_room("Free", price=None)
        self.add("trial", oct_(14), room=room)
        with self.refused("no monthly price"):
            S.activate(room, self.student, oct_(21), today=oct_(21), by=self.boss)
        self.assertEqual(self.row(room).seat_status, M.SEAT_TRIAL)

    def test_the_price_is_the_classs_now(self):
        room = self.make_room("Late", price=None)
        self.add("trial", oct_(14), room=room)
        Classroom.objects.filter(pk=room.pk).update(monthly_price=260_000)
        room.refresh_from_db()
        S.activate(room, self.student, oct_(21), today=oct_(21), by=self.boss)
        self.assertEqual(self.balance(), -100_000)  # 260,000 x 5 / 13

    def test_the_history_says_who(self):
        self.add("trial", oct_(14))
        self.activate()
        event = Event.objects.get(student=self.student, action=Event.ACTION_STATUS_CHANGED)
        self.assertEqual(event.actor, self.boss)
        self.assertIn("Activated from 2026-10-21", event.note)


class FreezeAndReturnTests(SeatCase):
    def come_back(self, day=oct_(26), today=None):
        return S.return_seat(self.room, self.student, day, today=today or day, by=self.boss)

    def test_a_freeze_pays_up_to_the_date(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        self.assertEqual(self.balance(), -308_000)  # 8 of 13
        self.assertEqual(self.row().seat_status, M.SEAT_FROZEN)
        self.assertEqual(self.row().status, M.STATUS_ACTIVE)
        self.assertEqual(self.seat().state, SeatState.FROZEN)
        self.assertEqual(self.seat().spans.get().ended_by, EndReason.FREEZE)

    def test_nothing_is_charged_in_the_months_between(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), -308_000)

    def test_a_return_pays_from_the_date(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        self.come_back(oct_(26))
        self.assertEqual(self.balance(), -423_000)  # and 26 28 30 = 115,000
        row = self.row()
        self.assertEqual((row.seat_status, row.seat_start_date), (M.SEAT_ACTIVE, oct_(26)))
        self.assertEqual(self.seat().state, SeatState.ACTIVE)

    def test_a_return_in_a_later_month_pays_the_part_from_the_date(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        self.come_back(date(2026, 11, 23), today=date(2026, 11, 23))  # 23 25 27 30 of 13 in November
        self.assertEqual(self.balance(), -308_000 - 154_000)

    def test_clicking_freeze_twice_is_refused(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        with self.refused("already frozen"):
            self.freeze(oct_(19))
        self.assertEqual(self.balance(), -308_000)

    def test_a_trial_has_nothing_to_freeze(self):
        self.add("trial", oct_(1))
        with self.refused("on trial"):
            self.freeze()

    def test_someone_who_left_cannot_be_frozen(self):
        self.add("active", oct_(1))
        self.leave(oct_(12))
        with self.refused("left"):
            self.freeze()

    def test_a_freeze_cannot_be_in_the_future(self):
        self.add("active", oct_(1))
        with self.refused("later than today"):
            self.freeze(oct_(21), today=oct_(19))

    def test_a_freeze_cannot_be_before_the_seat_began(self):
        self.add("active", oct_(12))
        with self.refused("began"):
            self.freeze(oct_(5), today=oct_(19))

    def test_a_member_the_ledger_never_billed_is_frozen_with_no_money(self):
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        self.freeze(oct_(19))
        self.assertEqual(self.row().seat_status, M.SEAT_FROZEN)
        self.assertFalse(Entry.objects.exists())

    def test_clicking_return_twice_charges_once(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        self.come_back(oct_(26))
        with self.refused("not frozen"):
            self.come_back(oct_(26))
        self.assertEqual(self.balance(), -423_000)

    def test_someone_active_cannot_return(self):
        self.add("active", oct_(1))
        with self.refused("not frozen"):
            self.come_back()

    def test_a_return_must_come_after_the_freeze(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        with self.refused("after"):
            self.come_back(oct_(19))

    def test_a_class_that_lost_its_price_refuses_a_return(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        Classroom.objects.filter(pk=self.room.pk).update(monthly_price=None)
        self.room.refresh_from_db()
        with self.refused("no monthly price"):
            self.come_back()

    def test_the_history_says_who_froze_them(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        event = Event.objects.get(student=self.student, action=Event.ACTION_STATUS_CHANGED)
        self.assertEqual(event.actor, self.boss)
        self.assertIn("Frozen from 2026-10-19", event.note)


class MoveTests(SeatCase):
    def setUp(self):
        super().setUp()
        self.other = self.make_room("Middle G2", days="EVEN")

    def move(self, to=None, day=oct_(19), today=None):
        return S.move(self.room, self.student, to or self.other, day, today=today or day, by=self.boss)

    def test_the_old_seat_ends_and_the_new_one_starts_on_the_date(self):
        self.add("active", oct_(1))
        self.move()
        self.assertEqual(self.balance(), -308_000 - 214_000)
        old, new = self.row(), self.row(self.other)
        self.assertEqual((old.status, old.seat_left_on), (M.STATUS_REMOVED, oct_(19)))
        self.assertEqual((new.status, new.seat_status, new.seat_start_date), (M.STATUS_ACTIVE, M.SEAT_ACTIVE, oct_(19)))
        self.assertEqual(self.seat().state, SeatState.LEFT)
        self.assertEqual(self.seat().spans.get().ended_by, EndReason.LEAVE)
        self.assertEqual(self.seat(self.other).state, SeatState.ACTIVE)

    def test_a_lesson_both_groups_hold_that_day_is_paid_once(self):
        """They sit one of the two lessons: the month adds up to its price, with no lesson charged twice."""
        same_days = self.make_room("Middle G3", days="ODD")
        self.add("active", oct_(1))
        self.move(to=same_days)
        self.assertEqual(self.balance(), -269_000 - 231_000)

    def test_it_goes_through_the_audit(self):
        self.add("active", oct_(1))
        self.move()
        self.assertTrue(Event.objects.filter(classroom=self.room, student=self.student, action=Event.ACTION_REMOVED).exists())
        self.assertTrue(Event.objects.filter(classroom=self.other, student=self.student, action=Event.ACTION_ADDED).exists())

    def test_a_trial_stays_a_trial_with_no_money(self):
        self.add("trial", oct_(12))
        self.move()
        self.assertEqual(self.row(self.other).seat_status, M.SEAT_TRIAL)
        self.assertEqual(self.balance(), 0)

    def test_a_frozen_seat_has_to_return_first(self):
        self.add("active", oct_(1))
        self.freeze(oct_(12))
        with self.refused("Return"):
            self.move()

    def test_a_personal_price_moves_with_them(self):
        self.add("active", oct_(1))
        ledger.set_personal_price(self.seat(), 400_000, reason="Agreed", by=self.boss, today=oct_(1))
        self.move()
        self.assertEqual(self.seat(self.other).personal_price, 400_000)
        self.assertEqual(self.balance(), -246_000 - 171_000)  # 8 of 13 and 6 of 14, of 400,000
        change = SeatPriceChange.objects.get(seat=self.seat(self.other))
        self.assertEqual((change.old_price, change.new_price, change.changed_by), (None, 400_000, self.boss))
        self.assertIn("Junior G1", change.reason)

    def test_clicking_twice_moves_once(self):
        self.add("active", oct_(1))
        self.move()
        with self.refused("left"):
            self.move()
        self.assertEqual(self.balance(), -522_000)

    def test_not_to_the_same_group(self):
        self.add("active", oct_(1))
        with self.refused("already in that group"):
            self.move(to=self.room)

    def test_not_into_a_group_they_are_in(self):
        self.add("active", oct_(1))
        self.add("active", oct_(1), room=self.other)
        with self.refused("already in"):
            self.move()
        self.assertEqual(self.row().status, M.STATUS_ACTIVE)

    def test_a_group_with_no_price_refuses_and_changes_nothing(self):
        free = self.make_room("Free", price=None)
        self.add("active", oct_(1))
        with self.refused("no monthly price"):
            self.move(to=free)
        self.assertEqual(self.row().status, M.STATUS_ACTIVE)
        self.assertEqual(self.seat().state, SeatState.ACTIVE)
        self.assertEqual(self.balance(), -500_000)

    def test_not_into_the_future(self):
        self.add("active", oct_(1))
        with self.refused("later than today"):
            self.move(day=oct_(21), today=oct_(19))

    def test_someone_not_here_is_refused(self):
        with self.refused("not in this group"):
            self.move()


class LeaveTests(SeatCase):
    def test_a_leave_pays_up_to_the_date_and_gives_the_rest_back(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertEqual(self.balance(), -308_000)
        row = self.row()
        self.assertEqual((row.status, row.seat_left_on), (M.STATUS_REMOVED, oct_(19)))
        self.assertEqual(self.seat().state, SeatState.LEFT)
        self.assertEqual(self.seat().spans.get().ended_by, EndReason.LEAVE)

    def test_five_lessons_left_come_back_as_192_000(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertEqual(Entry.objects.get(kind=EntryKind.CREDIT).amount, 192_000)

    def test_it_goes_through_the_audit(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertTrue(Event.objects.filter(classroom=self.room, student=self.student, action=Event.ACTION_REMOVED).exists())

    def test_a_trial_leaves_with_no_money(self):
        self.add("trial", oct_(12))
        self.leave(oct_(19))
        self.assertEqual(self.balance(), 0)
        self.assertEqual(self.row().status, M.STATUS_REMOVED)

    def test_a_frozen_seat_leaves_with_no_more_money(self):
        self.add("active", oct_(1))
        self.freeze(oct_(12))
        before = self.balance()
        self.leave(oct_(19))
        self.assertEqual(self.balance(), before)
        self.assertEqual(self.row().status, M.STATUS_REMOVED)

    def test_a_frozen_seat_cannot_leave_before_its_freeze(self):
        self.add("active", oct_(1))
        self.freeze(oct_(12))
        with self.refused("began"):
            self.leave(oct_(5), today=oct_(19))

    def test_clicking_twice_gives_back_once(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        with self.refused("left"):
            self.leave(oct_(19))
        self.assertEqual(self.balance(), -308_000)

    def test_a_leave_cannot_be_in_the_future(self):
        self.add("active", oct_(1))
        with self.refused("later than today"):
            self.leave(oct_(21), today=oct_(19))

    def test_a_leave_cannot_be_before_a_seat_that_has_begun(self):
        self.add("active", oct_(12))
        with self.refused("began"):
            self.leave(oct_(5), today=oct_(19))

    def test_someone_who_never_came_after_a_future_start_owes_nothing(self):
        self.add("active", oct_(26), today=oct_(19))
        self.leave(oct_(19))
        self.assertEqual(self.balance(), 0)

    def test_a_member_the_ledger_never_billed_leaves_with_no_account_made(self):
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        self.leave(oct_(19))
        self.assertFalse(Account.objects.exists())
        self.assertEqual(self.row().status, M.STATUS_REMOVED)


class FixDateTests(SeatCase):
    def fix(self, day, today=oct_(30)):
        return S.fix_date(self.room, self.student, day, today=today, by=self.boss)

    def test_an_active_seats_start_voids_and_rewrites(self):
        self.add("active", oct_(21))
        self.fix(oct_(26))
        self.assertEqual(self.balance(), -115_000)
        self.assertEqual(self.live_charges(), [-115_000])
        self.assertEqual(self.row().seat_start_date, oct_(26))
        voided = Entry.objects.get(amount=-192_000)
        self.assertIsNotNone(voided.voided_at)
        self.assertIn("boss", voided.void_reason)

    def test_a_freeze_date(self):
        self.add("active", oct_(1))
        self.freeze(oct_(19))
        self.fix(oct_(12))
        self.assertEqual(self.balance(), -192_000)  # 2 5 7 9 12
        self.assertEqual(self.seat().spans.get().end, oct_(12))

    def test_a_leaving_date(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.fix(oct_(26))
        self.assertEqual(self.balance(), -423_000)  # 11 of 13
        self.assertEqual(self.row().seat_left_on, oct_(26))

    def test_a_trial_has_only_its_date(self):
        self.add("trial", oct_(12))
        self.fix(oct_(14))
        self.assertEqual(self.row().seat_start_date, oct_(14))
        self.assertFalse(Entry.objects.exists())

    def test_the_same_date_again_changes_nothing(self):
        self.add("active", oct_(21))
        self.fix(oct_(26))
        rows = Entry.objects.count()
        self.fix(oct_(26))
        self.assertEqual(Entry.objects.count(), rows)
        self.assertEqual(self.balance(), -115_000)

    def test_a_returned_seats_start_stays_after_the_freeze(self):
        self.add("active", oct_(1))
        self.freeze(oct_(12))
        S.return_seat(self.room, self.student, oct_(19), today=oct_(19), by=self.boss)
        with self.refused("after"):
            self.fix(oct_(12))

    def test_a_freeze_date_stays_after_the_start(self):
        self.add("active", oct_(12))
        self.freeze(oct_(19))
        with self.refused("began"):
            self.fix(oct_(5))

    def test_someone_never_here_is_refused(self):
        with self.refused("not in this group"):
            self.fix(oct_(5))

    def test_a_leaving_date_for_a_seat_that_left_frozen_moves_no_money(self):
        self.add("active", oct_(1))
        self.freeze(oct_(12))
        self.leave(oct_(19))
        before = self.balance()
        self.fix(oct_(26))
        self.assertEqual(self.row().seat_left_on, oct_(26))
        self.assertEqual(self.balance(), before)


@override_settings(LCUP_ENABLED=True)
class LockTests(SeatCase):
    def locked(self):
        return self.assertRaises(S.SeatsLocked)

    def test_every_action_is_locked_while_lc_up_runs(self):
        other = self.make_room("Middle G2", days="EVEN")
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        kw = {"today": oct_(19), "by": self.boss}
        calls = [
            lambda: S.add_student(other, self.student, "active", oct_(19), **kw),
            lambda: S.activate(self.room, self.student, oct_(19), **kw),
            lambda: S.freeze(self.room, self.student, oct_(19), **kw),
            lambda: S.return_seat(self.room, self.student, oct_(19), **kw),
            lambda: S.move(self.room, self.student, other, oct_(19), **kw),
            lambda: S.leave(self.room, self.student, oct_(19), **kw),
            lambda: S.fix_date(self.room, self.student, oct_(19), **kw),
        ]
        for call in calls:
            with self.locked():
                call()
        self.assertFalse(Entry.objects.exists())
        self.assertEqual(self.row().seat_status, M.SEAT_ACTIVE)

    def test_it_opens_when_lc_up_is_switched_off(self):
        with override_settings(LCUP_ENABLED=False):
            self.add("active", oct_(1))
        self.assertEqual(self.balance(), -500_000)


class GroupTermsTests(SeatCase):
    def setUp(self):
        super().setUp()
        self.add("active", oct_(1))

    def change_price(self, price):
        Classroom.objects.filter(pk=self.room.pk).update(monthly_price=price)
        self.room.refresh_from_db()
        S.class_terms_changed(self.room)

    def test_a_new_price_reaches_the_seats(self):
        self.change_price(600_000)
        self.assertEqual(self.seat().price, 600_000)

    def test_written_rows_stay_and_it_counts_from_the_next_first(self):
        self.change_price(600_000)
        ledger.bill_open_spans(today=oct_(20))
        self.assertEqual(self.balance(), -500_000)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), -1_100_000)

    def test_a_personal_price_is_not_touched(self):
        ledger.set_personal_price(self.seat(), 400_000, reason="Agreed", by=self.boss, today=oct_(1))
        self.change_price(600_000)
        self.assertEqual(self.seat().personal_price, 400_000)
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), -800_000)

    def test_a_seat_that_left_keeps_what_it_had(self):
        self.leave(oct_(19))
        self.change_price(600_000)
        self.assertEqual(self.seat().price, 500_000)

    def test_new_weekdays_reach_the_seats(self):
        Classroom.objects.filter(pk=self.room.pk).update(lesson_days="EVEN")
        self.room.refresh_from_db()
        S.class_terms_changed(self.room)
        self.assertEqual(self.seat().days, [2, 4, 6])

    def test_a_price_taken_away_leaves_the_seats_as_they_were(self):
        self.change_price(None)
        self.assertEqual(self.seat().price, 500_000)


@override_settings(PUBLIC_SPLIT_ENABLED=True)
class LastGroupTests(SeatCase):
    def pay(self, amount, user=None):
        account = Account.objects.get(user=user or self.student)
        ledger.post(account, EntryKind.PAYMENT, amount, oct_(2), f"test:{account.pk}:{amount}")

    def after(self):
        self.student.refresh_from_db()
        return self.student.role, self.student.is_frozen, self.student.frozen_reason

    def test_with_no_debt_the_student_becomes_public(self):
        self.add("active", oct_(1))
        self.pay(308_000)
        self.leave(oct_(19))
        self.assertEqual(self.balance(), 0)
        self.assertEqual(self.after(), ("public_student", False, ""))
        change = RoleChange.objects.get(user=self.student)
        self.assertEqual((change.reason, change.source), (A.REASON_LEFT, A.SOURCE_SEATS))

    def test_with_debt_the_account_is_frozen_for_it(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("public_student", True, A.FROZEN_LCUP_DEBT))
        change = RoleChange.objects.get(user=self.student)
        self.assertEqual((change.reason, change.froze), (A.REASON_LEFT_WITH_DEBT, True))

    def test_the_lessons_given_back_count_towards_the_debt(self):
        self.add("active", oct_(1))
        self.pay(307_000)
        self.leave(oct_(19))
        self.assertEqual(self.balance(), -1_000)
        self.assertTrue(self.after()[1])

    def test_the_balance_is_the_ledgers_not_lc_ups(self):
        LcupStudentLink.objects.create(lcup_student_id=1, name="Ali", user=self.student, balance=-999_000)
        self.add("active", oct_(1))
        self.pay(308_000)
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("public_student", False, ""))

    def test_a_debt_in_the_ledger_counts_though_lc_up_shows_none(self):
        LcupStudentLink.objects.create(lcup_student_id=1, name="Ali", user=self.student, balance=0)
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertTrue(self.after()[1])

    def test_a_trial_who_leaves_owes_nothing(self):
        self.add("trial", oct_(12))
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("public_student", False, ""))

    def test_someone_the_ledger_never_billed_owes_nothing(self):
        M.objects.create(classroom=self.room, user=self.student, role=M.ROLE_STUDENT)
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("public_student", False, ""))

    def test_another_group_keeps_them_a_student(self):
        other = self.make_room("Middle G2", days="EVEN")
        self.add("active", oct_(1))
        self.add("trial", oct_(1), room=other)
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("student", False, ""))
        self.assertFalse(RoleChange.objects.exists())

    def test_a_frozen_seat_still_counts_as_a_group(self):
        other = self.make_room("Middle G2", days="EVEN")
        self.add("active", oct_(1))
        self.add("active", oct_(1), room=other)
        S.freeze(other, self.student, oct_(12), today=oct_(12), by=self.boss)
        self.leave(oct_(19))
        self.assertEqual(self.after()[0], "student")

    def test_an_archived_classs_seat_does_not_count_and_stops_being_paid(self):
        old = self.make_room("Old", days="EVEN")
        self.add("active", oct_(1), room=old)
        Classroom.objects.filter(pk=old.pk).update(is_active=False)
        self.add("active", oct_(1))
        self.pay(1_000_000)
        self.leave(oct_(19))
        self.assertEqual(self.after()[0], "public_student")
        self.assertEqual(self.row(old).status, M.STATUS_REMOVED)
        self.assertEqual(self.row(old).seat_left_on, oct_(19))
        self.assertEqual(self.seat(old).state, SeatState.LEFT)
        self.assertEqual(self.seat(old).spans.get().ended_by, EndReason.LEAVE)
        self.assertFalse(Span.objects.filter(end__isnull=True).exists())
        ledger.bill_open_spans(today=date(2026, 11, 1))
        self.assertEqual(self.balance(), 1_000_000 - 308_000 - 286_000)  # 8 of 14 in the archived class

    def test_a_move_is_never_leaving_the_last_group(self):
        other = self.make_room("Middle G2", days="EVEN")
        self.add("active", oct_(1))
        S.move(self.room, self.student, other, oct_(19), today=oct_(19), by=self.boss)
        self.assertEqual(self.after(), ("student", False, ""))

    def test_an_administrators_freeze_is_left_as_it_is(self):
        self.add("active", oct_(1))
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="")
        self.student.refresh_from_db()
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("public_student", True, ""))

    @override_settings(PUBLIC_SPLIT_ENABLED=False)
    def test_with_the_split_off_nobody_becomes_public(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.assertEqual(self.after(), ("student", False, ""))

    def test_a_returning_student_is_a_student_again(self):
        self.add("active", oct_(1))
        self.pay(308_000)
        self.leave(oct_(19))
        self.add("active", oct_(21), today=oct_(21))
        self.assertEqual(self.after(), ("student", False, ""))
        self.assertEqual(RoleChange.objects.first().reason, A.REASON_JOINED)
        self.assertEqual(RoleChange.objects.first().source, A.SOURCE_SEATS)

    def test_coming_back_lifts_the_debt_freeze(self):
        self.add("active", oct_(1))
        self.leave(oct_(19))
        self.add("trial", oct_(21), today=oct_(21))
        self.assertEqual(self.after(), ("student", False, ""))

    def test_coming_back_does_not_lift_an_administrators_freeze(self):
        self.add("active", oct_(1))
        User.objects.filter(pk=self.student.pk).update(is_frozen=True, frozen_reason="")
        self.student.refresh_from_db()
        self.leave(oct_(19))
        self.add("trial", oct_(21), today=oct_(21))
        self.assertEqual(self.after(), ("student", True, ""))

    def test_a_refused_leave_changes_no_role(self):
        self.add("active", oct_(1))
        with self.refused("later than today"):
            self.leave(oct_(21), today=oct_(19))
        self.assertEqual(self.after(), ("student", False, ""))
