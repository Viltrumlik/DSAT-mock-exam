"""PROBE (temporary): can a survey's results be cut by cohort today?"""
from __future__ import annotations

import csv
import io
from statistics import mean

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from surveys import services
from surveys.models import Survey, SurveyQuestion

User = get_user_model()


class CohortPivotProbe(TestCase):
    def test_probe(self):
        boss = User.objects.create_user("pv_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN)
        survey = Survey.objects.create(
            title="How are your lessons going?",
            status=Survey.STATUS_PUBLISHED,
            allow_anonymous=True,          # the hard case the reporter names
            created_by=boss,
        )
        q_slider = SurveyQuestion.objects.create(
            survey=survey, order=0, prompt="How are your lessons going?",
            question_type=SurveyQuestion.TYPE_RATING, scale_min=0, scale_max=10,
        )
        q_level = SurveyQuestion.objects.create(
            survey=survey, order=1, prompt="Which group are you in?",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE,
            options=["Junior", "Senior"], is_required=True,
        )
        q_branch = SurveyQuestion.objects.create(
            survey=survey, order=2, prompt="Which branch do you attend?",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE,
            options=["Chilonzor", "Yunusobod"], is_required=True,
        )

        plan = (
            [("Senior", "Chilonzor", 9)] * 9 + [("Senior", "Yunusobod", 8)]
            + [("Junior", "Yunusobod", 5)] * 9 + [("Junior", "Chilonzor", 6)]
        )
        for i, (level, branch, score) in enumerate(plan):
            student = User.objects.create_user(f"pv{i}@t.com", "secret123")
            services.submit_response(
                survey, student,
                {str(q_slider.id): score, str(q_level.id): level, str(q_branch.id): branch},
                anonymous=True,            # every reply signed "Anonymous"
            )

        client = APIClient()
        client.force_authenticate(boss)
        resp = client.get(f"/api/surveys/admin/{survey.id}/responses.csv")
        assert resp.status_code == 200, resp.status_code
        rows = list(csv.DictReader(io.StringIO(resp.content.decode("utf-8-sig"))))

        print("\n--- COHORT PROBE ---")
        print("CSV header:", list(rows[0].keys()))
        print("Student column values:", sorted({r["Student"] for r in rows}))

        def avg(pred):
            picked = [int(r["How are your lessons going?"]) for r in rows if pred(r)]
            return round(mean(picked), 2), len(picked)

        print("school-wide:", avg(lambda r: True))
        for level in ("Senior", "Junior"):
            print(f"level={level}:", avg(lambda r, l=level: r["Which group are you in?"] == l))
        for br in ("Chilonzor", "Yunusobod"):
            print(f"branch={br}:", avg(lambda r, b=br: r["Which branch do you attend?"] == b))

        # And what the in-console summary says about the same slider:
        summaries = services.survey_results(survey)["summaries"]
        s = [x for x in summaries if x["question_id"] == q_slider.id][0]
        print("summary keys for the slider:", sorted(s.keys()))
        print("summary average (ungrouped):", s["average"])
        print("--- END COHORT PROBE ---\n")
