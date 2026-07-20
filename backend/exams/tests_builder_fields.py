"""Builder authoring fields: midterm pass mark + retake parent, and the question skill picker.

These three surfaces are new API contract, not internal helpers: the builder writes
``midterm_pass_mark`` / ``midterm_retake_of`` through ``AdminMockExamSerializer``, tags a
question with a ``BankSkill`` through ``AdminQuestionSerializer``, and fills its grouped
``<select>`` from ``/api/questionbank/taxonomy/``.

The subject mapping is the sharp edge worth pinning down: ``Question.question_type`` is
MATH / READING / WRITING while the bank scopes skills as MATH / ENGLISH, so both verbal
types must resolve to ENGLISH — in the endpoint filter and in the write validation alike.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question
from questionbank.models import BankDomain, BankSkill, Subject

User = get_user_model()

_ALLOWED_HOSTS = ("testserver", "localhost", "127.0.0.1", "questions.mastersat.uz")
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}


def _staff(email: str):
    return User.objects.create_user(
        email=email, password="pw", role="super_admin", is_staff=True, is_superuser=True,
    )


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MidtermPassMarkTests(TestCase):
    """Pass mark is stored on the midterm's own scale, so the accepted band follows it."""

    URL = "/api/exams/admin/mock-exams/"

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(_staff("passmark-admin@example.com"))

    def _payload(self, **over):
        base = {
            "title": "Pass mark midterm",
            "kind": MockExam.KIND_MIDTERM,
            "midterm_subject": "MATH",
            "midterm_scoring_scale": MockExam.SCALE_100,
            "midterm_module_count": 1,
        }
        base.update(over)
        return base

    def test_pass_mark_round_trips_on_scale_100(self):
        r = self.client.post(self.URL, self._payload(midterm_pass_mark=65), format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["midterm_pass_mark"], 65)
        self.assertEqual(MockExam.objects.get(pk=r.data["id"]).midterm_pass_mark, 65)

    def test_blank_pass_mark_is_allowed(self):
        r = self.client.post(self.URL, self._payload(), format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIsNone(r.data["midterm_pass_mark"])

    def test_pass_mark_above_100_rejected_on_scale_100(self):
        r = self.client.post(self.URL, self._payload(midterm_pass_mark=560), format="json", **_QHOST)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("midterm_pass_mark", r.data)
        self.assertIn("0 and 100", str(r.data["midterm_pass_mark"]))

    def test_pass_mark_below_200_rejected_on_scale_800(self):
        # A blank SCALE_800 paper already scores 200, so 120 is unreachable.
        r = self.client.post(
            self.URL,
            self._payload(midterm_scoring_scale=MockExam.SCALE_800, midterm_pass_mark=120),
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("200 and 800", str(r.data["midterm_pass_mark"]))

    def test_pass_mark_within_800_band_accepted(self):
        r = self.client.post(
            self.URL,
            self._payload(midterm_scoring_scale=MockExam.SCALE_800, midterm_pass_mark=500),
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["midterm_pass_mark"], 500)

    def test_patching_scale_revalidates_stored_pass_mark(self):
        exam = MockExam.objects.create(
            title="Scale switch", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_scoring_scale=MockExam.SCALE_100, midterm_pass_mark=60,
        )
        r = self.client.patch(
            f"{self.URL}{exam.id}/",
            {"midterm_scoring_scale": MockExam.SCALE_800},
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("200 and 800", str(r.data["midterm_pass_mark"]))


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class MidtermRetakeParentTests(TestCase):
    URL = "/api/exams/admin/mock-exams/"

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(_staff("retake-admin@example.com"))
        self.parent = MockExam.objects.create(
            title="March midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_MIDTERM, is_published=True,
        )

    def _retake_payload(self, **over):
        base = {
            "title": "March retake",
            "kind": MockExam.KIND_MIDTERM,
            "midterm_subject": "MATH",
            "midterm_type": MockExam.TYPE_RETAKE,
            "midterm_retake_of": self.parent.id,
        }
        base.update(over)
        return base

    def test_retake_parent_round_trips(self):
        r = self.client.post(self.URL, self._retake_payload(), format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data["midterm_retake_of"], self.parent.id)

    def test_parent_rejected_when_type_is_not_retake(self):
        r = self.client.post(
            self.URL, self._retake_payload(midterm_type=MockExam.TYPE_MIDTERM), format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("midterm_retake_of", r.data)

    def test_parent_of_a_different_subject_rejected(self):
        r = self.client.post(
            self.URL, self._retake_payload(midterm_subject="READING_WRITING"), format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("same subject", str(r.data["midterm_retake_of"]))

    def test_pre_midterm_parent_rejected(self):
        # A pre-midterm never issues a pass/fail verdict, so a retake parented to one is
        # refused for EVERY student (retake_no_result) — unsittable, not merely odd.
        pre = MockExam.objects.create(
            title="Diagnostic", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_PRE_MIDTERM, is_published=True,
        )
        r = self.client.post(
            self.URL, self._retake_payload(midterm_retake_of=pre.id), format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("pre-midterm", str(r.data["midterm_retake_of"]).lower())

    def test_patching_parent_to_a_pre_midterm_rejected(self):
        pre = MockExam.objects.create(
            title="Diagnostic 2", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_PRE_MIDTERM, is_published=True,
        )
        retake = MockExam.objects.create(
            title="Retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_RETAKE, midterm_retake_of=self.parent,
        )
        r = self.client.patch(
            f"{self.URL}{retake.id}/", {"midterm_retake_of": pre.id}, format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("pre-midterm", str(r.data["midterm_retake_of"]).lower())

    def test_midterm_cannot_be_a_retake_of_itself(self):
        retake = MockExam.objects.create(
            title="Self retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_RETAKE,
        )
        r = self.client.patch(
            f"{self.URL}{retake.id}/", {"midterm_retake_of": retake.id}, format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("itself", str(r.data["midterm_retake_of"]))


def _seed_taxonomy():
    """Two domains per subject, enough to prove grouping and subject scoping."""
    english = BankDomain.objects.create(
        subject=Subject.ENGLISH, name="Craft and Structure", code="craft", display_order=1,
    )
    math = BankDomain.objects.create(
        subject=Subject.MATH, name="Algebra", code="algebra", display_order=1,
    )
    return {
        "english_domain": english,
        "math_domain": math,
        "english_skill": BankSkill.objects.create(
            domain=english, name="Words in Context", code="words-in-context", display_order=1,
        ),
        "math_skill": BankSkill.objects.create(
            domain=math, name="Linear functions", code="linear-functions", display_order=1,
        ),
    }


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class BankTaxonomyEndpointTests(TestCase):
    URL = "/api/questionbank/taxonomy/"

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(_staff("taxonomy-admin@example.com"))
        self.tax = _seed_taxonomy()

    def test_unfiltered_returns_every_subject_grouped_by_domain(self):
        r = self.client.get(self.URL, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        results = r.data["results"]
        self.assertEqual({d["domain"] for d in results}, {"Craft and Structure", "Algebra"})
        algebra = next(d for d in results if d["domain"] == "Algebra")
        self.assertEqual(algebra["domain_id"], self.tax["math_domain"].id)
        self.assertEqual(
            algebra["skills"], [{"id": self.tax["math_skill"].id, "name": "Linear functions"}],
        )

    def test_math_subject_filter_excludes_english(self):
        r = self.client.get(self.URL, {"subject": "MATH"}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([d["domain"] for d in r.data["results"]], ["Algebra"])

    def test_reading_and_writing_both_resolve_to_english(self):
        # exams.Question.question_type has no ENGLISH — READING and WRITING are the
        # two halves of the bank's single ENGLISH subject.
        for alias in ("ENGLISH", "READING", "WRITING", "READING_WRITING"):
            with self.subTest(alias=alias):
                r = self.client.get(self.URL, {"subject": alias}, **_QHOST)
                self.assertEqual(r.status_code, 200, r.content)
                self.assertEqual([d["domain"] for d in r.data["results"]], ["Craft and Structure"])

    def test_unknown_subject_returns_nothing_rather_than_everything(self):
        r = self.client.get(self.URL, {"subject": "HISTORY"}, **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["results"], [])

    def test_anonymous_is_rejected(self):
        anon = APIClient()
        r = anon.get(self.URL, **_QHOST)
        self.assertIn(r.status_code, (401, 403), r.content)


@override_settings(ALLOWED_HOSTS=list(_ALLOWED_HOSTS))
class QuestionSkillFieldTests(TestCase):
    """``skill`` is optional but subject-scoped — the error report reads it verbatim."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(_staff("skill-admin@example.com"))
        self.tax = _seed_taxonomy()

        self.exam = MockExam.objects.create(
            title="Skill midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_scoring_scale=MockExam.SCALE_100, midterm_module_count=1,
        )
        self.pt = PracticeTest.objects.create(
            subject="MATH", form_type="INTERNATIONAL", mock_exam=self.exam,
            title="Skill section", skip_default_modules=True,
        )
        self.mod = Module.objects.create(
            practice_test=self.pt, module_order=1, time_limit_minutes=35,
        )
        self.question = Question.objects.create(
            module=self.mod, question_type="MATH", question_text="2 + 2 = ?",
            correct_answers="a", option_a="4", option_b="5", option_c="6", option_d="7",
            score=10, order=0,
        )

    def _url(self, question_id=None):
        base = f"/api/exams/admin/tests/{self.pt.id}/modules/{self.mod.id}/questions/"
        return base if question_id is None else f"{base}{question_id}/"

    def test_unclassified_question_reads_back_blank_labels(self):
        r = self.client.get(self._url(), **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        row = r.data[0]
        self.assertIsNone(row["skill"])
        self.assertEqual(row["skill_name"], "")
        self.assertEqual(row["domain_name"], "")

    def test_assigning_a_skill_emits_its_labels(self):
        r = self.client.patch(
            self._url(self.question.id),
            {"skill": self.tax["math_skill"].id},
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["skill"], self.tax["math_skill"].id)
        self.assertEqual(r.data["skill_name"], "Linear functions")
        self.assertEqual(r.data["domain_name"], "Algebra")
        self.question.refresh_from_db()
        self.assertEqual(self.question.skill_id, self.tax["math_skill"].id)

    def test_skill_can_be_cleared_back_to_unclassified(self):
        self.question.skill = self.tax["math_skill"]
        self.question.save(update_fields=["skill"])
        r = self.client.patch(
            self._url(self.question.id), {"skill": None}, format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.question.refresh_from_db()
        self.assertIsNone(self.question.skill_id)

    def test_english_skill_rejected_on_a_math_question(self):
        r = self.client.patch(
            self._url(self.question.id),
            {"skill": self.tax["english_skill"].id},
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("skill", r.data)

    def test_english_skill_accepted_on_a_writing_question(self):
        # READING and WRITING are one bank subject, so a WRITING question takes any
        # ENGLISH skill — this is the mapping the picker relies on.
        rw_pt = PracticeTest.objects.create(
            subject="READING_WRITING", form_type="INTERNATIONAL", mock_exam=self.exam,
            title="RW section", skip_default_modules=True,
        )
        rw_mod = Module.objects.create(
            practice_test=rw_pt, module_order=1, time_limit_minutes=35,
        )
        q = Question.objects.create(
            module=rw_mod, question_type="WRITING", question_text="Pick the transition.",
            correct_answers="a", option_a="However", option_b="So", option_c="And",
            option_d="Yet", score=10, order=0,
        )
        r = self.client.patch(
            f"/api/exams/admin/tests/{rw_pt.id}/modules/{rw_mod.id}/questions/{q.id}/",
            {"skill": self.tax["english_skill"].id},
            format="json",
            **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data["domain_name"], "Craft and Structure")

    def test_stub_create_still_works_without_a_skill(self):
        r = self.client.post(self._url(), {}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIsNone(r.data["skill"])


class RetakeParentFlipTests(TestCase):
    """The retake link must not be breakable from the PARENT's side either.

    ``_validate_retake_of`` only ever inspects the row's own parent, so the same unsittable
    state was reachable by saving the retake correctly and then flipping the parent to
    PRE_MIDTERM — a pre-midterm issues no verdict, so no student is ever eligible.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            username="flipadmin", email="flipadmin@example.com", password="x",
            role="super_admin", is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.parent = MockExam.objects.create(
            title="Midterm 12", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_MIDTERM, midterm_scoring_scale="SCALE_100",
        )
        self.retake = MockExam.objects.create(
            title="Midterm 12 — Retake", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_RETAKE, midterm_scoring_scale="SCALE_100",
            midterm_retake_of=self.parent,
        )

    def _patch(self, exam, payload):
        return self.client.patch(f"/api/exams/admin/mock-exams/{exam.pk}/", payload, format="json")

    def test_parent_cannot_become_a_pre_midterm_while_it_has_a_retake(self):
        resp = self._patch(self.parent, {"midterm_type": "PRE_MIDTERM"})
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("midterm_type", resp.data)
        self.parent.refresh_from_db()
        self.assertEqual(self.parent.midterm_type, MockExam.TYPE_MIDTERM)

    def test_the_error_names_the_retake_so_the_admin_can_act(self):
        resp = self._patch(self.parent, {"midterm_type": "PRE_MIDTERM"})
        self.assertIn("Retake", str(resp.data["midterm_type"]))

    def test_parent_may_become_a_pre_midterm_once_the_retake_is_detached(self):
        self._patch(self.retake, {"midterm_type": "MIDTERM", "midterm_retake_of": None})
        resp = self._patch(self.parent, {"midterm_type": "PRE_MIDTERM"})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_an_unrelated_midterm_may_still_become_a_pre_midterm(self):
        solo = MockExam.objects.create(
            title="Solo", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_type=MockExam.TYPE_MIDTERM, midterm_scoring_scale="SCALE_100",
        )
        self.assertEqual(self._patch(solo, {"midterm_type": "PRE_MIDTERM"}).status_code, 200)
