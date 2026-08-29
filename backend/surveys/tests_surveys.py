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


# ════════════════════════════════════════════════════════════════════════════
# The overhaul: anonymity, the recommendation slider, follow-up boxes, pictures,
# reordering, and results that can be read.
# ════════════════════════════════════════════════════════════════════════════


class AnonymityTests(SurveyFixture):
    """A student may hide their name — but only where the author offered it."""

    def _submit(self, *, anonymous):
        self.client.force_authenticate(self.student)
        return self.client.post(
            f"/api/surveys/{self.survey.id}/respond/",
            {"answers": self.full_answers(), "anonymous": anonymous},
            format="json",
        )

    def test_a_survey_is_signed_unless_the_author_opens_it_up(self):
        self.assertFalse(self.survey.allow_anonymous)
        r = self._submit(anonymous=True)
        self.assertEqual(r.status_code, 201)
        # Asked for, not granted — and the response says so rather than letting the student
        # believe a promise the survey never made.
        self.assertFalse(r.json()["is_anonymous"])
        self.assertFalse(SurveyResponse.objects.get().is_anonymous)

    def test_the_student_chooses_when_the_author_allows_it(self):
        Survey.objects.filter(pk=self.survey.pk).update(allow_anonymous=True)
        self.assertEqual(self._submit(anonymous=True).json()["is_anonymous"], True)
        self.assertTrue(SurveyResponse.objects.get().is_anonymous)

    def test_allowing_anonymity_does_not_impose_it(self):
        Survey.objects.filter(pk=self.survey.pk).update(allow_anonymous=True)
        self._submit(anonymous=False)
        self.assertFalse(SurveyResponse.objects.get().is_anonymous)

    def test_an_anonymous_reply_carries_no_name_and_no_id(self):
        """Enforced in the serializer, so it holds for anyone reading the network tab."""
        Survey.objects.filter(pk=self.survey.pk).update(allow_anonymous=True)
        self._submit(anonymous=True)
        self.client.force_authenticate(self.super_admin)
        row = self.client.get(f"/api/surveys/admin/{self.survey.id}/responses/").json()["responses"][0]
        self.assertEqual(row["student_name"], "Anonymous")
        self.assertIsNone(row["student"])

    def test_the_row_still_knows_who_wrote_it(self):
        """Anonymity is about what is READ. One-response-per-student and the 40 points both
        hang off the student FK, so unlinking the row would give away both."""
        Survey.objects.filter(pk=self.survey.pk).update(allow_anonymous=True)
        self._submit(anonymous=True)
        self.assertEqual(SurveyResponse.objects.get().student_id, self.student.id)
        self.assertEqual(balance(self.student), 40)
        # And they still cannot answer twice.
        self.assertEqual(self._submit(anonymous=True).status_code, 400)


class RecommendationSliderTests(SurveyFixture):
    def setUp(self):
        super().setUp()
        self.q_rating = SurveyQuestion.objects.create(
            survey=self.survey, order=3, prompt="Would you recommend us?",
            question_type=SurveyQuestion.TYPE_RATING, scale_min=0, scale_max=10,
            scale_low_label="Would not recommend", scale_high_label="Would recommend",
        )

    def answers(self, score):
        return {**self.full_answers(), str(self.q_rating.id): score}

    def test_zero_is_an_answer_not_a_blank(self):
        """The lowest score on the slider is 0, and 0 is falsy in every language this
        request passes through. Reading it as 'unanswered' would silently discard the
        single most important reply a satisfaction survey can receive."""
        self.assertEqual(services.normalize_answer(self.q_rating, 0), 0)

    def test_the_whole_range_is_accepted(self):
        for score in range(0, 11):
            self.assertEqual(services.normalize_answer(self.q_rating, score), score)

    def test_a_score_off_the_end_is_refused(self):
        with self.assertRaises(ValidationError):
            services.normalize_answer(self.q_rating, 11)

    def test_a_string_from_a_slider_still_counts(self):
        self.assertEqual(services.normalize_answer(self.q_rating, "7"), 7)

    def test_the_labels_reach_the_student(self):
        self.client.force_authenticate(self.student)
        payload = self.client.get(f"/api/surveys/{self.survey.id}/").json()
        rating = [q for q in payload["questions"] if q["id"] == self.q_rating.id][0]
        self.assertEqual(rating["scale_low_label"], "Would not recommend")
        self.assertEqual(rating["scale_high_label"], "Would recommend")

    def test_an_author_can_rewrite_the_labels(self):
        self.client.force_authenticate(self.super_admin)
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/questions/{self.q_rating.id}/",
            {"scale_low_label": "Juda yomon", "scale_high_label": "Juda zo‘r"},
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["scale_low_label"], "Juda yomon")


