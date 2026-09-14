"""The classroom leaderboard is about the students in the class: ACTIVE memberships.

``GET /api/classes/<pk>/leaderboard/`` built its roster from every STUDENT membership, with no
status filter. Removal is a soft delete (``status=REMOVED``), so a student taken off the class
stayed on the board: in ``students``, in ``homework_grade_leaderboard.rows``, and in every figure
computed over them. That is the class size, each practice test's headcount, completion rate and
group mean, both class averages, and the graded-work bar a student has to clear to get a rank.

The teacher portal takes its student list from this response (``useTeacherAnalytics``), so
/teacher/students listed students who had left the class as the teacher's students, and scored
them.

An INVITED student has not joined the class yet. The classroom's student count, the gradebook,
class analytics, the class rankings and the homework emails count ACTIVE students only, and the
leaderboard now does too. Who may open the board is a separate rule, and it is unchanged: a member
whose membership is not REMOVED.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission, SubmissionReview
from classes.models_ranking import ClassroomRankingConfig
from exams.models import PracticeTest, TestAttempt

User = get_user_model()


def _ids(rows):
    return [row["user_id"] for row in rows]


def _row(rows, user):
    (row,) = [row for row in rows if row["user_id"] == user.id]
    return row


@override_settings(CLASSROOM_LEADERBOARD_MIN_REVIEWED_FOR_RANK=2)
class LeaderboardFixture(TestCase):
    """A math class with its teacher, two students in it, and Lola, who is not.

    ============  =============  ==========  ==========
                  practice test  essay       worksheet
    ============  =============  ==========  ==========
    Anna          1000           graded 80   —
    Boris         —              graded 60   —
    Lola          1600           graded 100  graded 100
    ============  =============  ==========  ==========

    Lola has the best results and the most graded work, so counting her moves every figure on the
    board and puts her first in both rankings. She joins as an ACTIVE student, and her membership
    changes to ``OUT_OF_CLASS`` at the end of ``setUp``: removing a student keeps the work they
    turned in. An invited student would not have work in the class; Lola keeps hers in that case
    too, so that the status alone decides.
    """

    OUT_OF_CLASS = ClassroomMembership.STATUS_REMOVED
    maxDiff = None

    def setUp(self):
        self.teacher = User.objects.create_user(
            "lb_teacher@t.com", "secret123", role=C.ROLE_TEACHER, subject=C.DOMAIN_MATH
        )
        self.classroom = Classroom.objects.create(
            name="Leaderboard", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.anna = self._student("lb_anna@t.com", "Anna")
        self.boris = self._student("lb_boris@t.com", "Boris")
        self.lola = self._student("lb_lola@t.com", "Lola")

        self.section = PracticeTest.objects.create(subject="MATH", title="Math section")
        self.practice = self._homework("Practice test", practice_test=self.section)
        essay = self._homework("Essay")
        worksheet = self._homework("Worksheet")

        self._practice_score(self.anna, 1000)
        self._practice_score(self.lola, 1600)
        self._graded(essay, self.anna, 80)
        self._graded(essay, self.boris, 60)
        self._graded(essay, self.lola, 100)
        self._graded(worksheet, self.lola, 100)

        ClassroomMembership.objects.filter(classroom=self.classroom, user=self.lola).update(
            status=self.OUT_OF_CLASS
        )

    def _student(self, email, first_name):
        user = User.objects.create_user(email, "secret123", role=C.ROLE_STUDENT, first_name=first_name)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT
        )
        return user

    def _homework(self, title, **fields):
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=title,
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED, **fields,
        )

    def _practice_score(self, student, score):
        # Completed with update(), not save(): a completed attempt's post_save auto-submits the
        # homework and auto-grades it, which would add the score to the student's grade average.
        attempt = TestAttempt.objects.create(practice_test=self.section, student=student)
        TestAttempt.objects.filter(pk=attempt.pk).update(
            is_completed=True, score=score, submitted_at=timezone.now()
        )
        Submission.objects.create(
            assignment=self.practice, student=student, attempt=attempt,
            status=Submission.STATUS_SUBMITTED, submitted_at=timezone.now(),
        )

    def _graded(self, assignment, student, grade):
        submission = Submission.objects.create(
            assignment=assignment, student=student,
            status=Submission.STATUS_REVIEWED, submitted_at=timezone.now(),
        )
        SubmissionReview.objects.create(submission=submission, teacher=self.teacher, grade=grade)

    def _configure(self, mode, hide_score_values=False):
        ClassroomRankingConfig.objects.update_or_create(
            classroom=self.classroom,
            defaults={"leaderboard_mode": mode, "hide_score_values": hide_score_values},
        )

    def _get(self, viewer):
        client = APIClient()
        client.force_authenticate(viewer)
        return client.get(f"/api/classes/{self.classroom.id}/leaderboard/")

    def _board(self, viewer=None):
        response = self._get(viewer or self.teacher)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


class StudentsInTheClassCases:
    """What the board shows when one student is not in the class. Mixed into a fixture per status."""

    def test_only_the_students_in_the_class_are_listed(self):
        data = self._board()

        self.assertEqual(
            {"students": _ids(data["students"]), "rows": _ids(data["homework_grade_leaderboard"]["rows"])},
            {"students": [self.anna.id, self.boris.id], "rows": [self.anna.id, self.boris.id]},
        )

    def test_the_class_size_is_the_students_in_the_class(self):
        data = self._board()

        (practice,) = data["assignments_summary"]
        self.assertEqual(
            {"student_count": data["student_count"], "student_headcount": practice["student_headcount"]},
            {"student_count": 2, "student_headcount": 2},
        )

    def test_practice_test_figures_count_the_students_in_the_class(self):
        data = self._board()

        (practice,) = data["assignments_summary"]
        self.assertEqual(
            {
                "completed_count": practice["completed_count"],
                "completion_rate_pct": practice["completion_rate_pct"],
                "group_mean_score": practice["group_mean_score"],
                "class_practice_average": data["class_practice_average"],
                "overall_group_mean_of_assignments": data["overall_group_mean_of_assignments"],
            },
            # Anna's 1000, out of Anna and Boris. Counting Lola: 2 of 3, and a mean of 1300.
            {
                "completed_count": 1,
                "completion_rate_pct": 50.0,
                "group_mean_score": 1000.0,
                "class_practice_average": 1000.0,
                "overall_group_mean_of_assignments": 1000.0,
            },
        )

    def test_the_class_grade_average_counts_the_students_in_the_class(self):
        board = self._board()["homework_grade_leaderboard"]

        # Anna's 80 and Boris's 60. With Lola's 100, it read 80.
        self.assertEqual(board["class_average_review_grade"], 70.0)

    def test_ranks_are_decided_among_the_students_in_the_class(self):
        data = self._board()

        board = data["homework_grade_leaderboard"]
        self.assertEqual(
            {
                "effective_min_reviewed_for_rank": board["effective_min_reviewed_for_rank"],
                "grade_ranks": [(row["user_id"], row["rank"], row["rank_confidence"]) for row in board["rows"]],
                "practice_ranks": [(row["user_id"], row["rank"]) for row in data["students"]],
            },
            # A rank needs as many graded pieces as the most-graded student has, capped by the
            # setting. Anna and Boris have one each; Lola's two left both of them without a rank.
            {
                "effective_min_reviewed_for_rank": 1,
                "grade_ranks": [(self.anna.id, 1, "high"), (self.boris.id, 2, "high")],
                "practice_ranks": [(self.anna.id, 1), (self.boris.id, 2)],
            },
        )

    def test_each_student_keeps_their_own_figures(self):
        # Green before the fix as well: taking one student off the board changes nothing about
        # the students who stay, apart from where they rank.
        data = self._board()

        anna = _row(data["students"], self.anna)
        self.assertEqual(
            (anna["practice_average"], anna["practice_completed_count"], anna["latest_practice"]["score"]),
            (1000.0, 1, 1000),
        )
        rows = data["homework_grade_leaderboard"]["rows"]
        self.assertEqual(
            [
                (
                    row["average_review_grade"],
                    row["graded_submission_count"],
                    row["classwork_turn_in_count"],
                    row["homework_completion_rate_pct"],
                )
                for row in (_row(rows, self.anna), _row(rows, self.boris))
            ],
            # Anna turned in the practice test and the essay, Boris the essay: 2 and 1 of 3.
            [(80.0, 1, 2, 66.7), (60.0, 1, 1, 33.3)],
        )

    # ── what a student sees, under the class's ranking settings ──────────────────

    def test_a_hidden_board_still_shows_a_student_their_own_row(self):
        # Green before the fix as well.
        self._configure(ClassroomRankingConfig.MODE_HIDDEN)

        data = self._board(self.anna)

        self.assertEqual(_ids(data["students"]), [self.anna.id])
        self.assertEqual(_ids(data["homework_grade_leaderboard"]["rows"]), [self.anna.id])

    def test_an_anonymous_board_has_no_row_for_a_student_not_in_the_class(self):
        self._configure(ClassroomRankingConfig.MODE_ANONYMOUS)

        data = self._board(self.anna)

        for key, rows in (("students", data["students"]), ("rows", data["homework_grade_leaderboard"]["rows"])):
            with self.subTest(key):
                self.assertEqual(
                    [(row["user_id"], row["first_name"]) for row in rows],
                    [(self.anna.id, "Anna"), (self.boris.id, "")],
                )

    def test_a_board_without_scores_leaves_a_student_their_own(self):
        self._configure(ClassroomRankingConfig.MODE_FULL, hide_score_values=True)

        data = self._board(self.anna)

        self.assertEqual(
            [(row["user_id"], row["practice_average"], row["average_review_grade"]) for row in data["students"]],
            [(self.anna.id, 1000.0, 80.0), (self.boris.id, None, None)],
        )
        self.assertEqual(
            [(row["user_id"], row["average_review_grade"]) for row in data["homework_grade_leaderboard"]["rows"]],
            [(self.anna.id, 80.0), (self.boris.id, None)],
        )


class RemovedStudentLeaderboardTests(StudentsInTheClassCases, LeaderboardFixture):
    """Lola was taken off the class."""

    OUT_OF_CLASS = ClassroomMembership.STATUS_REMOVED

    def test_a_removed_student_cannot_open_the_board(self):
        # Green before the fix as well: the fix is to who is on the board, not to who may see it.
        # 403, not 404: ``ClassroomViewSet.get_object`` answers 403 for a classroom that exists.
        self.assertEqual(self._get(self.lola).status_code, 403)


class InvitedStudentLeaderboardTests(StudentsInTheClassCases, LeaderboardFixture):
    """Lola was invited to the class and has not joined."""

    OUT_OF_CLASS = ClassroomMembership.STATUS_INVITED

    def test_an_invited_student_may_open_the_board_but_is_not_on_it(self):
        # The class rankings (``/rankings/<kind>/``) treat an invited student the same way.
        data = self._board(self.lola)

        self.assertEqual(_ids(data["students"]), [self.anna.id, self.boris.id])
        self.assertEqual(_ids(data["homework_grade_leaderboard"]["rows"]), [self.anna.id, self.boris.id])
        self.assertEqual(data["student_count"], 2)
