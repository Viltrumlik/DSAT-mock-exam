"""Delivering a Journal into a live classroom: the teacher panel.

Covers the plan derivation, handing out homework, the in-lesson "give the class access"
actions, and the permission boundary that keeps a teacher inside their own classrooms.
"""
from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet, HomeworkAssignment
from classes.models import Assignment, Classroom, ClassroomMembership
from exams.models import PracticeTest
from journals import delivery, services
from journals.models import ClassroomJournal, ClassroomLesson, Journal

User = get_user_model()


class DeliveryTestBase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="d_admin@test.com", password="x", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.teacher = User.objects.create_user(
            email="d_teacher@test.com", password="x", role=acc_const.ROLE_TEACHER,
            subject="math",
        )
        self.student = User.objects.create_user(
            email="d_student@test.com", password="x", role=acc_const.ROLE_STUDENT
        )

        self.classroom = Classroom.objects.create(
            name="Math Middle A",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD,  # Mon/Wed/Fri
            lesson_time="18:00",
            start_date=date(2026, 8, 3),  # a Monday
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher,
            role=ClassroomMembership.ROLE_TEACHER, status=ClassroomMembership.STATUS_ACTIVE,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )

        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _session(self, *, instructions="Do exercises 1-20"):
        """A ready HOMEWORK session on the journal."""
        lesson = services.add_session(self.journal, actor=self.admin)
        lesson.title = "Ch.3"
        lesson.instructions = instructions
        lesson.allow_file_upload = True
        lesson.save()
        cw = services.ensure_classwork(lesson)
        cw.new_topic_title = "Linear equations"
        cw.new_topic_instructions = "Slope-intercept form"
        cw.save()
        return lesson

    def _publish(self):
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])


class LessonPlanTests(DeliveryTestBase):
    def test_unpublished_journal_is_not_delivered(self):
        self._session()
        plan = delivery.lesson_plan(self.classroom, actor=self.teacher)
        self.assertFalse(plan["bound"])
        self.assertEqual(plan["reason"], "no_published_journal")

    def test_classroom_without_a_level_has_no_plan(self):
        self._session()
        self._publish()
        self.classroom.level = ""
        self.classroom.save(update_fields=["level"])
        plan = delivery.lesson_plan(self.classroom, actor=self.teacher)
        self.assertFalse(plan["bound"])
        self.assertEqual(plan["reason"], "no_level")

    def test_sessions_land_on_real_lesson_dates(self):
        for _ in range(3):
            self._session()
        self._publish()
        plan = delivery.lesson_plan(self.classroom, actor=self.teacher)
        self.assertTrue(plan["bound"])
        dates = [e["scheduled_for"].date() for e in plan["lessons"]]
        # ODD group from Mon 2026-08-03 → Mon, Wed, Fri.
        self.assertEqual(dates, [date(2026, 8, 3), date(2026, 8, 5), date(2026, 8, 7)])

    def test_binding_is_created_lazily_and_reused(self):
        self._session()
        self._publish()
        delivery.lesson_plan(self.classroom, actor=self.teacher)
        delivery.lesson_plan(self.classroom, actor=self.teacher)
        self.assertEqual(ClassroomJournal.objects.filter(classroom=self.classroom).count(), 1)

    def test_journal_edits_flow_through_without_a_sync(self):
        self._session()
        self._publish()
        self.assertEqual(len(delivery.lesson_plan(self.classroom)["lessons"]), 1)
        self._session()  # admin appends a session later
        self.assertEqual(len(delivery.lesson_plan(self.classroom)["lessons"]), 2)

    def test_anchor_keeps_dates_stable_when_class_has_no_start_date(self):
        # Without a stored anchor this plan would slide forward every day.
        self.classroom.start_date = None
        self.classroom.save(update_fields=["start_date"])
        self._session()
        self._publish()
        binding = delivery.get_binding(self.classroom, actor=self.teacher, create=True)
        binding.starts_on = date(2026, 8, 3)
        binding.save(update_fields=["starts_on"])
        plan = delivery.lesson_plan(self.classroom)
        self.assertEqual(plan["lessons"][0]["scheduled_for"].date(), date(2026, 8, 3))


