from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentQuestion, AssessmentSet

User = get_user_model()


class AdminAssessmentSetsListNPlusOneTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="admin-perf@example.com",
            password="pw",
            role=acc_const.ROLE_ADMIN,
        )

    def test_admin_sets_list_query_count_bounded(self):
        self.client.force_authenticate(user=self.admin)

        for i in range(10):
            aset = AssessmentSet.objects.create(
                subject="math",
                title=f"Set {i}",
                description="d",
                is_active=True,
                created_by=self.admin,
            )
            for j in range(6):
                AssessmentQuestion.objects.create(
                    assessment_set=aset,
                    prompt=f"P{i}-{j}",
                    question_type="multiple_choice",
                    choices=[{"id": "A", "text": "A"}, {"id": "B", "text": "B"}],
                    correct_answer="A",
                    order=j + 1,
                )

        with CaptureQueriesContext(connection) as ctx:
            r = self.client.get("/api/assessments/admin/sets/")
            self.assertEqual(r.status_code, 200)
            body = r.json()
            # LimitOffsetPagination wraps the rows; the N+1 guarantee below is what this
            # test actually protects.
            rows = body["results"] if isinstance(body, dict) and "results" in body else body
            self.assertIsInstance(rows, list)
            self.assertTrue(rows)

        self.assertLessEqual(len(ctx), 35, f"Too many queries for admin sets list: {len(ctx)}")

