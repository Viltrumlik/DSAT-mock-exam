from datetime import date, datetime

from django.test import TestCase, override_settings
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership as M
from lcup import seats
from lcup.attendance_guard import frozen_in_lcup, trial_in_lcup
from lcup.followups import trial_seats
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink
from users.models import User


def at(year, month, day, hour=10):
    return timezone.make_aware(datetime(year, month, day, hour, 0))


class SeatCase(TestCase):
    def setUp(self):
        owner = User.objects.create_user(None, password=None, username="owner", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="Junior G1", subject=Classroom.SUBJECT_MATH, teacher=owner, created_by=owner)
        self.group = LcupGroupLink.objects.create(
            lcup_group_id=10, name="Junior G1", classroom=self.room, status=GroupLinkStatus.CONFIRMED,
            snapshot={"cost": 500_000, "days": [1, 3, 5]},
        )
        self.user = User.objects.create_user(None, password=None, username="s", role="student")
        self.link = LcupStudentLink.objects.create(lcup_student_id=1, name="A Student", user=self.user)
        self.seat = M.objects.create(classroom=self.room, user=self.user, role=M.ROLE_STUDENT)

    def lcup_seat(self, status="active", start=date(2026, 11, 2), left_at=None):
        return LcupMembership.objects.create(
            group=self.group, student=self.link, lcup_status=status, start_date=start, left_at=left_at
        )

    def fill(self):
        return seats.fill_from_lcup()


class FillFromLcupTests(SeatCase):
    def test_a_seat_takes_lc_ups_status_and_start_date(self):
        self.lcup_seat("trial", date(2026, 11, 9))
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual((self.seat.seat_status, self.seat.seat_start_date), ("trial", date(2026, 11, 9)))
        self.assertIsNone(self.seat.seat_left_on)

    def test_leaving_keeps_the_day(self):
        self.lcup_seat(left_at=at(2026, 11, 9))
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_left_on, date(2026, 11, 9))

    def test_coming_back_clears_the_day(self):
        row = self.lcup_seat(left_at=at(2026, 11, 9))
        self.fill()
        LcupMembership.objects.filter(pk=row.pk).update(left_at=None)
        self.fill()
        self.seat.refresh_from_db()
        self.assertIsNone(self.seat.seat_left_on)

    def test_the_class_takes_the_groups_price(self):
        self.fill()
        self.room.refresh_from_db()
        self.assertEqual(self.room.monthly_price, 500_000)

    def test_a_group_with_no_price_leaves_the_class_alone(self):
        Classroom.objects.filter(pk=self.room.pk).update(monthly_price=450_000)
        LcupGroupLink.objects.filter(pk=self.group.pk).update(snapshot={"days": [1, 3, 5]})
        self.fill()
        self.room.refresh_from_db()
        self.assertEqual(self.room.monthly_price, 450_000)

    def test_a_price_lc_up_set_to_zero_clears_the_class(self):
        Classroom.objects.filter(pk=self.room.pk).update(monthly_price=500_000)
        LcupGroupLink.objects.filter(pk=self.group.pk).update(snapshot={"cost": 0, "days": [1, 3, 5]})
        self.fill()
        self.room.refresh_from_db()
        self.assertIsNone(self.room.monthly_price)

    def test_an_unknown_status_changes_nothing(self):
        self.lcup_seat("paused")
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "active")

    def test_a_group_not_confirmed_is_not_followed(self):
        LcupGroupLink.objects.filter(pk=self.group.pk).update(status=GroupLinkStatus.SUGGESTED)
        self.lcup_seat("frozen")
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "active")

    def test_a_teachers_seat_is_left_alone(self):
        M.objects.filter(pk=self.seat.pk).update(role=M.ROLE_TA)
        self.lcup_seat("frozen")
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "active")

    def test_nothing_changed_writes_nothing(self):
        self.lcup_seat("trial")
        self.assertEqual(self.fill(), 2)
        self.assertEqual(self.fill(), 0)

    def test_filling_leaves_no_membership_audit_row(self):
        from classes.models_membership_audit import ClassroomMembershipEvent

        self.lcup_seat("frozen")
        before = ClassroomMembershipEvent.objects.count()
        self.fill()
        self.assertEqual(ClassroomMembershipEvent.objects.count(), before)


class DifferencesTests(SeatCase):
    def test_no_differences_after_filling(self):
        self.lcup_seat("frozen")
        self.fill()
        self.assertEqual(seats.differences(), [])

    def test_a_status_that_drifted_is_listed(self):
        self.lcup_seat("frozen")
        self.fill()
        M.objects.filter(pk=self.seat.pk).update(seat_status="active")
        self.assertEqual(seats.differences(), [f"{self.room.name}: A Student is frozen in lc-up, active here"])

    def test_a_start_date_that_drifted_is_listed(self):
        self.lcup_seat("active", date(2026, 11, 2))
        self.fill()
        M.objects.filter(pk=self.seat.pk).update(seat_start_date=date(2026, 11, 4))
        self.assertIn("start", seats.differences()[0])

    def test_someone_who_left_is_not_compared(self):
        self.lcup_seat("frozen", left_at=at(2026, 11, 9))
        self.assertEqual(seats.differences(), [])

    def test_a_member_with_no_seat_here_is_not_a_difference(self):
        M.objects.filter(pk=self.seat.pk).delete()
        self.lcup_seat("frozen")
        self.assertEqual(seats.differences(), [])


