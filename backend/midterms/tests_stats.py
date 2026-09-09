"""Midterm statistics: the owner's pass-rate formula, and the traps around it.

    python manage.py test midterms.tests_stats --settings=config.settings_test_nomigrations

Every test here exists because the number it protects could plausibly have been computed a
different way — absentees dropped from the denominator, a retake pass ignored, a branch
figure averaged out of its classrooms' percentages. Each of those produces a believable
report that flatters or punishes a teacher wrongly, and none of them looks like a bug.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from classes.models import Branch, Classroom, ClassroomMembership, Region
from classes.models_schedule import MidtermSchedule
from exams.models import Module
from midterms import stats
from midterms.models import Midterm, MidtermAttempt, MidtermOutcome

User = get_user_model()

SEPTEMBER = timezone.make_aware(timezone.datetime(2026, 9, 10, 9, 0))
OCTOBER = timezone.make_aware(timezone.datetime(2026, 10, 12, 9, 0))


def month_offset(offset: int):
    """09:00 on the 10th of the month ``offset`` months from now, in the school's own zone.

    Anything that asserts on "future" or "the default month" has to be anchored to the real
    clock rather than to a literal, or the test silently changes meaning the moment the wall
    clock passes it — which is exactly how a September fixture came to be asserting that the
    page may open on an October nobody has sat.
    """
    now = timezone.localtime(timezone.now())
    total = now.year * 12 + (now.month - 1) + offset
    year, month = divmod(total, 12)
    return timezone.make_aware(timezone.datetime(year, month + 1, 10, 9, 0))


LAST_MONTH_AT = month_offset(-1)
THIS_MONTH_AT = month_offset(0)
NEXT_MONTH_AT = month_offset(1)
LAST_MONTH = LAST_MONTH_AT.strftime(stats.MONTH_FMT)
THIS_MONTH = THIS_MONTH_AT.strftime(stats.MONTH_FMT)
NEXT_MONTH = NEXT_MONTH_AT.strftime(stats.MONTH_FMT)


def make_midterm(title, *, midterm_type=Midterm.TYPE_MIDTERM, retake_of=None, pass_mark=500):
    """A published, question-less midterm. Statistics read verdicts, never question rows."""
    return Midterm.objects.create(
        title=title,
        subject=Midterm.MATH,
        scoring_scale=Midterm.SCALE_800,
        midterm_type=midterm_type,
        pass_mark=pass_mark if midterm_type in Midterm.GRADED_TYPES else None,
        retake_of=retake_of,
        duration_minutes=30,
        question_module=Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30),
        is_published=True,
    )


def sit(midterm, student, *, score, when=None):
    """A COMPLETED attempt with its frozen verdict, without the timer dance."""
    when = when or timezone.now()
    attempt = MidtermAttempt.objects.create(
        midterm=midterm,
        student=student,
        current_state=MidtermAttempt.STATE_COMPLETED,
        is_completed=True,
        score=score,
        started_at=when,
        submitted_at=when,
        completed_at=when,
    )
    MidtermOutcome.record_for(attempt)
    return attempt


def make_classroom(name, admin, *, subject=Classroom.SUBJECT_MATH, teacher=None, branch=None):
    return Classroom.objects.create(
        name=name,
        subject=subject,
        level=Classroom.LEVEL_SENIOR,
        lesson_days=Classroom.DAYS_ODD,
        teacher=teacher,
        branch=branch,
        created_by=admin,
    )


def enrol(classroom, *students, status=ClassroomMembership.STATUS_ACTIVE):
    for student in students:
        ClassroomMembership.objects.create(
            classroom=classroom, user=student, role=ClassroomMembership.ROLE_STUDENT, status=status
        )


def students(prefix, count):
    return [
        User.objects.create(username=f"{prefix}{i}", first_name=f"{prefix.title()}{i}", last_name="X")
        for i in range(count)
    ]


class TallyArithmeticTests(TestCase):
    """The dataclass on its own — no database, no ambiguity about what went in."""

    def test_pass_rate_is_over_the_whole_roster(self):
        tally = stats.Tally(roster=10, attended=9, passed_first=9, absent=1)
        self.assertEqual(tally.passed, 9)
        self.assertEqual(tally.pass_rate, 90.0)  # the owner's own worked example

    def test_a_retake_pass_is_in_the_numerator(self):
        tally = stats.Tally(roster=10, attended=10, passed_first=7, passed_retake=2, failed=1)
        self.assertEqual(tally.passed, 9)
        self.assertEqual(tally.pass_rate, 90.0)

    def test_an_empty_roster_is_none_not_zero(self):
        empty = stats.Tally()
        self.assertIsNone(empty.pass_rate)
        self.assertIsNone(empty.attendance_rate)
        self.assertIsNone(empty.first_try_share)
        self.assertIsNone(empty.retake_share)

    def test_shares_are_none_when_nobody_passed(self):
        """The divide-by-zero that hides behind a share OF PASSERS."""
        wiped_out = stats.Tally(roster=12, attended=12, failed=12)
        self.assertEqual(wiped_out.pass_rate, 0.0)  # measured, and genuinely zero
        self.assertIsNone(wiped_out.first_try_share)
        self.assertIsNone(wiped_out.retake_share)

    def test_the_two_shares_are_of_passers_and_sum_to_100(self):
        tally = stats.Tally(roster=10, attended=10, passed_first=2, passed_retake=1, failed=7)
        self.assertEqual(tally.first_try_share, 66.7)
        self.assertEqual(tally.retake_share, 33.3)
        self.assertEqual(tally.first_try_share + tally.retake_share, 100.0)

    def test_merging_pools_rather_than_averaging(self):
        small = stats.Tally(roster=2, attended=2, passed_first=2)          # 100%
        large = stats.Tally(roster=30, attended=30, passed_first=15, failed=15)  # 50%
        pooled = small.merged(large)
        self.assertEqual(pooled.roster, 32)
        self.assertEqual(pooled.passed, 17)
        self.assertEqual(pooled.pass_rate, 53.1)
        self.assertNotEqual(pooled.pass_rate, 75.0)  # the mean of the two percentages


class ClassroomTallyTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.teacher = User.objects.create(username="t1", role="teacher", first_name="Nodir", last_name="T")
        self.classroom = make_classroom("Math Senior A", self.admin, teacher=self.teacher)
        self.students = students("s", 10)
        enrol(self.classroom, *self.students)
        # A removed member is not on the roster, so they are in neither half of the rate.
        self.gone = User.objects.create(username="gone")
        enrol(self.classroom, self.gone, status=ClassroomMembership.STATUS_REMOVED)
        self.midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=SEPTEMBER
        )

    def test_nine_of_ten_pass_is_ninety_percent(self):
        for student in self.students[:9]:
            sit(self.midterm, student, score=800)
        sit(self.midterm, self.students[9], score=200)
        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.roster, 10)
        self.assertEqual(tally.pass_rate, 90.0)
        self.assertEqual(tally.first_try_share, 100.0)
        self.assertEqual(tally.retake_share, 0.0)

    def test_an_absentee_counts_as_a_failure(self):
        """Nine pass and the tenth never turns up: 90%, not 100%."""
        for student in self.students[:9]:
            sit(self.midterm, student, score=800)
        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.absent, 1)
        self.assertEqual(tally.attended, 9)
        self.assertEqual(tally.attendance_rate, 90.0)
        self.assertEqual(tally.pass_rate, 90.0)

    def test_the_columns_always_sum_to_the_roster(self):
        sit(self.midterm, self.students[0], score=800)
        sit(self.midterm, self.students[1], score=200)
        MidtermAttempt.objects.create(
            midterm=self.midterm, student=self.students[2],
            current_state=MidtermAttempt.STATE_ACTIVE, started_at=timezone.now(),
        )
        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.pending, 1)
        self.assertEqual(
            tally.passed_first + tally.passed_retake + tally.failed + tally.absent + tally.pending,
            tally.roster,
        )

    def test_a_retake_pass_lands_in_the_numerator(self):
        retake = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students[:7]:
            sit(self.midterm, student, score=800)
        for student in self.students[7:]:
            sit(self.midterm, student, score=200)
        sit(retake, self.students[7], score=800)
        sit(retake, self.students[8], score=800)

        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.passed_first, 7)
        self.assertEqual(tally.passed_retake, 2)
        self.assertEqual(tally.failed, 1)
        self.assertEqual(tally.pass_rate, 90.0)
        self.assertEqual(tally.retake_taken, 2)
        self.assertEqual(tally.retake_passed, 2)
        self.assertEqual(tally.retake_failed, 0)
        self.assertEqual(tally.first_try_share, 77.8)
        self.assertEqual(tally.retake_share, 22.2)

    def test_all_retakes_of_one_parent_are_unioned(self):
        """``retake_for`` returns only the FIRST retake; a second one rescues just as well."""
        first = make_midterm("Retake A", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        second = make_midterm("Retake B", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students:
            sit(self.midterm, student, score=200)
        sit(first, self.students[0], score=800)
        sit(second, self.students[1], score=800)   # rescued by the SECOND retake
        sit(second, self.students[2], score=200)   # sat it, still failed

        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.passed_retake, 2)
        self.assertEqual(tally.pass_rate, 20.0)
        self.assertEqual(tally.retake_taken, 3)
        self.assertEqual(tally.retake_passed, 2)
        self.assertEqual(tally.retake_failed, 1)

    def test_an_absentee_the_retake_rescued_is_a_pass_not_a_failure(self):
        """The cohort the retake exists for. ``midterms.access`` grants a retake to failers
        AND absentees — *"a student who was ill that morning"* — so a class in which every
        student holds a pass must read 100%, not 80% with two of them still marked absent.
        """
        retake = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students[:7]:
            sit(self.midterm, student, score=800)
        sit(self.midterm, self.students[7], score=200)          # sat it and failed
        # students[8] and students[9] never turned up to the parent at all.
        sit(retake, self.students[7], score=800)
        sit(retake, self.students[8], score=800)
        sit(retake, self.students[9], score=800)

        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.passed_first, 7)
        self.assertEqual(tally.passed_retake, 3)
        self.assertEqual(tally.failed, 0)
        self.assertEqual(tally.absent, 0)
        self.assertEqual(tally.attended, 8)      # attendance is the PARENT's, and stays 8
        self.assertEqual(tally.pass_rate, 100.0)
        self.assertEqual(tally.retake_taken, 3)
        self.assertEqual(tally.retake_passed, 3)

    def test_an_absentee_who_never_sat_the_retake_either_is_still_absent(self):
        """The other side of the same branch: a retake existing does not excuse anybody."""
        make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students[:9]:
            sit(self.midterm, student, score=800)
        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.absent, 1)
        self.assertEqual(tally.passed_retake, 0)
        self.assertEqual(tally.pass_rate, 90.0)

    def test_the_evidence_table_agrees_about_a_rescued_absentee(self):
        """The headline said 100%; the per-student table must not still say ABSENT."""
        from midterms.admin_report import build_midterm_rows, retakes_for

        retake = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students[:9]:
            sit(self.midterm, student, score=800)
        sit(retake, self.students[9], score=800)   # absent from the parent, passed the retake

        rows, summary = build_midterm_rows(self.classroom, self.midterm, list(retakes_for(self.midterm)))
        rescued = next(r for r in rows if r["student_id"] == self.students[9].id)
        self.assertEqual(rescued["final_status"], "PASSED_ON_RETAKE")
        self.assertTrue(rescued["retake_eligible"])
        self.assertEqual(rescued["retake_score"], 800)
        self.assertEqual(summary["passed"], 10)
        self.assertEqual(summary["absent"], 0)

        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.passed, summary["passed"])
        self.assertEqual(tally.absent, summary["absent"])

    def test_the_evidence_table_reads_the_retake_that_rescued_the_student(self):
        """``retake_for`` returns the FIRST retake only, so a student rescued by the second
        appeared in the table as a failure while the headline counted them as a pass."""
        from midterms.admin_report import build_midterm_rows, retakes_for

        make_midterm("Retake A", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        second = make_midterm("Retake B", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students:
            sit(self.midterm, student, score=200)
        sit(second, self.students[0], score=800)

        rows, summary = build_midterm_rows(self.classroom, self.midterm, list(retakes_for(self.midterm)))
        rescued = next(r for r in rows if r["student_id"] == self.students[0].id)
        self.assertEqual(rescued["final_status"], "PASSED_ON_RETAKE")
        self.assertEqual(rescued["retake_score"], 800)
        self.assertEqual(summary["passed"], 1)

        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.passed, summary["passed"])
        self.assertEqual(tally.failed, summary["failed"])

    def test_an_empty_roster_reports_none(self):
        empty = make_classroom("Nobody Yet", self.admin, teacher=self.teacher)
        MidtermSchedule.objects.create(classroom=empty, midterm=self.midterm, starts_at=SEPTEMBER)
        tally = stats.classroom_midterm_tally(empty, self.midterm)
        self.assertEqual(tally.roster, 0)
        self.assertIsNone(tally.pass_rate)
        self.assertIsNone(tally.attendance_rate)

    def test_it_agrees_with_the_admin_reports_own_summary(self):
        """The statistic and the per-student table underneath it read the same roster."""
        from midterms.admin_report import build_midterm_rows, retake_for

        retake = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        for student in self.students[:6]:
            sit(self.midterm, student, score=800)
        for student in self.students[6:]:
            sit(self.midterm, student, score=200)
        sit(retake, self.students[6], score=800)

        _rows, summary = build_midterm_rows(self.classroom, self.midterm, retake_for(self.midterm))
        tally = stats.classroom_midterm_tally(self.classroom, self.midterm)
        self.assertEqual(tally.roster, summary["students"])
        self.assertEqual(tally.passed, summary["passed"])
        self.assertEqual(tally.failed, summary["failed"])
        self.assertEqual(tally.absent, summary["absent"])
        self.assertEqual(tally.pending, summary["pending"])


class MonthResolutionTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 3)
        enrol(self.classroom, *self.students)
        self.midterm = make_midterm("Midterm 12")

    def test_the_schedule_wins(self):
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=SEPTEMBER
        )
        sit(self.midterm, self.students[0], score=800, when=OCTOBER)
        self.assertEqual(stats.month_key_for(self.classroom.id, self.midterm.id), "2026-09")
        self.assertEqual(
            stats.month_for(self.classroom.id, self.midterm.id)[1], stats.MONTH_BASIS_SCHEDULE
        )

    def test_a_null_starts_at_falls_back_to_the_first_sitting(self):
        """``journals.delivery`` and legacy rows leave ``starts_at`` NULL — the schedule row
        exists but says nothing about when."""
        MidtermSchedule.objects.create(classroom=self.classroom, midterm=self.midterm, starts_at=None)
        sit(self.midterm, self.students[1], score=800, when=OCTOBER)
        sit(self.midterm, self.students[0], score=800, when=SEPTEMBER)  # earliest wins
        key, basis = stats.month_for(self.classroom.id, self.midterm.id)
        self.assertEqual(key, "2026-09")
        self.assertEqual(basis, stats.MONTH_BASIS_ATTEMPT)

    def test_no_schedule_and_no_sitting_falls_back_to_publication(self):
        Midterm.objects.filter(pk=self.midterm.pk).update(published_at=OCTOBER)
        key, basis = stats.month_for(self.classroom.id, self.midterm.id)
        self.assertEqual(key, "2026-10")
        self.assertEqual(basis, stats.MONTH_BASIS_PUBLISHED)

    def test_a_pair_that_resolves_to_nothing_returns_none_rather_than_raising(self):
        missing_id = self.midterm.id
        self.midterm.delete()
        self.assertIsNone(stats.month_key_for(self.classroom.id, missing_id))
        self.assertEqual(stats.month_for(self.classroom.id, missing_id), (None, None))
        # And the roll-up simply does not see it.
        self.assertEqual(stats.available_months(), [])

    def test_the_month_is_local_time_not_utc(self):
        """01:00 on 1 October in Tashkent is 20:00 on 30 September UTC."""
        MidtermSchedule.objects.create(
            classroom=self.classroom,
            midterm=self.midterm,
            starts_at=timezone.make_aware(timezone.datetime(2026, 10, 1, 1, 0)),
        )
        self.assertEqual(stats.month_key_for(self.classroom.id, self.midterm.id), "2026-10")

    def test_available_months_are_newest_first(self):
        other = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=SEPTEMBER
        )
        MidtermSchedule.objects.create(classroom=self.classroom, midterm=other, starts_at=OCTOBER)
        self.assertEqual(stats.available_months(), ["2026-10", "2026-09"])
        self.assertEqual(stats.classroom_months(self.classroom.id), ["2026-10", "2026-09"])


class MonthRowTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 4)
        enrol(self.classroom, *self.students)

        self.midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=SEPTEMBER
        )
        for student in self.students[:3]:
            sit(self.midterm, student, score=800, when=SEPTEMBER)
        sit(self.midterm, self.students[3], score=200, when=SEPTEMBER)

    def test_a_pre_midterm_is_not_a_row_and_does_not_dilute_the_month(self):
        """A diagnostic issues no verdict, so every one of its sittings would read as
        'pending' and halve the classroom's month."""
        pre = make_midterm("Pre 1", midterm_type=Midterm.TYPE_PRE_MIDTERM)
        MidtermSchedule.objects.create(classroom=self.classroom, midterm=pre, starts_at=SEPTEMBER)
        for student in self.students:
            sit(pre, student, score=400, when=SEPTEMBER)
        self.assertFalse(MidtermOutcome.objects.filter(midterm=pre).exists())

        rows = stats.classroom_month_rows(self.classroom, "2026-09")
        self.assertEqual([r["title"] for r in rows], ["Midterm 12"])
        summary = stats.classroom_month_summary(self.classroom, "2026-09")
        self.assertEqual(summary["roster"], 4)
        self.assertEqual(summary["pass_rate"], 75.0)

    def test_a_retake_paper_is_never_a_row_of_its_own(self):
        """Counted separately it would put the same roster in the denominator twice and
        show the retake itself at 25%, since only the failer ever sat it."""
        retake = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        MidtermSchedule.objects.create(classroom=self.classroom, midterm=retake, starts_at=SEPTEMBER)
        sit(retake, self.students[3], score=800, when=SEPTEMBER)

        rows = stats.classroom_month_rows(self.classroom, "2026-09")
        self.assertEqual([r["title"] for r in rows], ["Midterm 12"])
        self.assertEqual(rows[0]["retakes"], [{"id": retake.id, "title": "Midterm 12 Retake"}])
        self.assertEqual(rows[0]["passed_retake"], 1)
        self.assertEqual(rows[0]["pass_rate"], 100.0)
        summary = stats.classroom_month_summary(self.classroom, "2026-09")
        self.assertEqual(summary["roster"], 4)   # not 8
        self.assertEqual(summary["midterms"], 1)

    def test_two_midterms_in_one_month_pool_rather_than_average(self):
        second = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=second, starts_at=SEPTEMBER + timedelta(days=5)
        )
        for student in self.students:
            sit(second, student, score=200, when=SEPTEMBER + timedelta(days=5))

        summary = stats.classroom_month_summary(self.classroom, "2026-09")
        self.assertEqual(summary["roster"], 8)          # 4 students × 2 papers
        self.assertEqual(summary["passed"], 3)
        self.assertEqual(summary["pass_rate"], 37.5)
        self.assertEqual(summary["midterms"], 2)
        # The roster is doubled by the second paper; distinct_students says so out loud.
        self.assertEqual(summary["distinct_students"], 4)

    def test_a_month_with_no_data_is_empty_not_an_error(self):
        self.assertEqual(stats.classroom_month_rows(self.classroom, "2026-01"), [])
        summary = stats.classroom_month_summary(self.classroom, "2026-01")
        self.assertEqual(summary["roster"], 0)
        self.assertIsNone(summary["pass_rate"])
        self.assertEqual(summary["distinct_students"], 0)

    def test_a_null_month_is_handled(self):
        self.assertEqual(stats.classroom_month_rows(self.classroom, None), [])
        self.assertIsNone(stats.classroom_month_summary(self.classroom, None)["pass_rate"])


