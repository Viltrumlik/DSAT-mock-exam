"""Sitting a midterm again after repeating the month.

A midterm is once-only, and that is right: nobody should be able to re-run a paper until the
score suits them. But a student who FAILED month 1, REPEATED month 1, and now has to sit
month 1's midterm again was told "You have already completed this midterm" with no way
around it — not by a teacher, not by an admin, not at all.

This is NOT the RETAKE midterm (a separate paper, midterm_type=RETAKE). It is the same paper,
sat again, on somebody's authority.

    python manage.py test midterms.tests_resit --settings=config.settings_test_nomigrations
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from access.resources import RT_MIDTERM_V2
from midterms.access import (
    can_start_midterm,
    latest_completed_attempt,
    open_resit,
    winning_grant,
)
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome, MidtermResit
from midterms.tests_api import make_published_midterm

User = get_user_model()


def _grant(student, midterm):
    return ResourceAccessGrant.objects.create(
        user=student, resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        scope=ResourceAccessGrant.SCOPE_RESOURCE, source=ResourceAccessGrant.SOURCE_MANUAL,
        status=ResourceAccessGrant.STATUS_ACTIVE,
    )


def _completed(midterm, student, score, *, when=None):
    """A finished sitting, with the verdict recorded exactly as complete() would."""
    att = MidtermAttempt.objects.create(
        midterm=midterm, student=student, is_completed=True,
        current_state=MidtermAttempt.STATE_COMPLETED, score=score,
        completed_at=when or timezone.now(),
    )
    MidtermOutcome.record_for(att)
    return att


class ResitGateTests(TestCase):
    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.student = User.objects.create(username="s", email="s@x.io")
        _grant(self.student, self.midterm)
        self.failed = _completed(self.midterm, self.student, 40)

    def test_without_a_resit_the_midterm_stays_once_only(self):
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertFalse(ok)
        self.assertEqual(reason, "midterm_completed")

    def test_an_open_resit_opens_the_door(self):
        MidtermResit.objects.create(midterm=self.midterm, student=self.student, reason="repeated month 1")
        ok, _reason = can_start_midterm(self.student, self.midterm)
        self.assertTrue(ok)

    def test_a_spent_resit_does_not(self):
        MidtermResit.objects.create(
            midterm=self.midterm, student=self.student, consumed_at=timezone.now()
        )
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertFalse(ok)
        self.assertEqual(reason, "midterm_completed")

    def test_a_resit_for_someone_else_does_not_let_this_student_in(self):
        other = User.objects.create(username="o", email="o@x.io")
        MidtermResit.objects.create(midterm=self.midterm, student=other)
        ok, _r = can_start_midterm(self.student, self.midterm)
        self.assertFalse(ok)

    def test_a_resit_for_another_midterm_does_not_leak(self):
        other_midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        MidtermResit.objects.create(midterm=other_midterm, student=self.student)
        ok, _r = can_start_midterm(self.student, self.midterm)
        self.assertFalse(ok)

    def test_only_one_open_grant_can_exist_at_a_time(self):
        from django.db import IntegrityError

        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        with self.assertRaises(IntegrityError):
            MidtermResit.objects.create(midterm=self.midterm, student=self.student)


class ResitConsumesOnStartTests(TestCase):
    """The grant is spent when the paper is opened — not when it was issued."""

    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.student = User.objects.create(username="s", email="s@x.io")
        _grant(self.student, self.midterm)
        _completed(self.midterm, self.student, 40)
        self.c = APIClient()
        self.c.force_authenticate(self.student)

    def test_starting_again_creates_a_second_attempt_and_spends_the_grant(self):
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)

        r = self.c.post("/api/midterms/attempts/", {"midterm": self.midterm.id}, format="json")

        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(MidtermAttempt.objects.filter(midterm=self.midterm, student=self.student).count(), 2)
        resit = MidtermResit.objects.get()
        self.assertIsNotNone(resit.consumed_at)
        self.assertEqual(resit.attempt_id, r.json()["id"])
        self.assertIsNone(open_resit(self.student, self.midterm))

    def test_one_grant_buys_exactly_one_re_sitting(self):
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        first = self.c.post("/api/midterms/attempts/", {"midterm": self.midterm.id}, format="json")
        self.assertEqual(first.status_code, 201)
        # Finish it, then try to go round again on the same grant.
        MidtermAttempt.objects.filter(pk=first.json()["id"]).update(
            is_completed=True, current_state=MidtermAttempt.STATE_COMPLETED,
            score=55, completed_at=timezone.now(),
        )

        again = self.c.post("/api/midterms/attempts/", {"midterm": self.midterm.id}, format="json")

        self.assertEqual(again.status_code, 403, again.content)
        self.assertEqual(again.json()["error"], "midterm_completed")

    def test_an_ordinary_first_sitting_is_unaffected(self):
        """consume_resit runs on every create; with no grant it must be a silent no-op."""
        fresh = User.objects.create(username="f", email="f@x.io")
        _grant(fresh, self.midterm)
        c = APIClient()
        c.force_authenticate(fresh)
        r = c.post("/api/midterms/attempts/", {"midterm": self.midterm.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(MidtermResit.objects.count(), 0)


class NewResultSupersedesTests(TestCase):
    """The student repeated the month — the old mark is history, not their standing."""

    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.student = User.objects.create(username="s", email="s@x.io")
        _grant(self.student, self.midterm)
        self.old = _completed(
            self.midterm, self.student, 40, when=timezone.now() - timezone.timedelta(days=30)
        )

    def test_the_verdict_follows_the_new_sitting(self):
        self.assertFalse(MidtermOutcome.objects.get(midterm=self.midterm, student=self.student).passed)

        _completed(self.midterm, self.student, 78)

        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertTrue(outcome.passed, "the repeated month's pass must supersede the old fail")
        self.assertEqual(outcome.score, 78)

    def test_there_is_still_exactly_one_verdict(self):
        _completed(self.midterm, self.student, 78)
        self.assertEqual(
            MidtermOutcome.objects.filter(midterm=self.midterm, student=self.student).count(), 1
        )

    def test_the_old_attempt_is_kept_as_history(self):
        _completed(self.midterm, self.student, 78)
        self.assertTrue(MidtermAttempt.objects.filter(pk=self.old.pk).exists())
        self.assertEqual(
            MidtermAttempt.objects.filter(midterm=self.midterm, student=self.student).count(), 2
        )

    def test_latest_completed_attempt_picks_the_newest(self):
        new = _completed(self.midterm, self.student, 78)
        self.assertEqual(latest_completed_attempt(self.student, self.midterm).pk, new.pk)

    def test_latest_is_deterministic_when_two_finish_at_the_same_instant(self):
        stamp = timezone.now()
        MidtermAttempt.objects.filter(pk=self.old.pk).update(completed_at=stamp)
        newer = _completed(self.midterm, self.student, 78, when=stamp)
        self.assertEqual(latest_completed_attempt(self.student, self.midterm).pk, newer.pk)


class SupersedesEverywhereTests(TestCase):
    """"The new result replaces the old" has to be true on every surface, not just the verdict.

    The three readers below already pick the newest attempt — each was written "last write
    wins" over an ascending order_by. That is load-bearing now rather than incidental, so it
    is pinned here: a future refactor that swaps in a plain .first() would silently start
    showing a repeated student their old failing mark.
    """

    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.student = User.objects.create(username="s", email="s@x.io")
        _grant(self.student, self.midterm)
        _completed(self.midterm, self.student, 40, when=timezone.now() - timezone.timedelta(days=30))
        self.new = _completed(self.midterm, self.student, 78)

    def test_the_admin_report_reads_the_new_sitting(self):
        from midterms.admin_report import _attempts_by_student

        picked = _attempts_by_student(self.midterm.id, [self.student.id])[self.student.id]
        self.assertEqual(picked.pk, self.new.pk)
        self.assertEqual(picked.score, 78)

    def test_the_certificate_cohort_reads_the_new_sitting(self):
        from midterms.certificate_service import _latest_completed_attempts

        picked = _latest_completed_attempts(self.midterm, [self.student.id])[self.student.id]
        self.assertEqual(picked.pk, self.new.pk)

    def test_the_students_own_list_shows_the_new_score(self):
        c = APIClient()
        c.force_authenticate(self.student)
        rows = c.get("/api/midterms/mine/").json()["results"]
        row = next(r for r in rows if r["midterm_id"] == self.midterm.id)
        self.assertEqual(row["attempt_id"], self.new.pk)

    def test_an_in_flight_resit_does_not_erase_the_old_mark_yet(self):
        """Mid-re-sitting, the report must still show what they actually last scored."""
        from midterms.admin_report import _attempts_by_student

        MidtermAttempt.objects.create(
            midterm=self.midterm, student=self.student,
            current_state=MidtermAttempt.STATE_NOT_STARTED, is_completed=False,
        )
        picked = _attempts_by_student(self.midterm.id, [self.student.id])[self.student.id]
        self.assertEqual(picked.pk, self.new.pk)
        self.assertTrue(picked.is_completed)


class VerdictNeverWalksBackwardsTests(TestCase):
    """record_for must refuse a SUPERSEDED sitting, whoever hands it over.

    The whole "the re-sit replaces the old mark" design rests on this one row. Before, it was
    held only by callers happening to arrive in the right order — anything re-scoring the old
    paper would silently flip the student back to failed.
    """

    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.student = User.objects.create(username="s", email="s@x.io")
        now = timezone.now()
        self.old = _completed(self.midterm, self.student, 40, when=now - timezone.timedelta(days=30))
        self.new = _completed(self.midterm, self.student, 82, when=now)

    def test_re_recording_the_old_sitting_is_refused(self):
        MidtermOutcome.record_for(self.old)

        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.attempt_id, self.new.pk, "the superseded sitting won")
        self.assertEqual(outcome.score, 82)
        self.assertTrue(outcome.passed)

    def test_re_recording_the_current_sitting_still_refreshes_it(self):
        MidtermAttempt.objects.filter(pk=self.new.pk).update(score=91)
        self.new.refresh_from_db()

        MidtermOutcome.record_for(self.new)

        self.assertEqual(
            MidtermOutcome.objects.get(midterm=self.midterm, student=self.student).score, 91
        )

    def test_a_newer_sitting_still_supersedes(self):
        newest = _completed(self.midterm, self.student, 95)
        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.attempt_id, newest.pk)
        self.assertEqual(outcome.score, 95)

    def test_a_first_verdict_is_never_blocked(self):
        fresh = User.objects.create(username="f", email="f@x.io")
        att = _completed(self.midterm, fresh, 70)
        self.assertEqual(
            MidtermOutcome.objects.get(midterm=self.midterm, student=fresh).attempt_id, att.pk
        )


class BackfillPicksTheLatestSittingTests(TestCase):
    """backfill_midterm_outcomes walked attempts oldest-first and skipped a pair it had
    already written — so on a re-sat midterm it would have recorded the OLD failing verdict
    and then passed over the new one."""

    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.student = User.objects.create(username="s", email="s@x.io")

    def _bare_attempt(self, score, when):
        """A finished sitting with NO outcome row — what the backfill exists to repair."""
        return MidtermAttempt.objects.create(
            midterm=self.midterm, student=self.student, is_completed=True,
            current_state=MidtermAttempt.STATE_COMPLETED, score=score, completed_at=when,
        )

    def test_it_records_the_newest_sitting(self):
        from django.core.management import call_command

        now = timezone.now()
        self._bare_attempt(40, now - timezone.timedelta(days=30))
        newer = self._bare_attempt(82, now)
        self.assertEqual(MidtermOutcome.objects.count(), 0)

        call_command("backfill_midterm_outcomes", "--skip-questions")

        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.score, 82)
        self.assertTrue(outcome.passed)
        self.assertEqual(outcome.attempt_id, newer.pk)

    def test_it_still_writes_exactly_one_verdict(self):
        from django.core.management import call_command

        now = timezone.now()
        self._bare_attempt(40, now - timezone.timedelta(days=30))
        self._bare_attempt(82, now)
        call_command("backfill_midterm_outcomes", "--skip-questions")
        self.assertEqual(
            MidtermOutcome.objects.filter(midterm=self.midterm, student=self.student).count(), 1
        )

    def test_a_single_sitting_is_unaffected(self):
        from django.core.management import call_command

        only = self._bare_attempt(55, timezone.now())
        call_command("backfill_midterm_outcomes", "--skip-questions")
        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.attempt_id, only.pk)

    def test_rejudge_does_not_walk_back_down_the_history(self):
        """--rejudge bypasses the exists guard, so without a per-run guard the newest-first
        ordering would leave the OLDEST sitting as the verdict — worse than before."""
        from django.core.management import call_command

        now = timezone.now()
        self._bare_attempt(40, now - timezone.timedelta(days=30))
        newer = self._bare_attempt(82, now)

        call_command("backfill_midterm_outcomes", "--skip-questions", "--rejudge")

        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.attempt_id, newer.pk)
        self.assertEqual(outcome.score, 82)

    def test_rejudge_still_refreshes_a_stale_verdict(self):
        """The point of --rejudge: re-apply today's pass mark to an existing verdict."""
        from django.core.management import call_command

        att = self._bare_attempt(65, timezone.now())
        MidtermOutcome.objects.create(
            midterm=self.midterm, student=self.student, attempt=att,
            score=65, pass_mark=90, scoring_scale=Midterm.SCALE_100, passed=False,
        )

        call_command("backfill_midterm_outcomes", "--skip-questions", "--rejudge")

        outcome = MidtermOutcome.objects.get(midterm=self.midterm, student=self.student)
        self.assertEqual(outcome.pass_mark, 60)
        self.assertTrue(outcome.passed)


