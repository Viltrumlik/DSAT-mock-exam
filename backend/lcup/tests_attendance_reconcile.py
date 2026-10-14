"""The rule that makes a register agree with lc-up for one group and day (lc-up Part 2).

History mode copies lc-up on every day lc-up recorded ("u yerda 100% aniqlikdagi davomat bor");
gap-fill mode, after the cutover, lets lc-up win and sends what lc-up lacks ("lc-up ustun, biz
faqat bo'shliqni to'ldiramiz"). Every date here is fixed: a scheduling test must not read the clock.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from lcup.attendance import apply_day, lcup_record, ours_status, plan_day
from lcup.models import GroupLinkStatus, LcupAttendancePush, LcupGroupLink, LcupStudentLink
from rewards.models import PointAward
from users.models import User

DAY = date(2026, 10, 12)  # a Monday
M = ClassroomMembership
R = AttendanceRecord
KASAL = {"id": 3034, "title": "Kasal ", "color": "#f00"}


def row(student_id, *, present=True, late=False, reason=None, deleted=False, day=DAY):
    return {
        "id": student_id * 10, "date": day.isoformat(), "group_id": 10, "student_id": student_id,
        "present": present, "late": late, "reason": reason, "grade": None, "student_status": "active",
        "deleted_at": "2026-10-12 19:00:00" if deleted else None,
    }


def midnight(day):
    return timezone.make_aware(datetime.combine(day, time.min))


class ReconcileFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(
            name="Junior G21 | Math | Vali", subject="MATH", lesson_days="ODD", lesson_time="16:00",
            created_by=self.teacher, teacher=self.teacher,
        )
        self.link = LcupGroupLink.objects.create(
            lcup_group_id=10, name=self.room.name, classroom=self.room, status=GroupLinkStatus.CONFIRMED
        )
        self.s1 = self.learner("s1", 101)
        self.s2 = self.learner("s2", 102)

    def learner(self, username, lcup_id=None, *, seat=True, joined=None):
        user = User.objects.create_user(None, password=None, username=username, role="student")
        if lcup_id is not None:
            LcupStudentLink.objects.create(lcup_student_id=lcup_id, name=username, user=user)
        if seat:
            m = M.objects.create(classroom=self.room, user=user, role=M.ROLE_STUDENT)
            M.objects.filter(pk=m.pk).update(joined_at=joined or midnight(DAY - timedelta(days=30)))
        return user

    def session(self):
        return AttendanceSession.objects.filter(classroom=self.room, date=DAY).first()

    def mark(self, user, status, reason_id=None):
        s, _ = AttendanceSession.objects.get_or_create(classroom=self.room, date=DAY)
        return R.objects.create(session=s, student=user, status=status, lcup_reason_id=reason_id)

    def marks(self):
        s = self.session()
        return {} if s is None else {r.student_id: (r.status, r.lcup_reason_id) for r in s.records.all()}


class MappingTests(ReconcileFixture):
    def test_lcup_rows_read_as_our_four_statuses(self):
        self.assertEqual(ours_status(row(1)), (R.STATUS_PRESENT, None))
        self.assertEqual(ours_status(row(1, late=True)), (R.STATUS_LATE, None))
        self.assertEqual(ours_status(row(1, present=False)), (R.STATUS_ABSENT, None))
        self.assertEqual(ours_status(row(1, present=False, reason=KASAL)), (R.STATUS_EXCUSED, 3034))

    def test_our_marks_read_as_lcup_records(self):
        self.assertEqual(lcup_record(self.mark(self.s1, R.STATUS_PRESENT), 101), {"student_id": 101, "status": "present"})
        rec = R(status=R.STATUS_LATE)
        self.assertEqual(lcup_record(rec, 7), {"student_id": 7, "status": "late"})
        self.assertEqual(lcup_record(R(status=R.STATUS_ABSENT), 7), {"student_id": 7, "status": "absent"})
        self.assertEqual(
            lcup_record(R(status=R.STATUS_EXCUSED, lcup_reason_id=3035), 7),
            {"student_id": 7, "status": "absent", "reason_id": 3035},
        )


class HistoryModeTests(ReconcileFixture):
    def test_a_recorded_day_is_copied_and_the_register_finalized(self):
        plan = plan_day(self.link, DAY, [row(101), row(102, present=False, reason=KASAL)], gap_fill=False)
        counts = apply_day(plan)
        self.assertEqual(self.marks(), {self.s1.pk: (R.STATUS_PRESENT, None), self.s2.pk: (R.STATUS_EXCUSED, 3034)})
        self.assertEqual(self.session().status, AttendanceSession.STATUS_FINALIZED)
        self.assertEqual((counts["att_registers_created"], counts["att_marks_added"]), (1, 2))

    def test_a_differing_mark_takes_lcups(self):
        self.mark(self.s1, R.STATUS_ABSENT)
        counts = apply_day(plan_day(self.link, DAY, [row(101, late=True)], gap_fill=False))
        self.assertEqual(self.marks()[self.s1.pk], (R.STATUS_LATE, None))
        self.assertEqual(counts["att_marks_changed"], 1)

    def test_a_mark_that_already_agrees_is_not_saved_again(self):
        rec = self.mark(self.s1, R.STATUS_PRESENT)
        before = R.objects.get(pk=rec.pk).marked_at
        plan = plan_day(self.link, DAY, [row(101)], gap_fill=False)
        self.assertEqual(plan.mirror, {})
        apply_day(plan)
        self.assertEqual(R.objects.get(pk=rec.pk).marked_at, before)

    def test_on_a_recorded_day_our_extra_marks_go(self):
        stray = self.learner("stray")  # not lc-up's
        self.mark(stray, R.STATUS_PRESENT)
        self.mark(self.s2, R.STATUS_ABSENT)  # lc-up's student, but lc-up did not list them that day
        counts = apply_day(plan_day(self.link, DAY, [row(101)], gap_fill=False))
        self.assertEqual(set(self.marks()), {self.s1.pk})
        self.assertEqual(counts["att_marks_deleted"], 2)

    def test_a_day_lcup_never_recorded_is_left_alone(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        plan = plan_day(self.link, DAY, [row(101, deleted=True)], gap_fill=False)
        self.assertFalse(plan.recorded)
        apply_day(plan)
        self.assertEqual(self.marks(), {self.s1.pk: (R.STATUS_PRESENT, None)})
        self.assertEqual(self.session().status, AttendanceSession.STATUS_OPEN)

    def test_rows_of_students_with_no_account_here_are_skipped(self):
        apply_day(plan_day(self.link, DAY, [row(101), row(999)], gap_fill=False))
        self.assertEqual(set(self.marks()), {self.s1.pk})

    def test_a_student_with_no_seat_gets_a_removed_one_dated_to_the_lesson(self):
        gone = self.learner("gone", 103, seat=False)
        apply_day(plan_day(self.link, DAY, [row(103)], gap_fill=False))
        seat = M.objects.get(classroom=self.room, user=gone)
        self.assertEqual((seat.status, seat.role, timezone.localdate(seat.joined_at)), (M.STATUS_REMOVED, M.ROLE_STUDENT, DAY))
        self.assertEqual(self.marks()[gone.pk], (R.STATUS_PRESENT, None))

    def test_a_later_join_date_moves_back_so_the_mark_counts_and_pays(self):
        late_joiner = self.learner("late", 104, joined=midnight(DAY + timedelta(days=5)))
        apply_day(plan_day(self.link, DAY, [row(104)], gap_fill=False))
        self.assertEqual(timezone.localdate(M.objects.get(classroom=self.room, user=late_joiner).joined_at), DAY)
        rec = R.objects.get(session=self.session(), student=late_joiner)
        self.assertEqual(PointAward.objects.get(source_type="attendance_record", source_id=rec.pk).xp, 5)


class GapFillModeTests(ReconcileFixture):
    def test_lcup_wins_where_it_has_a_mark(self):
        self.mark(self.s1, R.STATUS_ABSENT)
        plan = plan_day(self.link, DAY, [row(101)], gap_fill=True)
        self.assertEqual((plan.mirror, plan.push), ({self.s1.pk: (R.STATUS_PRESENT, None)}, {}))

    def test_what_lcup_lacks_is_pushed_and_never_deleted(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        self.mark(self.s2, R.STATUS_EXCUSED, reason_id=3035)
        plan = plan_day(self.link, DAY, [row(101)], gap_fill=True)
        self.assertEqual(plan.push, {self.s2.pk: {"student_id": 102, "status": "absent", "reason_id": 3035}})
        self.assertEqual(plan.delete, set())

    def test_a_student_lcup_does_not_have_is_not_pushed(self):
        stray = self.learner("stray")
        self.mark(stray, R.STATUS_PRESENT)
        plan = plan_day(self.link, DAY, [], gap_fill=True)
        self.assertEqual((plan.push, plan.delete), ({}, set()))

    def test_nobody_is_pushed_twice(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        LcupAttendancePush.objects.create(
            group=self.link, date=DAY, state=LcupAttendancePush.STATE_SENT,
            records=[{"user_id": self.s2.pk, "student_id": 102, "status": "absent"}],
        )
        self.assertEqual(plan_day(self.link, DAY, [], gap_fill=True).push, {})

    def test_lcup_deleting_what_we_sent_deletes_ours(self):
        self.mark(self.s2, R.STATUS_ABSENT)
        LcupAttendancePush.objects.create(
            group=self.link, date=DAY, state=LcupAttendancePush.STATE_SENT,
            records=[{"user_id": self.s2.pk, "student_id": 102, "status": "absent"}],
        )
        plan = plan_day(self.link, DAY, [row(102, present=False, deleted=True)], gap_fill=True)
        self.assertEqual(plan.delete, {self.s2.pk})
        apply_day(plan)
        self.assertNotIn(self.s2.pk, self.marks())

    def test_a_register_with_something_to_push_is_finalized(self):
        self.mark(self.s1, R.STATUS_PRESENT)
        apply_day(plan_day(self.link, DAY, [], gap_fill=True))
        self.assertEqual(self.session().status, AttendanceSession.STATUS_FINALIZED)