class SchoolMonthStatsTests(TestCase):
    """The roll-up: pooled everywhere, and nothing silently dropped."""

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.region = Region.objects.create(name="Tashkent")
        self.chilonzor = Branch.objects.create(region=self.region, name="Chilonzor")
        self.yunusobod = Branch.objects.create(region=self.region, name="Yunusobod")

        self.nodir = User.objects.create(username="t1", role="teacher", first_name="Nodir", last_name="T")
        self.aziza = User.objects.create(username="t2", role="teacher", first_name="Aziza", last_name="B")

        # Chilonzor / Nodir / Math — 2 students, both pass.
        self.small = make_classroom(
            "Math Senior A", self.admin, teacher=self.nodir, branch=self.chilonzor
        )
        # Chilonzor / Aziza / English — 10 students, 5 pass.
        self.large = make_classroom(
            "English Senior B", self.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=self.aziza, branch=self.chilonzor,
        )
        # No branch, no teacher — the two NULLs a real roster has.
        self.orphan = make_classroom("Math Junior C", self.admin)

        self.small_students = students("a", 2)
        self.large_students = students("b", 10)
        self.orphan_students = students("c", 4)
        enrol(self.small, *self.small_students)
        enrol(self.large, *self.large_students)
        enrol(self.orphan, *self.orphan_students)

        self.midterm = make_midterm("Midterm 12")
        for classroom in (self.small, self.large, self.orphan):
            MidtermSchedule.objects.create(
                classroom=classroom, midterm=self.midterm, starts_at=SEPTEMBER
            )
        for student in self.small_students:
            sit(self.midterm, student, score=800, when=SEPTEMBER)
        for student in self.large_students[:5]:
            sit(self.midterm, student, score=800, when=SEPTEMBER)
        for student in self.large_students[5:]:
            sit(self.midterm, student, score=200, when=SEPTEMBER)
        # Nobody in the orphan class sat it at all.

    def test_totals_are_pooled_not_a_mean_of_classroom_percentages(self):
        payload = stats.school_month_stats("2026-09")
        totals = payload["totals"]
        self.assertEqual(totals["roster"], 16)
        self.assertEqual(totals["passed"], 7)
        self.assertEqual(totals["pass_rate"], 43.8)
        # The mean of 100%, 50% and 0% would be 50.0 — a 2-student class outvoting a 10.
        self.assertNotEqual(totals["pass_rate"], 50.0)
        self.assertEqual(totals["classrooms"], 3)
        self.assertEqual(totals["distinct_students"], 16)

    def test_a_null_branch_gets_its_own_named_bucket(self):
        payload = stats.school_month_stats("2026-09")
        by_name = {row["name"]: row for row in payload["branches"]}
        self.assertEqual(set(by_name), {"Chilonzor", "Unassigned"})
        self.assertIsNone(by_name["Unassigned"]["id"])
        self.assertEqual(by_name["Unassigned"]["roster"], 4)
        # The branches still add up to the school; nothing was quietly dropped.
        self.assertEqual(
            sum(row["roster"] for row in payload["branches"]), payload["totals"]["roster"]
        )

    def test_a_branch_rate_pools_its_classrooms(self):
        chilonzor = next(r for r in stats.school_month_stats("2026-09")["branches"]
                         if r["name"] == "Chilonzor")
        self.assertEqual(chilonzor["roster"], 12)     # 2 + 10
        self.assertEqual(chilonzor["passed"], 7)
        self.assertEqual(chilonzor["pass_rate"], 58.3)
        self.assertNotEqual(chilonzor["pass_rate"], 75.0)   # mean of 100% and 50%
        self.assertEqual(chilonzor["classrooms"], 2)

    def test_a_null_teacher_gets_its_own_named_bucket(self):
        payload = stats.school_month_stats("2026-09")
        by_name = {row["name"]: row for row in payload["teachers"]}
        self.assertIn("Unassigned", by_name)
        self.assertIsNone(by_name["Unassigned"]["id"])
        self.assertEqual(by_name["Nodir T"]["pass_rate"], 100.0)
        self.assertEqual(by_name["Nodir T"]["subject"], Classroom.SUBJECT_MATH)
        self.assertEqual(by_name["Nodir T"]["branch"], "Chilonzor")

    def test_departments_are_grouped_on_the_classroom_subject(self):
        """``Midterm.subject`` is MATH here for every paper; the English department must
        still appear, because a department is the CLASSROOM's subject."""
        payload = stats.school_month_stats("2026-09")
        by_subject = {row["subject"]: row for row in payload["departments"]}
        self.assertEqual(set(by_subject), {Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH})
        self.assertEqual(by_subject[Classroom.SUBJECT_ENGLISH]["label"], "English")
        self.assertEqual(by_subject[Classroom.SUBJECT_ENGLISH]["roster"], 10)
        self.assertEqual(by_subject[Classroom.SUBJECT_ENGLISH]["pass_rate"], 50.0)
        self.assertEqual(by_subject[Classroom.SUBJECT_MATH]["roster"], 6)   # 2 + 4 orphans

    def test_rows_sort_by_rate_descending_with_none_last(self):
        payload = stats.school_month_stats("2026-09")
        rates = [row["pass_rate"] for row in payload["classrooms"]]
        self.assertEqual(rates, [100.0, 50.0, 0.0])
        # An unmeasurable classroom sorts last rather than bottom-of-the-table.
        empty = make_classroom("Nobody Yet", self.admin, branch=self.yunusobod)
        MidtermSchedule.objects.create(classroom=empty, midterm=self.midterm, starts_at=SEPTEMBER)
        rates = [row["pass_rate"] for row in stats.school_month_stats("2026-09")["classrooms"]]
        self.assertEqual(rates, [100.0, 50.0, 0.0, None])

    def test_the_payload_states_its_own_definition(self):
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(
            payload["definition"]["pass_rate"],
            "passed (first sitting or retake) / all roster students",
        )
        self.assertEqual(payload["definition"]["absent_counts_as"], "failed")
        self.assertEqual(payload["definition"]["rollup"], "pooled")

    def test_filters_narrow_every_level(self):
        payload = stats.school_month_stats("2026-09", branch_id=self.chilonzor.id)
        self.assertEqual(payload["totals"]["roster"], 12)
        self.assertEqual([r["name"] for r in payload["branches"]], ["Chilonzor"])

        payload = stats.school_month_stats("2026-09", subject=Classroom.SUBJECT_ENGLISH)
        self.assertEqual(payload["totals"]["roster"], 10)
        # READING_WRITING is the OTHER vocabulary for the same department.
        self.assertEqual(
            stats.school_month_stats("2026-09", subject="READING_WRITING")["totals"]["roster"], 10
        )

        payload = stats.school_month_stats("2026-09", teacher_id=self.nodir.id)
        self.assertEqual(payload["totals"]["roster"], 2)

    def test_a_month_with_nothing_in_it_returns_the_empty_shell(self):
        payload = stats.school_month_stats("2026-01")
        self.assertEqual(payload["month"], "2026-01")
        self.assertIsNone(payload["totals"]["pass_rate"])
        self.assertEqual(payload["branches"], [])
        self.assertEqual(payload["classrooms"], [])
        self.assertIn("definition", payload)

    def test_a_null_month_returns_the_empty_shell(self):
        payload = stats.school_month_stats(None)
        self.assertIsNone(payload["month"])
        self.assertEqual(payload["teachers"], [])

    def test_a_student_in_two_classrooms_is_pooled_twice_but_counted_once(self):
        """112 of 226 students hold two active memberships. The pooled formula counts the
        roster twice on purpose; ``distinct_students`` is what makes that visible."""
        shared = self.small_students[0]
        enrol(self.orphan, shared)
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["totals"]["roster"], 17)
        self.assertEqual(payload["totals"]["distinct_students"], 16)


