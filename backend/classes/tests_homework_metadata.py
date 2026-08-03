"""Homework metadata for the redesigned homework cards/launcher:
`content_type`, `contents` (kind/title/item_count), `item_count`, `subject`.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership
from exams.models import Module, PracticeTest
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


class HomeworkMetadataTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("hwm_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="HWM", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("hwm_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        # A pastpaper section with 2 modules × 3 questions = 6 items.
        self.section = PracticeTest.objects.create(
            subject="READING_WRITING", title="March 2026 Int. B",
            form_type="INTERNATIONAL", skip_default_modules=True,
        )
        Module.objects.create(practice_test=self.section, module_order=1, time_limit_minutes=1)
        Module.objects.create(practice_test=self.section, module_order=2, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(self.section, questions_per_module=3)

        self.client = APIClient()

    def _detail(self, a):
        return self.client.get(f"/api/classes/{self.classroom.id}/assignments/{a.id}/").json()

    def test_pastpaper_assignment_metadata(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Read homework",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test=self.section,
        )
        self.client.force_authenticate(self.student)
        data = self._detail(a)
        self.assertEqual(data["content_type"], "pastpaper")
        self.assertEqual(data["item_count"], 6)
        self.assertEqual(data["subject"], "READING_WRITING")
        self.assertEqual(len(data["contents"]), 1)
        self.assertEqual(data["contents"][0]["kind"], "PASTPAPER")
        self.assertEqual(data["contents"][0]["title"], "March 2026 Int. B")
        self.assertEqual(data["contents"][0]["item_count"], 6)
        self.assertIsNotNone(data["assigned_at"])

    def test_pastpaper_named_by_collection_name_and_resolvable_section(self):
        """Sections are labelled by collection_name (title blank). The launcher must
        show that name and be able to route to the section's welcome page, so the
        serializer must expose collection_name + id on practice_bundle_tests and use it
        for the content title."""
        section = PracticeTest.objects.create(
            subject="READING_WRITING", title="", collection_name="December 2025 US A",
            form_type="INTERNATIONAL", skip_default_modules=True,
        )
        Module.objects.create(practice_test=section, module_order=1, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(section, questions_per_module=2)
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Homework",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[section.id],
        )
        self.client.force_authenticate(self.student)
        data = self._detail(a)
        self.assertEqual(data["content_type"], "pastpaper")
        self.assertEqual(data["contents"][0]["title"], "December 2025 US A")
        bundle = data["practice_bundle_tests"]
        self.assertEqual(len(bundle), 1)
        self.assertEqual(bundle[0]["id"], section.id)
        self.assertEqual(bundle[0]["name"], "December 2025 US A")
        self.assertEqual(bundle[0]["collection_name"], "December 2025 US A")

    def test_pastpaper_attempt_state_progression(self):
        """Per-section state drives Start → Resume → Review so a finished attempt is
        never overwritten by re-pressing Start."""
        from exams.models import TestAttempt

        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Read homework",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test=self.section,
        )
        self.client.force_authenticate(self.student)
        # No attempt → not_started.
        bt = self._detail(a)["practice_bundle_tests"][0]
        self.assertEqual(bt["state"], "not_started")
        self.assertIsNone(bt["attempt_id"])
        # Active attempt → in_progress (resume).
        att = TestAttempt.objects.create(student=self.student, practice_test=self.section)
        att.current_state = TestAttempt.STATE_MODULE_1_ACTIVE
        att.save(update_fields=["current_state"])
        bt = self._detail(a)["practice_bundle_tests"][0]
        self.assertEqual(bt["state"], "in_progress")
        self.assertEqual(bt["attempt_id"], att.id)
        # Completed → completed (review, not restart).
        att.current_state = TestAttempt.STATE_COMPLETED
        att.is_completed = True
        att.save(update_fields=["current_state", "is_completed"])
        bt = self._detail(a)["practice_bundle_tests"][0]
        self.assertEqual(bt["state"], "completed")
        self.assertEqual(bt["attempt_id"], att.id)

    def test_file_assignment_content_type(self):
        a = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Upload essay",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        self.client.force_authenticate(self.student)
        data = self._detail(a)
        self.assertEqual(data["content_type"], "file")
        self.assertEqual(data["contents"], [])

    def test_my_assignments_includes_content_metadata(self):
        Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Read homework",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test=self.section,
        )
        self.client.force_authenticate(self.student)
        data = self.client.get("/api/classes/my-assignments/").json()
        item = next(i for i in data["items"] if i["title"] == "Read homework")
        self.assertEqual(item["content_type"], "pastpaper")
        self.assertEqual(item["item_count"], 6)
        self.assertEqual(item["contents"][0]["kind"], "PASTPAPER")
        self.assertEqual(item["contents"][0]["title"], "March 2026 Int. B")
        self.assertIsNotNone(item["assigned_at"])


class MyAssignmentsVocabularyTests(TestCase):
    """`/my-assignments/` must carry the vocabulary attached to a homework.

    It hand-rolls its payload for batching rather than going through
    AssignmentSerializer, and it used to omit `vocab_homeworks` entirely — so a
    homework whose whole content was a word set looked EMPTY to any client that
    trusts this endpoint, which is what the phone does.
    """

    def setUp(self):
        self.owner = User.objects.create_user("vocab_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Vocab class", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("vocab_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client = APIClient()

    def _my_assignments(self):
        self.client.force_authenticate(self.student)
        return self.client.get("/api/classes/my-assignments/").json()["items"]

    def test_attached_vocabulary_sets_reach_the_student(self):
        from vocabulary.models import (
            VocabHomework, VocabSection, VocabSet, VocabSetItem, VocabWord,
        )

        section = VocabSection.objects.create(title="650 Hard Words", slug="hard-650", is_published=True)
        vset = VocabSet.objects.create(section=section, title="Set 1", order=1)
        for i in range(3):
            word = VocabWord.objects.create(section=section, word=f"w{i}", definition=f"d{i}")
            VocabSetItem.objects.create(vocab_set=vset, word=word, order=i)

        assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Week 4 — Vocabulary",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )
        VocabHomework.objects.create(assignment=assignment, vocab_set=vset, classroom=self.classroom)

        row = next(i for i in self._my_assignments() if i["id"] == assignment.id)

        self.assertEqual(len(row["vocab_homeworks"]), 1)
        link = row["vocab_homeworks"][0]
        self.assertEqual(link["set_id"], vset.id)
        self.assertEqual(link["word_count"], 3)
        # The section is what tells two sets apart — the bank numbers them per section,
        # so "Set 1" collides constantly.
        self.assertEqual(link["section_title"], "650 Hard Words")
        self.assertEqual(link["state"], "not_started")

    def test_a_homework_with_no_vocabulary_reports_an_empty_list(self):
        # Not null: a client that treats null as "field missing" would be right to.
        assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="Plain homework",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
        )

        row = next(i for i in self._my_assignments() if i["id"] == assignment.id)

        self.assertEqual(row["vocab_homeworks"], [])
