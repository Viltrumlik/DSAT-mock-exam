"""The register marks demo (trial) rows itself and puts them last, with no lc-up involved."""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession

User = get_user_model()
FIRST, SECOND = date(2026, 6, 1), date(2026, 6, 3)


@override_settings(LCUP_ENABLED=False)
class DemoRowsOnTheRegisterTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("dm_t@t.com", "secret123", role=C.ROLE_TEACHER, subject="math")
        admin = User.objects.create_user("dm_a@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        self.room = Classroom.objects.create(
            name="Junior G3 Math", subject=Classroom.SUBJECT_MATH, lesson_days=Classroom.DAYS_ODD, created_by=admin,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_OWNER)
        # Named so the demo student sorts FIRST by name: only the demo rule can put it last.
        self.demo = self.seat("a_demo", ClassroomMembership.SEAT_TRIAL)
        self.zara = self.seat("z_paying", ClassroomMembership.SEAT_ACTIVE)
        self.frozen = self.seat("m_frozen", ClassroomMembership.SEAT_FROZEN)
        self.api = APIClient()
        self.api.force_authenticate(self.teacher)

    def seat(self, username, seat_status):
        user = User.objects.create_user(f"{username}@t.com", "secret123", role=C.ROLE_STUDENT, first_name=username)
        m = ClassroomMembership.objects.create(
            classroom=self.room, user=user, role=ClassroomMembership.ROLE_STUDENT, seat_status=seat_status
        )
        ClassroomMembership.objects.filter(pk=m.pk).update(joined_at=timezone.make_aware(timezone.datetime(2026, 5, 1)))
        return user

    def roster(self, day):
        session, _ = AttendanceSession.objects.get_or_create(classroom=self.room, date=day)
        body = self.api.get(f"/api/classes/{self.room.id}/attendance/sessions/{session.id}/").json()
        return body["roster"]

    def test_demo_rows_are_marked_and_come_after_the_paying_and_frozen_rows(self):
        roster = self.roster(FIRST)
        self.assertEqual([r["is_demo"] for r in roster], [False, False, True])
        self.assertEqual(roster[-1]["student_id"], self.demo.pk)
        self.assertEqual({r["student_id"] for r in roster[:2]}, {self.zara.pk, self.frozen.pk})

    def test_the_order_among_paying_rows_is_kept(self):
        before = [r["student_id"] for r in self.roster(FIRST) if not r["is_demo"]]
        again = [r["student_id"] for r in self.roster(FIRST) if not r["is_demo"]]
        self.assertEqual(before, again)

    def test_the_free_lesson_is_unused_on_the_first_lesson_and_used_after_one_present_lesson(self):
        first = next(r for r in self.roster(FIRST) if r["is_demo"])
        self.assertFalse(first["lcup_trial"]["free_used"])
        session = AttendanceSession.objects.get(classroom=self.room, date=FIRST)
        AttendanceRecord.objects.create(session=session, student=self.demo, status=AttendanceRecord.STATUS_PRESENT)
        second = next(r for r in self.roster(SECOND) if r["is_demo"])
        self.assertTrue(second["lcup_trial"]["free_used"])
        self.assertEqual(second["lcup_trial"]["lessons_before"], 1)

    def test_a_paying_row_has_no_trial_block(self):
        row = next(r for r in self.roster(FIRST) if r["student_id"] == self.zara.pk)
        self.assertIsNone(row["lcup_trial"])
