from datetime import date, datetime

from django.test import TestCase, override_settings
from django.utils import timezone

from classes.models import ClassroomMembership
from lcup.followups import (
    REASON_IGNORED,
    REASON_NEEDS_REVIEW,
    REASON_NO_ACCOUNT,
    REASON_NOT_SEATED,
    STATE_CAME,
    STATE_NOT_YET,
    STATE_USED,
    missing_seats,
    pending,
    trial_seats,
)
from lcup.models import GroupLinkStatus, LcupGroupLink, LinkStatus
from lcup.testing import FollowupsFixtureMixin


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class TrialSeatTests(FollowupsFixtureMixin, TestCase):
    def test_lessons_are_the_ones_come_to_in_this_class_since_the_trial_began(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 9), ali, "PRESENT")   # before lc-up started the trial
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "ABSENT")   # not a lesson come to
        self.mark(date(2026, 10, 16), ali, "LATE")
        [seat] = trial_seats()
        self.assertEqual(seat.lesson_dates, (date(2026, 10, 12), date(2026, 10, 16)))
        self.assertEqual(seat.lessons, 2)
        self.assertEqual(seat.state, STATE_USED)
        self.assertEqual((seat.user_id, seat.classroom_id, seat.name), (ali.pk, self.room.pk, "Ali Valiyev"))

    def test_states_follow_the_free_trial(self):
        none, once, twice = self.student("No", "Show"), self.student("Came", "Once"), self.student("Came", "Twice")
        for user in (none, once, twice):
            self.lcup_member(f"{user.first_name} {user.last_name}", user=user, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), once, "PRESENT")
        self.mark(date(2026, 10, 12), twice, "PRESENT")
        self.mark(date(2026, 10, 14), twice, "PRESENT")
        states = {seat.user_id: seat.state for seat in trial_seats()}
        self.assertEqual(states, {none.pk: STATE_NOT_YET, once.pk: STATE_CAME, twice.pk: STATE_USED})

    @override_settings(LCUP_FREE_TRIAL_LESSONS=2)
    def test_the_free_trial_length_is_a_setting(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        self.assertEqual(trial_seats()[0].state, STATE_CAME)

    def test_before_counts_only_earlier_lessons(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertEqual(trial_seats(before=self.MONDAY)[0].lessons, 1)

    def test_a_missing_start_date_falls_back_to_when_lc_up_added_them(self):
        ali = self.student("Ali", "Valiyev")
        member = self.lcup_member("Ali Valiyev", user=ali, status="trial")
        member.joined_at = timezone.make_aware(datetime(2026, 10, 14, 10, 0))
        member.save(update_fields=["joined_at"])
        self.mark(date(2026, 10, 12), ali, "PRESENT")
        self.mark(date(2026, 10, 14), ali, "PRESENT")
        [seat] = trial_seats()
        self.assertEqual((seat.since, seat.lessons), (date(2026, 10, 14), 1))

    def test_only_live_trial_seats_of_paired_groups(self):
        self.lcup_member("Active One", user=self.student("Active", "One"), status="active")
        gone = self.lcup_member("Left One", user=self.student("Left", "One"), status="trial")
        gone.left_at = timezone.now()
        gone.save(update_fields=["left_at"])
        deleted = LcupGroupLink.objects.create(
            lcup_group_id=502, name="Old", status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at=timezone.now()
        )
        self.lcup_member("Old Group", status="trial", group=deleted)
        unpaired = LcupGroupLink.objects.create(lcup_group_id=503, name="Unpaired", status=GroupLinkStatus.SUGGESTED)
        self.lcup_member("Unpaired Group", status="trial", group=unpaired)
        self.assertEqual(trial_seats(), [])

    def test_a_trial_student_with_no_account_has_come_to_nothing_here(self):
        self.lcup_member("Jasur Toshmatov", status="trial", since=date(2026, 10, 12))
        [seat] = trial_seats()
        self.assertEqual((seat.user_id, seat.lessons, seat.state), (None, 0, STATE_NOT_YET))

    def test_classroom_narrows_to_one_class(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"), status="trial")
        self.assertEqual(len(trial_seats(classroom=self.room)), 1)
        other = type(self.room).objects.create(
            name="Other", subject="MATH", lesson_days="EVEN", created_by=self.teacher, teacher=self.teacher
        )
        self.assertEqual(trial_seats(classroom=other), [])

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_while_the_integration_is_off(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"), status="trial")
        self.assertEqual(trial_seats(), [])


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class MissingSeatTests(FollowupsFixtureMixin, TestCase):
    def test_a_seated_member_is_not_missing(self):
        self.lcup_member("Ali Valiyev", user=self.student("Ali", "Valiyev"))
        self.assertEqual(missing_seats(), [])

    def test_why_each_member_is_missing(self):
        self.lcup_member("Linked NoSeat", user=self.student("Linked", "NoSeat", seat=False))
        self.lcup_member("In Review", link_status=LinkStatus.NEEDS_REVIEW)
        self.lcup_member("Was Ignored", link_status=LinkStatus.IGNORED)
        self.lcup_member("Brand New")
        reasons = {seat.name: seat.reason for seat in missing_seats()}
        self.assertEqual(reasons, {
            "Linked NoSeat": REASON_NOT_SEATED,
            "In Review": REASON_NEEDS_REVIEW,
            "Was Ignored": REASON_IGNORED,
            "Brand New": REASON_NO_ACCOUNT,
        })

    def test_a_removed_seat_is_no_seat(self):
        ali = self.student("Ali", "Valiyev")
        ClassroomMembership.objects.filter(user=ali).update(status=ClassroomMembership.STATUS_REMOVED)
        self.lcup_member("Ali Valiyev", user=ali)
        self.assertEqual([seat.reason for seat in missing_seats()], [REASON_NOT_SEATED])

    def test_a_frozen_member_is_not_expected_on_the_list(self):
        self.lcup_member("Frozen One", status="frozen")
        self.assertEqual(missing_seats(), [])

    def test_a_trial_member_missing_is_listed_with_its_status(self):
        self.lcup_member("Jasur Toshmatov", status="trial", since=date(2026, 10, 19))
        [seat] = missing_seats()
        self.assertEqual((seat.lcup_status, seat.since, seat.classroom_id), ("trial", date(2026, 10, 19), self.room.pk))

    def test_pending_counts_what_waits_on_the_desk(self):
        came = self.student("Came", "Once")
        self.lcup_member("Came Once", user=came, status="trial", since=date(2026, 10, 12))
        self.mark(date(2026, 10, 12), came, "PRESENT")
        self.lcup_member("Not Yet", user=self.student("Not", "Yet"), status="trial")
        self.lcup_member("Brand New")
        self.assertEqual(pending(trial_seats(), missing_seats()), 2)

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_while_the_integration_is_off(self):
        self.lcup_member("Brand New")
        self.assertEqual(missing_seats(), [])
