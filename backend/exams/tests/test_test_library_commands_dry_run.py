from __future__ import annotations

from django.core.management import call_command
from django.test import TestCase

from exams.models import PracticeTest


class TestLibraryCommandDryRunTests(TestCase):
    def test_repair_test_library_integrity_dry_run_does_not_mutate(self):
        # Pastpaper packs were removed; the repair command is now a no-op. It must
        # still run cleanly and never mutate standalone sections.
        sec = PracticeTest.objects.create(
            mock_exam=None,
            collection_name="Pack",
            subject="MATH",
            title="Section",
            label="B",
            form_type="US",
            practice_date="2025-01-01",
            skip_default_modules=True,
        )

        before = PracticeTest.objects.get(pk=sec.pk)
        call_command("repair_test_library_integrity", dry_run=True, json=True, verbosity=0)
        call_command("repair_test_library_integrity", json=True, verbosity=0)
        after = PracticeTest.objects.get(pk=sec.pk)

        self.assertEqual(before.practice_date, after.practice_date)
        self.assertEqual(before.form_type, after.form_type)
        self.assertEqual(before.label, after.label)
        self.assertEqual(before.collection_name, after.collection_name)
