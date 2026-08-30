"""SCRATCH — proves whether staff can answer a survey today. Delete after running."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from rewards.models import PointAward
from surveys.models import Survey, SurveyQuestion, SurveyResponse
from users.auth_cookies import cookie_domain_for_request

User = get_user_model()


@override_settings(
    ALLOWED_HOSTS=["testserver", "teacher.testserver", "mastersat.uz", "teacher.mastersat.uz"]
)
class StaffSurveyRouteTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = User.objects.create_user(
            "sc_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.teacher = User.objects.create_user(
            "sc_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.support = User.objects.create_user(
            "sc_support@t.com", "secret123", role=C.ROLE_SUPPORT_TEACHER, subject="both"
        )
        self.survey = Survey.objects.create(
            title="Is the attendance window working?",
            status=Survey.STATUS_PUBLISHED,
            allow_anonymous=True,
            created_by=self.super_admin,
        )
        self.q1 = SurveyQuestion.objects.create(
            survey=self.survey, order=0, prompt="Does the 2h window work?",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE, options=["Yes", "No"],
            is_required=True,
        )
        self.q2 = SurveyQuestion.objects.create(
            survey=self.survey, order=1, prompt="Journal roadmap — rate it",
            question_type=SurveyQuestion.TYPE_SCALE, scale_min=1, scale_max=5,
        )

    def _answers(self):
        return {str(self.q1.id): "No", str(self.q2.id): 4}

    # ── the claimed block, on the teacher portal host ────────────────────
    def test_teacher_portal_host_does_403(self):
        self.client.force_authenticate(self.teacher)
        r = self.client.get("/api/surveys/open/", HTTP_HOST="teacher.mastersat.uz")
        print("teacher host /api/surveys/open/ ->", r.status_code, getattr(r, "data", None))
        self.assertEqual(r.status_code, 403)

    # ── the route the report missed: the apex, same signed-in session ────
    def test_teacher_on_apex_can_list_and_answer_anonymously(self):
        self.client.force_authenticate(self.teacher)
        r = self.client.get("/api/surveys/open/", HTTP_HOST="mastersat.uz")
        print("apex /api/surveys/open/ (teacher) ->", r.status_code, r.json())
        self.assertEqual(r.status_code, 200)
        self.assertEqual([s["id"] for s in r.json()["surveys"]], [self.survey.id])

        detail = self.client.get(f"/api/surveys/{self.survey.id}/", HTTP_HOST="mastersat.uz")
        print("apex survey detail (teacher) ->", detail.status_code)
        self.assertEqual(detail.status_code, 200)

        post = self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self._answers(), "anonymous": True},
            format="json",
            HTTP_HOST="mastersat.uz",
        )
        print("apex respond (teacher) ->", post.status_code, post.json())
        self.assertEqual(post.status_code, 201)
        self.assertTrue(post.json()["is_anonymous"])

        row = SurveyResponse.objects.get(survey=self.survey, student=self.teacher)
        self.assertEqual(row.status, SurveyResponse.STATUS_SUBMITTED)
        self.assertTrue(row.is_anonymous)

    def test_support_teacher_on_apex_can_answer(self):
        self.client.force_authenticate(self.support)
        post = self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self._answers()},
            format="json",
            HTTP_HOST="mastersat.uz",
        )
        print("apex respond (support_teacher) ->", post.status_code, post.json())
        self.assertEqual(post.status_code, 201)

    def test_results_and_csv_include_the_staff_reply(self):
        self.client.force_authenticate(self.teacher)
        self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self._answers()},
            format="json",
            HTTP_HOST="mastersat.uz",
        )
        self.client.force_authenticate(self.super_admin)
        body = self.client.get(
            f"/api/surveys/admin/{self.survey.id}/responses/", HTTP_HOST="admin.mastersat.uz"
        )
        print("admin responses ->", body.status_code, body.json())
        self.assertEqual(body.status_code, 200)
        self.assertEqual(len(body.json()["responses"]), 1)

        csv = self.client.get(
            f"/api/surveys/admin/{self.survey.id}/responses.csv", HTTP_HOST="admin.mastersat.uz"
        )
        print("admin csv ->", csv.status_code, csv.content.decode("utf-8-sig")[:300])
        self.assertEqual(csv.status_code, 200)

    def test_what_the_reward_hook_does_to_a_teacher(self):
        self.client.force_authenticate(self.teacher)
        self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self._answers()},
            format="json",
            HTTP_HOST="mastersat.uz",
        )
        awards = list(PointAward.objects.filter(student=self.teacher).values("event", "points", "xp"))
        print("teacher point awards ->", awards)

    def test_the_session_cookie_is_shared_across_subdomains(self):
        rf = RequestFactory()
        with override_settings(DEBUG=False):
            req = rf.get("/api/auth/login/", HTTP_HOST="teacher.mastersat.uz")
            domain = cookie_domain_for_request(req)
        print("cookie domain minted on the teacher portal ->", domain)
        self.assertEqual(domain, ".mastersat.uz")
