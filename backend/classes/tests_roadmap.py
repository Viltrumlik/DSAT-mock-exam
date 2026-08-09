"""GET /api/classes/roadmap/ — the student's per-subject level ladder.

The load-bearing guarantees:
* every level of a studied subject is visible (own + locked), in ladder order;
* only the student's OWN level is openable — locked levels emit no ``assignment_id``;
* own-level lessons hydrate to upcoming / available / completed against real delivery;
* a subject the student doesn't study never appears; a removed membership drops out;
* English shows Foundation as a greyed "not offered" rung.
"""

from __future__ import annotations

from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from classes.models import Classroom, ClassroomMembership, Submission
from journals import delivery, services
from journals.models import Journal, JournalLesson

User = get_user_model()


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class RoadmapTestBase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            email="rm_admin@t.com", password="x", role=acc_const.ROLE_SUPER_ADMIN
        )
        self.student = User.objects.create_user(
            email="rm_student@t.com", password="x", role=acc_const.ROLE_STUDENT
        )
        # The student's own Math class → own level = middle.
        self.math_mid = Classroom.objects.create(
            name="Math Middle",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD,  # Mon/Wed/Fri
            lesson_time="18:00",
            start_date=date(2026, 8, 3),  # a Monday
            created_by=self.admin,
        )
        self._enrol(self.student, self.math_mid)

        # A published Math journal for EVERY level, so "all levels visible" is testable.
        self.j_found = self._journal("MATH", "foundation", homeworks=2)
        self.j_jun = self._journal("MATH", "junior", homeworks=2)
        self.j_mid = self._journal("MATH", "middle", homeworks=3, midterm=True)
        self.j_sen = self._journal("MATH", "senior", homeworks=2)

        self.client = APIClient()
        self.client.force_authenticate(self.student)

    # ── helpers ──────────────────────────────────────────────────────────────
    def _enrol(self, user, classroom):
        return ClassroomMembership.objects.create(
            classroom=classroom,
            user=user,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )

    def _journal(self, subject, level, *, homeworks=2, midterm=False) -> Journal:
        j, _ = services.create_journal(subject=subject, level=level, actor=self.admin)
        for i in range(homeworks):
            s = services.add_session(j, actor=self.admin)
            s.title = f"{level.title()} HW {i + 1}"
            s.instructions = "Do the exercises"
            s.allow_file_upload = True  # gives the session real content → releasable
            s.status = JournalLesson.STATUS_PUBLISHED  # only PUBLISHED lessons surface
            s.save()
        if midterm:
            m = services.add_session(j, actor=self.admin, lesson_type=JournalLesson.TYPE_MIDTERM)
            m.status = JournalLesson.STATUS_PUBLISHED
            m.save(update_fields=["status"])
        j.status = Journal.STATUS_PUBLISHED
        j.save(update_fields=["status"])
        return j

    def _get(self, client=None):
        r = (client or self.client).get("/api/classes/roadmap/")
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()

    def _track(self, data, subject):
        return next(t for t in data["tracks"] if t["subject"] == subject)

    def _level(self, track, level):
        return next(l for l in track["levels"] if l["level"] == level)


class RoadmapShapeTests(RoadmapTestBase):
    def test_single_math_track_all_levels_own_flagged(self):
        data = self._get()
        self.assertEqual([t["subject"] for t in data["tracks"]], ["math"])
        track = self._track(data, "math")
        self.assertEqual(track["own_level"], "middle")
        self.assertEqual(track["own_level_label"], "Middle")
        self.assertEqual(track["own_classroom_id"], self.math_mid.id)
        # All four rungs, in ladder order.
        self.assertEqual(
            [l["level"] for l in track["levels"]],
            ["foundation", "junior", "middle", "senior"],
        )
        for l in track["levels"]:
            self.assertTrue(l["offered"])  # Math offers every level
            self.assertTrue(l["journal_published"])
            self.assertEqual(l["is_own_level"], l["level"] == "middle")
        self.assertEqual(self._level(track, "middle")["lesson_count"], 4)  # 3 hw + 1 midterm
        self.assertEqual(self._level(track, "foundation")["lesson_count"], 2)

    def test_locked_levels_emit_no_openable_id(self):
        track = self._track(self._get(), "math")
        for level in ("foundation", "junior", "senior"):
            lvl = self._level(track, level)
            self.assertFalse(lvl["is_own_level"])
            self.assertTrue(lvl["lessons"])  # not empty — the outline is visible
            for les in lvl["lessons"]:
                self.assertIn("lesson_number", les)
                self.assertIn("title", les)
                self.assertIn("is_midterm", les)
                # The security boundary: a locked lesson never carries anything openable.
                self.assertNotIn("assignment_id", les)
                self.assertNotIn("state", les)
                self.assertNotIn("accessible", les)

    def test_midterm_marker_present_in_outline(self):
        track = self._track(self._get(), "math")
        middle = self._level(track, "middle")
        self.assertTrue(any(l["is_midterm"] for l in middle["lessons"]))

    def test_draft_lessons_are_hidden(self):
        # A DRAFT (in-authoring) session on a PUBLISHED journal must not surface — neither
        # on the own level nor on a locked level.
        wip_own = services.add_session(self.j_mid, actor=self.admin)  # DRAFT by default
        wip_own.title = "Own WIP"
        wip_own.instructions = "x"
        wip_own.allow_file_upload = True
        wip_own.save()
        wip_locked = services.add_session(self.j_found, actor=self.admin)
        wip_locked.title = "Locked WIP"
        wip_locked.save()

        track = self._track(self._get(), "math")
        own_titles = [l["title"] for l in self._level(track, "middle")["lessons"]]
        locked_titles = [l["title"] for l in self._level(track, "foundation")["lessons"]]
        self.assertNotIn("Own WIP", own_titles)
        self.assertNotIn("Locked WIP", locked_titles)


