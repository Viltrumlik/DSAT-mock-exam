"""
Vocabulary student + builder API.

The load-bearing behaviours here are the ones a study mode depends on: a word's status
defaults to "new" with no progress row, mastery is per-GAME (a word is mastered once it
has been answered correctly in all four study modes; a set is mastered once all four have
been played clean), finishing a session twice must not double-count, and a student's custom
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
from vocabulary.serializers import CustomSetWriteSerializer
from vocabulary.views_student import MAX_CUSTOM_SETS_PER_STUDENT

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

    def _finish(self, session_id, results, duration_ms=1000, *, partial=False):
        return self.client.post(
            f"/api/vocabulary/sessions/{session_id}/finish/",
            {"duration_ms": duration_ms, "results": results, "partial": partial},
            format="json",
        )

    def _assign_as_homework(
        self, vocab_set=None, *, member=None, assignment_status=Assignment.STATUS_PUBLISHED
    ) -> VocabHomework:
        """Put a set on a classroom assignment the student is a live member of."""
        classroom = Classroom.objects.create(
            name="Group A",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=classroom,
            user=member or self.student,
            role=ClassroomMembership.ROLE_STUDENT,
        )
        assignment = Assignment.objects.create(
            classroom=classroom,
            created_by=self.admin,
            title="Week 1 vocabulary",
            category=Assignment.CATEGORY_HOMEWORK,
            status=assignment_status,
        )
        return VocabHomework.objects.create(
            classroom=classroom,
            assignment=assignment,
            vocab_set=vocab_set or self.vset,
            assigned_by=self.admin,
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
        self.assertEqual(body[0]["progress"], {"new": 3, "mastered": 0, "total": 3})
        # Nothing mastered either: no game has been played clean.
        self.assertEqual(body[0]["mastery"], {"mastered_sets": 0, "total_sets": 1, "percent": 0})

    def test_progress_reflects_recorded_answers(self):
        VocabWordProgress.objects.create(
            user=self.student, word=self.words[0], status=VocabWordProgress.STATUS_MASTERED
        )
        # A word answered but not yet proven in all four games is still New — there is no
        # bucket in between any more.
        VocabWordProgress.objects.create(
            user=self.student,
            word=self.words[1],
            status=VocabWordProgress.STATUS_NEW,
            correct_modes=["flashcard"],
        )
        # Another student's progress must not leak into this student's buckets.
        VocabWordProgress.objects.create(
            user=self.other, word=self.words[2], status=VocabWordProgress.STATUS_MASTERED
        )
        body = self.client.get("/api/vocabulary/sections/").json()
        self.assertEqual(body[0]["progress"], {"new": 2, "mastered": 1, "total": 3})

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

    def test_word_ids_are_capped(self):
        # Real bank words, so the cap is what rejects this and not the unknown-id check.
        cap = CustomSetWriteSerializer.MAX_WORDS
        VocabWord.objects.bulk_create(
            [
                VocabWord(section=self.section, word=f"cap{i}", definition="filler")
                for i in range(cap + 1)
            ]
        )
        ids = list(
            VocabWord.objects.filter(
                section=self.section, word__startswith="cap"
            ).values_list("id", flat=True)
        )
        self.assertEqual(len(ids), cap + 1)

        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Everything", "word_ids": ids},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("cannot hold more than", r.json()["word_ids"][0])
        self.assertFalse(VocabSet.objects.filter(owner=self.student).exists())

        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Just enough", "word_ids": ids[:cap]},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)

    def test_the_cap_counts_distinct_words_not_payload_length(self):
        cap = CustomSetWriteSerializer.MAX_WORDS
        r = self.client.post(
            "/api/vocabulary/my-sets/",
            {"title": "Repeated", "word_ids": [self.words[0].id] * (cap + 5)},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["word_count"], 1)

    def test_a_student_cannot_hoard_sets(self):
        VocabSet.objects.bulk_create(
            [
                VocabSet(owner=self.student, title=f"Set {i}")
                for i in range(MAX_CUSTOM_SETS_PER_STUDENT)
            ]
        )
        r = self.client.post(
            "/api/vocabulary/my-sets/", {"title": "One more", "word_ids": []}, format="json"
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("detail", r.json())
        self.assertEqual(
            VocabSet.objects.filter(owner=self.student).count(), MAX_CUSTOM_SETS_PER_STUDENT
        )
        # The cap is per student, not global.
        r = self._as(self.other).post(
            "/api/vocabulary/my-sets/", {"title": "Mine", "word_ids": []}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)

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
        self.link = self._assign_as_homework()
        self.classroom = self.link.classroom
        self.assignment = self.link.assignment

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


class UnpublishedHomeworkAccessTests(VocabFixture):
    """
    Unpublishing hides a section from the bank browse; it does not revoke work already
    assigned. The section-delete guard tells authors to unpublish instead of unassigning,
    so that path has to leave the homework openable.
    """

    def _unpublish(self):
        self.section.is_published = False
        self.section.save(update_fields=["is_published"])

    def test_assigned_set_stays_open_but_leaves_the_browse(self):
        link = self._assign_as_homework()
        self._unpublish()

        r = self.client.get(f"/api/vocabulary/sets/{self.vset.id}/")
        self.assertEqual(r.status_code, 200, r.content)
        started = self._start()
        self.assertEqual(started.status_code, 201, started.content)
        self.assertEqual(
            VocabStudySession.objects.get(pk=started.json()["id"]).homework_id, link.id
        )
        # ...and the homework card that pointed at it is still listed.
        self.assertEqual(len(self.client.get("/api/vocabulary/homework/").json()), 1)

        self.assertEqual(self.client.get("/api/vocabulary/sections/").json(), [])
        self.assertEqual(
            self.client.get(f"/api/vocabulary/sections/{self.section.id}/").status_code, 404
        )
        self.assertEqual(self.client.get("/api/vocabulary/words/", {"q": "alph"}).json(), [])

    def test_an_unassigned_set_in_the_same_section_stays_hidden(self):
        # The homework clause must not widen the endpoint to the whole unpublished bank.
        self._assign_as_homework()
        self._unpublish()
        stranger = make_set(self.section, title="Set 2", words=("delta",))
        self.assertEqual(
            self.client.get(f"/api/vocabulary/sets/{stranger.id}/").status_code, 404
        )
        self.assertEqual(self._start(set_id=stranger.id).status_code, 404)

    def test_a_non_member_cannot_read_it(self):
        self._assign_as_homework()
        self._unpublish()
        r = self._as(self.other).get(f"/api/vocabulary/sets/{self.vset.id}/")
        self.assertEqual(r.status_code, 404, r.content)

    def test_a_removed_member_loses_it_again(self):
        link = self._assign_as_homework()
        self._unpublish()
        ClassroomMembership.objects.filter(
            classroom=link.classroom, user=self.student
        ).update(status=ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(
            self.client.get(f"/api/vocabulary/sets/{self.vset.id}/").status_code, 404
        )

    def test_an_unpublished_assignment_does_not_open_it(self):
        self._assign_as_homework(assignment_status=Assignment.STATUS_DRAFT)
        self._unpublish()
        self.assertEqual(
            self.client.get(f"/api/vocabulary/sets/{self.vset.id}/").status_code, 404
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
        # Nothing is mastered by one mixed round: a word needs all four games, and no
        # bucket sits between New and Mastered any more.
        self.assertEqual(body["progress"], {"new": 3, "mastered": 0, "total": 3})

    def test_a_word_is_mastered_once_every_game_has_had_it_right(self):
        word = self.words[0]
        for mode in ("flashcard", "matching", "speed"):
            session_id = self._start(mode=mode).json()["id"]
            self._finish(session_id, [{"word_id": word.id, "correct": True}])
        progress = VocabWordProgress.objects.get(user=self.student, word=word)
        self.assertEqual(progress.correct_modes, ["flashcard", "matching", "speed"])
        self.assertEqual(progress.status, VocabWordProgress.STATUS_NEW, "three of four is not it")

        session_id = self._start(mode="test").json()["id"]
        self._finish(session_id, [{"word_id": word.id, "correct": True}])
        progress.refresh_from_db()
        self.assertEqual(progress.status, VocabWordProgress.STATUS_MASTERED)

    def test_missing_a_word_gives_up_only_the_game_it_was_missed_in(self):
        """One slip must not cost four games' work — the word is re-earned where it fell."""
        word = self.words[0]
        for mode in ("flashcard", "matching", "speed", "test"):
            session_id = self._start(mode=mode).json()["id"]
            self._finish(session_id, [{"word_id": word.id, "correct": True}])
        progress = VocabWordProgress.objects.get(user=self.student, word=word)
        self.assertEqual(progress.status, VocabWordProgress.STATUS_MASTERED)

        session_id = self._start(mode="speed").json()["id"]
        self._finish(session_id, [{"word_id": word.id, "correct": False}])
        progress.refresh_from_db()
        self.assertEqual(progress.status, VocabWordProgress.STATUS_NEW)
        self.assertEqual(progress.correct_modes, ["flashcard", "matching", "test"])
        self.assertEqual(progress.wrong_count, 1)

    def test_answers_apply_in_order_within_one_session(self):
        """Flashcards re-drill what was missed into the same run: wrong then right in one
        game leaves the word credited in that game, and both counters moved."""
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
        self.assertEqual(progress.correct_modes, ["flashcard"])
        self.assertEqual(progress.status, VocabWordProgress.STATUS_NEW)
        self.assertEqual((progress.correct_count, progress.wrong_count), (1, 1))

    def test_the_reverse_order_gives_the_game_up_again(self):
        word = self.words[0]
        session_id = self._start().json()["id"]
        self._finish(
            session_id,
            [
                {"word_id": word.id, "correct": True},
                {"word_id": word.id, "correct": False},
            ],
        )
        progress = VocabWordProgress.objects.get(user=self.student, word=word)
        self.assertEqual(progress.correct_modes, [])

    def test_finish_is_idempotent(self):
        session_id = self._start().json()["id"]
        payload = [{"word_id": self.words[0].id, "correct": True}]
        first = self._finish(session_id, payload).json()
        second = self._finish(session_id, payload).json()
        self.assertEqual(first["correct_count"], second["correct_count"])
        self.assertEqual(first["total_count"], second["total_count"])
        progress = VocabWordProgress.objects.get(user=self.student, word=self.words[0])
        self.assertEqual(progress.correct_count, 1)  # not double-applied
        self.assertEqual(progress.correct_modes, ["flashcard"])

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


