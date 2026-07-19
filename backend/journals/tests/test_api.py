"""Journal + session REST API: explicit session creation (no pre-provisioning),
level-scoped content, midterm picker, classwork, publish gating, bulk, permissions."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import AssessmentSet
from journals import services
from journals.models import Journal, JournalClasswork, JournalLesson

User = get_user_model()


def _admin(email="j_admin@test.com"):
    return User.objects.create_user(email=email, password="x", role=acc_const.ROLE_SUPER_ADMIN)


def _fill(lesson, *, instructions="Do it"):
    """Make a homework session fully ready (homework brief + classwork plan)."""
    lesson.instructions = instructions
    lesson.allow_file_upload = True
    lesson.save()
    cw = services.ensure_classwork(lesson)
    cw.new_topic_title = "Topic"
    cw.new_topic_instructions = "Teach it"
    cw.save()
    return lesson


class JournalCreationTests(TestCase):
    def setUp(self):
        self.admin = _admin()
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_journal_starts_empty(self):
        resp = self.client.post(
            "/api/journals/", {"subject": "MATH", "level": "foundation"}, format="json"
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["total_lessons"], 0)
        self.assertEqual(body["lessons"], [])
        # The recommended shape is advisory only.
        self.assertEqual(body["recommended"]["lessons"], 12)

    def test_create_is_idempotent(self):
        j, created = services.create_journal(subject="MATH", level="junior", actor=self.admin)
        self.assertTrue(created)
        again, created2 = services.create_journal(
            subject="MATH", level="junior", actor=self.admin
        )
        self.assertFalse(created2)
        self.assertEqual(j.id, again.id)
        self.assertEqual(j.lessons.count(), 0)

    def test_create_english_foundation_rejected(self):
        resp = self.client.post(
            "/api/journals/", {"subject": "ENGLISH", "level": "foundation"}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class SessionTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_sess@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )

    def _add(self, **body):
        return self.client.post(
            f"/api/journals/{self.journal.id}/sessions/", body or {}, format="json"
        )

    def test_new_session_appends_and_creates_classwork(self):
        resp = self._add()
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["lesson_number"], 1)
        self.assertEqual(body["lesson_type"], "HOMEWORK")
        self.assertIsNotNone(body["classwork"])
        # Timetable defaults mirror the lesson plan.
        tt = {b["key"]: b["minutes"] for b in body["classwork"]["timetable"]}
        self.assertEqual(tt["HOMEWORK_REVIEW"], 20)
        self.assertEqual(tt["NEW_TOPIC"], 30)
        self.assertEqual(tt["BREAK"], 10)
        self.assertEqual(tt["EXERCISES"], 20)
        self.assertEqual(tt["REVISION"], 30)

    def test_sessions_number_sequentially(self):
        for expected in (1, 2, 3):
            self.assertEqual(self._add().json()["lesson_number"], expected)
        self.journal.refresh_from_db()
        self.assertEqual(self.journal.total_lessons, 3)

    def test_admin_controls_midterm_placement(self):
        self._add()
        self._add()
        mid = self._add(type="MIDTERM")
        self.assertEqual(mid.status_code, 201, mid.content)
        self.assertEqual(mid.json()["lesson_type"], "MIDTERM")
        self.assertIsNone(mid.json()["classwork"])
        self.assertEqual(self.journal.lessons.filter(lesson_type="MIDTERM").count(), 1)

    def test_total_lessons_stays_accurate_on_a_prefetched_journal(self):
        """Regression: journal.lessons.count() answers from a stale prefetch cache, so
        total_lessons must be recomputed with an explicit queryset."""
        self._add()
        self._add()
        # Simulate the API path, which prefetches lessons before mutating.
        from django.db.models import Prefetch

        prefetched = Journal.objects.prefetch_related(
            Prefetch("lessons", queryset=JournalLesson.objects.all())
        ).get(pk=self.journal.id)
        list(prefetched.lessons.all())  # populate the cache
        services.add_session(prefetched, actor=self.admin)
        prefetched.refresh_from_db()
        self.assertEqual(prefetched.total_lessons, 3)

    def test_delete_session_renumbers(self):
        ids = [self._add().json()["id"] for _ in range(3)]
        resp = self.client.delete(f"/api/journals/{self.journal.id}/lessons/{ids[0]}/")
        self.assertEqual(resp.status_code, 204, resp.content)
        remaining = list(self.journal.lessons.order_by("lesson_number"))
        self.assertEqual([l.lesson_number for l in remaining], [1, 2])
        self.journal.refresh_from_db()
        self.assertEqual(self.journal.total_lessons, 2)


class MidtermOptionTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_mid@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )

    def test_options_filtered_by_level_and_subject(self):
        from midterms.models import Midterm

        # Only the MATH + foundation one should be offered.
        wanted = Midterm.objects.create(
            title="Math Foundation MT", subject="MATH", level="foundation",
            is_published=True, created_by=self.admin,
        )
        Midterm.objects.create(
            title="Math Junior MT", subject="MATH", level="junior",
            is_published=True, created_by=self.admin,
        )
        Midterm.objects.create(
            title="Eng Foundation MT", subject="READING_WRITING", level="foundation",
            is_published=True, created_by=self.admin,
        )
        Midterm.objects.create(
            title="Unpublished", subject="MATH", level="foundation",
            is_published=False, created_by=self.admin,
        )
        resp = self.client.get("/api/journals/midterm-options/?subject=MATH&level=foundation")
        self.assertEqual(resp.status_code, 200, resp.content)
        titles = {m["title"] for m in resp.json()["midterms"]}
        self.assertEqual(titles, {"Math Foundation MT"})
        self.assertEqual(resp.json()["midterms"][0]["id"], wanted.id)

    def test_midterm_session_needs_exam_to_be_ready(self):
        from midterms.models import Midterm

        exam = Midterm.objects.create(
            title="MT", subject="MATH", level="foundation",
            is_published=True, created_by=self.admin,
        )
        lesson = services.add_session(
            self.journal, actor=self.admin, lesson_type=JournalLesson.TYPE_MIDTERM
        )
        self.assertFalse(lesson.is_ready)
        self.assertIn("No midterm exam selected", lesson.validation_reasons())

        resp = self.client.patch(
            f"/api/journals/{self.journal.id}/lessons/{lesson.id}/",
            {"midterm_exam_id": exam.id, "midterm_access_days_before": 2},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["is_ready"])
        self.assertEqual(resp.json()["midterm"]["access_days_before"], 2)

    def test_midterm_rejects_homework_fields(self):
        lesson = services.add_session(
            self.journal, actor=self.admin, lesson_type=JournalLesson.TYPE_MIDTERM
        )
        resp = self.client.patch(
            f"/api/journals/{self.journal.id}/lessons/{lesson.id}/",
            {"instructions": "nope"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)


class ClassworkTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_cw@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.s1 = services.add_session(self.journal, actor=self.admin)
        self.s2 = services.add_session(self.journal, actor=self.admin)
        self.set = AssessmentSet.objects.create(
            subject="math", title="F set", source=AssessmentSet.SOURCE_SQB,
            level="foundation", created_by=self.admin,
        )

    def _url(self, lesson):
        return f"/api/journals/{self.journal.id}/lessons/{lesson.id}/classwork/"

    def test_edit_durations_and_new_topic(self):
        resp = self.client.patch(
            self._url(self.s1),
            {
                "new_topic_title": "Linear equations",
                "new_topic_instructions": "Explain slope",
                "new_topic_minutes": 25,
                "break_minutes": 15,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["new_topic_title"], "Linear equations")
        tt = {b["key"]: b["minutes"] for b in body["timetable"]}
        self.assertEqual(tt["NEW_TOPIC"], 25)
        self.assertEqual(tt["BREAK"], 15)
        self.assertTrue(body["is_ready"])

    def test_exercises_and_new_topic_assessments_are_separate_blocks(self):
        resp = self.client.patch(
            self._url(self.s1),
            {
                "new_topic_assessment_set_ids": [self.set.id],
                "exercise_assessment_set_ids": [self.set.id],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body["new_topic_assessments"]), 1)
        self.assertEqual(len(body["exercise_assessments"]), 1)
        # Revision re-opens the exercises content.
        self.assertEqual(len(body["revision_targets"]["assessments"]), 1)

    def test_homework_review_shows_previous_session_homework(self):
        self.s1.title = "HW one"
        self.s1.instructions = "Read ch.1"
        self.s1.save()
        resp = self.client.get(self._url(self.s2))
        self.assertEqual(resp.status_code, 200, resp.content)
        review = resp.json()["homework_review"]
        self.assertIsNotNone(review)
        self.assertEqual(review["lesson_number"], 1)
        self.assertEqual(review["title"], "HW one")

    def test_first_session_has_no_homework_review(self):
        resp = self.client.get(self._url(self.s1))
        self.assertIsNone(resp.json()["homework_review"])

    def test_wrong_level_assessment_filtered_out(self):
        other = AssessmentSet.objects.create(
            subject="math", title="J set", source=AssessmentSet.SOURCE_SQB,
            level="junior", created_by=self.admin,
        )
        resp = self.client.patch(
            self._url(self.s1), {"exercise_assessment_set_ids": [other.id]}, format="json"
        )
        self.assertEqual(len(resp.json()["exercise_assessments"]), 0)


class PublishTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_pub@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )

    def test_empty_journal_cannot_publish(self):
        resp = self.client.post(f"/api/journals/{self.journal.id}/publish/")
        self.assertEqual(resp.status_code, 409, resp.content)

    def test_publish_needs_homework_and_classwork(self):
        lesson = services.add_session(self.journal, actor=self.admin)
        resp = self.client.post(f"/api/journals/{self.journal.id}/publish/")
        self.assertEqual(resp.status_code, 409)
        reasons = resp.json()["blocking_lessons"][0]["reasons"]
        self.assertTrue(any("Homework instructions" in r for r in reasons))
        self.assertTrue(any("New topic title" in r for r in reasons))

        _fill(lesson)
        ok = self.client.post(f"/api/journals/{self.journal.id}/publish/")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.json()["status"], "PUBLISHED")

    def test_external_link_alone_satisfies_homework_content(self):
        lesson = services.add_session(self.journal, actor=self.admin)
        lesson.instructions = "Watch"
        lesson.external_url = "https://example.com/x"
        lesson.save()
        self.assertTrue(lesson.homework_ready)


class BulkTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_bulk@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="foundation", actor=self.admin
        )
        self.sessions = [
            _fill(services.add_session(self.journal, actor=self.admin)) for _ in range(3)
        ]

    def test_bulk_publish(self):
        resp = self.client.post(
            f"/api/journals/{self.journal.id}/lessons/bulk/",
            {"action": "publish", "ids": [s.id for s in self.sessions]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["affected"], 3)

    def test_bulk_rejected_on_archived_journal(self):
        self.journal.status = Journal.STATUS_ARCHIVED
        self.journal.save(update_fields=["status"])
        resp = self.client.post(
            f"/api/journals/{self.journal.id}/lessons/bulk/",
            {"action": "clear", "ids": [s.id for s in self.sessions]},
            format="json",
        )
        self.assertEqual(resp.status_code, 409, resp.content)
        for s in self.sessions:
            s.refresh_from_db()
            self.assertTrue(s.instructions)


class PermissionTests(TestCase):
    def setUp(self):
        self.admin = _admin("j_perm_admin@test.com")
        self.teacher = User.objects.create_user(
            email="j_perm_teacher@test.com", password="x",
            role=acc_const.ROLE_TEACHER, subject="math",
        )
        services.create_journal(subject="MATH", level="foundation", actor=self.admin)

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user)
        return c

    def test_admin_can_list(self):
        self.assertEqual(self._client(self.admin).get("/api/journals/").status_code, 200)

    def test_teacher_forbidden(self):
        self.assertEqual(self._client(self.teacher).get("/api/journals/").status_code, 403)

    def test_teacher_cannot_add_session(self):
        j = Journal.objects.first()
        resp = self._client(self.teacher).post(f"/api/journals/{j.id}/sessions/", {}, format="json")
        self.assertEqual(resp.status_code, 403)


class BulkCopyFromTests(TestCase):
    """copy_from read due_after_days / deadline_time, which migration 0002 removed —
    every copied row raised AttributeError and was reported as a failure."""

    def setUp(self):
        self.admin = _admin("bulkcopy@test.com")
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.journal, _ = services.create_journal(
            subject="MATH", level="junior", actor=self.admin
        )
        self.src = _fill(services.add_session(self.journal, actor=self.admin),
                         instructions="Original brief")
        self.src.title = "Ch.7"
        self.src.save()
        self.dst = services.add_session(self.journal, actor=self.admin)

    def test_copy_from_actually_copies(self):
        resp = self.client.post(
            f"/api/journals/{self.journal.id}/lessons/bulk/",
            {
                "action": "copy_from",
                "ids": [self.dst.id],
                "payload": {"source_lesson_id": self.src.id},
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertTrue(all(r.get("ok") for r in body.get("results", [])), body)
        self.dst.refresh_from_db()
        self.assertEqual(self.dst.title, "Ch.7")
        self.assertEqual(self.dst.instructions, "Original brief")
