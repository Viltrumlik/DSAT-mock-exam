"""A student cannot turn in, save to, or change work on a DRAFT or ARCHIVED homework.

``AssignmentViewSet.submit`` loaded the assignment by id, then checked membership, the
STUDENT role and the due-date lock. It never read ``assignment.status``. Students never see
DRAFT or ARCHIVED work — the classroom list, the detail route and ``my-assignments`` all
filter to PUBLISHED — yet any student of the class could POST ``submit/`` for one and create
or change a Submission. The due-date lock was no protection: homework gets its ``due_at``
when it is created, draft or not (``homework_due_at``).

``my-submission`` had the same gap, and it is a GET that writes: for a student it runs the
lazy practice/assessment sync, which creates an auto-graded Submission.

Both now answer a student the way the detail route does: unpublished work is a 404, and the
same 404 as an id that does not exist.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Assignment, Classroom, ClassroomMembership, Submission

User = get_user_model()


class UnpublishedHomeworkFixture(TestCase):
    def setUp(self):
        # A throwaway MEDIA_ROOT, so a test can also prove a refused upload was never stored.
        self.media_root = tempfile.mkdtemp(prefix="submit_unpublished_")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        media = self.settings(MEDIA_ROOT=self.media_root)
        media.enable()
        self.addCleanup(media.disable)

        self.teacher = User.objects.create_user(
            email="t_submit_gate@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.student = User.objects.create_user(
            email="st_submit_gate@example.com", password="x",
            role=acc_const.ROLE_STUDENT, subject="",
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student, role=ClassroomMembership.ROLE_STUDENT
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _homework(self, status, **fields):
        # Every homework here is still open. A real one has a deadline from the moment it is
        # created, draft or not, so the due-date lock must not be what refuses these.
        return Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=f"{status} homework",
            category=Assignment.CATEGORY_HOMEWORK, allow_file_upload=True, status=status,
            due_at=timezone.now() + timedelta(days=2), **fields,
        )

    def _url(self, assignment_id, action=None):
        base = f"/api/classes/{self.classroom.id}/assignments/{assignment_id}/"
        return f"{base}{action}/" if action else base

    def _submit(self, assignment_id, **data):
        return self.client.post(self._url(assignment_id, "submit"), data, format="multipart")

    def _as_teacher(self, assignment, action):
        self.client.force_authenticate(self.teacher)
        r = self.client.post(self._url(assignment.id, action))
        self.client.force_authenticate(self.student)
        self.assertEqual(r.status_code, 200, r.content)

    def _stored_files(self):
        return [name for _dir, _subdirs, names in os.walk(self.media_root) for name in names]

    @staticmethod
    def _pdf(name="work.pdf"):
        return SimpleUploadedFile(name, b"%PDF-1.4 test", content_type="application/pdf")


class SubmitRequiresPublishedHomeworkTests(UnpublishedHomeworkFixture):
    def _assert_refused(self, assignment, **data):
        r = self._submit(assignment.id, **data)
        self.assertEqual(r.status_code, 404, r.content)
        self.assertFalse(Submission.objects.filter(assignment=assignment).exists())
        self.assertEqual(self._stored_files(), [])

    def test_draft_homework_cannot_be_turned_in_or_saved_to(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        self._assert_refused(draft, submit="true", files=self._pdf())
        # submit=false keeps work without turning it in. It writes the same rows.
        self._assert_refused(draft, submit="false", files=self._pdf())

    def test_archived_homework_cannot_be_turned_in_or_saved_to(self):
        archived = self._homework(Assignment.STATUS_ARCHIVED)
        self._assert_refused(archived, submit="true", files=self._pdf())
        self._assert_refused(archived, submit="false", files=self._pdf())

    def test_work_turned_in_before_archiving_is_left_exactly_as_it_was(self):
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        r = self._submit(homework.id, submit="true", files=self._pdf())
        self.assertEqual(r.status_code, 200, r.content)
        before = Submission.objects.get(assignment=homework, student=self.student)
        file_ids = list(before.files.values_list("id", flat=True))
        self.assertEqual((before.status, len(file_ids)), (Submission.STATUS_SUBMITTED, 1))

        self._as_teacher(homework, "archive")

        # Turned-in work stays editable until the deadline, which has not passed, so the
        # status is the only thing standing between the student and these two changes.
        r_remove = self._submit(homework.id, submit="false", remove_file_ids=f"[{file_ids[0]}]")
        self.assertEqual(r_remove.status_code, 404, r_remove.content)
        r_add = self._submit(homework.id, submit="true", files=self._pdf("more.pdf"))
        self.assertEqual(r_add.status_code, 404, r_add.content)

        after = Submission.objects.get(pk=before.pk)
        self.assertEqual(
            (after.status, after.revision, after.updated_at, list(after.files.values_list("id", flat=True))),
            (before.status, before.revision, before.updated_at, file_ids),
        )
        self.assertEqual(len(self._stored_files()), 1)

    def test_unpublished_homework_answers_like_one_that_does_not_exist(self):
        # The 404 is deliberate: the detail route already gives a student this exact answer
        # for a draft, so submit must not be the one route that confirms the id exists.
        draft = self._homework(Assignment.STATUS_DRAFT)
        missing_id = draft.id + 10_000

        detail = self.client.get(self._url(draft.id))
        on_draft = self._submit(draft.id, submit="true", files=self._pdf())
        on_missing = self._submit(missing_id, submit="true", files=self._pdf())

        self.assertEqual(detail.status_code, 404)
        self.assertEqual((on_draft.status_code, on_draft.json()), (404, detail.json()))
        self.assertEqual((on_missing.status_code, on_missing.json()), (404, detail.json()))

    def test_published_homework_still_takes_a_turn_in(self):
        # Control: the gate must not break the normal path.
        homework = self._homework(Assignment.STATUS_PUBLISHED)
        r = self._submit(homework.id, submit="true", files=self._pdf())
        self.assertEqual(r.status_code, 200, r.content)
        sub = Submission.objects.get(assignment=homework, student=self.student)
        self.assertEqual((sub.status, sub.files.count()), (Submission.STATUS_SUBMITTED, 1))
        self.assertEqual(len(self._stored_files()), 1)

    def test_publishing_a_draft_opens_it_for_turn_in(self):
        draft = self._homework(Assignment.STATUS_DRAFT)
        self._assert_refused(draft, submit="true", files=self._pdf())

        self._as_teacher(draft, "publish")

        r = self._submit(draft.id, submit="true", files=self._pdf())
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            Submission.objects.get(assignment=draft, student=self.student).status,
            Submission.STATUS_SUBMITTED,
        )


class MySubmissionRequiresPublishedHomeworkTests(UnpublishedHomeworkFixture):
    """``my-submission`` is a GET, but for a student it runs the lazy sync, and that writes."""

    def setUp(self):
        super().setUp()
        from exams.models import PracticeTest, TestAttempt

        self.practice_test = PracticeTest.objects.create(mock_exam=None, subject="MATH", title="Section")
        # Finished BEFORE any homework targets it, so the post_save sync has nothing to attach
        # it to. Only the lazy sync inside my-submission can.
        TestAttempt.objects.create(
            practice_test=self.practice_test, student=self.student, is_completed=True, score=90,
        )

    def _my_submission(self, homework):
        return self.client.get(self._url(homework.id, "my-submission"))

    def test_draft_homework_is_a_404_and_nothing_is_synced(self):
        draft = self._homework(Assignment.STATUS_DRAFT, practice_test=self.practice_test)
        r = self._my_submission(draft)
        self.assertEqual(r.status_code, 404, r.content)
        self.assertFalse(Submission.objects.filter(assignment=draft).exists())

    def test_archived_homework_is_a_404_and_nothing_is_synced(self):
        archived = self._homework(Assignment.STATUS_ARCHIVED, practice_test=self.practice_test)
        r = self._my_submission(archived)
        self.assertEqual(r.status_code, 404, r.content)
        self.assertFalse(Submission.objects.filter(assignment=archived).exists())

    def test_published_homework_still_syncs_the_finished_test(self):
        # Control, and proof the fixture really does sync: on published work the same finished
        # attempt becomes an auto-graded submission.
        homework = self._homework(Assignment.STATUS_PUBLISHED, practice_test=self.practice_test)
        r = self._my_submission(homework)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["status"], Submission.STATUS_REVIEWED)
        self.assertTrue(Submission.objects.filter(assignment=homework, student=self.student).exists())
