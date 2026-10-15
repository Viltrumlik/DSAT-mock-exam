from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from exams.models import PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()
_HOSTS = ["testserver", "questions.mastersat.uz"]
_Q = {"HTTP_HOST": "questions.mastersat.uz"}


def _rows(body):
    return body["results"] if isinstance(body, dict) else body


@override_settings(ALLOWED_HOSTS=_HOSTS)
class PracticeTestBuilderApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="ptb_admin@example.com", password="pw", role=acc_const.ROLE_ADMIN)
        self.client.force_authenticate(self.admin)

    def _create(self, **extra):
        r = self.client.post("/api/exams/admin/tests/", {"subject": "MATH", "title": "Algebra focus", **extra}, format="json", **_Q)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def test_create_practice_test_with_access_and_level(self):
        row = self._create(is_practice_test=True, practice_access="open", practice_level="middle")
        self.assertTrue(row["is_practice_test"])
        self.assertEqual((row["practice_access"], row["practice_level"], row["practice_number"]), ("open", "middle", None))

    def test_bad_level_is_rejected(self):
        r = self.client.post("/api/exams/admin/tests/", {"subject": "MATH", "is_practice_test": True, "practice_level": "expert"}, format="json", **_Q)
        self.assertEqual(r.status_code, 400)

    def test_kind_filter_splits_the_two_libraries(self):
        pt = self._create(is_practice_test=True)
        pp = self._create()

        def ids(kind):
            return {x["id"] for x in _rows(self.client.get(f"/api/exams/admin/tests/?standalone=1&kind={kind}", **_Q).json())}

        self.assertEqual(ids("practice_test") & {pt["id"], pp["id"]}, {pt["id"]})
        self.assertEqual(ids("pastpaper") & {pt["id"], pp["id"]}, {pp["id"]})

    def test_publish_numbers_once(self):
        row = self._create(is_practice_test=True)
        # A Math module needs exactly 22 questions to pass the SAT publish gate (sat_rules).
        seed_mc_questions_for_practice_test(PracticeTest.objects.get(pk=row["id"]), questions_per_module=22)
        first = self.client.post(f"/api/exams/admin/tests/{row['id']}/publish/", **_Q).json()
        self.assertEqual(first["practice_number"], 1)
        self.client.post(f"/api/exams/admin/tests/{row['id']}/unpublish/", **_Q)
        again = self.client.post(f"/api/exams/admin/tests/{row['id']}/publish/", **_Q).json()
        self.assertEqual(again["practice_number"], 1)

    def test_kind_cannot_change_after_create(self):
        row = self._create(is_practice_test=True)
        r = self.client.patch(f"/api/exams/admin/tests/{row['id']}/", {"is_practice_test": False}, format="json", **_Q)
        self.assertEqual(r.status_code, 400)

    def test_editing_without_naming_the_kind_keeps_the_kind(self):
        # The builder PATCHes only the fields it changed: leaving out is_practice_test must neither
        # crash (DRF's conditional-unique validator did) nor read as a change of kind.
        pt = self._create(is_practice_test=True, practice_level="junior")
        pp = self._create()
        r = self.client.patch(f"/api/exams/admin/tests/{pt['id']}/", {"title": "Renamed"}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["title"], r.json()["is_practice_test"], r.json()["practice_level"]), ("Renamed", True, "junior"))
        r = self.client.patch(f"/api/exams/admin/tests/{pp['id']}/", {"title": "Renamed too"}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["is_practice_test"])
        # A full update (PUT) that omits the kind is also a no-op on the kind.
        r = self.client.put(f"/api/exams/admin/tests/{pt['id']}/", {"subject": "MATH", "title": "Put"}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(PracticeTest.objects.get(pk=pt["id"]).is_practice_test)

    def _numbered(self):
        row = self._create(is_practice_test=True)
        seed_mc_questions_for_practice_test(PracticeTest.objects.get(pk=row["id"]), questions_per_module=22)
        r = self.client.post(f"/api/exams/admin/tests/{row['id']}/publish/", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["practice_number"], 1)
        return row["id"]

    def test_subject_is_fixed_once_the_test_is_numbered(self):
        # Numbers run per subject (uniq_practice_number_per_subject): moving a numbered test to the other
        # subject would collide with that subject's own Practice Test 1 (IntegrityError -> 500) or leave a
        # gap in this one. A clear 400 instead.
        pid = self._numbered()
        r = self.client.patch(f"/api/exams/admin/tests/{pid}/", {"subject": "READING_WRITING"}, format="json", **_Q)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("subject", r.json())
        self.assertIn("cannot change", str(r.json()["subject"]).lower())
        self.assertEqual(PracticeTest.objects.get(pk=pid).subject, "MATH")

    def test_naming_the_same_subject_again_is_not_a_change(self):
        pid = self._numbered()
        for spelling in ("MATH", "math", "Mathematics"):
            r = self.client.patch(f"/api/exams/admin/tests/{pid}/", {"subject": spelling}, format="json", **_Q)
            self.assertEqual(r.status_code, 200, (spelling, r.content))
        self.assertEqual(PracticeTest.objects.get(pk=pid).subject, "MATH")

    def test_subject_can_still_change_before_it_is_numbered(self):
        row = self._create(is_practice_test=True)
        r = self.client.patch(f"/api/exams/admin/tests/{row['id']}/", {"subject": "READING_WRITING"}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["subject"], "READING_WRITING")

    def test_a_past_papers_subject_is_unchanged_by_this_rule(self):
        row = self._create()
        r = self.client.patch(f"/api/exams/admin/tests/{row['id']}/", {"subject": "READING_WRITING"}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)

    def test_practice_number_cannot_be_set_through_the_api(self):
        row = self._create(is_practice_test=True, practice_number=7)
        self.assertIsNone(row["practice_number"])
        r = self.client.patch(f"/api/exams/admin/tests/{row['id']}/", {"practice_number": 9}, format="json", **_Q)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(PracticeTest.objects.get(pk=row["id"]).practice_number)

    def test_attempted_section_cannot_be_deleted(self):
        row = self._create(is_practice_test=True)
        student = User.objects.create_user(email="ptb_st@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        TestAttempt.objects.create(student=student, practice_test_id=row["id"])
        r = self.client.delete(f"/api/exams/admin/tests/{row['id']}/", **_Q)
        self.assertEqual(r.status_code, 400)
        self.assertTrue(PracticeTest.objects.filter(pk=row["id"]).exists())
