"""
rebind_question_answers management command.

Proves the audit + repair of the answer↔question binding:

  * a live question whose stored correct_answer is no longer one of its own
    choices is flagged as ``answer_unbound``;
  * a live question that drifted from its frozen version snapshot is detected
    and, with ``--apply``, restored from the snapshot (matched by question id);
  * the repair is idempotent and only touches the requested fields.

The snapshot is the source of truth (INV-S04): self-sufficient, keyed by
question id, frozen at publish time.
"""
from __future__ import annotations

import json
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from assessments.domain.snapshot_builder import build_snapshot, compute_checksum
from assessments.models import (
    AssessmentQuestion,
    AssessmentSet,
    AssessmentSetVersion,
)

User = get_user_model()


def _mc(letters_to_text: dict[str, str]) -> list[dict]:
    return [{"id": k, "text": v} for k, v in letters_to_text.items()]


class RebindQuestionAnswersTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create(username="rebind", email="rebind@test.local")
        cls.set = AssessmentSet.objects.create(
            subject="math", category="Algebra", title="Rebind Set", created_by=cls.user,
        )
        # Q1 — correct answer is C; Q2 — correct answer is A.
        cls.q1 = AssessmentQuestion.objects.create(
            assessment_set=cls.set, order=0, prompt="Q1: pick C",
            question_type="multiple_choice",
            choices=_mc({"A": "a1", "B": "b1", "C": "c1", "D": "d1"}),
            correct_answer="C",
        )
        cls.q2 = AssessmentQuestion.objects.create(
            assessment_set=cls.set, order=1, prompt="Q2: pick A",
            question_type="multiple_choice",
            choices=_mc({"A": "a2", "B": "b2", "C": "c2", "D": "d2"}),
            correct_answer="A",
        )
        # Freeze the correct binding into an immutable version snapshot.
        snap = build_snapshot(cls.set)
        cls.version = AssessmentSetVersion.objects.create(
            assessment_set=cls.set,
            version_number=1,
            snapshot_json=snap,
            snapshot_checksum=compute_checksum(snap),
            question_count=snap["question_count"],
        )

    def _scramble(self):
        """Simulate the bug: live answers drift away from the snapshot truth."""
        # Q1: still a valid letter but the WRONG one (snapshot says C).
        AssessmentQuestion.objects.filter(pk=self.q1.pk).update(correct_answer="A")
        # Q2: correct_answer now points at no existing choice → unbound.
        AssessmentQuestion.objects.filter(pk=self.q2.pk).update(correct_answer="Z")

    def _run(self, *args) -> dict:
        out = StringIO()
        call_command("rebind_question_answers", *args, "--json", stdout=out)
        return json.loads(out.getvalue())

    def test_dry_run_detects_but_does_not_write(self):
        self._scramble()
        result = self._run()  # default: dry-run, source=snapshot, all sets
        counts = {k: v["count"] for k, v in result["summary"].items()}

        self.assertFalse(result["applied"])
        self.assertEqual(counts.get("question.rebind"), 2)  # both drifted
        self.assertEqual(counts.get("question.answer_unbound"), 1)  # only Q2 is unbound

        # Nothing written yet.
        self.q1.refresh_from_db()
        self.q2.refresh_from_db()
        self.assertEqual(self.q1.correct_answer, "A")
        self.assertEqual(self.q2.correct_answer, "Z")

    def test_apply_rebinds_each_answer_to_its_question(self):
        self._scramble()
        result = self._run("--apply")
        self.assertTrue(result["applied"])

        self.q1.refresh_from_db()
        self.q2.refresh_from_db()
        # Each answer is restored to the one frozen for THAT question id.
        self.assertEqual(self.q1.correct_answer, "C")
        self.assertEqual(self.q2.correct_answer, "A")

    def test_apply_is_idempotent(self):
        self._scramble()
        self._run("--apply")
        second = self._run("--apply")
        self.assertEqual(second["summary"].get("question.rebind", {"count": 0})["count"], 0)

    def test_only_requested_fields_are_touched(self):
        self._scramble()
        # Also corrupt the prompt, but restore only the answer fields.
        AssessmentQuestion.objects.filter(pk=self.q1.pk).update(prompt="CORRUPTED")
        self._run("--apply", "--fields", "correct_answer")
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.correct_answer, "C")   # rebound
        self.assertEqual(self.q1.prompt, "CORRUPTED")   # untouched (not requested)

    def test_list_versions_reports_clean_snapshot(self):
        out = StringIO()
        call_command("rebind_question_answers", "--list-versions", "--json", stdout=out)
        report = json.loads(out.getvalue())
        rows = report[str(self.set.id)]["versions"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["self_inconsistent"], 0)  # snapshot itself is clean
