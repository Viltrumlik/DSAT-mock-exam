"""Guards on the error report that its happy-path tests do not cover.

Three failure modes, each of which shipped or nearly shipped:

1. The report carries the score, the pass/fail verdict AND the full per-skill breakdown —
   strictly more than the score endpoint. It was published without the results-release gate
   the score endpoint enforces, so on an unpublished classroom midterm one curl returned the
   score the teacher had deliberately not released.
2. Attempts completed before the per-question freeze existed have no frozen rows. Reporting
   zeros for those renders as "a clean paper — you did not miss a single question" printed
   over a failing score.
3. The PDF must be refused in exactly the cases the JSON is refused; a downloadable sheet
   that bypasses the gate is the same leak in a different content type.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule
from midterms.models import MidtermAttempt, MidtermQuestionResult
from midterms.tests_report import make_midterm, sit
from questionbank.models import BankDomain, BankSkill

User = get_user_model()


class ErrorReportReleaseGateTests(TestCase):
    """A classroom midterm's report must wait for the teacher to publish, like the score."""

    def setUp(self):
        self.student = User.objects.create(username="s", first_name="Aziz", last_name="K")
        self.teacher = User.objects.create(username="t", role="teacher")
        domain = BankDomain.objects.create(subject="MATH", name="Algebra", code="alg")
        self.skill = BankSkill.objects.create(domain=domain, name="Linear functions", code="lin")
        self.mt = make_midterm(skills=[self.skill, self.skill])

        self.classroom = Classroom.objects.create(name="G9 Math", subject="MATH", created_by=self.teacher)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        # Classroom-scoped grant -> the classroom flavour, which is the gated one.
        ResourceAccessGrant.objects.create(
            user=self.student, resource_type=RT_MIDTERM_V2, resource_id=self.mt.id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE, status=ResourceAccessGrant.STATUS_ACTIVE,
            classroom=self.classroom,
        )
        self.schedule = MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.mt, starts_at=timezone.now(), results_released=False
        )
        qs = list(self.mt.questions())
        self.attempt = sit(self.mt, self.student, {str(qs[0].id): "a"}, score=400)

        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def _get(self, suffix=""):
        return self.c.get(f"/api/midterms/attempts/{self.attempt.pk}/error-report/{suffix}")

    def test_student_is_refused_before_the_teacher_publishes(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertIs(resp.data.get("released"), False)

    def test_the_pdf_is_refused_by_the_same_gate(self):
        # A downloadable sheet that bypasses the gate is the same leak in another content type.
        self.assertEqual(self._get("pdf/").status_code, 403)

    def test_student_gets_the_report_once_results_are_released(self):
        MidtermSchedule.objects.filter(pk=self.schedule.pk).update(results_released=True)
        resp = self._get()
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["score"], 400)

    def test_staff_may_read_it_before_release(self):
        # The admin report reads through this view while results are still embargoed.
        staff = APIClient()
        staff.force_authenticate(User.objects.create(username="adm", role="admin"))
        resp = staff.get(f"/api/midterms/attempts/{self.attempt.pk}/error-report/")
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_a_standalone_midterm_is_not_gated(self):
        # Standalone grants have no schedule and therefore no publication step.
        solo = make_midterm(title="Solo", skills=[self.skill])
        ResourceAccessGrant.objects.create(
            user=self.student, resource_type=RT_MIDTERM_V2, resource_id=solo.id,
            scope=ResourceAccessGrant.SCOPE_RESOURCE, status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        q = solo.questions().first()
        attempt = sit(solo, self.student, {str(q.id): "b"}, score=200)
        resp = self.c.get(f"/api/midterms/attempts/{attempt.pk}/error-report/")
        self.assertEqual(resp.status_code, 200, resp.content)


class UnanalysedAttemptTests(TestCase):
    """An attempt with no frozen rows must say so, never claim a flawless paper."""

    def setUp(self):
        self.student = User.objects.create(username="s2", first_name="Old", last_name="Sitting")
        domain = BankDomain.objects.create(subject="MATH", name="Algebra", code="alg")
        self.skill = BankSkill.objects.create(domain=domain, name="Linear functions", code="lin")
        self.mt = make_midterm(skills=[self.skill, self.skill, self.skill, self.skill])
        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def _legacy_attempt(self, score):
        """A pre-freeze sitting: completed and scored, but with no per-question rows."""
        attempt = MidtermAttempt.objects.create(
            midterm=self.mt, student=self.student, answers={},
            current_state=MidtermAttempt.STATE_COMPLETED, is_completed=True, score=score,
            started_at=timezone.now(), submitted_at=timezone.now(), completed_at=timezone.now(),
        )
        MidtermQuestionResult.objects.filter(attempt=attempt).delete()
        return attempt

    def test_a_scored_attempt_with_no_breakdown_is_409_not_a_clean_paper(self):
        attempt = self._legacy_attempt(score=380)
        resp = self.c.get(f"/api/midterms/attempts/{attempt.pk}/error-report/")
        self.assertEqual(resp.status_code, 409, resp.content)
        self.assertEqual(resp.data["reason"], "not_analysed")

    def test_the_backfill_makes_the_report_available(self):
        from django.core.management import call_command

        attempt = self._legacy_attempt(score=380)
        call_command("backfill_midterm_outcomes", verbosity=0)

        resp = self.c.get(f"/api/midterms/attempts/{attempt.pk}/error-report/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data["total_count"], 4)
        # Every answer was blank, so nothing is correct — emphatically not a clean paper.
        self.assertEqual(resp.data["correct_count"], 0)
        self.assertEqual(resp.data["skills"][0]["wrong"], 4)

    def test_the_backfill_is_idempotent(self):
        from django.core.management import call_command

        attempt = self._legacy_attempt(score=380)
        call_command("backfill_midterm_outcomes", verbosity=0)
        first = MidtermQuestionResult.objects.filter(attempt=attempt).count()
        call_command("backfill_midterm_outcomes", verbosity=0)
        self.assertEqual(MidtermQuestionResult.objects.filter(attempt=attempt).count(), first)

    def test_the_backfill_does_not_rewrite_an_existing_verdict(self):
        from django.core.management import call_command

        from midterms.models import MidtermOutcome

        qs = list(self.mt.questions())
        attempt = sit(self.mt, self.student, {str(q.id): "a" for q in qs}, score=800)
        self.assertTrue(MidtermOutcome.objects.get(midterm=self.mt, student=self.student).passed)

        # Raising the pass mark afterwards must not retroactively fail the student.
        self.mt.pass_mark = 790
        self.mt.save(update_fields=["pass_mark"])
        MidtermAttempt.objects.filter(pk=attempt.pk).update(score=500)
        call_command("backfill_midterm_outcomes", verbosity=0)

        outcome = MidtermOutcome.objects.get(midterm=self.mt, student=self.student)
        self.assertTrue(outcome.passed)
        self.assertEqual(outcome.score, 800)


class ErrorReportPdfTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="s3", first_name="Aziz", last_name="Karimov")
        domain = BankDomain.objects.create(subject="MATH", name="Advanced Math", code="adv")
        self.a = BankSkill.objects.create(domain=domain, name="Nonlinear functions", code="nl")
        self.b = BankSkill.objects.create(domain=domain, name="Right triangles and trigonometry", code="rt")
        self.mt = make_midterm(skills=[self.a, self.a, self.a, self.b, self.b, None])
        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def test_renders_a_pdf_for_a_released_attempt(self):
        qs = list(self.mt.questions())
        attempt = sit(self.mt, self.student, {str(qs[0].id): "a"}, score=350)
        resp = self.c.get(f"/api/midterms/attempts/{attempt.pk}/error-report/pdf/")
        self.assertEqual(resp.status_code, 200, resp.content[:200])
        self.assertEqual(resp["Content-Type"], "application/pdf")
        self.assertTrue(resp.content.startswith(b"%PDF"))
        self.assertIn("attachment;", resp["Content-Disposition"])

    def test_renders_when_the_student_lost_no_marks(self):
        # An empty skill list must not crash the chart renderer.
        qs = list(self.mt.questions())
        attempt = sit(self.mt, self.student, {str(q.id): "a" for q in qs}, score=800)
        resp = self.c.get(f"/api/midterms/attempts/{attempt.pk}/error-report/pdf/")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.content.startswith(b"%PDF"))

    def test_another_students_pdf_is_refused(self):
        qs = list(self.mt.questions())
        attempt = sit(self.mt, self.student, {str(qs[0].id): "a"}, score=350)
        intruder = APIClient()
        intruder.force_authenticate(User.objects.create(username="nosy"))
        resp = intruder.get(f"/api/midterms/attempts/{attempt.pk}/error-report/pdf/")
        self.assertEqual(resp.status_code, 403)
