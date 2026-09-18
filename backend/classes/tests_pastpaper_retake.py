"""A pastpaper set again as homework is a new sitting; the one before it goes to history.

The owner, 2026-09-18: once a student had sat a paper, a homework setting it again could not be
sat. The library card and the homework launcher both read "Review", and the homework was handed
in with the old attempt the moment it went live. Everything here is about which sitting belongs
to which homework, and the one floor that decides it (``classes.pastpaper_retake``).

Then the certificates. Prod had 976 finished pastpapers and not one certificate: the finish is
written with a conditional UPDATE, which fires no post_save, so the issuing receiver never ran
and the report page never showed its button. The download by attempt mints what is missing, and
the report lists every sitting of the paper, each with its own download.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.homework_auto_submit import sync_practice_submission_for_assignment
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_certificates import PastpaperCertificate
from exams.models import MockExam, Module, PracticeTest, TestAttempt
from exams.tests.support import seed_mc_questions_for_practice_test

User = get_user_model()


class RetakeFixture(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.teacher = User.objects.create_user(
            email="t_retake@example.com", password="x",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        self.classroom = Classroom.objects.create(
            name="Math class", subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER
        )
        self.student = self._student("st_retake@example.com")
        self.section = self._section("SAT March 2024")
        self.section.assigned_users.add(self.student)
        self.client = APIClient()

    def _student(self, email, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(
            email=email, password="x", role=acc_const.ROLE_STUDENT, subject=""
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    @staticmethod
    def _section(title, mock_exam=None):
        section = PracticeTest.objects.create(
            mock_exam=mock_exam, subject="MATH", title=title, collection_name=title,
            form_type="INTERNATIONAL", skip_default_modules=True,
        )
        Module.objects.create(practice_test=section, module_order=1, time_limit_minutes=1)
        seed_mc_questions_for_practice_test(section)
        return section

    def _homework(self, *, days_ago=0, status=Assignment.STATUS_PUBLISHED):
        """A homework set ``days_ago`` days ago. ``created_at`` is the floor under test."""
        homework = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title=f"Homework, {days_ago}d ago",
            category=Assignment.CATEGORY_HOMEWORK, status=status, practice_test=self.section,
        )
        Assignment.objects.filter(pk=homework.pk).update(
            created_at=self.now - timedelta(days=days_ago)
        )
        homework.refresh_from_db()
        return homework

    def _sitting(self, *, days_ago=0, score=600, student=None, section=None):
        """A finished sitting, saved the ordinary way so the post_save homework sync runs."""
        when = self.now - timedelta(days=days_ago)
        return TestAttempt.objects.create(
            practice_test=section or self.section, student=student or self.student, score=score,
            current_state=TestAttempt.STATE_COMPLETED, is_completed=True,
            completed_at=when, submitted_at=when,
        )

    def _as(self, user):
        self.client.force_authenticate(user)
        return self.client

    def _submission(self, homework):
        return (
            Submission.objects.filter(assignment=homework, student=self.student)
            .select_related("review")
            .first()
        )

    def _launcher(self, homework):
        r = self._as(self.student).get(
            f"/api/classes/{self.classroom.id}/assignments/{homework.id}/"
        )
        self.assertEqual(r.status_code, 200, r.content)
        (row,) = r.json()["practice_bundle_tests"]
        return row

    def _reopened(self, student=None):
        r = self._as(student or self.student).get("/api/classes/pastpapers/reopened/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["items"]


class HomeworkHandsInOnlyANewSittingTests(RetakeFixture):
    def test_a_sitting_from_before_the_homework_is_not_handed_in(self):
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30, score=560)

        sync_practice_submission_for_assignment(self.student, homework)

        self.assertIsNone(self._submission(homework))

    def test_the_new_sitting_is_handed_in_with_its_own_score(self):
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30, score=560)

        new = self._sitting(days_ago=0, score=690)

        sub = self._submission(homework)
        self.assertEqual(
            (sub.status, sub.attempt_id, sub.review.is_auto, float(sub.review.grade)),
            (Submission.STATUS_REVIEWED, new.pk, True, 690.0),
        )

    def test_opening_the_homework_does_not_hand_in_the_old_sitting(self):
        """``my-submission`` is the student's lazy sync, and it used to do exactly this."""
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30)

        r = self._as(self.student).get(
            f"/api/classes/{self.classroom.id}/assignments/{homework.id}/my-submission/"
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json(), {})
        self.assertIsNone(self._submission(homework))

    def test_publishing_does_not_hand_in_the_old_sitting(self):
        """``publish`` hands in what the class already finished, and last month's sitting of the
        same paper is not that."""
        homework = self._homework(days_ago=1, status=Assignment.STATUS_DRAFT)
        self._sitting(days_ago=30)

        r = self._as(self.teacher).post(
            f"/api/classes/{self.classroom.id}/assignments/{homework.id}/publish/"
        )

        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(self._submission(homework))


