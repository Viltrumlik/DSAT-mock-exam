"""Equal XP, equal rank — on every board, and on the card that tells a student their own.

A teacher reported that two students holding the same XP were shown different rankings, and
the reason was that this product had two conventions at once: the lists numbered *positions*
while a student's own "where you stand" card counted *rivals*. Either is defensible alone;
together they mean the list and the card disagree about the same student, and no amount of
explaining makes that read as anything but a broken board.

These tests pin the settled rule in both directions — the numbers themselves, and the fact
that the two paths agree — because the second is the part that regresses silently. A future
change to the list's ordering can go green on every "who is first" assertion in
`tests_leaderboard.py` while quietly reintroducing exactly the complaint above.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from classes.models import Classroom, ClassroomMembership
from classes.models_org import Branch, Region
from classes.models_ranking import RankingSnapshot
from classes.ranking import service as ranking_service
from rewards import leaderboard
from rewards.models import PointAward
from rewards.services import current_season

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class TiedXpFixture(TestCase):
    """One class, four students, XP 100 / 90 / 90 / 80.

    The smallest board that shows the whole rule at once: a clear winner, a two-way tie, and
    somebody below it whose own position must survive the tie above them.

    ``mid_b`` reaches 90 in two earnings of 45 where ``mid_a`` reaches it in one. That is not
    decoration — the award count is the tie-break the display order uses and the one the
    ranking must ignore, so every assertion in this file is also checking that a number no
    student can see never splits a number every student can.
    """

    def setUp(self):
        self.staff = _u("tie_staff@t.com")
        self.region = Region.objects.create(name="Tashkent", code="TAS")
        self.branch = Branch.objects.create(region=self.region, name="Chilonzor")
        self.classroom = Classroom.objects.create(
            name="Eng Ties", subject=Classroom.SUBJECT_ENGLISH, level="middle",
            branch=self.branch, lesson_days=Classroom.DAYS_ODD, created_by=self.staff,
        )

        self.top = self._student("tie_top@t.com")
        self.mid_a = self._student("tie_mid_a@t.com")
        self.mid_b = self._student("tie_mid_b@t.com")
        self.low = self._student("tie_low@t.com")

        self._earn(self.top, 100, "tie-top")
        self._earn(self.mid_a, 90, "tie-mid-a")
        self._earn(self.mid_b, 45, "tie-mid-b-1")
        self._earn(self.mid_b, 45, "tie-mid-b-2")
        self._earn(self.low, 80, "tie-low")

    def _student(self, email, classroom=None):
        user = _u(email)
        ClassroomMembership.objects.create(
            classroom=classroom or self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        return user

    def _earn(self, student, xp, key, *, classroom=None):
        return PointAward.objects.create(
            student=student, season=current_season(), event="MANUAL",
            points=xp, xp=xp, classroom=classroom or self.classroom, idempotency_key=key,
        )

    def _rows(self, viewer, **params):
        rows, _meta = leaderboard.board(leaderboard.BoardQuery.from_params(params), viewer)
        return rows

    def _ranks_by_student(self, rows):
        return {row["student_id"]: row["rank"] for row in rows}


class GroupBoardTieTests(TiedXpFixture):
    """The board a teacher and their class actually look at — `leaderboard._group_rows`."""

    def test_two_students_on_the_same_xp_share_a_rank(self):
        ranks = self._ranks_by_student(self._rows(self.top, scope="GROUP"))

        self.assertEqual(ranks[self.mid_a.pk], ranks[self.mid_b.pk])
        self.assertEqual(ranks[self.mid_a.pk], 2)

    def test_the_student_below_a_two_way_tie_is_fourth_not_third(self):
        """Competition ranking, not dense ranking. Third place was taken — by two people —
        and handing it to the next student would tell them they were beaten by one rival when
        they were beaten by three. The skipped number is the information."""
        ranks = self._ranks_by_student(self._rows(self.top, scope="GROUP"))

        self.assertEqual(
            [ranks[s.pk] for s in (self.top, self.mid_a, self.mid_b, self.low)], [1, 2, 2, 4]
        )

    def test_a_tie_is_not_split_by_the_number_of_awards_behind_it(self):
        """`mid_b` earned their 90 in two goes and `mid_a` in one. The award count orders the
        two rows and must never rank them: it appears on no screen either student sees, so a
        board that used it would be answering "same XP, different rank" with a reason neither
        of them can check."""
        rows = self._rows(self.top, scope="GROUP")
        by_student = {row["student_id"]: row for row in rows}

        self.assertNotEqual(by_student[self.mid_a.pk]["awards"], by_student[self.mid_b.pk]["awards"])
        self.assertEqual(by_student[self.mid_a.pk]["xp"], by_student[self.mid_b.pk]["xp"])
        self.assertEqual(by_student[self.mid_a.pk]["rank"], by_student[self.mid_b.pk]["rank"])

    def test_tied_rows_still_come_back_in_a_fixed_order(self):
        """Sharing a number must not cost the board a stable order — a list that dealt its
        tied rows differently on each refresh would be a new complaint in place of the old
        one. The award count and the student id still decide who is *printed* first."""
        first = [row["student_id"] for row in self._rows(self.top, scope="GROUP")]
        second = [row["student_id"] for row in self._rows(self.top, scope="GROUP")]

        self.assertEqual(first, second)
        # More awards is printed first, and is still not ranked higher.
        self.assertLess(first.index(self.mid_b.pk), first.index(self.mid_a.pk))


class GlobalBoardTieTests(TiedXpFixture):
    """The platform-wide board, which ranks an ordered queryset rather than a materialised list."""

    def test_two_students_on_the_same_xp_share_a_rank(self):
        ranks = self._ranks_by_student(self._rows(self.top, scope="GLOBAL"))

        self.assertEqual(
            [ranks[s.pk] for s in (self.top, self.mid_a, self.mid_b, self.low)], [1, 2, 2, 4]
        )

    def test_a_truncated_board_still_numbers_the_rows_it_kept_correctly(self):
        """The platform-wide board ranks `[: limit]` of a descending queryset. Cutting the tail
        off cannot move a row that survived, so the ranks on a short board are the ranks the
        full board would have given those same rows — this is what lets the slice happen
        before the numbering rather than after it."""
        short = self._ranks_by_student(self._rows(self.top, scope="GLOBAL", limit="3"))
        full = self._ranks_by_student(self._rows(self.top, scope="GLOBAL"))

        self.assertEqual(len(short), 3)
        for student_id, rank in short.items():
            self.assertEqual(rank, full[student_id])


class OwnPositionAgreesWithTheBoardTests(TiedXpFixture):
    """The teacher's actual report: the card and the list, on the same student, disagreeing.

    `leaderboard.rank_of` never materialises the board — it counts how many students are
    strictly ahead, so a student far below the visible limit still learns where they stand.
    That is a second implementation of the ranking rule, and a second implementation is only
    safe while something checks the two against each other.
    """

    def _assert_agrees(self, student, **params):
        ranks = self._ranks_by_student(self._rows(student, **params))
        mine = leaderboard.rank_of(
            student, leaderboard.BoardQuery.from_params(params), viewer=student
        )
        self.assertIsNotNone(mine, "a student with XP always has a position")
        self.assertEqual(
            mine["rank"], ranks[student.pk],
            f"{params} — own card says #{mine['rank']}, the list says #{ranks[student.pk]}",
        )

    def test_a_tied_students_own_position_matches_the_list(self):
        """The exact shape of the bug report. Before the boards moved to competition ranking,
        the second-printed of two tied students was #3 on the list and #2 on their own card."""
        for student in (self.mid_a, self.mid_b):
            with self.subTest(student=student.email):
                self._assert_agrees(student, scope="GROUP")
                self._assert_agrees(student, scope="GLOBAL")

    def test_every_student_on_the_board_agrees_with_their_own_card(self):
        for student in (self.top, self.mid_a, self.mid_b, self.low):
            with self.subTest(student=student.email):
                self._assert_agrees(student, scope="GROUP")
                self._assert_agrees(student, scope="GLOBAL")

    def test_the_student_below_the_tie_is_told_fourth_by_both(self):
        """`rank_of` counts rivals and the list numbers positions. They agree on 4 only
        because the list skips 3 — the one number where the two conventions used to part."""
        self._assert_agrees(self.low, scope="GROUP")

        mine = leaderboard.rank_of(
            self.low, leaderboard.BoardQuery.from_params({"scope": "GLOBAL"}), viewer=self.low
        )
        self.assertEqual(mine["rank"], 4)

    def test_agreement_survives_the_student_falling_off_a_short_board(self):
        """The case `rank_of` exists for. Its answer is about the whole board, so it must not
        follow the visible slice down — and it must still match the rank the full list
        would have printed."""
        full = self._ranks_by_student(self._rows(self.low, scope="GLOBAL"))

        mine = leaderboard.rank_of(
            self.low,
            leaderboard.BoardQuery.from_params({"scope": "GLOBAL", "limit": "2"}),
            viewer=self.low,
        )

        self.assertEqual(mine["rank"], full[self.low.pk])


