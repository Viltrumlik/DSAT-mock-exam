from importlib import import_module

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from access import constants as acc_const
from exams.models import PracticeTest, PracticeTestPack
from exams.tests.support import seed_mc_questions_for_practice_test

forwards = import_module("exams.migrations.0056_packs_to_practice_tests").forwards
User = get_user_model()


class PacksToPracticeTestsMigrationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(email="mig_admin@example.com", password="pw", role=acc_const.ROLE_SUPER_ADMIN)

    def _pack(self, title, *, published, math_questions=True):
        pack = PracticeTestPack.objects.create(
            title=title, created_by=self.admin, is_published=published,
            published_at=timezone.now() if published else None,
        )
        rw = PracticeTest.objects.create(practice_test_pack=pack, subject="READING_WRITING", title=f"{title} - Reading & Writing")
        math = PracticeTest.objects.create(practice_test_pack=pack, subject="MATH", title=f"{title} - Math")
        if math_questions:
            seed_mc_questions_for_practice_test(math)
        return rw, math

    def test_published_pack_sections_with_questions_become_numbered_open_practice_tests(self):
        rw1, math1 = self._pack("Pack 1", published=True)
        rw2, math2 = self._pack("Pack 2", published=True)

        forwards(django_apps, None)

        for pt in (rw1, math1, rw2, math2):
            pt.refresh_from_db()
            self.assertTrue(pt.is_practice_test)
            self.assertIsNone(pt.practice_test_pack_id)
            self.assertEqual(pt.practice_level, "")
        self.assertEqual((math1.practice_number, math2.practice_number), (1, 2))
        self.assertTrue(math1.is_published and math2.is_published)
        self.assertEqual(math1.practice_access, PracticeTest.ACCESS_OPEN)
        # Empty R&W sections become unpublished, unnumbered drafts — nothing is deleted.
        for rw in (rw1, rw2):
            self.assertFalse(rw.is_published)
            self.assertIsNone(rw.practice_number)
            self.assertEqual(rw.practice_access, PracticeTest.ACCESS_HOMEWORK_ONLY)

    def test_unpublished_pack_sections_stay_unpublished_drafts(self):
        rw, math = self._pack("Draft pack", published=False)
        forwards(django_apps, None)
        math.refresh_from_db()
        self.assertTrue(math.is_practice_test)
        self.assertFalse(math.is_published)
        self.assertIsNone(math.practice_number)

    def test_running_twice_changes_nothing(self):
        self._pack("Pack 1", published=True)
        forwards(django_apps, None)
        before = list(PracticeTest.objects.order_by("id").values_list("id", "practice_number", "is_published"))
        forwards(django_apps, None)
        after = list(PracticeTest.objects.order_by("id").values_list("id", "practice_number", "is_published"))
        self.assertEqual(before, after)

    def test_past_papers_are_untouched(self):
        pp = PracticeTest.objects.create(subject="MATH", title="Past paper", is_published=True)
        forwards(django_apps, None)
        pp.refresh_from_db()
        self.assertFalse(pp.is_practice_test)
        self.assertIsNone(pp.practice_number)
