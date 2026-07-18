"""Seed a fully-populated, published full mock so students have one to run.

A mock in the new `mocks` app owns 2 sections (Reading & Writing, Math), each with
2 modules of live exams.Questions. This command builds all four modules, fills each
with answerable MCQ questions, and publishes the mock — enough to run the runner
end-to-end (start → 2 RW modules → break → 2 Math modules → 1600 result).

    python manage.py seed_full_mock
    python manage.py seed_full_mock --title "Diagnostic Mock A" --questions-per-module 27
    python manage.py seed_full_mock --no-publish
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from exams.models import Module, Question
from mocks.models import Mock, MockSection

READING_WRITING = "READING_WRITING"
MATH = "MATH"
_LETTERS = ["a", "b", "c", "d"]


class Command(BaseCommand):
    help = "Create a populated, published full mock (4 modules + break) for end-to-end use."

    def add_arguments(self, parser):
        parser.add_argument("--title", default="Sample Full Mock")
        parser.add_argument("--questions-per-module", type=int, default=6)
        parser.add_argument("--break-minutes", type=int, default=10)
        parser.add_argument("--module-minutes", type=int, default=32)
        parser.add_argument("--no-publish", action="store_true", help="Leave the mock unpublished.")

    def _module(self, *, order: int, qtype: str, n: int, minutes: int) -> Module:
        module = Module.objects.create(practice_test=None, module_order=order, time_limit_minutes=minutes)
        for i in range(n):
            correct = _LETTERS[i % len(_LETTERS)]  # vary the key so it reads like a real test
            Question.objects.create(
                module=module,
                question_type=qtype,
                question_text=f"{'Reading & Writing' if qtype == 'READING' else 'Math'} "
                              f"Module {order} — Question {i + 1}. Choose the correct option.",
                option_a="Option A",
                option_b="Option B",
                option_c="Option C",
                option_d="Option D",
                correct_answers=correct,
                is_math_input=False,
                score=10,
                order=i,
            )
        return module

    @transaction.atomic
    def handle(self, *args, **opts):
        title = opts["title"]
        n = max(1, int(opts["questions_per_module"]))
        minutes = int(opts["module_minutes"])

        mock = Mock.objects.create(title=title, break_minutes=int(opts["break_minutes"]))
        e1 = self._module(order=1, qtype="READING", n=n, minutes=minutes)
        e2 = self._module(order=2, qtype="READING", n=n, minutes=minutes)
        m1 = self._module(order=1, qtype="MATH", n=n, minutes=minutes)
        m2 = self._module(order=2, qtype="MATH", n=n, minutes=minutes)
        MockSection.objects.create(mock=mock, subject=READING_WRITING, module1=e1, module2=e2)
        MockSection.objects.create(mock=mock, subject=MATH, module1=m1, module2=m2)

        if not opts["no_publish"]:
            mock.is_published = True
            mock.published_at = timezone.now()
            mock.save(update_fields=["is_published", "published_at", "updated_at"])

        state = "published" if mock.is_published else "draft (unpublished)"
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded full mock #{mock.id} “{title}” — {state}, "
                f"{n} questions/module, {opts['break_minutes']}-min break."
            )
        )