class LauncherOffersTheNewSittingTests(RetakeFixture):
    def test_a_paper_sat_before_the_homework_reads_start_again(self):
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30)

        row = self._launcher(homework)

        self.assertEqual(
            (row["state"], row["attempt_id"], row["retake"]), ("not_started", None, True)
        )

    def test_the_new_sitting_is_the_one_it_reviews(self):
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30)
        new = self._sitting(days_ago=0)

        row = self._launcher(homework)

        self.assertEqual(
            (row["state"], row["attempt_id"], row["retake"]), ("completed", new.pk, False)
        )

    def test_a_new_sitting_in_progress_reads_resume(self):
        homework = self._homework(days_ago=1)
        self._sitting(days_ago=30)
        active = TestAttempt.objects.create(
            practice_test=self.section, student=self.student,
            current_state=TestAttempt.STATE_MODULE_1_ACTIVE,
        )

        row = self._launcher(homework)

        self.assertEqual((row["state"], row["attempt_id"]), ("in_progress", active.pk))

    def test_a_paper_never_sat_is_a_plain_start(self):
        homework = self._homework(days_ago=1)

        row = self._launcher(homework)

        self.assertEqual((row["state"], row["retake"]), ("not_started", False))

    def test_starting_it_opens_a_fresh_attempt(self):
        """Nothing is pre-created for the retake: an ordinary start opens it, held on the
        welcome screen like any fresh pastpaper."""
        self._homework(days_ago=1)
        old = self._sitting(days_ago=30)

        r = self._as(self.student).post(
            "/api/exams/attempts/", {"practice_test": self.section.pk}, format="json"
        )

        self.assertEqual(r.status_code, 201, r.content)
        self.assertNotEqual(r.json()["id"], old.pk)
        self.assertEqual(r.json()["current_state"], TestAttempt.STATE_NOT_STARTED)


class ReopenedPapersTests(RetakeFixture):
    def test_a_paper_set_again_is_listed_with_the_homework_that_set_it(self):
        self._sitting(days_ago=30)
        homework = self._homework(days_ago=1)

        (item,) = self._reopened()

        self.assertEqual(
            (item["practice_test_id"], item["assignment_id"], item["assignment_title"],
             item["classroom_name"]),
            (self.section.pk, homework.pk, homework.title, "Math class"),
        )

    def test_it_drops_off_once_the_paper_is_sat_again(self):
        self._sitting(days_ago=30)
        self._homework(days_ago=1)
        self._sitting(days_ago=0)

        self.assertEqual(self._reopened(), [])

    def test_a_paper_never_sat_is_new_not_reopened(self):
        self._homework(days_ago=1)

        self.assertEqual(self._reopened(), [])

    def test_the_latest_homework_decides(self):
        """A sitting done for an earlier homework does not answer a later one."""
        self._homework(days_ago=20)
        self._sitting(days_ago=10)
        second = self._homework(days_ago=5)

        (item,) = self._reopened()

        self.assertEqual(item["assignment_id"], second.pk)

    def test_drafts_and_archived_homework_reopen_nothing(self):
        self._sitting(days_ago=30)
        self._homework(days_ago=1, status=Assignment.STATUS_DRAFT)
        self._homework(days_ago=1, status=Assignment.STATUS_ARCHIVED)

        self.assertEqual(self._reopened(), [])

    def test_a_removed_student_is_not_set_anything(self):
        removed = self._student("removed_retake@example.com", ClassroomMembership.STATUS_REMOVED)
        self._sitting(days_ago=30, student=removed)
        self._sitting(days_ago=30)
        self._homework(days_ago=1)

        self.assertEqual(self._reopened(removed), [])
        # Control: the same history on an active member is reopened.
        self.assertEqual(len(self._reopened()), 1)


