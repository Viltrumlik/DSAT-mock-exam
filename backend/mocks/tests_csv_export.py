"""The full-mock CSV export.

A mock's four modules hang off its sections with ``practice_test=None``, so they are NOT
reachable through the exams export's ``test.modules``. This is the surface most likely to be
missed when the export is added, which is why it has its own file.
"""

from __future__ import annotations

import csv
import io

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from exams.models import Question
from mocks.models import Mock

User = get_user_model()
BASE = "/api/mocks/admin/mocks/"


class MockCsvExportTests(TestCase):
    def setUp(self):
        self.super_admin = User.objects.create_user(
            "mx_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.test_admin = User.objects.create_user(
            "mx_ta@t.com", "secret123", role=C.ROLE_TEST_ADMIN
        )
        self.client = APIClient()
        self.client.force_authenticate(self.super_admin)

        r = self.client.post(BASE, {"title": "Mock 7", "break_minutes": 10}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.mock = Mock.objects.get(pk=r.json()["id"])
        self.module_ids = [m.id for sec in self.mock.sections.all() for m in sec.modules()]

        for i, module_id in enumerate(self.module_ids):
            Question.objects.create(
                module_id=module_id, order=0, question_type="READING",
                question_text=f"Question in module {i}", option_a="a", option_b="b",
                correct_answers="A", score=10,
            )

    def rows(self, response):
        return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))

    def url(self):
        return f"{BASE}{self.mock.pk}/export-csv/"

    def test_every_module_of_the_mock_is_in_one_file(self):
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200, r.content)
        rows = self.rows(r)
        self.assertEqual(len(rows), 4)
        # One file, and the module column is what keeps the four apart inside it.
        self.assertEqual(len({row["module"] for row in rows}), 4)

    def test_the_module_label_names_its_subject(self):
        """A mock's modules have practice_test=None, so the subject has to come from the
        MockSection. Without that they all read "Module 1"/"Module 2" and the English one is
        indistinguishable from the Math one."""
        labels = {row["module"] for row in self.rows(self.client.get(self.url()))}
        self.assertEqual(
            labels,
            {
                "Reading & Writing · Module 1", "Reading & Writing · Module 2",
                "Math · Module 1", "Math · Module 2",
            },
        )

    def test_the_answer_key_travels(self):
        rows = self.rows(self.client.get(self.url()))
        self.assertTrue(all(row["correct_answer"] == "A" for row in rows))

    def test_a_test_admin_is_refused(self):
        self.client.force_authenticate(self.test_admin)
        self.assertEqual(self.client.get(self.url()).status_code, 403)

    def test_a_mock_with_no_questions_still_returns_headers(self):
        Question.objects.filter(module_id__in=self.module_ids).delete()
        r = self.client.get(self.url())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.rows(r), [])
        self.assertTrue(r.content.decode("utf-8-sig").startswith("module"))