class SetMasteryTests(VocabFixture):
    """A set is mastered one GAME at a time, and only by a clean run of it.

    Clean means both things at once: every word in the set answered, and none of them
    wrong. Either half alone is worthless — "no mistakes" over two of twenty words is what
    a Speed round looks like five seconds in.
    """

    def _mastery(self):
        return self.client.get(f"/api/vocabulary/sets/{self.vset.id}/").json()["mastery"]

    def _play_clean(self, mode):
        session_id = self._start(mode=mode).json()["id"]
        return self._finish(
            session_id, [{"word_id": w.id, "correct": True} for w in self.words]
        ).json()

    def test_an_untouched_set_has_no_game_mastered(self):
        self.assertEqual(
            self._mastery(),
            {
                "modes": {"flashcard": False, "matching": False, "speed": False, "test": False},
                "mastered_modes": 0,
                "total_modes": 4,
                "percent": 0,
                "is_mastered": False,
            },
        )

    def test_each_clean_game_is_a_quarter_of_the_bar(self):
        for n, mode in enumerate(("flashcard", "matching", "speed", "test"), start=1):
            self._play_clean(mode)
            mastery = self._mastery()
            self.assertEqual(mastery["mastered_modes"], n)
            self.assertEqual(mastery["percent"], n * 25)
            self.assertEqual(mastery["is_mastered"], n == 4)

    def test_one_wrong_answer_means_the_game_is_not_mastered(self):
        session_id = self._start().json()["id"]
        results = [{"word_id": w.id, "correct": True} for w in self.words]
        results[-1]["correct"] = False
        body = self._finish(session_id, results).json()
        self.assertFalse(body["mode_mastered"])
        self.assertEqual(self._mastery()["percent"], 0)

    def test_a_run_that_never_reached_the_whole_set_is_not_mastered(self):
        """Speed's clock expires mid-round: two of three words, both right, is not the set."""
        session_id = self._start(mode="speed").json()["id"]
        body = self._finish(
            session_id, [{"word_id": w.id, "correct": True} for w in self.words[:2]]
        ).json()
        self.assertEqual(body["accuracy"], 100.0)
        self.assertFalse(body["mode_mastered"])
        self.assertEqual(self._mastery()["percent"], 0)

    def test_a_game_can_be_practised_until_it_is_clean(self):
        """Mastery is "once, ever" — a muddled first attempt is not a permanent cap."""
        session_id = self._start().json()["id"]
        self._finish(session_id, [{"word_id": w.id, "correct": False} for w in self.words])
        self.assertEqual(self._mastery()["percent"], 0)

        self._play_clean("flashcard")
        self.assertEqual(self._mastery()["percent"], 25)

    def test_the_finish_payload_says_whether_this_run_mastered_its_game(self):
        body = self._play_clean("matching")
        self.assertTrue(body["mode_mastered"])
        self.assertEqual(body["mastery"]["modes"]["matching"], True)
        self.assertEqual(body["mastery"]["percent"], 25)

    def test_a_partial_flush_never_masters_a_game(self):
        """Quitting halfway records the answers; it does not complete the run."""
        session_id = self._start().json()["id"]
        body = self._finish(
            session_id,
            [{"word_id": w.id, "correct": True} for w in self.words],
            partial=True,
        ).json()
        self.assertFalse(body["mode_mastered"])
        self.assertEqual(self._mastery()["percent"], 0)

    def test_an_empty_set_is_never_mastered(self):
        empty = VocabSet.objects.create(section=self.section, title="Empty", order=9)
        body = self.client.get(f"/api/vocabulary/sets/{empty.id}/").json()
        self.assertEqual(body["mastery"]["percent"], 0)
        self.assertFalse(body["mastery"]["is_mastered"])

    def test_the_hub_costs_the_same_however_big_the_bank_gets(self):
        """The roll-up has to scale with the student's own clean runs, not with the bank.

        Starting from the sets — every set in every published section, then their sizes,
        then their sessions — is the obvious shape and would put a thousand-id IN clause on
        the hub to answer "none of them" for almost all of them.
        """
        self._play_clean("flashcard")
        with self.assertNumQueries(self.HUB_QUERIES):
            self.client.get("/api/vocabulary/sections/")
        for n in range(6):
            other = make_section(f"Bank {n}", slug=f"bank-{n}")
            for k in range(5):
                make_set(other, title=f"S{k}", words=tuple(f"b{n}_{k}_{i}" for i in range(10)))
        with self.assertNumQueries(self.HUB_QUERIES):
            self.client.get("/api/vocabulary/sections/")

    # sections + section counts (x2) + section buckets + the student's clean runs
    # + the sizes of the sets those runs touched.
    HUB_QUERIES = 6

    def test_a_section_counts_the_sets_that_are_fully_mastered(self):
        for mode in ("flashcard", "matching", "speed", "test"):
            self._play_clean(mode)
        hub = next(
            s
            for s in self.client.get("/api/vocabulary/sections/").json()
            if s["id"] == self.section.id
        )
        self.assertEqual(hub["mastery"], {"mastered_sets": 1, "total_sets": 1, "percent": 100})
        detail = self.client.get(f"/api/vocabulary/sections/{self.section.id}/").json()
        self.assertEqual(detail["mastery"], hub["mastery"])
        self.assertTrue(detail["sets"][0]["mastery"]["is_mastered"])


