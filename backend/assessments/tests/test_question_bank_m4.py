"""
M4 — Question Bank → Assessment integration tests (assessments only).

Covers the six required scenarios plus a backward-compatibility guard that
non-bank assessments are completely unaffected.
"""
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase

from assessments.domain.bank_integration import create_question_from_bank
from assessments.domain.publish_service import publish_assessment_set
from assessments.domain.snapshot_builder import build_snapshot, compute_checksum, verify_snapshot_integrity
from assessments.models import AssessmentQuestion, AssessmentSet
from questionbank.models import BankDomain, BankSkill, Difficulty, QuestionStatus, Subject
from questionbank.services import create_bank_question, create_version
from questionbank.triage import approve_question, classify_question

User = get_user_model()


class M4AssessmentBankIntegrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_question_bank_taxonomy")
        cls.user = User.objects.create(username="m4", email="m4@test.local")
        cls.domain = BankDomain.objects.get(subject=Subject.MATH, name="Algebra")
        cls.skill = BankSkill.objects.get(domain=cls.domain, name="Linear functions")

    def _approved_bank_q(self, text="What is the slope of y = 2x + 1?"):
        q = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text=text,
            option_a="2", option_b="1", correct_answer="A",
        )
        classify_question(q, domain=self.domain, skill=self.skill, difficulty=Difficulty.EASY)
        approve_question(q)  # cuts version 2; current_version = v2
        q.refresh_from_db()
        return q

    def _set(self):
        return AssessmentSet.objects.create(
            subject="math", category="Algebra › Linear functions", title="M4 Set", created_by=self.user,
        )

    # 1 ─────────────────────────────────────────────────────────────────────
    def test_select_approved_creates_linked_question(self):
        bank = self._approved_bank_q()
        aset = self._set()
        aq = create_question_from_bank(aset, bank)
        self.assertEqual(aq.bank_question_id, bank.id)
        self.assertEqual(aq.bank_version_id, bank.current_version_id)
        self.assertEqual(aq.prompt, bank.question_text)
        self.assertEqual([c["id"] for c in aq.choices], ["A", "B"])
        self.assertEqual(aq.correct_answer, "A")

    def test_from_bank_always_appends_dense_order(self):
        # order is server-owned: repeated bank-adds to a set get dense 0..n-1 and
        # can never collide under UNIQUE(assessment_set, order). The function no
        # longer accepts a caller-supplied order (which could trip the constraint).
        aset = self._set()
        a = create_question_from_bank(aset, self._approved_bank_q("Q1?"))
        b = create_question_from_bank(aset, self._approved_bank_q("Q2?"))
        c = create_question_from_bank(aset, self._approved_bank_q("Q3?"))
        self.assertEqual([a.order, b.order, c.order], [0, 1, 2])
        with self.assertRaises(TypeError):
            create_question_from_bank(aset, self._approved_bank_q("Q4?"), order=0)

    # 2 ─────────────────────────────────────────────────────────────────────
    def test_cannot_select_triage_question(self):
        triage = create_bank_question(
            subject=Subject.MATH, question_type="MULTIPLE_CHOICE", question_text="unreviewed",
            option_a="1", option_b="2", correct_answer="A",
        )  # stays TRIAGE
        self.assertEqual(triage.status, QuestionStatus.TRIAGE)
        aset = self._set()
        with self.assertRaises(ValidationError):
            create_question_from_bank(aset, triage)
        self.assertEqual(AssessmentQuestion.objects.filter(assessment_set=aset).count(), 0)

    # 3 ─────────────────────────────────────────────────────────────────────
    def test_snapshot_pins_qb_id_and_version(self):
        bank = self._approved_bank_q()
        aset = self._set()
        create_question_from_bank(aset, bank)
        version = publish_assessment_set(set_id=aset.id, actor=self.user)
        q0 = version.snapshot_json["questions"][0]
        self.assertEqual(q0["bank_qb_id"], bank.qb_id)
        self.assertEqual(q0["bank_version_number"], bank.current_version.version_number)

    # 4 ─────────────────────────────────────────────────────────────────────
    def test_new_bank_version_does_not_alter_old_assessment(self):
        bank = self._approved_bank_q()
        aset = self._set()
        create_question_from_bank(aset, bank)
        version = publish_assessment_set(set_id=aset.id, actor=self.user)
        pinned = version.snapshot_json["questions"][0]["bank_version_number"]
        original_checksum = version.snapshot_checksum

        # Edit the bank question and cut a NEW version.
        bank.explanation = "Edited after publish."
        bank.correct_answer = "B"
        bank.save(update_fields=["explanation", "correct_answer"])
        create_version(bank)
        bank.refresh_from_db()
        self.assertGreater(bank.current_version.version_number, pinned)

        # The published snapshot is immutable and unchanged.
        version.refresh_from_db()
        self.assertEqual(version.snapshot_json["questions"][0]["bank_version_number"], pinned)
        self.assertEqual(version.snapshot_json["questions"][0]["correct_answer"], "A")
        self.assertEqual(version.snapshot_checksum, original_checksum)

    # 5 ─────────────────────────────────────────────────────────────────────
    def test_historical_analytics_remain_intact(self):
        bank = self._approved_bank_q()
        aset = self._set()
        create_question_from_bank(aset, bank)
        version = publish_assessment_set(set_id=aset.id, actor=self.user)
        pinned_version = version.snapshot_json["questions"][0]["bank_version_number"]

        # Re-tag the bank question (new taxonomy + version) — analytics on the
        # historical attempt must still reflect the version that was delivered.
        geo = BankDomain.objects.get(subject=Subject.MATH, name="Geometry and Trigonometry")
        circles = BankSkill.objects.get(domain=geo, name="Circles")
        classify_question(bank, domain=geo, skill=circles, difficulty=Difficulty.HARD)
        create_version(bank)

        version.refresh_from_db()
        self.assertEqual(version.snapshot_json["questions"][0]["bank_version_number"], pinned_version)
        self.assertEqual(version.snapshot_json["questions"][0]["bank_qb_id"], bank.qb_id)

    # 6 ─────────────────────────────────────────────────────────────────────
    def test_snapshot_rollback_safety_self_sufficient(self):
        bank = self._approved_bank_q()
        aset = self._set()
        create_question_from_bank(aset, bank)
        version = publish_assessment_set(set_id=aset.id, actor=self.user)

        # Mutate the bank heavily after publish.
        bank.correct_answer = "B"
        bank.save(update_fields=["correct_answer"])
        create_version(bank)

        # Snapshot still verifies and contains everything needed to grade — no
        # live bank lookup required.
        version.refresh_from_db()
        self.assertTrue(verify_snapshot_integrity(version.snapshot_json, version.snapshot_checksum))
        q0 = version.snapshot_json["questions"][0]
        self.assertEqual(q0["correct_answer"], "A")  # original, frozen
        self.assertIn("choices", q0)

    # backward-compat guard ──────────────────────────────────────────────────
    def test_non_bank_snapshot_is_unchanged(self):
        aset = self._set()
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="Plain question", question_type="multiple_choice",
            choices=[{"id": "A", "text": "x"}, {"id": "B", "text": "y"}], correct_answer="A", points=1,
        )
        snap = build_snapshot(aset)
        q0 = snap["questions"][0]
        # No bank keys leak into non-bank snapshots → checksum identical to pre-M4.
        self.assertNotIn("bank_qb_id", q0)
        self.assertNotIn("bank_version_number", q0)
        # checksum stays computable/stable
        self.assertTrue(compute_checksum(snap))
