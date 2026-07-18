"""The teacher midterm catalog must expose `level`.

Regression: the classroom "Assign a midterm" picker filtered only by subject, so a
Middle class saw EVERY published midterm. The picker scopes by the classroom's level
too — which is only possible if the catalog reports each midterm's level.

    python manage.py test midterms.tests_catalog_level
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from exams.models import Module
from midterms.models import Midterm

User = get_user_model()

CATALOG = "/api/midterms/teacher/midterms/"


def _midterm(title: str, subject: str, level: str, *, published: bool = True) -> Midterm:
    module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
    return Midterm.objects.create(
        title=title,
        subject=subject,
        level=level,
        scoring_scale=Midterm.SCALE_100,
        duration_minutes=30,
        question_module=module,
        is_published=published,
    )


class MidtermCatalogLevelTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create(username="t_cat", email="t_cat@x.io", is_staff=True)
        self.c = APIClient()
        self.c.force_authenticate(self.teacher)

    def _rows(self):
        r = self.c.get(CATALOG)
        self.assertEqual(r.status_code, 200, r.content)
        return {row["title"]: row for row in r.json()["results"]}

    def test_catalog_reports_each_midterms_level(self):
        _midterm("Junior RW", Midterm.READING_WRITING, Midterm.LEVEL_JUNIOR)
        _midterm("Middle Math", Midterm.MATH, Midterm.LEVEL_MIDDLE)
        rows = self._rows()
        self.assertEqual(rows["Junior RW"]["level"], "junior")
        self.assertEqual(rows["Middle Math"]["level"], "middle")
        # Subject still reported — the picker scopes on both.
        self.assertEqual(rows["Junior RW"]["subject"], Midterm.READING_WRITING)
        self.assertEqual(rows["Middle Math"]["subject"], Midterm.MATH)

    def test_untagged_midterm_reports_blank_level(self):
        _midterm("Untagged", Midterm.MATH, "")
        self.assertEqual(self._rows()["Untagged"]["level"], "")

    def test_levels_are_the_shared_lowercase_codes(self):
        """Midterm levels must match classes.Classroom.level verbatim, or the
        picker's equality filter silently hides everything."""
        from classes.models import Classroom

        self.assertEqual(
            {c[0] for c in Midterm.LEVEL_CHOICES},
            {c[0] for c in Classroom.LEVEL_CHOICES},
        )