class PartialFlushTests(VocabFixture):
    """
    A mode flushes the answers it has when the student navigates away, then flushes the
    rest when it completes. The server APPENDS, so 10 + 5 + 10 is a run of 25 — not the
    last 10 overwriting everything before it.
    """

    def setUp(self):
        super().setUp()
        self.big = make_set(
            self.section, title="Set 2", words=tuple(f"w{i}" for i in range(25))
        )
        self.big_words = [
            i.word for i in self.big.items.select_related("word").order_by("order")
        ]

    def _flush(self, session_id, words, *, partial, duration_ms):
        return self._finish(
            session_id,
            [{"word_id": w.id, "correct": True} for w in words],
            duration_ms=duration_ms,
            partial=partial,
        )

    def test_flushes_accumulate_and_only_the_finishing_call_completes(self):
        session_id = self._start(set_id=self.big.id).json()["id"]

        first = self._flush(session_id, self.big_words[:10], partial=True, duration_ms=10_000)
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first.json()["total_count"], 10)
        self.assertFalse(first.json()["set_completed"])

        second = self._flush(
            session_id, self.big_words[10:15], partial=True, duration_ms=20_000
        )
        self.assertEqual(second.json()["total_count"], 15)
        self.assertFalse(second.json()["set_completed"])

        final = self._flush(
            session_id, self.big_words[15:], partial=False, duration_ms=30_000
        )
        body = final.json()
        self.assertEqual((body["correct_count"], body["total_count"]), (25, 25))
        self.assertEqual(body["accuracy"], 100.0)
        # The distinct set accumulates alongside the counts — three disjoint flushes over
        # 25 words is full coverage. The union's harder case (a word arriving in two
        # flushes) is in test_vocab_coverage.py.
        self.assertEqual(body["distinct_words"], 25)
        self.assertAlmostEqual(body["coverage"], 1.0)
        self.assertEqual(body["duration_ms"], 30_000)
        self.assertTrue(body["set_completed"])

        session = VocabStudySession.objects.get(pk=session_id)
        self.assertIsNotNone(session.completed_at)
        completed_at = session.completed_at

        # A fourth call — the unload flush racing the finishing one — is ignored outright.
        fourth = self._flush(session_id, self.big_words[:5], partial=False, duration_ms=99_000)
        self.assertEqual(fourth.json()["total_count"], 25)
        session.refresh_from_db()
        self.assertEqual((session.correct_count, session.total_count), (25, 25))
        self.assertEqual(session.distinct_words, 25)
        self.assertEqual(session.duration_ms, 30_000)
        self.assertEqual(session.completed_at, completed_at)
        self.assertEqual(
            VocabWordProgress.objects.get(
                user=self.student, word=self.big_words[0]
            ).correct_count,
            1,
        )

    def test_a_partial_flush_banks_progress_without_completing_the_set(self):
        session_id = self._start(set_id=self.big.id).json()["id"]
        self._flush(session_id, self.big_words[:10], partial=True, duration_ms=5_000)

        self.assertEqual(VocabWordProgress.objects.filter(user=self.student).count(), 10)
        body = self.client.get(f"/api/vocabulary/sections/{self.section.id}/").json()
        card = next(s for s in body["sets"] if s["id"] == self.big.id)
        self.assertFalse(card["completed"])
        # The answers are banked as "right in Flashcards" for those ten words. None of them
        # is Mastered — that takes all four games — and the set has mastered no game either,
        # because a partial flush never completes the run.
        rows = VocabWordProgress.objects.filter(user=self.student)
        self.assertEqual([r.correct_modes for r in rows], [["flashcard"]] * 10)
        self.assertEqual(card["progress"], {"new": 25, "mastered": 0, "total": 25})
        self.assertEqual(card["mastery"]["mastered_modes"], 0)

    def test_the_running_clock_never_goes_backwards(self):
        session_id = self._start(set_id=self.big.id).json()["id"]
        self._flush(session_id, self.big_words[:2], partial=True, duration_ms=12_000)
        # A flush that raced an earlier one reports a stale clock; it must not win.
        body = self._flush(
            session_id, self.big_words[2:4], partial=False, duration_ms=3_000
        ).json()
        self.assertEqual(body["duration_ms"], 12_000)


