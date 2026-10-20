from datetime import date, datetime
from io import StringIO

from django.core.management import call_command
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
    lesson_check,
    missing_seats,
    pending,
    send_lesson_checks,
    trial_seats,
)
from lcup.models import GroupLinkStatus, LcupGroupLink, LinkStatus
from lcup.testing import FollowupsFixtureMixin
from notifications.models import Notification
from users.models import User


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


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class LessonCheckTests(FollowupsFixtureMixin, TestCase):
    def test_everything_the_teacher_should_look_at_in_one_message(self):
        ali, bek = self.student("Ali", "Valiyev"), self.student("Bek", "Rahimov")
        self.student("Dilnoza", "Karimova")
        sardor = self.student("Sardor", "Nazarov")
        self.lcup_member("Sardor Nazarov", user=sardor, status="trial", since=date(2026, 10, 14))
        self.mark(date(2026, 10, 16), sardor, "PRESENT")   # the free lesson
        self.mark(self.MONDAY, ali, "PRESENT")
        self.mark(self.MONDAY, bek, "ABSENT")
        self.mark(self.MONDAY, sardor, "PRESENT")
        self.lcup_member("Jasur Toshmatov")
        check = lesson_check(self.room, self.MONDAY)
        self.assertEqual(check.title, "Middle G23 — check today's register")
        self.assertEqual(
            check.body,
            "Not marked: Dilnoza Karimova — mark them before 18:00. "
            "Absent: Bek Rahimov — if excused, set the reason before 18:00. "
            "Free trial used: Sardor Nazarov — send to the admin. "
            "Not on your list: Jasur Toshmatov — send to the admin.",
        )
        self.assertFalse(check.is_empty)

    def test_a_register_nobody_took(self):
        self.student("Ali", "Valiyev")
        self.assertEqual(lesson_check(self.room, self.MONDAY).body, "Register not taken yet — mark it before 18:00.")

    def test_a_clean_register_says_nothing(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_an_excused_absence_is_not_asked_about(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "EXCUSED")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_a_trial_student_on_the_free_lesson_is_not_sent_away(self):
        ali = self.student("Ali", "Valiyev")
        self.lcup_member("Ali Valiyev", user=ali, status="trial", since=self.MONDAY)
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_a_student_frozen_in_lc_up_is_not_unmarked(self):
        ali, frozen = self.student("Ali", "Valiyev"), self.student("Frozen", "One")
        self.lcup_member("Frozen One", user=frozen, status="frozen")
        self.mark(self.MONDAY, ali, "PRESENT")
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)

    def test_long_lists_are_cut_after_four_names(self):
        self.mark(self.MONDAY, self.student("Keep", "Present"), "PRESENT")
        for first in ("Aa", "Bb", "Cc", "Dd", "Ee", "Ff"):
            self.mark(self.MONDAY, self.student(first, "Absent"), "ABSENT")
        self.assertIn(
            "Absent: Aa Absent, Bb Absent, Cc Absent, Dd Absent +2 more — if excused",
            lesson_check(self.room, self.MONDAY).body,
        )

    def test_an_empty_class_says_nothing(self):
        self.assertTrue(lesson_check(self.room, self.MONDAY).is_empty)


def at(day, hour, minute):
    return timezone.make_aware(datetime(day.year, day.month, day.day, hour, minute))


