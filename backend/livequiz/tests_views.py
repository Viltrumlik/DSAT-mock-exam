"""The REST surface: taking a place in a room.

A student reaches a live quiz two ways. They type the code their teacher put on the board,
or they tap the room in "running now" on `/live` — the list of games going on in their own
classes, which deliberately does **not** carry the code, so that a student cannot hand a
live code to somebody outside the class.

The second way had no way to take a place. It opened the game page, the socket found no
participant row and refused the handshake, and the student sat on "Lost contact — trying to
reconnect" for as long as they were willing to wait. The room's own roster is the guard
here, not the code — so being on it is enough to be let in by id.
"""

from __future__ import annotations

from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from . import constants as const
from . import services
from .models import LiveQuizParticipant
from .tests_services import LiveQuizBase


@override_settings(LIVE_QUIZ_ENABLED=True)
class JoinByIdTests(LiveQuizBase):
    def setUp(self):
        super().setUp()
        self.api = APIClient()
        self.session = self._session()

    def _url(self, session=None):
        return reverse("livequiz-session-join", args=[(session or self.session).pk])

    def _post(self, user, session=None):
        self.api.force_authenticate(user=user)
        return self.api.post(self._url(session), {}, format="json")

    def test_a_student_on_the_roster_takes_a_place_without_ever_seeing_the_code(self):
        response = self._post(self.student)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(
            LiveQuizParticipant.objects.filter(
                session=self.session, user=self.student, status=const.PARTICIPANT_JOINED
            ).exists()
        )

    def test_the_reply_does_not_hand_over_the_join_code(self):
        # The whole point of arriving by id: this student was never told the code, and a
        # code they can read is a code they can pass on.
        response = self._post(self.student)

        self.assertNotIn("join_code", response.data["session"])

    def test_asking_twice_keeps_the_same_place(self):
        first = self._post(self.student)
        second = self._post(self.student)

        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["participant"]["id"], second.data["participant"]["id"])
        self.assertEqual(
            LiveQuizParticipant.objects.filter(session=self.session, user=self.student).count(), 1
        )

    def test_somebody_from_another_class_is_refused(self):
        response = self._post(self.other)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            LiveQuizParticipant.objects.filter(session=self.session, user=self.other).exists()
        )

    def test_the_host_is_refused_rather_than_added_to_their_own_leaderboard(self):
        response = self._post(self.teacher)

        self.assertEqual(response.status_code, 403)

    def test_a_room_that_has_finished_does_not_take_anybody_new(self):
        services.terminate_session(session=self.session)

        response = self._post(self.student)

        self.assertIn(response.status_code, (404, 409))

    def test_a_student_the_host_removed_is_not_let_back_in(self):
        participant = services.join_session(session=self.session, user=self.student)
        services.remove_participant(session=self.session, participant_id=participant.id)

        response = self._post(self.student)

        self.assertEqual(response.status_code, 403)

    @override_settings(LIVE_QUIZ_ENABLED=False)
    def test_the_route_does_not_exist_while_the_feature_is_off(self):
        response = self._post(self.student)

        self.assertEqual(response.status_code, 404)
