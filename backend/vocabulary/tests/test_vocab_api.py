"""
Vocabulary student + builder API.

The load-bearing behaviours here are the ones a study mode depends on: a word's status
defaults to "new" with no progress row, mastery is streak-based (and a wrong answer
demotes it back), finishing a session twice must not double-count, and a student's custom
sets are invisible to everyone else — including the builder console.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership
from vocabulary.models import (
    VocabHomework,
    VocabSection,
    VocabSet,
    VocabSetItem,
    VocabStudySession,
    VocabWord,
    VocabWordProgress,
)

User = get_user_model()


def make_section(title="College Panda", *, published=True, slug=None, order=0) -> VocabSection:
    return VocabSection.objects.create(
        title=title,
        slug=slug or title.lower().replace(" ", "-"),
        is_published=published,
        order=order,
    )


def make_set(section, title="Set 1", *, words=("alpha", "beta", "gamma")) -> VocabSet:
    vset = VocabSet.objects.create(section=section, title=title, order=0)
    for idx, w in enumerate(words):
        word = VocabWord.objects.create(
            section=section, word=w, definition=f"meaning of {w}", example=f"an {w} example"
        )
        VocabSetItem.objects.create(vocab_set=vset, word=word, order=idx)
    return vset


class VocabFixture(TestCase):
    def setUp(self):
        self.student = User.objects.create_user("vocab_student@t.com")
        self.other = User.objects.create_user("vocab_other@t.com")
        self.admin = User.objects.create_user(
            "vocab_admin@t.com", role=acc_const.ROLE_ADMIN
        )
        self.section = make_section()
        self.vset = make_set(self.section)
        self.words = [i.word for i in self.vset.items.select_related("word").order_by("order")]
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _as(self, user) -> APIClient:
        c = APIClient()
        c.force_authenticate(user)
        return c

    def _start(self, set_id=None, mode="flashcard"):
        r = self.client.post(
            "/api/vocabulary/sessions/",
            {"set_id": set_id or self.vset.id, "mode": mode},
            format="json",
        )
        return r

    def _finish(self, session_id, results, duration_ms=1000):
        return self.client.post(
            f"/api/vocabulary/sessions/{session_id}/finish/",
            {"duration_ms": duration_ms, "results": results},
            format="json",
        )


# --------------------------------------------------------------------------- models


class SetConstraintTests(VocabFixture):
    def test_set_is_bank_xor_custom(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            VocabSet.objects.create(section=self.section, owner=self.student, title="Both")
        with self.assertRaises(IntegrityError), transaction.atomic():
            VocabSet.objects.create(title="Neither")


# --------------------------------------------------------------------------- reading


class SectionListTests(VocabFixture):
    def test_lists_published_sections_with_counts_and_progress(self):
        make_section("Hidden", published=False, slug="hidden")
        r = self.client.get("/api/vocabulary/sections/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual([s["title"] for s in body], ["College Panda"])
        self.assertEqual(body[0]["set_count"], 1)
        self.assertEqual(body[0]["word_count"], 3)
        # Nothing studied yet — every word is New.
        self.assertEqual(
            body[0]["progress"], {"new": 3, "learning": 0, "mastered": 0, "total": 3}
        )

    def test_progress_reflects_recorded_answers(self):
        VocabWordProgress.objects.create(
            user=self.student, word=self.words[0], status=VocabWordProgress.STATUS_MASTERED
        )
        VocabWordProgress.objects.create(
            user=self.student, word=self.words[1], status=VocabWordProgress.STATUS_LEARNING
        )
        # Another student's progress must not leak into this student's buckets.
        VocabWordProgress.objects.create(
            user=self.other, word=self.words[2], status=VocabWordProgress.STATUS_MASTERED
        )
        body = self.client.get("/api/vocabulary/sections/").json()
        self.assertEqual(
            body[0]["progress"], {"new": 1, "learning": 1, "mastered": 1, "total": 3}
        )

    def test_frozen_student_is_blocked(self):
        frozen = User.objects.create_user("vocab_frozen@t.com", is_frozen=True)
        r = self._as(frozen).get("/api/vocabulary/sections/")
        self.assertEqual(r.status_code, 403, r.content)


class SectionDetailTests(VocabFixture):
    def test_returns_sets_with_counts(self):
        r = self.client.get(f"/api/vocabulary/sections/{self.section.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(len(body["sets"]), 1)
        self.assertEqual(body["sets"][0]["word_count"], 3)
        self.assertFalse(body["sets"][0]["completed"])

    def test_unpublished_section_is_404(self):
        hidden = make_section("Hidden", published=False, slug="hidden")
        r = self.client.get(f"/api/vocabulary/sections/{hidden.id}/")
        self.assertEqual(r.status_code, 404, r.content)


class SetDetailTests(VocabFixture):
    def test_words_default_to_new(self):
        r = self.client.get(f"/api/vocabulary/sets/{self.vset.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["word_count"], 3)
        self.assertFalse(body["is_custom"])
        self.assertEqual(body["section"]["id"], self.section.id)
        self.assertEqual([w["status"] for w in body["words"]], ["new", "new", "new"])
        self.assertEqual([w["word"] for w in body["words"]], ["alpha", "beta", "gamma"])

    def test_set_in_unpublished_section_is_404(self):
        hidden = make_section("Hidden", published=False, slug="hidden")
        hidden_set = make_set(hidden, words=("delta",))
        r = self.client.get(f"/api/vocabulary/sets/{hidden_set.id}/")
        self.assertEqual(r.status_code, 404, r.content)

    def test_another_students_custom_set_is_404(self):
        theirs = VocabSet.objects.create(owner=self.other, title="Theirs")
        r = self.client.get(f"/api/vocabulary/sets/{theirs.id}/")
        self.assertEqual(r.status_code, 404, r.content)


class WordSearchTests(VocabFixture):
    def test_filters_by_query_and_caps_limit(self):
        r = self.client.get("/api/vocabulary/words/", {"q": "alph"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([w["word"] for w in r.json()], ["alpha"])
        self.assertEqual(r.json()[0]["section_title"], "College Panda")

        r = self.client.get("/api/vocabulary/words/", {"limit": "1"})
        self.assertEqual(len(r.json()), 1)
        # Over-large limits clamp instead of 400ing.
        r = self.client.get("/api/vocabulary/words/", {"limit": "5000"})
        self.assertEqual(len(r.json()), 3)

    def test_unpublished_section_words_are_hidden(self):
        hidden = make_section("Hidden", published=False, slug="hidden")
        VocabWord.objects.create(section=hidden, word="secretive", definition="hidden")
        r = self.client.get("/api/vocabulary/words/", {"q": "secret"})
        self.assertEqual(r.json(), [])


# --------------------------------------------------------------------------- custom sets


class CustomSetTests(VocabFixture):
    def test_create_list_patch_delete(self):
        ids = [w.id for w in self.words]
        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "My words", "word_ids": ids},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        set_id = r.json()["id"]
        self.assertTrue(r.json()["is_custom"])
        self.assertIsNone(r.json()["section"])
        self.assertEqual(r.json()["word_count"], 3)

        listed = self.client.get("/api/vocabulary/my-sets/").json()
        self.assertEqual([s["id"] for s in listed], [set_id])
        self.assertEqual(listed[0]["word_count"], 3)

        # word_ids REPLACES membership, order included.
        r = self.client.patch(
            f"/api/vocabulary/my-sets/{set_id}/",
            {"title": "Renamed", "word_ids": [ids[2], ids[0]]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["title"], "Renamed")
        self.assertEqual([w["id"] for w in r.json()["words"]], [ids[2], ids[0]])

        r = self.client.delete(f"/api/vocabulary/my-sets/{set_id}/")
        self.assertEqual(r.status_code, 204, r.content)
        self.assertFalse(VocabSet.objects.filter(pk=set_id).exists())

    def test_unknown_word_id_is_rejected(self):
        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Bogus", "word_ids": [self.words[0].id, 999999]},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("word_ids", r.json())
        self.assertFalse(VocabSet.objects.filter(owner=self.student).exists())

    def test_cannot_touch_another_students_set(self):
        theirs = VocabSet.objects.create(owner=self.other, title="Theirs")
        self.assertEqual(
            self.client.patch(
                f"/api/vocabulary/my-sets/{theirs.id}/", {"title": "Mine now"}, format="json"
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/api/vocabulary/my-sets/{theirs.id}/").status_code, 404
        )
        self.assertTrue(VocabSet.objects.filter(pk=theirs.id).exists())

    def test_custom_set_is_studiable_by_its_owner(self):
        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Mine", "word_ids": [self.words[0].id]},
            format="json",
        )
        set_id = r.json()["id"]
        started = self._start(set_id=set_id, mode="test")
        self.assertEqual(started.status_code, 201, started.content)


# --------------------------------------------------------------------------- homework


class HomeworkListTests(VocabFixture):
    def setUp(self):
        super().setUp()
        self.classroom = Classroom.objects.create(
            name="Group A",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.admin,
            title="Week 1 vocabulary",
            category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED,
        )
        self.link = VocabHomework.objects.create(
            classroom=self.classroom,
            assignment=self.assignment,
            vocab_set=self.vset,
            assigned_by=self.admin,
        )

    def test_groups_sets_under_their_assignment(self):
        r = self.client.get("/api/vocabulary/homework/")
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(len(body), 1)
        self.assertEqual(body[0]["assignment_id"], self.assignment.id)
        self.assertEqual(body[0]["classroom_name"], "Group A")
        self.assertEqual(len(body[0]["sets"]), 1)
        self.assertEqual(body[0]["sets"][0]["section_title"], "College Panda")
        self.assertFalse(body[0]["sets"][0]["completed"])

    def test_draft_assignment_is_hidden(self):
        self.assignment.status = Assignment.STATUS_DRAFT
        self.assignment.save(update_fields=["status"])
        self.assertEqual(self.client.get("/api/vocabulary/homework/").json(), [])

    def test_removed_member_sees_nothing(self):
        ClassroomMembership.objects.filter(
            classroom=self.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(self.client.get("/api/vocabulary/homework/").json(), [])

    def test_session_binds_to_the_homework_that_assigned_the_set(self):
        session_id = self._start().json()["id"]
        self.assertEqual(
            VocabStudySession.objects.get(pk=session_id).homework_id, self.link.id
        )


# --------------------------------------------------------------------------- sessions


class SessionTests(VocabFixture):
    def test_start_rejects_unknown_mode_and_unreadable_set(self):
        self.assertEqual(self._start(mode="telepathy").status_code, 400)
        theirs = VocabSet.objects.create(owner=self.other, title="Theirs")
        self.assertEqual(self._start(set_id=theirs.id).status_code, 404)

    def test_finish_grades_and_marks_the_set_complete(self):
        session_id = self._start().json()["id"]
        r = self._finish(
            session_id,
            [
                {"word_id": self.words[0].id, "correct": True},
                {"word_id": self.words[1].id, "correct": False},
            ],
        )
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body["correct_count"], 1)
        self.assertEqual(body["total_count"], 2)
        self.assertEqual(body["accuracy"], 50.0)
        self.assertTrue(body["set_completed"])
        self.assertEqual(
            body["progress"], {"new": 1, "learning": 2, "mastered": 0, "total": 3}
        )

    def test_three_correct_in_a_row_masters_a_word_and_a_miss_demotes_it(self):
        word = self.words[0]
        for _ in range(3):
            session_id = self._start().json()["id"]
            self._finish(session_id, [{"word_id": word.id, "correct": True}])
        progress = VocabWordProgress.objects.get(user=self.student, word=word)
        self.assertEqual(progress.status, VocabWordProgress.STATUS_MASTERED)
        self.assertEqual(progress.streak, 3)

        session_id = self._start().json()["id"]
        self._finish(session_id, [{"word_id": word.id, "correct": False}])
        progress.refresh_from_db()
        self.assertEqual(progress.status, VocabWordProgress.STATUS_LEARNING)
        self.assertEqual(progress.streak, 0)
        self.assertEqual(progress.wrong_count, 1)

    def test_streak_is_applied_in_answer_order_within_one_session(self):
        # Wrong then right must leave the word Learning with a streak of 1 — not Mastered.
        word = self.words[0]
        session_id = self._start().json()["id"]
        self._finish(
            session_id,
            [
                {"word_id": word.id, "correct": False},
                {"word_id": word.id, "correct": True},
            ],
        )
        progress = VocabWordProgress.objects.get(user=self.student, word=word)
        self.assertEqual(progress.status, VocabWordProgress.STATUS_LEARNING)
        self.assertEqual(progress.streak, 1)
        self.assertEqual((progress.correct_count, progress.wrong_count), (1, 1))

    def test_finish_is_idempotent(self):
        session_id = self._start().json()["id"]
        payload = [{"word_id": self.words[0].id, "correct": True}]
        first = self._finish(session_id, payload).json()
        second = self._finish(session_id, payload).json()
        self.assertEqual(first["correct_count"], second["correct_count"])
        self.assertEqual(first["total_count"], second["total_count"])
        progress = VocabWordProgress.objects.get(user=self.student, word=self.words[0])
        self.assertEqual(progress.correct_count, 1)  # not double-applied
        self.assertEqual(progress.streak, 1)

    def test_words_outside_the_set_are_ignored(self):
        stray = VocabWord.objects.create(
            section=self.section, word="stray", definition="not in the set"
        )
        session_id = self._start().json()["id"]
        body = self._finish(
            session_id,
            [
                {"word_id": self.words[0].id, "correct": True},
                {"word_id": stray.id, "correct": True},
            ],
        ).json()
        self.assertEqual(body["total_count"], 1)
        self.assertFalse(
            VocabWordProgress.objects.filter(user=self.student, word=stray).exists()
        )

    def test_another_student_cannot_finish_someone_elses_session(self):
        session_id = self._start().json()["id"]
        r = self._as(self.other).post(
            f"/api/vocabulary/sessions/{session_id}/finish/",
            {"duration_ms": 10, "results": []},
            format="json",
        )
        self.assertEqual(r.status_code, 404, r.content)

    def test_completing_one_mode_completes_the_set(self):
        session_id = self._start(mode="matching").json()["id"]
        self._finish(session_id, [{"word_id": self.words[0].id, "correct": True}])
        body = self.client.get(f"/api/vocabulary/sections/{self.section.id}/").json()
        self.assertTrue(body["sets"][0]["completed"])


# --------------------------------------------------------------------------- builder


class BuilderPermissionTests(VocabFixture):
    def test_students_and_teachers_are_denied(self):
        teacher = User.objects.create_user(
            "vocab_teacher@t.com", role=acc_const.ROLE_TEACHER, subject="english"
        )
        for user in (self.student, teacher):
            r = self._as(user).get("/api/vocabulary/admin/sections/")
            self.assertEqual(r.status_code, 403, f"{user.email}: {r.content}")

    def test_builder_staff_are_allowed(self):
        for role in (
            acc_const.ROLE_ADMIN,
            acc_const.ROLE_TEST_ADMIN,
            acc_const.ROLE_TEST_AUDITOR,
            acc_const.ROLE_SUPER_ADMIN,
        ):
            user = User.objects.create_user(f"vocab_role_{role}@t.com", role=role)
            r = self._as(user).get("/api/vocabulary/admin/sections/")
            self.assertEqual(r.status_code, 200, f"{role}: {r.content}")


class BuilderSectionTests(VocabFixture):
    def setUp(self):
        super().setUp()
        self.client = self._as(self.admin)

    def test_create_derives_a_unique_slug(self):
        r = self.client.post(
            "/api/vocabulary/admin/sections/", {"title": "College Panda"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["slug"], "college-panda-2")  # the fixture holds the first

    def test_explicit_slug_is_honoured_and_collisions_are_reported(self):
        r = self.client.post(
            "/api/vocabulary/admin/sections/",
            {"title": "Hard words", "slug": "hard-650"},
            format="json",
        )
        self.assertEqual(r.json()["slug"], "hard-650")
        r = self.client.post(
            "/api/vocabulary/admin/sections/",
            {"title": "Other", "slug": "hard-650"},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("slug", r.json())

    def test_list_carries_counts_and_includes_unpublished(self):
        make_section("Hidden", published=False, slug="hidden")
        body = self.client.get("/api/vocabulary/admin/sections/").json()
        self.assertEqual(len(body), 2)
        found = next(s for s in body if s["id"] == self.section.id)
        self.assertEqual((found["set_count"], found["word_count"]), (1, 3))

    def test_patch_updates_and_delete_removes(self):
        r = self.client.patch(
            f"/api/vocabulary/admin/sections/{self.section.id}/",
            {"title": "Renamed", "is_published": False},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["title"], "Renamed")
        self.assertFalse(r.json()["is_published"])
        self.assertEqual(
            self.client.delete(f"/api/vocabulary/admin/sections/{self.section.id}/").status_code,
            204,
        )
        self.assertFalse(VocabSection.objects.filter(pk=self.section.id).exists())


class BuilderSetAndWordTests(VocabFixture):
    def setUp(self):
        super().setUp()
        self.client = self._as(self.admin)

    def test_create_set_then_words(self):
        r = self.client.post(
            f"/api/vocabulary/admin/sections/{self.section.id}/sets/",
            {"title": "Set 2"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        set_id = r.json()["id"]
        self.assertEqual(r.json()["order"], 1)  # appended after the fixture's set

        r = self.client.post(
            f"/api/vocabulary/admin/sets/{set_id}/words/",
            {
                "word": "laconic",
                "definition": "using few words",
                "part_of_speech": "adjective",
                "synonyms": ["terse", "  ", "concise"],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["synonyms"], ["terse", "concise"])
        word_id = r.json()["id"]

        detail = self.client.get(f"/api/vocabulary/admin/sets/{set_id}/").json()
        self.assertEqual(detail["word_count"], 1)
        self.assertEqual(detail["words"][0]["word"], "laconic")

        r = self.client.patch(
            f"/api/vocabulary/admin/words/{word_id}/",
            {"definition": "brief and to the point"},
            format="json",
        )
        self.assertEqual(r.json()["definition"], "brief and to the point")
        self.assertEqual(
            self.client.delete(f"/api/vocabulary/admin/words/{word_id}/").status_code, 204
        )
        self.assertFalse(VocabWord.objects.filter(pk=word_id).exists())

    def test_existing_section_word_is_linked_not_duplicated(self):
        other_set = VocabSet.objects.create(section=self.section, title="Set 2", order=1)
        r = self.client.post(
            f"/api/vocabulary/admin/sets/{other_set.id}/words/",
            {"word": "Alpha", "definition": "first"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["id"], self.words[0].id)
        self.assertEqual(VocabWord.objects.filter(section=self.section, word__iexact="alpha").count(), 1)

    def test_duplicate_within_the_same_set_is_400(self):
        r = self.client.post(
            f"/api/vocabulary/admin/sets/{self.vset.id}/words/",
            {"word": "alpha", "definition": "again"},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("word", r.json())

    def test_renaming_a_word_onto_a_sibling_is_400(self):
        r = self.client.patch(
            f"/api/vocabulary/admin/words/{self.words[0].id}/", {"word": "beta"}, format="json"
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("word", r.json())

    def test_custom_sets_are_invisible_to_the_builder(self):
        custom = VocabSet.objects.create(owner=self.student, title="Mine")
        for path in (
            f"/api/vocabulary/admin/sets/{custom.id}/",
            f"/api/vocabulary/admin/sets/{custom.id}/words/",
        ):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertEqual(
            self.client.delete(f"/api/vocabulary/admin/sets/{custom.id}/").status_code, 404
        )


class BuilderDeleteGuardTests(VocabFixture):
    def setUp(self):
        super().setUp()
        self.client = self._as(self.admin)
        classroom = Classroom.objects.create(
            name="Group A",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        assignment = Assignment.objects.create(
            classroom=classroom,
            created_by=self.admin,
            title="HW",
            category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED,
        )
        VocabHomework.objects.create(
            classroom=classroom,
            assignment=assignment,
            vocab_set=self.vset,
            assigned_by=self.admin,
        )

    def test_deleting_an_assigned_set_is_409(self):
        r = self.client.delete(f"/api/vocabulary/admin/sets/{self.vset.id}/")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertIn("detail", r.json())
        self.assertTrue(VocabSet.objects.filter(pk=self.vset.id).exists())

    def test_deleting_a_section_holding_an_assigned_set_is_409(self):
        r = self.client.delete(f"/api/vocabulary/admin/sections/{self.section.id}/")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertTrue(VocabSection.objects.filter(pk=self.section.id).exists())
