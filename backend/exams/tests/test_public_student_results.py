from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from access import constants as acc_const
from exams.models import PracticeTest, TestAttempt

User = get_user_model()


def signed_in(user) -> APIClient:
    """A client carrying a real Bearer token. NOT ``force_authenticate``: that sets the user inside DRF,
    after the host-guard middleware has already run, so the guard would see an anonymous request and
    the ``centre_only`` refusals under test would never fire."""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


class PublicLearnerResultsTests(TestCase):
    def setUp(self):
        self.public = User.objects.create_user(email="pub_leaver@example.com", password="pw", role=acc_const.ROLE_PUBLIC_STUDENT)
        self.client = signed_in(self.public)
        pt = PracticeTest.objects.create(subject="MATH", title="Old paper", skip_default_modules=True)
        self.done = TestAttempt.objects.create(
            student=self.public, practice_test=pt, is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(), score=600,
        )
        pt2 = PracticeTest.objects.create(subject="MATH", title="Unfinished", skip_default_modules=True)
        self.open = TestAttempt.objects.create(student=self.public, practice_test=pt2)

    def test_lists_only_finished_attempts(self):
        r = self.client.get("/api/exams/attempts/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        ids = {row["id"] for row in (body["results"] if isinstance(body, dict) else body)}
        self.assertEqual(ids, {self.done.id})

    def test_reads_a_finished_attempt_but_not_an_open_one(self):
        self.assertEqual(self.client.get(f"/api/exams/attempts/{self.done.id}/").status_code, 200)
        self.assertEqual(self.client.get(f"/api/exams/attempts/{self.open.id}/").status_code, 404)

    def test_cannot_start_anything(self):
        r = self.client.post("/api/exams/attempts/", {"practice_test": self.open.practice_test_id}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json().get("code"), "centre_only")

    def test_practice_test_library_stays_closed(self):
        self.assertEqual(self.client.get("/api/exams/?kind=practice_test").status_code, 403)

    def test_opens_the_review_and_results_of_a_finished_attempt(self):
        for tail in ("review", "results"):
            r = self.client.get(f"/api/exams/attempts/{self.done.id}/{tail}/")
            self.assertEqual(r.status_code, 200, (tail, r.content))
            self.assertEqual(r.json()["total_score"], 600, tail)

    def test_review_and_results_of_an_open_attempt_stay_closed(self):
        for tail in ("review", "results"):
            r = self.client.get(f"/api/exams/attempts/{self.open.id}/{tail}/")
            self.assertEqual(r.status_code, 404, (tail, r.content))

    def test_nothing_else_under_attempts_is_open(self):
        # The host guard answers before any view: a finished attempt's write actions and its
        # status poll are the learning center's, not a leaver's.
        base = f"/api/exams/attempts/{self.done.id}"
        for method, tail in (("post", "resume"), ("post", "start"), ("post", "save_attempt"),
                             ("post", "submit_module"), ("get", "status")):
            r = getattr(self.client, method)(f"{base}/{tail}/", {}, format="json") if method == "post" \
                else self.client.get(f"{base}/{tail}/")
            self.assertEqual(r.status_code, 403, (method, tail))
            self.assertEqual(r.json().get("code"), "centre_only", (method, tail))

    def test_someone_elses_finished_attempt_is_not_found(self):
        other = User.objects.create_user(email="pub_other@example.com", password="pw", role=acc_const.ROLE_PUBLIC_STUDENT)
        pt = PracticeTest.objects.create(subject="MATH", title="Theirs", skip_default_modules=True)
        theirs = TestAttempt.objects.create(
            student=other, practice_test=pt, is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(), score=500,
        )
        self.assertEqual(self.client.get(f"/api/exams/attempts/{theirs.id}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/exams/attempts/{theirs.id}/review/").status_code, 404)


class CentreStudentAttemptsUnchangedTests(TestCase):
    """The finished-only filter and the permission bypass are for public learners alone."""

    def test_a_centre_student_still_lists_open_and_finished_attempts(self):
        student = User.objects.create_user(email="centre@example.com", password="pw", role=acc_const.ROLE_STUDENT)
        client = signed_in(student)
        pt = PracticeTest.objects.create(subject="MATH", title="Done", skip_default_modules=True)
        done = TestAttempt.objects.create(
            student=student, practice_test=pt, is_completed=True,
            current_state=TestAttempt.STATE_COMPLETED, completed_at=timezone.now(), score=700,
        )
        pt2 = PracticeTest.objects.create(subject="MATH", title="Open", skip_default_modules=True)
        open_ = TestAttempt.objects.create(student=student, practice_test=pt2)
        r = client.get("/api/exams/attempts/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        ids = {row["id"] for row in (body["results"] if isinstance(body, dict) else body)}
        self.assertEqual(ids, {done.id, open_.id})
