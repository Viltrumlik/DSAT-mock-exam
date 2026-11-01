"""SAT questions as a Live Quiz source: an assessment set, copied into the room at creation."""

from __future__ import annotations

from rest_framework.test import APIClient

from assessments.models import AssessmentQuestion, AssessmentSet
from core.errors.api import AppError

from . import constants as const
from . import events, paced, services
from .models import LiveQuizSession
from .tests_services import LiveQuizBase

MC_CHOICES = [
    {"id": "A", "text": "2"},
    {"id": "B", "text": "3"},
    {"id": "C", "text": "4"},
    {"id": "D", "text": "6"},
]


class SatSourceBase(LiveQuizBase):
    def setUp(self):
        super().setUp()
        self.aset = AssessmentSet.objects.create(
            title="Linear equations", subject=AssessmentSet.SUBJECT_MATH, created_by=self.teacher, is_active=True
        )
        self.mc = AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=1,
            prompt="If $2x = 6$, what is $x$?",
            question_type="multiple_choice",
            choices=MC_CHOICES,
            correct_answer="B",
            points=1,
            explanation="Divide both sides by 2.",
        )
        self.grid = AssessmentQuestion.objects.create(
            assessment_set=self.aset,
            order=2,
            prompt="If $4y = 6$, what is $y$?",
            question_type="numeric",
            correct_answer="1.5",
            points=2,
        )
        AssessmentQuestion.objects.create(
            assessment_set=self.aset, order=3, prompt="Retired", question_type="numeric", correct_answer="1", is_active=False
        )

    def _sat_room(self, **config):
        return services.create_session(
            host=self.teacher,
            classroom=self.classroom,
            assessment_set=self.aset,
            config={"mode": const.MODE_STUDENT_PACED, "shuffle_questions": False, **config},
        )


class CreatingTests(SatSourceBase):
    def test_a_room_copies_the_sets_active_questions(self):
        session = self._sat_room()
        self.assertIsNone(session.vocab_set)
        rows = list(session.questions.order_by("order"))
        self.assertEqual([r.prompt for r in rows], [self.mc.prompt, self.grid.prompt])
        self.assertEqual(rows[0].choices, MC_CHOICES)
        self.assertEqual(rows[0].correct_answer, "B")
        self.assertEqual(rows[0].explanation, "Divide both sides by 2.")
        self.assertEqual(rows[0].source_question_id, self.mc.id)
        self.assertEqual(rows[1].points, 2)

    def test_an_edit_after_the_room_opened_changes_nothing_in_it(self):
        session = self._sat_room()
        AssessmentQuestion.objects.filter(pk=self.mc.pk).update(correct_answer="C")
        self.assertEqual(session.questions.get(order=0).correct_answer, "B")

    def test_exactly_one_source(self):
        with self.assertRaises(AppError):
            services.create_session(host=self.teacher, classroom=self.classroom)
        with self.assertRaises(AppError):
            services.create_session(
                host=self.teacher, classroom=self.classroom, vocab_set=self.vocab_set, assessment_set=self.aset
            )

    def test_a_set_with_nothing_active_is_refused(self):
        AssessmentQuestion.objects.filter(assessment_set=self.aset).update(is_active=False)
        with self.assertRaises(AppError) as caught:
            self._sat_room()
        self.assertEqual(caught.exception.code, "empty_set")

    def test_the_title_comes_from_the_set(self):
        from .serializers import session_summary

        summary = session_summary(self._sat_room())
        self.assertEqual(summary["title"], "Linear equations")
        self.assertEqual(summary["source"], "sat")


class PlayingTests(SatSourceBase):
    def _in_play(self):
        session = self._sat_room()
        participant = services.join_session(session=session, user=self.student)
        session = services.start_game(session=session)
        session, _ = paced.begin_play(session=session)
        participant.refresh_from_db()
        return session, participant

    def test_a_grid_in_is_marked_by_the_homework_grader(self):
        session, participant = self._in_play()
        paced.submit(
            session=session, participant=participant, question_id=paced.current_question(session, participant).id,
            answer="A", now=participant.question_started_at,
        )
        participant.refresh_from_db()
        grid = paced.current_question(session, participant)
        move = paced.submit(
            session=session, participant=participant, question_id=grid.id, answer="3/2",
            now=participant.question_started_at,
        )
        self.assertTrue(move.answer.is_correct)
        # Two points on the game scale, answered at once: 1200 + 800.
        self.assertEqual(move.breakdown["total"], 2000)

    def test_the_question_frame_carries_images_but_never_the_key(self):
        session = self._sat_room()
        row = session.questions.get(order=0)
        row.image_paths = {"question": "assessment_questions/graph.png", "B": "assessment_questions/b.png"}
        row.save(update_fields=["image_paths"])
        frame = events.public_question(row, index=0, total=2)
        self.assertNotIn("correct_answer", frame)
        self.assertTrue(frame["question_image"].endswith("assessment_questions/graph.png"))
        self.assertEqual(set(frame["option_images"]), {"B"})


class RestTests(SatSourceBase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()
        self.api.force_authenticate(user=self.teacher)

    def test_the_options_offer_the_classes_sat_sets(self):
        reply = self.api.get(f"/api/livequiz/options/?classroom={self.classroom.pk}").json()
        sets = {row["id"]: row for row in reply["assessment_sets"]}
        self.assertIn(self.aset.pk, sets)
        self.assertEqual(sets[self.aset.pk]["question_count"], 2)

    def test_a_room_is_created_from_a_sat_set(self):
        reply = self.api.post(
            "/api/livequiz/sessions/",
            {"classroom_id": self.classroom.pk, "assessment_set_id": self.aset.pk, "config": {"question_seconds": 90}},
            format="json",
        )
        self.assertEqual(reply.status_code, 201, reply.content)
        session = LiveQuizSession.objects.get(pk=reply.json()["id"])
        self.assertEqual(session.assessment_set_id, self.aset.pk)
        self.assertEqual(session.questions.count(), 2)

    def test_two_sources_at_once_are_refused(self):
        reply = self.api.post(
            "/api/livequiz/sessions/",
            {"classroom_id": self.classroom.pk, "assessment_set_id": self.aset.pk, "vocab_set_id": self.vocab_set.pk},
            format="json",
        )
        self.assertEqual(reply.status_code, 400)
