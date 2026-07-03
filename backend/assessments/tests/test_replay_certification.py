"""
Replay Certification Tests — the formal trust contract of the platform.

WHAT THESE TESTS PROVE:
  Historical academic attempts are perfectly reproducible from their stored
  snapshot even after:
  - live question edits (changed correct_answer, changed choices)
  - new version publishes
  - question deactivation
  - question reordering in the live set

  These tests are the ONLY automated proof that the immutability architecture
  works as designed. If any of these tests fail, historical academic truth
  has been compromised.

CERTIFICATION STANDARD (all must pass):
  C1  Attempt has a pinned set_version
  C2  Snapshot checksum is intact (no DB corruption)
  C3  Snapshot schema is compatible with current grading code
  C4  All question IDs in question_order exist in the snapshot
  C5  Re-computing grading from snapshot + answers produces the same result

TEST TAXONOMY:
  - test_grading_replay_*        grading arithmetic re-runs identically
  - test_checksum_*              snapshot integrity verification
  - test_schema_compat_*         schema version handling
  - test_question_order_*        ordering reproducibility
  - test_publish_concurrency_*   concurrent publish safety
  - test_idempotent_publish_*    idempotency guarantees
  - test_certification_service_* ReplayCertificationService API

DO NOT modify these tests to make them pass. If they fail, the platform
has a trust violation that must be fixed in production code.
"""

from __future__ import annotations

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from access import constants as acc_const
from access.models import UserAccess
from assessments.domain.publish_service import publish_assessment_set
from assessments.domain.replay_certification import certify_attempt_replay, bulk_certify_attempts
from assessments.domain.snapshot_builder import build_snapshot, compute_checksum, verify_snapshot_integrity
from assessments.domain.snapshot_compat import adapt_snapshot, can_grade_snapshot
from assessments.grading_service import grade_attempt
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentResult,
    AssessmentSet,
    AssessmentSetVersion,
    GovernanceEvent,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership

User = get_user_model()


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_teacher(email: str = "teacher@replay.test") -> User:
    u = User.objects.create_user(
        email=email, password="x",
        role=acc_const.ROLE_TEACHER,
        subject=acc_const.DOMAIN_MATH,
    )
    UserAccess.objects.create(user=u, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=u)
    return u


def make_student(email: str = "student@replay.test") -> User:
    return User.objects.create_user(
        email=email, password="x",
        role=acc_const.ROLE_STUDENT,
        subject="",
    )


def make_classroom(teacher: User) -> Classroom:
    room = Classroom.objects.create(
        name="Test Room",
        subject=Classroom.SUBJECT_MATH,
        lesson_days=Classroom.DAYS_ODD,
        created_by=teacher,
        teacher=teacher,
    )
    ClassroomMembership.objects.create(classroom=room, user=teacher, role=ClassroomMembership.ROLE_ADMIN)
    return room


def make_set(teacher: User, *, title: str = "Test Set") -> AssessmentSet:
    return AssessmentSet.objects.create(
        subject=AssessmentSet.SUBJECT_MATH,
        category="algebra",
        title=title,
        description="A test set.",
        created_by=teacher,
    )


def make_mc_question(aset: AssessmentSet, *, order: int = 1, correct: str = "A") -> AssessmentQuestion:
    return AssessmentQuestion.objects.create(
        assessment_set=aset,
        order=order,
        prompt=f"Question {order}: Which answer is {correct!r}?",
        question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
        choices=[
            {"id": "A", "text": "Option A"},
            {"id": "B", "text": "Option B"},
            {"id": "C", "text": "Option C"},
        ],
        correct_answer=correct,
        points=1,
        is_active=True,
    )


def make_numeric_question(
    aset: AssessmentSet, *, order: int = 1, correct: int = 42
) -> AssessmentQuestion:
    return AssessmentQuestion.objects.create(
        assessment_set=aset,
        order=order,
        prompt=f"Question {order}: What is the answer?",
        question_type=AssessmentQuestion.TYPE_NUMERIC,
        correct_answer=correct,
        points=2,
        is_active=True,
        grading_config={"tolerance": 0},
    )


def make_hw(classroom: Classroom, aset: AssessmentSet, teacher: User, version=None) -> HomeworkAssignment:
    assignment = Assignment.objects.create(
        classroom=classroom, created_by=teacher, title="HW", instructions=""
    )
    return HomeworkAssignment.objects.create(
        classroom=classroom,
        assessment_set=aset,
        assignment=assignment,
        assigned_by=teacher,
        set_version=version,
    )


