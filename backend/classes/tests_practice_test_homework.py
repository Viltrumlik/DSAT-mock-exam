"""Practice tests in homework: the teacher's picker, the launcher, results, the certificate title
and the Windows past-paper list.

A practice test is a ``PracticeTest`` section with ``is_practice_test=True``. Picking one writes
``practice_test_ids`` exactly like a past paper, so grant / grade / launcher are shared; what
differs is how it is NAMED ("Practice Test N") and where it is LISTED (its own picker tab, never
among the past papers).
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.pastpaper_certificate import _paper_title
from desktop.v1.home import pastpaper_rows
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()
OPTIONS_URL = "/api/classes/{id}/assignment-options/"
RESULTS_URL = "/api/classes/{id}/results/"


class PracticeTestHomeworkTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(
            email="pth_teacher@example.com", password="pw",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(email="pth_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.room = Classroom.objects.create(
            name="Math", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.create(classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT)
        self.practice = PracticeTest.objects.create(
            subject="MATH", title="Algebra focus", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_HOMEWORK_ONLY, practice_level="middle", practice_number=4,
        )
        seed_mc_questions_for_practice_test(self.practice)
        self.pastpaper = PracticeTest.objects.create(subject="MATH", title="Oct 2025", is_published=True)
        seed_mc_questions_for_practice_test(self.pastpaper)

    def test_picker_splits_past_papers_and_practice_tests(self):
        # Given to the teacher, so the library queryset holds BOTH kinds — without the picker's own
        # is_practice_test=False filter the practice test would be listed among the past papers.
        self.practice.assigned_users.add(self.teacher)
        self.pastpaper.assigned_users.add(self.teacher)
        self.client.force_authenticate(self.teacher)
        r = self.client.get(OPTIONS_URL.format(id=self.room.id))
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertNotIn(self.practice.id, {x["id"] for x in body["practice_tests"]})
        self.assertIn(self.pastpaper.id, {x["id"] for x in body["practice_tests"]})
        items = {x["id"]: x for x in body["practice_test_items"]}
        self.assertEqual(items[self.practice.id]["number"], 4)
        self.assertEqual(items[self.practice.id]["level"], "middle")
        self.assertEqual(items[self.practice.id]["access"], "homework_only")
        self.assertNotIn(self.pastpaper.id, items)

    def test_picker_practice_items_follow_the_class_subject_and_assigned_state(self):
        english = PracticeTest.objects.create(
            subject="READING_WRITING", title="Reading focus", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=1,
        )
        seed_mc_questions_for_practice_test(english)
        Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[self.practice.id],
        )
        self.client.force_authenticate(self.teacher)
        body = self.client.get(OPTIONS_URL.format(id=self.room.id)).json()
        items = {x["id"]: x for x in body["practice_test_items"]}
        self.assertNotIn(english.id, items)  # a Math class never sees a Reading & Writing test
        self.assertTrue(items[self.practice.id]["already_assigned"])

    def test_certificate_title(self):
        attempt = TestAttempt(practice_test=self.practice, student=self.student, is_timed=False)
        self.assertEqual(_paper_title(self.practice, attempt), "Practice Test 4 · Untimed")
        attempt.is_timed = True
        self.assertEqual(_paper_title(self.practice, attempt), "Practice Test 4")
        # A past paper keeps its own name, whatever the attempt says.
        self.pastpaper.collection_name = "SAT March 2024"
        self.assertEqual(_paper_title(self.pastpaper, attempt), "SAT March 2024 · Oct 2025")

    def test_windows_pastpaper_list_excludes_practice_tests(self):
        self.practice.assigned_users.add(self.student)
        self.pastpaper.assigned_users.add(self.student)
        ids = {row["id"] for row in pastpaper_rows(self.student)}
        self.assertIn(self.pastpaper.id, ids)
        self.assertNotIn(self.practice.id, ids)

    def test_launcher_names_a_practice_test_by_its_number(self):
        a = Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[self.practice.id, self.pastpaper.id],
        )
        self.client.force_authenticate(self.student)
        r = self.client.get(f"/api/classes/{self.room.id}/assignments/{a.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        rows = {t["id"]: t for t in r.json()["practice_bundle_tests"]}
        self.assertEqual(rows[self.practice.id]["name"], "Practice Test 4")
        self.assertTrue(rows[self.practice.id]["is_practice_test"])
        self.assertFalse(rows[self.pastpaper.id]["is_practice_test"])
        self.assertEqual(rows[self.pastpaper.id]["name"], "Oct 2025")

    def _submission(self, test, *, is_timed):
        a = Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title=f"HW {test.id}",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[test.id],
        )
        attempt = TestAttempt.objects.create(student=self.student, practice_test=test, is_timed=is_timed)
        Submission.objects.create(assignment=a, student=self.student, attempt=attempt)
        return a

    def test_results_rows_are_typed_and_flag_untimed(self):
        self._submission(self.practice, is_timed=False)
        self._submission(self.pastpaper, is_timed=True)
        self.client.force_authenticate(self.teacher)
        r = self.client.get(RESULTS_URL.format(id=self.room.id))
        self.assertEqual(r.status_code, 200, r.content)
        by_type = {row["type"]: row for row in r.json()["rows"]}
        self.assertEqual(set(by_type), {"Practice Test", "Past Paper"})
        self.assertTrue(by_type["Practice Test"]["untimed"])
        self.assertFalse(by_type["Past Paper"]["untimed"])

    def test_results_type_filter_separates_practice_tests_from_past_papers(self):
        self._submission(self.practice, is_timed=True)
        self._submission(self.pastpaper, is_timed=True)
        self.client.force_authenticate(self.teacher)

        def types(q):
            r = self.client.get(RESULTS_URL.format(id=self.room.id), {"type": q})
            self.assertEqual(r.status_code, 200, r.content)
            return [row["type"] for row in r.json()["rows"]]

        self.assertEqual(types("practice test"), ["Practice Test"])
        self.assertEqual(types("practice_test"), ["Practice Test"])
        self.assertEqual(types("past paper"), ["Past Paper"])
        self.assertEqual(sorted(types("all")), ["Past Paper", "Practice Test"])


class PracticeTestContentsTitleTests(TestCase):
    """``contents[]`` is what the iOS homework list titles a card with. A homework of practice tests
    must not read "Past Paper · N sections"; its ``kind`` stays PASTPAPER (iOS and the web launcher key
    off it and know no other value for a section)."""

    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(
            email="ptc_teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(email="ptc_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.room = Classroom.objects.create(
            name="Math", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.create(classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT)

    def _practice(self, number, subject="MATH"):
        t = PracticeTest.objects.create(
            subject=subject, title="", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=number,
        )
        seed_mc_questions_for_practice_test(t)
        return t

    def _paper(self, name):
        t = PracticeTest.objects.create(subject="MATH", title="", collection_name=name, is_published=True)
        seed_mc_questions_for_practice_test(t)
        return t

    def _contents(self, *tests):
        a = Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title="HW",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[t.id for t in tests],
        )
        self.client.force_authenticate(self.student)
        r = self.client.get(f"/api/classes/{self.room.id}/assignments/{a.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["contents"]

    def test_one_practice_test_is_titled_by_its_number(self):
        (c,) = self._contents(self._practice(4))
        self.assertEqual(c["title"], "Practice Test 4")
        self.assertEqual(c["kind"], "PASTPAPER")

    def test_several_practice_tests_are_titled_as_practice_tests(self):
        (c,) = self._contents(self._practice(4), self._practice(5), self._practice(6))
        self.assertEqual(c["title"], "Practice Tests \u00b7 3")
        self.assertEqual(c["kind"], "PASTPAPER")

    def test_a_mix_of_practice_tests_and_past_papers_keeps_the_old_title(self):
        (c,) = self._contents(self._practice(4), self._paper("SAT March 2024"))
        self.assertEqual(c["title"], "Past Paper \u00b7 2 sections")
        self.assertEqual(c["kind"], "PASTPAPER")

    def test_several_past_papers_are_unchanged(self):
        (c,) = self._contents(self._paper("SAT March 2024"), self._paper("SAT May 2024"))
        self.assertEqual(c["title"], "Past Paper \u00b7 2 sections")


class PracticeTestReportPayloadTests(TestCase):
    """The report page a finished practice-test card opens is the past-paper report page, so the
    payload has to name the sitting "Practice Test N" and say what it is — never the (blank) collection
    name, and never "Past Paper"."""

    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(email="ptr_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.practice = PracticeTest.objects.create(
            subject="MATH", title="Algebra focus", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=4,
        )
        seed_mc_questions_for_practice_test(self.practice)
        self.pastpaper = PracticeTest.objects.create(
            subject="MATH", title="Oct 2025", collection_name="SAT March 2024", is_published=True,
        )
        seed_mc_questions_for_practice_test(self.pastpaper)

    def _finished(self, test, *, is_timed=True):
        return TestAttempt.objects.create(
            student=self.student, practice_test=test, is_timed=is_timed, score=600,
            is_completed=True, current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(),
        )

    def _report(self, attempt):
        self.client.force_authenticate(self.student)
        r = self.client.get(f"/api/classes/pastpapers/attempts/{attempt.pk}/report/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def test_a_practice_test_report_is_named_by_its_number(self):
        body = self._report(self._finished(self.practice))
        self.assertEqual(body["paper_title"], "Practice Test 4")
        self.assertTrue(body["is_practice_test"])

    def test_an_untimed_practice_test_report_says_so(self):
        body = self._report(self._finished(self.practice, is_timed=False))
        self.assertEqual(body["paper_title"], "Practice Test 4 \u00b7 Untimed")

    def test_a_past_paper_report_is_unchanged(self):
        body = self._report(self._finished(self.pastpaper))
        self.assertEqual(body["paper_title"], "SAT March 2024")
        self.assertFalse(body["is_practice_test"])

    def test_an_unnumbered_practice_test_is_still_never_a_past_paper(self):
        self.practice.practice_number = None
        self.assertEqual(_paper_title(self.practice), "Practice Test")


class JournalPickerExcludesPracticeTestsTests(TestCase):
    """The journal lesson editor's picker (``/api/journals/content-options/``) hand-builds the
    same ``PracticeTestViewSet`` queryset, which holds BOTH kinds when no action is set. A
    practice test is not a past paper, so it must not be offered among them."""

    def test_practice_test_is_not_offered_as_a_past_paper(self):
        admin = User.objects.create_user(email="pth_admin@example.com", password="pw", role=acc_const.ROLE_SUPER_ADMIN)
        practice = PracticeTest.objects.create(
            subject="MATH", title="Algebra focus", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=7,
        )
        seed_mc_questions_for_practice_test(practice)
        pastpaper = PracticeTest.objects.create(subject="MATH", title="Oct 2025", is_published=True)
        seed_mc_questions_for_practice_test(pastpaper)

        client = APIClient()
        client.force_authenticate(admin)
        r = client.get("/api/journals/content-options/", {"subject": "MATH", "level": "middle"})
        self.assertEqual(r.status_code, 200, r.content)
        ids = {x["id"] for x in r.json()["practice_tests"]}
        self.assertIn(pastpaper.id, ids)
        self.assertNotIn(practice.id, ids)


class PracticeTestHomeworkScaleTests(TestCase):
    """A practice test is one section on its own 200–800 scale. A homework of several is several
    tests: its grade is their mean, never their sum, and the Results page shows each test on its
    own row. A past paper's sections are one paper, so they still add up to its SAT total."""

    def setUp(self):
        self.client = APIClient()
        self.teacher = User.objects.create_user(
            email="pts_teacher@example.com", password="pw", role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(email="pts_student@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        self.room = Classroom.objects.create(
            name="Math", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER)
        ClassroomMembership.objects.create(classroom=self.room, user=self.student, role=ClassroomMembership.ROLE_STUDENT)

    def _practice(self, number):
        t = PracticeTest.objects.create(
            subject="MATH", title=f"Exam Prep | Test {number} | Math", is_practice_test=True, is_published=True,
            practice_access=PracticeTest.ACCESS_OPEN, practice_number=number,
        )
        seed_mc_questions_for_practice_test(t)
        return t

    def _paper(self, subject):
        t = PracticeTest.objects.create(subject=subject, title=subject, collection_name="SAT March 2024", is_published=True)
        seed_mc_questions_for_practice_test(t)
        return t

    def _homework(self, *tests):
        return Assignment.objects.create(
            classroom=self.room, created_by=self.teacher, title="CHUNG PRACTISE",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[t.id for t in tests],
        )

    def _finish(self, test, score, *, is_timed=True):
        # Saving a finished attempt fires the homework sync, as the runner does.
        now = timezone.now()
        return TestAttempt.objects.create(
            student=self.student, practice_test=test, score=score, is_timed=is_timed,
            is_completed=True, current_state=TestAttempt.STATE_COMPLETED, completed_at=now, submitted_at=now,
        )

    def _grade(self, a):
        return float(Submission.objects.get(assignment=a, student=self.student).review.grade)

    def _rows(self, **params):
        self.client.force_authenticate(self.teacher)
        r = self.client.get(RESULTS_URL.format(id=self.room.id), params)
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["rows"]

    def test_two_practice_tests_are_graded_on_their_mean_not_their_sum(self):
        pt1, pt3 = self._practice(1), self._practice(3)
        a = self._homework(pt1, pt3)
        self._finish(pt1, 640)
        self._finish(pt3, 400)
        self.assertEqual(self._grade(a), 520.0)

    def test_the_mean_rounds_to_a_whole_score(self):
        tests = [self._practice(n) for n in (1, 2, 3)]
        a = self._homework(*tests)
        for t, score in zip(tests, (500, 500, 510)):
            self._finish(t, score)
        self.assertEqual(self._grade(a), 503.0)

    def test_a_past_paper_still_adds_up_to_its_total(self):
        rw, math = self._paper("READING_WRITING"), self._paper("MATH")
        a = self._homework(rw, math)
        self._finish(rw, 650)
        self._finish(math, 700)
        self.assertEqual(self._grade(a), 1350.0)

    def test_a_summed_grade_from_before_is_regraded_on_the_next_sync(self):
        from classes.homework_auto_submit import sync_practice_submission_for_assignment

        pt1, pt3 = self._practice(1), self._practice(3)
        a = self._homework(pt1, pt3)
        self._finish(pt1, 640)
        self._finish(pt3, 400)
        review = Submission.objects.get(assignment=a, student=self.student).review
        review.grade = 1040  # what the old rule wrote
        review.save()
        self.assertTrue(sync_practice_submission_for_assignment(self.student, a))
        self.assertEqual(self._grade(a), 520.0)
        # And then it is settled.
        self.assertFalse(sync_practice_submission_for_assignment(self.student, a))

    def test_results_show_each_practice_test_on_its_own_row(self):
        pt1, pt3 = self._practice(1), self._practice(3)
        a = self._homework(pt1, pt3)
        self._finish(pt1, 640)
        self._finish(pt3, 400, is_timed=False)
        rows = {r["content_name"]: r for r in self._rows()}
        self.assertEqual(set(rows), {"CHUNG PRACTISE · Practice Test 1", "CHUNG PRACTISE · Practice Test 3"})
        self.assertEqual(rows["CHUNG PRACTISE · Practice Test 1"]["score"], 640.0)
        self.assertEqual(rows["CHUNG PRACTISE · Practice Test 3"]["score"], 400.0)
        self.assertFalse(rows["CHUNG PRACTISE · Practice Test 1"]["untimed"])
        self.assertTrue(rows["CHUNG PRACTISE · Practice Test 3"]["untimed"])
        self.assertEqual({r["type"] for r in rows.values()}, {"Practice Test"})
        self.assertEqual({r["status"] for r in rows.values()}, {Submission.STATUS_REVIEWED})
        self.assertEqual(len(self._rows(type="past paper")), 0)
        self.assertEqual(len(self._rows(type="practice test")), 2)

    def test_results_of_a_mix_keep_the_past_paper_whole(self):
        rw, math, pt4 = self._paper("READING_WRITING"), self._paper("MATH"), self._practice(4)
        a = self._homework(rw, math, pt4)
        self._finish(rw, 650)
        self._finish(math, 700)
        self._finish(pt4, 560)
        rows = {r["content_name"]: r for r in self._rows()}
        self.assertEqual(rows["CHUNG PRACTISE · Past Paper"]["score"], 1350.0)
        self.assertEqual(rows["CHUNG PRACTISE · Past Paper"]["type"], "Past Paper")
        self.assertEqual(rows["CHUNG PRACTISE · Practice Test 4"]["score"], 560.0)
        self.assertEqual([r["type"] for r in self._rows(type="past paper")], ["Past Paper"])

    def test_results_of_one_past_paper_stay_one_row(self):
        rw, math = self._paper("READING_WRITING"), self._paper("MATH")
        self._homework(rw, math)
        self._finish(rw, 650)
        self._finish(math, 700)
        (row,) = self._rows()
        self.assertEqual(row["content_name"], "CHUNG PRACTISE")
        self.assertEqual(row["score"], 1350.0)

    def test_results_split_rows_cost_the_same_queries_for_any_class_size(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        pt1, pt3 = self._practice(1), self._practice(3)
        self._homework(pt1, pt3)
        self._homework(pt1, pt3)

        def finish_both(student):
            self.student = student
            self._finish(pt1, 640)
            self._finish(pt3, 400)

        def count():
            self.client.force_authenticate(self.teacher)
            with CaptureQueriesContext(connection) as ctx:
                r = self.client.get(RESULTS_URL.format(id=self.room.id), {"type": "practice test"})
            self.assertEqual(r.status_code, 200, r.content)
            return len(ctx.captured_queries), len(r.json()["rows"])

        finish_both(self.student)
        one, rows_one = count()
        for n in range(3):
            other = User.objects.create_user(email=f"pts_more{n}@example.com", password="pw", role=acc_const.ROLE_STUDENT)
            ClassroomMembership.objects.create(classroom=self.room, user=other, role=ClassroomMembership.ROLE_STUDENT)
            finish_both(other)
        four, rows_four = count()
        self.assertEqual((rows_one, rows_four), (4, 16))  # 2 homework x 2 tests per student
        self.assertEqual(four, one)

    def test_a_teachers_own_mark_stays_one_row(self):
        pt1, pt3 = self._practice(1), self._practice(3)
        a = self._homework(pt1, pt3)
        self._finish(pt1, 640)
        self._finish(pt3, 400)
        review = Submission.objects.get(assignment=a, student=self.student).review
        review.is_auto = False
        review.grade = 90
        review.save()
        (row,) = self._rows()
        self.assertEqual(row["content_name"], "CHUNG PRACTISE")
        self.assertEqual(row["score"], 90.0)
