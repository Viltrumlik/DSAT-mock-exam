"""The producers behind HOMEWORK_ASSIGNED, CLASS_ANNOUNCEMENT and auto-marked HOMEWORK_GRADED.

    python manage.py test classes.tests_notifications_homework

The notifications app itself was finished and correct; almost nothing ever called it. These
tests pin the *producers* — the hooks that turn something happening into somebody being told
— and the four properties that make them trustworthy rather than merely present:

1. **Everybody in the class is told, once.** Four separate code paths create a live
   Assignment (teacher create, teacher publish, journal release, journal classwork carrier,
   assessment assign) and each one used to be a different answer to "was the class told?".
   They now converge on ``classes.mail_homework.notify_homework_assigned``, so there is one
   answer.
2. **A student with no email address is still told.** A large share of this school signed up
   through Telegram and has ``email = NULL``. The bell is the only channel that reaches them,
   so it must not inherit the mailbox's ``is_deliverable_email`` filter — nor
   ``EMAIL_SENDING_ENABLED``, which is off on every install that is not production.
3. **Re-running a hook is silent.** Re-publishing, re-releasing and re-assigning are all
   things a teacher does by accident; none of them is news.
4. **A REMOVED student is not in the class.** Removal is a soft delete here, so every roster
   query that forgets to exclude it quietly notifies people who were taken off the class.

``captureOnCommitCallbacks`` appears everywhere because the producers deliberately fire from
``transaction.on_commit``: a bell (and the phone push riding behind it) must not go out for a
homework whose transaction rolled back. Inside a ``TestCase`` nothing ever commits, so a test
that forgets the wrapper sees zero notifications and reads as a broken producer.
"""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as acc_const
from access.models import UserAccess
from assessments.models import (
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.mail_homework import notify_homework_assigned
from classes.models import Assignment, ClassPost, Classroom, ClassroomMembership
from notifications import constants as note_const
from notifications.models import Notification

User = get_user_model()

# The assign endpoint lives behind the admin subdomain host guard (access.host_guard), so
# an APIClient POST has to arrive with a host the guard allows or it is 403'd before the
# view is reached.
_ADMIN_HOST = "admin.mastersat.uz"
_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "testserver", _ADMIN_HOST]

# The email leg is off in tests (EMAIL_SENDING_ENABLED defaults False) and stays off — that
# is the point of most of this file. Eager Celery only stops the email fan-out spawning a
# real daemon thread against the test database; it does not switch sending on.
EAGER = dict(CELERY_TASK_ALWAYS_EAGER=True)


def _assigned(student) -> list:
    return list(
        Notification.objects.filter(
            recipient=student, event=note_const.EVENT_HOMEWORK_ASSIGNED
        )
    )