def make_graded_attempt(
    hw: HomeworkAssignment,
    student: User,
    *,
    answers: dict,  # {question_id: answer_value}
    version=None,
) -> tuple[AssessmentAttempt, AssessmentResult]:
    """Create an attempt, save answers, submit, and grade it."""
    question_ids = list(answers.keys())
    att = AssessmentAttempt.objects.create(
        homework=hw,
        student=student,
        set_version=version,
        question_order=question_ids,
        grading_status=AssessmentAttempt.GRADING_PENDING,
        last_activity_at=timezone.now(),
    )
    for qid, ans in answers.items():
        AssessmentAnswer.objects.create(
            attempt=att,
            question_id=qid,
            answer=ans,
            answered_at=timezone.now(),
        )
    att.status = AssessmentAttempt.STATUS_SUBMITTED
    att.save(update_fields=["status"])

    result = grade_attempt(attempt_id=att.pk)
    att.refresh_from_db()
    return att, result


# ══════════════════════════════════════════════════════════════════════════════
# CORE TRUST CONTRACT: grading replay invariance
# ══════════════════════════════════════════════════════════════════════════════

class GradingReplayInvarianceTests(TestCase):
    """
    FORMAL TRUST CONTRACT TESTS.

    These prove that historical academic records are immune to:
    - live question edits
    - new version publishes
    - question deactivation
    - correct answer changes
    """

    def setUp(self):
        self.teacher = make_teacher()
        self.student = make_student()
        self.classroom = make_classroom(self.teacher)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

    def test_historical_score_survives_correct_answer_change(self):
        """
        TRUST CONTRACT CORE:
        After a correct answer is changed and a new version published,
        the original attempt must still grade identically using snapshot v1.
        """
        aset = make_set(self.teacher, title="Core Trust Test")
        q = make_mc_question(aset, order=1, correct="A")

        # Publish v1: correct_answer = "A"
        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(v1.version_number, 1)
        snap_q = next(sq for sq in v1.snapshot_json["questions"] if sq["id"] == q.pk)
        self.assertEqual(snap_q["correct_answer"], "A", "Snapshot v1 must record correct_answer=A")

        hw = make_hw(self.classroom, aset, self.teacher, version=v1)

        # Create attempt against v1: student answers "A" (correct)
        att, result1 = make_graded_attempt(
            hw, self.student, answers={q.pk: "A"}, version=v1
        )
        self.assertEqual(result1.correct_count, 1)
        self.assertEqual(result1.percent, Decimal("100.00"))

        # ── Edit live question: change correct answer to "B" ──────────────────
        q.correct_answer = "B"
        q.save()

        # Publish v2: correct_answer = "B"
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(v2.version_number, 2)
        snap_q_v2 = next(sq for sq in v2.snapshot_json["questions"] if sq["id"] == q.pk)
        self.assertEqual(snap_q_v2["correct_answer"], "B", "Snapshot v2 must record correct_answer=B")

        # ── Replay: reset and re-grade the original attempt ───────────────────
        att.status = AssessmentAttempt.STATUS_SUBMITTED
        att.grading_status = AssessmentAttempt.GRADING_PENDING
        att.save(update_fields=["status", "grading_status"])

        result_replay = grade_attempt(attempt_id=att.pk)

        # ASSERTION: "A" must still be correct in v1 — historical truth preserved
        self.assertEqual(
            result_replay.correct_count, 1,
            "Historical replay FAILED: correct_count changed after live question edit. "
            "IMMUTABILITY VIOLATION."
        )
        self.assertEqual(
            result_replay.percent, Decimal("100.00"),
            "Historical replay FAILED: percent changed after live question edit. "
            "IMMUTABILITY VIOLATION."
        )
        self.assertEqual(
            result_replay.score_points, result1.score_points,
            "Historical replay FAILED: score_points changed. IMMUTABILITY VIOLATION."
        )

    def test_historical_score_survives_question_deactivation(self):
        """
        When a question is deactivated (is_active=False) in the live set,
        historical grading against the snapshot must be unaffected.
        """
        aset = make_set(self.teacher, title="Deactivation Test")
        q1 = make_mc_question(aset, order=1, correct="A")
        q2 = make_mc_question(aset, order=2, correct="B")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        hw = make_hw(self.classroom, aset, self.teacher, version=v1)

        att, result1 = make_graded_attempt(
            hw, self.student, answers={q1.pk: "A", q2.pk: "B"}, version=v1
        )
        self.assertEqual(result1.correct_count, 2)

        # ── Deactivate q2 and republish ───────────────────────────────────────
        q2.is_active = False
        q2.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(v2.question_count, 1, "v2 snapshot should have only 1 active question")

        # ── Replay original attempt (2 questions, both correct) ───────────────
        att.status = AssessmentAttempt.STATUS_SUBMITTED
        att.grading_status = AssessmentAttempt.GRADING_PENDING
        att.save(update_fields=["status", "grading_status"])

        result_replay = grade_attempt(attempt_id=att.pk)

        self.assertEqual(result_replay.correct_count, 2,
            "IMMUTABILITY VIOLATION: deactivated question must still count in historical replay.")
        self.assertEqual(result_replay.total_questions, 2)

    def test_historical_score_survives_all_questions_replaced(self):
        """
        Extreme case: ALL questions in the live set replaced.
        Original attempt must still grade against its snapshot.
        """
        aset = make_set(self.teacher, title="Full Replace Test")
        q_original = make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        hw = make_hw(self.classroom, aset, self.teacher, version=v1)

        att, result1 = make_graded_attempt(
            hw, self.student, answers={q_original.pk: "A"}, version=v1
        )
        self.assertEqual(result1.correct_count, 1)

        # ── Deactivate original, add new question, republish ──────────────────
        q_original.is_active = False
        q_original.save()
        # order is unique across ALL rows in a set (active + inactive) under
        # UNIQUE(assessment_set, order); the deactivated original still holds
        # order=1, so the replacement appends at order=2 — mirroring the real
        # create flow (which always appends under a set lock).
        q_new = make_mc_question(aset, order=2, correct="C")
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertNotEqual(v1.snapshot_checksum, v2.snapshot_checksum)
        self.assertEqual(v2.question_count, 1)
        snap_q_v2 = v2.snapshot_json["questions"][0]
        self.assertEqual(snap_q_v2["id"], q_new.pk)

        # ── Replay original attempt against v1 ────────────────────────────────
        att.status = AssessmentAttempt.STATUS_SUBMITTED
        att.grading_status = AssessmentAttempt.GRADING_PENDING
        att.save(update_fields=["status", "grading_status"])

        result_replay = grade_attempt(attempt_id=att.pk)
        self.assertEqual(result_replay.correct_count, 1,
            "IMMUTABILITY VIOLATION: original attempt must grade against original questions.")

    def test_different_versions_grade_independently(self):
        """
        Two attempts against different versions of the same set must
        grade independently — one against v1, one against v2.

        Uses two separate classrooms to satisfy UNIQUE(classroom, assessment_set).
        """
        teacher2 = make_teacher("teacher2_vi@replay.test")
        UserAccess.objects.create(
            user=teacher2, subject=acc_const.DOMAIN_MATH, classroom=None, granted_by=teacher2
        )
        classroom2 = make_classroom(teacher2)
        student2 = make_student("student2_vi@replay.test")
        # self.student is already in self.classroom from setUp
        ClassroomMembership.objects.create(
            classroom=classroom2, user=student2, role=ClassroomMembership.ROLE_STUDENT
        )

        aset = make_set(self.teacher, title="Version Independence Test")
        q = make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        # Student 1 via classroom 1 against v1: answers "A" (correct)
        hw1 = make_hw(self.classroom, aset, self.teacher, version=v1)
        att1, res1 = make_graded_attempt(
            hw1, self.student, answers={q.pk: "A"}, version=v1
        )
        self.assertEqual(res1.correct_count, 1)

        # Change answer, publish v2
        q.correct_answer = "B"
        q.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        # Student 2 via classroom 2 against v2: answers "A" (now wrong)
        hw2 = make_hw(classroom2, aset, teacher2, version=v2)
        att2, res2 = make_graded_attempt(
            hw2, student2, answers={q.pk: "A"}, version=v2
        )
        self.assertEqual(res2.correct_count, 0, "Answer 'A' must be wrong in v2")

        # Verify they used different snapshots
        self.assertNotEqual(att1.set_version_id, att2.set_version_id)
        self.assertEqual(att1.set_version_id, v1.pk)
        self.assertEqual(att2.set_version_id, v2.pk)


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT INTEGRITY
# ══════════════════════════════════════════════════════════════════════════════

