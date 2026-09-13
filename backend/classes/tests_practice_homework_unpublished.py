"""A pastpaper homework reaches a class once it is PUBLISHED, and only its ACTIVE students.

A student never opens a homework's practice test by homework id. They start it from the
practice library, whose one gate is ``PracticeTest.assigned_users``
(``PracticeTestViewSet.get_queryset`` lists it, ``TestAttemptViewSet.create`` starts it). PR
#195 closed the by-id routes, ``submit`` and ``my-submission``. This covers the library route
and the auto-grade that follows it.

Two writers ignored both the homework's status and the student's membership status:

* ``grant_practice_test_library_access_for_assignment`` ran on every create and edit, draft or
  not, for every STUDENT membership, REMOVED and INVITED included. "Save as draft" opened the
  test to the whole class at once. The join grant walked drafts and archived work too.
* ``sync_homework_after_test_attempt_saved`` (post_save on a finished TestAttempt) walked every
  homework of every class the student was ever in. Finishing the test auto-graded a DRAFT, and a
  retake re-graded ARCHIVED work, which the model documents as read-only. The teacher's
  ``submissions`` GET lazily ran the same sync over the same homework.

``publish`` and ``unarchive`` never ran the grant: they never had to, because saving the draft
already had. A fix that only gated the grant would leave published pastpaper homework
unopenable, so those paths are tested here end to end.
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from exams.models import Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


class PracticeHomeworkFixture(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            email="t_pp_unpublished@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.student = self._student("st_pp_unpublished@example.com")
        self.section = self._section("Section A")
        self.client = APIClient()

    # ── people and content ──────────────────────────────────────────────────

    def _account(self, email):
        return User.objects.create_user(
            email=email, password="x", role=acc_const.ROLE_STUDENT, subject=""
        )

    def _student(self, email, status=ClassroomMembership.STATUS_ACTIVE):
        user = self._account(email)
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    @staticmethod
    def _section(title):
        # Questions included: the library hides a section with none, and it cannot be started.
        section = PracticeTest.objects.create(
            mock_exam=None, subject="MATH", title=title,
            form_type="INTERNATIONAL", skip_default_modules=True,
        )
        Module.objects.create(practice_test=section, module_order=1, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(section)
        return section

    def _homework(self, status, section=None):
        """A homework row written directly, so no view or serializer has granted anything."""
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=f"{status} pastpaper",
            instructions="Do the section.", category=Assignment.CATEGORY_HOMEWORK,
            status=status, practice_test=section or self.section,
        )

    # ── the teacher, through the API ────────────────────────────────────────

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def _create(self, status, section=None):
        # What AssignmentForm.tsx sends: multipart, the id list as a JSON string, and the button's
        # status. "Save as draft" sends DRAFT.
        r = self._as(self.teacher).post(
            f"/api/classes/{self.classroom.id}/assignments/",
            {
                "title": "Pastpaper homework",
                "instructions": "Do the section.",
                "category": Assignment.CATEGORY_HOMEWORK,
                "practice_test_ids": json.dumps([(section or self.section).pk]),
                "practice_scope": Assignment.PRACTICE_SCOPE_BOTH,
                "allow_file_upload": "false",
                "status": status,
            },
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.content)
        assignment = Assignment.objects.get(pk=r.json()["id"])
        self.assertEqual(assignment.status, status)
        return assignment

    def _lifecycle(self, assignment, action):
        r = self._as(self.teacher).post(
            f"/api/classes/{self.classroom.id}/assignments/{assignment.id}/{action}/"
        )
        self.assertEqual(r.status_code, 200, r.content)
        assignment.refresh_from_db()

    def _teacher_submissions(self, assignment):
        r = self._as(self.teacher).get(
            f"/api/classes/{self.classroom.id}/assignments/{assignment.id}/submissions/"
        )
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    # ── the student, through the library ────────────────────────────────────

    def _library(self, student):
        r = self._as(student).get(reverse("practice-test-list"))
        self.assertEqual(r.status_code, 200, r.content)
        return {row["id"] for row in r.json()}

    def _start(self, student, section):
        return self._as(student).post(
            "/api/exams/attempts/", {"practice_test": section.pk}, format="json"
        )

    def _assert_cannot_open(self, student, section=None):
        section = section or self.section
        self.assertNotIn(section.pk, self._library(student))
        r = self._start(student, section)
        self.assertEqual(r.status_code, 404, r.content)

    def _assert_can_open(self, student, section=None):
        section = section or self.section
        self.assertIn(section.pk, self._library(student))
        r = self._start(student, section)
        self.assertIn(r.status_code, (200, 201), r.content)

    # ── finished tests ──────────────────────────────────────────────────────

    def _attempt(self, student, score):
        now = timezone.now()
        return TestAttempt(
            practice_test=self.section, student=student, score=score,
            current_state=TestAttempt.STATE_COMPLETED, is_completed=True,
            completed_at=now, submitted_at=now,
        )

    def _finish(self, student, score):
        """A finished attempt, saved the ordinary way, so the post_save sync runs."""
        attempt = self._attempt(student, score)
        attempt.save()
        return attempt

    def _finish_unseen(self, student, score):
        """The same finished attempt written with no post_save. Only a lazy sync can find it."""
        (attempt,) = TestAttempt.objects.bulk_create([self._attempt(student, score)])
        return attempt

    def _submission(self, assignment, student):
        return (
            Submission.objects.filter(assignment=assignment, student=student)
            .select_related("review")
            .first()
        )


class LibraryAccessFollowsPublishedHomeworkTests(PracticeHomeworkFixture):
    def test_saving_a_draft_does_not_open_its_test(self):
        self._create(Assignment.STATUS_DRAFT)
        self._assert_cannot_open(self.student)

    def test_editing_a_draft_does_not_open_its_test(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        r = self._as(self.teacher).patch(
            f"/api/classes/{self.classroom.id}/assignments/{draft.id}/",
            {"title": "Renamed draft"}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self._assert_cannot_open(self.student)

    def test_publishing_a_draft_opens_its_test(self):
        draft = self._create(Assignment.STATUS_DRAFT)
        self._assert_cannot_open(self.student)

        self._lifecycle(draft, "publish")

        self._assert_can_open(self.student)

    def test_unarchiving_a_never_published_draft_opens_its_test(self):
        # unarchive always lands on PUBLISHED, whatever the homework was before it was archived.
        draft = self._create(Assignment.STATUS_DRAFT)
        self._lifecycle(draft, "archive")
        self._assert_cannot_open(self.student)

        self._lifecycle(draft, "unarchive")

        self.assertEqual(draft.status, Assignment.STATUS_PUBLISHED)
        self._assert_can_open(self.student)

    def test_a_student_who_joins_while_it_is_archived_gets_it_when_it_is_unarchived(self):
        homework = self._create(Assignment.STATUS_PUBLISHED)
        self._assert_can_open(self.student)
        self._lifecycle(homework, "archive")

        newcomer = self._account("newcomer_pp_unpublished@example.com")
        r = self._as(newcomer).post(
            "/api/classes/join/", {"join_code": self.classroom.join_code}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)
        self._assert_cannot_open(newcomer)

        self._lifecycle(homework, "unarchive")

        self._assert_can_open(newcomer)

    def test_joining_opens_published_homework_only(self):
        draft_section = self._section("Draft section")
        archived_section = self._section("Archived section")
        self._homework(Assignment.STATUS_PUBLISHED)
        self._homework(Assignment.STATUS_DRAFT, section=draft_section)
        self._homework(Assignment.STATUS_ARCHIVED, section=archived_section)

        newcomer = self._account("joiner_pp_unpublished@example.com")
        r = self._as(newcomer).post(
            "/api/classes/join/", {"join_code": self.classroom.join_code}, format="json"
        )
        self.assertEqual(r.status_code, 200, r.content)

        self._assert_can_open(newcomer)
        self._assert_cannot_open(newcomer, draft_section)
        self._assert_cannot_open(newcomer, archived_section)

    def test_removed_and_invited_students_are_not_given_the_test(self):
        removed = self._student("removed_pp_unpublished@example.com", ClassroomMembership.STATUS_REMOVED)
        invited = self._student("invited_pp_unpublished@example.com", ClassroomMembership.STATUS_INVITED)

        self._create(Assignment.STATUS_PUBLISHED)

        self._assert_can_open(self.student)
        self._assert_cannot_open(removed)
        self._assert_cannot_open(invited)

    def test_a_reinstated_student_gets_homework_published_while_they_were_removed(self):
        removed = self._student("back_pp_unpublished@example.com", ClassroomMembership.STATUS_REMOVED)
        self._create(Assignment.STATUS_PUBLISHED)
        self._assert_cannot_open(removed)

        r = self._as(self.teacher).patch(
            f"/api/classes/{self.classroom.id}/members/{removed.id}/",
            {"status": ClassroomMembership.STATUS_ACTIVE}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)

        self._assert_can_open(removed)


class AutoGradeFollowsPublishedHomeworkTests(PracticeHomeworkFixture):
    """Every student here can already start the section: it reached them some other way, a
    library bulk-assign or an older homework. What is under test is only what finishing it
    writes to THIS homework."""

    def setUp(self):
        super().setUp()
        self.section.assigned_users.add(self.student)

    def test_finishing_the_test_does_not_grade_a_draft(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        self._finish(self.student, 600)
        self.assertIsNone(self._submission(draft, self.student))

    def test_publishing_grades_work_finished_while_it_was_a_draft(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        attempt = self._finish(self.student, 600)
        self.assertIsNone(self._submission(draft, self.student))

        self._lifecycle(draft, "publish")

        # At publish, not whenever somebody next opens a page that syncs lazily: interventions
        # and the gradebook read Submission rows and would list the student as missing.
        sub = self._submission(draft, self.student)
        self.assertIsNotNone(sub)
        self.assertEqual(
            (sub.status, sub.attempt_id, sub.review.is_auto, float(sub.review.grade)),
            (Submission.STATUS_REVIEWED, attempt.pk, True, 600.0),
        )

    def test_archived_grades_hold_still_until_the_homework_is_unarchived(self):
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        first = self._finish(self.student, 500)
        graded = self._submission(homework, self.student)
        self.assertEqual((graded.status, graded.attempt_id), (Submission.STATUS_REVIEWED, first.pk))

        self._lifecycle(homework, "archive")
        retake = self._finish(self.student, 700)

        # ARCHIVED is read-only with its grades retained (Assignment.STATUS_* comment).
        held = self._submission(homework, self.student)
        self.assertEqual(
            (held.status, held.attempt_id, float(held.review.grade), held.revision, held.updated_at),
            (graded.status, first.pk, 500.0, graded.revision, graded.updated_at),
        )

        self._lifecycle(homework, "unarchive")

        # Live again, so it tracks the latest attempt, as published homework always has.
        live = self._submission(homework, self.student)
        self.assertEqual((live.attempt_id, float(live.review.grade)), (retake.pk, 700.0))

    def test_finishing_after_the_homework_is_archived_hands_nothing_in(self):
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        self._lifecycle(homework, "archive")
        self._finish(self.student, 650)
        self.assertIsNone(self._submission(homework, self.student))

    def test_removed_and_invited_students_finishing_hand_nothing_in(self):
        removed = self._student("removed_ag_unpublished@example.com", ClassroomMembership.STATUS_REMOVED)
        invited = self._student("invited_ag_unpublished@example.com", ClassroomMembership.STATUS_INVITED)
        self.section.assigned_users.add(removed, invited)
        homework = self._homework(Assignment.STATUS_PUBLISHED)

        self._finish(removed, 640)
        self._finish(invited, 660)
        self._finish(self.student, 680)

        self.assertIsNone(self._submission(homework, removed))
        self.assertIsNone(self._submission(homework, invited))
        # Control: the same finish still hands in for an active student.
        self.assertEqual(
            self._submission(homework, self.student).status, Submission.STATUS_REVIEWED
        )


class TeacherSubmissionsListSyncsLiveHomeworkOnlyTests(PracticeHomeworkFixture):
    """``GET submissions`` is the teacher's lazy sync: it runs the practice sync for the class
    before listing. A GET that writes must not write to work that is not live."""

    def test_a_draft_is_not_synced(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        self._finish_unseen(self.student, 600)

        rows = self._teacher_submissions(draft)

        self.assertEqual(rows, [])
        self.assertIsNone(self._submission(draft, self.student))

    def test_archived_work_is_not_regraded(self):
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        first = self._finish(self.student, 500)
        graded = self._submission(homework, self.student)
        self._lifecycle(homework, "archive")
        self._finish_unseen(self.student, 700)

        self._teacher_submissions(homework)

        held = self._submission(homework, self.student)
        self.assertEqual(
            (held.attempt_id, float(held.review.grade), held.revision, held.updated_at),
            (first.pk, 500.0, graded.revision, graded.updated_at),
        )

    def test_removed_students_are_not_synced(self):
        removed = self._student("removed_list_unpublished@example.com", ClassroomMembership.STATUS_REMOVED)
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        self._finish_unseen(removed, 610)
        self._finish_unseen(self.student, 620)

        rows = self._teacher_submissions(homework)

        self.assertIsNone(self._submission(homework, removed))
        # Control, and proof the list really does sync: the active student's unseen finish
        # becomes an auto-graded submission.
        self.assertEqual([row["student"]["id"] for row in rows], [self.student.id])
        self.assertEqual(self._submission(homework, self.student).status, Submission.STATUS_REVIEWED)
