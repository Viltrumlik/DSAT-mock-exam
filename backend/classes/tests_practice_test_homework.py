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