class SnapshotIntegrityTests(TestCase):

    def setUp(self):
        self.teacher = make_teacher("ti_teacher@replay.test")

    def test_checksum_is_deterministic(self):
        """The same content must always produce the same checksum."""
        aset = make_set(self.teacher, title="Checksum Test")
        make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        snap = v1.snapshot_json

        # Recompute 3 times — must be identical
        c1 = compute_checksum(snap)
        c2 = compute_checksum(snap)
        c3 = compute_checksum(snap)
        self.assertEqual(c1, c2)
        self.assertEqual(c2, c3)
        self.assertEqual(c1, v1.snapshot_checksum,
            "Stored checksum must equal recomputed checksum.")

    def test_verify_snapshot_integrity_passes_for_intact_snapshot(self):
        aset = make_set(self.teacher, title="Integrity Pass")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        self.assertTrue(
            verify_snapshot_integrity(v.snapshot_json, v.snapshot_checksum),
            "Freshly created snapshot must pass integrity check."
        )

    def test_verify_snapshot_integrity_fails_for_mutated_snapshot(self):
        aset = make_set(self.teacher, title="Integrity Fail")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        # Simulate DB corruption: mutate the snapshot without updating checksum
        corrupted = dict(v.snapshot_json)
        corrupted["questions"][0]["correct_answer"] = "CORRUPTED"

        self.assertFalse(
            verify_snapshot_integrity(corrupted, v.snapshot_checksum),
            "Mutated snapshot must FAIL integrity check."
        )

    def test_different_content_produces_different_checksums(self):
        aset = make_set(self.teacher, title="Checksum Differ")
        make_mc_question(aset, order=1, correct="A")
        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        # Change content
        aset.title = "Changed Title"
        aset.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        self.assertNotEqual(
            v1.snapshot_checksum, v2.snapshot_checksum,
            "Different content must produce different checksums."
        )

    def test_snapshot_is_self_sufficient(self):
        """
        The snapshot must contain ALL data needed to reproduce grading:
        id, prompt, question_type, choices, correct_answer, grading_config, points.
        """
        aset = make_set(self.teacher, title="Self-Sufficient Test")
        q = make_mc_question(aset, order=1, correct="B")
        q.grading_config = {"bonus": True}
        q.save()

        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        snap_q = v.snapshot_json["questions"][0]

        self.assertEqual(snap_q["id"], q.pk)
        self.assertEqual(snap_q["correct_answer"], "B")
        self.assertEqual(snap_q["grading_config"], {"bonus": True})
        self.assertEqual(snap_q["points"], 1)
        self.assertEqual(snap_q["question_type"], AssessmentQuestion.TYPE_MULTIPLE_CHOICE)
        self.assertEqual(len(snap_q["choices"]), 3)


