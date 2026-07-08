from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess

from classes.models import (
    Classroom,
    ClassroomMembership,
    ClassPost,
    Assignment,
    Submission,
    assignment_target_practice_test_ids,
)
from classes.serializers import AssignmentSerializer

User = get_user_model()


class AssignmentTargetIdsTests(TestCase):
    def test_practice_test_ids_skips_bad_entries(self):
        admin = User.objects.create_user("targets@test.com", "secret123")
        c = Classroom.objects.create(
            name="T",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=admin,
        )
        a = Assignment.objects.create(
            classroom=c,
            created_by=admin,
            title="t",
            practice_test_ids=[1, "2", "x", None],
        )
        self.assertEqual(assignment_target_practice_test_ids(a), [1, 2])


class AssignmentPracticeAccessSyncTests(TestCase):
    """Homework targeting standalone practice tests must add class students to assigned_users."""

    def setUp(self):
        from exams.models import PracticeTest

        self.admin = User.objects.create_user("apas_admin@test.com", "secret123")
        self.student = User.objects.create_user("apas_student@test.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="C",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.admin, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.pt = PracticeTest.objects.create(
            mock_exam=None,
            subject="READING_WRITING",
            title="Standalone section",
        )

    def test_create_assignment_adds_students_to_practice_test_assigned_users(self):
        ser = AssignmentSerializer(data={"title": "Pastpaper HW", "instructions": "Complete the section.", "practice_test": self.pt.pk})
        ser.is_valid(raise_exception=True)
        ser.save(classroom=self.classroom, created_by=self.admin)
        self.assertTrue(self.pt.assigned_users.filter(pk=self.student.pk).exists())

    def test_view_module_resolves_grant_helper(self):
        """Regression: AssignmentViewSet.create() calls
        grant_practice_test_library_access_for_assignment, so that name must be
        bound in the view module. It previously was not imported, so the call
        raised NameError that a bare ``except Exception: pass`` swallowed."""
        from classes import views

        self.assertTrue(callable(views.grant_practice_test_library_access_for_assignment))

    def test_create_assignment_via_api_grants_practice_library_access(self):
        """End-to-end contract: POSTing an assignment that targets a standalone
        practice test must unlock that test for the class students on the global
        practice library (assigned_users)."""
        client = APIClient()
        client.force_authenticate(self.admin)
        resp = client.post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {"title": "Pastpaper HW", "instructions": "Complete the section.", "practice_test": self.pt.pk},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertTrue(self.pt.assigned_users.filter(pk=self.student.pk).exists())