class PublishWaitsForTheResitTests(TestCase):
    """A student owed a re-sit is not "finished", however many papers they have already handed in.

    Publishing freezes rank + certificate and flips results_released. Doing that while a
    re-sit is outstanding shows the student the mark they are about to replace, and nothing
    recomputes later — certificates are only ever issued by an explicit teacher publish.
    """

    def setUp(self):
        from classes.models import Classroom, ClassroomMembership

        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.midterm.pass_mark = 60
        self.midterm.save(update_fields=["pass_mark"])
        self.teacher = User.objects.create(username="t", email="t@x.io", role="teacher")
        self.room = Classroom.objects.create(
            name="G12", subject="MATH", lesson_days=Classroom.DAYS_ODD, created_by=self.teacher
        )
        self.passed = User.objects.create(username="p", email="p@x.io")
        self.failed = User.objects.create(username="f", email="f@x.io")
        for u in (self.passed, self.failed):
            ClassroomMembership.objects.create(
                classroom=self.room, user=u, role=ClassroomMembership.ROLE_STUDENT
            )
            ResourceAccessGrant.objects.create(
                user=u, classroom=self.room, resource_type=RT_MIDTERM_V2,
                resource_id=self.midterm.id, scope=ResourceAccessGrant.SCOPE_RESOURCE,
                source=ResourceAccessGrant.SOURCE_CLASSROOM,
                status=ResourceAccessGrant.STATUS_ACTIVE,
            )
        _completed(self.midterm, self.passed, 85)
        _completed(self.midterm, self.failed, 40)

    def _still_to_sit(self):
        from midterms.certificate_service import students_still_to_sit

        return students_still_to_sit(self.midterm, {self.passed.id, self.failed.id})

    def test_everyone_finished_means_nobody_outstanding(self):
        self.assertEqual(self._still_to_sit(), set())

    def test_an_unspent_resit_keeps_the_room_open(self):
        MidtermResit.objects.create(midterm=self.midterm, student=self.failed)
        self.assertEqual(self._still_to_sit(), {self.failed.id})

    def test_a_resit_in_progress_keeps_the_room_open(self):
        MidtermResit.objects.create(
            midterm=self.midterm, student=self.failed, consumed_at=timezone.now()
        )
        MidtermAttempt.objects.create(
            midterm=self.midterm, student=self.failed, is_completed=False,
            current_state=MidtermAttempt.STATE_NOT_STARTED,
        )
        self.assertEqual(self._still_to_sit(), {self.failed.id})

    def test_once_the_resit_is_handed_in_the_room_closes(self):
        MidtermResit.objects.create(
            midterm=self.midterm, student=self.failed, consumed_at=timezone.now()
        )
        _completed(self.midterm, self.failed, 74)
        self.assertEqual(self._still_to_sit(), set())

    def test_publishing_is_refused_while_a_resit_is_outstanding(self):
        from midterms.certificate_service import issue_classroom_certificates

        MidtermResit.objects.create(midterm=self.midterm, student=self.failed)
        result = issue_classroom_certificates(self.midterm, self.room, actor=self.teacher)
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "not_all_finished")
        self.assertEqual(result["remaining"], 1)

    def test_a_never_started_student_still_blocks_publish_as_before(self):
        newcomer = User.objects.create(username="n", email="n@x.io")
        self.assertIn(newcomer.id, students_still_to_sit_for(self.midterm, {newcomer.id}))


