"""Team mode: who goes where, moving players in the lobby, and the teams' standings."""

from __future__ import annotations

from django.contrib.auth import get_user_model

from classes.models import ClassroomMembership
from core.errors.api import AppError

from . import constants as const
from . import events, paced, services
from .models import LiveQuizParticipant
from .tests_paced import PacedBase


class TeamsBase(PacedBase):
    def _students(self, count):
        users = [self.student]
        for n in range(count - 1):
            user = get_user_model().objects.create_user(
                email=f"team{n}@example.test", password="pw-for-tests", role="student"
            )
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
            )
            users.append(user)
        return users


class ConfigTests(TeamsBase):
    def test_off_by_default_and_bounded(self):
        self.assertEqual(services.normalize_config({})["teams"], 0)
        self.assertEqual(services.normalize_config({"teams": 3})["teams"], 3)
        for bad in (1, 7, "x"):
            with self.assertRaises(AppError):
                services.normalize_config({"teams": bad})

    def test_teacher_paced_rooms_have_no_teams(self):
        self.assertEqual(
            services.normalize_config({"mode": const.MODE_INSTRUCTOR_PACED, "teams": 3})["teams"], 0
        )


class AssignmentTests(TeamsBase):
    def test_joining_fills_the_smallest_team(self):
        session = self._paced(teams=2)
        teams = [services.join_session(session=session, user=u).team for u in self._students(5)]
        self.assertEqual(teams, [0, 1, 0, 1, 0])

    def test_no_teams_means_no_team(self):
        session = self._paced()
        self.assertIsNone(services.join_session(session=session, user=self.student).team)

    def test_the_host_moves_a_player_in_the_lobby_only(self):
        session = self._paced(teams=3)
        player = services.join_session(session=session, user=self.student)
        moved = services.move_team(session=session, participant_id=player.pk, team=2)
        self.assertEqual(moved.team, 2)
        with self.assertRaises(AppError):
            services.move_team(session=session, participant_id=player.pk, team=3)
        session = services.start_game(session=session)
        with self.assertRaises(AppError):
            services.move_team(session=session, participant_id=player.pk, team=0)


class StandingsTests(TeamsBase):
    def test_a_teams_score_is_the_sum_of_its_members(self):
        session = self._paced(teams=2)
        players = [services.join_session(session=session, user=u) for u in self._students(3)]
        for player, score in zip(players, (500, 300, 400)):
            LiveQuizParticipant.objects.filter(pk=player.pk).update(score=score)
        rows = events.team_standings(services.participants_of(session), 2)
        self.assertEqual([(r["name"], r["score"], r["members"], r["rank"]) for r in rows],
                         [("Comets", 900, 2, 1), ("Falcons", 300, 1, 2)])

    def test_the_leaderboard_and_snapshot_carry_the_teams(self):
        session = self._paced(teams=2)
        services.join_session(session=session, user=self.student)
        players = services.participants_of(session)
        self.assertEqual(len(events.leaderboard(players, teams=2)["teams"]), 2)
        self.assertIn("teams", events.session_state(session, participants=players))
        self.assertNotIn("teams", events.leaderboard(players))

    def test_a_test_room_hides_the_team_scores_too(self):
        blind = events.without_scores({"teams": [{"team": 0, "score": 900}]})
        self.assertEqual(blind["teams"][0]["score"], 0)