@override_settings(LCUP_ENABLED=True, LCUP_ATTENDANCE_CHECKS_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class SendLessonChecksTests(FollowupsFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.bek = self.student("Bek", "Rahimov")
        self.mark(self.MONDAY, self.bek, "ABSENT")

    def sent(self):
        return Notification.objects.filter(event="ATTENDANCE_CHECK")

    def staff(self, username, role):
        user = User.objects.create_user(None, password=None, username=username, role="teacher", subject="math")
        ClassroomMembership.objects.create(classroom=self.room, user=user, role=role)
        return user

    def test_the_teacher_is_told_once_as_the_lesson_ends(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"classes": 1, "notified": 1})
        [row] = self.sent()
        self.assertEqual(row.recipient, self.teacher)
        self.assertEqual(row.category, "CLASSROOM")
        self.assertEqual(row.link_url, f"/classes/{self.room.pk}?tab=attendance")
        self.assertEqual(row.dedupe_key, f"attcheck:{self.room.pk}:2026-10-19")
        self.assertIn("Absent: Bek Rahimov", row.body)
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 10)), {"already_sent": 1})
        self.assertEqual(self.sent().count(), 1)

    def test_only_inside_the_half_hour_after_the_lesson(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 15, 55)), {})
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 31)), {})
        self.assertFalse(self.sent().exists())

    def test_not_on_a_day_the_class_does_not_meet(self):
        self.assertEqual(send_lesson_checks(now=at(date(2026, 10, 20), 16, 5)), {})

    def test_a_clean_register_sends_nothing(self):
        self.mark(self.MONDAY, self.bek, "PRESENT")
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"clean": 1})
        self.assertFalse(self.sent().exists())

    def test_every_teacher_of_the_class_and_no_assistant(self):
        second = self.staff("second", ClassroomMembership.ROLE_TEACHER)
        self.staff("helper", ClassroomMembership.ROLE_TA)
        send_lesson_checks(now=at(self.MONDAY, 16, 5))
        self.assertEqual(set(self.sent().values_list("recipient_id", flat=True)), {self.teacher.pk, second.pk})

    def test_a_class_that_has_not_started_yet_has_no_lesson_to_check(self):
        type(self.room).objects.filter(pk=self.room.pk).update(start_date=date(2026, 10, 26))
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {})
        self.assertFalse(self.sent().exists())

    def test_the_first_day_of_a_class_is_a_lesson(self):
        type(self.room).objects.filter(pk=self.room.pk).update(start_date=self.MONDAY)
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"classes": 1, "notified": 1})

    def test_a_class_whose_lesson_time_cannot_be_read_is_never_due(self):
        type(self.room).objects.filter(pk=self.room.pk).update(lesson_time="")
        for hour in (0, 12, 16, 18, 23):
            self.assertEqual(send_lesson_checks(now=at(self.MONDAY, hour, 5)), {})
        self.assertFalse(self.sent().exists())

    @override_settings(LCUP_ATTENDANCE_CHECKS_ENABLED=False)
    def test_nothing_while_the_switch_is_off(self):
        self.assertEqual(send_lesson_checks(now=at(self.MONDAY, 16, 5)), {"skipped": "off"})
        self.assertFalse(self.sent().exists())


@override_settings(LCUP_ENABLED=True, LCUP_FREE_TRIAL_LESSONS=1)
class PreviewCommandTests(FollowupsFixtureMixin, TestCase):
    def preview(self):
        out = StringIO()
        call_command("attendance_check_preview", "--day", "2026-10-19", stdout=out)
        return out.getvalue()

    def test_it_prints_each_class_as_if_its_lesson_had_ended_and_sends_nothing(self):
        self.mark(self.MONDAY, self.student("Bek", "Rahimov"), "ABSENT")
        text = self.preview()
        self.assertIn("Middle G23 — check today's register", text)
        self.assertIn("Absent: Bek Rahimov", text)
        self.assertIn("to: Tess Teacher", text)
        self.assertFalse(Notification.objects.filter(event="ATTENDANCE_CHECK").exists())

    def test_a_clean_class_is_shown_as_silent(self):
        self.mark(self.MONDAY, self.student("Ali", "Valiyev"), "PRESENT")
        self.assertIn("Middle G23: nothing to say — no notification", self.preview())

    def test_a_class_that_has_not_started_yet_is_not_listed(self):
        self.mark(self.MONDAY, self.student("Bek", "Rahimov"), "ABSENT")
        type(self.room).objects.filter(pk=self.room.pk).update(start_date=date(2026, 10, 26))
        self.assertEqual(self.preview().strip(), "No paired class meets on 2026-10-19.")

    def test_a_class_whose_lesson_time_cannot_be_read_is_not_listed_just_as_it_is_never_due(self):
        self.mark(self.MONDAY, self.student("Bek", "Rahimov"), "ABSENT")
        type(self.room).objects.filter(pk=self.room.pk).update(lesson_time="")
        self.assertEqual(self.preview().strip(), "No paired class meets on 2026-10-19.")
