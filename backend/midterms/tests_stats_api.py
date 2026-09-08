"""The admin statistics API: who may read it, what an omitted month means, what a bad one does.

    python manage.py test midterms.tests_stats_api --settings=config.settings_test_nomigrations

The numbers themselves are proved in ``midterms.tests_stats``; this module is about the
HTTP contract around them — the permission (these pages rank teachers, so a teacher must not
be able to open one), the month defaulting, and the 400s that stop a mistyped filter from
answering with the whole school under a heading that says otherwise.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Branch, Classroom, ClassroomMembership, Region
from classes.models_schedule import MidtermSchedule
from midterms.models import Midterm
from midterms.tests_stats import enrol, make_classroom, make_midterm, sit, students

User = get_user_model()

SEPTEMBER = timezone.make_aware(timezone.datetime(2026, 9, 10, 9, 0))
OCTOBER = timezone.make_aware(timezone.datetime(2026, 10, 12, 9, 0))

MONTHS_URL = "/api/midterms/admin/stats/months/"
MONTHLY_URL = "/api/midterms/admin/stats/monthly/"


class StatsApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.teacher = User.objects.create(
            username="t1", role="teacher", first_name="Nodir", last_name="T"
        )
        self.student = User.objects.create(username="pupil", role="student")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)

        self.region = Region.objects.create(name="Tashkent")
        self.branch = Branch.objects.create(region=self.region, name="Chilonzor")
        self.classroom = make_classroom(
            "Math Senior A", self.admin, teacher=self.teacher, branch=self.branch
        )
        self.english = make_classroom(
            "English Senior B", self.admin, subject=Classroom.SUBJECT_ENGLISH
        )
        self.students = students("s", 4)
        enrol(self.classroom, *self.students)
        enrol(self.english, *students("e", 2))

        self.september = make_midterm("Midterm 12")
        self.october = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.september, starts_at=SEPTEMBER
        )
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.october, starts_at=OCTOBER
        )
        MidtermSchedule.objects.create(
            classroom=self.english, midterm=self.september, starts_at=SEPTEMBER
        )
        for student in self.students[:3]:
            sit(self.september, student, score=800, when=SEPTEMBER)
        sit(self.september, self.students[3], score=200, when=SEPTEMBER)

    def classroom_url(self, classroom=None):
        return f"/api/midterms/admin/stats/classrooms/{(classroom or self.classroom).id}/"

    # ── permission ───────────────────────────────────────────────────────────
    def test_a_teacher_may_not_read_the_statistics(self):
        """The page ranks teachers against each other. ``CanManageQuestions`` would let one in."""
        tc = APIClient()
        tc.force_authenticate(self.teacher)
        for url in (MONTHS_URL, MONTHLY_URL, self.classroom_url()):
            self.assertEqual(tc.get(url).status_code, 403, url)

    def test_a_student_may_not_read_the_statistics(self):
        sc = APIClient()
        sc.force_authenticate(self.student)
        self.assertEqual(sc.get(MONTHLY_URL).status_code, 403)

    def test_anonymous_is_refused(self):
        self.assertIn(APIClient().get(MONTHLY_URL).status_code, (401, 403))

    # ── months ───────────────────────────────────────────────────────────────
    def test_months_are_newest_first_and_name_a_current_one(self):
        body = self.c.get(MONTHS_URL).json()
        self.assertEqual(body["months"], ["2026-10", "2026-09"])
        self.assertEqual(body["current"], "2026-10")

    def test_months_is_empty_rather_than_absent_when_there_is_no_data(self):
        Midterm.objects.all().delete()
        body = self.c.get(MONTHS_URL).json()
        self.assertEqual(body["months"], [])
        self.assertIsNone(body["current"])

    # ── the monthly roll-up ──────────────────────────────────────────────────
    def test_an_omitted_month_opens_on_the_newest_one_with_data(self):
        body = self.c.get(MONTHLY_URL).json()
        self.assertEqual(body["month"], "2026-10")
        self.assertEqual(body["months"], ["2026-10", "2026-09"])

    def test_a_named_month_carries_the_pooled_numbers_and_the_definition(self):
        body = self.c.get(MONTHLY_URL, {"month": "2026-09"}).json()
        self.assertEqual(body["month"], "2026-09")
        self.assertEqual(body["totals"]["roster"], 6)      # 4 + the 2-student English class
        self.assertEqual(body["totals"]["passed"], 3)
        self.assertEqual(body["totals"]["pass_rate"], 50.0)
        self.assertEqual(
            body["definition"]["pass_rate"],
            "passed (first sitting or retake) / all roster students",
        )
        self.assertEqual(body["definition"]["absent_counts_as"], "failed")
        self.assertEqual(body["definition"]["rollup"], "pooled")
        self.assertEqual({row["name"] for row in body["branches"]}, {"Chilonzor", "Unassigned"})

    def test_a_month_with_no_data_is_an_empty_month_not_an_error(self):
        body = self.c.get(MONTHLY_URL, {"month": "2026-01"})
        self.assertEqual(body.status_code, 200, body.content)
        body = body.json()
        self.assertEqual(body["month"], "2026-01")
        self.assertEqual(body["classrooms"], [])
        self.assertIsNone(body["totals"]["pass_rate"])

    def test_filters_are_applied_and_echoed(self):
        body = self.c.get(MONTHLY_URL, {"month": "2026-09", "teacher": self.teacher.id}).json()
        self.assertEqual(body["totals"]["roster"], 4)
        self.assertEqual(body["filters"]["teacher"], self.teacher.id)

        body = self.c.get(MONTHLY_URL, {"month": "2026-09", "branch": self.branch.id}).json()
        self.assertEqual(body["totals"]["roster"], 4)

        # Either subject vocabulary names the same department.
        for spelling in ("ENGLISH", "READING_WRITING", "english"):
            body = self.c.get(MONTHLY_URL, {"month": "2026-09", "subject": spelling}).json()
            self.assertEqual(body["totals"]["roster"], 2, spelling)
            self.assertEqual(body["filters"]["subject"], Classroom.SUBJECT_ENGLISH)

    def test_a_malformed_month_is_a_400_that_says_what_was_expected(self):
        r = self.c.get(MONTHLY_URL, {"month": "September"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("YYYY-MM", r.json()["detail"])

        r = self.c.get(MONTHLY_URL, {"month": "2026-13"})
        self.assertEqual(r.status_code, 400, r.content)

    def test_a_non_numeric_filter_is_a_400_rather_than_being_ignored(self):
        """Ignoring it would answer with the whole school under a filtered heading."""
        r = self.c.get(MONTHLY_URL, {"branch": "chilonzor"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("branch", r.json()["detail"])
        self.assertEqual(self.c.get(MONTHLY_URL, {"teacher": "nodir"}).status_code, 400)

    def test_an_unknown_subject_is_a_400_that_lists_the_options(self):
        r = self.c.get(MONTHLY_URL, {"subject": "PHYSICS"})
        self.assertEqual(r.status_code, 400)
        detail = r.json()["detail"]
        self.assertIn("ENGLISH", detail)
        self.assertIn("MATH", detail)

    # ── one classroom ────────────────────────────────────────────────────────
    def test_a_classroom_month_lists_its_midterms(self):
        body = self.c.get(self.classroom_url(), {"month": "2026-09"}).json()
        self.assertEqual(body["month"], "2026-09")
        self.assertEqual(body["classroom"]["name"], "Math Senior A")
        self.assertEqual(body["classroom"]["subject_label"], "Math")
        self.assertEqual(body["classroom"]["teacher"]["name"], "Nodir T")
        self.assertEqual(body["classroom"]["branch"]["name"], "Chilonzor")
        self.assertEqual([row["title"] for row in body["rows"]], ["Midterm 12"])
        self.assertEqual(body["rows"][0]["pass_rate"], 75.0)
        self.assertEqual(body["rows"][0]["month_basis"], "schedule")
        self.assertEqual(body["summary"]["roster"], 4)
        self.assertEqual(body["summary"]["pass_rate"], 75.0)
        self.assertEqual(body["definition"]["rollup"], "pooled")

    def test_a_classroom_defaults_to_its_own_newest_month(self):
        body = self.c.get(self.classroom_url()).json()
        self.assertEqual(body["month"], "2026-10")
        self.assertEqual(body["months"], ["2026-10", "2026-09"])
        # October's paper was scheduled but never sat: absent counts as failed.
        self.assertEqual(body["summary"]["absent"], 4)
        self.assertEqual(body["summary"]["pass_rate"], 0.0)

    def test_a_classroom_with_no_midterms_at_all_is_empty_not_a_404(self):
        idle = make_classroom("Nobody Yet", self.admin)
        enrol(idle, *students("z", 3))
        body = self.c.get(self.classroom_url(idle))
        self.assertEqual(body.status_code, 200, body.content)
        body = body.json()
        self.assertIsNone(body["month"])
        self.assertEqual(body["months"], [])
        self.assertEqual(body["rows"], [])
        self.assertIsNone(body["summary"]["pass_rate"])

    def test_an_unknown_classroom_is_a_404(self):
        self.assertEqual(self.c.get("/api/midterms/admin/stats/classrooms/999999/").status_code, 404)

    def test_a_malformed_month_on_a_classroom_is_a_400(self):
        r = self.c.get(self.classroom_url(), {"month": "2026/09"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("YYYY-MM", r.json()["detail"])

    def test_the_new_routes_did_not_shadow_the_existing_admin_ones(self):
        """``admin/stats/…`` is declared alongside ``admin/`` (the builder router) and
        ``admin/reports/…``; all three must still resolve."""
        self.assertEqual(self.c.get("/api/midterms/admin/reports/classrooms/").status_code, 200)
        self.assertEqual(self.c.get("/api/midterms/admin/midterms/").status_code, 200)


class RemovedStudentTests(TestCase):
    """The denominator the API prints has to be the one the ops report already shows."""

    def test_a_removed_member_is_in_neither_half_of_the_rate(self):
        admin = User.objects.create(username="adm", role="admin")
        client = APIClient()
        client.force_authenticate(admin)
        classroom = make_classroom("Math Senior A", admin)
        roster = students("s", 3)
        enrol(classroom, *roster)
        gone = User.objects.create(username="gone")
        enrol(classroom, gone, status=ClassroomMembership.STATUS_REMOVED)

        midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(classroom=classroom, midterm=midterm, starts_at=SEPTEMBER)
        for student in roster:
            sit(midterm, student, score=800, when=SEPTEMBER)
        # The removed student sat it before they left; the verdict exists but they are off
        # the roster, so they raise neither the numerator nor the denominator.
        sit(midterm, gone, score=200, when=SEPTEMBER)

        body = client.get(
            f"/api/midterms/admin/stats/classrooms/{classroom.id}/", {"month": "2026-09"}
        ).json()
        self.assertEqual(body["summary"]["roster"], 3)
        self.assertEqual(body["summary"]["pass_rate"], 100.0)

        report = client.get(
            f"/api/midterms/admin/reports/classrooms/{classroom.id}/midterms/{midterm.id}/"
        ).json()
        self.assertEqual(body["summary"]["roster"], report["summary"]["students"])
