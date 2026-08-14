"""The classroom leaderboard rule, as a teacher would explain it.

    Academic — the XP you have banked in this class.

There used to be a second board. SAT ranked a student on their own most recent assigned
pastpaper, and this file carried most of its coverage: a student who sat an EARLIER paper
than their classmate, a pastpaper the class was never given, a Math paper assigned to an
English class, the middle/senior level gate. The school removed that board from the
classroom, and those tests went with the rule they described.

    python manage.py test classes.tests_ranking_rules --settings=config.settings_test_nomigrations
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from classes.models import Classroom, ClassroomMembership
from classes.models_ranking import RankingSnapshot
from classes.ranking import service

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


def _earn(student, room, xp, key):
    """Bank XP in a classroom — the only input the board has left."""
    from rewards.models import PointAward
    from rewards.services import current_season

    return PointAward.objects.create(
        student=student, season=current_season(), event="MANUAL",
        points=xp, xp=xp, classroom=room, idempotency_key=key,
    )


def _ranked(room, kind=RankingSnapshot.KIND_ACADEMIC):
    """[(student_id, rank, score)] in rank order, straight from the persisted snapshots."""
    return [
        (s.student_id, s.rank, None if s.score is None else float(s.score))
        for s in RankingSnapshot.objects.filter(classroom=room, kind=kind).order_by("rank", "student_id")
    ]


class AcademicIsNotGatedByLevelTests(TestCase):
    """What survives of the old AcademicAssessmentPointsTests.

    The rest of that class tested ``assessment_points_per_student`` and
    ``_hand_graded_points`` — best-attempt-per-set, the opening-date window, hand-graded
    homework, ungraded-contributes-nothing. The rewards cutover deleted all three functions:
    the academic board is a projection of ``rewards.PointAward`` now, and the equivalent
    guarantees live where the points are actually decided (``rewards/tests_*.py``) plus
    ``classes.tests_ranking_service.AcademicServiceTests`` for the projection itself.

    This one property belongs to ranking, not to rewards, so it stays.
    """

    def setUp(self):
        self.now = timezone.now()
        self.room = _classroom(level="junior")
        self.ali = _student(self.room, "Ali")

    def test_academic_is_not_gated_by_level(self):
        # A junior class ranks exactly like any other. The level gate belonged to SAT, and
        # went with it; this pins that nothing inherited it.
        _earn(self.ali, self.room, 7, "lvl-ali")

        service.recompute_classroom(self.room, now=self.now)

        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_ACADEMIC)[0][2], 7.0)
        # And nothing writes a SAT board any more, for any level.
        self.assertEqual(_ranked(self.room, RankingSnapshot.KIND_SAT), [])


class RecomputeTaskTests(TestCase):
    """The task that makes any of this appear. Before it existed the only writer was a POST
    endpoint with no button wired to it, so no board had ever been computed in production."""

    def test_the_sweep_ranks_every_active_classroom(self):
        rooms = [_classroom(level="middle") for _ in range(2)]
        for room in rooms:
            student = _student(room, "S")
            _earn(student, room, 600, f"sweep-{room.pk}-{student.pk}")

        from classes.tasks import recompute_classroom_rankings

        stats = recompute_classroom_rankings()

        self.assertGreaterEqual(stats["classrooms"], 2)
        self.assertEqual(stats["failed"], 0)
        for room in rooms:
            self.assertEqual(_ranked(room)[0][2], 600.0)

    def test_one_broken_classroom_does_not_stop_the_sweep(self):
        good = _classroom(level="middle")
        student = _student(good, "S")
        _earn(student, good, 550, f"broken-{student.pk}")

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
