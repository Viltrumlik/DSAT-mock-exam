"""Throwaway probe: can a running survey stop asking a question and keep its answers?"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from surveys import services
from surveys.models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse

User = get_user_model()


class RetireProbe(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = User.objects.create_user(
            "probe_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.survey = Survey.objects.create(
            title="Term feedback", status=Survey.STATUS_PUBLISHED, created_by=self.super_admin
        )
        self.q1 = SurveyQuestion.objects.create(
            survey=self.survey, order=0, prompt="Favourite subject",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE, options=["Maths", "English"],
            is_required=True,
        )
        self.q4 = SurveyQuestion.objects.create(
            survey=self.survey, order=1, prompt="Is the pace fine?",
            question_type=SurveyQuestion.TYPE_LONG_TEXT,
        )
        for i in range(5):
            s = User.objects.create_user(f"probe_s{i}@t.com", "secret123")
            services.submit_response(
                self.survey, s,
                {str(self.q1.id): "Maths", str(self.q4.id): f"answer {i}"},
            )

    def test_delete_destroys_answers(self):
        self.assertEqual(SurveyAnswer.objects.filter(question=self.q4).count(), 5)
        self.client.force_authenticate(self.super_admin)
        r = self.client.delete(
            f"/api/surveys/admin/{self.survey.id}/questions/{self.q4.id}/",
            HTTP_X_MASTERSAT_CLIENT="native",
        )
        print("DELETE status:", r.status_code, getattr(r, "data", None))
        print("answers left:", SurveyAnswer.objects.filter(question_id=self.q4.id).count())
        print("total answers left:", SurveyAnswer.objects.count())

    def test_never_true_condition_as_retirement(self):
        """Workaround probe: hide q4 behind a condition nobody can satisfy."""
        self.client.force_authenticate(self.super_admin)
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/questions/{self.q4.id}/",
            {
                "condition_question": self.q1.id,
                "condition_operator": SurveyQuestion.COND_NONE_OF,
                "condition_value": ["Maths", "English"],
            },
            format="json",
            HTTP_X_MASTERSAT_CLIENT="native",
        )
        print("PATCH condition status:", r.status_code, getattr(r, "data", None))
        if r.status_code < 300:
            self.q4.refresh_from_db()
            res = services.survey_results(self.survey)
            for s in res["summaries"]:
                print("SUMMARY:", {k: s[k] for k in ("prompt", "answered", "skipped", "not_asked", "is_conditional")})
            # Does a NEW respondent get asked q4?
            new_student = User.objects.create_user("probe_new@t.com", "secret123")
            self.client.force_authenticate(new_student)
            d = self.client.get(f"/api/surveys/{self.survey.id}/", HTTP_X_MASTERSAT_CLIENT="native")
            print("student detail status:", d.status_code)
            print("questions served:", [q.get("prompt") for q in (d.data or {}).get("questions", [])])