@override_settings(**EAGER)
class HomeworkAssignedNotificationTests(TestCase):
    """Who is told a homework was set, and how many times."""

    def setUp(self):
        self.teacher = User.objects.create_user("na_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Senior G12 · English · Abdulahad N.",
            subject=Classroom.SUBJECT_ENGLISH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.s1 = self._enrol("na_s1@t.com")
        self.s2 = self._enrol("na_s2@t.com")

    def _enrol(self, email, *, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    def _homework(self, **kw):
        kw.setdefault("title", "Unit 4 practice set")
        kw.setdefault("status", Assignment.STATUS_PUBLISHED)
        kw.setdefault("due_at", timezone.now())
        return Assignment.objects.create(classroom=self.classroom, created_by=self.teacher, **kw)

    def _announce(self, assignment):
        with self.captureOnCommitCallbacks(execute=True):
            return notify_homework_assigned(assignment)

    # ── who is told ──────────────────────────────────────────────────────────
    def test_assigning_homework_rings_every_active_student_exactly_once(self):
        self._announce(self._homework())

        self.assertEqual(len(_assigned(self.s1)), 1)
        self.assertEqual(len(_assigned(self.s2)), 1)

    def test_a_student_with_no_email_address_is_still_told(self):
        """The reason the bell exists. A Telegram signup has ``email = NULL``, so the class
        email cannot reach them — gating the notification on a deliverable address (or on
        EMAIL_SENDING_ENABLED) would leave exactly those students never told anything."""
        telegram_student = User.objects.create_user(None, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=telegram_student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )

        self._announce(self._homework())

        self.assertEqual(len(_assigned(telegram_student)), 1)

    @override_settings(EMAIL_SENDING_ENABLED=False, **EAGER)
    def test_the_bell_rings_on_an_install_with_email_switched_off(self):
        self._announce(self._homework())

        self.assertEqual(len(_assigned(self.s1)), 1)

    def test_the_teaching_team_is_never_told(self):
        self._announce(self._homework())

        self.assertEqual(_assigned(self.teacher), [])

    def test_a_removed_student_is_not_in_the_class_any_more(self):
        """Removal is a soft delete (status=REMOVED). A roster query that forgets to
        exclude it notifies people who were taken off the class."""
        removed = self._enrol("na_removed@t.com", status=ClassroomMembership.STATUS_REMOVED)

        self._announce(self._homework())

        self.assertEqual(_assigned(removed), [])

    def test_an_invited_student_has_not_joined_yet(self):
        invited = self._enrol("na_invited@t.com", status=ClassroomMembership.STATUS_INVITED)

        self._announce(self._homework())

        self.assertEqual(_assigned(invited), [])

    def test_a_draft_is_given_to_nobody_so_it_announces_nothing(self):
        self._announce(self._homework(status=Assignment.STATUS_DRAFT))

        self.assertEqual(Notification.objects.count(), 0)

    # ── how many times ───────────────────────────────────────────────────────
    def test_announcing_the_same_homework_again_adds_nothing(self):
        homework = self._homework()

        self.assertTrue(self._announce(homework))
        self.assertFalse(self._announce(homework))  # notified_at already claimed

        self.assertEqual(len(_assigned(self.s1)), 1)

    def test_the_claim_that_stops_the_email_also_stops_the_bell(self):
        """One announcement, two legs — a re-publish must not re-ring any more than it
        re-mails. Pinned separately from the test above because the claim is taken in the
        email module and it would be easy to move the bell outside it."""
        homework = self._homework()
        self._announce(homework)
        homework.refresh_from_db()

        self.assertIsNotNone(homework.notified_at)
        self._announce(homework)
        self.assertEqual(Notification.objects.filter(recipient=self.s1).count(), 1)

    # ── what it says ─────────────────────────────────────────────────────────
    def test_it_links_to_the_students_own_homework_page(self):
        """link_url is relative and resolves in the RECIPIENT's console. Every recipient
        here is a student, so it is the student assignment detail route — a teacher path
        would 404 for the whole class."""
        homework = self._homework()
        self._announce(homework)

        note = _assigned(self.s1)[0]
        self.assertEqual(
            note.link_url, f"/classes/{self.classroom.id}/assignments/{homework.id}"
        )

    def test_it_files_itself_under_homework_and_names_the_class(self):
        self._announce(self._homework())

        note = _assigned(self.s1)[0]
        self.assertEqual(note.category, note_const.CATEGORY_HOMEWORK)
        self.assertIn("Unit 4 practice set", note.title)
        self.assertIn(self.classroom.name, note.body)

    def test_the_category_leads_the_title_so_a_quiz_reads_as_a_quiz(self):
        self._announce(self._homework(category=Assignment.CATEGORY_QUIZ))

        self.assertTrue(_assigned(self.s1)[0].title.startswith("New quiz:"))

    def test_a_deadline_free_homework_does_not_invent_a_date(self):
        self._announce(self._homework(due_at=None))

        self.assertNotIn("due", _assigned(self.s1)[0].body)

    def test_a_long_title_is_trimmed_to_the_column_rather_than_raising(self):
        """Assignment.title holds 200 characters; Notification.title holds 160."""
        self._announce(self._homework(title="Reading practice " * 12))

        self.assertLessEqual(len(_assigned(self.s1)[0].title), 160)

    # ── path (a): the teacher creates a homework ─────────────────────────────
    def test_the_create_endpoint_announces_the_class(self):
        client = APIClient()
        client.force_authenticate(self.teacher)

        with self.captureOnCommitCallbacks(execute=True):
            resp = client.post(
                f"/api/classes/{self.classroom.id}/assignments/",
                {"title": "Homework via API", "instructions": "Do the set."},
                format="json",
            )

        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.assertEqual(len(_assigned(self.s1)), 1)
        self.assertEqual(len(_assigned(self.s2)), 1)

    # ── path (b): the teacher publishes a draft ──────────────────────────────
    def test_publishing_a_draft_announces_the_class(self):
        draft = self._homework(status=Assignment.STATUS_DRAFT)
        client = APIClient()
        client.force_authenticate(self.teacher)

        with self.captureOnCommitCallbacks(execute=True):
            resp = client.post(
                f"/api/classes/{self.classroom.id}/assignments/{draft.id}/publish/"
            )

        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(_assigned(self.s1)), 1)

    def test_republishing_does_not_announce_the_class_twice(self):
        draft = self._homework(status=Assignment.STATUS_DRAFT)
        client = APIClient()
        client.force_authenticate(self.teacher)
        url = f"/api/classes/{self.classroom.id}/assignments/{draft.id}/publish/"

        with self.captureOnCommitCallbacks(execute=True):
            client.post(url)
        with self.captureOnCommitCallbacks(execute=True):
            client.post(url)

        self.assertEqual(len(_assigned(self.s1)), 1)


@override_settings(ALLOWED_HOSTS=_ALLOWED_HOSTS, **EAGER)
class AssessmentAssignNotificationTests(TestCase):
    """Path (d): ``POST /api/assessments/homework/assign/`` — the third assign door.

    It builds its own ``classes.Assignment`` by hand rather than going through
    ``AssignmentViewSet``, which is exactly how it came to be the silent one.
    """

    def setUp(self):
        self.teacher = User.objects.create_user(
            email="na_assign_teacher@t.com", password="secret123",
            role=acc_const.ROLE_TEACHER, subject=acc_const.DOMAIN_MATH,
        )
        UserAccess.objects.create(
            user=self.teacher, subject=acc_const.DOMAIN_MATH,
            classroom=None, granted_by=self.teacher,
        )
        self.classroom = Classroom.objects.create(
            name="Math Senior B",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
            teacher=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.student = User.objects.create_user("na_assign_student@t.com", "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra", title="Algebra set",
            created_by=self.teacher, is_active=True,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        AssessmentQuestion.objects.create(
            assessment_set=self.aset, order=1, prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4,
            points=1, is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _assign(self):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                "/api/assessments/homework/assign/",
                {"classroom_id": self.classroom.id, "set_id": self.aset.id, "title": "HW"},
                format="json",
                HTTP_HOST=_ADMIN_HOST,
            )

    def test_assigning_an_assessment_announces_the_class(self):
        resp = self._assign()

        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(len(_assigned(self.student)), 1)

    def test_a_duplicate_assign_hands_back_the_same_homework_and_says_nothing(self):
        """UNIQUE(classroom, set) makes the second POST a no-op that still returns 201.
        The class already has this homework, so pressing assign again is not news."""
        self._assign()
        resp = self._assign()

        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(
            HomeworkAssignment.objects.filter(
                classroom=self.classroom, assessment_set=self.aset
            ).count(),
            1,
        )
        self.assertEqual(len(_assigned(self.student)), 1)


@override_settings(**EAGER)
class JournalDeliveryNotificationTests(TestCase):
    """Path (c): homework materialised out of a journal, and the classwork carrier.

    Both used to reach students in complete silence — the homework simply appeared in the
    feed, which for a student who does not open the app that evening is indistinguishable
    from no homework at all.
    """

    def setUp(self):
        from journals import services

        self.admin = User.objects.create_user(
            email="na_j_admin@t.com", password="secret123", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.teacher = User.objects.create_user(
            email="na_j_teacher@t.com", password="secret123",
            role=acc_const.ROLE_TEACHER, subject="math",
        )
        self.student = User.objects.create_user("na_j_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Math Middle A",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            start_date=date(2026, 8, 3),  # a Monday
            created_by=self.admin,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher,
            role=ClassroomMembership.ROLE_TEACHER, status=ClassroomMembership.STATUS_ACTIVE,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )

    def _ready_session(self):
        """A publishable journal session with a homework brief on it."""
        from journals.models import Journal
        from journals import services

        lesson = services.add_session(self.journal, actor=self.admin)
        lesson.title = "Ch.3"
        lesson.instructions = "Do exercises 1-20"
        lesson.allow_file_upload = True
        lesson.save()
        cw = services.ensure_classwork(lesson)
        cw.new_topic_title = "Linear equations"
        cw.new_topic_instructions = "Slope-intercept form"
        cw.save()
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])
        return lesson

    def test_releasing_a_session_announces_its_homework(self):
        from journals import delivery

        session = self._ready_session()
        with self.captureOnCommitCallbacks(execute=True):
            delivery.release_homework(self.classroom, session, actor=self.teacher)

        self.assertEqual(len(_assigned(self.student)), 1)

    def test_the_teacher_who_released_it_is_not_told(self):
        from journals import delivery

        session = self._ready_session()
        with self.captureOnCommitCallbacks(execute=True):
            delivery.release_homework(self.classroom, session, actor=self.teacher)

        self.assertEqual(_assigned(self.teacher), [])

    def test_re_releasing_the_same_session_announces_nothing_further(self):
        from journals import delivery

        session = self._ready_session()
        for _ in range(2):
            with self.captureOnCommitCallbacks(execute=True):
                delivery.release_homework(self.classroom, session, actor=self.teacher)

        self.assertEqual(len(_assigned(self.student)), 1)

    def test_handing_out_classwork_announces_the_carrier(self):
        from journals import delivery

        session = self._ready_session()
        with self.captureOnCommitCallbacks(execute=True):
            delivery.assign_classwork(self.classroom, session, actor=self.teacher)

        notes = _assigned(self.student)
        self.assertEqual(len(notes), 1)
        self.assertTrue(notes[0].title.startswith("New classwork:"), notes[0].title)

    def test_a_second_hand_out_reuses_the_carrier_and_stays_quiet(self):
        """There is exactly one carrier per lesson. Opening a second item in the same
        lesson must not read to the class as a second piece of work."""
        from journals import delivery

        session = self._ready_session()
        for _ in range(2):
            with self.captureOnCommitCallbacks(execute=True):
                delivery.assign_classwork(self.classroom, session, actor=self.teacher)

        self.assertEqual(len(_assigned(self.student)), 1)


@override_settings(**EAGER)
class ClassAnnouncementNotificationTests(TestCase):
    """An announcement is the one classroom event with no second channel."""

    def setUp(self):
        self.teacher = User.objects.create_user("na_post_teacher@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Junior G9 · Math",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_EVEN,
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.teacher, role=ClassroomMembership.ROLE_ADMIN
        )
        self.s1 = self._enrol("na_post_s1@t.com")
        self.s2 = self._enrol("na_post_s2@t.com")
        self.client = APIClient()
        self.client.force_authenticate(self.teacher)

    def _enrol(self, email, *, status=ClassroomMembership.STATUS_ACTIVE):
        user = User.objects.create_user(email, "secret123")
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=user,
            role=ClassroomMembership.ROLE_STUDENT, status=status,
        )
        return user

    def _post(self, content="No lesson on Friday — we move to Saturday 10:00."):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                f"/api/classes/{self.classroom.id}/posts/", {"content": content}, format="json"
            )

    def _announcements(self, user):
        return list(
            Notification.objects.filter(
                recipient=user, event=note_const.EVENT_CLASS_ANNOUNCEMENT
            )
        )

    def test_an_announcement_reaches_the_whole_class(self):
        resp = self._post()

        self.assertIn(resp.status_code, (200, 201), resp.content)
        self.assertEqual(len(self._announcements(self.s1)), 1)
        self.assertEqual(len(self._announcements(self.s2)), 1)

    def test_its_author_is_not_told_what_they_just_wrote(self):
        self._post()

        self.assertEqual(self._announcements(self.teacher), [])

    def test_a_removed_student_is_not_told(self):
        removed = self._enrol("na_post_removed@t.com", status=ClassroomMembership.STATUS_REMOVED)

        self._post()

        self.assertEqual(self._announcements(removed), [])

    def test_it_carries_the_post_and_opens_the_classroom(self):
        self._post(content="Bring your calculator on Wednesday.")

        note = self._announcements(self.s1)[0]
        self.assertEqual(note.category, note_const.CATEGORY_CLASSROOM)
        self.assertIn(self.classroom.name, note.title)
        self.assertIn("Bring your calculator", note.body)
        self.assertEqual(note.link_url, f"/classes/{self.classroom.id}")

    def test_two_announcements_are_two_pieces_of_news(self):
        """Deduping is per POST, not per classroom — a second announcement in the same
        hour is a different thing being said."""
        self._post(content="No lesson on Friday.")
        self._post(content="Actually, Friday is back on.")

        self.assertEqual(len(self._announcements(self.s1)), 2)
        self.assertEqual(ClassPost.objects.filter(classroom=self.classroom).count(), 2)


