from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from access import constants as C
from surveys import services
from surveys.models import Survey, SurveyQuestion

User = get_user_model()


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class LateQuestionDenominatorProbe(TestCase):
    """100 replies, then a new question, then 12 more replies. What do the results say?"""

    def test_probe(self):
        boss = User.objects.create_user("probe_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        survey = Survey.objects.create(
            title="Term feedback", status=Survey.STATUS_PUBLISHED, created_by=boss
        )
        q1 = SurveyQuestion.objects.create(
            survey=survey, order=0, prompt="Rate the lessons",
            question_type=SurveyQuestion.TYPE_SCALE, scale_min=1, scale_max=5,
        )

        early = [User.objects.create_user(f"e{i}@t.com", "secret123") for i in range(20)]
        for s in early:
            services.submit_response(survey, s, {str(q1.id): 4})

        # Three days in: the head adds the branch question.
        q2 = SurveyQuestion.objects.create(
            survey=survey, order=1, prompt="Which branch do you attend?",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE, options=["North", "South"],
        )

        late = [User.objects.create_user(f"l{i}@t.com", "secret123") for i in range(5)]
        for s in late:
            services.submit_response(survey, s, {str(q1.id): 4, str(q2.id): "North"})

        results = services.survey_results(survey)
        total = len(results["responses"])
        s2 = [s for s in results["summaries"] if s["question_id"] == q2.id][0]
        s1 = [s for s in results["summaries"] if s["question_id"] == q1.id][0]

        print("\n--- PROBE ---")
        print("total submitted responses:", total)
        print("Q1 summary:", {k: s2 and s1[k] for k in ("answered", "skipped", "not_asked", "is_conditional")})
        print("Q2 summary:", {k: s2[k] for k in ("answered", "skipped", "not_asked", "is_conditional")})
        print("Q2 options:", s2["options"])
        print("accounted for on Q2:", s2["answered"] + s2["skipped"] + s2["not_asked"], "of", total)
        print("serializer exposes question created_at:",
              "created_at" in __import__("surveys.serializers", fromlist=["x"]).SurveyQuestionSerializer.Meta.fields)

        # What an individual reply looks like for an early respondent.
        early_resp = [r for r in results["responses"] if r.student_id == early[0].id][0]
        print("early reply answer rows:", [(a.question_id, a.value) for a in early_resp.answers.all()])
        print("--- END PROBE ---\n")