class ReleaseHomeworkTests(DeliveryTestBase):
    def test_release_creates_a_published_assignment_due_next_lesson(self):
        session = self._session()
        self._publish()
        row, created = delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertTrue(created)
        a = Assignment.objects.get(pk=row.assignment_id)
        self.assertEqual(a.classroom_id, self.classroom.id)
        self.assertEqual(a.instructions, "Do exercises 1-20")
        self.assertEqual(a.status, Assignment.STATUS_PUBLISHED)
        # Deadline is derived, never picked: the start of the next lesson. Compare in
        # local time — due_at is stored as UTC, so a naive .hour reads 5 hours off.
        self.assertIsNotNone(a.due_at)
        self.assertEqual(timezone.localtime(a.due_at).hour, 18)

    def test_release_is_idempotent(self):
        session = self._session()
        self._publish()
        row1, created1 = delivery.release_homework(self.classroom, session, actor=self.teacher)
        row2, created2 = delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(row1.id, row2.id)
        self.assertEqual(Assignment.objects.filter(classroom=self.classroom).count(), 1)

    def test_release_attaches_assessments_pinned_to_a_version(self):
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Algebra basics", subject="math", level="middle", created_by=self.admin
        )
        session.assessments.create(assessment_set=aset, added_by=self.admin)
        self._publish()
        row, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        hw = HomeworkAssignment.objects.get(classroom=self.classroom, assessment_set=aset)
        self.assertEqual(hw.assignment_id, row.assignment_id)

    def test_incomplete_session_is_refused(self):
        session = services.add_session(self.journal, actor=self.admin)  # no instructions
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "incomplete")

    def test_midterm_session_has_no_homework(self):
        self._publish()
        session = services.add_session(
            self.journal, actor=self.admin, lesson_type="MIDTERM"
        )
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "midterm_session")


class InClassGrantTests(DeliveryTestBase):
    def test_granting_an_assessment_opens_it_to_the_class(self):
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Quiz", subject="math", level="middle", created_by=self.admin
        )
        self._publish()
        grant, created = delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
            actor=self.teacher,
        )
        self.assertTrue(created)
        # A HomeworkAssignment row + membership IS the access gate for assessments.
        self.assertTrue(
            HomeworkAssignment.objects.filter(
                classroom=self.classroom, assessment_set=aset
            ).exists()
        )
        # HomeworkAssignment.assignment is NOT nullable, so in-class work still needs an
        # Assignment — it gets a CLASSWORK-categorised one with no deadline, which keeps
        # it out of the homework list and off the SAT ranking.
        hw = HomeworkAssignment.objects.get(classroom=self.classroom, assessment_set=aset)
        carrier = Assignment.objects.get(pk=hw.assignment_id)
        self.assertEqual(carrier.category, Assignment.CATEGORY_CLASSWORK)
        self.assertIsNone(carrier.due_at)

    def test_several_in_class_grants_share_one_classwork_assignment(self):
        session = self._session()
        sets = [
            AssessmentSet.objects.create(
                title=f"Quiz {i}", subject="math", level="middle", created_by=self.admin
            )
            for i in range(3)
        ]
        self._publish()
        for aset in sets:
            delivery.grant_resource(
                self.classroom, session,
                block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
                actor=self.teacher,
            )
        # One carrier for the lesson, not one per item — otherwise opening three things
        # in a lesson would put three entries in the Assignments tab.
        self.assertEqual(
            Assignment.objects.filter(
                classroom=self.classroom, category=Assignment.CATEGORY_CLASSWORK
            ).count(),
            1,
        )

    def test_granting_twice_is_idempotent(self):
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Quiz", subject="math", level="middle", created_by=self.admin
        )
        self._publish()
        kw = dict(
            block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
            actor=self.teacher,
        )
        _, created1 = delivery.grant_resource(self.classroom, session, **kw)
        _, created2 = delivery.grant_resource(self.classroom, session, **kw)
        self.assertTrue(created1)
        self.assertFalse(created2)

    def test_granting_a_pastpaper_reaches_the_student(self):
        session = self._session()
        pt = PracticeTest.objects.create(title="Nov 2025 Math", subject="MATH")
        self._publish()
        delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="practice_test", resource_id=pt.id,
            actor=self.teacher,
        )
        # Pastpapers are gated by the legacy assigned_users M2M — publishing alone
        # never exposes one.
        self.assertTrue(pt.assigned_users.filter(pk=self.student.pk).exists())

    def test_unsupported_resource_type_is_refused(self):
        session = self._session()
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.grant_resource(
                self.classroom, session,
                block="EXERCISES", resource_type="mock_exam", resource_id=1,
                actor=self.teacher,
            )
        self.assertEqual(ctx.exception.code, "bad_resource_type")


