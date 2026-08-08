"""Integration tests for the ranking service orchestration (DB-backed).

Validates that recompute_classroom builds inputs correctly, ranks/percentiles, persists
RankingSnapshot rows, and tracks rank_change across periods. See BUSINESS-ARCHITECTURE §3.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import PracticeTest, TestAttempt

from classes.models import Assignment, Classroom, ClassroomMembership, Submission, SubmissionReview
from classes.models_ranking import RankingSnapshot
from classes.ranking import service

User = get_user_model()


def _student(email):
    return User.objects.create_user(email, "secret123")


class SATServiceTests(TestCase):
    def setUp(self):
        self.owner = _student("w_owner@t.com")
        # `level` matters now: only middle/senior classes rank on SAT.
        self.classroom = Classroom.objects.create(
            name="Math A", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.section = PracticeTest.objects.create(
            subject="MATH", label="M", title="Math sec", collection_name="PP A"
        )
        # ...and the paper has to have been GIVEN to this class; an attempt on a pastpaper
        # nobody assigned is a student's own practice and does not rank.
        Assignment.objects.create(
            classroom=self.classroom, title="PP A", category=Assignment.CATEGORY_PAST_PAPER,
            status=Assignment.STATUS_PUBLISHED, practice_test=self.section, created_by=self.owner,
        )
        # three students with distinct Math section scores
        self.s700 = _student("w700@t.com")
        self.s600 = _student("w600@t.com")
        self.s500 = _student("w500@t.com")
        for u in (self.s700, self.s600, self.s500):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
        now = timezone.now()
        for u, score in ((self.s700, 700), (self.s600, 600), (self.s500, 500)):
            TestAttempt.objects.create(
                student=u, practice_test=self.section, score=score,
                is_completed=True, current_state="COMPLETED", completed_at=now,
            )

    def test_ranks_percentiles_and_history(self):
        service.recompute_classroom(self.classroom, kinds=("SAT",), period_key="p1")
        snaps = {s.student_id: s for s in RankingSnapshot.objects.filter(
            classroom=self.classroom, kind=RankingSnapshot.KIND_SAT, period_key="p1")}

        self.assertEqual(len(snaps), 3)
        self.assertEqual(snaps[self.s700.id].rank, 1)
        self.assertEqual(snaps[self.s600.id].rank, 2)
        self.assertEqual(snaps[self.s500.id].rank, 3)
        # The score IS the pastpaper score — no weighting, no decay.
        self.assertEqual(float(snaps[self.s700.id].score), 700.0)
        # percentile: top→100, mid→50, low→0
        self.assertAlmostEqual(float(snaps[self.s700.id].percentile), 100.0, delta=0.1)
        self.assertAlmostEqual(float(snaps[self.s600.id].percentile), 50.0, delta=0.1)
        self.assertAlmostEqual(float(snaps[self.s500.id].percentile), 0.0, delta=0.1)
        # Components point at the paper behind the number, so a teacher can check it.
        comp = snaps[self.s700.id].components
        self.assertEqual(comp["practice_test_id"], self.section.id)
        for key in ("attempt_id", "finished_at"):
            self.assertIn(key, comp)

    def test_previous_rank_linked_across_periods(self):
        # Two recomputes with stable data → previous_rank tracks the prior period, change 0.
        service.recompute_classroom(self.classroom, kinds=("SAT",), period_key="p1")
        service.recompute_classroom(self.classroom, kinds=("SAT",), period_key="p2")
        s = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_SAT, period_key="p2", student=self.s700)
        self.assertEqual(s.rank, 1)
        self.assertEqual(s.previous_rank, 1)
        self.assertEqual(s.components.get("rank_change"), 0)


class AcademicServiceTests(TestCase):
    """Academic is a projection of the reward ledger — the points earned in THIS classroom.

    It was the sum of raw assessment ``score_points`` until the rewards cutover. Nothing about
    a point is decided here now: attendance, homework bundles, support sessions and midterms
    write ``PointAward``, and this board only reads. What is no longer an input: assessment
    scores directly, teacher-graded submissions, the classroom's opening date.
    """

    def setUp(self):
        self.owner = _student("a_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="Eng A", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.other_classroom = Classroom.objects.create(
            name="Eng B", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )

        self.full = _student("a_full@t.com")
        self.partial = _student("a_partial@t.com")
        for u in (self.full, self.partial):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
        self._award(self.full, 15, "hw-full-1")
        self._award(self.full, 5, "att-full-1")   # 20 total
        self._award(self.partial, 10, "hw-part-1")

    def _award(self, student, points, key, *, classroom=-1):
        from rewards.models import PointAward
        from rewards.services import current_season

        return PointAward.objects.create(
            student=student,
            season=current_season(),
            event="MANUAL",
            points=points,
            classroom=self.classroom if classroom == -1 else classroom,
            idempotency_key=key,
        )

    def test_points_are_summed_and_ranked(self):
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        snaps = {s.student_id: s for s in RankingSnapshot.objects.filter(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC, period_key="p1")}

        full = snaps[self.full.id]
        self.assertEqual(float(full.score), 20.0)   # 15 + 5
        self.assertEqual(full.components["awards"], 2)
        self.assertEqual(full.components["source"], "rewards")
        self.assertEqual(full.rank, 1)

        partial = snaps[self.partial.id]
        self.assertEqual(float(partial.score), 10.0)
        self.assertEqual(partial.components["awards"], 1)
        self.assertEqual(partial.rank, 2)

    def test_the_board_is_scoped_to_this_classroom(self):
        # Points earned elsewhere belong on the student's own Points page, not on this board.
        self._award(self.partial, 500, "hw-part-elsewhere", classroom=self.other_classroom)
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        partial = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=self.partial)
        self.assertEqual(float(partial.score), 10.0)
        self.assertEqual(partial.rank, 2)

    def test_a_classroom_less_award_counts_for_no_board(self):
        # Surveys and midterms carry no classroom. The school's stated default is that they
        # raise the global balance and no class standing — pinned so a later "helpful" change
        # to `board_totals_for` cannot quietly move points onto every board a student is in.
        self._award(self.partial, 40, "survey-part", classroom=None)
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        partial = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=self.partial)
        self.assertEqual(float(partial.score), 10.0)

    def test_a_revoked_award_stops_counting(self):
        # `revoke` zeroes the row rather than deleting it, so the board must sum, not count.
        award = self._award(self.partial, 30, "hw-part-2")
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        first = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=self.partial)
        self.assertEqual(float(first.score), 40.0)
        self.assertEqual(first.rank, 1)

        award.points = 0
        award.save(update_fields=["points"])
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        after = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=self.partial)
        self.assertEqual(float(after.score), 10.0)
        self.assertEqual(after.components["awards"], 1)  # the zeroed row is not an earning

    def test_a_student_who_has_earned_nothing_is_still_on_the_board(self):
        newcomer = _student("a_new@t.com")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=newcomer, role=ClassroomMembership.ROLE_STUDENT
        )
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        row = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=newcomer)
        self.assertEqual(float(row.score), 0.0)
        self.assertEqual(row.rank, 3)

    def test_the_season_never_reaches_the_wire(self):
        # It stays as the reset mechanism but is invisible product-wide, and `components` is
        # served to staff and to the student themselves.
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        row = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC,
            period_key="p1", student=self.full)
        self.assertNotIn("season", " ".join(row.components.keys()).lower())

    def test_rank_change_on_improvement(self):
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p1")
        self._award(self.partial, 15, "hw-part-2")  # 10 + 15 = 25, overtakes 20
        service.recompute_classroom(self.classroom, kinds=("ACADEMIC",), period_key="p2")
        partial = RankingSnapshot.objects.get(
            classroom=self.classroom, kind=RankingSnapshot.KIND_ACADEMIC, period_key="p2", student=self.partial)
        self.assertEqual(partial.rank, 1)
        self.assertEqual(partial.previous_rank, 2)
        self.assertEqual(partial.components.get("rank_change"), 1)  # 2 → 1
        self.assertEqual(partial.trend, RankingSnapshot.TREND_IMPROVING)


class RankingsApiTests(TestCase):
    def setUp(self):
        from classes.models_ranking import ClassroomRankingConfig

        self.owner = _student("api_owner@t.com")
        self.classroom = Classroom.objects.create(
            name="Math API", subject=Classroom.SUBJECT_MATH, level="middle",
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.section = PracticeTest.objects.create(
            subject="MATH", label="M", title="sec", collection_name="PP"
        )
        Assignment.objects.create(
            classroom=self.classroom, title="PP", category=Assignment.CATEGORY_PAST_PAPER,
            status=Assignment.STATUS_PUBLISHED, practice_test=self.section, created_by=self.owner,
        )
        self.top = _student("api_top@t.com")
        self.low = _student("api_low@t.com")
        for u, sc in ((self.top, 760), (self.low, 540)):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
            TestAttempt.objects.create(
                student=u, practice_test=self.section, score=sc,
                is_completed=True, current_state="COMPLETED", completed_at=timezone.now(),
            )
        service.recompute_classroom(self.classroom, kinds=("SAT",), period_key="p1")
        self.cfg_model = ClassroomRankingConfig
        self.client = APIClient()

    def _url(self, kind="SAT"):
        return f"/api/classes/{self.classroom.id}/rankings/{kind}/"

    def test_member_only(self):
        outsider = _student("api_out@t.com")
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self._url()).status_code, 403)

    def test_full_leaderboard_default(self):
        self.client.force_authenticate(self.low)
        r = self.client.get(self._url())
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body["rows"]), 2)
        names = [row["name"] for row in body["rows"]]
        self.assertTrue(any("api_top" in n for n in names))  # FULL → names visible
        self.assertIsNotNone(body["my"])
        self.assertTrue(body["my"]["is_me"])

    def test_avatar_is_returned_for_students_who_have_one(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.top.profile_image = SimpleUploadedFile("t.jpg", b"\xff\xd8\xff", content_type="image/jpeg")
        self.top.save(update_fields=["profile_image"])
        self.client.force_authenticate(self.low)

        rows = self.client.get(self._url()).json()["rows"]
        top_row = next(r for r in rows if "api_top" in r["name"])
        self.assertTrue(top_row["profile_image_url"])
        self.assertTrue(top_row["profile_image_url"].startswith("http"))  # absolute, for the subdomains
        # A student with no photo gets null, and the UI falls back to initials.
        self.assertIsNone(next(r for r in rows if r["is_me"])["profile_image_url"])

    def test_anonymous_mode_hides_the_photo_too(self):
        """A face identifies a student more directly than a name does — if the avatar survived
        anonymisation the board would not be anonymous at all."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.top.profile_image = SimpleUploadedFile("t2.jpg", b"\xff\xd8\xff", content_type="image/jpeg")
        self.top.save(update_fields=["profile_image"])
        cfg, _ = self.cfg_model.objects.get_or_create(classroom=self.classroom)
        cfg.leaderboard_mode = self.cfg_model.MODE_ANONYMOUS
        cfg.save()
        self.client.force_authenticate(self.low)

        rows = self.client.get(self._url()).json()["rows"]
        for row in rows:
            if not row["is_me"]:
                self.assertTrue(row["name"].startswith("Student #"))
                self.assertIsNone(row["profile_image_url"], "anonymous board leaked a photo")

    def test_staff_still_see_photos_on_an_anonymous_board(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        self.top.profile_image = SimpleUploadedFile("t3.jpg", b"\xff\xd8\xff", content_type="image/jpeg")
        self.top.save(update_fields=["profile_image"])
        cfg, _ = self.cfg_model.objects.get_or_create(classroom=self.classroom)
        cfg.leaderboard_mode = self.cfg_model.MODE_ANONYMOUS
        cfg.save()
        self.client.force_authenticate(self.owner)  # teacher

        rows = self.client.get(self._url()).json()["rows"]
        self.assertTrue(next(r for r in rows if "api_top" in r["name"])["profile_image_url"])

    def test_anonymous_hides_other_names(self):
        cfg, _ = self.cfg_model.objects.get_or_create(classroom=self.classroom)
        cfg.leaderboard_mode = self.cfg_model.MODE_ANONYMOUS
        cfg.save()
        self.client.force_authenticate(self.low)
        rows = self.client.get(self._url()).json()["rows"]
        others = [row for row in rows if not row["is_me"]]
        self.assertTrue(all(row["name"].startswith("Student #") for row in others))

    def test_hidden_mode_only_own_row(self):
        cfg, _ = self.cfg_model.objects.get_or_create(classroom=self.classroom)
        cfg.leaderboard_mode = self.cfg_model.MODE_HIDDEN
        cfg.save()
        self.client.force_authenticate(self.low)
        rows = self.client.get(self._url()).json()["rows"]
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["is_me"])

    def test_hide_scores_for_students_not_self(self):
        cfg, _ = self.cfg_model.objects.get_or_create(classroom=self.classroom)
        cfg.hide_score_values = True
        cfg.save()
        self.client.force_authenticate(self.low)
        rows = self.client.get(self._url()).json()["rows"]
        for row in rows:
            if row["is_me"]:
                self.assertIsNotNone(row["score"])   # own score always visible
            else:
                self.assertIsNone(row["score"])

    def test_recompute_requires_manager(self):
        url = f"/api/classes/{self.classroom.id}/rankings/recompute/"
        self.client.force_authenticate(self.low)
        self.assertEqual(self.client.post(url).status_code, 403)
        self.client.force_authenticate(self.owner)
        r = self.client.post(url, {"kinds": ["SAT"]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["counts"]["SAT"], 2)

    def test_config_update_requires_manager(self):
        url = f"/api/classes/{self.classroom.id}/rankings/config/"
        self.client.force_authenticate(self.low)
        self.assertEqual(self.client.patch(url, {"leaderboard_mode": "HIDDEN"}, format="json").status_code, 403)
        self.client.force_authenticate(self.owner)
        r = self.client.patch(url, {"leaderboard_mode": "ANONYMOUS", "hide_score_values": True}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["leaderboard_mode"], "ANONYMOUS")
        self.assertTrue(r.json()["hide_score_values"])
        # invalid mode rejected
        self.assertEqual(self.client.patch(url, {"leaderboard_mode": "BOGUS"}, format="json").status_code, 400)

    def test_history_self_and_privacy(self):
        service.recompute_classroom(self.classroom, kinds=("SAT",), period_key="p2")  # 2nd period
        self.client.force_authenticate(self.top)
        r = self.client.get(f"/api/classes/{self.classroom.id}/rankings/sat/history/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["history"]), 2)  # p1 (setUp) + p2
        # a student cannot read another student's history
        r = self.client.get(f"/api/classes/{self.classroom.id}/rankings/sat/history/?student={self.low.id}")
        self.assertEqual(r.status_code, 403)
        # staff can
        self.client.force_authenticate(self.owner)
        r = self.client.get(f"/api/classes/{self.classroom.id}/rankings/sat/history/?student={self.low.id}")
        self.assertEqual(r.status_code, 200)