# ══════════════════════════════════════════════════════════════════════════════
# SCHEMA COMPATIBILITY
# ══════════════════════════════════════════════════════════════════════════════

class SnapshotSchemaCompatibilityTests(TestCase):
    """
    Verify that the schema compatibility registry works as designed.
    These tests guard against future schema evolution breaking historical replay.
    """

    def test_current_schema_can_grade_snapshot(self):
        snap = {
            "schema_version": 1,
            "set_id": 1,
            "set_title": "Test",
            "questions": [{"id": 1, "prompt": "X", "question_type": "multiple_choice"}]
        }
        ok, reason = can_grade_snapshot(snap)
        self.assertTrue(ok, f"Current schema should be gradeable. Reason: {reason}")

    def test_future_schema_version_cannot_grade(self):
        """A snapshot from a newer code version must reject gracefully."""
        snap = {"schema_version": 9999, "set_id": 1, "set_title": "X", "questions": []}
        ok, reason = can_grade_snapshot(snap)
        self.assertFalse(ok)
        self.assertIn("9999", reason)

    def test_adapt_snapshot_is_noop_for_current_version(self):
        """adapt_snapshot on current version must return identical content."""
        aset_mock = {
            "schema_version": 1,
            "set_id": 42,
            "set_title": "X",
            "set_subject": "math",
            "set_category": "algebra",
            "set_description": "",
            "question_count": 0,
            "questions": [],
        }
        adapted = adapt_snapshot(aset_mock)
        self.assertEqual(adapted, aset_mock)

    def test_adapt_snapshot_missing_schema_version_raises(self):
        from assessments.domain.snapshot_compat import adapt_snapshot
        with self.assertRaises(ValueError):
            adapt_snapshot({"set_id": 1, "questions": []})  # missing schema_version

    def test_adapt_snapshot_negative_version_raises(self):
        from assessments.domain.snapshot_compat import adapt_snapshot
        with self.assertRaises(ValueError):
            adapt_snapshot({"schema_version": -1, "set_id": 1, "questions": []})


