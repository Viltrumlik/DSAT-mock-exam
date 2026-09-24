"""The limits a homework submission is held to, as the upload panel is told them.

The panel refuses an over-limit batch before it sends, which only helps if the numbers it refuses
by are the ones this service enforces. They used to be copied into the frontend by hand, so an
environment variable that lowered a limit here left a student being told their batch was fine and
losing it at the end of the upload. These assert the payload reads settings — and that the batch
figure it advertises is one the proxy in front of Django will actually pass.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from classes.models import Assignment, Classroom, ClassroomMembership
from classes.submission_limits import submission_limits_payload

User = get_user_model()

MB = 1024 * 1024


class SubmissionLimitsPayloadTests(TestCase):
    @override_settings(
        CLASSROOM_SUBMISSION_MAX_FILES_PER_SUBMISSION=50,
        CLASSROOM_SUBMISSION_MAX_FILE_BYTES=50 * MB,
        CLASSROOM_SUBMISSION_MAX_BATCH_BYTES=100 * MB,
        CLASSROOM_SUBMISSION_MAX_REQUEST_BYTES=60 * MB,
    )
    def test_batch_figure_is_what_the_proxy_will_pass(self):
        # Django would take 100 MB; Nginx drops anything over 60 MB with an HTML 413 that never
        # reaches the client's error handling. 60 is the number a student can act on.
        self.assertEqual(submission_limits_payload()["max_batch_bytes"], 60 * MB)

    @override_settings(
        CLASSROOM_SUBMISSION_MAX_BATCH_BYTES=30 * MB,
        CLASSROOM_SUBMISSION_MAX_REQUEST_BYTES=60 * MB,
    )
    def test_the_service_cap_wins_when_it_is_the_smaller_one(self):
        self.assertEqual(submission_limits_payload()["max_batch_bytes"], 30 * MB)

    @override_settings(
        CLASSROOM_SUBMISSION_MAX_FILES_PER_SUBMISSION=8,
        CLASSROOM_SUBMISSION_MAX_FILE_BYTES=20 * MB,
        CLASSROOM_SUBMISSION_ALLOWED_FILE_EXTENSIONS=frozenset({".pdf", ".jpg"}),
    )
    def test_an_ops_change_reaches_the_payload(self):
        payload = submission_limits_payload()
        self.assertEqual(payload["max_files_per_submission"], 8)
        self.assertEqual(payload["max_file_bytes"], 20 * MB)
        self.assertEqual(payload["allowed_extensions"], [".jpg", ".pdf"])


class AssignmentPayloadCarriesLimitsTests(TestCase):
    """The panel reads the limits off the assignment it is uploading to, so they have to be on it."""

    def setUp(self):
        self.owner = User.objects.create_user("limits_owner@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="G13",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.owner,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.owner, role=ClassroomMembership.ROLE_ADMIN
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom,
            created_by=self.owner,
            title="Unit 3 review",
            category=Assignment.CATEGORY_HOMEWORK,
            max_score=100,
            status=Assignment.STATUS_PUBLISHED,
            allow_file_upload=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    @override_settings(
        CLASSROOM_SUBMISSION_MAX_FILES_PER_SUBMISSION=12,
        CLASSROOM_SUBMISSION_MAX_FILE_BYTES=25 * MB,
        CLASSROOM_SUBMISSION_MAX_BATCH_BYTES=100 * MB,
        CLASSROOM_SUBMISSION_MAX_REQUEST_BYTES=60 * MB,
        CLASSROOM_SUBMISSION_ALLOWED_FILE_EXTENSIONS=frozenset({".pdf", ".png"}),
    )
    def test_assignment_detail_reports_the_live_limits(self):
        resp = self.client.get(
            f"/api/classes/{self.classroom.id}/assignments/{self.assignment.id}/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        limits = resp.json().get("submission_limits")
        self.assertEqual(
            limits,
            {
                "max_files_per_submission": 12,
                "max_file_bytes": 25 * MB,
                "max_batch_bytes": 60 * MB,
                "allowed_extensions": [".pdf", ".png"],
            },
        )
