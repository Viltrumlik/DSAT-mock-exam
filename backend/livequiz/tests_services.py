"""The game against a real database: who may join, what counts, and when time is up."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from vocabulary.models import VocabSection, VocabSet, VocabSetItem, VocabWord
from classes.models import Classroom, ClassroomMembership
from core.errors.api import AppError

from . import constants as const
from . import services
from .models import LiveQuizAnswer, LiveQuizSession


def _make_user(email, role, **extra):
    return get_user_model().objects.create_user(
        email=email, password="pw-for-tests", role=role, **extra
    )


@override_settings(LIVE_QUIZ_ENABLED=True)
class LiveQuizBase(TestCase):
    def setUp(self):
        self.teacher = _make_user("teacher@example.test", "teacher", subject="math")
        self.student = _make_user("student@example.test", "student")
        self.other = _make_user("outsider@example.test", "student")

        self.classroom = Classroom.objects.create(
            name="Math Middle A",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

        self.section = VocabSection.objects.create(
            title="Real Exam Words", slug="real-exam-words-test", order=1
        )
        self.vocab_set = VocabSet.objects.create(section=self.section, title="Set 1", order=1)
        WORDS = [
            ("abate", "to become less intense or widespread"),
            ("candid", "truthful and straightforward"),
            ("deft", "neatly skilful and quick"),
            ("elated", "extremely happy and excited"),
            ("frugal", "sparing with money or food"),
            ("gregarious", "fond of the company of others"),
        ]
        self.words = [
            VocabWord.objects.create(section=self.section, word=w, definition=d)
            for w, d in WORDS
        ]
        for position, word in enumerate(self.words):
            VocabSetItem.objects.create(vocab_set=self.vocab_set, word=word, order=position)

    def _session(self, **config):
        return services.create_session(
            host=self.teacher,
            classroom=self.classroom,
            vocab_set=self.vocab_set,
            config=config or {},
        )

    def _playing(self, session):
        return services.join_session(session=session, user=self.student)

    @staticmethod
    def _correct(question):
        return question.correct_answer

    @staticmethod
    def _wrong(question):
        """Any option that is not the key — there are always three."""
        return next(c["id"] for c in question.choices if c["id"] != question.correct_answer)

    def _open_first(self, session):
        session = services.start_game(session=session)
        return services.open_question(session=session, index=0)


class CreatingARoomTests(LiveQuizBase):
    def test_a_session_gets_a_code_and_a_frozen_copy_of_the_questions(self):
        session = self._session()
        self.assertEqual(len(session.join_code), const.JOIN_CODE_LENGTH)
        self.assertEqual(session.status, const.STATUS_LOBBY)
        self.assertEqual(session.questions.count(), len(self.words))

    def test_editing_a_word_afterwards_does_not_change_the_game(self):
        session = self._session()
        frozen = session.questions.get(order=0)
        before_prompt, before_key = frozen.prompt, frozen.correct_answer

        for word in self.words:
            word.word = f"rewritten-{word.pk}"
            word.definition = "rewritten after the game started"
            word.save(update_fields=["word", "definition"])

        frozen.refresh_from_db()
        self.assertEqual(frozen.prompt, before_prompt)
        self.assertEqual(frozen.correct_answer, before_key)
        self.assertNotIn("rewritten", repr(frozen.choices))

    def test_every_question_has_four_options_and_exactly_one_key(self):
        session = self._session()
        for question in session.questions.all():
            ids = [c["id"] for c in question.choices]
            self.assertEqual(ids, ["A", "B", "C", "D"])
            self.assertIn(question.correct_answer, ids)
            texts = [c["text"] for c in question.choices]
            # A repeated option is a second right answer wearing a different letter.
            self.assertEqual(len(set(texts)), 4, texts)

    def test_both_question_forms_are_used(self):
        # "Mixed" is the point: a student who settles into one shape has to keep reading.
        forms = set()
        for _ in range(6):
            forms.update(self._session().questions.values_list("form", flat=True))
        self.assertEqual(forms, {"definition_to_word", "word_to_definition"})

    def test_a_student_cannot_open_a_room(self):
        with self.assertRaises(AppError):
            services.create_session(
                host=self.student, classroom=self.classroom, vocab_set=self.vocab_set
            )

    def test_a_set_too_small_for_four_options_is_refused(self):
        thin = VocabSet.objects.create(section=self.section, title="Thin", order=2)
        for word in self.words[:3]:
            VocabSetItem.objects.create(vocab_set=thin, word=word, order=word.pk)
        with self.assertRaises(AppError) as caught:
            services.create_session(
                host=self.teacher, classroom=self.classroom, vocab_set=thin
            )
        self.assertEqual(caught.exception.code, "too_few_words")

    def test_a_finished_room_releases_its_code(self):
        first = self._session()
        code = first.join_code
        LiveQuizSession.objects.filter(pk=first.pk).update(status=const.STATUS_FINISHED)

        # The partial unique constraint only covers live rooms, so the same code is free.
        second = LiveQuizSession.objects.create(
            vocab_set=self.vocab_set,
            classroom=self.classroom,
            host=self.teacher,
            join_code=code,
            status=const.STATUS_LOBBY,
            config={},
        )
        self.assertEqual(second.join_code, code)


class JoiningTests(LiveQuizBase):
    def test_a_student_on_the_roster_can_join_by_code(self):
        session = self._session()
        found = services.find_session_by_code(session.join_code.lower())
        self.assertIsNotNone(found)
        participant = services.join_session(session=found, user=self.student)
        self.assertEqual(participant.session_id, session.pk)

    def test_somebody_from_another_class_cannot_join(self):
        session = self._session()
        with self.assertRaises(AppError):
            services.join_session(session=session, user=self.other)

    def test_the_host_cannot_also_play(self):
        session = self._session()
        with self.assertRaises(AppError):
            services.join_session(session=session, user=self.teacher)

    def test_joining_twice_returns_the_same_place(self):
        session = self._session()
        first = self._playing(session)
        second = self._playing(session)
        self.assertEqual(first.pk, second.pk)

    def test_a_terminated_room_cannot_be_found_or_rejoined(self):
        session = self._session()
        services.terminate_session(session=session)
        self.assertIsNone(services.find_session_by_code(session.join_code))

    def test_a_removed_student_cannot_come_back(self):
        session = self._session()
        participant = self._playing(session)
        participant.status = const.PARTICIPANT_KICKED
        participant.save(update_fields=["status"])
        with self.assertRaises(AppError):
            services.join_session(session=session, user=self.student)


class AnsweringTests(LiveQuizBase):
    def test_a_right_answer_scores_and_a_wrong_one_does_not(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._correct(question),
        )
        participant.refresh_from_db()
        self.assertGreater(participant.score, 0)
        self.assertEqual(participant.correct_count, 1)
        self.assertEqual(participant.answered_count, 1)

    def test_a_second_answer_is_refused_by_default(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._correct(question),
        )
        with self.assertRaises(AppError) as caught:
            services.submit_answer(
                session=session, participant=participant, question_id=question.id,
                answer=self._wrong(question),
            )
        self.assertEqual(caught.exception.code, const.ERR_ALREADY_ANSWERED)
        self.assertEqual(LiveQuizAnswer.objects.filter(participant=participant).count(), 1)

    def test_a_revision_replaces_the_row_and_moves_the_score_by_the_difference(self):
        session = self._session(allow_answer_change=True)
        participant = self._playing(session)
        session, question = self._open_first(session)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._wrong(question),
        )
        participant.refresh_from_db()
        self.assertEqual(participant.score, 0)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._correct(question),
        )
        participant.refresh_from_db()
        self.assertGreater(participant.score, 0)
        self.assertEqual(participant.correct_count, 1)
        self.assertEqual(participant.answered_count, 1)
        self.assertEqual(LiveQuizAnswer.objects.filter(participant=participant).count(), 1)

    def test_an_answer_after_the_deadline_and_the_grace_is_refused(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)

        too_late = session.question_ends_at + timedelta(
            milliseconds=const.LATE_ANSWER_GRACE_MS + 500
        )
        with self.assertRaises(AppError) as caught:
            services.submit_answer(
                session=session,
                participant=participant,
                question_id=question.id,
                answer=self._correct(question),
                now=too_late,
            )
        self.assertEqual(caught.exception.code, const.ERR_TOO_LATE)

    def test_an_answer_just_inside_the_grace_window_still_counts(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)

        barely = session.question_ends_at + timedelta(milliseconds=const.LATE_ANSWER_GRACE_MS - 50)
        row = services.submit_answer(
            session=session,
            participant=participant,
            question_id=question.id,
            answer=self._correct(question),
            now=barely,
        )
        self.assertTrue(row.is_correct)

    def test_no_answers_once_the_question_is_closed(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.close_question(session=session)
        session.refresh_from_db()

        with self.assertRaises(AppError):
            services.submit_answer(
                session=session, participant=participant, question_id=question.id,
                answer=self._correct(question),
            )

    def test_an_answer_to_the_previous_question_is_refused(self):
        session = self._session()
        participant = self._playing(session)
        session, first = self._open_first(session)
        services.close_question(session=session)
        session.refresh_from_db()
        session, _second = services.advance(session=session)

        with self.assertRaises(AppError) as caught:
            services.submit_answer(
                session=session, participant=participant, question_id=first.id,
                answer=self._correct(first),
            )
        self.assertEqual(caught.exception.code, const.ERR_UNKNOWN_QUESTION)


class ClosingAndFinishingTests(LiveQuizBase):
    def test_only_the_first_caller_closes_a_question(self):
        session = self._session()
        self._playing(session)
        session, _question = self._open_first(session)

        # Two readers of the same row — the timer and the host, racing.
        one = LiveQuizSession.objects.get(pk=session.pk)
        two = LiveQuizSession.objects.get(pk=session.pk)

        self.assertTrue(services.close_question(session=one))
        self.assertFalse(services.close_question(session=two))

    def test_advancing_past_the_last_question_finishes_and_ranks(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._correct(question),
        )

        # Walk the whole quiz, however many words the set had.
        total = services.question_count(session)
        for _ in range(total):
            services.close_question(session=session)
            session.refresh_from_db()
            session, question = services.advance(session=session)
            if question is None:
                break
        else:  # pragma: no cover - only if advance never finishes
            self.fail("the quiz never ended")

        self.assertIsNone(question)
        self.assertEqual(session.status, const.STATUS_FINISHED)
        participant.refresh_from_db()
        self.assertEqual(participant.rank, 1)

    def test_pausing_a_question_gives_the_time_back_on_resume(self):
        session = self._session()
        session, _question = self._open_first(session)
        original_deadline = session.question_ends_at

        session = services.pause_game(session=session)
        self.assertEqual(session.status, const.STATUS_PAUSED)
        # Rewind the pause marker so the resume sees a measurable gap.
        LiveQuizSession.objects.filter(pk=session.pk).update(
            paused_at=timezone.now() - timedelta(seconds=30)
        )
        session.refresh_from_db()

        session = services.resume_game(session=session)
        self.assertEqual(session.status, const.STATUS_QUESTION_ACTIVE)
        self.assertGreater(session.question_ends_at, original_deadline + timedelta(seconds=25))

    def test_a_terminated_game_stays_terminated(self):
        session = self._session()
        services.terminate_session(session=session)
        session.refresh_from_db()
        again = services.terminate_session(session=session)
        self.assertEqual(again.status, const.STATUS_TERMINATED)


class PayloadSafetyTests(LiveQuizBase):
    def test_the_open_question_frame_carries_no_answer_key(self):
        from . import events

        session = self._session()
        session, question = self._open_first(session)
        frame = events.question_started(session, question, total=len(self.words))

        flat = repr(frame)
        self.assertNotIn("correct_answer", flat)
        self.assertNotIn("explanation", flat)

    def test_the_closing_frame_does_carry_the_key(self):
        from . import events

        session = self._session()
        session, question = self._open_first(session)
        frame = events.question_ended(session, question, tally={}, total=2)
        self.assertEqual(frame["correct_answer"], question.correct_answer)

    def test_the_state_snapshot_hides_the_question_once_it_is_closed(self):
        from . import events

        session = self._session()
        session, _question = self._open_first(session)
        services.close_question(session=session)
        session.refresh_from_db()

        snapshot = events.session_state(
            session,
            participants=services.participants_of(session),
            question=session.current_question(),
            total=len(self.words),
        )
        self.assertNotIn("question", snapshot)

    def test_the_tally_counts_answers_without_naming_anybody(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.submit_answer(
            session=session, participant=participant, question_id=question.id,
            answer=self._correct(question),
        )

        tally = services.question_tally(session=session, question=question)
        self.assertEqual(tally["answered"], 1)
        self.assertEqual(tally["correct"], 1)
        self.assertNotIn(participant.display_name, repr(tally))
