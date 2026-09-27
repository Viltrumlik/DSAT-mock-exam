"""Finishing a past paper reaches the classroom by itself — and reaches it exactly once.

The owner, 2026-09-18: nothing is connected. Production held 976 finished past papers and not
one certificate, not one handed-in homework row, not one point. The cause was never in the
classroom code: ``TestAttempt.complete_test`` records the finish with a conditional queryset
``UPDATE`` (``exams.engine_db_guard`` — the concurrency guard), and a queryset update sends no
``post_save``, so all three receivers waiting on a finished attempt sat dormant.

What is pinned here:

* the transition now announces itself, and each of the three receivers does its work
  (``exams.models.TestAttempt._announce_completion``);
* it announces **once** — finishing twice pays once;
* the guard refusing — an attempt somebody else already finished — announces **nothing**;
* ``backfill_finished_pastpapers`` settles the history: ``--dry-run`` writes nothing and its
  numbers match what the real run then does — including for the ordinary SAT homework, which
  is one assignment over two sections, where the two sittings settle one award and a dry run
  that unwound after each paper counted it twice;
* ``core.quiet`` silences the realtime nudge as well as the bell — pinned on its own, because
  the settling path reaches no emit and so cannot pin it.

``TestCase`` does not run ``transaction.on_commit`` callbacks and the reward hook defers to one
(``rewards.hooks._recompute``), so every fixture that finishes a paper wraps the call in
``captureOnCommitCallbacks(execute=True)``. Without it these tests would pass while proving
nothing about the points.
"""

from __future__ import annotations

from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_certificates import PastpaperCertificate
from core.quiet import quiet_delivery
from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test
from notifications.models import Notification
from rewards import constants as reward_const
from rewards.models import PointAward

User = get_user_model()