class AcademicSnapshotTieTests(TiedXpFixture):
    """The persisted classroom board — `classes.ranking.service._recompute_academic`.

    This one writes rows rather than returning them, so a disagreement here outlives the
    request that caused it: a teacher opening the Rankings page a week later reads whatever
    the recompute decided.
    """

    def _snapshots(self, period_key):
        return {
            snap.student_id: snap
            for snap in RankingSnapshot.objects.filter(
                classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
                period_key=period_key,
            )
        }

    def test_tied_xp_is_written_to_the_snapshot_as_a_tied_rank(self):
        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")

        snaps = self._snapshots("p1")
        self.assertEqual(float(snaps[self.mid_a.id].score), float(snaps[self.mid_b.id].score))
        self.assertEqual(snaps[self.mid_a.id].rank, snaps[self.mid_b.id].rank)
        self.assertEqual(
            [snaps[s.id].rank for s in (self.top, self.mid_a, self.mid_b, self.low)], [1, 2, 2, 4]
        )

    def test_a_duplicate_rank_inside_one_period_is_storable(self):
        """`uniq_ranking_snapshot_per_period` is on (classroom, kind, period_key, student) and
        deliberately not on rank, so sharing a number is legal without a migration. If anyone
        ever adds rank to that constraint, this is the test that says why they cannot."""
        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")

        tied = RankingSnapshot.objects.filter(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", rank=2,
        )
        self.assertEqual(tied.count(), 2)

    def test_a_student_who_has_earned_nothing_shares_last_place(self):
        """This board lists the whole roster, zeros included, so the rule has a visible
        consequence here that it has nowhere else: students with nothing are all equal and
        are all numbered the same. Ordering them 5th and 6th would invent a difference the
        board has no evidence for."""
        idle_one = self._student("tie_idle_one@t.com")
        idle_two = self._student("tie_idle_two@t.com")

        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")

        snaps = self._snapshots("p1")
        self.assertEqual(snaps[idle_one.id].rank, 5)
        self.assertEqual(snaps[idle_two.id].rank, 5)

    def test_rank_change_still_reads_across_a_period_when_ranks_are_tied(self):
        """`previous_rank` and the `rank_change` in `components` are per student, so a shared
        number must not break them — a tied student who is overtaken still has to be told
        they moved."""
        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        self._earn(self.low, 50, "tie-low-surge")   # 80 + 50 = 130, now clear of everyone
        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p2")

        snaps = self._snapshots("p2")
        risen = snaps[self.low.id]
        self.assertEqual(risen.rank, 1)
        self.assertEqual(risen.previous_rank, 4)
        self.assertEqual(risen.components["rank_change"], 3)

        # The pair that was tied 2nd is now tied 3rd, and each of them knows they slipped.
        for student in (self.mid_a, self.mid_b):
            with self.subTest(student=student.email):
                self.assertEqual(snaps[student.id].rank, 3)
                self.assertEqual(snaps[student.id].components["rank_change"], -1)

    def test_a_tie_still_gets_the_same_percentile(self):
        """`_percentile` reads the score list rather than the rank, so it was never part of
        the bug — which is exactly why it is worth pinning that it agrees with the ranks it
        now sits beside."""
        ranking_service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")

        snaps = self._snapshots("p1")
        self.assertEqual(
            float(snaps[self.mid_a.id].percentile), float(snaps[self.mid_b.id].percentile)
        )