class FutureMonthTests(TestCase):
    """A month the school has not reached yet is a plan, not a result.

    ``MidtermSchedule.starts_at`` is mandatory on every teacher assign path, so a midterm
    assigned for next month already carries next month. Left unbounded, the newest month is
    that one, the default lands on it, and every student on the roster reads as absent — an
    admin opening the page is told the school scored 0%.
    """

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 10)
        enrol(self.classroom, *self.students)

        self.sat = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.sat, starts_at=THIS_MONTH_AT
        )
        for student in self.students[:9]:
            sit(self.sat, student, score=800, when=THIS_MONTH_AT)
        sit(self.sat, self.students[9], score=200, when=THIS_MONTH_AT)

        self.planned = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.planned, starts_at=NEXT_MONTH_AT
        )

    def test_the_default_month_is_never_one_the_school_has_not_reached(self):
        months = stats.available_months()
        self.assertEqual(months, [NEXT_MONTH, THIS_MONTH])   # both are real, and offered
        self.assertEqual(stats.default_month(months), THIS_MONTH)
        self.assertEqual(stats.future_months(months), [NEXT_MONTH])
        self.assertTrue(stats.is_future_month(NEXT_MONTH))
        self.assertFalse(stats.is_future_month(THIS_MONTH))
        self.assertFalse(stats.is_future_month(LAST_MONTH))

    def test_a_scheduled_month_still_reads_as_scheduled_when_it_is_asked_for(self):
        """Selectable, because who is booked for what is real information — but the numbers
        under it are a roster nobody has sat, and the payload has to say so."""
        payload = stats.school_month_stats(NEXT_MONTH)
        self.assertEqual(payload["totals"]["absent"], 10)
        self.assertEqual(payload["totals"]["pass_rate"], 0.0)
        self.assertTrue(stats.is_future_month(payload["month"]))

    def test_a_school_with_only_scheduled_months_has_no_default(self):
        """Nothing has been sat anywhere, so there is no month to open on — and saying so
        beats opening on a plan and calling it 0%."""
        MidtermSchedule.objects.filter(midterm=self.sat).update(starts_at=NEXT_MONTH_AT)
        MidtermAttempt.objects.all().delete()
        months = stats.available_months()
        self.assertEqual(months, [NEXT_MONTH])
        self.assertIsNone(stats.default_month(months))

    def test_the_default_is_the_newest_month_already_reached_not_merely_this_one(self):
        MidtermSchedule.objects.filter(midterm=self.sat).update(starts_at=LAST_MONTH_AT)
        months = stats.available_months()
        self.assertEqual(months, [NEXT_MONTH, LAST_MONTH])
        self.assertEqual(stats.default_month(months), LAST_MONTH)

    def test_a_classrooms_own_months_are_bounded_the_same_way(self):
        months = stats.classroom_months(self.classroom.id)
        self.assertEqual(months, [NEXT_MONTH, THIS_MONTH])
        self.assertEqual(stats.default_month(months), THIS_MONTH)


