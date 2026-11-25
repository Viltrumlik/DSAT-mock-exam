"""A lesson day cancelled or moved, and a centre holiday (owner, 2026-11-25): the rules of ``classes.lesson_changes``.

December 2026: Monday 7, Tuesday 8, Wednesday 9, Thursday 10, Friday 11. The class here is ODD, so it meets on
Mon/Wed/Fri and never on a Tuesday. Today is fixed at Monday 7 December and passed in, never read from the clock.
"""

from datetime import date, datetime, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing.tests_seat_class import make_room
from classes import attendance_auto
from classes import lesson_changes as L
from classes.models_attendance import AttendanceSession
from classes.models_lesson_changes import LessonChange

User = get_user_model()

TODAY = date(2026, 12, 7)
MON, TUE, WED, THU, FRI = (date(2026, 12, d) for d in (7, 8, 9, 10, 11))
SUN = date(2026, 12, 13)
HOST = "admin.mastersat.uz"


def at(day: date, hour: int) -> datetime:
    """An aware moment on the school's clock."""
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour))


class Case(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.room = make_room()  # ODD: Mon/Wed/Fri

    def cancel(self, day=MON, reason="Teacher ill", *, room=None, today=TODAY):
        return L.cancel(room or self.room, day, reason, by=self.admin, today=today)

    def holiday(self, day=TUE, reason="Independence Day", *, today=TODAY):
        return L.cancel(None, day, reason, by=self.admin, today=today)

    def move(self, day=MON, new_day=TUE, reason="Teacher at a seminar", *, room=None, today=TODAY):
        return L.move(room or self.room, day, new_day, reason, by=self.admin, today=today)

    def refused(self, text):
        return self.assertRaisesMessage(L.ChangeRefused, text)


class ReasonTests(Case):
    def test_a_reason_is_required(self):
        for blank in ("", "   ", None):
            with self.refused("A lesson change needs a reason."):
                self.cancel(reason=blank)
        self.assertFalse(LessonChange.objects.exists())

    def test_the_reason_is_trimmed(self):
        self.assertEqual(self.cancel(reason="  Teacher ill \n").reason, "Teacher ill")

    def test_a_reason_is_at_most_300_characters(self):
        with self.refused("The reason is at most 300 characters."):
            self.cancel(reason="x" * 301)
        self.assertEqual(len(self.cancel(reason="x" * 300).reason), 300)


class WindowTests(Case):
    def test_a_day_from_31_back_to_60_ahead(self):
        # Both edges are Fridays, a lesson day of the class.
        self.assertEqual(self.cancel(TODAY - timedelta(days=31)).day, date(2026, 11, 6))
        self.assertEqual(self.cancel(TODAY + timedelta(days=60)).day, date(2027, 2, 5))

    def test_a_day_further_away_is_refused(self):
        for day in (date(2026, 11, 4), date(2027, 2, 8)):  # a Wednesday 33 days back, a Monday 63 ahead
            with self.refused("Only a day from 6 Nov to 5 Feb can be changed."):
                self.cancel(day)
        with self.refused("Only a day from 6 Nov to 5 Feb can be changed."):
            self.holiday(date(2027, 2, 9))

    def test_the_new_day_too(self):
        with self.refused("Only a day from 6 Nov to 5 Feb can be changed."):
            self.move(MON, date(2027, 2, 6))
        with self.refused("Only a day from 6 Nov to 5 Feb can be changed."):
            self.move(MON, date(2026, 11, 5))
        self.assertEqual(self.move(MON, date(2027, 2, 4)).new_day, date(2027, 2, 4))


class ClassDayTests(Case):
    def test_a_day_the_class_does_not_meet_is_refused(self):
        with self.refused("Junior G1 has no lesson on 8 Dec."):
            self.cancel(TUE)
        with self.refused("Junior G1 has no lesson on 13 Dec."):
            self.move(SUN, THU)

    def test_a_day_already_changed_is_refused(self):
        self.cancel(MON)
        with self.refused("Junior G1's lesson on 7 Dec was already changed. Undo that first."):
            self.cancel(MON)
        with self.refused("Junior G1's lesson on 7 Dec was already changed. Undo that first."):
            self.move(MON, TUE)

    def test_after_an_undo_the_day_can_be_changed_again(self):
        L.undo(self.cancel(MON), by=self.admin, today=TODAY)
        self.assertEqual(self.move(MON, TUE).kind, LessonChange.Kind.MOVE)
        self.assertEqual(LessonChange.objects.filter(classroom=self.room, day=MON).count(), 2)

    def test_another_class_is_not_held_back(self):
        other = make_room("Middle G2")
        self.cancel(MON)
        self.assertEqual(self.cancel(MON, room=other).classroom, other)

    def test_a_cancel_records_the_class_the_day_and_who(self):
        change = self.cancel(WED)
        self.assertEqual(
            (change.classroom, change.day, change.kind, change.new_day, change.created_by, change.undone_at),
            (self.room, WED, LessonChange.Kind.CANCEL, None, self.admin, None),
        )


class HolidayTests(Case):
    def test_a_holiday_has_no_class(self):
        change = self.holiday(TUE)
        self.assertEqual((change.classroom, change.day, change.kind), (None, TUE, LessonChange.Kind.CANCEL))

    def test_one_holiday_a_day(self):
        self.holiday(TUE)
        with self.refused("8 Dec is already a centre holiday."):
            self.holiday(TUE)

    def test_the_database_keeps_one_live_holiday_a_day(self):
        LessonChange.objects.create(day=TUE, kind=LessonChange.Kind.CANCEL, reason="a")
        with self.assertRaises(IntegrityError), transaction.atomic():
            LessonChange.objects.create(day=TUE, kind=LessonChange.Kind.CANCEL, reason="b")

    def test_a_holiday_undone_can_be_set_again(self):
        L.undo(self.holiday(TUE), by=self.admin, today=TODAY)
        self.holiday(TUE)
        self.assertEqual(LessonChange.objects.filter(classroom__isnull=True, day=TUE).count(), 2)

    def test_not_on_a_day_a_lesson_was_moved_to(self):
        self.move(MON, TUE)
        with self.refused("A lesson of Junior G1 was moved to 8 Dec. Undo that move first."):
            self.holiday(TUE)

    def test_a_class_cancel_on_a_holiday_is_refused(self):
        self.holiday(WED)
        with self.refused("9 Dec is a centre holiday already."):
            self.cancel(WED)

    def test_a_lesson_on_a_holiday_can_still_be_moved(self):
        self.holiday(WED)
        self.assertEqual(self.move(WED, THU).new_day, THU)


class MoveTests(Case):
    def test_a_move_records_the_new_day(self):
        change = self.move(MON, TUE)
        self.assertEqual((change.classroom, change.day, change.kind, change.new_day), (self.room, MON, "move", TUE))

    def test_the_new_day_is_another_day(self):
        with self.refused("Choose another day to move the lesson to."):
            self.move(MON, MON)

    def test_not_to_a_centre_holiday(self):
        self.holiday(TUE)
        with self.refused("8 Dec is a centre holiday."):
            self.move(MON, TUE)

    def test_not_to_a_day_the_class_already_meets(self):
        # One class has one register a day, so a second lesson on Wednesday would have nowhere to be marked.
        with self.refused("Junior G1 already has a lesson on 9 Dec. Choose a day it does not meet."):
            self.move(MON, WED)

    def test_not_to_a_day_another_of_its_lessons_was_moved_to(self):
        self.move(MON, TUE)
        with self.refused("Another lesson of Junior G1 was moved to 8 Dec already. Choose another day."):
            self.move(WED, TUE)

    def test_to_a_sunday(self):
        self.assertEqual(self.move(FRI, SUN).new_day, SUN)


class UndoTests(Case):
    def test_undo_keeps_who_and_when(self):
        change = self.cancel(MON)
        other = User.objects.create_user(None, password=None, username="desk", role="admin")
        undone = L.undo(change, by=other, today=TODAY)
        change.refresh_from_db()
        self.assertIsNotNone(change.undone_at)
        self.assertEqual((change.undone_by, undone.pk), (other, change.pk))
        self.assertEqual(LessonChange.objects.count(), 1)

    def test_only_a_live_change_is_undone(self):
        change = self.cancel(MON)
        L.undo(change, by=self.admin, today=TODAY)
        with self.refused("This change was undone already."):
            L.undo(change, by=self.admin, today=TODAY)

    def test_a_day_now_outside_the_window_stays(self):
        change = self.cancel(MON)
        with self.refused("Only a day from"):
            L.undo(change, by=self.admin, today=TODAY + timedelta(days=32))


class ConstraintTests(Case):
    def create(self, **fields):
        with transaction.atomic():
            return LessonChange.objects.create(**{"day": MON, "reason": "r", **fields})

    def test_a_move_has_a_class_and_a_new_day(self):
        with self.assertRaises(IntegrityError):
            self.create(classroom=self.room, kind="move")
        with self.assertRaises(IntegrityError):
            self.create(kind="move", new_day=TUE)

    def test_a_cancel_has_no_new_day(self):
        with self.assertRaises(IntegrityError):
            self.create(classroom=self.room, kind="cancel", new_day=TUE)

    def test_one_live_change_per_class_and_day(self):
        first = self.create(classroom=self.room, kind="cancel")
        with self.assertRaises(IntegrityError):
            self.create(classroom=self.room, kind="move", new_day=TUE)
        LessonChange.objects.filter(pk=first.pk).update(undone_at=first.created_at)
        self.create(classroom=self.room, kind="move", new_day=TUE)

    def test_a_class_with_changes_on_record_cannot_be_deleted_even_undone_ones(self):
        L.undo(self.cancel(MON), by=self.admin, today=TODAY)
        with self.assertRaises(ProtectedError):
            self.room.delete()
        self.assertEqual(LessonChange.objects.filter(classroom=self.room).count(), 1)


class DayChangesTests(Case):
    def test_off_is_cancelled_moved_away_and_holidays_and_moved_maps_the_moves(self):
        self.cancel(WED)
        self.move(MON, TUE)
        self.holiday(FRI)
        changes = L.day_changes(self.room.pk, MON, SUN)
        self.assertEqual(changes.off, frozenset({MON, WED, FRI}))
        self.assertEqual(changes.moved, {MON: TUE})

    def test_another_classes_changes_and_undone_ones_do_not_count(self):
        other = make_room("Middle G2")
        self.cancel(MON, room=other)
        L.undo(self.cancel(WED), by=self.admin, today=TODAY)
        self.assertEqual(L.day_changes(self.room.pk, MON, SUN), L.DayChanges(frozenset(), {}))

    def test_only_the_days_inside_are_off(self):
        self.cancel(MON)
        self.holiday(TUE)
        self.assertEqual(L.day_changes(self.room.pk, TUE, SUN).off, frozenset({TUE}))

    def test_a_move_counts_when_either_of_its_days_is_inside(self):
        self.move(FRI, SUN)
        into = L.day_changes(self.room.pk, date(2026, 12, 12), SUN)
        self.assertEqual((into.off, into.moved), (frozenset(), {FRI: SUN}))
        away = L.day_changes(self.room.pk, MON, FRI)
        self.assertEqual((away.off, away.moved), (frozenset({FRI}), {FRI: SUN}))

    def test_no_class_sees_only_the_holidays(self):
        self.cancel(MON)
        self.holiday(TUE)
        self.assertEqual(L.day_changes(None, MON, SUN), L.DayChanges(frozenset({TUE}), {}))


class IsLessonDayTests(Case):
    def test_the_weekday_rule(self):
        self.assertEqual([L.is_lesson_day(self.room, day) for day in (MON, TUE, WED, SUN)], [True, False, True, False])

    def test_minus_the_days_off_plus_the_days_moved_in(self):
        self.cancel(WED)
        self.move(MON, TUE)
        self.holiday(FRI)
        self.assertEqual(
            [L.is_lesson_day(self.room, day) for day in (MON, TUE, WED, FRI)], [False, True, False, False]
        )


class MoneyHookTests(Case):
    """The money follows in the same call and the same transaction (``billing.lesson_money``)."""

    def test_a_change_applies_its_money_and_an_undo_reverts_it(self):
        with mock.patch("billing.lesson_money.apply", return_value={"voided": 0}) as apply:
            change = self.cancel(MON)
        apply.assert_called_once_with(change, today=TODAY, by=self.admin)
        self.assertEqual(change.money, {"voided": 0})
        with mock.patch("billing.lesson_money.revert", return_value={"voided": 1}) as revert:
            undone = L.undo(change, by=self.admin, today=TODAY)
        revert.assert_called_once()
        self.assertEqual((revert.call_args.kwargs, undone.money), ({"today": TODAY, "by": self.admin}, {"voided": 1}))
        self.assertIsNotNone(revert.call_args.args[0].undone_at)

    def test_money_that_fails_takes_the_change_back_with_it(self):
        with mock.patch("billing.lesson_money.apply", side_effect=RuntimeError("boom")), self.assertRaises(RuntimeError):
            self.move(MON, TUE)
        self.assertFalse(LessonChange.objects.exists())

    def test_a_refusal_touches_no_money(self):
        with mock.patch("billing.lesson_money.apply") as apply, self.assertRaises(L.ChangeRefused):
            self.cancel(TUE)
        apply.assert_not_called()


class RegisterCase(Case):
    def setUp(self):
        super().setUp()
        # A start date, so ``attendance_auto`` never floors the window at the day the row was created.
        self.room.lesson_time, self.room.start_date = "09:00", date(2026, 11, 2)
        self.room.save(update_fields=["lesson_time", "start_date"])


class DueRegisterTests(RegisterCase):
    """A register opens by itself on a lesson day (``attendance_auto``): not on a day off, and on a lesson moved in."""

    def due(self, now, backfill=2):
        return attendance_auto.due_lesson_dates(self.room, now=now, backfill_days=backfill)

    def test_no_register_on_a_day_called_off_or_a_holiday(self):
        self.cancel(MON)
        self.holiday(WED)
        self.assertEqual(self.due(at(WED, 12)), [])
        self.assertEqual(self.due(at(FRI, 12), backfill=4), [FRI])
        self.assertEqual(attendance_auto.ensure_sessions(self.room, now=at(FRI, 12), backfill_days=4)[0].date, FRI)
        self.assertEqual(list(AttendanceSession.objects.values_list("date", flat=True)), [FRI])

    def test_a_lesson_moved_in_opens_its_register_once_it_has_started(self):
        self.move(MON, TUE)
        self.assertEqual(self.due(at(TUE, 8)), [])
        self.assertEqual(self.due(at(TUE, 10)), [TUE])
        created = attendance_auto.ensure_sessions(self.room, now=at(TUE, 10), backfill_days=2)
        self.assertEqual([session.date for session in created], [TUE])

    def test_a_lesson_moved_beyond_the_window_waits_for_its_day(self):
        self.move(MON, SUN)
        self.assertEqual(self.due(at(WED, 12)), [WED])
        self.assertEqual(self.due(at(SUN, 12), backfill=0), [SUN])

    def test_an_undone_change_brings_the_day_back(self):
        L.undo(self.cancel(MON), by=self.admin, today=TODAY)
        self.assertEqual(self.due(at(MON, 12)), [MON])


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class SessionChangeTests(RegisterCase):
    """A register held on a day now off says why (``views_attendance``): the teacher's page shows it, not the marks."""

    def get(self, path):
        api = APIClient()
        api.force_authenticate(self.admin)
        with mock.patch("classes.attendance_auto.ensure_sessions", return_value=[]):
            return api.get(path, HTTP_HOST=HOST)

    def test_the_list_and_the_register_say_the_day_is_off(self):
        monday = AttendanceSession.objects.create(classroom=self.room, date=MON)
        AttendanceSession.objects.create(classroom=self.room, date=WED)
        friday = AttendanceSession.objects.create(classroom=self.room, date=FRI)
        self.cancel(MON)
        self.move(WED, THU)
        base = f"/api/classes/{self.room.pk}/attendance/sessions/"
        listed = {row["date"]: row["change"] for row in self.get(base).json()["sessions"]}
        self.assertEqual(
            listed,
            {
                "2026-12-07": {"kind": "cancel", "reason": "Teacher ill", "new_day": None},
                "2026-12-09": {"kind": "move", "reason": "Teacher at a seminar", "new_day": "2026-12-10"},
                "2026-12-11": None,
            },
        )
        self.assertEqual(
            self.get(f"{base}{monday.pk}/").json()["change"], {"kind": "cancel", "reason": "Teacher ill", "new_day": None}
        )
        self.assertIsNone(self.get(f"{base}{friday.pk}/").json()["change"])

    def test_a_centre_holiday_says_so_too(self):
        session = AttendanceSession.objects.create(classroom=self.room, date=FRI)
        self.holiday(FRI)
        detail = self.get(f"/api/classes/{self.room.pk}/attendance/sessions/{session.pk}/").json()
        self.assertEqual(detail["change"], {"kind": "cancel", "reason": "Independence Day", "new_day": None})
