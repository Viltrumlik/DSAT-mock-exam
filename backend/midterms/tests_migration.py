"""Data-migration tests for migrate_midterms_to_new_tables.

    python manage.py test midterms.tests_migration --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from access.models import ResourceAccessGrant
from exams.models import Module, MockExam, PracticeTest, Question, TestAttempt
from midterms.models import Midterm, MidtermAttempt

User = get_user_model()


def build_legacy_midterm(score=75):
    mock = MockExam.objects.create(
        title="Legacy Midterm",
        kind=MockExam.KIND_MIDTERM,
        midterm_subject="READING_WRITING",
        midterm_scoring_scale="SCALE_100",
        midterm_module_count=1,
        midterm_module1_minutes=30,
        midterm_module_question_limit=30,
        is_published=True,
    )
    pt = PracticeTest.objects.create(
        mock_exam=mock, subject="READING_WRITING", skip_default_modules=True, title="sec"
    )
    module = Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=30)
    qs = []
    for i in range(4):
        qs.append(Question.objects.create(
            module=module, question_type="READING", question_text=f"Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers="a", is_math_input=False, score=10, order=i,
        ))
    student = User.objects.create(username="leg", email="leg@x.io")
    att = TestAttempt.objects.create(
        practice_test=pt, student=student, mock_exam=mock,
        current_state="COMPLETED", is_completed=True, score=score, version_number=3,
        module_answers={str(module.id): {str(qs[0].id): "a", str(qs[1].id): "a"}},
    )
    grant = ResourceAccessGrant.objects.create(
        user=student, scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type="midterm", resource_id=mock.id, status=ResourceAccessGrant.STATUS_ACTIVE,
    )
    return dict(mock=mock, module=module, questions=qs, student=student, attempt=att, grant=grant)


class MigrationTests(TestCase):
    def test_dry_run_writes_nothing(self):
        build_legacy_midterm()
        call_command("migrate_midterms_to_new_tables")  # no --commit
        self.assertEqual(Midterm.objects.count(), 0)
        self.assertEqual(MidtermAttempt.objects.count(), 0)

    def test_commit_copies_frozen_and_remaps(self):
        d = build_legacy_midterm(score=75)
        call_command("migrate_midterms_to_new_tables", "--commit")

        midterm = Midterm.objects.get(legacy_mock_exam_id=d["mock"].id)
        self.assertEqual(midterm.title, "Legacy Midterm")
        self.assertEqual(midterm.scoring_scale, "SCALE_100")
        self.assertEqual(midterm.questions().count(), 4)
        new_qids = list(midterm.questions().values_list("id", flat=True))

        att = MidtermAttempt.objects.get(legacy_test_attempt_id=d["attempt"].id)
        self.assertEqual(att.score, 75)  # FROZEN — not recomputed (2/4 would be 50 under the new scorer)
        self.assertEqual(att.current_state, "COMPLETED")
        self.assertTrue(att.is_completed)
        # answers remapped to NEW question ids (flat), only the 2 answered.
        self.assertEqual(len(att.answers), 2)
        for k in att.answers:
            self.assertIn(int(k), new_qids)

        # grant re-keyed to midterm_v2 pointing at the new Midterm id.
        g = ResourceAccessGrant.objects.get(
            user=d["student"], resource_type="midterm_v2", resource_id=midterm.id
        )
        self.assertEqual(g.status, ResourceAccessGrant.STATUS_ACTIVE)
        # legacy grant untouched
        self.assertTrue(ResourceAccessGrant.objects.filter(resource_type="midterm", resource_id=d["mock"].id).exists())

    def test_commit_is_idempotent(self):
        build_legacy_midterm()
        call_command("migrate_midterms_to_new_tables", "--commit")
        call_command("migrate_midterms_to_new_tables", "--commit")  # second run
        self.assertEqual(Midterm.objects.count(), 1)
        self.assertEqual(MidtermAttempt.objects.count(), 1)
        # exactly one re-keyed grant (no duplicate)
        self.assertEqual(
            ResourceAccessGrant.objects.filter(resource_type="midterm_v2").count(), 1
        )
