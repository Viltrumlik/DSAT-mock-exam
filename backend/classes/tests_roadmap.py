"""GET /api/classes/roadmap/ — the student's per-subject level ladder.

The load-bearing guarantees:
* every level the SUBJECT offers is visible (own + locked), in ladder order;
* only the student's OWN level is openable — locked levels emit no ``assignment_id``;
* own-level lessons hydrate to upcoming / available / completed against real delivery;
* a subject the student doesn't study never appears; a removed membership drops out;
* English has no Foundation course, so an English track carries no Foundation rung at
  all — Math still carries all four. A mis-tagged own level is the one exception, kept so
  the student never ends up with a roadmap where no rung is theirs.
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
        # Math offers all four rungs, in ladder order — Foundation is a real Math course.
        self.assertEqual(
            [l["level"] for l in track["levels"]],
            ["foundation", "junior", "middle", "senior"],
        )
        for l in track["levels"]:
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
    def _enrol_english(self, level=Classroom.LEVEL_SENIOR) -> Classroom:
        eng = Classroom.objects.create(
            name=f"Eng {level.title()}",
            subject=Classroom.SUBJECT_ENGLISH,
            level=level,
            lesson_days=Classroom.DAYS_EVEN,
            lesson_time="17:00",
            start_date=date(2026, 8, 4),
            created_by=self.admin,
        )
        self._enrol(self.student, eng)
        return eng

    def test_two_tracks_for_two_subjects(self):
        eng = self._enrol_english()
        self._journal("ENGLISH", "junior", homeworks=2)
        self._journal("ENGLISH", "middle", homeworks=2)
        self._journal("ENGLISH", "senior", homeworks=2)

        data = self._get()
        self.assertEqual(sorted(t["subject"] for t in data["tracks"]), ["english", "math"])

        etrack = self._track(data, "english")
        self.assertEqual(etrack["own_level"], "senior")
        self.assertEqual(etrack["own_classroom_id"], eng.id)
        self.assertTrue(self._level(etrack, "senior")["is_own_level"])

        # THE English rule: there is no Foundation English course, so the ladder starts at
        # Junior. Not a greyed rung, not an empty one — the level is simply absent.
        self.assertEqual(
            [l["level"] for l in etrack["levels"]], ["junior", "middle", "senior"]
        )
        self.assertNotIn(
            "Foundation", [l["level_label"] for l in etrack["levels"]]
        )
        # …while Math, which really does teach Foundation, keeps all four rungs.
        self.assertEqual(
            [l["level"] for l in self._track(data, "math")["levels"]],
            ["foundation", "junior", "middle", "senior"],
        )

    def test_stray_english_foundation_journal_is_not_shown(self):
        """A legacy/hand-inserted English Foundation journal must not resurrect the rung.

        ``journals.services.create_journal`` refuses the pair, but a row predating that
        guard (or inserted straight into the DB) would otherwise re-enter the ladder via
        the journal lookup. The ladder is decided by the subject's curriculum, never by
        what happens to exist in the journals table.
        """
        self._enrol_english()
        self._journal("ENGLISH", "senior", homeworks=2)
        Journal.objects.create(
            subject="ENGLISH",
            level="foundation",
            status=Journal.STATUS_PUBLISHED,
            created_by=self.admin,
        )

        etrack = self._track(self._get(), "english")
        self.assertEqual(
            [l["level"] for l in etrack["levels"]], ["junior", "middle", "senior"]
        )

    def test_mistagged_english_foundation_classroom_keeps_its_own_rung(self):
        """The one exception, and why it exists.

        If a student's English classroom is (wrongly) tagged ``foundation``, dropping the
        rung would leave them a roadmap where NO level is theirs and their real released
        homework has no entry point — a silent hole. Their own rung stays; the rest of the
        English ladder is still Junior→Senior. Operators find and re-tag these rows; this
        test only pins the fallback so the data bug never becomes an invisible one.
        """
        self._enrol_english(level=Classroom.LEVEL_FOUNDATION)
        self._journal("ENGLISH", "junior", homeworks=2)

        etrack = self._track(self._get(), "english")
        self.assertEqual(etrack["own_level"], "foundation")
        self.assertEqual(
            [l["level"] for l in etrack["levels"]],
            ["foundation", "junior", "middle", "senior"],
        )
        self.assertTrue(self._level(etrack, "foundation")["is_own_level"])


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


class RoadmapProgressAndSatEstimateTests(RoadmapTestBase):
    """`completion_rate`, `next_level` and `months_to_sat` — the dashboard's three questions.

    All three are derived from the ladder that was just built, so the assertions here are
    really about one property: the summary at the top of a track can never disagree with the
    lessons underneath it.
    """

    def _set_durations(self, **by_level):
        """Author `duration_months` on the Math journals, the way /ops/journals does."""
        for level, months in by_level.items():
            j = Journal.objects.get(subject="MATH", level=level)
            j.duration_months = months
            j.save(update_fields=["duration_months"])

    def test_completion_rate_is_the_own_level_only(self):
        """A student in Middle has completed some of MIDDLE, not some of "Math".

        Rating them against the whole four-rung ladder would tell a Junior they are 25% of
        the way through a subject they have barely started.
        """
        homeworks = list(
            self.j_mid.lessons.filter(lesson_type=JournalLesson.TYPE_HOMEWORK).order_by("lesson_number")
        )
        d1, _, _ = delivery.release_homework(self.math_mid, homeworks[0], actor=self.admin)
        Submission.objects.create(
            assignment=d1.assignment, student=self.student, status=Submission.STATUS_SUBMITTED
        )

        track = self._track(self._get(), "math")
        # Middle holds 3 homeworks + 1 midterm; one of the four is done.
        self.assertEqual(track["total_lessons"], 4)
        self.assertEqual(track["completed_lessons"], 1)
        self.assertEqual(track["completion_rate"], 0.25)

    def test_next_level_is_the_rung_above_and_null_at_the_top(self):
        self.assertEqual(self._track(self._get(), "math")["next_level"], "senior")
        self.assertEqual(self._track(self._get(), "math")["next_level_label"], "Senior")

        # Move the student to the top rung; there is nothing above it.
        self.math_mid.level = Classroom.LEVEL_SENIOR
        self.math_mid.save(update_fields=["level"])
        track = self._track(self._get(), "math")
        self.assertEqual(track["own_level"], "senior")
        self.assertIsNone(track["next_level"])
        self.assertIsNone(track["next_level_label"])

    def test_months_left_is_the_rest_of_this_level_plus_every_level_above(self):
        """Nothing done yet in Middle → all of Middle (4) plus all of Senior (5)."""
        self._set_durations(foundation=3, junior=4, middle=4, senior=5)
        data = self._get()
        self.assertEqual(self._track(data, "math")["months_remaining"], 9.0)
        self.assertEqual(data["months_to_sat"], 9.0)
        self.assertEqual(data["months_to_sat_basis"], ["math"])

    def test_finishing_lessons_shortens_the_estimate(self):
        """The current level is prorated by lessons, so progress has to move the number."""
        self._set_durations(middle=4, senior=5)
        homeworks = list(
            self.j_mid.lessons.filter(lesson_type=JournalLesson.TYPE_HOMEWORK).order_by("lesson_number")
        )
        # Two of Middle's four lessons done → half of Middle's 4 months remain, plus Senior.
        for hw in homeworks[:2]:
            d, _, _ = delivery.release_homework(self.math_mid, hw, actor=self.admin)
            Submission.objects.create(
                assignment=d.assignment, student=self.student, status=Submission.STATUS_SUBMITTED
            )
        self.assertEqual(self._track(self._get(), "math")["months_remaining"], 7.0)

    def test_a_zeroed_duration_reads_as_unknown_not_as_zero(self):
        """A remaining ladder worth 0 months means nobody knows, not "you finish today".

        A journal created the normal way always carries a real duration — `create_journal`
        takes it from `journals.structure.COURSE_STRUCTURE`, the school's actual curriculum
        (Foundation 1 month, Junior 3, Middle 2, Senior 2). So this guard only fires when
        somebody has zeroed the field by hand, which /django-admin/ allows. It is kept
        because the alternative is a card telling a student in Middle they can sit the SAT
        this afternoon.
        """
        self._set_durations(foundation=0, junior=0, middle=0, senior=0)

        data = self._get()
        self.assertIsNone(self._track(data, "math")["months_remaining"])
        self.assertIsNone(data["months_to_sat"])
        self.assertEqual(data["months_to_sat_basis"], [])

    def test_a_normally_created_journal_already_carries_its_duration(self):
        """The estimate works out of the box — nobody has to author anything first.

        Pins the premise the guard above depends on: Middle is 2 months and Senior is 2, so
        a student at the start of Middle has 4 months of course left with no admin input at
        all.
        """
        data = self._get()  # nothing authored by this test
        self.assertEqual(self._track(data, "math")["months_remaining"], 4.0)
        self.assertEqual(data["months_to_sat"], 4.0)

    def test_the_sat_estimate_is_the_slower_subject_never_the_sum(self):
        """One exam, both sections — a student is ready when the LATER course finishes."""
        eng = Classroom.objects.create(
            name="English Junior",
            subject=Classroom.SUBJECT_ENGLISH,
            level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            start_date=date(2026, 8, 3),
            created_by=self.admin,
        )
        self._enrol(self.student, eng)
        for level, months in (("junior", 2), ("middle", 3), ("senior", 3)):
            j = self._journal("ENGLISH", level)
            j.duration_months = months
            j.save(update_fields=["duration_months"])
        self._set_durations(middle=4, senior=5)

        data = self._get()
        self.assertEqual(self._track(data, "math")["months_remaining"], 9.0)
        self.assertEqual(self._track(data, "english")["months_remaining"], 8.0)
        # 9, not 17 — and not 8 either.
        self.assertEqual(data["months_to_sat"], 9.0)
        self.assertEqual(sorted(data["months_to_sat_basis"]), ["english", "math"])

    def test_a_subject_we_cannot_estimate_is_left_out_rather_than_counted_as_zero(self):
        """An unknown English course must not read as "English is already finished"."""
        eng = Classroom.objects.create(
            name="English Junior",
            subject=Classroom.SUBJECT_ENGLISH,
            level=Classroom.LEVEL_JUNIOR,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            start_date=date(2026, 8, 3),
            created_by=self.admin,
        )
        self._enrol(self.student, eng)
        for level in ("junior", "middle", "senior"):
            j = self._journal("ENGLISH", level)
            # Zeroed by hand — the only way a real journal ends up with no duration, since
            # create_journal takes one from the curriculum map.
            j.duration_months = 0
            j.save(update_fields=["duration_months"])
        self._set_durations(middle=4, senior=5)

        data = self._get()
        self.assertIsNone(self._track(data, "english")["months_remaining"])
        self.assertEqual(data["months_to_sat"], 9.0)
        self.assertEqual(data["months_to_sat_basis"], ["math"])

    def test_a_student_with_no_level_gets_nulls_not_zeroes(self):
        """A blank-level classroom sets no own level, so there is nothing to be part-way through."""
        self.math_mid.level = ""
        self.math_mid.save(update_fields=["level"])
        data = self._get()
        track = self._track(data, "math")
        self.assertIsNone(track["own_level"])
        self.assertIsNone(track["completion_rate"])
        self.assertIsNone(track["next_level"])
        self.assertIsNone(track["months_remaining"])
        self.assertIsNone(data["months_to_sat"])


class RoadmapCurrentWeekTests(RoadmapTestBase):
    """`current_week` — which week the GROUP is in, counted in lessons held."""

    def test_the_week_counts_lessons_held_not_calendar_weeks(self):
        """A Mon/Wed/Fri group meets three times a week, so lesson 4 opens week 2.

        Counted this way the dashboard agrees with the attendance register. Counting calendar
        weeks would call the Monday after a Wednesday start "week 2" while the register still
        shows only four lessons.
        """
        from datetime import timedelta as _td
        from django.utils import timezone as _tz

        today = _tz.localtime().date()
        # Rewind to a Monday so the fixture's ODD (Mon/Wed/Fri) schedule is predictable.
        monday = today - _td(days=today.weekday())

        # Started this Monday → by today the group has met at least once: week 1.
        self.math_mid.start_date = monday
        self.math_mid.save(update_fields=["start_date"])
        self.assertEqual(self._track(self._get(), "math")["current_week"], 1)

        # Started three weeks ago → nine lessons in, which is week 3.
        self.math_mid.start_date = monday - _td(days=14)
        self.math_mid.save(update_fields=["start_date"])
        self.assertEqual(self._track(self._get(), "math")["current_week"], 3)

    def test_a_group_that_has_not_met_yet_has_no_week(self):
        """"Week 1" is a claim, and a class starting next month has not earned it."""
        from datetime import timedelta as _td
        from django.utils import timezone as _tz

        self.math_mid.start_date = _tz.localtime().date() + _td(days=30)
        self.math_mid.save(update_fields=["start_date"])
        self.assertIsNone(self._track(self._get(), "math")["current_week"])

    def test_an_unreadable_schedule_reads_as_unknown_rather_than_week_one(self):
        """`lesson_days` does go dirty in this codebase — it must not become a wrong number."""
        self.math_mid.lesson_days = "NONSENSE"
        self.math_mid.save(update_fields=["lesson_days"])
        self.assertIsNone(self._track(self._get(), "math")["current_week"])