class SectionDetailCountTests(VocabFixture):
    """
    The hub and the section page must report the same section-level numbers. A word in
    two sets is ONE word in the section and TWO items across the set cards.
    """

    def setUp(self):
        super().setUp()
        self.second = VocabSet.objects.create(section=self.section, title="Set 2", order=1)
        VocabSetItem.objects.create(vocab_set=self.second, word=self.words[0], order=0)

    def test_section_totals_are_word_level_and_match_the_hub(self):
        body = self.client.get(f"/api/vocabulary/sections/{self.section.id}/").json()
        self.assertEqual(body["word_count"], 3)
        self.assertEqual(body["progress"], {"new": 3, "mastered": 0, "total": 3})
        self.assertEqual([s["word_count"] for s in body["sets"]], [3, 1])

        hub = next(
            s
            for s in self.client.get("/api/vocabulary/sections/").json()
            if s["id"] == self.section.id
        )
        self.assertEqual(hub["word_count"], body["word_count"])
        self.assertEqual(hub["progress"], body["progress"])

    def test_a_shared_word_shows_in_every_card_that_holds_it(self):
        # All four games, so the word actually reaches Mastered and there is something to
        # see on both cards.
        for mode in ("flashcard", "matching", "speed", "test"):
            session_id = self._start(mode=mode).json()["id"]
            self._finish(session_id, [{"word_id": self.words[0].id, "correct": True}])
        body = self.client.get(f"/api/vocabulary/sections/{self.section.id}/").json()
        cards = {s["id"]: s["progress"] for s in body["sets"]}
        self.assertEqual(cards[self.vset.id], {"new": 2, "mastered": 1, "total": 3})
        self.assertEqual(cards[self.second.id], {"new": 0, "mastered": 1, "total": 1})
        self.assertEqual(body["progress"], {"new": 2, "mastered": 1, "total": 3})

    def test_the_query_count_does_not_grow_with_the_section(self):
        # Grouped counts only: the page must never materialize the section's words.
        with self.assertNumQueries(self.SECTION_DETAIL_QUERIES):
            self.client.get(f"/api/vocabulary/sections/{self.section.id}/")
        for n in range(10):
            make_set(
                self.section,
                title=f"Bulk {n}",
                words=tuple(f"bulk{n}_{i}" for i in range(10)),
            )
        with self.assertNumQueries(self.SECTION_DETAIL_QUERIES):
            self.client.get(f"/api/vocabulary/sections/{self.section.id}/")

    # section + sets + set counts + set buckets + completed + set mastery
    # + section counts (x2) + section buckets. Flat in the number of sets AND of words.
    SECTION_DETAIL_QUERIES = 9


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
            # The same definition, differently cased and spaced — still the same word.
            {"word": "Alpha", "definition": "  Meaning Of Alpha  "},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["id"], self.words[0].id)
        self.assertEqual(VocabWord.objects.filter(section=self.section, word__iexact="alpha").count(), 1)

    def test_existing_headword_with_a_different_definition_is_400(self):
        # Linking would throw the typed definition away; overwriting would rewrite the
        # word for every other set. Neither happens silently.
        other_set = VocabSet.objects.create(section=self.section, title="Set 2", order=1)
        r = self.client.post(
            f"/api/vocabulary/admin/sets/{other_set.id}/words/",
            {"word": "alpha", "definition": "something else entirely"},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn("definition", r.json())
        self.assertIn("meaning of alpha", r.json()["definition"][0])
        self.assertFalse(VocabSetItem.objects.filter(vocab_set=other_set).exists())
        self.words[0].refresh_from_db()
        self.assertEqual(self.words[0].definition, "meaning of alpha")

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
        self._assign_as_homework()
        self.client = self._as(self.admin)

    def test_deleting_an_assigned_set_is_409(self):
        r = self.client.delete(f"/api/vocabulary/admin/sets/{self.vset.id}/")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertIn("detail", r.json())
        self.assertTrue(VocabSet.objects.filter(pk=self.vset.id).exists())

    def test_deleting_a_section_holding_an_assigned_set_is_409(self):
        r = self.client.delete(f"/api/vocabulary/admin/sections/{self.section.id}/")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertTrue(VocabSection.objects.filter(pk=self.section.id).exists())

    def test_deleting_a_word_out_of_an_assigned_set_is_409(self):
        # Otherwise an assigned set that cannot be deleted can still be emptied word by
        # word, cascading away every student's progress row.
        word = self.words[0]
        VocabWordProgress.objects.create(user=self.student, word=word)
        r = self.client.delete(f"/api/vocabulary/admin/words/{word.id}/")
        self.assertEqual(r.status_code, 409, r.content)
        self.assertIn("detail", r.json())
        self.assertTrue(VocabWord.objects.filter(pk=word.id).exists())
        self.assertTrue(VocabWordProgress.objects.filter(word=word).exists())

    def test_a_word_no_assigned_set_holds_is_still_deletable(self):
        loose = VocabWord.objects.create(
            section=self.section, word="loose", definition="unattached"
        )
        self.assertEqual(
            self.client.delete(f"/api/vocabulary/admin/words/{loose.id}/").status_code, 204
        )
