"""The two leaderboard rules, as a teacher would explain them.

    SAT      — your own most recent pastpaper, out of the ones this class was given.
    Academic — the points you have banked on this class's assessments since it opened.

The interesting cases are the ones where a plainer reading of those sentences produces the
wrong board: a student who sat an EARLIER paper than their classmate, a pastpaper the class
was never given, a Math paper assigned to an English class, and a student farming points by
re-sitting the same quiz.

    python manage.py test classes.tests_ranking_rules --settings=config.settings_test_nomigrations
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from assessments.models import (
    AssessmentAttempt,
    AssessmentResult,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership
from classes.models_ranking import RankingSnapshot
from classes.ranking import rules, service
from exams.models import Module, PracticeTest, TestAttempt

User = get_user_model()


def _classroom(*, level="middle", subject=Classroom.SUBJECT_ENGLISH, **kw):
    teacher = User.objects.create(username=f"t-{level}-{subject}-{User.objects.count()}")
    return Classroom.objects.create(
        name=f"{level} class", subject=subject, level=level, description="x",
        lesson_days="ODD", teacher=teacher, created_by=teacher, **kw
    )


def _student(room, name):
    user = User.objects.create(username=f"{name}-{User.objects.count()}", first_name=name)
    ClassroomMembership.objects.create(
        classroom=room, user=user, role=ClassroomMembership.ROLE_STUDENT,
        status=ClassroomMembership.STATUS_ACTIVE,
    )
    return user


def _pastpaper(subject="READING_WRITING"):
    """A standalone pastpaper section — no mock_exam, which is what makes it a pastpaper."""
    pt = PracticeTest.objects.create(subject=subject, form_type="INTERNATIONAL", skip_default_modules=True)
    Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=32)
    return pt


def _assign_pastpaper(room, pt, *, status=Assignment.STATUS_PUBLISHED):
    return Assignment.objects.create(
        classroom=room, title=f"PP {pt.id}", category=Assignment.CATEGORY_PAST_PAPER,
        status=status, practice_test=pt, created_by=room.teacher,
    )


def _sat_attempt(student, pt, score, *, when):
    return TestAttempt.objects.create(
        student=student, practice_test=pt, score=score,
        is_completed=True, current_state=TestAttempt.STATE_COMPLETED, completed_at=when,
    )


def _ranked(room, kind=RankingSnapshot.KIND_SAT):
    """[(student_id, rank, score)] in rank order, straight from the persisted snapshots."""
    return [
        (s.student_id, s.rank, None if s.score is None else float(s.score))
        for s in RankingSnapshot.objects.filter(classroom=room, kind=kind).order_by("rank", "student_id")
    ]


class SatLastPastpaperTests(TestCase):
    def setUp(self):
        self.room = _classroom(level="middle")
        self.ali = _student(self.room, "Ali")
        self.vali = _student(self.room, "Vali")
        self.now = timezone.now()

    def test_each_student_is_ranked_on_their_OWN_latest_paper(self):
        """The heart of the rule. Ali sat the newer paper, Vali only ever sat the older one —
        they are ranked on 4 and 3 respectively, NOT both on paper 4."""
        pp3, pp4 = _pastpaper(), _pastpaper()
        _assign_pastpaper(self.room, pp3)
        _assign_pastpaper(self.room, pp4)
        _sat_attempt(self.ali, pp3, 500, when=self.now - timedelta(days=9))
        _sat_attempt(self.ali, pp4, 620, when=self.now - timedelta(days=2))   # Ali's latest
        _sat_attempt(self.vali, pp3, 680, when=self.now - timedelta(days=9))  # Vali's latest

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(self.room), [(self.vali.id, 1, 680.0), (self.ali.id, 2, 620.0)])

    def test_a_newer_but_worse_resit_replaces_the_better_older_one(self):
        # "Last", not "best" — a student who slips on the newest paper drops. Deliberate:
        # the board is meant to show where they stand now.
        pp = _pastpaper()
        _assign_pastpaper(self.room, pp)
        _sat_attempt(self.ali, pp, 700, when=self.now - timedelta(days=5))
        _sat_attempt(self.ali, pp, 450, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(self.room)[0][2], 450.0)

    def test_a_pastpaper_the_class_was_never_given_is_ignored(self):
        assigned, private = _pastpaper(), _pastpaper()
        _assign_pastpaper(self.room, assigned)
        _sat_attempt(self.ali, assigned, 500, when=self.now - timedelta(days=4))
        _sat_attempt(self.ali, private, 800, when=self.now - timedelta(hours=1))  # newer, unassigned

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(self.room)[0][2], 500.0)

    def test_a_math_paper_assigned_to_an_english_class_is_ignored(self):
        # Nothing validates subject at assignment time, so this WILL happen. Without the
        # subject filter the Math paper becomes the English student's rank.
        english_pp, math_pp = _pastpaper("READING_WRITING"), _pastpaper("MATH")
        _assign_pastpaper(self.room, english_pp)
        _assign_pastpaper(self.room, math_pp)
        _sat_attempt(self.ali, english_pp, 520, when=self.now - timedelta(days=3))
        _sat_attempt(self.ali, math_pp, 790, when=self.now - timedelta(minutes=5))

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(self.room)[0][2], 520.0)

    def test_a_draft_assignment_does_not_count_as_given(self):
        pp = _pastpaper()
        _assign_pastpaper(self.room, pp, status=Assignment.STATUS_DRAFT)
        _sat_attempt(self.ali, pp, 600, when=self.now)

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertIsNone(_ranked(self.room)[0][2])  # nobody has a result

    def test_an_unfinished_attempt_never_becomes_a_rank(self):
        pp = _pastpaper()
        _assign_pastpaper(self.room, pp)
        _sat_attempt(self.ali, pp, 400, when=self.now - timedelta(days=2))
        # is_completed and current_state have drifted apart before — half-finished with a
        # partial score must not outrank a finished paper.
        TestAttempt.objects.create(
            student=self.ali, practice_test=pp, score=780,
            is_completed=False, current_state="IN_PROGRESS", completed_at=self.now,
        )

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(self.room)[0][2], 400.0)

    def test_students_with_no_pastpaper_are_listed_last_with_no_score(self):
        pp = _pastpaper()
        _assign_pastpaper(self.room, pp)
        _sat_attempt(self.ali, pp, 610, when=self.now)

        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)

        rows = _ranked(self.room)
        self.assertEqual(rows[0], (self.ali.id, 1, 610.0))
        self.assertEqual(rows[1], (self.vali.id, 2, None))  # present, unscored, last

    def test_a_class_with_no_assigned_pastpapers_still_lists_everyone(self):
        service.recompute_classroom(self.room, kinds=("SAT",), now=self.now)
        self.assertEqual({r[2] for r in _ranked(self.room)}, {None})
        self.assertEqual(len(_ranked(self.room)), 2)


class SatLevelGateTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def _room_with_result(self, level):
        room = _classroom(level=level)
        student = _student(room, "S")
        pp = _pastpaper()
        _assign_pastpaper(room, pp)
        _sat_attempt(student, pp, 640, when=self.now)
        return room

    def test_middle_and_senior_rank_on_sat(self):
        for level in ("middle", "senior"):
            room = self._room_with_result(level)
            service.recompute_classroom(room, kinds=("SAT",), now=self.now)
            self.assertEqual(_ranked(room)[0][2], 640.0, level)

    def test_foundation_and_junior_do_not(self):
        for level in ("foundation", "junior"):
            room = self._room_with_result(level)
            service.recompute_classroom(room, kinds=("SAT",), now=self.now)
            self.assertEqual(_ranked(room), [], level)

    def test_an_untagged_class_does_not(self):
        room = self._room_with_result("")
        service.recompute_classroom(room, kinds=("SAT",), now=self.now)
        self.assertEqual(_ranked(room), [])

    def test_dropping_to_junior_clears_the_board_it_already_had(self):
        # Otherwise a hidden tab could be un-hidden later onto months-old numbers.
        room = self._room_with_result("middle")
        service.recompute_classroom(room, kinds=("SAT",), now=self.now)
        self.assertTrue(_ranked(room))

        room.level = "junior"
        room.save(update_fields=["level"])
        service.recompute_classroom(room, kinds=("SAT",), now=self.now)

        self.assertEqual(_ranked(room), [])


class AcademicAssessmentPointsTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.room = _classroom(level="junior")
        self.room.created_at = self.now - timedelta(days=30)
        self.room.save(update_fields=["created_at"])
        self.ali = _student(self.room, "Ali")
        self.vali = _student(self.room, "Vali")

    def _homework(self, aset):
        """An assessment given to this class. `HomeworkAssignment` always hangs off a
        `classes.Assignment` (that is what puts it in the homework feed), so both rows exist."""
        hw = HomeworkAssignment.objects.filter(classroom=self.room, assessment_set=aset).first()
        if hw is not None:
            return hw
        assignment = Assignment.objects.create(
            classroom=self.room, title=aset.title, category=Assignment.CATEGORY_QUIZ,
            status=Assignment.STATUS_PUBLISHED, created_by=self.room.teacher,
        )
        return HomeworkAssignment.objects.create(
            classroom=self.room, assessment_set=aset, assignment=assignment,
            assigned_by=self.room.teacher,
        )

    def _graded(self, student, aset, points, max_points, *, when):
        hw = self._homework(aset)
        attempt = AssessmentAttempt.objects.create(
            homework=hw, student=student, status=AssessmentAttempt.STATUS_GRADED, submitted_at=when
        )
        AssessmentResult.objects.create(
            attempt=attempt, score_points=points, max_points=max_points,
            percent=(points / max_points * 100) if max_points else 0,
        )
        return attempt

    def _set(self, title):
        return AssessmentSet.objects.create(title=title, created_by=self.room.teacher)

    def test_points_are_summed_across_assessments(self):
        a, b, c = self._set("A"), self._set("B"), self._set("C")
        for aset, pts, mx in ((a, 18, 20), (b, 45, 50), (c, 9, 10)):
            self._graded(self.ali, aset, pts, mx, when=self.now - timedelta(days=2))
        self._graded(self.vali, a, 20, 20, when=self.now - timedelta(days=2))
        self._graded(self.vali, b, 50, 50, when=self.now - timedelta(days=2))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        rows = _ranked(self.room, RankingSnapshot.KIND_ACADEMIC)
        self.assertEqual(rows, [(self.ali.id, 1, 72.0), (self.vali.id, 2, 70.0)])

    def test_retaking_the_same_assessment_does_not_farm_points(self):
        """Retakes are unlimited, so a naive sum makes re-sitting the fastest route to
        rank 1. Only the best attempt per assessment counts."""
        a = self._set("A")
        self._graded(self.ali, a, 12, 20, when=self.now - timedelta(days=3))
        self._graded(self.ali, a, 18, 20, when=self.now - timedelta(days=2))
        self._graded(self.ali, a, 15, 20, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 18.0)

    def test_work_done_before_the_class_opened_does_not_count(self):
        a = self._set("A")
        self.room.created_at = self.now - timedelta(days=5)
        self.room.save(update_fields=["created_at"])
        self._graded(self.ali, a, 20, 20, when=self.now - timedelta(days=40))  # before opening

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 0.0)

    def test_start_date_wins_over_created_at_as_the_opening_day(self):
        self.room.start_date = (self.now - timedelta(days=3)).date()
        self.room.save(update_fields=["start_date"])
        a = self._set("A")
        self._graded(self.ali, a, 20, 20, when=self.now - timedelta(days=10))  # before start_date

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 0.0)

    def test_an_ungraded_attempt_contributes_nothing(self):
        a = self._set("A")
        AssessmentAttempt.objects.create(
            homework=self._homework(a), student=self.ali,
            status=AssessmentAttempt.STATUS_IN_PROGRESS,
        )

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 0.0)

    def test_everyone_appears_including_students_on_zero(self):
        a = self._set("A")
        self._graded(self.ali, a, 10, 10, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        rows = _ranked(self.room, RankingSnapshot.KIND_ACADEMIC)
        self.assertEqual(rows, [(self.ali.id, 1, 10.0), (self.vali.id, 2, 0.0)])

    def _hand_graded(self, student, title, grade, max_score, *, when, status=Assignment.STATUS_PUBLISHED):
        from classes.models import Submission, SubmissionReview

        assignment = Assignment.objects.create(
            classroom=self.room, title=title, category=Assignment.CATEGORY_HOMEWORK,
            status=status, max_score=max_score, created_by=self.room.teacher,
        )
        sub = Submission.objects.create(
            assignment=assignment, student=student, status=Submission.STATUS_REVIEWED,
            submitted_at=when,
        )
        if grade is not None:
            SubmissionReview.objects.create(submission=sub, teacher=self.room.teacher, grade=grade)
        return assignment

    def test_hand_graded_homework_adds_to_the_total(self):
        a = self._set("A")
        self._graded(self.ali, a, 30, 50, when=self.now - timedelta(days=2))
        self._hand_graded(self.ali, "Essay", 45, 50, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        row = _ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0]
        self.assertEqual(row[2], 75.0)  # 30 assessment + 45 hand-graded

    def test_an_ungraded_submission_adds_NOTHING_not_zero(self):
        """The teacher's backlog must not cost the student anything.

        A student who handed work in that has not been marked yet keeps exactly the points
        they have already earned — the pending work is absent from the sum, not a zero
        dragging an average down."""
        a = self._set("A")
        self._graded(self.ali, a, 40, 50, when=self.now - timedelta(days=2))
        self._hand_graded(self.ali, "Unmarked essay", None, 50, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        row = _ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0]
        self.assertEqual(row[2], 40.0)  # unchanged by the pending work

    def test_grading_later_only_adds_points(self):
        from classes.models import Submission, SubmissionReview

        a = self._set("A")
        self._graded(self.ali, a, 40, 50, when=self.now - timedelta(days=2))
        assignment = self._hand_graded(self.ali, "Essay", None, 50, when=self.now - timedelta(days=1))
        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)
        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 40.0)

        sub = Submission.objects.get(assignment=assignment, student=self.ali)
        SubmissionReview.objects.create(submission=sub, teacher=self.room.teacher, grade=35)
        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 75.0)

    def test_hand_graded_work_from_before_the_class_opened_does_not_count(self):
        self.room.created_at = self.now - timedelta(days=5)
        self.room.save(update_fields=["created_at"])
        self._hand_graded(self.ali, "Old essay", 50, 50, when=self.now - timedelta(days=40))

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 0.0)

    def test_a_draft_assignments_grade_does_not_count(self):
        self._hand_graded(self.ali, "Draft", 40, 50, when=self.now - timedelta(days=1),
                          status=Assignment.STATUS_DRAFT)

        service.recompute_classroom(self.room, kinds=("ACADEMIC",), now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 0.0)

    def test_academic_is_not_gated_by_level(self):
        # This class is junior — its SAT board is hidden, but Academic must still work.
        a = self._set("A")
        self._graded(self.ali, a, 7, 10, when=self.now - timedelta(days=1))

        service.recompute_classroom(self.room, now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_SAT), [])
        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 7.0)


class RecomputeTaskTests(TestCase):
    """The task that makes any of this appear. Before it existed the only writer was a POST
    endpoint with no button wired to it, so no board had ever been computed in production."""

    def test_the_sweep_ranks_every_active_classroom(self):
        now = timezone.now()
        rooms = [_classroom(level="middle") for _ in range(2)]
        for room in rooms:
            student = _student(room, "S")
            pp = _pastpaper()
            _assign_pastpaper(room, pp)
            _sat_attempt(student, pp, 600, when=now)

        from classes.tasks import recompute_classroom_rankings

        stats = recompute_classroom_rankings()

        self.assertGreaterEqual(stats["classrooms"], 2)
        self.assertEqual(stats["failed"], 0)
        for room in rooms:
            self.assertEqual(_ranked(room)[0][2], 600.0)

    def test_one_broken_classroom_does_not_stop_the_sweep(self):
        now = timezone.now()
        good = _classroom(level="middle")
        student = _student(good, "S")
        pp = _pastpaper()
        _assign_pastpaper(good, pp)
        _sat_attempt(student, pp, 550, when=now)

        from unittest.mock import patch

        from classes.tasks import recompute_classroom_rankings

        real = service.recompute_classroom
        calls = {"n": 0}

        def _explode_once(classroom, **kw):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("bad data")
            return real(classroom, **kw)

        with patch("classes.ranking.service.recompute_classroom", side_effect=_explode_once):
            stats = recompute_classroom_rankings()

        self.assertEqual(stats["failed"], 1)
        self.assertGreaterEqual(stats["classrooms"], 0)

    def test_the_task_is_registered_for_the_worker(self):
        from celery import current_app

        current_app.loader.import_default_modules()
        self.assertIn("classes.tasks.recompute_classroom_rankings", current_app.tasks)
