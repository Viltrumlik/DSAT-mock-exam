"""Classroom directory: subject/level filters and the grouped tally.

Both exist for the ops subject → level → classroom drill-down. Without them the console has
to pull every classroom in the school just to render a picker of seven buckets.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Classroom

User = get_user_model()
URL = "/api/classes/directory/"


class DirectoryFilterTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("dir_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "dir_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )

        def make(name, subject, level):
            return Classroom.objects.create(
                name=name, subject=subject, level=level,
                lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
            )

        make("M junior 1", Classroom.SUBJECT_MATH, Classroom.LEVEL_JUNIOR)
        make("M junior 2", Classroom.SUBJECT_MATH, Classroom.LEVEL_JUNIOR)
        make("M senior", Classroom.SUBJECT_MATH, Classroom.LEVEL_SENIOR)
        make("E middle", Classroom.SUBJECT_ENGLISH, Classroom.LEVEL_MIDDLE)
        make("M untagged", Classroom.SUBJECT_MATH, "")
        self.client.force_authenticate(self.admin)

    def _names(self, response):
        body = response.json()
        rows = body["results"] if isinstance(body, dict) and "results" in body else body
        return sorted(r["name"] for r in rows)

    def test_no_parameters_returns_everything(self):
        """The previous behaviour, unchanged."""
        self.assertEqual(len(self._names(self.client.get(URL))), 5)

    def test_filtering_by_subject(self):
        self.assertEqual(
            self._names(self.client.get(URL, {"subject": "ENGLISH"})), ["E middle"]
        )

    def test_filtering_by_subject_and_level(self):
        self.assertEqual(
            self._names(self.client.get(URL, {"subject": "MATH", "level": "junior"})),
            ["M junior 1", "M junior 2"],
        )

    def test_untagged_is_reachable_as_its_own_bucket(self):
        """Level is blank on classrooms that predate the field, which is common. Without an
        explicit bucket those rows cannot be reached through the drill-down at all."""
        self.assertEqual(
            self._names(self.client.get(URL, {"subject": "MATH", "level": "untagged"})),
            ["M untagged"],
        )

    def test_an_unknown_subject_is_ignored_rather_than_returning_nothing(self):
        """A typo in a query param must not look like "the school has no classrooms"."""
        self.assertEqual(len(self._names(self.client.get(URL, {"subject": "BIOLOGY"}))), 5)

    def test_grouped_counts(self):
        body = self.client.get(URL, {"group": "1"}).json()
        tally = {(g["subject"], g["level"]): g["count"] for g in body["groups"]}

        self.assertEqual(tally[("MATH", "junior")], 2)
        self.assertEqual(tally[("MATH", "senior")], 1)
        self.assertEqual(tally[("ENGLISH", "middle")], 1)
        self.assertEqual(tally[("MATH", "untagged")], 1)

    def test_grouped_counts_cover_every_classroom(self):
        body = self.client.get(URL, {"group": "1"}).json()
        self.assertEqual(sum(g["count"] for g in body["groups"]), Classroom.objects.count())

    def test_a_teacher_still_cannot_read_the_directory(self):
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(URL).status_code, 403)