class OrphanRetakeTests(TestCase):
    """A RETAKE with a NULL ``retake_of``: excluded from the numbers, and disclosed.

    The builder's parent picker offers "— No parent midterm —" as its initial value, the
    serializer accepts it and ``midterms.sync`` produces it, so this is an ordinary authoring
    mistake rather than an exotic one. Counted as a paper in its own right it puts the whole
    roster in the denominator for a paper only the failers were ever offered, which halves
    the month — and it pools into branch, department, teacher and school totals.
    """

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.classroom = make_classroom("Math Senior A", self.admin)
        self.students = students("s", 10)
        enrol(self.classroom, *self.students)

        self.midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.midterm, starts_at=SEPTEMBER
        )
        for student in self.students[:9]:
            sit(self.midterm, student, score=800, when=SEPTEMBER)
        sit(self.midterm, self.students[9], score=200, when=SEPTEMBER)

        # The authoring mistake: a RETAKE that names no parent.
        self.orphan = make_midterm("Midterm 12 Retake", midterm_type=Midterm.TYPE_RETAKE)
        self.assertIsNone(self.orphan.retake_of_id)
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=self.orphan, starts_at=SEPTEMBER
        )
        sit(self.orphan, self.students[9], score=800, when=SEPTEMBER)

    def test_a_retake_is_never_a_countable_unit_parent_or_no_parent(self):
        self.assertFalse(stats.is_countable_unit(self.orphan))
        parented = make_midterm("With parent", midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm)
        self.assertFalse(stats.is_countable_unit(parented))
        self.assertTrue(stats.is_countable_unit(self.midterm))
        # Type and parentage each exclude on their own: a paper typed MIDTERM that names a
        # parent is still folded into it, so counting it here too would double its passes.
        mistyped = make_midterm("Typed a midterm", retake_of=self.midterm)
        self.assertEqual(mistyped.midterm_type, Midterm.TYPE_MIDTERM)
        self.assertFalse(stats.is_countable_unit(mistyped))
        self.assertNotIn(mistyped.id, stats.countable_midterm_ids())
        # …and it is not an orphan either, so it raises no warning it does not deserve.
        self.assertFalse(stats.is_orphan_retake(mistyped))

    def test_a_paper_typed_midterm_that_names_a_parent_is_folded_not_counted_twice(self):
        mistyped = make_midterm("Second chance, mistyped", retake_of=self.midterm)
        MidtermSchedule.objects.create(
            classroom=self.classroom, midterm=mistyped, starts_at=SEPTEMBER
        )
        sit(mistyped, self.students[9], score=800, when=SEPTEMBER)

        rows, summary, orphans = stats.classroom_month(self.classroom, "2026-09")
        self.assertEqual([r["title"] for r in rows], ["Midterm 12"])
        self.assertEqual(summary["roster"], 10)          # not 20
        self.assertEqual(rows[0]["passed_retake"], 1)    # folded into its parent
        self.assertEqual(orphans, [{"id": self.orphan.id, "title": "Midterm 12 Retake"}])

    def test_it_is_not_a_row_of_its_own_and_does_not_halve_the_month(self):
        rows, summary, orphans = stats.classroom_month(self.classroom, "2026-09")
        self.assertEqual([r["title"] for r in rows], ["Midterm 12"])
        self.assertEqual(summary["roster"], 10)          # not 20
        self.assertEqual(summary["midterms"], 1)
        self.assertEqual(summary["pass_rate"], 90.0)     # not 50.0
        self.assertEqual(orphans, [{"id": self.orphan.id, "title": "Midterm 12 Retake"}])

    def test_the_school_roll_up_excludes_it_and_names_it(self):
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["totals"]["roster"], 10)
        self.assertEqual(payload["totals"]["midterms"], 1)
        self.assertEqual(payload["totals"]["pass_rate"], 90.0)
        self.assertEqual([r["pass_rate"] for r in payload["classrooms"]], [90.0])
        # Excluded is not the same as dropped: the page has to be able to say why a paper
        # somebody can see in the builder is missing from the table.
        self.assertEqual(
            payload["orphan_retakes"], [{"id": self.orphan.id, "title": "Midterm 12 Retake"}]
        )

    def test_a_month_with_nothing_but_an_orphan_still_discloses_it(self):
        MidtermSchedule.objects.filter(midterm=self.midterm).update(starts_at=OCTOBER)
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["classrooms"], [])
        self.assertIsNone(payload["totals"]["pass_rate"])
        self.assertEqual(
            payload["orphan_retakes"], [{"id": self.orphan.id, "title": "Midterm 12 Retake"}]
        )

    def test_a_properly_parented_retake_raises_no_warning(self):
        self.orphan.retake_of = self.midterm
        self.orphan.save(update_fields=["retake_of"])
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["orphan_retakes"], [])
        self.assertEqual(payload["totals"]["pass_rate"], 100.0)   # the failer was rescued
        _rows, _summary, orphans = stats.classroom_month(self.classroom, "2026-09")
        self.assertEqual(orphans, [])


