"""A register may be written during its lesson and for two hours after — and never later.

The incident this suite pins down happened on 2026-08-26. A student was added to two classes
at 09:07 and, within two minutes, marked PRESENT across both of their back-registers: sixteen
lessons, every one of them held before he had a membership row. Attendance pays the moment a
mark is saved, so that was 80 points and 80 XP, and it put him top of the school leaderboard.

Three separate things had to be true for that to work, and each has its own section here:

  * a register for any past date could still be written;
  * the roster offered for a lesson was *today's* roster, not the lesson's;
  * the reward hook paid whatever the register said, without asking whether the student had
    been in the class that day.

Every time is passed in as ``now`` rather than read from the clock. A window test that
computes "two hours ago" from ``timezone.now()`` passes in the morning and fails after tea.

2026-06-01 is a Monday, so an ODD class (Mon/Wed/Fri) meets on the 1st, 3rd and 5th.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes import attendance_window
from classes.lesson_schedule import lesson_interval, parse_lesson_end_time
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from rewards import constants as reward_const
from rewards.models import PointAward

User = get_user_model()

MONDAY = date(2026, 6, 1)
WEDNESDAY = date(2026, 6, 3)


def at(day: date, hour: int, minute: int = 0):
    """An aware datetime in the school's timezone."""
    return timezone.make_aware(
        datetime.combine(day, datetime.min.time()).replace(hour=hour, minute=minute),
        timezone.get_current_timezone(),
    )


# ── The window itself ─────────────────────────────────────────────────────────

class LessonEndTimeTests(TestCase):
    """``lesson_time`` is free text and production proves it. 27 classrooms name only a
    start; two name a range; one is blank."""

    def test_an_explicit_range_gives_its_own_end(self):
        self.assertEqual(parse_lesson_end_time("16:00-18:00").hour, 18)

    def test_a_bare_start_runs_for_the_default_length(self):
        self.assertEqual(parse_lesson_end_time("14:00").hour, 16)

    def test_a_range_with_a_broken_end_falls_back_to_the_default_length(self):
        """Losing the end entirely would make the window close at the lesson's start."""
        self.assertEqual(parse_lesson_end_time("14:00 - soon").hour, 16)

    def test_blank_has_no_end(self):
        self.assertIsNone(parse_lesson_end_time(""))
        self.assertIsNone(parse_lesson_end_time("whenever"))

    def test_an_end_past_midnight_rolls_into_the_next_day(self):
        """A plain ``time`` cannot say 25:00, so the interval has to do the rolling — else a
        23:00 lesson would end two hours *before* it started and be locked from the off."""
        classroom = Classroom(lesson_time="23:00", lesson_days=Classroom.DAYS_ODD)
        starts_at, ends_at = lesson_interval(classroom, MONDAY)
        self.assertEqual(ends_at - starts_at, timedelta(hours=2))
        self.assertEqual(timezone.localdate(ends_at), MONDAY + timedelta(days=1))


class MarkingWindowTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("win_owner@t.com", "secret123", role=C.ROLE_ADMIN)

    def make_class(self, lesson_time="14:00"):
        return Classroom.objects.create(
            name="Win", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            lesson_time=lesson_time, start_date=MONDAY, created_by=self.owner,
        )

    def state(self, classroom, day, hour, minute=0):
        return attendance_window.marking_state(classroom, day, now=at(day, hour, minute))

    def test_the_school_s_own_example(self):
        """"A lesson from 2 until 4 can be marked until 6." Their words, their numbers."""
        classroom = self.make_class("14:00-16:00")
        self.assertEqual(self.state(classroom, MONDAY, 13), attendance_window.STATE_PENDING)
        self.assertEqual(self.state(classroom, MONDAY, 15), attendance_window.STATE_OPEN)
        self.assertEqual(self.state(classroom, MONDAY, 17, 59), attendance_window.STATE_OPEN)
        self.assertEqual(self.state(classroom, MONDAY, 18, 1), attendance_window.STATE_LOCKED)

    def test_a_bare_start_time_gets_the_same_shape(self):
        """"14:00" means the same lesson as "14:00-16:00" — the school just wrote less."""
        classroom = self.make_class("14:00")
        self.assertEqual(self.state(classroom, MONDAY, 17, 59), attendance_window.STATE_OPEN)
        self.assertEqual(self.state(classroom, MONDAY, 18, 1), attendance_window.STATE_LOCKED)

    def test_the_lesson_s_own_start_is_inside_the_window(self):
        classroom = self.make_class("14:00")
        self.assertEqual(self.state(classroom, MONDAY, 14, 0), attendance_window.STATE_OPEN)

    def test_yesterday_is_locked_however_early_you_ask(self):
        """The whole point. Backdating is not a slow door, it is a shut one."""
        classroom = self.make_class("14:00")
        state = attendance_window.marking_state(
            classroom, MONDAY, now=at(MONDAY + timedelta(days=1), 0, 1)
        )
        self.assertEqual(state, attendance_window.STATE_LOCKED)

    def test_an_unreadable_lesson_time_falls_back_to_the_lesson_s_own_day(self):
        """One production classroom has this blank. Locking it out of attendance entirely
        would be a worse bug than the one being fixed — but it still cannot reach yesterday."""
        classroom = self.make_class("")
        self.assertEqual(self.state(classroom, MONDAY, 0, 0), attendance_window.STATE_OPEN)
        self.assertEqual(self.state(classroom, MONDAY, 23, 59), attendance_window.STATE_OPEN)
        self.assertEqual(
            attendance_window.marking_state(
                classroom, MONDAY, now=at(MONDAY + timedelta(days=1), 0, 1)
            ),
            attendance_window.STATE_LOCKED,
        )

    def test_the_payload_separates_the_register_from_the_viewer(self):
        """An admin correcting a closed register should still be told it is closed."""
        classroom = self.make_class("14:00")
        admin = User.objects.create_user("win_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        payload = attendance_window.window_payload(
            classroom, MONDAY, now=at(MONDAY, 23), user=admin
        )
        self.assertEqual(payload["state"], attendance_window.STATE_LOCKED)
        self.assertTrue(payload["can_mark"])
        self.assertTrue(payload["is_override"])

    def test_a_teacher_gets_no_override(self):
        teacher = User.objects.create_user("win_teach@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        classroom = self.make_class("14:00")
        payload = attendance_window.window_payload(
            classroom, MONDAY, now=at(MONDAY, 23), user=teacher
        )
        self.assertFalse(payload["can_mark"])
        self.assertFalse(payload["is_override"])


# ── The endpoints ─────────────────────────────────────────────────────────────

class AttendanceEndpointFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user("aw_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        self.admin = User.objects.create_user("aw_admin@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        self.student = User.objects.create_user("aw_stu@t.com", "secret123", role=C.ROLE_STUDENT)
        self.classroom = Classroom.objects.create(
            name="Endpoints", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD,
            lesson_time="14:00", start_date=MONDAY, created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_OWNER
        )
        self.membership = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.joined_on(MONDAY)

    def joined_on(self, day: date, membership=None):
        """``joined_at`` is auto_now_add, so it can only be moved after the fact."""
        m = membership or self.membership
        ClassroomMembership.objects.filter(pk=m.pk).update(joined_at=at(day, 9))
        m.refresh_from_db()
        return m

    def session_on(self, day: date):
        return AttendanceSession.objects.create(classroom=self.classroom, date=day)

    def url(self, suffix=""):
        return f"/api/classes/{self.classroom.id}/attendance/{suffix}"


class MarkEndpointWindowTests(AttendanceEndpointFixture):
    """A rendered lock that the POST ignores is decoration."""

    def test_marking_an_old_register_is_refused(self):
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.teacher)
        with self.settings(USE_TZ=True):
            resp = self.client.post(
                self.url(f"sessions/{session.id}/mark/"),
                {"records": [{"student_id": self.student.id, "status": "PRESENT"}]},
                format="json",
            )
        # MONDAY is in 2026-06 and the suite runs long after it, so this register is closed.
        self.assertEqual(resp.status_code, 403)
        self.assertIn("closed", resp.json()["detail"].lower())
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_mark_all_present_on_an_old_register_is_refused(self):
        """The button that caused the incident. It is the last one that should be exempt."""
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.teacher)
        resp = self.client.post(self.url(f"sessions/{session.id}/mark-all-present/"), {}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_a_global_admin_may_still_correct_it(self):
        """A register nobody can fix is its own integrity problem."""
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url(f"sessions/{session.id}/mark/"),
            {"records": [{"student_id": self.student.id, "status": "PRESENT"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(AttendanceRecord.objects.filter(session=session).exists())

    def test_today_s_register_is_writable(self):
        """The lock must not brick the ordinary case it exists to protect."""
        today = timezone.localdate()
        self.classroom.lesson_time = ""      # window = the whole of today
        self.classroom.save(update_fields=["lesson_time"])
        session = self.session_on(today)
        self.client.force_authenticate(self.teacher)
        resp = self.client.post(
            self.url(f"sessions/{session.id}/mark/"),
            {"records": [{"student_id": self.student.id, "status": "PRESENT"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["updated"], 1)

    def test_creating_a_register_for_an_old_date_is_refused(self):
        """Otherwise the lock on the mark endpoints is decorative: create the day, mark it."""
        self.client.force_authenticate(self.teacher)
        resp = self.client.post(self.url("sessions/"), {"date": MONDAY.isoformat()}, format="json")
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(AttendanceSession.objects.filter(date=MONDAY).exists())

    def test_asking_for_a_register_that_already_exists_is_not_a_write(self):
        """This endpoint is an upsert, and the UI calls it to navigate. Refusing here would
        stop a teacher opening a closed register to *read* it."""
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.teacher)
        resp = self.client.post(self.url("sessions/"), {"date": MONDAY.isoformat()}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["id"], session.id)

    def test_the_list_reports_the_window_for_each_register(self):
        self.session_on(MONDAY)
        self.client.force_authenticate(self.teacher)
        resp = self.client.get(self.url("sessions/"))
        self.assertEqual(resp.status_code, 200)
        row = next(s for s in resp.json()["sessions"] if s["date"] == MONDAY.isoformat())
        self.assertEqual(row["marking"]["state"], "LOCKED")
        self.assertFalse(row["marking"]["can_mark"])
        self.assertTrue(row["marking"]["reason"])


class RosterAsItStoodTests(AttendanceEndpointFixture):
    """A student cannot have attended a lesson held before they joined."""

    def setUp(self):
        super().setUp()
        self.latecomer = User.objects.create_user("aw_late@t.com", "secret123", role=C.ROLE_STUDENT)
        self.late_membership = ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.latecomer, role=ClassroomMembership.ROLE_STUDENT
        )
        self.joined_on(WEDNESDAY, self.late_membership)

    def test_a_later_joiner_is_not_on_an_earlier_register(self):
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.teacher)
        resp = self.client.get(self.url(f"sessions/{session.id}/"))
        ids = {r["student_id"] for r in resp.json()["roster"]}
        self.assertIn(self.student.id, ids)
        self.assertNotIn(self.latecomer.id, ids)

    def test_they_are_on_the_registers_from_their_own_day_onward(self):
        session = self.session_on(WEDNESDAY)
        self.client.force_authenticate(self.teacher)
        resp = self.client.get(self.url(f"sessions/{session.id}/"))
        ids = {r["student_id"] for r in resp.json()["roster"]}
        self.assertIn(self.latecomer.id, ids)

    def test_the_mark_endpoint_refuses_them_too(self):
        """The view is the security boundary; a client can post any id it likes. An admin
        override gets past the *window*, not past enrolment."""
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(
            self.url(f"sessions/{session.id}/mark/"),
            {"records": [{"student_id": self.latecomer.id, "status": "PRESENT"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["updated"], 0)
        self.assertFalse(
            AttendanceRecord.objects.filter(session=session, student=self.latecomer).exists()
        )

    def test_mark_all_present_skips_them(self):
        session = self.session_on(MONDAY)
        self.client.force_authenticate(self.admin)
        self.client.post(self.url(f"sessions/{session.id}/mark-all-present/"), {}, format="json")
        marked = set(
            AttendanceRecord.objects.filter(session=session).values_list("student_id", flat=True)
        )
        self.assertEqual(marked, {self.student.id})


# ── The ledger's own guard ────────────────────────────────────────────────────

class RewardEnrolmentGuardTests(AttendanceEndpointFixture):
    """Records are not written only over HTTP. This is the check that holds for the rest."""

    def award_for(self, record):
        return PointAward.objects.filter(
            idempotency_key=reward_const.attendance_key(record.id)
        ).first()

    def test_a_mark_before_the_student_joined_earns_nothing(self):
        self.joined_on(WEDNESDAY)
        session = self.session_on(MONDAY)
        record = AttendanceRecord.objects.create(
            session=session, student=self.student, status=AttendanceRecord.STATUS_PRESENT
        )
        award = self.award_for(record)
        self.assertTrue(award is None or (award.points == 0 and award.xp == 0))

    def test_a_mark_from_the_join_day_onward_earns_normally(self):
        self.joined_on(MONDAY)
        session = self.session_on(MONDAY)
        record = AttendanceRecord.objects.create(
            session=session, student=self.student, status=AttendanceRecord.STATUS_PRESENT
        )
        award = self.award_for(record)
        self.assertIsNotNone(award)
        self.assertGreater(award.points, 0)
        self.assertGreater(award.xp, 0)

    def test_an_award_already_standing_is_taken_back_on_the_next_sync(self):
        """The production rows this ships to were written before the guard existed."""
        self.joined_on(MONDAY)
        session = self.session_on(MONDAY)
        record = AttendanceRecord.objects.create(
            session=session, student=self.student, status=AttendanceRecord.STATUS_PRESENT
        )
        self.assertGreater(self.award_for(record).xp, 0)

        # The membership turns out to postdate the lesson — the state the incident left.
        self.joined_on(WEDNESDAY)
        record.save()

        award = self.award_for(record)
        self.assertEqual(award.points, 0)
        self.assertEqual(award.xp, 0)

    def test_leaving_the_class_does_not_take_earned_xp_away(self):
        """The school's rule, stated in as many words: XP belongs to the student, not to the
        group. Removal must never reach into the ledger — only a WITHDRAWN fact does that."""
        self.joined_on(MONDAY)
        session = self.session_on(MONDAY)
        record = AttendanceRecord.objects.create(
            session=session, student=self.student, status=AttendanceRecord.STATUS_PRESENT
        )
        earned = self.award_for(record).xp
        self.assertGreater(earned, 0)

        self.membership.status = ClassroomMembership.STATUS_REMOVED
        self.membership.save(update_fields=["status"])
        record.save()   # re-sync: the guard must not read removal as "never joined"

        self.assertEqual(self.award_for(record).xp, earned)


class AuditCommandTests(AttendanceEndpointFixture):
    def test_it_finds_and_undoes_a_pre_join_mark(self):
        from io import StringIO

        from django.core.management import call_command

        self.joined_on(WEDNESDAY)
        session = self.session_on(MONDAY)
        # Written straight to the model, which is how the production rows got there.
        record = AttendanceRecord.objects.create(
            session=session, student=self.student, status=AttendanceRecord.STATUS_PRESENT
        )
        # Pay it by hand: the hook now refuses, and the point of the command is the history
        # that was written before the hook existed.
        from rewards.services import award

        award(
            self.student, reward_const.EVENT_ATTENDANCE_PRESENT,
            idempotency_key=reward_const.attendance_key(record.id),
            classroom=self.classroom, source_type="attendance_record", source_id=record.id,
        )
        paid = PointAward.objects.get(idempotency_key=reward_const.attendance_key(record.id))
        self.assertGreater(paid.xp, 0)

        out = StringIO()
        call_command("audit_attendance_awards", "--classroom", str(self.classroom.id), stdout=out)
        self.assertIn(str(record.id), out.getvalue())
        self.assertTrue(AttendanceRecord.objects.filter(pk=record.pk).exists())

        call_command(
            "audit_attendance_awards", "--classroom", str(self.classroom.id), "--fix", stdout=StringIO()
        )
        self.assertFalse(AttendanceRecord.objects.filter(pk=record.pk).exists())
        paid.refresh_from_db()
        self.assertEqual(paid.points, 0)
        self.assertEqual(paid.xp, 0)