class CompletionFixture(TestCase):
    """One class list, one student, one past paper, one homework that sets it."""

    def setUp(self):
        self.now = timezone.now()
        self.teacher = User.objects.create_user(
            email="t_settle@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.student = User.objects.create_user(
            email="st_settle@example.com", password="x", role=acc_const.ROLE_STUDENT, subject=""
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.section = self._section("SAT March 2024")
        self.homework = self._homework(days_ago=2)

    @staticmethod
    def _section(title, subject="MATH"):
        section = PracticeTest.objects.create(
            mock_exam=None, subject=subject, title=title, collection_name=title,
            form_type="INTERNATIONAL", skip_default_modules=True,
        )
        Module.objects.create(practice_test=section, module_order=1, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(section, questions_per_module=2)
        return section

    def _homework(self, *, days_ago=2, status=Assignment.STATUS_PUBLISHED):
        homework = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="Sit SAT March 2024",
            category=Assignment.CATEGORY_HOMEWORK, status=status, practice_test=self.section,
        )
        # The homework has to predate the sitting: an attempt finished before the work was set
        # is history, not this homework (``classes.pastpaper_retake``).
        Assignment.objects.filter(pk=homework.pk).update(
            created_at=self.now - timedelta(days=days_ago)
        )
        homework.refresh_from_db()
        return homework

    def _answers(self, *, correct=True, section=None):
        module = Module.objects.get(practice_test=section or self.section, module_order=1)
        letter = "a" if correct else "b"
        return {str(module.pk): {str(q.pk): letter for q in module.questions.all()}}

    def _scoring_attempt(self, *, days_ago=1, correct=True, student=None, section=None):
        """An attempt parked in SCORING, exactly as the runner leaves it for the scorer."""
        when = self.now - timedelta(days=days_ago)
        return TestAttempt.objects.create(
            practice_test=section or self.section, student=student or self.student,
            current_state=TestAttempt.STATE_SCORING,
            module_answers=self._answers(correct=correct, section=section),
            started_at=when, submitted_at=when, scoring_started_at=when,
        )

    def _finish(self, attempt):
        """Run the real finish, letting the deferred reward settlement actually settle."""
        with self.captureOnCommitCallbacks(execute=True):
            attempt.complete_test()
        return attempt

    def _finish_unannounced(self, attempt):
        """Finish it the way production finished all 976: the row moves, nothing is told."""
        with mock.patch("exams.models.TestAttempt._announce_completion"):
            attempt.complete_test()
        return attempt

    # ── running the backfill, and reading the report it prints ───────────────

    def _run(self, *args):
        out, err = StringIO(), StringIO()
        with self.captureOnCommitCallbacks(execute=True):
            call_command("backfill_finished_pastpapers", *args, stdout=out, stderr=err)
        self.assertEqual(err.getvalue(), "", "the backfill reported a failure")
        return out.getvalue()

    #: The figures the owner decides from.
    FIGURES = (
        "papers examined",
        "papers that needed settling",
        "certificates issued",
        "homework handed in",
        "awards written or corrected",
        "points moved",
    )

    def _figures(self, report: str) -> dict:
        """Pull the owner's numbers off the report, so a test compares what they will read."""
        out: dict[str, int] = {}
        for raw in report.splitlines():
            line = raw.strip()
            for label in self.FIGURES:
                if line.startswith(label):
                    out[label] = int(line[len(label):].strip())
        self.assertEqual(sorted(out), sorted(self.FIGURES), f"unreadable report:\n{report}")
        return out

    # ── what the three receivers are supposed to leave behind ────────────────

    def _certificates(self, attempt):
        return PastpaperCertificate.objects.filter(attempt=attempt)

    def _submissions(self):
        return Submission.objects.filter(assignment=self.homework, student=self.student)

    def _awards(self):
        return PointAward.objects.filter(
            idempotency_key=reward_const.homework_key(self.homework.pk, self.student.pk)
        )


class CompletionReachesTheClassroomTests(CompletionFixture):
    def test_finishing_a_paper_issues_the_certificate(self):
        attempt = self._finish(self._scoring_attempt())

        self.assertEqual(self._certificates(attempt).count(), 1)
        self.assertEqual(self._certificates(attempt).first().score, attempt.score)

    def test_finishing_a_paper_hands_the_homework_in(self):
        self._finish(self._scoring_attempt())

        submission = self._submissions().first()
        self.assertIsNotNone(submission, "the paper was never handed in")
        self.assertEqual(submission.status, Submission.STATUS_REVIEWED)

    def test_finishing_a_paper_pays_the_points(self):
        self._finish(self._scoring_attempt())

        award = self._awards().first()
        self.assertIsNotNone(award, "the homework was never paid")
        self.assertGreater(award.points, 0)

    def test_a_paper_no_homework_asked_for_still_gets_its_certificate(self):
        """The certificate belongs to the sitting, not to the homework that set it."""
        Assignment.objects.filter(pk=self.homework.pk).delete()

        attempt = self._finish(self._scoring_attempt())

        self.assertEqual(self._certificates(attempt).count(), 1)
        self.assertEqual(Submission.objects.filter(student=self.student).count(), 0)


class ItAnnouncesExactlyOnceTests(CompletionFixture):
    def test_finishing_twice_produces_one_of_each(self):
        attempt = self._finish(self._scoring_attempt())
        first_award = self._awards().get()

        # The second call is the ordinary re-run: a retried Celery delivery, an ops repair.
        self._finish(attempt)

        self.assertEqual(self._certificates(attempt).count(), 1)
        self.assertEqual(self._submissions().count(), 1)
        self.assertEqual(self._awards().count(), 1)
        after = self._awards().get()
        self.assertEqual((after.pk, after.points, after.xp),
                         (first_award.pk, first_award.points, first_award.xp))

    def test_the_guard_refusing_announces_nothing(self):
        """Another worker got there first: this call changed no row, so it has no news.

        Reproduced the way it actually happens — a stale instance still believing the attempt
        is in SCORING, while the row in the database has already been finished by somebody
        else. The conditional UPDATE matches nothing and ``complete_test`` returns.
        """
        attempt = self._finish(self._scoring_attempt())
        stale = TestAttempt.objects.get(pk=attempt.pk)
        stale.current_state = TestAttempt.STATE_SCORING
        stale.is_completed = False
        stale.version_number = int(attempt.version_number) - 1

        with mock.patch("exams.models.TestAttempt._announce_completion") as announce:
            with self.captureOnCommitCallbacks(execute=True):
                stale.complete_test()

        announce.assert_not_called()
        self.assertEqual(self._certificates(attempt).count(), 1)
        self.assertEqual(self._submissions().count(), 1)
        self.assertEqual(self._awards().count(), 1)

    def test_an_already_finished_attempt_announces_nothing(self):
        attempt = self._finish(self._scoring_attempt())

        with mock.patch("exams.models.TestAttempt._announce_completion") as announce:
            attempt.complete_test()

        announce.assert_not_called()


class OneFailingReceiverCostsOnlyItselfTests(CompletionFixture):
    """The announcement is ``send_robust``, so the three receivers are independent.

    Under a plain ``send`` the dispatch stops at the first receiver that raises, and the first
    one here is the homework sync — the only one of the three with no try/except around the
    work it does before its own per-assignment loop. A student with an odd class row would
    have lost the certificate and the points to it, silently.
    """

    def test_the_sync_blowing_up_still_leaves_the_certificate(self):
        # Created outside the patch: ``objects.create`` is itself a ``post_save`` and would
        # raise before the finish this test is about.
        attempt = self._scoring_attempt()
        with mock.patch(
            "classes.homework_attempt_signals.sync_homework_after_test_attempt_saved",
            side_effect=RuntimeError("the class membership query blew up"),
        ):
            self._finish(attempt)

        self.assertEqual(
            self._certificates(attempt).count(), 1,
            "a failing homework sync took the certificate with it",
        )

    def test_the_failure_is_logged_against_the_receiver_that_raised(self):
        """A log line that names no receiver leaves the next person reading three suspects."""
        attempt = self._scoring_attempt()
        with mock.patch(
            "classes.homework_attempt_signals.sync_homework_after_test_attempt_saved",
            side_effect=RuntimeError("the class membership query blew up"),
        ):
            with self.assertLogs("exams.models", level="ERROR") as logged:
                self._finish(attempt)

        blob = "\n".join(logged.output)
        self.assertIn("classroom_homework_sync_on_test_attempt_save", blob)
        self.assertIn("the class membership query blew up", blob)


class BackfillFixture(CompletionFixture):
    """A past paper finished the way production finished all 976 of them: unannounced."""

    def setUp(self):
        super().setUp()
        # The 2026-09-18 state of the world, reproduced exactly: the row is finished by the
        # conditional UPDATE and nothing is told about it.
        self.attempt = self._finish_unannounced(self._scoring_attempt(days_ago=1))
        self.assertEqual(self._certificates(self.attempt).count(), 0)
        self.assertEqual(self._submissions().count(), 0)
        self.assertEqual(self._awards().count(), 0)

    def _settled(self) -> tuple[int, int, int]:
        return (
            self._certificates(self.attempt).count(),
            self._submissions().count(),
            self._awards().count(),
        )


class BackfillDryRunTests(BackfillFixture):
    def test_a_dry_run_writes_nothing(self):
        report = self._run("--dry-run")

        self.assertEqual(self._settled(), (0, 0, 0))
        self.assertIn("dry run", report)

    def test_a_dry_run_reports_what_the_real_run_then_does(self):
        """The one lie an operator must not be told before they commit to a backfill."""
        dry = self._run("--dry-run")
        real = self._run()

        for line in ("certificates issued            1",
                     "homework handed in             1",
                     "awards written or corrected    1"):
            self.assertIn(line, dry)
            self.assertIn(line, real)
        self.assertEqual(self._settled(), (1, 1, 1))

    def test_it_reports_by_class_and_by_award_kind(self):
        report = self._run("--dry-run")

        self.assertIn("By class list", report)
        self.assertIn(self.classroom.name, report)
        self.assertIn("By award kind", report)
        self.assertIn(reward_const.EVENT_HOMEWORK, report)

    def test_since_excludes_a_paper_finished_before_it(self):
        # A month clear of the boundary: ``--since`` is a *local* date and the fixture's clock
        # is UTC, so a one-day margin is a test that fails after 19:00 in Tashkent.
        next_month = (self.now + timedelta(days=30)).strftime("%Y-%m-%d")

        report = self._run(f"--since={next_month}")

        self.assertEqual(self._settled(), (0, 0, 0))
        self.assertIn("papers examined                0", report)

    def test_since_includes_a_paper_finished_on_or_after_it(self):
        last_month = (self.now - timedelta(days=30)).strftime("%Y-%m-%d")

        self._run(f"--since={last_month}")

        self.assertEqual(self._settled(), (1, 1, 1))


class TwoSectionBundleFixture(CompletionFixture):
    """The homework the learning center actually sets: ONE assignment, TWO sections.

    An RW paper and a Math paper attached to a single homework — ``practice_test_ids``, which
    counts as one openable content, so the assignment stays auto-graded. Both sections were
    sat, and both finishes went unannounced.

    This is the shape the one-student/one-section fixture above cannot see: the two attempts
    resolve to the **same** award key, ``homework:<assignment>:<student>``.
    """

    def setUp(self):
        super().setUp()
        # Replace the single-section homework with the two-section one, so the helpers
        # inherited from ``CompletionFixture`` measure the bundle.
        Assignment.objects.filter(pk=self.homework.pk).delete()
        self.rw_section = self._section("SAT March 2024 (RW)", subject="READING_WRITING")
        self.homework = self._bundle_homework()
        self.attempts = [
            self._finish_unannounced(self._scoring_attempt(days_ago=1, section=section))
            for section in (self.rw_section, self.section)
        ]
        self.assertEqual(self._submissions().count(), 0)
        self.assertEqual(self._awards().count(), 0)

    def _bundle_homework(self, *, days_ago=2):
        homework = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher,
            title="Sit SAT March 2024, both sections",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test_ids=[self.rw_section.pk, self.section.pk],
        )
        Assignment.objects.filter(pk=homework.pk).update(
            created_at=self.now - timedelta(days=days_ago)
        )
        homework.refresh_from_db()
        return homework