class MonthKeyValidationTests(TestCase):
    """``strptime("2026-9", "%Y-%m")`` SUCCEEDS, and every month key in the index is padded.

    So an unpadded month passed validation, matched nothing, and the page said "No midterms
    in this month" for a month with a full set of results — the one thing the page's own
    error handling refuses to do for a failed request.
    """

    def test_an_unpadded_month_is_rejected(self):
        self.assertFalse(stats.is_month_key("2026-9"))
        self.assertFalse(stats.is_month_key("2026-009"))
        self.assertFalse(stats.is_month_key("26-09"))
        self.assertFalse(stats.is_month_key(" 2026-09"))
        self.assertFalse(stats.is_month_key("2026-09-01"))

    def test_a_well_formed_month_is_accepted(self):
        self.assertTrue(stats.is_month_key("2026-09"))
        self.assertTrue(stats.is_month_key("2026-01"))
        self.assertTrue(stats.is_month_key("2026-12"))

    def test_a_month_out_of_range_is_still_rejected(self):
        self.assertFalse(stats.is_month_key("2026-13"))
        self.assertFalse(stats.is_month_key("2026-00"))
        self.assertFalse(stats.is_month_key("September"))
        self.assertFalse(stats.is_month_key(None))
        self.assertFalse(stats.is_month_key(202609))

    def test_every_key_the_index_produces_passes_its_own_validator(self):
        admin = User.objects.create(username="adm", role="admin")
        classroom = make_classroom("Math Senior A", admin)
        enrol(classroom, *students("s", 2))
        midterm = make_midterm("Midterm 12")
        MidtermSchedule.objects.create(
            classroom=classroom, midterm=midterm,
            starts_at=timezone.make_aware(timezone.datetime(2026, 1, 5, 9, 0)),
        )
        months = stats.available_months()
        self.assertEqual(months, ["2026-01"])
        self.assertTrue(all(stats.is_month_key(m) for m in months))


class ScopedMonthTests(TestCase):
    """The picker has to offer the months the CURRENT scope has data for, not the school's."""

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.nodir = User.objects.create(username="t1", role="teacher", first_name="Nodir", last_name="T")
        self.aziza = User.objects.create(username="t2", role="teacher", first_name="Aziza", last_name="B")
        self.region = Region.objects.create(name="Tashkent")
        self.chilonzor = Branch.objects.create(region=self.region, name="Chilonzor")
        self.yunusobod = Branch.objects.create(region=self.region, name="Yunusobod")

        self.september_class = make_classroom(
            "Math Senior A", self.admin, teacher=self.nodir, branch=self.chilonzor
        )
        self.october_class = make_classroom(
            "English Senior B", self.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=self.aziza, branch=self.yunusobod,
        )
        enrol(self.september_class, *students("a", 2))
        enrol(self.october_class, *students("b", 2))

        september = make_midterm("Midterm 12")
        october = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.september_class, midterm=september, starts_at=SEPTEMBER
        )
        MidtermSchedule.objects.create(
            classroom=self.october_class, midterm=october, starts_at=OCTOBER
        )

    def test_the_school_sees_both_months(self):
        self.assertEqual(stats.available_months(), ["2026-10", "2026-09"])

    def test_a_branch_sees_only_its_own(self):
        self.assertEqual(stats.available_months(branch_id=self.chilonzor.id), ["2026-09"])
        self.assertEqual(stats.available_months(branch_id=self.yunusobod.id), ["2026-10"])

    def test_a_teacher_and_a_department_see_only_their_own(self):
        self.assertEqual(stats.available_months(teacher_id=self.nodir.id), ["2026-09"])
        self.assertEqual(
            stats.available_months(subject=Classroom.SUBJECT_ENGLISH), ["2026-10"]
        )
        # The other subject vocabulary names the same department.
        self.assertEqual(stats.available_months(subject="READING_WRITING"), ["2026-10"])

    def test_a_scope_with_no_classrooms_at_all_has_no_months(self):
        self.assertEqual(stats.available_months(teacher_id=999999), [])


#: The keys of a tree node that are COUNTS, and so must equal the sum of the children's.
#: Derived from the dataclass rather than listed, so a field added to ``Tally`` is covered by
#: the recursive invariant below on the day it is added instead of quietly escaping it.
RATE_KEYS = ("pass_rate", "attendance_rate", "first_try_share", "retake_share")
SUMMED_KEYS = [k for k in stats.EMPTY_TALLY.as_dict() if k not in RATE_KEYS] + [
    "classrooms",
    "midterms",
]