def students_still_to_sit_for(midterm, ids):
    from midterms.certificate_service import students_still_to_sit

    return students_still_to_sit(midterm, ids)


class ResitEndpointTests(TestCase):
    def setUp(self):
        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.admin = User.objects.create(username="a", email="a@x.io", is_staff=True, is_superuser=True)
        self.teacher = User.objects.create(username="t", email="t@x.io", role="teacher")
        self.student = User.objects.create(username="s", email="s@x.io")
        _grant(self.student, self.midterm)
        _completed(self.midterm, self.student, 40)
        self.url = f"/api/midterms/teacher/midterms/{self.midterm.id}/resit/"

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_a_teacher_may_grant_a_resit(self):
        r = self._client(self.teacher).post(
            self.url, {"user_ids": [self.student.id], "reason": "repeated month 1"}, format="json"
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["granted"], [self.student.id])
        resit = MidtermResit.objects.get()
        self.assertEqual(resit.granted_by_id, self.teacher.id)
        self.assertEqual(resit.reason, "repeated month 1")

    def test_an_admin_may_grant_a_resit(self):
        r = self._client(self.admin).post(self.url, {"user_ids": [self.student.id]}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_a_student_may_not_grant_themselves_one(self):
        r = self._client(self.student).post(self.url, {"user_ids": [self.student.id]}, format="json")
        self.assertIn(r.status_code, (401, 403))
        self.assertEqual(MidtermResit.objects.count(), 0)

    def test_granting_to_someone_who_never_sat_it_is_refused_not_banked(self):
        newcomer = User.objects.create(username="n", email="n@x.io")
        r = self._client(self.teacher).post(self.url, {"user_ids": [newcomer.id]}, format="json")
        self.assertEqual(r.json()["granted"], [])
        self.assertEqual(r.json()["skipped"][0]["reason"], "has_not_sat_it")
        self.assertEqual(MidtermResit.objects.count(), 0)

    def test_granting_twice_does_not_bank_two(self):
        c = self._client(self.teacher)
        c.post(self.url, {"user_ids": [self.student.id]}, format="json")
        r = c.post(self.url, {"user_ids": [self.student.id]}, format="json")
        self.assertEqual(MidtermResit.objects.count(), 1)
        self.assertEqual(r.json()["skipped"][0]["reason"], "already_open")

    def test_an_unspent_grant_can_be_withdrawn(self):
        c = self._client(self.teacher)
        c.post(self.url, {"user_ids": [self.student.id]}, format="json")
        r = c.delete(self.url, {"user_ids": [self.student.id]}, format="json")
        self.assertEqual(r.json()["withdrawn"], 1)
        self.assertIsNone(open_resit(self.student, self.midterm))

    def test_a_spent_grant_cannot_be_withdrawn(self):
        MidtermResit.objects.create(
            midterm=self.midterm, student=self.student, consumed_at=timezone.now()
        )
        r = self._client(self.teacher).delete(self.url, {"user_ids": [self.student.id]}, format="json")
        self.assertEqual(r.json()["withdrawn"], 0)
        self.assertEqual(MidtermResit.objects.count(), 1)

    def test_the_list_shows_the_latest_score_and_the_attempt_count(self):
        _completed(self.midterm, self.student, 78)
        r = self._client(self.teacher).get(self.url)
        row = r.json()["results"][0]
        self.assertEqual(row["student_id"], self.student.id)
        self.assertEqual(row["score"], 78, "the list must show the sitting that counts")
        self.assertEqual(row["attempts"], 2)
        self.assertFalse(row["can_resit_now"])

    def test_the_list_flags_an_open_grant(self):
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        r = self._client(self.teacher).get(self.url)
        self.assertTrue(r.json()["results"][0]["can_resit_now"])


class ResitAcrossClassroomsTests(TestCase):
    """The students who most need a re-sit are the ones who MOVED, or never had a class.

    A student who repeated a month has usually changed group. Their old classroom's grant is
    what governs them (winning_grant puts a classroom grant ahead of a standalone one), and
    that classroom's sitting closed weeks ago — so the permission opened nothing. A student
    with no classroom at all had no grant to be governed by in the first place.
    """

    def setUp(self):
        from classes.models import Classroom, ClassroomMembership
        from classes.models_schedule import MidtermSchedule

        self.midterm = make_published_midterm(scale=Midterm.SCALE_100, n=4, correct="a")
        self.teacher = User.objects.create(username="t", email="t@x.io", role="teacher")
        self.old_room = Classroom.objects.create(
            name="G12 (last term)", subject="MATH",
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher,
        )
        self.student = User.objects.create(username="s", email="s@x.io")
        ClassroomMembership.objects.create(
            classroom=self.old_room, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.classroom_grant = ResourceAccessGrant.objects.create(
            user=self.student, classroom=self.old_room, resource_type=RT_MIDTERM_V2,
            resource_id=self.midterm.id, scope=ResourceAccessGrant.SCOPE_RESOURCE,
            source=ResourceAccessGrant.SOURCE_CLASSROOM,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        # The sitting happened last month and its window shut.
        past = timezone.now() - timezone.timedelta(days=30)
        MidtermSchedule.objects.create(
            classroom=self.old_room, midterm=self.midterm,
            starts_at=past, deadline=past + timezone.timedelta(hours=2),
            access_code="123456",
        )
        _completed(self.midterm, self.student, 40, when=past)

    def test_without_a_resit_the_closed_window_still_refuses(self):
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertFalse(ok)
        self.assertEqual(reason, "midterm_completed")

    def test_a_resit_gets_past_the_old_classrooms_closed_window(self):
        """The window governs the CLASS's scheduled sitting; a re-sit is out of band."""
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertTrue(ok, f"still blocked: {reason}")

    def test_a_resit_gets_past_a_missing_access_code_too(self):
        from classes.models_schedule import MidtermSchedule

        MidtermSchedule.objects.filter(classroom=self.old_room, midterm=self.midterm).update(
            access_code="", starts_at=timezone.now() - timezone.timedelta(hours=1), deadline=None
        )
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertTrue(ok, f"still blocked: {reason}")

    def test_the_window_still_binds_every_OTHER_student(self):
        """Exempting the re-sitter must not open the closed sitting for the whole class."""
        classmate = User.objects.create(username="c", email="c@x.io")
        ResourceAccessGrant.objects.create(
            user=classmate, classroom=self.old_room, resource_type=RT_MIDTERM_V2,
            resource_id=self.midterm.id, scope=ResourceAccessGrant.SCOPE_RESOURCE,
            source=ResourceAccessGrant.SOURCE_CLASSROOM,
            status=ResourceAccessGrant.STATUS_ACTIVE,
        )
        MidtermResit.objects.create(midterm=self.midterm, student=self.student)
        ok, reason = can_start_midterm(classmate, self.midterm)
        self.assertFalse(ok)
        self.assertEqual(reason, "midterm_closed")

    def test_a_student_with_no_access_left_is_re_granted_it(self):
        """Granting a re-sit to someone whose access is gone must not leave them at the door."""
        from access.engine.assignment_service import AssignmentService

        AssignmentService.revoke_resource(
            self.student, RT_MIDTERM_V2, self.midterm.id, actor=self.teacher, note="moved group"
        )
        self.assertIsNone(winning_grant(self.student, self.midterm))

        c = APIClient()
        c.force_authenticate(self.teacher)
        r = c.post(
            f"/api/midterms/teacher/midterms/{self.midterm.id}/resit/",
            {"user_ids": [self.student.id], "reason": "repeated the month, new group"},
            format="json",
        )

        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["access_restored"], [self.student.id])
        grant = winning_grant(self.student, self.midterm)
        self.assertIsNotNone(grant)
        self.assertIsNone(grant.classroom_id, "an out-of-band sitting is standalone")
        ok, reason = can_start_midterm(self.student, self.midterm)
        self.assertTrue(ok, f"still blocked: {reason}")

    def test_a_student_who_still_has_access_is_not_re_granted(self):
        c = APIClient()
        c.force_authenticate(self.teacher)
        r = c.post(
            f"/api/midterms/teacher/midterms/{self.midterm.id}/resit/",
            {"user_ids": [self.student.id]}, format="json",
        )
        self.assertEqual(r.json()["access_restored"], [])
        self.assertEqual(winning_grant(self.student, self.midterm).pk, self.classroom_grant.pk)

    def test_a_classroomless_student_can_be_given_the_whole_thing_in_one_click(self):
        """No classroom, no grant, an old completed attempt — the plain 'moved school' case."""
        from access.engine.assignment_service import AssignmentService

        loner = User.objects.create(username="l", email="l@x.io")
        _completed(self.midterm, loner, 35)
        self.assertIsNone(winning_grant(loner, self.midterm))

        c = APIClient()
        c.force_authenticate(self.teacher)
        c.post(
            f"/api/midterms/teacher/midterms/{self.midterm.id}/resit/",
            {"user_ids": [loner.id]}, format="json",
        )

        ok, reason = can_start_midterm(loner, self.midterm)
        self.assertTrue(ok, f"still blocked: {reason}")