class BackfillDryRunMatchesTheRealRunTests(TwoSectionBundleFixture):
    def test_the_bundle_is_auto_graded_so_the_sync_really_runs(self):
        """Guard on the fixture itself: two sections on one homework is one content, not two.

        If ``content_count`` ever counted them separately the assignment would become a
        'bundle', the sync would decline it, and the test below would pass while measuring
        nothing at all.
        """
        self.assertFalse(self.homework.is_multi_content)
        self.assertTrue(self.homework.is_auto_graded)

    def test_a_dry_run_does_not_count_one_homework_once_per_section(self):
        """The owner decides from these numbers, so the dry run has to mean them.

        Both sittings settle the one award ``homework:<assignment>:<student>``. A dry run that
        unwound after each paper measured the second sitting against a world where the first
        had never been settled, and so reported the award — and its points — twice. Scaled to
        the class this was written for, that is "+600 points" printed for a run that pays
        +300.
        """
        dry = self._figures(self._run("--dry-run"))
        self.assertEqual(self._awards().count(), 0, "the dry run wrote something")

        real = self._figures(self._run())

        self.assertEqual(dry, real)
        # What "the same" has to be: two papers, two certificates (one per sitting), and ONE
        # homework handed in for ONE award — read off the report, and confirmed in the rows.
        self.assertEqual(real["papers examined"], 2)
        self.assertEqual(real["certificates issued"], 2)
        self.assertEqual(real["homework handed in"], 1)
        self.assertEqual(real["awards written or corrected"], 1)
        self.assertEqual(self._submissions().count(), 1)
        self.assertEqual(self._awards().count(), 1)
        self.assertEqual(real["points moved"], self._awards().get().points)