class HierarchyTests(TestCase):
    """The tree: region → branch → department → teacher → classroom.

    The owner's complaint was that four flat sibling tables show no relationship between the
    school's levels — *"hierarchy qiling"*. The numbers are unchanged; the shape is new, and
    the whole of its trustworthiness rests on one property: **every node is the pooled merge
    of its descendants**. A node that averaged its children's percentages, or that dropped a
    branchless classroom on the way down, would still look entirely plausible on screen.

    The fixture is deliberately lopsided — a 2-student class beside a 10-student one, a
    teacher who works in two departments and at two branches, a class with no branch and no
    teacher — because those are the shapes that make a mean of means and a silent drop show
    up as a wrong number rather than as a rounding difference.
    """

    def setUp(self):
        self.admin = User.objects.create(username="adm", role="admin")
        self.fergana = Region.objects.create(name="Fergana")
        self.tashkent = Region.objects.create(name="Tashkent")
        self.city = Branch.objects.create(region=self.fergana, name="Fergana city")
        self.margilan = Branch.objects.create(region=self.fergana, name="Margilan")
        self.chilonzor = Branch.objects.create(region=self.tashkent, name="Chilonzor")

        self.nodir = User.objects.create(
            username="t1", role="teacher", first_name="Nodir", last_name="T"
        )
        self.aziza = User.objects.create(
            username="t2", role="teacher", first_name="Aziza", last_name="B"
        )

        # Fergana city / Math / Nodir — 2 students, both pass.
        self.m1 = make_classroom("Math Senior A", self.admin, teacher=self.nodir, branch=self.city)
        # Fergana city / Math / Aziza — 10 students, 5 pass. Ten times the weight of the above.
        self.m2 = make_classroom("Math Senior B", self.admin, teacher=self.aziza, branch=self.city)
        # Fergana city / English / Nodir — the same teacher in a second department.
        self.e1 = make_classroom(
            "English Senior A", self.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=self.nodir, branch=self.city,
        )
        # Margilan / Math / nobody — a real branch, no teacher on record.
        self.m3 = make_classroom("Math Junior C", self.admin, branch=self.margilan)
        # Tashkent / Chilonzor / English / Aziza — the same teacher at a second branch.
        self.e2 = make_classroom(
            "English Junior D", self.admin, subject=Classroom.SUBJECT_ENGLISH,
            teacher=self.aziza, branch=self.chilonzor,
        )
        # No branch and no teacher — the two NULLs a real roster has.
        self.floating = make_classroom("Math Junior E", self.admin)

        self.m1_students = students("a", 2)
        self.m2_students = students("b", 10)
        self.e1_students = students("c", 4)
        self.m3_students = students("d", 5)
        self.e2_students = students("e", 6)
        self.floating_students = students("f", 3)
        enrol(self.m1, *self.m1_students)
        enrol(self.m2, *self.m2_students)
        enrol(self.e1, *self.e1_students)
        enrol(self.m3, *self.m3_students)
        enrol(self.e2, *self.e2_students)
        enrol(self.floating, *self.floating_students)

        self.midterm = make_midterm("Midterm 12")
        for classroom in (self.m1, self.m2, self.e1, self.m3, self.e2, self.floating):
            MidtermSchedule.objects.create(
                classroom=classroom, midterm=self.midterm, starts_at=SEPTEMBER
            )
        self.pass_all(self.m1_students)
        self.pass_some(self.m2_students, 5)
        self.pass_some(self.e1_students, 1)
        # Nobody in m3 sat it at all: absent counts as failed, so 0%, not "no data".
        self.pass_some(self.e2_students, 3)
        self.pass_all(self.floating_students)

    def pass_all(self, roster):
        for student in roster:
            sit(self.midterm, student, score=800, when=SEPTEMBER)

    def pass_some(self, roster, passers):
        for student in roster[:passers]:
            sit(self.midterm, student, score=800, when=SEPTEMBER)
        for student in roster[passers:]:
            sit(self.midterm, student, score=200, when=SEPTEMBER)

    # ── helpers ──────────────────────────────────────────────────────────────
    def tree(self, **filters):
        return stats.school_month_stats("2026-09", **filters)["tree"]

    def by_name(self, nodes):
        return {node["name"]: node for node in nodes}

    def find(self, nodes, *names):
        """Walk down by name: ``self.find(tree, "Fergana", "Fergana city", "Math")``."""
        node = None
        for name in names:
            node = self.by_name(nodes)[name]
            nodes = node.get("children") or []
        return node

    def assert_pooled(self, node, where=""):
        """Every counter is its children's sum, and every rate comes back out of those counters.

        The single assertion the whole tree rests on, applied at every node of every level.
        Recomputing the rate from the node's OWN counters is the half that catches an average
        of averages: 100% and 50% pooled over 2 and 10 students is 58.3%, and the mean, 75%,
        is a number a reader has no way to tell is wrong.
        """
        where = where or node["name"]
        children = node.get("children") or []
        if not children:
            self.assertEqual(node["level"], "classroom", where)
            self.assertEqual(node["classrooms"], 1, where)
            return
        for key in SUMMED_KEYS:
            self.assertEqual(
                node[key], sum(child[key] for child in children), f"{where}.{key}"
            )
        self.assertEqual(node["pass_rate"], rate(node["passed"], node["roster"]), where)
        self.assertEqual(node["attendance_rate"], rate(node["attended"], node["roster"]), where)
        self.assertEqual(node["first_try_share"], rate(node["passed_first"], node["passed"]), where)
        # A head counted once here may be counted twice below — that is the whole point of
        # carrying both numbers — so this one is bounded, never equal.
        self.assertLessEqual(
            node["distinct_students"],
            sum(child["distinct_students"] for child in children),
            where,
        )
        for child in children:
            self.assert_pooled(child, f"{where} > {child['name']}")

    # ── the invariant ────────────────────────────────────────────────────────
    def test_every_node_is_the_sum_of_its_children_at_every_level(self):
        tree = self.tree()
        self.assertEqual(len(tree), 3)          # Fergana, Tashkent, and the unassigned bucket
        for node in tree:
            self.assert_pooled(node)

    def test_the_root_of_the_tree_equals_the_totals_block_it_sits_under(self):
        """A tree that disagreed with the headline above it would be worse than no tree."""
        payload = stats.school_month_stats("2026-09")
        tree, totals = payload["tree"], payload["totals"]
        for key in SUMMED_KEYS:
            self.assertEqual(sum(node[key] for node in tree), totals[key], key)
        self.assertEqual(totals["roster"], 30)
        self.assertEqual(totals["passed"], 14)
        self.assertEqual(totals["pass_rate"], 46.7)
        self.assertEqual(totals["classrooms"], 6)
        self.assertEqual(totals["midterms"], 6)
        self.assertEqual(
            sum(node["distinct_students"] for node in tree), totals["distinct_students"]
        )

    def test_a_region_pools_its_branches_rather_than_averaging_them(self):
        fergana = self.find(self.tree(), "Fergana")
        self.assertEqual(fergana["roster"], 21)     # 2 + 10 + 4 + 5
        self.assertEqual(fergana["passed"], 8)
        self.assertEqual(fergana["pass_rate"], 38.1)
        self.assertNotEqual(fergana["pass_rate"], 25.0)   # the mean of 50.0% and 0.0%
        self.assertEqual(fergana["classrooms"], 4)

    def test_a_department_pools_a_two_student_class_with_a_ten_student_one(self):
        math = self.find(self.tree(), "Fergana", "Fergana city", "Math")
        self.assertEqual(math["roster"], 12)
        self.assertEqual(math["passed"], 7)
        self.assertEqual(math["pass_rate"], 58.3)
        self.assertNotEqual(math["pass_rate"], 75.0)      # the mean of 100.0% and 50.0%

    # ── the shape ────────────────────────────────────────────────────────────
    def test_every_node_carries_the_same_keys_whatever_its_level(self):
        """One frontend component renders all five levels, so all five answer the same keys."""
        seen = set()

        def check(node, depth):
            seen.add(node["level"])
            self.assertEqual(node["level"], stats.TREE_LEVELS[depth])
            self.assertIsInstance(node["key"], str)
            self.assertTrue(node["key"].startswith(f"{node['level']}:"))
            self.assertIsInstance(node["name"], str)
            self.assertTrue(node["name"])
            self.assertTrue(node["id"] is None or isinstance(node["id"], int))
            for key in SUMMED_KEYS + list(RATE_KEYS) + ["distinct_students"]:
                self.assertIn(key, node, f"{node['name']}.{key}")
            for child in node.get("children") or []:
                check(child, depth + 1)

        for node in self.tree():
            check(node, 0)
        self.assertEqual(seen, set(stats.TREE_LEVELS))

    def test_a_classroom_leaf_has_no_children_key_at_all(self):
        """Empty rather than absent would render as a node that expands onto nothing."""
        leaf = self.find(self.tree(), "Fergana", "Fergana city", "Math", "Nodir T", "Math Senior A")
        self.assertEqual(leaf["level"], "classroom")
        self.assertNotIn("children", leaf)
        self.assertEqual(leaf["id"], self.m1.id)
        self.assertEqual(leaf["classrooms"], 1)
        self.assertEqual(leaf["midterms"], 1)
        self.assertEqual(leaf["pass_rate"], 100.0)
        # The two labels the flat classroom row carries, so a page rendering only the tree
        # can still tell a Senior class from a Junior one — and neither is a raw enum.
        self.assertEqual(leaf["subject_label"], "Math")
        self.assertEqual(leaf["level_label"], "Senior")

    def test_a_key_is_stable_and_identifies_the_row_it_came_from(self):
        tree = self.tree()
        fergana = self.find(tree, "Fergana")
        self.assertEqual(fergana["key"], f"region:{self.fergana.id}")
        self.assertEqual(
            self.find(tree, "Fergana", "Fergana city")["key"], f"branch:{self.city.id}"
        )
        english = self.find(tree, "Fergana", "Fergana city", "English")
        self.assertEqual(english["key"], "department:ENGLISH")
        self.assertEqual(
            self.find(tree, "Fergana", "Fergana city", "English", "Nodir T")["key"],
            f"teacher:{self.nodir.id}",
        )
        # Stable: a second call produces the same keys, so an expanded branch stays expanded.
        self.assertEqual(
            [node["key"] for node in self.tree()], [node["key"] for node in tree]
        )

    def test_a_department_is_a_subject_so_it_has_no_id_and_never_shows_its_enum(self):
        english = self.find(self.tree(), "Fergana", "Fergana city", "English")
        self.assertIsNone(english["id"])
        self.assertEqual(english["name"], "English")          # not "ENGLISH"
        self.assertEqual(english["subject"], Classroom.SUBJECT_ENGLISH)   # for a deep link
        self.assertEqual(english["roster"], 4)

    def test_a_teacher_appears_under_each_department_they_teach_in(self):
        """The flat table merges Nodir's two subjects into one row; the tree must not, or a
        department's children would not add up to the department."""
        tree = self.tree()
        maths = self.find(tree, "Fergana", "Fergana city", "Math", "Nodir T")
        english = self.find(tree, "Fergana", "Fergana city", "English", "Nodir T")
        self.assertEqual(maths["id"], english["id"], "the same teacher")
        self.assertEqual(maths["roster"], 2)
        self.assertEqual(english["roster"], 4)
        flat = next(r for r in stats.school_month_stats("2026-09")["teachers"]
                    if r["name"] == "Nodir T")
        self.assertEqual(flat["roster"], 6)      # the same teacher, pooled across departments

    def test_a_teacher_at_two_branches_appears_under_each_of_them(self):
        tree = self.tree()
        city = self.find(tree, "Fergana", "Fergana city", "Math", "Aziza B")
        chilonzor = self.find(tree, "Tashkent", "Chilonzor", "English", "Aziza B")
        self.assertEqual(city["roster"], 10)
        self.assertEqual(chilonzor["roster"], 6)

    # ── the unassigned disclosure ────────────────────────────────────────────
    def test_a_branchless_classroom_lands_under_an_unassigned_region_and_branch(self):
        """Never dropped, and never attached to a real region: a class with no branch has no
        region either, and putting it inside one would be inventing a fact about it."""
        tree = self.tree()
        unassigned = self.by_name(tree)[stats.UNASSIGNED]
        self.assertEqual(unassigned["level"], "region")
        self.assertIsNone(unassigned["id"])
        self.assertEqual(unassigned["key"], "region:unassigned")
        branch = self.find(tree, stats.UNASSIGNED, stats.UNASSIGNED)
        self.assertEqual(branch["level"], "branch")
        self.assertIsNone(branch["id"])
        leaf = self.find(tree, stats.UNASSIGNED, stats.UNASSIGNED, "Math", stats.UNASSIGNED)
        self.assertEqual(leaf["level"], "teacher")
        self.assertIsNone(leaf["id"])
        self.assertEqual(leaf["roster"], 3)
        # Nothing was quietly dropped on the way: the tree still totals the school.
        self.assertEqual(
            sum(node["roster"] for node in tree),
            stats.school_month_stats("2026-09")["totals"]["roster"],
        )

    def test_a_teacherless_classroom_inside_a_real_branch_keeps_its_branch(self):
        """The teacher is what is unknown, not the location — Margilan is still Margilan."""
        node = self.find(self.tree(), "Fergana", "Margilan", "Math", stats.UNASSIGNED)
        self.assertIsNone(node["id"])
        self.assertEqual(node["key"], "teacher:unassigned")
        self.assertEqual(node["roster"], 5)
        self.assertEqual(node["absent"], 5)
        self.assertEqual(node["pass_rate"], 0.0)   # measured, and genuinely zero

    def test_unassigned_sorts_last_however_well_it_scored(self):
        """It is a disclosure, not a ranking. At 100% it would otherwise head the school."""
        tree = self.tree()
        self.assertEqual([node["name"] for node in tree], ["Tashkent", "Fergana", stats.UNASSIGNED])
        self.assertEqual(self.by_name(tree)[stats.UNASSIGNED]["pass_rate"], 100.0)

    # ── sorting ──────────────────────────────────────────────────────────────
    def test_children_sort_by_rate_descending_with_nulls_last(self):
        branches = self.find(self.tree(), "Fergana")["children"]
        self.assertEqual([b["name"] for b in branches], ["Fergana city", "Margilan"])
        self.assertEqual([b["pass_rate"] for b in branches], [50.0, 0.0])

        # A class with nobody on its roster has not come bottom of the school, it has not
        # been measured — so it sorts below the branch that genuinely scored zero.
        empty = make_classroom("Nobody Yet", self.admin, branch=self.margilan)
        MidtermSchedule.objects.create(
            classroom=empty, midterm=self.midterm, starts_at=SEPTEMBER
        )
        branches = self.find(self.tree(), "Fergana")["children"]
        self.assertEqual([b["pass_rate"] for b in branches], [50.0, 0.0])
        rooms = self.find(self.tree(), "Fergana", "Margilan", "Math", stats.UNASSIGNED)["children"]
        self.assertEqual([r["pass_rate"] for r in rooms], [0.0, None])
        self.assertEqual([r["name"] for r in rooms], ["Math Junior C", "Nobody Yet"])

    def test_a_tie_is_broken_by_name(self):
        """Two classes on the same rate must not swap places between two page loads."""
        for prefix, name in (("zz", "Zulu Senior"), ("aa", "Aardvark Senior")):
            tied = make_classroom(name, self.admin, teacher=self.nodir, branch=self.city)
            enrol(tied, *students(prefix, 2))
            MidtermSchedule.objects.create(
                classroom=tied, midterm=self.midterm, starts_at=SEPTEMBER
            )
        # Neither sits the paper, so both are 0% and only the name can decide.
        rooms = self.find(self.tree(), "Fergana", "Fergana city", "Math", "Nodir T")["children"]
        self.assertEqual(
            [r["name"] for r in rooms], ["Math Senior A", "Aardvark Senior", "Zulu Senior"]
        )
        self.assertEqual([r["pass_rate"] for r in rooms], [100.0, 0.0, 0.0])

    # ── distinct students ────────────────────────────────────────────────────
    def test_distinct_students_is_a_deduped_head_count_not_a_sum(self):
        """112 of 226 students hold two active memberships. ``roster`` counts the head twice
        because the pooled formula is defined on rosters; ``distinct_students`` says so."""
        shared = self.m1_students[0]
        enrol(self.m2, shared)          # one student, two classrooms, one department
        tree = self.tree()
        maths = self.find(tree, "Fergana", "Fergana city", "Math")
        self.assertEqual(maths["roster"], 13)             # 2 + 11, the head counted twice
        self.assertEqual(maths["distinct_students"], 12)  # …and once here
        # The gap is exactly what a sum of the children would have hidden.
        self.assertEqual(
            sum(child["distinct_students"] for child in maths["children"]), 13
        )
        city = self.find(tree, "Fergana", "Fergana city")
        self.assertEqual(city["roster"], 17)
        self.assertEqual(city["distinct_students"], 16)
        for node in tree:
            self.assert_pooled(node)

    def test_two_papers_in_one_month_double_the_roster_of_the_class_that_sat_them(self):
        """``roster`` is per (classroom, midterm) pair everywhere, leaf included."""
        second = make_midterm("Midterm 13")
        MidtermSchedule.objects.create(
            classroom=self.m1, midterm=second, starts_at=SEPTEMBER + timedelta(days=5)
        )
        for student in self.m1_students:
            sit(second, student, score=200, when=SEPTEMBER + timedelta(days=5))
        leaf = self.find(
            self.tree(), "Fergana", "Fergana city", "Math", "Nodir T", "Math Senior A"
        )
        self.assertEqual(leaf["midterms"], 2)
        self.assertEqual(leaf["classrooms"], 1)
        self.assertEqual(leaf["roster"], 4)               # 2 students × 2 papers
        self.assertEqual(leaf["distinct_students"], 2)
        self.assertEqual(leaf["pass_rate"], 50.0)
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["totals"]["midterms"], 7)
        for node in payload["tree"]:
            self.assert_pooled(node)

    # ── the collapsing rule ──────────────────────────────────────────────────
    def test_a_school_that_branches_at_the_top_skips_nothing(self):
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(payload["tree_open_path"], [])

    def test_a_single_region_and_a_single_branch_are_skipped_down_to_departments(self):
        """Production's shape today: one region, one branch, both departments under it. Two
        clicks that each reveal a list of one is the complexity being complained about."""
        payload = stats.school_month_stats("2026-09", branch_id=self.city.id)
        self.assertEqual(
            payload["tree_open_path"], [f"region:{self.fergana.id}", f"branch:{self.city.id}"]
        )
        # The skipped levels are still IN the tree, so the breadcrumb can name them and so
        # the page starts opening on branches by itself the day a second branch is created.
        self.assertEqual([node["name"] for node in payload["tree"]], ["Fergana"])
        opened = self.find(payload["tree"], "Fergana", "Fergana city")["children"]
        self.assertEqual({node["name"] for node in opened}, {"Math", "English"})

    def test_the_path_is_derived_so_a_second_branch_shortens_it_on_its_own(self):
        """Never hard-coded to "skip region and branch": the day a second branch is created
        the page starts opening on branches with nobody having to remember to change it."""
        scoped = stats.school_month_stats("2026-09", branch_id=self.city.id)
        self.assertEqual(
            scoped["tree_open_path"], [f"region:{self.fergana.id}", f"branch:{self.city.id}"]
        )
        # File the branchless class under Margilan. Maths is now taught at two branches of a
        # single region, so the branch level has a choice in it and stops being skipped.
        Classroom.objects.filter(pk=self.floating.pk).update(branch=self.margilan)
        payload = stats.school_month_stats("2026-09", subject=Classroom.SUBJECT_MATH)
        self.assertEqual(payload["tree_open_path"], [f"region:{self.fergana.id}"])
        self.assertEqual(
            [node["name"] for node in self.find(payload["tree"], "Fergana")["children"]],
            ["Fergana city", "Margilan"],
        )

    def test_a_single_chain_stops_at_the_last_level_that_has_children(self):
        """One classroom all the way down: the page opens on it, never on nothing."""
        payload = stats.school_month_stats(
            "2026-09", teacher_id=self.nodir.id, subject=Classroom.SUBJECT_ENGLISH
        )
        self.assertEqual(
            payload["tree_open_path"],
            [
                f"region:{self.fergana.id}",
                f"branch:{self.city.id}",
                "department:ENGLISH",
                f"teacher:{self.nodir.id}",
            ],
        )
        leaf = self.find(
            payload["tree"], "Fergana", "Fergana city", "English", "Nodir T", "English Senior A"
        )
        self.assertEqual(leaf["level"], "classroom")
        self.assertNotIn("children", leaf)

    def test_an_empty_month_is_an_empty_tree_and_an_empty_path(self):
        payload = stats.school_month_stats("2026-01")
        self.assertEqual(payload["tree"], [])
        self.assertEqual(payload["tree_open_path"], [])
        payload = stats.school_month_stats(None)
        self.assertEqual(payload["tree"], [])
        self.assertEqual(payload["tree_open_path"], [])

    def test_the_open_path_of_an_empty_tree_is_empty(self):
        self.assertEqual(stats.tree_open_path([]), [])

    # ── the flat tables are untouched ────────────────────────────────────────
    def test_the_flat_lists_are_unchanged_beside_the_tree(self):
        """The tree is additive. The four tables are what a reader compares two teachers
        across the whole school with, which a tree cannot do."""
        payload = stats.school_month_stats("2026-09")
        self.assertEqual(
            {row["name"] for row in payload["branches"]},
            {"Fergana city", "Margilan", "Chilonzor", stats.UNASSIGNED},
        )
        self.assertEqual(
            {row["subject"] for row in payload["departments"]},
            {Classroom.SUBJECT_MATH, Classroom.SUBJECT_ENGLISH},
        )
        self.assertEqual(
            {row["name"] for row in payload["teachers"]},
            {"Nodir T", "Aziza B", stats.UNASSIGNED},
        )
        self.assertEqual(len(payload["classrooms"]), 6)
        # And a branch row still equals its node in the tree.
        flat = next(r for r in payload["branches"] if r["name"] == "Fergana city")
        node = self.find(payload["tree"], "Fergana", "Fergana city")
        for key in SUMMED_KEYS:
            if key == "midterms":       # the flat branch row has never carried one
                continue
            self.assertEqual(flat[key], node[key], key)
        self.assertEqual(flat["pass_rate"], node["pass_rate"])
        self.assertEqual(flat["distinct_students"], node["distinct_students"])

    def test_the_tree_costs_no_query_of_its_own(self):
        """A node is not worth a round trip. Every tally it needs is already in hand, and a
        tree that had gone back to the database would have been free to disagree with the
        table beside it."""
        with CaptureQueriesContext(connection) as before:
            stats.school_month_stats("2026-09")
        # The same six classrooms and the same six papers, spread over MORE NODES: a second
        # region, a second branch and a department that did not exist a moment ago. A query
        # per node would show up here as a longer list.
        andijan = Region.objects.create(name="Andijan")
        Classroom.objects.filter(pk=self.m2.pk).update(
            branch=Branch.objects.create(region=andijan, name="Andijan city")
        )
        with CaptureQueriesContext(connection) as after:
            payload = stats.school_month_stats("2026-09")
        self.assertEqual(len(after), len(before))
        self.assertEqual([node["name"] for node in payload["tree"]],
                         ["Andijan", "Tashkent", "Fergana", stats.UNASSIGNED])

    def test_the_payload_states_the_hierarchy_it_is_reporting(self):
        definition = stats.school_month_stats("2026-09")["definition"]
        self.assertIn("region", definition["hierarchy"])
        self.assertIn("classroom", definition["hierarchy"])
        self.assertEqual(definition["rollup"], "pooled")


def rate(numerator, denominator):
    """The test's own copy of the rule, so a bug in ``_rate`` cannot agree with itself."""
    if not denominator:
        return None
    return round(100.0 * numerator / denominator, 1)
