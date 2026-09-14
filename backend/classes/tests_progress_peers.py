"""My Progress — you beside your group.

What these pin, most likely-to-break first:

  * "you" in the comparison is the SAME number the ladder shows for that classroom — two
    different figures for one student's attendance is the bug the strikes fix (#180) was about;
  * the group is the roster (ACTIVE students), never every membership row that ever existed;
  * below the minimum group size nothing about the group is said at all;
  * only aggregates leave: no classmate's email or individual number is in the payload;
  * a teacher who hid the class leaderboard gets no bands either.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from classes.models_attendance import AttendanceRecord, AttendanceSession
from classes.models_ranking import ClassroomRankingConfig
from classes.progress import student_progress
from classes.progress_peers import MIN_PEERS, RECENT_LESSONS, peer_progress
from vocabulary.models import VocabSection, VocabWord, VocabWordProgress

User = get_user_model()

P = AttendanceRecord.STATUS_PRESENT
L = AttendanceRecord.STATUS_LATE
A = AttendanceRecord.STATUS_ABSENT
E = AttendanceRecord.STATUS_EXCUSED


class PeerFixture(TestCase):
    subject = Classroom.SUBJECT_MATH

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user("pp_admin@t.com", "secret123", role=C.ROLE_ADMIN)
        self.student = User.objects.create_user("pp_student@t.com", "secret123")
        self.classroom = Classroom.objects.create(
            name="Junior G1", subject=self.subject, level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD, created_by=self.admin,
        )
        self._join(self.student)
        self.sessions = [self._session(date(2026, 3, 2) + timedelta(days=i)) for i in range(4)]
        self._mates = 0

    def _session(self, day):
        return AttendanceSession.objects.create(classroom=self.classroom, date=day, created_by=self.admin)

    def _join(self, user, status=ClassroomMembership.STATUS_ACTIVE):
        return ClassroomMembership.objects.create(
            classroom=self.classroom, user=user, role=ClassroomMembership.ROLE_STUDENT, status=status,
        )

    def classmate(self, *statuses, status=ClassroomMembership.STATUS_ACTIVE):
        self._mates += 1
        user = User.objects.create_user(f"pp_mate{self._mates}@t.com", "secret123")
        self._join(user, status=status)
        self.attend(user, *statuses)
        return user

    def attend(self, user, *statuses):
        for session, status in zip(self.sessions, statuses):
            AttendanceRecord.objects.create(session=session, student=user, status=status)

    def homework(self, count, category=Assignment.CATEGORY_HOMEWORK):
        return [
            Assignment.objects.create(
                classroom=self.classroom, title=f"{category} {i}", status=Assignment.STATUS_PUBLISHED,
                category=category, created_by=self.admin,
            )
            for i in range(count)
        ]

    def complete(self, user, assignments):
        for assignment in assignments:
            Submission.objects.create(assignment=assignment, student=user, status=Submission.STATUS_SUBMITTED)

    def group(self):
        groups = peer_progress(self.student)["groups"]
        self.assertEqual(len(groups), 1)
        return groups[0]


class SameNumbersAsTheLadderTests(PeerFixture):
    def test_you_is_the_ladders_number_for_that_classroom(self):
        self.attend(self.student, P, L, A, E)
        work = self.homework(4)
        self.complete(self.student, work[:3])
        for statuses in ((P, P, P, P), (P, A, A, A), (L, L, L, L), (A, A, P, P)):
            mate = self.classmate(*statuses)
            self.complete(mate, work[:1])

        ladder = student_progress(self.student)["tracks"][0]
        row = [lv for lv in ladder["levels"] if lv["state"] == "current"][0]
        metrics = self.group()["metrics"]
        self.assertEqual(metrics["attendance"]["you"], row["attendance"]["rate"])
        self.assertEqual(metrics["homework"]["you"], row["homework"]["rate"])
        self.assertEqual(metrics["overall"]["you"], row["overall"])

    def test_classwork_is_not_homework_here_either(self):
        self.complete(self.student, self.homework(2))
        self.homework(3, category=Assignment.CATEGORY_CLASSWORK)
        homework = self.group()["metrics"]["homework"]
        self.assertEqual(homework["detail"]["total"], 2)
        self.assertEqual(homework["you"], 100.0)


class GroupFigureTests(PeerFixture):
    def build_even_spread(self):
        # you 100 · mates 75, 50, 25, 0 → five measured, average 50, median 50.
        self.attend(self.student, P, P, P, P)
        self.classmate(P, P, P, A)
        self.classmate(P, P, A, A)
        self.classmate(P, A, A, A)
        self.classmate(A, A, A, A)

    def test_average_and_median_over_the_group_including_you(self):
        self.build_even_spread()
        group = self.group()
        attendance = group["metrics"]["attendance"]
        self.assertEqual(attendance["group_average"], 50.0)
        self.assertEqual(attendance["group_median"], 50.0)
        self.assertEqual(attendance["measured"], 5)
        self.assertEqual(group["group_size"], 5)
        self.assertFalse(group["standings_hidden"])

    def test_a_removed_student_is_not_the_group(self):
        """Removal is a soft delete. Their perfect register must not lift the average."""
        self.build_even_spread()
        self.classmate(P, P, P, P, status=ClassroomMembership.STATUS_REMOVED)
        group = self.group()
        self.assertEqual(group["metrics"]["attendance"]["group_average"], 50.0)
        self.assertEqual(group["group_size"], 5)

    def test_too_few_classmates_says_nothing_about_the_group(self):
        self.attend(self.student, P, P, P, P)
        for _ in range(MIN_PEERS - 1):
            self.classmate(A, A, A, A)
        attendance = self.group()["metrics"]["attendance"]
        self.assertEqual(attendance["you"], 100.0)
        self.assertIsNone(attendance["group_average"])
        self.assertIsNone(attendance["group_median"])
        self.assertIsNone(attendance["standing"])

    def test_classmates_with_nothing_marked_are_not_counted_as_zero(self):
        self.build_even_spread()
        self.classmate()  # on the roster, never marked
        group = self.group()
        self.assertEqual(group["metrics"]["attendance"]["group_average"], 50.0)
        self.assertEqual(group["metrics"]["attendance"]["measured"], 5)
        self.assertEqual(group["group_size"], 6)


class StandingTests(PeerFixture):
    def test_the_top_of_the_group(self):
        self.attend(self.student, P, P, P, P)
        for statuses in ((P, P, P, A), (P, P, A, A), (P, A, A, A), (A, A, A, A)):
            self.classmate(*statuses)
        self.assertEqual(self.group()["metrics"]["attendance"]["standing"], "top_quarter")

    def test_the_lower_half(self):
        self.attend(self.student, A, A, A, A)
        for statuses in ((P, P, P, P), (P, P, P, A), (P, P, A, A), (P, A, A, A)):
            self.classmate(*statuses)
        self.assertEqual(self.group()["metrics"]["attendance"]["standing"], "lower_half")

    def test_ties_count_in_the_students_favour(self):
        self.attend(self.student, P, P, A, A)
        for statuses in ((P, P, A, A), (A, A, P, P), (P, A, P, A), (P, P, P, P)):
            self.classmate(*statuses)
        self.assertEqual(self.group()["metrics"]["attendance"]["standing"], "top_quarter")

    def test_a_hidden_leaderboard_hides_the_band_but_not_the_average(self):
        ClassroomRankingConfig.objects.create(
            classroom=self.classroom, leaderboard_mode=ClassroomRankingConfig.MODE_HIDDEN,
        )
        self.attend(self.student, P, P, P, P)
        for statuses in ((P, P, P, A), (P, P, A, A), (P, A, A, A), (A, A, A, A)):
            self.classmate(*statuses)
        group = self.group()
        self.assertTrue(group["standings_hidden"])
        self.assertIsNone(group["metrics"]["attendance"]["standing"])
        self.assertEqual(group["metrics"]["attendance"]["group_average"], 50.0)

    def test_reading_the_setting_writes_nothing(self):
        self.attend(self.student, P, P, P, P)
        self.group()
        self.assertFalse(ClassroomRankingConfig.objects.filter(classroom=self.classroom).exists())


class HomeworkGapTests(PeerFixture):
    def test_how_many_more_would_reach_the_group_average(self):
        work = self.homework(5)
        self.complete(self.student, work[:2])  # 40%
        for done in (4, 4, 3, 5):  # 80, 80, 60, 100 → average with you 72
            self.complete(self.classmate(), work[:done])
        homework = self.group()["metrics"]["homework"]
        self.assertEqual(homework["group_average"], 72.0)
        self.assertEqual(homework["detail"]["completed"], 2)
        self.assertEqual(homework["detail"]["remaining"], 3)
        # 72% of 5 is 3.6 → four pieces reach it; two more than done.
        self.assertEqual(homework["detail"]["to_reach_average"], 2)

    def test_nothing_to_reach_when_already_there(self):
        work = self.homework(2)
        self.complete(self.student, work)
        for _ in range(MIN_PEERS):
            self.complete(self.classmate(), work[:1])
        self.assertEqual(self.group()["metrics"]["homework"]["detail"]["to_reach_average"], 0)


class RecentAndTrendTests(PeerFixture):
    def test_recent_lessons_are_the_students_own_newest_last(self):
        extra = [self._session(date(2026, 4, 1) + timedelta(days=i)) for i in range(8)]
        self.attend(self.student, P, P, P, P)
        for session in extra:
            AttendanceRecord.objects.create(session=session, student=self.student, status=L)
        recent = self.group()["recent_lessons"]
        self.assertEqual(len(recent), RECENT_LESSONS)
        self.assertEqual(recent[-1], {"date": "2026-04-08", "status": L})
        self.assertEqual([r["date"] for r in recent], sorted(r["date"] for r in recent))

    def test_the_trend_gives_a_group_figure_only_for_months_with_enough_marks(self):
        self.attend(self.student, P, P, P, P)
        for _ in range(MIN_PEERS):
            self.classmate(P, P, A, A)
        april = self._session(date(2026, 4, 6))
        AttendanceRecord.objects.create(session=april, student=self.student, status=A)
        trend = self.group()["attendance_trend"]
        self.assertEqual([t["month"] for t in trend], ["2026-03", "2026-04"])
        self.assertEqual(trend[0], {"month": "2026-03", "you": 100.0, "group": 60.0})
        self.assertEqual(trend[1], {"month": "2026-04", "you": 0.0, "group": None})


class VocabularyTests(PeerFixture):
    subject = Classroom.SUBJECT_ENGLISH

    def master(self, user, count):
        section = VocabSection.objects.create(title=f"S{user.id}", slug=f"s-{user.id}", is_published=True, order=0)
        for i in range(count):
            word = VocabWord.objects.create(section=section, word=f"w{user.id}-{i}", definition="d")
            VocabWordProgress.objects.create(user=user, word=word, status=VocabWordProgress.STATUS_MASTERED)

    def test_words_mastered_on_an_english_group(self):
        self.master(self.student, 6)
        for count in (2, 7, 0, 8):
            self.master(self.classmate(), count)
        vocabulary = self.group()["metrics"]["vocabulary"]
        self.assertEqual(vocabulary["you"], 6.0)
        self.assertEqual(vocabulary["group_average"], 4.6)  # (6+2+7+0+8)/5
        # At or above two of four classmates: the upper half, not the top quarter.
        self.assertEqual(vocabulary["standing"], "upper_half")


class MathHasNoVocabularyTests(PeerFixture):
    def test_a_math_group_is_not_compared_on_vocabulary(self):
        self.attend(self.student, P, P, P, P)
        self.assertNotIn("vocabulary", self.group()["metrics"])


class PrivacyAndEndpointTests(PeerFixture):
    def test_no_classmate_is_named_in_the_payload(self):
        self.attend(self.student, P, P, P, P)
        mates = [self.classmate(A, A, A, A) for _ in range(MIN_PEERS)]
        body = json.dumps(peer_progress(self.student))
        for mate in mates:
            self.assertNotIn(mate.email, body)
        self.assertEqual(
            set(self.group()["metrics"]["attendance"]),
            {"you", "group_average", "group_median", "measured", "standing", "detail"},
        )

    def test_a_student_in_no_class_gets_no_groups(self):
        nobody = User.objects.create_user("pp_nobody@t.com", "secret123")
        self.assertEqual(peer_progress(nobody)["groups"], [])

    def test_the_endpoint_serves_the_requesting_student(self):
        self.attend(self.student, P, P, P, P)
        self.client.force_authenticate(self.student)
        r = self.client.get("/api/classes/progress/peers/")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["groups"][0]["classroom_id"], self.classroom.id)
        self.assertEqual(r.json()["min_peers"], MIN_PEERS)

    def test_it_needs_a_login(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/classes/progress/peers/").status_code, (401, 403))