class ScoreFollowUpTests(SurveyFixture):
    """"Satisfactory is 8" — so 7 and below are asked why."""

    def setUp(self):
        super().setUp()
        self.q_rating = SurveyQuestion.objects.create(
            survey=self.survey, order=3, prompt="Would you recommend us?",
            question_type=SurveyQuestion.TYPE_RATING, scale_min=0, scale_max=10,
            follow_up_threshold=8,
            follow_up_placeholder="Why did you give this score?",
        )

    def submit(self, score, note=None):
        self.client.force_authenticate(self.student)
        body = {"answers": {**self.full_answers(), str(self.q_rating.id): score}}
        if note is not None:
            body["follow_ups"] = {str(self.q_rating.id): note}
        return self.client.post(
            f"/api/surveys/{self.survey.id}/respond/", body, format="json"
        )

    def test_the_threshold_is_satisfactory_not_a_failing_grade(self):
        """8 is fine; 7 is not. An author who says 'satisfactory = 8' means 8 passes."""
        self.assertTrue(self.q_rating.wants_follow_up_for_score(7))
        self.assertFalse(self.q_rating.wants_follow_up_for_score(8))
        self.assertFalse(self.q_rating.wants_follow_up_for_score(10))

    def test_a_low_score_keeps_its_comment(self):
        self.assertEqual(self.submit(6, "The pace is too fast").status_code, 201)
        answer = SurveyAnswer.objects.get(question=self.q_rating)
        self.assertEqual(answer.value, 6)
        self.assertEqual(answer.follow_up, "The pace is too fast")

    def test_a_comment_on_a_satisfied_score_is_dropped_not_refused(self):
        """The box closes when the slider passes the threshold. Failing the whole submission
        over text the student can no longer see would be a dead end with no visible cause."""
        r = self.submit(9, "left over from when the slider was at 5")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(SurveyAnswer.objects.get(question=self.q_rating).follow_up, "")

    def test_the_comment_is_optional_by_default(self):
        self.assertEqual(self.submit(3).status_code, 201)
        self.assertEqual(SurveyAnswer.objects.get(question=self.q_rating).follow_up, "")

    def test_an_author_may_insist(self):
        SurveyQuestion.objects.filter(pk=self.q_rating.pk).update(follow_up_required=True)
        r = self.submit(3)
        self.assertEqual(r.status_code, 400)
        self.assertIn("recommend", r.json()["detail"])
        # ...and a satisfied score never trips it, because the box was never shown.
        self.assertEqual(self.submit(9).status_code, 201)

    def test_no_threshold_means_the_box_never_opens(self):
        SurveyQuestion.objects.filter(pk=self.q_rating.pk).update(follow_up_threshold=None)
        self.submit(0, "should be dropped")
        self.assertEqual(SurveyAnswer.objects.get(question=self.q_rating).follow_up, "")

    def test_a_threshold_outside_the_scale_is_refused_at_authoring_time(self):
        self.client.force_authenticate(self.super_admin)
        for bad in (0, 11):
            r = self.client.patch(
                f"/api/surveys/admin/{self.survey.id}/questions/{self.q_rating.id}/",
                {"follow_up_threshold": bad}, format="json",
            )
            self.assertEqual(r.status_code, 400, bad)
            self.assertIn("follow_up_threshold", r.json())


