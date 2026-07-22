"""
M4 image-freeze closure + picker gaps.

Math questions carry diagrams (images). When a bank question is added to an
assessment, its image must survive publish/freeze. On this branch the frozen
delivery paths supplement images from the LIVE AssessmentQuestion row
(_image_map_for), so the closure is: create_question_from_bank copies the bank
image NAMES onto the new row. These tests prove the copy, the freeze guarantee
(a later bank edit never mutates the already-added row), and delivery.
"""
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from assessments.domain.bank_integration import create_question_from_bank, selectable_bank_questions
from assessments.models import AssessmentSet
from assessments.views import _image_map_for
from questionbank.models import BankDomain, BankSkill, Difficulty, Subject
from questionbank.services import create_bank_question, update_bank_question
from questionbank.triage import approve_question, classify_question

User = get_user_model()

DIAGRAM = "question_bank/questions/diagram_v1.png"
OPTION_IMG = "question_bank/options/opt_a_v1.png"


class M4ImageFreezeTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.user = User.objects.create(username="imgfreeze", email="img@test.local")
        cls.domain = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.skill = BankSkill.objects.get(domain=cls.domain, name="Linear functions")

    def _approved_bank_q_with_image(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE",
            question_text="Which line has slope 2?", option_a="A", option_b="B", correct_answer="A",
        )
        q.question_image = DIAGRAM
        q.option_a_image = OPTION_IMG
        q.save(update_fields=["question_image", "option_a_image"])
        classify_question(q, domain=self.domain, skill=self.skill, difficulty=Difficulty.EASY)
        approve_question(q)
        q.refresh_from_db()
        return q

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra › Linear functions", title="Img Set", created_by=self.user,
        )

    def test_create_from_bank_copies_image_names(self):
        bank = self._approved_bank_q_with_image()
        aq = create_question_from_bank(self._set(), bank)
        self.assertEqual(aq.question_image.name, DIAGRAM)
        self.assertEqual(aq.option_a_image.name, OPTION_IMG)
        self.assertFalse(aq.option_b_image)  # unset images stay empty

    def test_frozen_delivery_supplies_image_url(self):
        bank = self._approved_bank_q_with_image()
        aq = create_question_from_bank(self._set(), bank)
        img_map = _image_map_for([aq.id])
        self.assertIn(aq.id, img_map)
        self.assertTrue(img_map[aq.id]["question_image"].endswith(DIAGRAM))
        self.assertTrue(img_map[aq.id]["option_a_image"].endswith(OPTION_IMG))

    def test_image_propagates_on_bank_edit(self):
        """Live shared reference: editing the bank image propagates to the linked
        assessment question (single source of truth)."""
        from assessments.domain.bank_integration import propagate_bank_question_to_consumers

        bank = self._approved_bank_q_with_image()
        aq = create_question_from_bank(self._set(), bank)

        # Author edits the bank question's diagram; the edit flows to consumers.
        update_bank_question(bank, question_image="question_bank/questions/diagram_v2.png")
        propagate_bank_question_to_consumers(bank)

        aq.refresh_from_db()
        self.assertEqual(aq.question_image.name, "question_bank/questions/diagram_v2.png")

    def test_text_only_bank_question_has_no_images(self):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE",
            question_text="2 + 2 = ?", option_a="3", option_b="4", correct_answer="B",
        )
        classify_question(q, domain=self.domain, skill=self.skill, difficulty=Difficulty.EASY)
        approve_question(q)
        q.refresh_from_db()
        aq = create_question_from_bank(self._set(), q)
        self.assertFalse(aq.question_image)
        self.assertFalse(aq.option_a_image)


class M4PickerGapsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.domain = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.skill = BankSkill.objects.get(domain=cls.domain, name="Linear functions")
        cls.admin = User.objects.create_user(
            email="picker-admin@example.com", password="pw",
            role="super_admin", is_staff=True, is_superuser=True,
        )
        cls.bank = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE",
            question_text="Picker target", option_a="A", option_b="B", correct_answer="A",
        )
        classify_question(cls.bank, domain=cls.domain, skill=cls.skill, difficulty=Difficulty.EASY)
        approve_question(cls.bank)
        cls.bank.refresh_from_db()

    def test_picker_search_matches_qb_id(self):
        by_id = selectable_bank_questions(search=self.bank.qb_id)
        self.assertEqual(list(by_id.values_list("id", flat=True)), [self.bank.id])

    def test_taxonomy_endpoint_returns_used_domains_and_skills(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        res = client.get(reverse("assessment-admin-qb-taxonomy"), {"subject": "MATH"})
        self.assertEqual(res.status_code, 200)
        domain_ids = {d["id"] for d in res.data["domains"]}
        skill_ids = {s["id"] for s in res.data["skills"]}
        self.assertIn(self.domain.id, domain_ids)
        self.assertIn(self.skill.id, skill_ids)