class HistoryAndCertificateTests(RetakeFixture):
    def setUp(self):
        super().setUp()
        self.old = self._sitting(days_ago=30, score=560)
        self.new = self._sitting(days_ago=0, score=690)
        # What prod holds: the finish never fired post_save, so nothing was ever minted.
        PastpaperCertificate.objects.all().delete()

    def _report(self, attempt):
        r = self._as(self.student).get(f"/api/classes/pastpapers/attempts/{attempt.pk}/report/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def _pdf(self, attempt, *, user=None, rendered=b"%PDF-fake"):
        with mock.patch(
            "classes.views_pastpaper_certificates.render_pdf_safe", return_value=rendered
        ) as render:
            r = self._as(user or self.student).get(
                f"/api/classes/pastpapers/attempts/{attempt.pk}/certificate/pdf/"
            )
        return r, render

    def test_the_report_lists_every_sitting_newest_first(self):
        body = self._report(self.new)

        self.assertEqual(
            [(h["attempt_id"], h["score"]) for h in body["history"]],
            [(self.new.pk, 690), (self.old.pk, 560)],
        )
        self.assertEqual(body["practice_test_id"], self.section.pk)

    def test_the_report_offers_a_certificate_that_was_never_minted(self):
        body = self._report(self.old)

        self.assertIsNone(body["certificate_code"])
        self.assertTrue(body["certificate_available"])

    def test_the_first_download_mints_it_and_the_next_reuses_it(self):
        first, render = self._pdf(self.new)

        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(first["Content-Type"], "application/pdf")
        cert = PastpaperCertificate.objects.get(attempt=self.new)
        self.assertIn(cert.number, first["Content-Disposition"])
        render.assert_called_once()

        again, _ = self._pdf(self.new)

        self.assertEqual(again.status_code, 200)
        self.assertEqual(
            list(PastpaperCertificate.objects.filter(attempt=self.new).values_list("code", flat=True)),
            [cert.code],
        )

    def test_each_sitting_downloads_its_own_certificate(self):
        self._pdf(self.old)
        self._pdf(self.new)

        self.assertEqual(
            dict(PastpaperCertificate.objects.values_list("attempt_id", "score")),
            {self.old.pk: 560, self.new.pk: 690},
        )

    def test_the_certificate_is_dated_the_day_the_paper_was_finished(self):
        """Minted in September for a July sitting, it still says July — in Tashkent's day."""
        finished = datetime(2026, 7, 3, 20, 30, tzinfo=dt_timezone.utc)  # 01:30, July 4th
        TestAttempt.objects.filter(pk=self.old.pk).update(completed_at=finished)

        self._pdf(self.old)

        cert = PastpaperCertificate.objects.select_related("attempt").get(attempt=self.old)
        self.assertEqual(cert.date_display, "July 04, 2026")

    def test_somebody_else_cannot_download_it(self):
        other = self._student("nosy_retake@example.com")

        r, render = self._pdf(self.new, user=other)

        self.assertEqual(r.status_code, 403)
        render.assert_not_called()
        self.assertFalse(PastpaperCertificate.objects.exists())

    def test_staff_can(self):
        r, _ = self._pdf(self.new, user=self.teacher)

        self.assertEqual(r.status_code, 200, r.content)

    def test_an_unfinished_sitting_has_no_certificate(self):
        unfinished = TestAttempt.objects.create(
            practice_test=self.section, student=self.student,
            current_state=TestAttempt.STATE_MODULE_1_ACTIVE,
        )

        r, _ = self._pdf(unfinished)

        self.assertEqual(r.status_code, 400)

    def test_a_mock_section_has_no_certificate(self):
        """One section of a longer exam is not a pastpaper."""
        section = self._section("Mock section", mock_exam=MockExam.objects.create(title="Mock"))
        attempt = self._sitting(section=section)

        r, _ = self._pdf(attempt)

        self.assertEqual(r.status_code, 404)
        self.assertFalse(self._report(attempt)["certificate_available"])

    def test_a_render_failure_is_a_503_and_keeps_the_certificate(self):
        r, _ = self._pdf(self.new, rendered=None)

        self.assertEqual(r.status_code, 503)
        self.assertTrue(PastpaperCertificate.objects.filter(attempt=self.new).exists())