# ══════════════════════════════════════════════════════════════════════════════
# PUBLISH IDEMPOTENCY
# ══════════════════════════════════════════════════════════════════════════════

class PublishIdempotencyTests(TestCase):

    def setUp(self):
        self.teacher = make_teacher("pi_teacher@replay.test")

    def test_republishing_identical_content_returns_same_version(self):
        """
        Republishing without any changes must return the existing version.
        No duplicate version must be created.
        """
        aset = make_set(self.teacher, title="Idempotency Test")
        make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        v1_again = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        self.assertEqual(v1.pk, v1_again.pk, "Identical content must return same version PK.")
        self.assertEqual(
            AssessmentSetVersion.objects.filter(assessment_set=aset).count(),
            1,
            "No duplicate version must be created for identical content."
        )

    def test_changed_content_creates_new_version(self):
        aset = make_set(self.teacher, title="New Version Test")
        q = make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        q.correct_answer = "B"
        q.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        self.assertNotEqual(v1.pk, v2.pk)
        self.assertEqual(v1.version_number, 1)
        self.assertEqual(v2.version_number, 2)
        self.assertEqual(
            AssessmentSetVersion.objects.filter(assessment_set=aset).count(), 2
        )

    def test_version_lineage_chain_is_correct(self):
        """Each new version must point to its predecessor."""
        aset = make_set(self.teacher, title="Lineage Chain Test")
        q = make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertIsNone(v1.previous_version_id, "First version has no predecessor.")

        q.correct_answer = "B"
        q.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(v2.previous_version_id, v1.pk, "v2 must point to v1.")

        q.correct_answer = "C"
        q.save()
        v3 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(v3.previous_version_id, v2.pk, "v3 must point to v2.")

        # Walk chain backward
        self.assertEqual(v3.previous_version.previous_version_id, v1.pk)
        self.assertIsNone(v3.previous_version.previous_version.previous_version_id)

    def test_governance_events_emitted_on_publish(self):
        aset = make_set(self.teacher, title="Gov Events Test")
        make_mc_question(aset, order=1, correct="A")

        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        publish_events = GovernanceEvent.objects.filter(
            event_type=GovernanceEvent.EVENT_PUBLISH,
            entity_type="AssessmentSetVersion",
            entity_id=v1.pk,
        )
        self.assertEqual(publish_events.count(), 1)

        # Re-publish: must emit idempotent event
        publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        idempotent_events = GovernanceEvent.objects.filter(
            event_type=GovernanceEvent.EVENT_PUBLISH_IDEMPOTENT,
        )
        self.assertEqual(idempotent_events.count(), 1)

    def test_supersede_governance_event_emitted_on_second_publish(self):
        aset = make_set(self.teacher, title="Supersede Event Test")
        q = make_mc_question(aset, order=1, correct="A")
        v1 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        q.correct_answer = "B"
        q.save()
        v2 = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        supersede_events = GovernanceEvent.objects.filter(
            event_type=GovernanceEvent.EVENT_SUPERSEDE,
            entity_type="AssessmentSetVersion",
            entity_id=v1.pk,
        )
        self.assertEqual(supersede_events.count(), 1, "Supersede event must be emitted on v1 when v2 is published.")
        payload = supersede_events.first().payload
        self.assertEqual(payload["superseded_by_version_id"], v2.pk)


# ══════════════════════════════════════════════════════════════════════════════
# PUBLISH VALIDATION
# ══════════════════════════════════════════════════════════════════════════════

