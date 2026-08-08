"""The rewards cutover command (PR 9).

The code change repoints the academic board at the reward ledger. This command performs the
data move that has to go with it — and the part worth testing is the *deletion*, because
leaving the old rows in place is the failure mode that looks fine until a student opens the
app: the retired currency was a re-derived sum of raw assessment points, routinely in the
hundreds, and a reward total starts near zero.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from classes.models_ranking import RankingSnapshot
from rewards.models import PointAward
from rewards.models import RewardSeason
from rewards.services import current_season

User = get_user_model()


class CutoverAcademicLeaderboardTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("cut_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Eng A", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        self.student = User.objects.create_user("cut_stu@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        PointAward.objects.create(
            student=self.student, season=current_season(), event="MANUAL",
            points=12, classroom=self.classroom, idempotency_key="cut-1",
        )
        # A board from before the cutover, in the retired currency.
        self.old = RankingSnapshot.objects.create(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="2026-07-01", student=self.student, rank=1, score=840.0,
            components={"points": 840.0, "assessments_count": 9}, computed_at=timezone.now(),
        )
        self.sat = RankingSnapshot.objects.create(
            classroom=self.classroom, kind=RankingSnapshot.KIND_SAT,
            period_key="2026-07-01", student=self.student, rank=1, score=1200.0,
            components={}, computed_at=timezone.now(),
        )

    def test_it_clears_the_old_currency_and_rebuilds_from_the_ledger(self):
        call_command("cutover_academic_leaderboard")

        self.assertFalse(RankingSnapshot.objects.filter(pk=self.old.pk).exists())
        rows = RankingSnapshot.objects.filter(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC
        )
        self.assertEqual(rows.count(), 1)
        row = rows.get()
        self.assertEqual(float(row.score), 12.0)
        self.assertEqual(row.components["source"], "rewards")

    def test_no_snapshot_survives_to_make_the_first_new_board_read_declining(self):
        # The reason step 2 exists. `_previous_scores` reads the newest snapshot from another
        # period; an 840 left behind would make 12 points look like a collapse to every
        # student in the school on cutover day.
        call_command("cutover_academic_leaderboard")
        row = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC
        )
        self.assertEqual(row.trend, RankingSnapshot.TREND_STABLE)
        self.assertIsNone(row.previous_rank)

    def test_sat_boards_are_untouched(self):
        call_command("cutover_academic_leaderboard")
        self.sat.refresh_from_db()
        self.assertEqual(float(self.sat.score), 1200.0)

    def test_dry_run_changes_nothing(self):
        call_command("cutover_academic_leaderboard", "--dry-run")
        self.assertTrue(RankingSnapshot.objects.filter(pk=self.old.pk).exists())
        self.assertEqual(float(RankingSnapshot.objects.get(pk=self.old.pk).score), 840.0)

    def test_it_is_safe_to_run_twice(self):
        call_command("cutover_academic_leaderboard")
        call_command("cutover_academic_leaderboard")
        rows = RankingSnapshot.objects.filter(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC
        )
        self.assertEqual(rows.count(), 1)
        self.assertEqual(float(rows.get().score), 12.0)

    def test_it_opens_a_season_when_none_exists(self):
        # A season is PROTECTed by its awards, so an empty ledger is the only state where
        # none exists — which is exactly a fresh install on cutover day.
        PointAward.objects.all().delete()
        RewardSeason.objects.all().delete()
        call_command("cutover_academic_leaderboard")
        self.assertTrue(RewardSeason.objects.filter(is_current=True).exists())