class BackfillSettlesAndStopsTests(BackfillFixture):
    def test_it_settles_the_backlog(self):
        self._run()

        self.assertEqual(self._settled(), (1, 1, 1))
        self.assertEqual(self._submissions().get().status, Submission.STATUS_REVIEWED)
        self.assertGreater(self._awards().get().points, 0)

    def test_running_it_twice_is_the_same_as_running_it_once(self):
        self._run()
        award = self._awards().get()

        second = self._run()

        self.assertEqual(self._settled(), (1, 1, 1))
        after = self._awards().get()
        self.assertEqual((after.pk, after.points, after.xp), (award.pk, award.points, award.xp))
        self.assertIn("papers that needed settling    0", second)

    def test_it_never_overwrites_a_teachers_own_grade(self):
        """A paper settled late must not undo a mark somebody made by hand."""
        from classes.models import SubmissionReview

        submission = Submission.objects.create(assignment=self.homework, student=self.student)
        submission.status = Submission.STATUS_REVIEWED
        submission.save()
        SubmissionReview.objects.create(
            submission=submission, teacher=self.teacher, grade=42, is_auto=False
        )

        self._run()

        submission.refresh_from_db()
        self.assertEqual(submission.review.grade, 42)
        self.assertFalse(submission.review.is_auto)


class BackfillFailureIsVisibleTests(BackfillFixture):
    def test_a_paper_that_could_not_be_settled_fails_the_command(self):
        """A partial sweep must not exit 0.

        The per-paper savepoint is there so one unsettleable paper cannot take the other 975
        down — but that same isolation is what lets a run finish "successfully" having settled
        nothing. The report names the failures; the exit code is what a deploy step, a cron
        line or an operator scrolled past the output actually reads.
        """
        out, err = StringIO(), StringIO()

        with mock.patch(
            "classes.management.commands.backfill_finished_pastpapers.Command._settle_one",
            side_effect=RuntimeError("the certificate could not be drawn"),
        ):
            with self.assertRaises(CommandError):
                with self.captureOnCommitCallbacks(execute=True):
                    call_command("backfill_finished_pastpapers", stdout=out, stderr=err)

        self.assertIn(f"attempt {self.attempt.pk}", err.getvalue())
        self.assertIn("papers that failed", out.getvalue())
        # And it left the rows alone rather than half-settling them.
        self.assertEqual(self._settled(), (0, 0, 0))