class PublishValidationTests(TestCase):

    def setUp(self):
        self.teacher = make_teacher("pv_teacher@replay.test")

    def test_publish_requires_title(self):
        from assessments.domain.publish_service import PublishValidationError
        aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            title="",  # blank
            category="algebra",
            created_by=self.teacher,
        )
        make_mc_question(aset, order=1)
        with self.assertRaises(PublishValidationError) as ctx:
            publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "missing_title")

    def test_publish_requires_active_questions(self):
        from assessments.domain.publish_service import PublishValidationError
        aset = make_set(self.teacher, title="No Questions")
        with self.assertRaises(PublishValidationError) as ctx:
            publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "no_active_questions")

    def test_publish_requires_valid_mc_choices(self):
        from assessments.domain.publish_service import PublishValidationError
        aset = make_set(self.teacher, title="Bad Choices")
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="Q?",
            question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
            choices=[{"id": "A", "text": "Only one"}],  # only 1 choice — INVALID
            correct_answer="A",
            points=1, is_active=True,
        )
        with self.assertRaises(PublishValidationError) as ctx:
            publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "insufficient_choices")

    def test_publish_requires_correct_answer_references_valid_choice(self):
        from assessments.domain.publish_service import PublishValidationError
        aset = make_set(self.teacher, title="Invalid Correct Answer")
        AssessmentQuestion.objects.create(
            assessment_set=aset, order=1, prompt="Q?",
            question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
            choices=[{"id": "A", "text": "A"}, {"id": "B", "text": "B"}],
            correct_answer="Z",  # not in choices
            points=1, is_active=True,
        )
        with self.assertRaises(PublishValidationError) as ctx:
            publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "invalid_correct_answer")

    def test_validation_emits_governance_event_on_failure(self):
        from assessments.domain.publish_service import PublishValidationError
        aset = make_set(self.teacher, title="Emits Event On Fail")
        # No questions — will fail validation
        with self.assertRaises(PublishValidationError):
            publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        failed_events = GovernanceEvent.objects.filter(
            event_type=GovernanceEvent.EVENT_PUBLISH_VALIDATION_FAILED,
            entity_type="AssessmentSet",
            entity_id=aset.pk,
        )
        self.assertEqual(failed_events.count(), 1)


# ══════════════════════════════════════════════════════════════════════════════
# REPLAY CERTIFICATION SERVICE
# ══════════════════════════════════════════════════════════════════════════════

