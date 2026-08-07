"""Surveys: authoring is super_admin's, answering is once, completing pays 40."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from rewards.models import PointAward
from rewards.services import balance
from surveys import services
from surveys.models import Survey, SurveyAnswer, SurveyQuestion, SurveyResponse

User = get_user_model()


class SurveyFixture(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.super_admin = User.objects.create_user(
            "sv_super@t.com", "secret123", role=C.ROLE_SUPER_ADMIN
        )
        self.admin = User.objects.create_user("sv_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.teacher = User.objects.create_user(
            "sv_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.student = User.objects.create_user("sv_student@t.com", "secret123")
        self.survey = Survey.objects.create(
            title="How is the term going?", status=Survey.STATUS_PUBLISHED,
            created_by=self.super_admin,
        )
        self.q_text = SurveyQuestion.objects.create(
            survey=self.survey, order=0, prompt="What is going well?",
            question_type=SurveyQuestion.TYPE_LONG_TEXT, is_required=True,
        )
        self.q_choice = SurveyQuestion.objects.create(
            survey=self.survey, order=1, prompt="Favourite subject",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE, options=["Maths", "English"],
        )
        self.q_scale = SurveyQuestion.objects.create(
            survey=self.survey, order=2, prompt="Rate the lessons",
            question_type=SurveyQuestion.TYPE_SCALE, scale_min=1, scale_max=5,
        )

    def full_answers(self):
        return {
            str(self.q_text.id): "The classes",
            str(self.q_choice.id): "Maths",
            str(self.q_scale.id): 4,
        }


class AuthoringIsSuperAdminOnlyTests(SurveyFixture):
    """The school's instruction. Enforced per-endpoint, not by hiding the page: the ops nav
    has no per-item role gating, so a page gate alone would be decoration."""

    def _create(self, actor):
        self.client.force_authenticate(actor)
        return self.client.post("/api/surveys/admin/", {"title": "New"}, format="json")

    def test_a_super_admin_can_create_a_survey(self):
        self.assertEqual(self._create(self.super_admin).status_code, 201)

    def test_a_plain_admin_cannot(self):
        self.assertEqual(self._create(self.admin).status_code, 403)

    def test_a_teacher_cannot(self):
        self.assertEqual(self._create(self.teacher).status_code, 403)

    def test_a_student_cannot(self):
        self.assertEqual(self._create(self.student).status_code, 403)

    def test_a_student_cannot_read_the_responses_of_others(self):
        self.client.force_authenticate(self.student)
        response = self.client.get(f"/api/surveys/admin/{self.survey.id}/responses/")
        self.assertEqual(response.status_code, 403)

    def test_a_survey_with_responses_cannot_be_deleted(self):
        """Deleting would cascade the responses away — and with them the evidence behind
        every 40-point award the survey paid."""
        services.submit_response(self.survey, self.student, self.full_answers())

        self.client.force_authenticate(self.super_admin)
        response = self.client.delete(f"/api/surveys/admin/{self.survey.id}/")

        self.assertEqual(response.status_code, 400)
        self.assertTrue(Survey.objects.filter(pk=self.survey.pk).exists())

    def test_an_empty_survey_cannot_be_published(self):
        empty = Survey.objects.create(title="Nothing here", created_by=self.super_admin)
        self.client.force_authenticate(self.super_admin)
        response = self.client.patch(
            f"/api/surveys/admin/{empty.id}/", {"status": "PUBLISHED"}, format="json"
        )
        self.assertEqual(response.status_code, 400)


class AnsweringTests(SurveyFixture):
    def test_a_completed_survey_is_recorded_with_its_answers(self):
        response = services.submit_response(self.survey, self.student, self.full_answers())

        self.assertEqual(response.status, SurveyResponse.STATUS_SUBMITTED)
        self.assertEqual(SurveyAnswer.objects.filter(response=response).count(), 3)
        self.assertEqual(
            SurveyAnswer.objects.get(response=response, question=self.q_choice).value, "Maths"
        )

    def test_a_survey_can_only_be_answered_once(self):
        services.submit_response(self.survey, self.student, self.full_answers())
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, self.full_answers())

    def test_a_draft_survey_cannot_be_answered(self):
        """Otherwise the author could hand the link around and mint points from a survey
        nobody has approved."""
        self.survey.status = Survey.STATUS_DRAFT
        self.survey.save(update_fields=["status"])
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, self.full_answers())

    def test_a_closed_survey_cannot_be_answered(self):
        self.survey.closes_at = timezone.now() - timedelta(hours=1)
        self.survey.save(update_fields=["closes_at"])
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, self.full_answers())

    def test_a_missing_required_answer_is_refused(self):
        answers = self.full_answers()
        answers[str(self.q_text.id)] = ""
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, answers)

    def test_an_optional_question_may_be_skipped(self):
        answers = {str(self.q_text.id): "Fine"}
        response = services.submit_response(self.survey, self.student, answers)

        # Skipped stores None, not "", so "skipped" and "answered with nothing" stay distinct.
        self.assertIsNone(
            SurveyAnswer.objects.get(response=response, question=self.q_choice).value
        )

    def test_an_option_that_is_not_on_the_list_is_refused(self):
        answers = self.full_answers()
        answers[str(self.q_choice.id)] = "Chemistry"
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, answers)

    def test_a_scale_answer_outside_its_range_is_refused(self):
        answers = self.full_answers()
        answers[str(self.q_scale.id)] = 9
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, answers)

    def test_nothing_is_saved_when_one_answer_is_invalid(self):
        """Validate everything before writing anything — a half-saved response would leave
        the student looking at a form they cannot resubmit."""
        answers = self.full_answers()
        answers[str(self.q_scale.id)] = 99
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, answers)

        self.assertEqual(SurveyResponse.objects.count(), 0)
        self.assertEqual(SurveyAnswer.objects.count(), 0)

    def test_checkbox_answers_are_deduplicated(self):
        multi = SurveyQuestion.objects.create(
            survey=self.survey, order=3, prompt="Which days suit you?",
            question_type=SurveyQuestion.TYPE_MULTI_CHOICE, options=["Mon", "Wed", "Fri"],
        )
        answers = self.full_answers()
        answers[str(multi.id)] = ["Mon", "Fri", "Mon"]
        response = services.submit_response(self.survey, self.student, answers)

        self.assertEqual(
            SurveyAnswer.objects.get(response=response, question=multi).value, ["Mon", "Fri"]
        )

    def test_the_open_list_hides_a_survey_already_completed(self):
        self.assertEqual(services.open_surveys_for(self.student).count(), 1)
        services.submit_response(self.survey, self.student, self.full_answers())
        self.assertEqual(services.open_surveys_for(self.student).count(), 0)


class SurveyRewardTests(SurveyFixture):
    def test_completing_a_survey_earns_forty(self):
        services.submit_response(self.survey, self.student, self.full_answers())
        self.assertEqual(balance(self.student), 40)

    def test_a_survey_pays_only_once(self):
        services.submit_response(self.survey, self.student, self.full_answers())
        with self.assertRaises(ValidationError):
            services.submit_response(self.survey, self.student, self.full_answers())

        self.assertEqual(balance(self.student), 40)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 1)

    def test_survey_points_carry_no_classroom(self):
        """A survey is sent by the school, not by a class — attributing it to one would put
        it on that class's board and nobody else's."""
        services.submit_response(self.survey, self.student, self.full_answers())
        self.assertIsNone(PointAward.objects.get(student=self.student).classroom_id)

    def test_two_surveys_pay_twice(self):
        second = Survey.objects.create(
            title="Second", status=Survey.STATUS_PUBLISHED, created_by=self.super_admin
        )
        SurveyQuestion.objects.create(
            survey=second, order=0, prompt="Anything else?",
            question_type=SurveyQuestion.TYPE_SHORT_TEXT,
        )
        services.submit_response(self.survey, self.student, self.full_answers())
        services.submit_response(second, self.student, {})

        self.assertEqual(balance(self.student), 80)


class StudentApiTests(SurveyFixture):
    def test_the_open_endpoint_lists_answerable_surveys(self):
        self.client.force_authenticate(self.student)
        body = self.client.get("/api/surveys/open/").json()

        self.assertEqual(len(body["surveys"]), 1)
        self.assertEqual(body["surveys"][0]["question_count"], 3)

    def test_answering_through_the_api_pays(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self.full_answers()}, format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(balance(self.student), 40)

    def test_a_draft_survey_is_not_readable_by_a_student(self):
        self.survey.status = Survey.STATUS_DRAFT
        self.survey.save(update_fields=["status"])
        self.client.force_authenticate(self.student)

        self.assertEqual(self.client.get(f"/api/surveys/{self.survey.id}/").status_code, 404)

    def test_the_form_reports_whether_it_is_already_done(self):
        self.client.force_authenticate(self.student)
        self.assertFalse(self.client.get(f"/api/surveys/{self.survey.id}/").json()["already_completed"])

        services.submit_response(self.survey, self.student, self.full_answers())
        self.assertTrue(self.client.get(f"/api/surveys/{self.survey.id}/").json()["already_completed"])

    def test_a_malformed_payload_is_a_400_not_a_crash(self):
        self.client.force_authenticate(self.student)
        response = self.client.post(
            f"/api/surveys/{self.survey.id}/respond/", {"answers": "nonsense"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
