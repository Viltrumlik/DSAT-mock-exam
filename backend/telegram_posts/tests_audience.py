"""Which groups a post reaches: active classes with a chat, one message per chat."""

from __future__ import annotations

from django.test import TestCase

from classes.models import Classroom
from telegram_posts import audience
from telegram_posts.testkit import make_room

MATH, ENGLISH = Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH


class ResolveTests(TestCase):
    def setUp(self):
        self.m_sen = make_room("Senior G1 Math", subject=MATH, level="senior", chat="-1001")
        self.m_jun = make_room("Junior G2 Math", subject=MATH, level="junior", chat="-1002")
        self.e_sen = make_room("Senior G3 English", subject=ENGLISH, level="senior", chat="-1003")
        self.shared = make_room("Senior G4 English", subject=ENGLISH, level="senior", chat="-1003")
        make_room("No group yet", chat="")
        make_room("Closed class", chat="-1009", active=False)

    def chats(self, **kw):
        return [t.chat_id for t in audience.resolve(**kw)]

    def test_every_connected_active_class_by_default(self):
        self.assertEqual(self.chats(), ["-1001", "-1002", "-1003"])

    def test_two_classes_in_one_chat_are_one_target(self):
        target = [t for t in audience.resolve() if t.chat_id == "-1003"][0]
        self.assertEqual(target.names, "Senior G3 English, Senior G4 English")

    def test_by_subject(self):
        self.assertEqual(self.chats(subjects=[MATH]), ["-1001", "-1002"])

    def test_by_level(self):
        self.assertEqual(self.chats(levels=["senior"]), ["-1001", "-1003"])

    def test_subject_and_level_together(self):
        self.assertEqual(self.chats(subjects=[ENGLISH], levels=["junior"]), [])

    def test_chosen_classes_win_over_the_filters(self):
        self.assertEqual(self.chats(classroom_ids=[self.m_jun.pk], subjects=[ENGLISH]), ["-1002"])

    def test_picker_rows_list_only_connected_active_classes(self):
        rows = audience.picker_rows()
        self.assertEqual(
            [r["id"] for r in rows], [self.m_sen.pk, self.m_jun.pk, self.e_sen.pk, self.shared.pk]
        )
        self.assertEqual(
            rows[0],
            {"id": self.m_sen.pk, "name": "Senior G1 Math", "subject": MATH, "level": "senior", "chat_id": "-1001"},
        )

    def test_a_blank_chat_id_is_no_group(self):
        blank = make_room("Blank chat", chat="   ")
        self.assertNotIn(blank.pk, [r["id"] for r in audience.picker_rows()])
        self.assertTrue(all(r["chat_id"] for r in audience.picker_rows()))
        self.assertFalse(any("Blank chat" in t.names for t in audience.resolve()))


class LabelTests(TestCase):
    def test_labels(self):
        self.assertEqual(audience.label(), "All groups")
        self.assertEqual(audience.label(subjects=[MATH]), "Math · all levels")
        self.assertEqual(audience.label(levels=["senior", "middle"]), "All subjects · senior, middle")
        self.assertEqual(audience.label(subjects=[MATH, ENGLISH], levels=["junior"]), "Math + English · junior")
        self.assertEqual(audience.label(classroom_ids=[4, 9]), "2 chosen groups")
        self.assertEqual(audience.label(classroom_ids=[4]), "1 chosen group")