class DailyComparisonTests(SeatCase):
    def test_a_seat_that_drifted_reaches_the_comparison(self):
        from billing.shadow import compare
        from lcup.models import LcupSyncRun

        now = timezone.now()
        LcupSyncRun.objects.create(started_at=now, finished_at=now, ok=True)
        self.lcup_seat("frozen")
        self.fill()
        M.objects.filter(pk=self.seat.pk).update(seat_status="active")
        run = compare(now)
        self.assertIn("1 seats differ from lc-up", run.alerts[0])
        self.assertIn("A Student", run.alerts[0])


class UnpairedClassTests(SeatCase):
    """An admin can take a class back from lc-up, and then nothing writes its seats any more: a status copied
    earlier must not keep a student unmarkable in a class that is managed by hand."""

    def unpair(self):
        LcupGroupLink.objects.filter(pk=self.group.pk).update(status=GroupLinkStatus.IGNORED, classroom=None)

    @override_settings(LCUP_ENABLED=True)
    def test_a_copied_freeze_does_not_count_in_a_class_lc_up_no_longer_runs(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen")
        self.unpair()
        self.assertEqual(frozen_in_lcup(self.room), set())

    @override_settings(LCUP_ENABLED=True)
    def test_a_copied_trial_does_not_count_in_a_class_lc_up_no_longer_runs(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="trial")
        self.unpair()
        self.assertEqual(trial_seats(classroom=self.room), [])

    def test_the_next_sync_clears_what_it_copied(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen")
        self.unpair()
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "active")

    def test_a_group_lc_up_deleted_is_cleared_too(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen")
        LcupGroupLink.objects.filter(pk=self.group.pk).update(deleted_in_lcup_at=at(2026, 11, 9))
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "active")

    def test_a_class_lc_up_still_runs_keeps_its_seats(self):
        self.lcup_seat("frozen")
        self.fill()
        self.fill()
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.seat_status, "frozen")


class FrozenReaderTests(SeatCase):
    @override_settings(LCUP_ENABLED=True)
    def test_the_new_field_is_read(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen")
        self.assertEqual(frozen_in_lcup(self.room), {self.user.pk})

    @override_settings(LCUP_ENABLED=True)
    def test_lc_up_still_counts_before_the_sync_fills_it(self):
        self.lcup_seat("frozen")
        self.assertEqual(frozen_in_lcup(self.room), {self.user.pk})

    @override_settings(LCUP_ENABLED=False)
    def test_it_works_with_lc_up_gone(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen")
        self.assertEqual(frozen_in_lcup(self.room), {self.user.pk})

    @override_settings(LCUP_ENABLED=False)
    def test_lc_ups_copy_is_not_read_with_lc_up_gone(self):
        self.lcup_seat("frozen")
        self.assertEqual(frozen_in_lcup(self.room), set())

    def test_someone_removed_is_not_frozen(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="frozen", status=M.STATUS_REMOVED)
        self.assertEqual(frozen_in_lcup(self.room), set())


class TrialReaderTests(SeatCase):
    @override_settings(LCUP_ENABLED=True)
    def test_one_seat_is_listed_once_when_both_sources_know_it(self):
        self.lcup_seat("trial", date(2026, 11, 9))
        self.fill()
        self.assertEqual([seat.user_id for seat in trial_seats()], [self.user.pk])

    @override_settings(LCUP_ENABLED=True)
    def test_lc_up_still_counts_before_the_sync_fills_it(self):
        self.lcup_seat("trial", date(2026, 11, 9))
        self.assertEqual([seat.since for seat in trial_seats()], [date(2026, 11, 9)])

    @override_settings(LCUP_ENABLED=True)
    def test_a_trial_with_no_account_here_stays_listed(self):
        other = LcupStudentLink.objects.create(lcup_student_id=2, name="No Account")
        LcupMembership.objects.create(group=self.group, student=other, lcup_status="trial", start_date=date(2026, 11, 9))
        self.assertEqual([(seat.name, seat.user_id) for seat in trial_seats()], [("No Account", None)])

    @override_settings(LCUP_ENABLED=False)
    def test_it_works_with_lc_up_gone(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="trial", seat_start_date=date(2026, 11, 9))
        self.assertEqual([seat.since for seat in trial_seats(classroom=self.room)], [date(2026, 11, 9)])

    @override_settings(LCUP_ENABLED=False)
    def test_the_register_sees_it_with_lc_up_gone(self):
        M.objects.filter(pk=self.seat.pk).update(seat_status="trial", seat_start_date=date(2026, 11, 9))
        self.assertEqual(trial_in_lcup(self.room, date(2026, 11, 10))[self.user.pk]["lessons_before"], 0)