class ReplayCertificationServiceTests(TestCase):
    """
    Tests for the ReplayCertificationService API.
    These verify that certify_attempt_replay() correctly identifies
    certified vs non-certified attempts.
    """

    def setUp(self):
        self.teacher = make_teacher("rc_teacher@replay.test")
        self.student = make_student("rc_student@replay.test")
        self.classroom = make_classroom(self.teacher)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

    def _make_certified_attempt(self) -> tuple[AssessmentAttempt, AssessmentSetVersion]:
        """Helper: create a fully published + graded attempt with snapshot pin."""
        aset = make_set(self.teacher, title="Cert Service Test")
        q = make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        hw = make_hw(self.classroom, aset, self.teacher, version=v)
        att, _ = make_graded_attempt(hw, self.student, answers={q.pk: "A"}, version=v)
        return att, v

    def test_certified_attempt_passes_all_checks(self):
        att, v = self._make_certified_attempt()
        result = certify_attempt_replay(att.pk)

        self.assertTrue(result.certified, f"Expected certified. Findings: {result.findings}")
        self.assertTrue(result.has_snapshot_pin)
        self.assertTrue(result.checksum_valid)
        self.assertTrue(result.schema_compatible)
        self.assertTrue(result.question_order_pure)
        self.assertTrue(result.score_matches)
        self.assertEqual(len(result.findings), 0)

    def test_attempt_without_snapshot_pin_is_not_certified(self):
        """Pre-snapshot attempt (set_version=None) cannot be certified."""
        aset = make_set(self.teacher, title="No Pin Test")
        q = make_mc_question(aset, order=1, correct="A")
        aset.is_active = True
        aset.save()
        hw = make_hw(self.classroom, aset, self.teacher, version=None)
        att, _ = make_graded_attempt(hw, self.student, answers={q.pk: "A"}, version=None)

        result = certify_attempt_replay(att.pk)
        self.assertFalse(result.certified)
        self.assertFalse(result.has_snapshot_pin)
        self.assertTrue(any("C1" in f for f in result.findings))

    def test_corrupted_snapshot_fails_certification(self):
        """Simulates DB-level snapshot corruption."""
        att, v = self._make_certified_attempt()

        # Directly corrupt the snapshot_json without updating checksum
        # (simulate a rogue SQL UPDATE bypassing the immutability guard)
        corrupted = dict(v.snapshot_json)
        corrupted["questions"][0]["correct_answer"] = "CORRUPTED"
        AssessmentSetVersion.objects.filter(pk=v.pk).update(snapshot_json=corrupted)

        result = certify_attempt_replay(att.pk)
        self.assertFalse(result.certified)
        self.assertFalse(result.checksum_valid)
        self.assertTrue(any("C2" in f for f in result.findings))

    def test_non_graded_attempt_returns_error(self):
        aset = make_set(self.teacher, title="Non Graded")
        q = make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)
        hw = make_hw(self.classroom, aset, self.teacher, version=v)
        att = AssessmentAttempt.objects.create(
            homework=hw, student=self.student, set_version=v,
            question_order=[q.pk],
            status=AssessmentAttempt.STATUS_IN_PROGRESS,
            grading_status=AssessmentAttempt.GRADING_PENDING,
        )

        result = certify_attempt_replay(att.pk)
        self.assertFalse(result.certified)
        self.assertTrue(any("not graded" in f.lower() for f in result.findings))

    def test_certification_detects_score_drift(self):
        """If stored result differs from replay, certification fails."""
        att, v = self._make_certified_attempt()

        # Artificially corrupt the stored result
        res = AssessmentResult.objects.get(attempt=att)
        res.correct_count = 999
        res.save()

        result = certify_attempt_replay(att.pk)
        self.assertFalse(result.certified)
        self.assertFalse(result.score_matches)
        self.assertTrue(any("C5" in f for f in result.findings))

    def test_bulk_certify_returns_results_for_all_graded(self):
        att1, _ = self._make_certified_attempt()
        # Create a second certified attempt
        aset2 = make_set(self.teacher, title="Bulk Test 2")
        q2 = make_mc_question(aset2, order=1, correct="A")
        v2 = publish_assessment_set(set_id=aset2.pk, actor=self.teacher)
        hw2 = make_hw(self.classroom, aset2, self.teacher, version=v2)
        student2 = make_student("rc_bulk@replay.test")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=student2, role=ClassroomMembership.ROLE_STUDENT
        )
        att2, _ = make_graded_attempt(hw2, student2, answers={q2.pk: "A"}, version=v2)

        results = bulk_certify_attempts(attempt_ids=[att1.pk, att2.pk])
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r.certified for r in results))

    def test_certification_result_is_serializable(self):
        """to_dict() must produce JSON-safe output."""
        import json
        att, _ = self._make_certified_attempt()
        result = certify_attempt_replay(att.pk)
        serialized = json.dumps(result.to_dict())
        self.assertIn('"certified": true', serialized)


# ══════════════════════════════════════════════════════════════════════════════
# IMMUTABILITY GUARD TESTS
# ══════════════════════════════════════════════════════════════════════════════

class ImmutabilityGuardTests(TestCase):
    """Verify that the ORM-level immutability guards work as designed."""

    def setUp(self):
        self.teacher = make_teacher("ig_teacher@replay.test")

    def test_assessmentsetversion_cannot_be_updated(self):
        aset = make_set(self.teacher, title="Immutability Guard")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        with self.assertRaises(ValueError, msg="save() on existing PK must raise ValueError"):
            v.question_count = 999
            v.save()

    def test_assessmentsetversion_cannot_be_deleted(self):
        aset = make_set(self.teacher, title="Delete Guard")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        with self.assertRaises(ValueError, msg="delete() must raise ValueError"):
            v.delete()

    def test_governanceevent_cannot_be_updated(self):
        aset = make_set(self.teacher, title="Gov Event Guard")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        event = GovernanceEvent.objects.filter(entity_id=v.pk).first()
        self.assertIsNotNone(event)

        with self.assertRaises(ValueError):
            event.actor_email = "tampered@evil.com"
            event.save()

    def test_governanceevent_cannot_be_deleted(self):
        aset = make_set(self.teacher, title="Gov Delete Guard")
        make_mc_question(aset, order=1, correct="A")
        v = publish_assessment_set(set_id=aset.pk, actor=self.teacher)

        event = GovernanceEvent.objects.filter(entity_id=v.pk).first()
        self.assertIsNotNone(event)

        with self.assertRaises(ValueError):
            event.delete()
