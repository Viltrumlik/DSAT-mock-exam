"""Midterm reporting: per-student error report + admin classroom report (incl. PDF).

    python manage.py test midterms.tests_report --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from classes.models_schedule import MidtermSchedule
from exams.models import Module, Question
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome, MidtermQuestionResult
from midterms.report_pdf import paginate, render_classroom_midterm_report_pdf
from questionbank.models import BankDomain, BankSkill

User = get_user_model()


def make_midterm(title="Midterm 12", *, subject=Midterm.MATH, scale=Midterm.SCALE_800,
                 midterm_type=Midterm.TYPE_MIDTERM, pass_mark=None, retake_of=None, skills=()):
    """A published midterm with one question per entry in ``skills`` (None = untagged)."""
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
    mt = Midterm.objects.create(
        title=title,
        subject=subject,
        scoring_scale=scale,
        midterm_type=midterm_type,
        pass_mark=pass_mark,
        retake_of=retake_of,
        duration_minutes=30,
        question_module=module,
        is_published=True,
    )
    for i, skill in enumerate(skills):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", is_math_input=False, score=10, order=i, skill=skill,
        )
    return mt


def sit(midterm, student, answers, *, score):
    """A COMPLETED attempt with frozen per-question rows + verdict, without the timer dance."""
    attempt = MidtermAttempt.objects.create(
        midterm=midterm,
        student=student,
        answers=answers,
        current_state=MidtermAttempt.STATE_COMPLETED,
        is_completed=True,
        score=score,
        started_at=timezone.now(),
        submitted_at=timezone.now(),
        completed_at=timezone.now(),
    )
    MidtermQuestionResult.freeze_for(attempt)
    MidtermOutcome.record_for(attempt)
    return attempt


class ErrorReportTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="aziz", first_name="Aziz", last_name="Karimov")
        self.other = User.objects.create(username="other")
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.student)

        domain = BankDomain.objects.create(subject="MATH", name="Advanced Math", code="adv", display_order=1)
        self.nonlinear = BankSkill.objects.create(domain=domain, name="Nonlinear functions", code="nl")
        self.linear = BankSkill.objects.create(domain=domain, name="Linear equations", code="lin")
        # 2 nonlinear, 2 linear, 1 untagged.
        self.mt = make_midterm(skills=[self.nonlinear, self.nonlinear, self.linear, self.linear, None])
        self.qs = list(self.mt.questions())

    def _sit(self, correct_flags, score=500):
        answers = {str(q.id): ("a" if ok else "b") for q, ok in zip(self.qs, correct_flags)}
        return sit(self.mt, self.student, answers, score=score)

    def test_shape_and_only_wrong_skills(self):
        # nonlinear: 1 wrong of 2; linear: both right; untagged: wrong.
        attempt = self._sit([True, False, True, True, False], score=560)
        r = self.c.get(f"/api/midterms/attempts/{attempt.id}/error-report/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["attempt_id"], attempt.id)
        self.assertEqual(body["student_name"], "Aziz Karimov")
        self.assertEqual(body["score"], 560)
        self.assertEqual(body["correct_count"], 3)
        self.assertEqual(body["total_count"], 5)
        self.assertEqual(body["pass_mark"], 500)
        self.assertTrue(body["passed"])
        self.assertTrue(body["is_graded"])
        self.assertEqual(body["midterm"]["subject_label"], "Mathematics")
        self.assertEqual(body["midterm"]["score_ceiling"], 800)
        # Untagged questions are disclosed, never folded into a skill row.
        self.assertEqual(body["unclassified_total"], 1)
        self.assertEqual(body["unclassified_wrong"], 1)
        # A fully-correct skill must not appear.
        self.assertEqual(
            body["skills"],
            [{
                "skill_id": self.nonlinear.id,
                "skill": "Nonlinear functions",
                "domain": "Advanced Math",
                "total": 2,
                "wrong": 1,
            }],
        )

    def test_skills_sorted_by_wrong_then_name(self):
        attempt = self._sit([False, False, False, True, True], score=300)
        body = self.c.get(f"/api/midterms/attempts/{attempt.id}/error-report/").json()
        self.assertEqual([(s["skill"], s["wrong"]) for s in body["skills"]],
                         [("Nonlinear functions", 2), ("Linear equations", 1)])
        self.assertFalse(body["passed"])

    def test_report_is_frozen_against_live_question_edits(self):
        attempt = self._sit([True, False, True, True, True], score=560)
        # The builder re-tags and re-keys the question after the fact.
        Question.objects.filter(pk=self.qs[1].pk).update(correct_answers="b", skill=self.linear)
        body = self.c.get(f"/api/midterms/attempts/{attempt.id}/error-report/").json()
        self.assertEqual(body["correct_count"], 4)
        self.assertEqual(body["skills"][0]["skill"], "Nonlinear functions")

    def test_incomplete_attempt_is_403(self):
        attempt = MidtermAttempt.objects.create(midterm=self.mt, student=self.student)
        r = self.c.get(f"/api/midterms/attempts/{attempt.id}/error-report/")
        self.assertEqual(r.status_code, 403, r.content)

    def test_student_cannot_read_another_students_report(self):
        attempt = self._sit([True, True, True, True, True], score=800)
        c2 = APIClient()
        c2.force_authenticate(self.other)
        r = c2.get(f"/api/midterms/attempts/{attempt.id}/error-report/")
        self.assertEqual(r.status_code, 403, r.content)

    def test_staff_may_read_and_pivot_by_student(self):
        mine = self._sit([True, True, True, True, True], score=800)
        theirs = sit(self.mt, self.other, {str(self.qs[0].id): "b"}, score=200)
        ac = APIClient()
        ac.force_authenticate(self.admin)
        r = ac.get(f"/api/midterms/attempts/{mine.id}/error-report/", {"student": self.other.id})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["attempt_id"], theirs.id)

    def test_pre_midterm_has_no_verdict(self):
        pre = make_midterm("Pre 1", midterm_type=Midterm.TYPE_PRE_MIDTERM, skills=[self.linear])
        q = pre.questions().first()
        attempt = sit(pre, self.student, {str(q.id): "b"}, score=200)
        body = self.c.get(f"/api/midterms/attempts/{attempt.id}/error-report/").json()
        self.assertFalse(body["is_graded"])
        self.assertIsNone(body["pass_mark"])
        self.assertIsNone(body["passed"])
        self.assertIsNone(MidtermOutcome.objects.filter(midterm=pre).first())


class AdminReportTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.teacher = User.objects.create(username="tt", role="teacher", first_name="Nodir", last_name="T")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)

        self.classroom = Classroom.objects.create(
            name="Math Senior A", subject=Classroom.SUBJECT_MATH, level=Classroom.LEVEL_SENIOR,
            lesson_days=Classroom.DAYS_ODD, teacher=self.teacher, created_by=self.admin,
        )
        self.students = []
        for i, name in enumerate(["Bek", "Aziz", "Dilnoza", "Chorshanbe"]):
            u = User.objects.create(username=f"s{i}", first_name=name, last_name="X")
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
            self.students.append(u)
        # A removed student must never appear on the report.
        self.removed = User.objects.create(username="gone", first_name="Gone")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.removed, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_REMOVED,
        )

        self.mt = make_midterm("Midterm 12", pass_mark=500, skills=[None, None])
        self.retake = make_midterm(
            "Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, pass_mark=500, retake_of=self.mt,
            skills=[None, None],
        )
        self.sched = MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.mt, starts_at=timezone.now()
        )
        qs = list(self.mt.questions())
        rqs = list(self.retake.questions())
        # Bek passes outright; Aziz fails then passes the retake; Dilnoza fails both;
        # Chorshanbe never sat it.
        sit(self.mt, self.students[0], {str(qs[0].id): "a", str(qs[1].id): "a"}, score=800)
        sit(self.mt, self.students[1], {str(qs[0].id): "b"}, score=200)
        sit(self.retake, self.students[1], {str(rqs[0].id): "a", str(rqs[1].id): "a"}, score=800)
        sit(self.mt, self.students[2], {str(qs[0].id): "b"}, score=200)
        sit(self.retake, self.students[2], {str(rqs[0].id): "b"}, score=200)

    def test_classroom_list(self):
        r = self.c.get("/api/midterms/admin/reports/classrooms/")
        self.assertEqual(r.status_code, 200, r.content)
        rows = r.json()["results"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "Math Senior A")
        self.assertEqual(rows[0]["teacher_name"], "Nodir T")
        self.assertEqual(rows[0]["student_count"], 4)  # the REMOVED member is excluded
        self.assertEqual(rows[0]["midterm_count"], 1)

    def test_classroom_detail_counts_and_retake_link(self):
        r = self.c.get(f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["classroom"]["name"], "Math Senior A")
        self.assertEqual(len(body["midterms"]), 1)
        row = body["midterms"][0]
        self.assertEqual(row["pass_mark"], 500)
        self.assertEqual(row["retake"], {"id": self.retake.id, "title": "Midterm 12 Retake"})
        self.assertIsNotNone(row["scheduled_at"])
        self.assertEqual(row["counts"], {"passed": 2, "failed": 1, "absent": 1, "pending": 0})

    def test_midterm_detail_rows(self):
        url = f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/midterms/{self.mt.id}/"
        body = self.c.get(url).json()
        self.assertEqual(body["retake"]["id"], self.retake.id)
        self.assertEqual(
            body["summary"],
            {"students": 4, "passed": 2, "failed": 1, "absent": 1, "pending": 0,
             "pass_mark": 500, "average_score": 400},
        )
        rows = {r["student_name"]: r for r in body["rows"]}
        self.assertEqual([r["student_name"] for r in body["rows"]],
                         ["Aziz X", "Bek X", "Chorshanbe X", "Dilnoza X"])
        self.assertNotIn("Gone", rows)

        bek = rows["Bek X"]
        self.assertEqual(bek["final_status"], "PASSED")
        self.assertFalse(bek["retake_eligible"])
        self.assertIsNone(bek["retake_score"])
        self.assertIsNone(bek["retake_state"])

        aziz = rows["Aziz X"]
        self.assertEqual(aziz["final_status"], "PASSED_ON_RETAKE")
        self.assertTrue(aziz["retake_eligible"])
        self.assertEqual(aziz["retake_score"], 800)
        self.assertTrue(aziz["retake_passed"])

        self.assertEqual(rows["Dilnoza X"]["final_status"], "FAILED")
        absent = rows["Chorshanbe X"]
        self.assertEqual(absent["final_status"], "ABSENT")
        self.assertEqual(absent["midterm_state"], "ABSENT")
        self.assertIsNone(absent["midterm_passed"])

    def test_in_flight_attempt_is_pending(self):
        MidtermAttempt.objects.create(
            midterm=self.mt, student=self.students[3],
            current_state=MidtermAttempt.STATE_ACTIVE, started_at=timezone.now(),
        )
        url = f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/midterms/{self.mt.id}/"
        body = self.c.get(url).json()
        row = next(r for r in body["rows"] if r["student_id"] == self.students[3].id)
        self.assertEqual(row["final_status"], "PENDING")
        self.assertEqual(body["summary"]["pending"], 1)
        self.assertEqual(body["summary"]["absent"], 0)

    def test_teacher_is_forbidden(self):
        tc = APIClient()
        tc.force_authenticate(self.teacher)
        for url in (
            "/api/midterms/admin/reports/classrooms/",
            f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/",
            f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/midterms/{self.mt.id}/",
            f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/midterms/{self.mt.id}/pdf/",
        ):
            self.assertEqual(tc.get(url).status_code, 403, url)

    def test_pdf_endpoint_returns_a_pdf(self):
        url = f"/api/midterms/admin/reports/classrooms/{self.classroom.id}/midterms/{self.mt.id}/pdf/"
        r = self.c.get(url)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))
        self.assertGreater(len(r.content), 1000)


class ReportPdfTests(TestCase):
    """The renderer itself — a 30-student class must not fall off page 1."""

    def _rows(self, n):
        return [
            {
                "student_id": i,
                "student_name": f"Student Number {i}",
                "midterm_score": 500 + i,
                "midterm_state": "COMPLETED",
                "midterm_passed": i % 2 == 0,
                "retake_score": None if i % 2 == 0 else 600,
                "retake_state": None if i % 2 == 0 else "COMPLETED",
                "retake_passed": None if i % 2 == 0 else True,
                "retake_eligible": i % 2 == 1,
                "final_status": "PASSED" if i % 2 == 0 else "PASSED_ON_RETAKE",
            }
            for i in range(n)
        ]

    def _render(self, rows):
        return render_classroom_midterm_report_pdf(
            classroom={"id": 1, "name": "Math Senior A", "subject": "MATH", "level": "senior",
                       "teacher_name": "Nodir T"},
            midterm={"id": 2, "title": "Midterm 12", "subject": "MATH", "subject_label": "Mathematics",
                     "midterm_type": "MIDTERM", "pass_mark": 500, "score_ceiling": 800,
                     "scoring_scale": "SCALE_800"},
            retake=None,
            summary={"students": len(rows), "passed": len(rows), "failed": 0, "absent": 0,
                     "pending": 0, "pass_mark": 500, "average_score": 520},
            rows=rows,
            scheduled_at=timezone.now(),
            generated_at=timezone.now(),
        )

    def test_renders_pdf_bytes(self):
        pdf = self._render(self._rows(3))
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_thirty_students_paginate(self):
        pages = paginate(self._rows(30))
        self.assertGreater(len(pages), 1)
        self.assertEqual(sum(len(p) for p in pages), 30)
        pdf = self._render(self._rows(30))
        self.assertEqual(pdf.count(b"/Type /Page\n"), len(pages))

    def test_empty_roster_still_renders_one_page(self):
        pages = paginate([])
        self.assertEqual(pages, [[]])
        self.assertTrue(self._render([]).startswith(b"%PDF"))


class HeaderTeacherNameTests(TestCase):
    """The classroom-report header must not print the teacher twice when the class name
    already contains them."""

    def test_teacher_in_the_class_name_is_not_appended_again(self):
        from midterms.report_pdf import _name_already_present

        # Real classroom names in this system embed the teacher, e.g. "… · Abdulahad N.".
        self.assertTrue(_name_already_present("Abdulahad Normuhammadov", "Senior G12 · English · Abdulahad N."))

    def test_a_teacher_absent_from_the_name_is_still_appended(self):
        from midterms.report_pdf import _name_already_present

        self.assertFalse(_name_already_present("Nodir Tursunov", "Math Senior A"))

    def test_blank_teacher_never_matches(self):
        from midterms.report_pdf import _name_already_present

        self.assertFalse(_name_already_present("", "Any classroom"))
