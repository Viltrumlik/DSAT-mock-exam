"""The platform-wide XP board: scopes, filters, and the things that must not silently widen.

The dangerous failure here is not a wrong number — it is a board that answers a *different
question* from the one its heading asks. "My Group" quietly showing the whole school, a branch
filter falling back to global, a time window that does not actually filter. Most of these
tests exist to pin exactly that.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Classroom, ClassroomMembership
from classes.models_org import Branch, Region, branch_for_student, branch_ids_for_students
from rewards import leaderboard
from rewards.models import PointAward
from rewards.services import current_season

User = get_user_model()


def _u(email):
    return User.objects.create_user(email, "secret123")


class OrgFixture(TestCase):
    """Two branches in one region, one class each, two students each."""

    def setUp(self):
        self.region = Region.objects.create(name="Tashkent", code="TAS")
        self.other_region = Region.objects.create(name="Samarkand", code="SAM")
        self.north = Branch.objects.create(region=self.region, name="Chilonzor")
        self.south = Branch.objects.create(region=self.other_region, name="Registon")

        self.staff = _u("lb_staff@t.com")
        self.eng_north = self._classroom("Eng North", self.north, Classroom.SUBJECT_ENGLISH)
        self.math_south = self._classroom("Math South", self.south, Classroom.SUBJECT_MATH)

        self.ann = self._student("lb_ann@t.com", self.eng_north)
        self.bob = self._student("lb_bob@t.com", self.eng_north)
        self.cal = self._student("lb_cal@t.com", self.math_south)

        self._earn(self.ann, self.eng_north, 100, "a1")
        self._earn(self.bob, self.eng_north, 50, "b1")
        self._earn(self.cal, self.math_south, 75, "c1")

    def _classroom(self, name, branch, subject, level="middle"):
        return Classroom.objects.create(
            name=name, subject=subject, level=level, branch=branch,
            lesson_days=Classroom.DAYS_ODD, created_by=self.staff,
        )

    def _student(self, email, classroom):
        user = _u(email)
        ClassroomMembership.objects.create(
            classroom=classroom, user=user, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        return user

    def _earn(self, student, classroom, xp, key, *, when=None):
        award = PointAward.objects.create(
            student=student, season=current_season(), event="MANUAL",
            points=xp, xp=xp, classroom=classroom, idempotency_key=key,
        )
        if when is not None:
            # `awarded_at` is auto_now_add, so backdating needs a second write.
            PointAward.objects.filter(pk=award.pk).update(awarded_at=when)
        return award

    def _board(self, viewer, **params):
        return leaderboard.board(leaderboard.BoardQuery.from_params(params), viewer)


class BranchDerivationTests(OrgFixture):
    """A student's branch comes from their classroom, and is never stored on them."""

    def test_a_students_branch_is_their_classrooms_branch(self):
        self.assertEqual(branch_for_student(self.ann), self.north)
        self.assertEqual(branch_for_student(self.cal), self.south)

    def test_a_student_in_no_classroom_has_no_branch(self):
        """None is a real answer. Callers must render it as "no branch", never as branch zero."""
        self.assertIsNone(branch_for_student(_u("lb_nobody@t.com")))

    def test_a_classroom_with_no_branch_gives_its_students_none(self):
        unassigned = Classroom.objects.create(
            name="Unassigned", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.staff,
        )
        student = self._student("lb_unassigned@t.com", unassigned)
        self.assertIsNone(branch_for_student(student))

    def test_the_most_recently_joined_classroom_wins(self):
        """The documented tie-break for a student enrolled at two branches — and the reason
        a transfer needs nobody to remember to edit anything."""
        ClassroomMembership.objects.create(
            classroom=self.math_south, user=self.ann, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.assertEqual(branch_for_student(self.ann), self.south)

    def test_a_removed_membership_does_not_decide_a_branch(self):
        membership = ClassroomMembership.objects.create(
            classroom=self.math_south, user=self.ann, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_REMOVED,
        )
        self.assertEqual(membership.status, ClassroomMembership.STATUS_REMOVED)
        self.assertEqual(branch_for_student(self.ann), self.north)

    def test_the_cohort_reader_agrees_with_the_single_reader(self):
        """They must never disagree: a board that grouped a student differently from the way
        their own profile names their branch would be unarguable-with."""
        ids = [self.ann.pk, self.bob.pk, self.cal.pk]
        cohort = branch_ids_for_students(ids)
        for student in (self.ann, self.bob, self.cal):
            branch = branch_for_student(student)
            self.assertEqual(cohort.get(student.pk), branch.pk if branch else None)

    def test_a_student_with_no_branch_is_absent_rather_than_mapped_to_none(self):
        nobody = _u("lb_absent@t.com")
        self.assertNotIn(nobody.pk, branch_ids_for_students([nobody.pk]))


class ScopeTests(OrgFixture):
    def test_global_ranks_the_whole_school(self):
        rows, meta = self._board(self.ann, scope="GLOBAL")

        self.assertEqual([r["student_id"] for r in rows], [self.ann.pk, self.cal.pk, self.bob.pk])
        self.assertEqual([r["rank"] for r in rows], [1, 2, 3])
        self.assertEqual(meta["scope"], "GLOBAL")

    def test_my_branch_resolves_from_the_viewer(self):
        rows, meta = self._board(self.ann, scope="BRANCH")

        self.assertEqual({r["student_id"] for r in rows}, {self.ann.pk, self.bob.pk})
        self.assertEqual(meta["branch_id"], self.north.pk)

    def test_my_group_resolves_from_the_viewer(self):
        rows, meta = self._board(self.cal, scope="GROUP")

        self.assertEqual({r["student_id"] for r in rows}, {self.cal.pk})
        self.assertEqual(meta["classroom_id"], self.math_south.pk)

    def test_a_viewer_with_no_branch_gets_an_empty_branch_board_not_the_global_one(self):
        """The failure this is written against: falling back to "everyone" under a tab
        labelled "My Branch"."""
        stranger = _u("lb_stranger@t.com")

        rows, meta = self._board(stranger, scope="BRANCH")

        self.assertEqual(rows, [])
        self.assertIsNone(meta["branch_id"])
        self.assertIn("branch isn't set", meta["scope_note"])

    def test_a_viewer_with_no_group_gets_an_empty_group_board(self):
        stranger = _u("lb_groupless@t.com")

        rows, meta = self._board(stranger, scope="GROUP")

        self.assertEqual(rows, [])
        self.assertIn("not in a group", meta["scope_note"])

    def test_another_branch_can_be_browsed_from_the_global_scope(self):
        rows, _ = self._board(self.ann, scope="GLOBAL", branch=self.south.pk)
        self.assertEqual({r["student_id"] for r in rows}, {self.cal.pk})


class FilterTests(OrgFixture):
    def test_subject_narrows_the_board(self):
        rows, _ = self._board(self.ann, scope="GLOBAL", subject="MATH")
        self.assertEqual({r["student_id"] for r in rows}, {self.cal.pk})

    def test_level_narrows_the_board(self):
        junior = self._classroom("Eng Junior", self.north, Classroom.SUBJECT_ENGLISH, level="junior")
        dee = self._student("lb_dee@t.com", junior)
        self._earn(dee, junior, 5, "d1")

        rows, _ = self._board(self.ann, scope="GLOBAL", level="junior")

        self.assertEqual({r["student_id"] for r in rows}, {dee.pk})

    def test_the_time_window_filters_on_when_it_was_earned(self):
        old = timezone.now() - timedelta(days=45)
        self._earn(self.bob, self.eng_north, 900, "b-old", when=old)

        all_time, _ = self._board(self.ann, scope="GLOBAL", window="ALL")
        this_month, _ = self._board(self.ann, scope="GLOBAL", window="MONTH")

        self.assertEqual(all_time[0]["student_id"], self.bob.pk)      # 950 all time
        self.assertEqual(this_month[0]["student_id"], self.ann.pk)    # 100 this month
        self.assertEqual(
            next(r["xp"] for r in this_month if r["student_id"] == self.bob.pk), 50
        )

    def test_an_xp_less_award_never_appears(self):
        """A late arrival earns points and no XP. This board is XP."""
        late = _u("lb_late@t.com")
        ClassroomMembership.objects.create(
            classroom=self.eng_north, user=late, role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        PointAward.objects.create(
            student=late, season=current_season(), event="ATTENDANCE_LATE",
            points=3, xp=0, classroom=self.eng_north, idempotency_key="late-1",
        )

        rows, _ = self._board(self.ann, scope="GLOBAL")

        self.assertNotIn(late.pk, {r["student_id"] for r in rows})

    def test_a_classroom_less_award_counts_globally_and_vanishes_under_a_filter(self):
        """A midterm belongs to the school, not to one class — so it has no branch and no
        subject. This is the documented asymmetry, pinned so nobody 'fixes' it into a board
        that claims XP was earned somewhere it was not."""
        PointAward.objects.create(
            student=self.bob, season=current_season(), event="MIDTERM_PASS",
            points=500, xp=500, classroom=None, idempotency_key="mid-bob",
        )

        globally, _ = self._board(self.ann, scope="GLOBAL")
        by_branch, _ = self._board(self.ann, scope="BRANCH")

        self.assertEqual(globally[0]["student_id"], self.bob.pk)                       # 550
        self.assertEqual(next(r["xp"] for r in by_branch if r["student_id"] == self.bob.pk), 50)

    def test_a_filtered_board_says_what_it_leaves_out(self):
        _, meta = self._board(self.ann, scope="BRANCH")
        self.assertIn("Midterm XP isn't counted", meta["scope_note"])

    def test_an_unfiltered_board_does_not(self):
        _, meta = self._board(self.ann, scope="GLOBAL")
        self.assertIn("whole school", meta["scope_note"])


class QueryParsingTests(TestCase):
    def test_nonsense_falls_back_to_the_safe_default(self):
        """A stale bookmark must not 400 a browsing surface."""
        q = leaderboard.BoardQuery.from_params(
            {"scope": "PLANET", "window": "FORTNIGHT", "limit": "abc", "branch": "x"}
        )

        self.assertEqual(q.scope, leaderboard.SCOPE_GLOBAL)
        self.assertEqual(q.window, leaderboard.WINDOW_ALL)
        self.assertEqual(q.limit, leaderboard.DEFAULT_LIMIT)
        self.assertIsNone(q.branch_id)

    def test_the_limit_is_capped(self):
        self.assertEqual(
            leaderboard.BoardQuery.from_params({"limit": "100000"}).limit, leaderboard.MAX_LIMIT
        )

    def test_scope_and_window_are_case_insensitive(self):
        q = leaderboard.BoardQuery.from_params({"scope": "branch", "window": "month"})
        self.assertEqual(q.scope, leaderboard.SCOPE_BRANCH)
        self.assertEqual(q.window, leaderboard.WINDOW_MONTH)

    def test_a_retired_window_falls_back_instead_of_erroring(self):
        """"This week" and "this term" were real chips, and a deploy does not reload open tabs.

        Withdrawing a chip removes it from the filter bar the *next* page load is served;
        a student who already had the board open keeps their old choice in component state
        and goes on asking for `window=WEEK` until they reload. They must land on the
        all-time board — the same forgiveness a typo gets, for the same reason — and must
        never be shown an error for a button this product used to offer them.
        """
        for retired in ("WEEK", "TERM", "week", "term"):
            with self.subTest(window=retired):
                q = leaderboard.BoardQuery.from_params({"window": retired})
                self.assertEqual(q.window, leaderboard.WINDOW_ALL)


class OwnRankTests(OrgFixture):
    def test_a_student_outside_the_visible_top_still_learns_their_rank(self):
        for i in range(5):
            other = self._student(f"lb_bulk{i}@t.com", self.eng_north)
            self._earn(other, self.eng_north, 1000 + i, f"bulk-{i}")

        mine = leaderboard.rank_of(
            self.bob, leaderboard.BoardQuery.from_params({"scope": "GLOBAL", "limit": "2"}),
        )

        self.assertEqual(mine["xp"], 50)
        # 5 bulk (1000–1004) + ann (100) + cal (75) are ahead of bob's 50.
        self.assertEqual(mine["rank"], 8)

    def test_a_student_who_has_earned_nothing_has_no_rank(self):
        nobody = _u("lb_zero@t.com")
        self.assertIsNone(
            leaderboard.rank_of(nobody, leaderboard.BoardQuery.from_params({}))
        )


class LeaderboardApiTests(OrgFixture):
    def setUp(self):
        super().setUp()
        self.client = APIClient()

    def test_the_board_requires_a_login(self):
        self.assertEqual(self.client.get("/api/rewards/leaderboard/").status_code, 401)

    def test_rows_carry_the_name_branch_and_region(self):
        self.client.force_authenticate(self.ann)

        body = self.client.get("/api/rewards/leaderboard/?scope=GLOBAL").json()

        top = body["rows"][0]
        self.assertEqual(top["student_id"], self.ann.pk)
        self.assertEqual(top["branch"], "Chilonzor")
        self.assertEqual(top["region"], "Tashkent")
        self.assertTrue(top["is_me"])

    def test_my_row_is_present_even_when_below_the_limit(self):
        self.client.force_authenticate(self.bob)

        body = self.client.get("/api/rewards/leaderboard/?scope=GLOBAL&limit=1").json()

        self.assertEqual(len(body["rows"]), 1)
        self.assertEqual(body["my"]["student_id"], self.bob.pk)
        self.assertEqual(body["my"]["rank"], 3)

    def test_a_bookmarked_retired_window_still_serves_a_board(self):
        """The end-to-end half of the fallback: a 200 with the all-time board, not a 400.

        Parsing is forgiving (see `QueryParsingTests`), but what a stale tab actually sends is
        an HTTP request, so this pins the status code as well as the value.
        """
        self.client.force_authenticate(self.ann)

        response = self.client.get("/api/rewards/leaderboard/?window=WEEK")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["window"], leaderboard.WINDOW_ALL)

    def test_the_filters_endpoint_offers_exactly_the_two_surviving_windows(self):
        """The chips are server-owned — this list *is* the filter bar the student sees."""
        self.client.force_authenticate(self.ann)

        body = self.client.get("/api/rewards/leaderboard/filters/").json()

        self.assertEqual(
            [w["value"] for w in body["windows"]],
            [leaderboard.WINDOW_ALL, leaderboard.WINDOW_MONTH],
        )

    def test_the_filters_endpoint_names_the_viewers_own_branch(self):
        self.client.force_authenticate(self.cal)

        body = self.client.get("/api/rewards/leaderboard/filters/").json()

        self.assertEqual(body["my_branch"]["name"], "Registon")
        self.assertEqual({b["name"] for b in body["branches"]}, {"Chilonzor", "Registon"})
        self.assertEqual({r["name"] for r in body["regions"]}, {"Tashkent", "Samarkand"})

    def test_a_student_with_no_branch_gets_a_null_my_branch(self):
        self.client.force_authenticate(_u("lb_nb@t.com"))
        self.assertIsNone(self.client.get("/api/rewards/leaderboard/filters/").json()["my_branch"])
