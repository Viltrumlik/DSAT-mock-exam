"""Probe: can a survey that has stopped accepting answers be reopened from the console?"""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rewards.services import balance
from surveys.models import Survey, SurveyResponse
from surveys.tests_surveys import SurveyFixture


class ReopenProbeTests(SurveyFixture):
    def test_a_date_closed_survey_reopens_by_moving_closes_on(self):
        """The 'closed on Friday' case. Only console calls used."""
        # It closed on Friday.
        self.survey.closes_at = timezone.now() - timedelta(days=3)
        self.survey.save(update_fields=["closes_at"])
        self.assertFalse(self.survey.is_open())

        # The flu student cannot answer.
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(f"/api/surveys/{self.survey.id}/").status_code, 404)
        self.assertEqual(
            self.client.get("/api/surveys/open/").json()["surveys"], []
        )

        # Console: the builder's "Closes on" date input, PATCHing closes_at. Nothing else.
        self.client.force_authenticate(self.super_admin)
        new_date = (timezone.now() + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59")
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/", {"closes_at": new_date}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["is_open"])
        self.assertEqual(r.json()["status"], "PUBLISHED")

        # The flu student can now answer, and is paid.
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(f"/api/surveys/{self.survey.id}/").status_code, 200)
        self.assertEqual(
            [s["id"] for s in self.client.get("/api/surveys/open/").json()["surveys"]],
            [self.survey.id],
        )
        before = balance(self.student)
        r = self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self.full_answers()}, format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(balance(self.student) - before, 40)

    def test_a_button_closed_survey_does_not_reopen_by_moving_closes_on(self):
        """The mis-click case. status=CLOSED ignores the date entirely."""
        self.survey.status = Survey.STATUS_CLOSED
        self.survey.save(update_fields=["status"])

        self.client.force_authenticate(self.super_admin)
        new_date = (timezone.now() + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59")
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/", {"closes_at": new_date}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.json()["is_open"])

        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(f"/api/surveys/{self.survey.id}/").status_code, 404)

    def test_the_api_would_accept_a_reopen_the_console_never_sends(self):
        """Capability exists server-side; no console control writes it."""
        self.survey.status = Survey.STATUS_CLOSED
        self.survey.save(update_fields=["status"])
        self.client.force_authenticate(self.super_admin)
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/", {"status": "PUBLISHED"}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["is_open"])
