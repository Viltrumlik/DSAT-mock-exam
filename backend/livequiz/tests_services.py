"""The game against a real database: who may join, what counts, and when time is up."""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from assessments.models import AssessmentQuestion, AssessmentSet
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

        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="Algebra",
            title="Warm-up",
            created_by=self.teacher,
        )
        for order in range(2):
            AssessmentQuestion.objects.create(
                assessment_set=self.aset,
                order=order,
                prompt=f"Question {order}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "right"}, {"id": "B", "text": "wrong"}],
                correct_answer="A",
                points=1,
            )

    def _session(self, **config):
        return services.create_session(
            host=self.teacher,
            classroom=self.classroom,
            assessment_set=self.aset,
            config=config or {},
        )

    def _playing(self, session):
        return services.join_session(session=session, user=self.student)

    def _open_first(self, session):
        session = services.start_game(session=session)
        return services.open_question(session=session, index=0)


class CreatingARoomTests(LiveQuizBase):
    def test_a_session_gets_a_code_and_a_frozen_copy_of_the_questions(self):
        session = self._session()
        self.assertEqual(len(session.join_code), const.JOIN_CODE_LENGTH)
        self.assertEqual(session.status, const.STATUS_LOBBY)
        self.assertEqual(session.questions.count(), 2)

    def test_editing_the_source_set_afterwards_does_not_change_the_game(self):
        session = self._session()
        source = self.aset.questions.get(order=0)
        source.prompt = "Rewritten after the game started"
        source.correct_answer = "B"
        source.save(update_fields=["prompt", "correct_answer"])

        frozen = session.questions.get(order=0)
        self.assertEqual(frozen.prompt, "Question 0")
        self.assertEqual(frozen.correct_answer, "A")

    def test_a_student_cannot_open_a_room(self):
        with self.assertRaises(AppError):
            services.create_session(
                host=self.student, classroom=self.classroom, assessment_set=self.aset
            )

    def test_an_empty_set_is_refused(self):
        empty = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH,
            category="x",
            title="Empty",
            created_by=self.teacher,
        )
        with self.assertRaises(AppError):
            services.create_session(
                host=self.teacher, classroom=self.classroom, assessment_set=empty
            )

    def test_a_finished_room_releases_its_code(self):
        first = self._session()
        code = first.join_code
        LiveQuizSession.objects.filter(pk=first.pk).update(status=const.STATUS_FINISHED)

        # The partial unique constraint only covers live rooms, so the same code is free.
        second = LiveQuizSession.objects.create(
            assessment_set=self.aset,
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
            session=session, participant=participant, question_id=question.id, answer="A"
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
            session=session, participant=participant, question_id=question.id, answer="A"
        )
        with self.assertRaises(AppError) as caught:
            services.submit_answer(
                session=session, participant=participant, question_id=question.id, answer="B"
            )
        self.assertEqual(caught.exception.code, const.ERR_ALREADY_ANSWERED)
        self.assertEqual(LiveQuizAnswer.objects.filter(participant=participant).count(), 1)

    def test_a_revision_replaces_the_row_and_moves_the_score_by_the_difference(self):
        session = self._session(allow_answer_change=True)
        participant = self._playing(session)
        session, question = self._open_first(session)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id, answer="B"
        )
        participant.refresh_from_db()
        self.assertEqual(participant.score, 0)

        services.submit_answer(
            session=session, participant=participant, question_id=question.id, answer="A"
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
                answer="A",
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
            answer="A",
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
                session=session, participant=participant, question_id=question.id, answer="A"
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
                session=session, participant=participant, question_id=first.id, answer="A"
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
            session=session, participant=participant, question_id=question.id, answer="A"
        )

        services.close_question(session=session)
        session.refresh_from_db()
        session, second = services.advance(session=session)
        self.assertIsNotNone(second)

        services.close_question(session=session)
        session.refresh_from_db()
        session, nothing = services.advance(session=session)

        self.assertIsNone(nothing)
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
        frame = events.question_started(session, question, total=2)

        flat = repr(frame)
        self.assertNotIn("correct_answer", flat)
        self.assertNotIn("explanation", flat)

    def test_the_closing_frame_does_carry_the_key(self):
        from . import events

        session = self._session()
        session, question = self._open_first(session)
        frame = events.question_ended(session, question, tally={}, total=2)
        self.assertEqual(frame["correct_answer"], "A")

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
            total=2,
        )
        self.assertNotIn("question", snapshot)

    def test_the_tally_counts_answers_without_naming_anybody(self):
        session = self._session()
        participant = self._playing(session)
        session, question = self._open_first(session)
        services.submit_answer(
            session=session, participant=participant, question_id=question.id, answer="A"
        )

        tally = services.question_tally(session=session, question=question)
        self.assertEqual(tally["answered"], 1)
        self.assertEqual(tally["correct"], 1)
        self.assertNotIn(participant.display_name, repr(tally))