class CompetitionRankHelperTests(TestCase):
    """The shared helper on its own, for the shapes the three boards do not exercise."""

    def test_an_empty_board_produces_no_ranks(self):
        self.assertEqual(list(leaderboard.competition_ranks([], key=lambda r: r["xp"])), [])

    def test_a_board_where_everybody_is_level_is_all_first_place(self):
        rows = [{"xp": 10} for _ in range(4)]

        ranks = [rank for rank, _row in leaderboard.competition_ranks(rows, key=lambda r: r["xp"])]

        self.assertEqual(ranks, [1, 1, 1, 1])

    def test_a_longer_tie_skips_further(self):
        """Three abreast in second means the next student is fifth. The size of the skip is
        the size of the tie — any other answer is a different convention."""
        rows = [{"xp": xp} for xp in (100, 90, 90, 90, 80)]

        ranks = [rank for rank, _row in leaderboard.competition_ranks(rows, key=lambda r: r["xp"])]

        self.assertEqual(ranks, [1, 2, 2, 2, 5])

    def test_a_missing_total_ranks_as_zero_rather_than_raising(self):
        """`Sum` returns None for a student with nothing, and None cannot be compared against
        an int. `xp_rank_key` settles that before the first comparison happens."""
        rows = [{"xp": 10}, {"xp": None}, {"xp": 0}]

        ranks = [
            rank for rank, _row in leaderboard.competition_ranks(rows, key=leaderboard.xp_rank_key)
        ]

        self.assertEqual(ranks, [1, 2, 2])
