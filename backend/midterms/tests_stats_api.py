"""The admin statistics API: who may read it, what an omitted month means, what a bad one does.

    python manage.py test midterms.tests_stats_api --settings=config.settings_test_nomigrations

The numbers themselves are proved in ``midterms.tests_stats``; this module is about the
HTTP contract around them — the permission (these pages rank teachers, so a teacher must not
be able to open one), the month defaulting, and the 400s that stop a mistyped filter from
answering with the whole school under a heading that says otherwise.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Branch, Classroom, ClassroomMembership, Region
from classes.models_schedule import MidtermSchedule
from midterms.models import Midterm
from midterms.tests_stats import (
    LAST_MONTH,
    LAST_MONTH_AT,
    NEXT_MONTH,
    NEXT_MONTH_AT,
    THIS_MONTH,
    THIS_MONTH_AT,
    enrol,
    make_classroom,
    make_midterm,
    sit,
    students,
)

User = get_user_model()

# Anchored to the real clock, never to a literal. Half of what this module asserts is which
# month the page OPENS on, and "the newest month with data" and "the newest month the school
# has actually reached" are the same answer only until a fixture month slips into the future.

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

        self.earlier = make_midterm("Midterm 12")
        self.recent = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.earlier, starts_at=LAST_MONTH_AT
        )
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.recent, starts_at=THIS_MONTH_AT
        )
        MidtermSchedule.objects.create(
            classroom=self.english, midterm=self.earlier, starts_at=LAST_MONTH_AT
        )
        for student in self.students[:3]:
            sit(self.earlier, student, score=800, when=LAST_MONTH_AT)
        sit(self.earlier, self.students[3], score=200, when=LAST_MONTH_AT)

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
        self.assertEqual(body["months"], [THIS_MONTH, LAST_MONTH])
        self.assertEqual(body["current"], THIS_MONTH)

    def test_months_is_empty_rather_than_absent_when_there_is_no_data(self):
        Midterm.objects.all().delete()
        body = self.c.get(MONTHS_URL).json()
        self.assertEqual(body["months"], [])
        self.assertIsNone(body["current"])

    # ── the monthly roll-up ──────────────────────────────────────────────────
    def test_an_omitted_month_opens_on_the_newest_one_with_data(self):
        body = self.c.get(MONTHLY_URL).json()
        self.assertEqual(body["month"], THIS_MONTH)
        self.assertEqual(body["months"], [THIS_MONTH, LAST_MONTH])

    def test_a_named_month_carries_the_pooled_numbers_and_the_definition(self):
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual(body["month"], LAST_MONTH)
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
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH, "teacher": self.teacher.id}).json()
        self.assertEqual(body["totals"]["roster"], 4)
        self.assertEqual(body["filters"]["teacher"], self.teacher.id)

        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH, "branch": self.branch.id}).json()
        self.assertEqual(body["totals"]["roster"], 4)

        # Either subject vocabulary names the same department.
        for spelling in ("ENGLISH", "READING_WRITING", "english"):
            body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH, "subject": spelling}).json()
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
        body = self.c.get(self.classroom_url(), {"month": LAST_MONTH}).json()
        self.assertEqual(body["month"], LAST_MONTH)
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
        self.assertEqual(body["month"], THIS_MONTH)
        self.assertEqual(body["months"], [THIS_MONTH, LAST_MONTH])
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
        MidtermSchedule.objects.create(classroom=classroom, midterm=midterm, starts_at=LAST_MONTH_AT)
        for student in roster:
            sit(midterm, student, score=800, when=LAST_MONTH_AT)
        # The removed student sat it before they left; the verdict exists but they are off
        # the roster, so they raise neither the numerator nor the denominator.
        sit(midterm, gone, score=200, when=LAST_MONTH_AT)

        body = client.get(
            f"/api/midterms/admin/stats/classrooms/{classroom.id}/", {"month": LAST_MONTH}
        ).json()
        self.assertEqual(body["summary"]["roster"], 3)
        self.assertEqual(body["summary"]["pass_rate"], 100.0)

        report = client.get(
            f"/api/midterms/admin/reports/classrooms/{classroom.id}/midterms/{midterm.id}/"
        ).json()
        self.assertEqual(body["summary"]["roster"], report["summary"]["students"])


class DefaultMonthTests(TestCase):
    """The page must never open on a month the school has not reached.

    ``MidtermSchedule.starts_at`` is mandatory on every teacher assign path, so a midterm
    assigned for next month already carries next month; unbounded, that becomes the newest
    month, becomes the default, and reads as a full roster of absentees. An admin opening the
    page is told the school scored 0% — and the page's own empty branch does not catch it,
    because ``totals.midterms`` is 1, so the tile, the tables and the chart all render as
    real data.
    """

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 10)
        enrol(self.classroom, *self.students)

        self.sat = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.sat, starts_at=THIS_MONTH_AT
        )
        for student in self.students[:9]:
            sit(self.sat, student, score=800, when=THIS_MONTH_AT)
        sit(self.sat, self.students[9], score=200, when=THIS_MONTH_AT)

        self.planned = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.planned, starts_at=NEXT_MONTH_AT
        )

    def test_the_months_endpoint_does_not_hand_back_a_future_default(self):
        body = self.c.get(MONTHS_URL).json()
        self.assertEqual(body["months"], [NEXT_MONTH, THIS_MONTH])
        self.assertEqual(body["current"], THIS_MONTH)
        self.assertEqual(body["this_month"], THIS_MONTH)
        self.assertEqual(body["future_months"], [NEXT_MONTH])

    def test_an_omitted_month_opens_on_the_newest_month_actually_sat(self):
        body = self.c.get(MONTHLY_URL).json()
        self.assertEqual(body["month"], THIS_MONTH)
        self.assertFalse(body["is_future"])
        self.assertEqual(body["totals"]["pass_rate"], 90.0)

    def test_a_future_month_may_be_asked_for_but_says_it_is_only_scheduled(self):
        body = self.c.get(MONTHLY_URL, {"month": NEXT_MONTH}).json()
        self.assertEqual(body["month"], NEXT_MONTH)
        self.assertTrue(body["is_future"])
        self.assertEqual(body["future_months"], [NEXT_MONTH])
        self.assertEqual(body["totals"]["absent"], 10)

    def test_a_classroom_opens_on_the_newest_month_it_actually_sat(self):
        url = f"/api/midterms/admin/stats/classrooms/{self.classroom.id}/"
        body = self.c.get(url).json()
        self.assertEqual(body["month"], THIS_MONTH)
        self.assertFalse(body["is_future"])
        self.assertEqual(body["months"], [NEXT_MONTH, THIS_MONTH])
        self.assertEqual(body["future_months"], [NEXT_MONTH])
        self.assertEqual(body["summary"]["pass_rate"], 90.0)

    def test_a_classroom_that_has_only_a_scheduled_month_opens_on_nothing(self):
        MidtermSchedule.objects.filter(midterm=self.sat).update(starts_at=NEXT_MONTH_AT)
        body = self.c.get(f"/api/midterms/admin/stats/classrooms/{self.classroom.id}/").json()
        self.assertIsNone(body["month"])
        self.assertEqual(body["months"], [NEXT_MONTH])
        self.assertEqual(body["future_months"], [NEXT_MONTH])
        self.assertFalse(body["is_future"])
        self.assertEqual(body["rows"], [])


class UnpaddedMonthTests(TestCase):
    """``strptime("2026-9", "%Y-%m")`` succeeds, and no key in the index is unpadded."""

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.classroom = make_classroom("Math Senior A", self.admin)
        roster = students("s", 4)
        enrol(self.classroom, *roster)
        midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=midterm, starts_at=LAST_MONTH_AT
        )
        for student in roster:
            sit(midterm, student, score=800, when=LAST_MONTH_AT)

    def _unpadded(self, month_key):
        year, month = month_key.split("-")
        return f"{year}-{int(month)}"

    def test_an_unpadded_month_is_a_400_rather_than_an_empty_page(self):
        """It matched no zero-padded key, fell through to the empty shell, and the page said
        "No midterms in this month" for a month with a full set of results."""
        padded = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual(padded["totals"]["roster"], 4)

        r = self.c.get(MONTHLY_URL, {"month": self._unpadded(LAST_MONTH)})
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("YYYY-MM", r.json()["detail"])

    def test_an_unpadded_month_on_a_classroom_is_a_400_too(self):
        url = f"/api/midterms/admin/stats/classrooms/{self.classroom.id}/"
        r = self.c.get(url, {"month": self._unpadded(LAST_MONTH)})
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("YYYY-MM", r.json()["detail"])


class ScopedMonthPickerTests(TestCase):
    """A filtered request gets its own month list, and its own default."""

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.region = Region.objects.create(name="Tashkent")
        self.chilonzor = Branch.objects.create(region=self.region, name="Chilonzor")
        self.yunusobod = Branch.objects.create(region=self.region, name="Yunusobod")
        self.nodir = User.objects.create(
            username="t1", role="teacher", first_name="Nodir", last_name="T"
        )

        self.old_class = make_classroom(
            "Math Senior A", self.admin, teacher=self.nodir, branch=self.chilonzor
        )
        self.new_class = make_classroom("Math Senior B", self.admin, branch=self.yunusobod)
        old_roster = students("a", 4)
        new_roster = students("b", 4)
        enrol(self.old_class, *old_roster)
        enrol(self.new_class, *new_roster)

        old_paper = make_midterm("Midterm 12")
        new_paper = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.old_class, midterm=old_paper, starts_at=LAST_MONTH_AT
        )
        MidtermSchedule.objects.create(
            classroom=self.new_class, midterm=new_paper, starts_at=THIS_MONTH_AT
        )
        for student in old_roster:
            sit(old_paper, student, score=800, when=LAST_MONTH_AT)
        for student in new_roster:
            sit(new_paper, student, score=800, when=THIS_MONTH_AT)

    def test_the_picker_offers_only_the_months_the_filtered_scope_has(self):
        """Unscoped it offered both, so choosing Chilonzor and then this month produced an
        empty table under a month the picker itself had just offered."""
        body = self.c.get(MONTHLY_URL, {"branch": self.chilonzor.id}).json()
        self.assertEqual(body["months"], [LAST_MONTH])
        body = self.c.get(MONTHLY_URL, {"branch": self.yunusobod.id}).json()
        self.assertEqual(body["months"], [THIS_MONTH])

    def test_a_filtered_request_with_no_month_opens_on_a_month_it_has_data_for(self):
        body = self.c.get(MONTHLY_URL, {"branch": self.chilonzor.id}).json()
        self.assertEqual(body["month"], LAST_MONTH)
        self.assertEqual(body["totals"]["roster"], 4)
        self.assertEqual(body["totals"]["pass_rate"], 100.0)

        body = self.c.get(MONTHLY_URL, {"teacher": self.nodir.id}).json()
        self.assertEqual(body["month"], LAST_MONTH)
        self.assertEqual(body["totals"]["roster"], 4)

    def test_a_filter_that_matches_no_classroom_offers_no_months(self):
        body = self.c.get(MONTHLY_URL, {"teacher": 999999}).json()
        self.assertEqual(body["months"], [])
        self.assertIsNone(body["month"])
        self.assertIsNone(body["totals"]["pass_rate"])
        self.assertEqual(body["filters"]["teacher"], 999999)


class OrphanRetakeApiTests(TestCase):
    """A parentless RETAKE is left out of every number, and the payload names it."""

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 10)
        enrol(self.classroom, *self.students)

        self.midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=LAST_MONTH_AT
        )
        for student in self.students[:9]:
            sit(self.midterm, student, score=800, when=LAST_MONTH_AT)
        sit(self.midterm, self.students[9], score=200, when=LAST_MONTH_AT)

        self.orphan = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE)
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.orphan, starts_at=LAST_MONTH_AT
        )
        sit(self.orphan, self.students[9], score=800, when=LAST_MONTH_AT)

    def test_the_monthly_payload_excludes_it_and_discloses_it(self):
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual(body["totals"]["roster"], 10)      # not 20
        self.assertEqual(body["totals"]["pass_rate"], 90.0)  # not 50.0
        self.assertEqual(body["totals"]["midterms"], 1)
        self.assertEqual(
            body["orphan_retakes"], [{"id": self.orphan.id, "title": "Midterm 12 Retake"}]
        )

    def test_the_classroom_payload_excludes_it_and_discloses_it(self):
        url = f"/api/midterms/admin/stats/classrooms/{self.classroom.id}/"
        body = self.c.get(url, {"month": LAST_MONTH}).json()
        self.assertEqual([row["title"] for row in body["rows"]], ["Midterm 12"])
        self.assertEqual(body["summary"]["pass_rate"], 90.0)
        self.assertEqual(
            body["orphan_retakes"], [{"id": self.orphan.id, "title": "Midterm 12 Retake"}]
        )

    def test_a_clean_month_carries_an_empty_warning_list_rather_than_no_key(self):
        self.orphan.retake_of = self.midterm
        self.orphan.save(update_fields=["retake_of"])
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual(body["orphan_retakes"], [])
        self.assertEqual(body["totals"]["pass_rate"], 100.0)


class HierarchyApiTests(TestCase):
    """The monthly payload carries the tree, and says where to open it.

    The numbers in it are proved in ``midterms.tests_stats``; what matters here is that the
    HTTP surface carries both keys on EVERY response — including an empty month — because a
    page that reads a key only when it happens to be there cannot tell "this month has no
    tree" from "an older backend that never sent one", and would render the second as the
    first: an empty state over a failure, which is the one thing this page must never do.
    """

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.c = APIClient()
        self.c.force_authenticate(self.admin)

        self.region = Region.objects.create(name="Fergana")
        self.branch = Branch.objects.create(region=self.region, name="Fergana city")
        self.teacher = User.objects.create(
            username="t1", role="teacher", first_name="Nodir", last_name="T"
        )
        self.maths = make_classroom(
            "Math Senior A", self.admin, teacher=self.teacher, branch=self.branch
        )
        self.english = make_classroom(
            "English Senior B", self.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=self.teacher, branch=self.branch,
        )
        self.maths_students = students("a", 4)
        self.english_students = students("b", 2)
        enrol(self.maths, *self.maths_students)
        enrol(self.english, *self.english_students)

        self.midterm = make_midterm("Midterm 12")
        for classroom in (self.maths, self.english):
            MidtermSchedule.objects.create(
                classroom=classroom, midterm=self.midterm, starts_at=LAST_MONTH_AT
            )
        for student in self.maths_students[:3]:
            sit(self.midterm, student, score=800, when=LAST_MONTH_AT)
        for student in self.maths_students[3:]:
            sit(self.midterm, student, score=200, when=LAST_MONTH_AT)
        for student in self.english_students:
            sit(self.midterm, student, score=800, when=LAST_MONTH_AT)

    def test_the_monthly_payload_carries_the_tree_and_where_to_open_it(self):
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual(
            body["tree_open_path"], [f"region:{self.region.id}", f"branch:{self.branch.id}"]
        )
        self.assertEqual([node["name"] for node in body["tree"]], ["Fergana"])
        region = body["tree"][0]
        self.assertEqual(region["level"], "region")
        self.assertEqual(region["roster"], 6)
        self.assertEqual(region["passed"], 5)
        self.assertEqual(region["pass_rate"], 83.3)
        branch = region["children"][0]
        self.assertEqual(branch["key"], f"branch:{self.branch.id}")
        departments = {node["name"]: node for node in branch["children"]}
        self.assertEqual(set(departments), {"English", "Math"})
        self.assertEqual(departments["English"]["pass_rate"], 100.0)
        self.assertEqual(departments["Math"]["pass_rate"], 75.0)
        # Down to a classroom leaf, through the teacher.
        teacher = departments["Math"]["children"][0]
        self.assertEqual(teacher["name"], "Nodir T")
        self.assertEqual(teacher["id"], self.teacher.id)
        leaf = teacher["children"][0]
        self.assertEqual(leaf["level"], "classroom")
        self.assertEqual(leaf["id"], self.maths.id)
        self.assertNotIn("children", leaf)

    def test_the_tree_agrees_with_the_totals_it_is_sent_beside(self):
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        totals = body["totals"]
        for key in ("roster", "passed", "attended", "absent", "classrooms", "midterms"):
            self.assertEqual(sum(node[key] for node in body["tree"]), totals[key], key)
        self.assertEqual(totals["pass_rate"], body["tree"][0]["pass_rate"])

    def test_an_empty_month_carries_an_empty_tree_rather_than_no_key(self):
        body = self.c.get(MONTHLY_URL, {"month": "2026-01"})
        self.assertEqual(body.status_code, 200, body.content)
        body = body.json()
        self.assertEqual(body["tree"], [])
        self.assertEqual(body["tree_open_path"], [])

    def test_a_filter_that_matches_nothing_still_carries_both_keys(self):
        body = self.c.get(MONTHLY_URL, {"teacher": 999999}).json()
        self.assertEqual(body["tree"], [])
        self.assertEqual(body["tree_open_path"], [])

    def test_the_flat_tables_are_still_there_beside_it(self):
        """The page being rebuilt is not the only reader this endpoint has."""
        body = self.c.get(MONTHLY_URL, {"month": LAST_MONTH}).json()
        self.assertEqual([row["name"] for row in body["branches"]], ["Fergana city"])
        self.assertEqual(len(body["departments"]), 2)
        self.assertEqual([row["name"] for row in body["teachers"]], ["Nodir T"])
        self.assertEqual(len(body["classrooms"]), 2)
