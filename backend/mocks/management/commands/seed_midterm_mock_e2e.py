"""Seed a deterministic midterm + full-mock fixture for browser acceptance testing.

Idempotent (safe to re-run — it deletes the prior E2E rows first). Creates a student, a
published STANDALONE midterm (granted to the student, SCALE_800, single strictly-timed
module) and a published FULL MOCK (2 English + 2 Math modules + a 1-minute break for quick
testing). Every question's correct answer is choice A, so answering "A" throughout scores
perfectly (midterm 800, mock 1600).

    python manage.py seed_midterm_mock_e2e

Login (password: Test1234!):
    e2e_student
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

MIDTERM_TITLE = "E2E Diagnostic Midterm"
MOCK_TITLE = "E2E Full Mock"


class Command(BaseCommand):
    help = "Seed a student + published standalone midterm + full mock for browser E2E testing."

    def handle(self, *args, **opts):
        from access.models import ResourceAccessGrant
        from exams.models import Module, Question
        from midterms.models import Midterm
        from mocks.models import Mock, MockSection

        User = get_user_model()

        # Idempotent: clear prior E2E fixtures.
        Midterm.objects.filter(title=MIDTERM_TITLE).delete()
        Mock.objects.filter(title=MOCK_TITLE).delete()

        student, _ = User.objects.get_or_create(username="e2e_student", defaults={"email": "e2e@student.io"})
        student.set_password("Test1234!")
        if hasattr(student, "role"):
            student.role = "student"
        student.is_active = True
        student.save()

        # ── Standalone midterm (SCALE_800, single module) ──
        mt_module = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=10)
        mt = Midterm.objects.create(
            title=MIDTERM_TITLE, subject="READING_WRITING", scoring_scale="SCALE_800",
            duration_minutes=10, question_module=mt_module, is_published=True,
        )
        for i in range(4):
            Question.objects.create(
                module=mt_module, question_type="READING", question_text=f"Midterm Q{i + 1}: the correct choice is A.",
                option_a="Correct", option_b="B", option_c="C", option_d="D", correct_answers="a", score=10, order=i,
            )
        ResourceAccessGrant.objects.get_or_create(
            user=student, scope=ResourceAccessGrant.SCOPE_RESOURCE, resource_type="midterm_v2",
            resource_id=mt.id, classroom=None, defaults={"status": ResourceAccessGrant.STATUS_ACTIVE},
        )

        # ── Full mock (2 English + 2 Math, 1-minute break) ──
        mock = Mock.objects.create(title=MOCK_TITLE, break_minutes=1, is_published=True)
        for subject, qtype in (("READING_WRITING", "READING"), ("MATH", "MATH")):
            m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=10)
            m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=10)
            MockSection.objects.create(mock=mock, subject=subject, module1=m1, module2=m2)
            for mod in (m1, m2):
                for i in range(3):
                    Question.objects.create(
                        module=mod, question_type=qtype, question_text=f"{subject} Q{i + 1}: the correct choice is A.",
                        option_a="Correct", option_b="B", option_c="C", option_d="D", correct_answers="a", score=10, order=i,
                    )

        self.stdout.write(self.style.SUCCESS(
            f"Seeded midterm #{mt.id} + mock #{mock.id}; login e2e_student / Test1234!"
        ))
