"""Vocabulary on journal homework + classwork: save, options, release, in-class grant."""
from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from journals import services
from vocabulary.models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabWord,
)

User = get_user_model()


def _admin(email="jvoc@test.com"):
    return User.objects.create_user(
        email=email, password="x", role=acc_const.ROLE_SUPER_ADMIN
    )


def _vocab_set(title="Set A", n_words=3):
    section = VocabSection.objects.create(
        title=f"Sec {title}", slug=f"sec-{title}".replace(" ", "-").lower(), is_published=True
    )
    vset = VocabSet.objects.create(section=section, title=title)
    for i in range(n_words):
        w = VocabWord.objects.create(section=section, word=f"{title}-w{i}", definition="d")
        VocabSetItem.objects.create(vocab_set=vset, word=w)
    return vset


class JournalVocabApiTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.lesson = services.add_session(self.journal, actor=self.admin)
        self.vset = _vocab_set()

    def test_lesson_patch_saves_vocab(self):
        r = self.client.patch(
            f"/api/journals/{self.journal.id}/lessons/{self.lesson.id}/",
            {"instructions": "learn words", "vocabulary_set_ids": [self.vset.id]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["vocabulary_set_ids"], [self.vset.id])
        self.assertEqual(r.json()["vocabulary"][0]["title"], "Set A")
        self.assertEqual(r.json()["vocabulary"][0]["word_count"], 3)
        self.lesson.refresh_from_db()
        self.assertEqual(self.lesson.vocabulary_set_ids, [self.vset.id])
        self.assertTrue(self.lesson.has_content)

    def test_classwork_patch_saves_block_vocab(self):
        r = self.client.patch(
            f"/api/journals/{self.journal.id}/lessons/{self.lesson.id}/classwork/",
            {
                "new_topic_title": "T",
                "new_topic_instructions": "i",
                "new_topic_vocabulary_set_ids": [self.vset.id],
                "exercise_vocabulary_set_ids": [self.vset.id],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["new_topic_vocabulary_set_ids"], [self.vset.id])
        self.assertEqual(r.json()["exercise_vocabulary_set_ids"], [self.vset.id])

    def test_content_options_returns_vocab_sections(self):
        r = self.client.get(
            f"/api/journals/content-options/?subject=MATH&level=foundation&lesson={self.lesson.id}"
        )
        self.assertEqual(r.status_code, 200, r.content)
        secs = r.json()["vocabulary_sections"]
        found = any(
            s["id"] == self.vset.id and s["word_count"] == 3
            for sec in secs
            for s in sec["sets"]
        )
        self.assertTrue(found)


class ReleaseVocabTests(TestCase):
    def setUp(self):
        from classes.models import Classroom
        from journals.models import Journal

        self.admin = _admin("jvocr@test.com")
        self.classroom = Classroom.objects.create(
            name="M", subject=Classroom.SUBJECT_MATH, level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD, lesson_time="18:00",
            start_date=date(2026, 8, 3), created_by=self.admin,
        )
        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])
        self.lesson = services.add_session(self.journal, actor=self.admin)
        self.vset = _vocab_set("Rel Set")
        self.lesson.instructions = "do"
        self.lesson.vocabulary_set_ids = [self.vset.id]
        self.lesson.save()

    def test_release_creates_vocab_homework(self):
        from journals import delivery

        row, created, _ = delivery.release_homework(
            self.classroom, self.lesson, actor=self.admin
        )
        self.assertTrue(created)
        self.assertTrue(
            VocabHomework.objects.filter(assignment=row.assignment, vocab_set=self.vset).exists()
        )


class ClassworkVocabGrantTests(TestCase):
    def setUp(self):
        from classes.models import Classroom, ClassroomMembership
        from journals.models import Journal

        self.admin = _admin("jvocg@test.com")
        self.student = User.objects.create_user(
            email="jvocg_s@test.com", password="x", role=acc_const.ROLE_STUDENT
        )
        self.classroom = Classroom.objects.create(
            name="M2", subject=Classroom.SUBJECT_MATH, level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD, lesson_time="18:00",
            start_date=date(2026, 8, 3), created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])
        self.lesson = services.add_session(self.journal, actor=self.admin)
        self.vset = _vocab_set("CW Set")
        cw = services.ensure_classwork(self.lesson)
        cw.new_topic_title = "T"
        cw.new_topic_instructions = "i"
        cw.exercise_vocabulary_set_ids = [self.vset.id]
        cw.save()

    def test_grant_vocab_creates_vocab_homework_and_is_idempotent(self):
        from journals import delivery

        grant, created = delivery.grant_resource(
            self.classroom, self.lesson, block="EXERCISES",
            resource_type="vocabulary_set", resource_id=self.vset.id, actor=self.admin,
        )
        self.assertTrue(created)
        self.assertEqual(grant.resource_type, "vocabulary_set")
        self.assertTrue(
            VocabHomework.objects.filter(classroom=self.classroom, vocab_set=self.vset).exists()
        )
        _, created2 = delivery.grant_resource(
            self.classroom, self.lesson, block="EXERCISES",
            resource_type="vocabulary_set", resource_id=self.vset.id, actor=self.admin,
        )
        self.assertFalse(created2)

    def test_grant_vocab_not_in_plan_rejected(self):
        from journals import delivery

        # The new-topic block has no vocab in the plan → granting there is refused.
        with self.assertRaises(delivery.DeliveryError):
            delivery.grant_resource(
                self.classroom, self.lesson, block="NEW_TOPIC",
                resource_type="vocabulary_set", resource_id=self.vset.id, actor=self.admin,
            )
