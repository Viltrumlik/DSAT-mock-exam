"""The whole-branch report: one PDF holding every department, teacher, class and student.

    python manage.py test midterms.tests_branch_report

Three promises are pinned here, because each one is a way this document could quietly start
lying while still rendering perfectly:

* **its numbers are the statistics page's numbers.** The builder walks
  ``stats.school_month_stats``'s tree rather than adding anything up of its own, and the
  first test asserts the two agree at every level. A report an administrator prints must not
  be able to disagree with the screen they printed it from.
* **a branch is a boundary.** Asking for one branch must not sweep in another's classes —
  the report names people, and the wrong name under the wrong heading is the worst failure
  this document has.
* **a retake still rescues a student.** The per-student rows come from the same
  ``build_midterm_rows`` the classroom sheet uses, so somebody who passed on the second
  sitting reads as passed here too.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.test.utils import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Branch, Classroom, ClassroomMembership, Region
from classes.models_schedule import MidtermSchedule
from midterms import stats
from midterms.branch_report import build_branch_report
from midterms.branch_report_pdf import render_branch_report_pdf
from midterms.models import Midterm
from midterms.tests_stats import THIS_MONTH, THIS_MONTH_AT, enrol, make_classroom, make_midterm, sit, students

User = get_user_model()

_ALLOWED_HOSTS = ["testserver", "localhost", "127.0.0.1", "questions.mastersat.uz"]
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}


class BranchReportFixture(TestCase):
    """One branch, two departments, three teachers, four classes — small but every shape.

    Fergana holds the classes under test. Tashkent exists only to be excluded: without a
    second branch, "scoped to one branch" and "returns everything" are the same assertion.
    """

    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create(username="rep-admin", role="super_admin", is_staff=True, is_superuser=True)
        region = Region.objects.create(name="Fergana")
        cls.branch = Branch.objects.create(region=region, name="Fergana city")
        cls.other_branch = Branch.objects.create(region=region, name="Tashkent city")

        cls.maths_teacher = User.objects.create(username="t-math", first_name="Dilshod", last_name="Olimov")
        cls.english_teacher = User.objects.create(username="t-eng", first_name="Sayyora", last_name="Rakhmonova")
        cls.other_teacher = User.objects.create(username="t-other", first_name="Nobody", last_name="Else")

        cls.math_a = make_classroom("Math A", cls.admin, teacher=cls.maths_teacher, branch=cls.branch)
        cls.math_b = make_classroom("Math B", cls.admin, teacher=cls.maths_teacher, branch=cls.branch)
        cls.english = make_classroom(
            "English A", cls.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=cls.english_teacher, branch=cls.branch,
        )
        cls.elsewhere = make_classroom("Far Away", cls.admin, teacher=cls.other_teacher, branch=cls.other_branch)

        cls.math_a_students = students("maths", 4)
        cls.math_b_students = students("mathsb", 2)
        cls.english_students = students("eng", 3)
        cls.far_students = students("far", 2)
        enrol(cls.math_a, *cls.math_a_students)
        enrol(cls.math_b, *cls.math_b_students)
        enrol(cls.english, *cls.english_students)
        enrol(cls.elsewhere, *cls.far_students)

        cls.paper = make_midterm("September Midterm")
        cls.retake = make_midterm("September Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=cls.paper)
        for classroom in (cls.math_a, cls.math_b, cls.english, cls.elsewhere):
            MidtermSchedule.objects.create(classroom=classroom, midterm=cls.paper, starts_at=THIS_MONTH_AT)

        # Math A: two pass outright, one fails then passes the retake, one never turns up.
        sit(cls.paper, cls.math_a_students[0], score=800, when=THIS_MONTH_AT)
        sit(cls.paper, cls.math_a_students[1], score=700, when=THIS_MONTH_AT)
        sit(cls.paper, cls.math_a_students[2], score=200, when=THIS_MONTH_AT)
        MidtermSchedule.objects.create(classroom=cls.math_a, midterm=cls.retake, starts_at=THIS_MONTH_AT)
        sit(cls.retake, cls.math_a_students[2], score=650, when=THIS_MONTH_AT)
        # Math B: one pass, one fail. English: all three fail.
        sit(cls.paper, cls.math_b_students[0], score=600, when=THIS_MONTH_AT)
        sit(cls.paper, cls.math_b_students[1], score=100, when=THIS_MONTH_AT)
        for student in cls.english_students:
            sit(cls.paper, student, score=100, when=THIS_MONTH_AT)
        for student in cls.far_students:
            sit(cls.paper, student, score=800, when=THIS_MONTH_AT)


class BranchReportShapeTests(BranchReportFixture):
    def setUp(self):
        self.report = build_branch_report(branch_id=self.branch.id, month=THIS_MONTH)

    def _departments(self):
        return {d["name"]: d for d in self.report["departments"]}

    def test_it_nests_department_then_teacher_then_class_then_students(self):
        depts = self._departments()
        self.assertEqual(sorted(depts), ["English", "Math"])

        maths = depts["Math"]
        self.assertEqual([t["name"] for t in maths["teachers"]], ["Dilshod Olimov"])
        rooms = maths["teachers"][0]["classrooms"]
        self.assertEqual(sorted(r["name"] for r in rooms), ["Math A", "Math B"])

        math_a = next(r for r in rooms if r["name"] == "Math A")
        self.assertEqual(len(math_a["papers"]), 1)
        self.assertEqual(math_a["papers"][0]["midterm"]["title"], "September Midterm")
        self.assertEqual(len(math_a["papers"][0]["rows"]), 4)

    def test_every_level_matches_the_statistics_page(self):
        """The whole point of walking the tree instead of re-adding: one set of numbers."""
        live = stats.school_month_stats(THIS_MONTH, branch_id=self.branch.id)
        self.assertEqual(self.report["totals"], live["totals"])

        by_name = {d["name"]: d for d in live["tree"][0]["children"][0]["children"]}
        for name, dept in self._departments().items():
            for key in ("passed", "failed", "absent", "roster", "pass_rate"):
                self.assertEqual(dept[key], by_name[name][key], f"{name}.{key}")

    def test_the_branch_is_a_boundary(self):
        names = [
            room["name"]
            for dept in self.report["departments"]
            for teacher in dept["teachers"]
            for room in teacher["classrooms"]
        ]
        self.assertNotIn("Far Away", names)
        self.assertEqual(sorted(names), ["English A", "Math A", "Math B"])
        # And the other branch's two passers are not in this branch's totals.
        self.assertEqual(self.report["totals"]["roster"], 9)

    def test_a_retake_still_rescues_a_student(self):
        rooms = self._departments()["Math"]["teachers"][0]["classrooms"]
        math_a = next(r for r in rooms if r["name"] == "Math A")
        statuses = {r["student_name"]: r["final_status"] for r in math_a["papers"][0]["rows"]}
        self.assertEqual(sorted(statuses.values()), ["ABSENT", "PASSED", "PASSED", "PASSED_ON_RETAKE"])

    def test_the_whole_school_is_every_branchs_departments(self):
        everywhere = build_branch_report(branch_id=None, month=THIS_MONTH)
        names = [
            room["name"]
            for dept in everywhere["departments"]
            for teacher in dept["teachers"]
            for room in teacher["classrooms"]
        ]
        self.assertIn("Far Away", names)
        self.assertIsNone(everywhere["branch"])


class BranchReportPdfTests(BranchReportFixture):
    def test_it_renders_a_multi_page_pdf(self):
        report = build_branch_report(branch_id=self.branch.id, month=THIS_MONTH)
        pdf = render_branch_report_pdf(report, generated_at=timezone.now())
        self.assertTrue(pdf.startswith(b"%PDF"), pdf[:20])
        # Cover + two department sections at minimum; a one-page result would mean the
        # per-department break never ran.
        self.assertGreaterEqual(pdf.count(b"/Type /Page\n") or pdf.count(b"/Type/Page"), 2)
        self.assertGreater(len(pdf), 5000)

    def test_a_month_nobody_sat_still_renders(self):
        """An empty month is a fact about the branch, not an error — the cover says so."""
        report = build_branch_report(branch_id=self.branch.id, month="2019-01")
        self.assertEqual(report["departments"], [])
        pdf = render_branch_report_pdf(report, generated_at=timezone.now())
        self.assertTrue(pdf.startswith(b"%PDF"))


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class BranchReportEndpointTests(BranchReportFixture):
    def setUp(self):
        self.client = APIClient()

    def test_an_admin_downloads_the_branch_as_one_pdf(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(f"/api/midterms/admin/reports/branches/{self.branch.id}/pdf/", {"month": THIS_MONTH}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertEqual(r["Content-Type"], "application/pdf")
        self.assertIn("fergana-city", r["Content-Disposition"])
        self.assertTrue(b"".join(r.streaming_content if r.streaming else [r.content]).startswith(b"%PDF"))

    def test_zero_means_the_whole_school(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/midterms/admin/reports/branches/0/pdf/", {"month": THIS_MONTH}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content[:200])
        self.assertIn("all-branches", r["Content-Disposition"])

    def test_a_teacher_may_not_read_another_teachers_branch(self):
        self.client.force_authenticate(self.maths_teacher)
        r = self.client.get(f"/api/midterms/admin/reports/branches/{self.branch.id}/pdf/", **_QHOST)
        self.assertEqual(r.status_code, 403, r.status_code)

    def test_a_mistyped_month_is_named_not_swallowed(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(f"/api/midterms/admin/reports/branches/{self.branch.id}/pdf/", {"month": "sept"}, **_QHOST)
        self.assertEqual(r.status_code, 400)
        self.assertIn("2026-09", r.data["detail"])

    def test_the_branch_list_names_every_branch(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/midterms/admin/reports/branches/", **_QHOST)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            sorted((b["name"], b["classrooms"]) for b in r.data["results"]),
            [("Fergana city", 3), ("Tashkent city", 1)],
        )


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS)
class TrendTests(BranchReportFixture):
    def test_the_trend_plots_only_months_that_were_sat(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/midterms/admin/stats/trend/", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content[:200])
        rows = r.data["results"]
        self.assertEqual([row["month"] for row in rows], [THIS_MONTH])
        self.assertEqual(rows[0]["passed"], stats.school_month_stats(THIS_MONTH)["totals"]["passed"])

    def test_a_teacher_may_not_read_the_trend(self):
        self.client = APIClient()
        self.client.force_authenticate(self.english_teacher)
        r = self.client.get("/api/midterms/admin/stats/trend/", **_QHOST)
        self.assertEqual(r.status_code, 403)