class PracticeHomeworkAutoSubmitTests(TestCase):
    """Practice-linked homework: no file uploads; completed attempts auto-submit."""

    def setUp(self):
        from exams.models import PracticeTest, TestAttempt

        self.client = APIClient()
        self.admin = User.objects.create_user("ph_auto_admin@test.com", "secret123")
        self.student = User.objects.create_user("ph_auto_student@test.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Auto class",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.admin, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.pt = PracticeTest.objects.create(
            mock_exam=None,
            subject="READING_WRITING",
            title="Section",
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.admin,
            title="Pastpaper HW",
            practice_test=self.pt,
        )
        self._TestAttempt = TestAttempt

    def test_completed_attempt_auto_grades_submission(self):
        # Auto-graded homework moves straight to REVIEWED (never sits in "Needs grading").
        att = self._TestAttempt.objects.create(
            practice_test=self.pt,
            student=self.student,
            is_completed=True,
        )
        sub = Submission.objects.filter(assignment=self.assignment, student=self.student).first()
        self.assertIsNotNone(sub)
        self.assertEqual(sub.status, Submission.STATUS_REVIEWED)
        self.assertEqual(sub.attempt_id, att.pk)
        self.assertTrue(sub.review.is_auto)

    def test_student_can_upload_files_alongside_practice_homework(self):
        self.client.force_authenticate(self.student)
        pdf = SimpleUploadedFile("work.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        url = f"/api/classes/{self.classroom.pk}/assignments/{self.assignment.pk}/submit/"
        r = self.client.post(
            url,
            {"submit": "false", "files": pdf},
            format="multipart",
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertGreaterEqual(len(data.get("files") or []), 1)


class ClassroomSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("admin_scope@test.com", "secret123")
        self.other = User.objects.create_user("other_scope@test.com", "secret123")
        self.student = User.objects.create_user("student_scope@test.com", "secret123")

        self.classroom = Classroom.objects.create(
            name="Scoped class",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.admin, role=ClassroomMembership.ROLE_ADMIN
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )

        self.assignment = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.admin,
            title="HW1",
        )
        self.submission = Submission.objects.create(
            assignment=self.assignment,
            student=self.student,
            status=Submission.STATUS_SUBMITTED,
        )

    def test_submissions_list_forbidden(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get("/api/classes/submissions/")
        self.assertEqual(r.status_code, 403)

    def test_submission_detail_requires_class_admin(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get(f"/api/classes/submissions/{self.submission.pk}/")
        self.assertEqual(r.status_code, 200)

        self.client.force_authenticate(self.other)
        r2 = self.client.get(f"/api/classes/submissions/{self.submission.pk}/")
        self.assertEqual(r2.status_code, 403)

    def test_student_cannot_delete_announcement(self):
        post = ClassPost.objects.create(
            classroom=self.classroom,
            author=self.admin,
            content="<p>Hello</p>",
        )
        self.client.force_authenticate(self.student)
        r = self.client.delete(f"/api/classes/{self.classroom.pk}/posts/{post.pk}/")
        self.assertEqual(r.status_code, 403)
        self.assertTrue(ClassPost.objects.filter(pk=post.pk).exists())

    def test_student_list_only_member_classes(self):
        other_class = Classroom.objects.create(
            name="Other class",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=other_class, user=self.other, role=ClassroomMembership.ROLE_ADMIN
        )
        self.client.force_authenticate(self.student)
        r = self.client.get("/api/classes/")
        self.assertEqual(r.status_code, 200)
        rows = r.json()
        self.assertIsInstance(rows, list)
        ids = {row["id"] for row in rows}
        self.assertIn(self.classroom.pk, ids)
        self.assertNotIn(other_class.pk, ids)

    def test_stream_hides_peer_submissions_from_students(self):
        # A second student submits work; the signal creates a submission stream item.
        peer = User.objects.create_user("peer_scope@test.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=peer, role=ClassroomMembership.ROLE_STUDENT
        )
        peer_sub = Submission.objects.create(
            assignment=self.assignment, student=peer, status=Submission.STATUS_SUBMITTED,
        )
        url = f"/api/classes/{self.classroom.pk}/stream/"

        # The plain student must not see a classmate's submission (identity/grade/files),
        # but keeps their own submission item.
        self.client.force_authenticate(self.student)
        results = self.client.get(url).json()["results"]
        sub_ids = {r["submission"]["id"] for r in results if "submission" in r}
        self.assertNotIn(peer_sub.id, sub_ids)
        self.assertIn(self.submission.id, sub_ids)

        # Teaching staff still see the whole class's submissions.
        self.client.force_authenticate(self.admin)
        staff_ids = {r["submission"]["id"] for r in self.client.get(url).json()["results"] if "submission" in r}
        self.assertIn(peer_sub.id, staff_ids)


class LeaderboardVisibilityTests(TestCase):
    """The classroom leaderboard must honor ClassroomRankingConfig for non-staff viewers."""

    def setUp(self):
        from exams.models import PracticeTest, TestAttempt
        from classes.models_ranking import ClassroomRankingConfig

        self.RankingConfig = ClassroomRankingConfig
        self.client = APIClient()
        self.owner = User.objects.create_user("lb_owner@test.com", "secret123")
        self.s1 = User.objects.create_user("lb_s1@test.com", "secret123")
        self.s2 = User.objects.create_user("lb_s2@test.com", "secret123")
        self.s2.first_name, self.s2.last_name = "Peer", "Two"
        self.s2.save(update_fields=["first_name", "last_name"])

        self.classroom = Classroom.objects.create(
            name="LB class", subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        for s in (self.s1, self.s2):
            ClassroomMembership.objects.create(
                classroom=self.classroom, user=s, role=ClassroomMembership.ROLE_STUDENT
            )
        self.pt = PracticeTest.objects.create(mock_exam=None, subject="READING_WRITING", title="Sec")
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.owner, title="HW", practice_test=self.pt,
        )
        # s2 has a graded practice score; s1 has none. The completed attempt auto-submits.
        TestAttempt.objects.create(
            practice_test=self.pt, student=self.s2, is_completed=True, score=90,
        )
        self.cfg, _ = ClassroomRankingConfig.objects.get_or_create(classroom=self.classroom)
        self.url = f"/api/classes/{self.classroom.pk}/leaderboard/"

    def _rows(self, user):
        self.client.force_authenticate(user)
        return self.client.get(self.url).json()["students"]

    def _row_for(self, rows, uid):
        return next((r for r in rows if r["user_id"] == uid), None)

    def test_full_mode_exposes_everything_to_students(self):
        self.cfg.leaderboard_mode = self.RankingConfig.MODE_FULL
        self.cfg.hide_score_values = False
        self.cfg.save()
        peer = self._row_for(self._rows(self.s1), self.s2.id)
        self.assertIsNotNone(peer)
        self.assertEqual(peer["email"], self.s2.email)
        self.assertEqual(peer["practice_average"], 90)

    def test_hidden_mode_shows_only_own_row(self):
        self.cfg.leaderboard_mode = self.RankingConfig.MODE_HIDDEN
        self.cfg.save()
        rows = self._rows(self.s1)
        self.assertEqual([r["user_id"] for r in rows], [self.s1.id])

    def test_anonymous_mode_strips_peer_identity(self):
        self.cfg.leaderboard_mode = self.RankingConfig.MODE_ANONYMOUS
        self.cfg.save()
        rows = self._rows(self.s1)
        peer = self._row_for(rows, self.s2.id)
        self.assertEqual(peer["email"], "")
        self.assertEqual(peer["first_name"], "")
        self.assertEqual(self._row_for(rows, self.s1.id)["email"], self.s1.email)  # own kept

    def test_hide_scores_omits_peer_scores(self):
        self.cfg.leaderboard_mode = self.RankingConfig.MODE_FULL
        self.cfg.hide_score_values = True
        self.cfg.save()
        peer = self._row_for(self._rows(self.s1), self.s2.id)
        self.assertEqual(peer["email"], self.s2.email)  # identity kept in FULL mode
        self.assertIsNone(peer["practice_average"])

    def test_staff_sees_full_board_regardless_of_config(self):
        self.cfg.leaderboard_mode = self.RankingConfig.MODE_HIDDEN
        self.cfg.hide_score_values = True
        self.cfg.save()
        peer = self._row_for(self._rows(self.owner), self.s2.id)
        self.assertIsNotNone(peer)
        self.assertEqual(peer["email"], self.s2.email)
        self.assertEqual(peer["practice_average"], 90)


class ClassroomListDirectoryTests(TestCase):
    """Global assign staff should list all classrooms for homework / admin flows."""

    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(
            email="dir_owner@example.com",
            password="secret123",
            role=acc_const.ROLE_TEACHER,
            subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.owner,
            subject=acc_const.DOMAIN_MATH,
            classroom=None,
            granted_by=self.owner,
        )
        self.super_admin = User.objects.create_user(
            email="dir_super@example.com",
            password="secret123",
            role=acc_const.ROLE_SUPER_ADMIN,
        )
        self.classroom = Classroom.objects.create(
            name="Remote class",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )

    def test_super_admin_lists_all_classrooms_without_membership(self):
        self.assertFalse(
            ClassroomMembership.objects.filter(classroom=self.classroom, user=self.super_admin).exists()
        )
        self.client.force_authenticate(self.super_admin)
        r = self.client.get("/api/classes/directory/")
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertIsInstance(data, list)
        ids = {row["id"] for row in data}
        self.assertIn(self.classroom.pk, ids)

    def test_student_cannot_list_directory_even_with_flag(self):
        student = User.objects.create_user(
            email="dir_student@example.com",
            password="secret123",
            role=acc_const.ROLE_STUDENT,
        )
        self.client.force_authenticate(student)
        r = self.client.get("/api/classes/directory/")
        self.assertEqual(r.status_code, 403)