class BackfillIsSilentToStudentsTests(BackfillFixture):
    def test_it_notifies_nobody_and_emails_nobody(self):
        """The owner's decision: the backfill reports to them, not to two hundred students."""
        mail.outbox = []
        Notification.objects.all().delete()

        with mock.patch("realtime.services._normalize_emit_row") as emit:
            self._run()

        self.assertEqual(Notification.objects.count(), 0, "a student was told about August")
        self.assertEqual(len(mail.outbox), 0)
        # Not proof that the realtime guard works — nothing on this path emits in the first
        # place (see ``QuietSilencesRealtimeTests``), so this line would pass with the guard
        # deleted. It is here as a tripwire on the *path*: the day an auto-graded submission
        # starts reaching an emit, a backfill would start nudging two hundred tabs, and this
        # test says so before production does.
        emit.assert_not_called()
        # Control: the rows it was supposed to write are all there.
        self.assertEqual(self._settled(), (1, 1, 1))

    def test_a_live_finish_still_notifies(self):
        """The quiet is the backfill's, not the platform's — proof it was scoped to the run."""
        self._run()
        Notification.objects.all().delete()

        other = self._homework(days_ago=2)
        other.title = "A second homework, set for the same paper"
        other.save()
        with self.captureOnCommitCallbacks(execute=True):
            self._scoring_attempt(days_ago=0).complete_test()

        self.assertGreater(Notification.objects.count(), 0, "the bell stayed off after the backfill")


class QuietSilencesRealtimeTests(CompletionFixture):
    """``core.quiet`` silences the realtime nudge, not only the in-app bell.

    Pinned here directly, and not through the backfill, because the backfill cannot pin it: a
    practice/pastpaper homework is ``is_auto_graded``, so its submission is written straight to
    REVIEWED, and ``classes.stream_signals._ensure_stream_submission`` emits only for
    SUBMITTED. The settling path therefore reaches no emit at all, and "the backfill emitted
    nothing" is equally true with the guard deleted. These four assertions are not: each half
    of the guard is exercised against its own control, so removing either one fails a test.

    The guard earns its place on the next silent sweep — mock sections, assessments — which
    runs through code that does emit. A quiet that stopped the notification but left every open
    tab refetching would be a quiet in name only.
    """

    def _events(self):
        from realtime.models import RealtimeEvent

        return RealtimeEvent.objects.filter(user_id=self.student.pk)

    def test_emit_to_user_is_dropped_inside_the_quiet(self):
        from realtime.services import emit_to_user

        self._events().delete()

        with quiet_delivery():
            emit_to_user(
                user_id=self.student.pk,
                event_type="workspace.updated",
                payload={"reason": "settled"},
            )

        self.assertEqual(self._events().count(), 0, "a backfill nudged an open tab")

    def test_the_same_emit_outside_the_quiet_is_written(self):
        """The control. Without it the test above passes on a realtime layer that is simply off."""
        from realtime.services import emit_to_user

        self._events().delete()

        emit_to_user(
            user_id=self.student.pk,
            event_type="workspace.updated",
            payload={"reason": "settled"},
        )

        self.assertEqual(self._events().count(), 1)

    def test_a_class_fan_out_is_dropped_inside_the_quiet(self):
        """``emit_to_classroom_members`` funnels through ``emit_to_users`` — the other half."""
        from realtime.services import emit_to_classroom_members

        self._events().delete()

        with quiet_delivery():
            emit_to_classroom_members(
                classroom_id=self.classroom.pk,
                event_type="stream.updated",
                payload={"reason": "settled"},
            )

        self.assertEqual(self._events().count(), 0)

    def test_the_same_fan_out_outside_the_quiet_is_written(self):
        from realtime.services import emit_to_classroom_members

        self._events().delete()

        emit_to_classroom_members(
            classroom_id=self.classroom.pk,
            event_type="stream.updated",
            payload={"reason": "settled"},
        )

        self.assertEqual(self._events().count(), 1)
