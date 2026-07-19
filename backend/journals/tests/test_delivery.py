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

    def _attach_assessment(self, session, aset, block="EXERCISES"):
        """Put an assessment into the session's classwork plan (grants are plan-scoped)."""
        cw = services.ensure_classwork(session)
        cw.assessments.create(assessment_set=aset, block=block, added_by=self.admin)
        return aset

    def _attach_pastpaper(self, session, pt, block="EXERCISES"):
        cw = services.ensure_classwork(session)
        field = (
            "exercise_practice_test_ids"
            if block == "EXERCISES"
            else "new_topic_practice_test_ids"
        )
        ids = list(getattr(cw, field) or [])
        ids.append(pt.id)
        setattr(cw, field, ids)
        cw.save(update_fields=[field])
        return pt


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
        row, created, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
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
        row1, created1, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        row2, created2, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(row1.id, row2.id)
        self.assertEqual(Assignment.objects.filter(classroom=self.classroom).count(), 1)

    def test_release_attaches_assessments_pinned_to_a_version(self):
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Algebra basics", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        session.assessments.create(assessment_set=aset, added_by=self.admin)
        self._publish()
        row, _, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        hw = HomeworkAssignment.objects.get(classroom=self.classroom, assessment_set=aset)
        self.assertEqual(hw.assignment_id, row.assignment_id)

    def test_a_set_already_given_is_reported_not_silently_dropped(self):
        """uniq_assessment_hw_classroom_set allows a set into a classroom only ONCE.

        A revision set reused on a later session therefore cannot bind to the new
        Assignment. Reporting success anyway shipped students an EMPTY homework, so the
        release has to say what did not attach.
        """
        aset = AssessmentSet.objects.create(
            title="Revision Set A", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        s1 = self._session()
        s1.assessments.create(assessment_set=aset, added_by=self.admin)
        s2 = self._session()
        s2.assessments.create(assessment_set=aset, added_by=self.admin)
        self._publish()

        _, _, w1 = delivery.release_homework(self.classroom, s1, actor=self.teacher)
        self.assertEqual(w1, [])
        row2, created2, w2 = delivery.release_homework(self.classroom, s2, actor=self.teacher)
        self.assertTrue(created2)
        self.assertEqual(len(w2), 1)
        self.assertIn("Revision Set A", w2[0])
        # And the second homework really does carry no assessment — which is exactly why
        # the teacher has to be told.
        self.assertEqual(
            HomeworkAssignment.objects.filter(assignment_id=row2.assignment_id).count(), 0
        )

    def test_release_endpoint_surfaces_the_warning(self):
        aset = AssessmentSet.objects.create(
            title="Revision Set A", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        s1 = self._session()
        s1.assessments.create(assessment_set=aset, added_by=self.admin)
        s2 = self._session()
        s2.assessments.create(assessment_set=aset, added_by=self.admin)
        self._publish()
        self.client.post(f"/api/classes/{self.classroom.id}/lessons/{s1.id}/release/")
        resp = self.client.post(f"/api/classes/{self.classroom.id}/lessons/{s2.id}/release/")
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(len(body["warnings"]), 1)
        self.assertIn("not everything attached", body["detail"])

    def test_due_at_comes_from_the_lesson_not_from_today(self):
        """Homework set in lesson N is due at lesson N+1 — measured from lesson N's date.

        Computing it from "now" meant releasing a lesson late silently shortened its
        deadline to the next lesson after today.
        """
        sessions = [self._session() for _ in range(3)]
        self._publish()
        # Lesson 3 sits on Fri 2026-08-07, so its homework is due Mon 2026-08-10 —
        # regardless of when the teacher actually presses the button.
        _, _, _ = delivery.release_homework(self.classroom, sessions[2], actor=self.teacher)
        row = ClassroomLesson.objects.get(classroom=self.classroom, journal_lesson=sessions[2])
        a = Assignment.objects.get(pk=row.assignment_id)
        self.assertEqual(timezone.localtime(a.due_at).date(), date(2026, 8, 10))

    def test_admin_can_still_delete_a_session_a_class_has_delivered(self):
        # PROTECT here made the admin delete endpoint 500 once any classroom had used the
        # session; the delivery row must outlive the template as history instead.
        session = self._session()
        self._publish()
        delivery.release_homework(self.classroom, session, actor=self.teacher)
        row_id = ClassroomLesson.objects.get(
            classroom=self.classroom, journal_lesson=session
        ).id
        services.delete_session(self.journal, session, self.admin)
        row = ClassroomLesson.objects.get(pk=row_id)
        self.assertIsNone(row.journal_lesson_id)
        # The Assignment students received is still linked.
        self.assertIsNotNone(row.assignment_id)

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
            title="Quiz", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._attach_assessment(session, aset)
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
                title=f"Quiz {i}", subject="math", level="middle", created_by=self.admin,
                review_status=AssessmentSet.STATUS_APPROVED,
            )
            for i in range(3)
        ]
        for aset in sets:
            self._attach_assessment(session, aset)
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
            title="Quiz", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._attach_assessment(session, aset)
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
        self._attach_pastpaper(session, pt)
        self._publish()
        delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="practice_test", resource_id=pt.id,
            actor=self.teacher,
        )
        # Pastpapers are gated by the legacy assigned_users M2M — publishing alone
        # never exposes one.
        self.assertTrue(pt.assigned_users.filter(pk=self.student.pk).exists())

    def test_revoke_withdraws_the_record_but_not_the_access(self):
        session = self._session()
        pt = PracticeTest.objects.create(title="Nov 2025 Math", subject="MATH")
        self._attach_pastpaper(session, pt)
        self._publish()
        grant, _ = delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="practice_test", resource_id=pt.id,
            actor=self.teacher,
        )
        delivery.revoke_grant(grant, actor=self.teacher)
        grant.refresh_from_db()
        self.assertIsNotNone(grant.revoked_at)
        # Deliberate: a student may be mid-attempt, so withdrawing the panel entry must
        # NOT yank the work out from under them.
        self.assertTrue(pt.assigned_users.filter(pk=self.student.pk).exists())

    def test_revoked_item_can_be_given_again(self):
        # The unique constraint is partial (revoked_at IS NULL), so a revoke frees the
        # slot instead of permanently blocking the item.
        session = self._session()
        pt = PracticeTest.objects.create(title="Nov 2025 Math", subject="MATH")
        self._attach_pastpaper(session, pt)
        self._publish()
        kw = dict(
            block="EXERCISES", resource_type="practice_test", resource_id=pt.id,
            actor=self.teacher,
        )
        g1, created1 = delivery.grant_resource(self.classroom, session, **kw)
        delivery.revoke_grant(g1, actor=self.teacher)
        g2, created2 = delivery.grant_resource(self.classroom, session, **kw)
        self.assertTrue(created1)
        self.assertTrue(created2)
        self.assertNotEqual(g1.id, g2.id)

    def test_revoked_item_is_no_longer_marked_given(self):
        session = self._session()
        pt = PracticeTest.objects.create(title="Nov 2025 Math", subject="MATH")
        self._attach_pastpaper(session, pt)
        self._publish()
        grant, _ = delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="practice_test", resource_id=pt.id,
            actor=self.teacher,
        )
        delivery.revoke_grant(grant, actor=self.teacher)
        plan = delivery.lesson_plan(self.classroom, actor=self.teacher)
        entry = next(e for e in plan["lessons"] if e["session"].id == session.id)
        self.assertEqual(entry["grants"], [])

    def test_granting_something_not_in_the_plan_is_refused(self):
        """The endpoint is "open THIS item of the plan" — so it must check the plan.

        Without this a teacher could hand the class any assessment set or pastpaper by id,
        sidestepping the level/subject scoping journal authoring applies and the approval
        gate the ordinary assign path enforces.
        """
        session = self._session()
        outsider = AssessmentSet.objects.create(
            title="Not in this lesson", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.grant_resource(
                self.classroom, session,
                block="EXERCISES", resource_type="assessment_set", resource_id=outsider.id,
                actor=self.teacher,
            )
        self.assertEqual(ctx.exception.code, "not_in_plan")

    def test_granting_under_the_wrong_block_is_refused(self):
        # The same item can sit in two blocks and is granted/withdrawn per block, so the
        # block is part of the identity, not decoration.
        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Exercise quiz", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._attach_assessment(session, aset, block="EXERCISES")
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.grant_resource(
                self.classroom, session,
                block="NEW_TOPIC", resource_type="assessment_set", resource_id=aset.id,
                actor=self.teacher,
            )
        self.assertEqual(ctx.exception.code, "not_in_plan")

    def test_api_refuses_an_out_of_plan_grant(self):
        session = self._session()
        outsider = AssessmentSet.objects.create(
            title="Not in this lesson", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._publish()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/grant/",
            {"block": "EXERCISES", "resource_type": "assessment_set", "resource_id": outsider.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "not_in_plan")
        self.assertFalse(
            HomeworkAssignment.objects.filter(
                classroom=self.classroom, assessment_set=outsider
            ).exists()
        )

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


class MidtermSessionTests(DeliveryTestBase):
    def _midterm_session(self):
        from exams.models import Module
        from midterms.models import Midterm

        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        exam = Midterm.objects.create(
            title="Middle Math Midterm",
            subject="MATH",
            level="middle",
            scoring_scale=Midterm.SCALE_100,
            duration_minutes=30,
            question_module=module,
            is_published=True,
        )
        session = services.add_session(self.journal, actor=self.admin, lesson_type="MIDTERM")
        session.midterm_exam = exam
        session.midterm_access_days_before = 2
        session.save()
        return session, exam

    def test_granting_a_midterm_creates_the_schedule(self):
        session, exam = self._midterm_session()
        self._publish()
        row, created = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        self.assertTrue(created)
        self.assertIsNotNone(row.midterm_schedule_id)
        self.assertEqual(row.midterm_schedule.midterm_id, exam.id)
        self.assertEqual(row.midterm_schedule.classroom_id, self.classroom.id)

    def test_access_alone_does_not_let_students_start(self):
        # can_start_midterm refuses with `midterm_no_code` until the teacher generates
        # the code — the panel surfaces this as a required second step.
        session, _ = self._midterm_session()
        self._publish()
        row, _ = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        self.assertEqual(row.midterm_schedule.access_code, "")

    def test_window_opens_the_configured_days_before_the_session(self):
        session, _ = self._midterm_session()
        self._publish()
        row, _ = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        self.assertIsNotNone(row.scheduled_for)
        delta = row.scheduled_for - row.midterm_schedule.starts_at
        self.assertEqual(delta.days, 2)

    def test_granting_a_midterm_is_idempotent(self):
        session, _ = self._midterm_session()
        self._publish()
        _, created1 = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        _, created2 = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        self.assertTrue(created1)
        self.assertFalse(created2)

    def test_grant_endpoint_reports_that_a_start_code_is_still_needed(self):
        session, _ = self._midterm_session()
        self._publish()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/grant/", {}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["needs_start_code"])


class ReviewFindingsTests(DeliveryTestBase):
    """Regressions for the defects the adversarial review confirmed."""

    def _approved_set(self, title="Approved set"):
        return AssessmentSet.objects.create(
            title=title, subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )

    # ── content that used to reach nobody ─────────────────────────────────────
    def test_release_copies_the_file_instead_of_aliasing_the_template(self):
        from django.core.files.base import ContentFile

        session = self._session()
        session.attachment_file.save("brief.txt", ContentFile(b"worksheet"), save=True)
        self._publish()
        row, _, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        a = Assignment.objects.get(pk=row.assignment_id)
        session.refresh_from_db()
        # Distinct storage paths: assigning the FileField across would have shared one
        # file, so deleting either row's file would strip it from the other.
        self.assertTrue(a.attachment_file)
        self.assertNotEqual(a.attachment_file.name, session.attachment_file.name)
        a.attachment_file.open("rb")
        self.assertEqual(a.attachment_file.read(), b"worksheet")
        a.attachment_file.close()

    def test_release_brings_across_every_extra_attachment(self):
        from django.core.files.base import ContentFile

        session = self._session()
        session.attachment_file.save("main.txt", ContentFile(b"main"), save=True)
        for i in range(2):
            session.extra_attachments.create(file=ContentFile(b"x", name=f"extra{i}.txt"))
        self._publish()
        row, _, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        a = Assignment.objects.get(pk=row.assignment_id)
        self.assertEqual(a.extra_attachments.count(), 2)

    def test_granting_a_pack_reaches_students_through_its_sections(self):
        from exams.models import PracticeTestPack

        session = self._session()
        pack = PracticeTestPack.objects.create(title="March 2026", created_by=self.admin)
        section = PracticeTest.objects.create(
            title="March 2026 Math", subject="MATH", practice_test_pack=pack
        )
        cw = services.ensure_classwork(session)
        cw.exercise_practice_test_pack_ids = [pack.id]
        cw.save(update_fields=["exercise_practice_test_pack_ids"])
        self._publish()
        delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="practice_test_pack", resource_id=pack.id,
            actor=self.teacher,
        )
        # The student gate is assigned_users on the SECTION, never on the pack — granting
        # the pack id alone wrote a row nothing reads.
        self.assertTrue(section.assigned_users.filter(pk=self.student.pk).exists())

    def test_midterm_grant_skips_removed_students(self):
        from access.models import ResourceAccessGrant
        from exams.models import Module
        from midterms.models import Midterm

        gone = User.objects.create_user(
            email="gone@test.com", password="x", role=acc_const.ROLE_STUDENT
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=gone,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_REMOVED,
        )
        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        exam = Midterm.objects.create(
            title="MT", subject="MATH", level="middle", scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, question_module=module, is_published=True,
        )
        session = services.add_session(self.journal, actor=self.admin, lesson_type="MIDTERM")
        session.midterm_exam = exam
        session.save()
        self._publish()
        delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        granted = set(
            ResourceAccessGrant.objects.filter(
                resource_type="midterm_v2", resource_id=exam.id,
            ).values_list("user_id", flat=True)
        )
        self.assertIn(self.student.id, granted)
        self.assertNotIn(gone.id, granted)

    # ── crashes ───────────────────────────────────────────────────────────────
    def test_a_deleted_resource_is_a_clean_error_not_a_500(self):
        session = self._session()
        pt = PracticeTest.objects.create(title="Doomed", subject="MATH")
        self._attach_pastpaper(session, pt)
        self._publish()
        pt_id = pt.id
        pt.delete()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/grant/",
            {"block": "EXERCISES", "resource_type": "practice_test", "resource_id": pt_id},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "not_found")

    def test_reschedule_without_a_date_is_rejected_not_silently_nulled(self):
        self._session()
        self._publish()
        binding = delivery.get_binding(self.classroom, actor=self.teacher, create=True)
        before = binding.starts_on
        resp = self.client.patch(
            f"/api/classes/{self.classroom.id}/lessons/reschedule/", {}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        binding.refresh_from_db()
        self.assertEqual(binding.starts_on, before)

    # ── approval gate ─────────────────────────────────────────────────────────
    def test_an_unapproved_set_is_refused_on_release(self):
        session = self._session()
        draft = AssessmentSet.objects.create(
            title="Draft set", subject="math", level="middle", created_by=self.admin
        )
        session.assessments.create(assessment_set=draft, added_by=self.admin)
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.release_homework(self.classroom, session, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "assessment_not_approved")

    def test_an_unapproved_set_goes_out_when_the_teacher_confirms(self):
        session = self._session()
        draft = AssessmentSet.objects.create(
            title="Draft set", subject="math", level="middle", created_by=self.admin
        )
        session.assessments.create(assessment_set=draft, added_by=self.admin)
        self._publish()
        row, created, _ = delivery.release_homework(
            self.classroom, session, actor=self.teacher, allow_unapproved=True
        )
        self.assertTrue(created)
        self.assertTrue(
            HomeworkAssignment.objects.filter(
                classroom=self.classroom, assessment_set=draft
            ).exists()
        )

    def test_an_approved_set_needs_no_confirmation(self):
        session = self._session()
        session.assessments.create(assessment_set=self._approved_set(), added_by=self.admin)
        self._publish()
        _, created, warnings = delivery.release_homework(
            self.classroom, session, actor=self.teacher
        )
        self.assertTrue(created)
        self.assertEqual(warnings, [])

    def test_unapproved_in_class_grant_is_refused(self):
        session = self._session()
        draft = AssessmentSet.objects.create(
            title="Draft quiz", subject="math", level="middle", created_by=self.admin
        )
        self._attach_assessment(session, draft)
        self._publish()
        resp = self.client.post(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/grant/",
            {"block": "EXERCISES", "resource_type": "assessment_set", "resource_id": draft.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "assessment_not_approved")

    # ── stuck UI state ────────────────────────────────────────────────────────
    def test_homework_can_be_given_again_after_its_assignment_is_deleted(self):
        session = self._session()
        self._publish()
        row, _, _ = delivery.release_homework(self.classroom, session, actor=self.teacher)
        Assignment.objects.filter(pk=row.assignment_id).delete()
        row.refresh_from_db()
        self.assertIsNone(row.assignment_id)          # SET_NULL keeps the delivery row
        self.assertIsNotNone(row.homework_released_at)  # ...still marked released
        # The panel detects that pair and offers "Give again"; the service must allow it.
        row2, created2, _ = delivery.release_homework(
            self.classroom, session, actor=self.teacher
        )
        self.assertTrue(created2)
        self.assertIsNotNone(row2.assignment_id)

    def test_start_code_is_readable_from_the_lesson_after_navigating_away(self):
        from exams.models import Module
        from midterms.models import Midterm

        module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        exam = Midterm.objects.create(
            title="MT", subject="MATH", level="middle", scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, question_module=module, is_published=True,
        )
        session = services.add_session(self.journal, actor=self.admin, lesson_type="MIDTERM")
        session.midterm_exam = exam
        session.save()
        self._publish()
        row, _ = delivery.grant_midterm(self.classroom, session, actor=self.teacher)
        row.midterm_schedule.access_code = "123456"
        row.midterm_schedule.save(update_fields=["access_code"])
        # A fresh GET must carry the code, not just the POST that created it.
        detail = self.client.get(
            f"/api/classes/{self.classroom.id}/lessons/{session.id}/"
        ).json()
        self.assertEqual(detail["midterm"]["start_code"], "123456")


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
            title="Quiz", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
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