class RoadmapOwnLevelStateTests(RoadmapTestBase):
    def test_states_upcoming_available_completed(self):
        homeworks = list(
            self.j_mid.lessons.filter(lesson_type=JournalLesson.TYPE_HOMEWORK).order_by("lesson_number")
        )
        s1, s2, s3 = homeworks[0], homeworks[1], homeworks[2]
        # Release s1 (→ available) and s2, then mark s2 submitted (→ completed).
        delivery.release_homework(self.math_mid, s1, actor=self.admin)
        d2, _, _ = delivery.release_homework(self.math_mid, s2, actor=self.admin)
        Submission.objects.create(
            assignment=d2.assignment, student=self.student, status=Submission.STATUS_SUBMITTED
        )

        middle = self._level(self._track(self._get(), "math"), "middle")
        by_num = {l["lesson_number"]: l for l in middle["lessons"]}

        self.assertEqual(by_num[s1.lesson_number]["state"], "available")
        self.assertIsNotNone(by_num[s1.lesson_number]["assignment_id"])
        self.assertEqual(by_num[s2.lesson_number]["state"], "completed")
        self.assertEqual(by_num[s3.lesson_number]["state"], "upcoming")
        self.assertIsNone(by_num[s3.lesson_number]["assignment_id"])
        # Every own-level lesson is openable-in-principle (the rung is the student's).
        self.assertTrue(all(l["accessible"] for l in middle["lessons"]))

    def test_released_then_deleted_assignment_falls_back_to_upcoming(self):
        hw = (
            self.j_mid.lessons.filter(lesson_type=JournalLesson.TYPE_HOMEWORK)
            .order_by("lesson_number")
            .first()
        )
        d, _, _ = delivery.release_homework(self.math_mid, hw, actor=self.admin)
        # Deleting the released homework SET_NULLs ClassroomLesson.assignment but leaves
        # homework_released_at set — the roadmap must not show a dead "Open".
        d.assignment.delete()

        middle = self._level(self._track(self._get(), "math"), "middle")
        row = next(l for l in middle["lessons"] if l["lesson_number"] == hw.lesson_number)
        self.assertEqual(row["state"], "upcoming")
        self.assertIsNone(row["assignment_id"])


class RoadmapMultiSubjectTests(RoadmapTestBase):
    def test_two_tracks_for_two_subjects(self):
        eng = Classroom.objects.create(
            name="Eng Senior",
            subject=Classroom.SUBJECT_ENGLISH,
            level=Classroom.LEVEL_SENIOR,
            lesson_days=Classroom.DAYS_EVEN,
            lesson_time="17:00",
            start_date=date(2026, 8, 4),
            created_by=self.admin,
        )
        self._enrol(self.student, eng)
        self._journal("ENGLISH", "junior", homeworks=2)
        self._journal("ENGLISH", "middle", homeworks=2)
        self._journal("ENGLISH", "senior", homeworks=2)

        data = self._get()
        self.assertEqual(sorted(t["subject"] for t in data["tracks"]), ["english", "math"])

        etrack = self._track(data, "english")
        self.assertEqual(etrack["own_level"], "senior")
        self.assertTrue(self._level(etrack, "senior")["is_own_level"])
        # English has no Foundation → greyed "not offered" rung, no journal, no lessons.
        found = self._level(etrack, "foundation")
        self.assertFalse(found["offered"])
        self.assertFalse(found["journal_published"])
        self.assertEqual(found["lessons"], [])


class RoadmapEdgeCaseTests(RoadmapTestBase):
    def test_blank_level_classroom_has_no_own_level(self):
        stu = User.objects.create_user(
            email="rm_blank@t.com", password="x", role=acc_const.ROLE_STUDENT
        )
        cls = Classroom.objects.create(
            name="Math untagged",
            subject=Classroom.SUBJECT_MATH,
            level="",  # untagged
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            start_date=date(2026, 8, 3),
            created_by=self.admin,
        )
        self._enrol(stu, cls)
        c = APIClient()
        c.force_authenticate(stu)

        track = self._track(self._get(client=c), "math")
        self.assertIsNone(track["own_level"])
        self.assertTrue(all(not l["is_own_level"] for l in track["levels"]))

    def test_removed_membership_excluded(self):
        m = ClassroomMembership.objects.get(classroom=self.math_mid, user=self.student)
        m.status = ClassroomMembership.STATUS_REMOVED
        m.save(update_fields=["status"])
        self.assertEqual(self._get()["tracks"], [])

    def test_frozen_student_can_view(self):
        self.student.is_frozen = True
        self.student.save(update_fields=["is_frozen"])
        r = self.client.get("/api/classes/roadmap/")
        self.assertEqual(r.status_code, 200, r.content)

    def test_requires_authentication(self):
        r = APIClient().get("/api/classes/roadmap/")
        self.assertIn(r.status_code, (401, 403))