class ChoiceFollowUpTests(SurveyFixture):
    """Picking "I have a suggestion" opens a box; picking anything else does not."""

    def setUp(self):
        super().setUp()
        self.q = SurveyQuestion.objects.create(
            survey=self.survey, order=3, prompt="Anything to add?",
            question_type=SurveyQuestion.TYPE_MULTI_CHOICE,
            options=["All good", "I have a suggestion"],
            follow_up_options=["I have a suggestion"],
            follow_up_placeholder="What would you change?",
        )

    def submit(self, picked, note=None):
        self.client.force_authenticate(self.student)
        body = {"answers": {**self.full_answers(), str(self.q.id): picked}}
        if note is not None:
            body["follow_ups"] = {str(self.q.id): note}
        return self.client.post(f"/api/surveys/{self.survey.id}/respond/", body, format="json")

    def test_the_trigger_option_opens_the_box(self):
        self.assertTrue(self.q.wants_follow_up_for_choice(["I have a suggestion"]))
        self.assertFalse(self.q.wants_follow_up_for_choice(["All good"]))

    def test_one_trigger_among_several_picks_is_enough(self):
        self.assertTrue(self.q.wants_follow_up_for_choice(["All good", "I have a suggestion"]))

    def test_the_suggestion_is_stored_with_the_choice(self):
        self.assertEqual(self.submit(["I have a suggestion"], "More past papers").status_code, 201)
        answer = SurveyAnswer.objects.get(question=self.q)
        self.assertEqual(answer.value, ["I have a suggestion"])
        self.assertEqual(answer.follow_up, "More past papers")

    def test_a_note_left_on_a_non_trigger_choice_is_dropped(self):
        self.submit(["All good"], "stale text")
        self.assertEqual(SurveyAnswer.objects.get(question=self.q).follow_up, "")

    def test_a_single_choice_question_triggers_too(self):
        q = SurveyQuestion.objects.create(
            survey=self.survey, order=4, prompt="How was it?",
            question_type=SurveyQuestion.TYPE_SINGLE_CHOICE,
            options=["Fine", "Not great"], follow_up_options=["Not great"],
        )
        self.assertTrue(q.wants_follow_up_for_choice("Not great"))
        self.assertFalse(q.wants_follow_up_for_choice("Fine"))

    def test_a_trigger_that_is_not_an_option_is_refused_at_authoring_time(self):
        self.client.force_authenticate(self.super_admin)
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/",
            {
                "prompt": "Pick one", "question_type": SurveyQuestion.TYPE_SINGLE_CHOICE,
                "options": ["Yes", "No"], "follow_up_options": ["Maybe"],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("follow_up_options", r.json())

    def test_duplicate_options_are_refused(self):
        """The stored answer IS the option text, so two identical options would be two rows
        of results nobody could tell apart."""
        self.client.force_authenticate(self.super_admin)
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/",
            {
                "prompt": "Pick one", "question_type": SurveyQuestion.TYPE_SINGLE_CHOICE,
                "options": ["Yes", "Yes"],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("options", r.json())


class QuestionPictureTests(SurveyFixture):
    #: The smallest thing Pillow will open — a 1x1 PNG. Written as bytes rather than read
    #: from a fixture file so this test carries no external dependency.
    PNG = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    def _png(self, name="pic.png"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        return SimpleUploadedFile(name, self.PNG, content_type="image/png")

    def test_a_question_with_no_picture_reports_none_rather_than_raising(self):
        """`.url` on an unset ImageField raises ValueError — the exact 500 the guarded
        helper exists to prevent."""
        self.client.force_authenticate(self.student)
        payload = self.client.get(f"/api/surveys/{self.survey.id}/").json()
        self.assertIsNone(payload["image_url"])
        self.assertTrue(all(q["image_url"] is None for q in payload["questions"]))

    def test_a_picture_can_be_attached_to_a_question(self):
        """Exercises the multipart parser on the authoring base — without it every one of
        these endpoints answers 415 the first time somebody attaches a file."""
        self.client.force_authenticate(self.super_admin)
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/",
            {
                "prompt": "What does this diagram show?",
                "question_type": SurveyQuestion.TYPE_SHORT_TEXT,
                "image": self._png(),
            },
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIsNotNone(r.json()["image_url"])

    def test_a_picture_can_be_attached_to_the_survey_itself(self):
        self.client.force_authenticate(self.super_admin)
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/",
            {"image": self._png()},
            format="multipart",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNotNone(r.json()["image_url"])

    def test_the_student_sees_the_picture_the_author_attached(self):
        self.client.force_authenticate(self.super_admin)
        self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/", {"image": self._png()}, format="multipart"
        )
        self.client.force_authenticate(self.student)
        self.assertIsNotNone(self.client.get(f"/api/surveys/{self.survey.id}/").json()["image_url"])

    def test_an_image_only_patch_does_not_disturb_anything_else(self):
        """The console sends the picture on its own with an empty patch — bundling it with
        the text fields would re-upload it on every blur-save. A partial PATCH must not
        blank the title on its way through."""
        self.client.force_authenticate(self.super_admin)
        r = self.client.patch(
            f"/api/surveys/admin/{self.survey.id}/", {"image": self._png()}, format="multipart"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["title"], "How is the term going?")
        self.assertEqual(r.json()["status"], Survey.STATUS_PUBLISHED)


class ReorderTests(SurveyFixture):
    def test_the_whole_order_moves_in_one_request(self):
        self.client.force_authenticate(self.super_admin)
        reversed_ids = [self.q_scale.id, self.q_choice.id, self.q_text.id]
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/reorder/",
            {"order": reversed_ids}, format="json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual([q["id"] for q in r.json()["questions"]], reversed_ids)
        self.assertEqual(
            list(self.survey.questions.values_list("id", flat=True)), reversed_ids
        )

    def test_a_partial_ordering_is_refused(self):
        """Accepting it would quietly drop every omitted question to the end of the form."""
        self.client.force_authenticate(self.super_admin)
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/reorder/",
            {"order": [self.q_scale.id]}, format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_reordering_is_super_admin_only(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            f"/api/surveys/admin/{self.survey.id}/questions/reorder/",
            {"order": [self.q_text.id, self.q_choice.id, self.q_scale.id]}, format="json",
        )
        self.assertEqual(r.status_code, 403)


class ResultsTests(SurveyFixture):
    """The console reads 'what did the school say' before 'what did this student say'."""

    def setUp(self):
        super().setUp()
        self.q_rating = SurveyQuestion.objects.create(
            survey=self.survey, order=3, prompt="Would you recommend us?",
            question_type=SurveyQuestion.TYPE_RATING, scale_min=0, scale_max=10,
            follow_up_threshold=8,
        )

    def _answer(self, email, choice, score, note=None):
        student = User.objects.create_user(email, "secret123")
        services.submit_response(
            self.survey, student,
            {
                str(self.q_text.id): "Fine", str(self.q_choice.id): choice,
                str(self.q_scale.id): 4, str(self.q_rating.id): score,
            },
            follow_ups={str(self.q_rating.id): note} if note else None,
        )

    def summaries(self):
        return {s["question_id"]: s for s in services.survey_results(self.survey)["summaries"]}

    def test_a_choice_question_comes_back_as_a_distribution(self):
        self._answer("r1@t.com", "Maths", 9)
        self._answer("r2@t.com", "Maths", 9)
        self._answer("r3@t.com", "English", 9)
        options = {o["text"]: o for o in self.summaries()[self.q_choice.id]["options"]}
        self.assertEqual(options["Maths"]["count"], 2)
        self.assertEqual(options["Maths"]["percent"], 66.7)
        self.assertEqual(options["English"]["count"], 1)

    def test_a_slider_comes_back_as_an_average_and_a_count_below_the_bar(self):
        self._answer("r1@t.com", "Maths", 10)
        self._answer("r2@t.com", "Maths", 6, "Too fast")
        self._answer("r3@t.com", "Maths", 2, "Room is cold")
        summary = self.summaries()[self.q_rating.id]
        self.assertEqual(summary["average"], 6.0)
        self.assertEqual(summary["threshold"], 8)
        self.assertEqual(summary["below_threshold"], 2)
        self.assertEqual({c["text"] for c in summary["comments"]}, {"Too fast", "Room is cold"})

    def test_a_skipped_question_is_counted_apart_from_an_answered_one(self):
        """A skipped optional question is NULL, and must not drag an average down."""
        self._answer("r1@t.com", "Maths", 10)
        services.submit_response(
            self.survey, User.objects.create_user("r2@t.com", "secret123"),
            {str(self.q_text.id): "Fine"},   # everything else skipped
        )
        summary = self.summaries()[self.q_rating.id]
        self.assertEqual(summary["answered"], 1)
        self.assertEqual(summary["skipped"], 1)
        self.assertEqual(summary["average"], 10.0)

    def test_free_text_comes_back_as_lines(self):
        self._answer("r1@t.com", "Maths", 9)
        self.assertEqual(self.summaries()[self.q_text.id]["texts"], ["Fine"])

    def test_the_endpoint_serves_summaries_beside_the_replies(self):
        self._answer("r1@t.com", "Maths", 9)
        self.client.force_authenticate(self.super_admin)
        body = self.client.get(f"/api/surveys/admin/{self.survey.id}/responses/").json()
        self.assertEqual(len(body["summaries"]), 4)
        self.assertEqual(len(body["responses"]), 1)

    def test_the_csv_names_a_column_per_question_and_keeps_comments_beside_them(self):
        self._answer("r1@t.com", "Maths", 6, "Too fast")
        self.client.force_authenticate(self.super_admin)
        r = self.client.get(f"/api/surveys/admin/{self.survey.id}/responses.csv")
        self.assertEqual(r.status_code, 200)
        text = r.content.decode("utf-8-sig")
        self.assertIn("Would you recommend us?,Would you recommend us? — comment", text)
        self.assertIn("Too fast", text)

    def test_the_csv_is_super_admin_only(self):
        self.client.force_authenticate(self.teacher)
        r = self.client.get(f"/api/surveys/admin/{self.survey.id}/responses.csv")
        self.assertEqual(r.status_code, 403)


class EmptySurveyTests(SurveyFixture):
    def test_a_published_survey_with_no_questions_left_is_not_offered(self):
        """Nothing stops an author deleting the last question after publishing. Until this
        filter existed the empty form stayed on the student's list, opened to a page with
        nothing on it, and offered a Submit the server refused."""
        self.survey.questions.all().delete()
        self.client.force_authenticate(self.student)
        r = self.client.get("/api/surveys/open/")
        self.assertEqual(r.json()["surveys"], [])

    def test_a_survey_is_listed_once_however_many_questions_it_has(self):
        """The join to questions multiplies the row; `.distinct()` is what collapses it."""
        self.client.force_authenticate(self.student)
        ids = [s["id"] for s in self.client.get("/api/surveys/open/").json()["surveys"]]
        self.assertEqual(ids, [self.survey.id])