@override_settings(**EAGER)
class AutoGradedNotificationTests(TestCase):
    """Auto-grading finished in silence: only work a teacher marked by hand rang a bell."""

    def setUp(self):
        self.teacher = User.objects.create_user("na_grade_teacher@t.com", "secret123")
        self.student = User.objects.create_user("na_grade_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Senior G11 · Math",
            subject=Classroom.SUBJECT_MATH,
            lesson_days=Classroom.DAYS_ODD,
            created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=self.student,
            role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.aset = AssessmentSet.objects.create(
            subject=AssessmentSet.SUBJECT_MATH, category="algebra", title="Algebra set",
            created_by=self.teacher, is_active=True,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self.question = AssessmentQuestion.objects.create(
            assessment_set=self.aset, order=1, prompt="2+2?",
            question_type=AssessmentQuestion.TYPE_NUMERIC, correct_answer=4,
            points=1, is_active=True,
        )
        self.assignment = Assignment.objects.create(
            classroom=self.classroom, created_by=self.teacher, title="Algebra homework",
        )
        self.homework = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=self.aset,
            assignment=self.assignment, assigned_by=self.teacher,
        )

    def _submitted_attempt(self):
        return AssessmentAttempt.objects.create(
            homework=self.homework,
            student=self.student,
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=timezone.now(),
            question_order=[self.question.id],
        )

    def _graded(self):
        return list(
            Notification.objects.filter(
                recipient=self.student, event=note_const.EVENT_HOMEWORK_GRADED
            )
        )

    def test_an_auto_graded_attempt_tells_the_student(self):
        from assessments.grading_service import grade_attempt

        attempt = self._submitted_attempt()
        with self.captureOnCommitCallbacks(execute=True):
            grade_attempt(attempt_id=attempt.pk)

        self.assertEqual(len(self._graded()), 1)
        self.assertEqual(self._graded()[0].link_url, f"/classes/{self.classroom.id}")

    def test_re_running_the_grader_does_not_tell_them_again(self):
        """Duplicate Celery deliveries are ordinary. ``grade_attempt`` returns early for an
        already-graded attempt, so the bell never gets as far as the dedupe window."""
        from assessments.grading_service import grade_attempt

        attempt = self._submitted_attempt()
        for _ in range(2):
            with self.captureOnCommitCallbacks(execute=True):
                grade_attempt(attempt_id=attempt.pk)

        self.assertEqual(len(self._graded()), 1)

    def test_a_bundle_marked_by_hand_and_by_the_grader_is_one_piece_of_news(self):
        """The load-bearing reason the auto-grader reuses ``_notify_graded``: a homework
        with an essay the teacher marks and an assessment the grader scores produces two
        grade events, and only an identical dedupe_key collapses them into the one thing
        that happened — "your work has been marked"."""
        from assessments.grading_service import grade_attempt
        from classes.views import _notify_graded

        _notify_graded(self.classroom.id, self.student.id)
        attempt = self._submitted_attempt()
        with self.captureOnCommitCallbacks(execute=True):
            grade_attempt(attempt_id=attempt.pk)

        self.assertEqual(len(self._graded()), 1)