class LessonApiTests(DeliveryTestBase):
    def test_teacher_sees_the_plan(self):
        self._session()
        self._publish()
        resp = self.client.get(f"/api/classes/{self.classroom.id}/lessons/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertTrue(body["bound"])
        self.assertEqual(len(body["lessons"]), 1)
        self.assertEqual(body["journal"]["level"], "middle")

    def test_detail_returns_homework_and_classwork(self):
        session = self._session()
        self._publish()
        resp = self.client.get(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["homework"]["instructions"], "Do exercises 1-20")
        self.assertEqual(body["classwork"]["new_topic"]["title"], "Linear equations")
        # The five-block timetable comes through for the teacher to follow in the room.
        self.assertEqual(len(body["classwork"]["timetable"]), 5)

    def test_release_endpoint_hands_out_homework(self):
        session = self._session()
        self._publish()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/release/"
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(resp.json()["created"])
        resp2 = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/release/"
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertFalse(resp2.json()["created"])

    def test_grant_endpoint_marks_the_item_given(self):
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Quiz", subject="math", level="middle", created_by=self.admin
        )
        session.classwork.assessments.create(
            assessment_set=aset, block="EXERCISES", added_by=self.admin
        )
        self._publish()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/grant/",
            {"block": "EXERCISES", "resource_type": "assessment_set", "resource_id": aset.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        detail = self.client.get(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/"
        ).json()
        items = detail["classwork"]["exercises"]["items"]
        self.assertTrue(any(i["given"] for i in items))

    def test_student_cannot_see_the_plan(self):
        self._session()
        self._publish()
        self.client.force_authenticate(self.student)
        resp = self.client.get(f"/api/classes/{self.classroom.id}/lessons/")
        self.assertEqual(resp.status_code, 403)

    def test_teacher_of_another_class_is_locked_out(self):
        self._session()
        self._publish()
        outsider = User.objects.create_user(
            email="outsider@test.com", password="x", role=acc_const.ROLE_TEACHER,
            subject="math",
        )
        self.client.force_authenticate(outsider)
        resp = self.client.get(f"/api/classes/{self.classroom.id}/lessons/")
        self.assertEqual(resp.status_code, 403)

    def test_reschedule_moves_undelivered_lessons(self):
        self._session()
        self._publish()
        resp = self.client.patch(
            f"/api/classes/{self.classroom.id}/lessons/reschedule/",
            {"starts_on": "2026-09-07"},  # a Monday
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        plan = self.client.get(f"/api/classes/{self.classroom.id}/lessons/").json()
        self.assertTrue(plan["lessons"][0]["scheduled_for"].startswith("2026-09-07"))

    def test_reschedule_does_not_move_a_lesson_already_delivered(self):
        session = self._session()
        self._publish()
        self.client.post(f"/api/classes/{self.classroom.id}/lessons/{session.id}/release/")
        delivered_at = ClassroomLesson.objects.get(
            classroom=self.classroom, journal_lesson=session
        ).scheduled_for
        self.client.patch(
            f"/api/classes/{self.classroom.id}/lessons/reschedule/",
            {"starts_on": "2026-09-07"},
            format="json",
        )
        row = ClassroomLesson.objects.get(classroom=self.classroom, journal_lesson=session)
        self.assertEqual(row.scheduled_for, delivered_at)
