from __future__ import annotations

from datetime import date, datetime, time
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as acc_const
from assessments.models import (
    AssessmentAnswer,
    AssessmentAttempt,
    AssessmentQuestion,
    AssessmentSet,
    HomeworkAssignment,
)
from classes.models import Assignment, Classroom, ClassroomMembership
from question_reports.models import QuestionErrorReport
from questionbank.models import BankQuestion
from rewards import constants as reward_const
from rewards.models import PointAward
from users.models import User

from . import daily
from .models import DailyQuestionAssignment, DailyQuestionPool
from .pools import POOL_SIZE, build_pools, pool_for, rank_questions

TASHKENT = ZoneInfo("Asia/Tashkent")
OCTOBER = (date(2026, 10, 1), date(2026, 11, 1))
NOVEMBER = date(2026, 11, 1)


def at(day: date, hour: int = 12, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=TASHKENT)


_users = 0


def make_user(role=acc_const.ROLE_STUDENT, **extra) -> User:
    global _users
    _users += 1
    return User.objects.create_user(
        f"u{_users}@example.com", password="x", username=f"u{_users}", role=role, **extra
    )


class World:
    """A teacher, and whatever classes, sets and attempts a test asks for."""

    def __init__(self):
        self.teacher = make_user(acc_const.ROLE_TEACHER, subject="math")
        self._order = 0

    def classroom(self, subject=Classroom.SUBJECT_MATH, level=Classroom.LEVEL_JUNIOR, **kw):
        return Classroom.objects.create(
            name=f"{subject} {level}", subject=subject, level=level,
            lesson_days=Classroom.DAYS_ODD, created_by=self.teacher, teacher=self.teacher, **kw,
        )

    def enroll(self, student, classroom, *, status=ClassroomMembership.STATUS_ACTIVE):
        return ClassroomMembership.objects.create(
            classroom=classroom, user=student, role=ClassroomMembership.ROLE_STUDENT, status=status
        )

    def aset(self, subject=AssessmentSet.SUBJECT_MATH, level="junior", **kw):
        return AssessmentSet.objects.create(
            subject=subject, level=level, title="Set", created_by=self.teacher, **kw
        )

    def question(self, aset, **kw):
        self._order += 1
        return AssessmentQuestion.objects.create(
            assessment_set=aset, order=self._order, prompt=f"Q{self._order}",
            question_type=kw.pop("question_type", AssessmentQuestion.TYPE_MULTIPLE_CHOICE),
            choices=kw.pop("choices", [{"id": "A", "text": "a"}, {"id": "B", "text": "b"}]),
            correct_answer=kw.pop("correct_answer", "A"),
            explanation=kw.pop("explanation", "Because A."), **kw,
        )

    def homework(self, classroom, aset):
        assignment = Assignment.objects.create(
            classroom=classroom, created_by=self.teacher, title="HW", instructions=""
        )
        return HomeworkAssignment.objects.create(
            classroom=classroom, assessment_set=aset, assignment=assignment, assigned_by=self.teacher
        )

    def sit(self, homework, verdicts, *, when=None, student=None, status=AssessmentAttempt.STATUS_GRADED):
        """One attempt. ``verdicts`` is ``{question: True | False | (answer, is_correct)}``."""
        when = when or at(date(2026, 10, 15))
        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=student or make_user(), status=status,
            started_at=when, submitted_at=when,
        )
        for question, verdict in verdicts.items():
            answer, ok = verdict if isinstance(verdict, tuple) else ("A" if verdict else "B", verdict)
            AssessmentAnswer.objects.create(attempt=attempt, question=question, answer=answer, is_correct=ok)
        return attempt

    def sit_many(self, homework, question, *, right, wrong, when=None):
        for _ in range(right):
            self.sit(homework, {question: True}, when=when)
        for _ in range(wrong):
            self.sit(homework, {question: False}, when=when)


def ranked_ids(cohort=("math", "junior")):
    return [r.question_id for r in rank_questions(*OCTOBER).get(cohort, [])]


class RankingTests(TestCase):
    def setUp(self):
        self.w = World()
        self.cls = self.w.classroom()
        self.aset = self.w.aset()
        self.hw = self.w.homework(self.cls, self.aset)

    def test_lowest_share_right_first_and_ties_go_to_more_answers(self):
        easy, hard, hard_wide = (self.w.question(self.aset) for _ in range(3))
        self.w.sit_many(self.hw, easy, right=5, wrong=0)
        self.w.sit_many(self.hw, hard, right=1, wrong=4)        # 20% of 5
        self.w.sit_many(self.hw, hard_wide, right=2, wrong=8)   # 20% of 10
        self.assertEqual(ranked_ids(), [hard_wide.id, hard.id, easy.id])

    def test_a_question_needs_five_answers(self):
        four, five = self.w.question(self.aset), self.w.question(self.aset)
        self.w.sit_many(self.hw, four, right=0, wrong=4)
        self.w.sit_many(self.hw, five, right=0, wrong=5)
        self.assertEqual(ranked_ids(), [five.id])

    def test_blank_answers_are_not_counted(self):
        q = self.w.question(self.aset)
        self.w.sit_many(self.hw, q, right=1, wrong=3)
        for blank in (None, "", "  ", []):
            self.w.sit(self.hw, {q: (blank, False)})
        self.assertEqual(ranked_ids(), [])  # 4 real answers: under the bar

    def test_only_the_previous_month_counts_in_tashkent_time(self):
        q = self.w.question(self.aset)
        self.w.sit_many(self.hw, q, right=0, wrong=5, when=at(date(2026, 10, 1), 0, 10))
        # 30 Sep 23:30 Tashkent is 18:30 UTC — September, whatever UTC says.
        self.w.sit_many(self.hw, q, right=5, wrong=0, when=at(date(2026, 9, 30), 23, 30))
        self.w.sit_many(self.hw, q, right=5, wrong=0, when=at(date(2026, 11, 1), 0, 10))
        [only] = rank_questions(*OCTOBER)[("math", "junior")]
        self.assertEqual((only.answers, only.correct), (5, 0))

    def test_ungraded_and_abandoned_attempts_do_not_count(self):
        q = self.w.question(self.aset)
        self.w.sit_many(self.hw, q, right=0, wrong=5)
        for status in (AssessmentAttempt.STATUS_ABANDONED, AssessmentAttempt.STATUS_SUBMITTED):
            for _ in range(5):
                self.w.sit(self.hw, {q: True}, status=status)
        [only] = rank_questions(*OCTOBER)[("math", "junior")]
        self.assertEqual(only.answers, 5)

    def test_only_a_students_first_attempt_counts(self):
        q = self.w.question(self.aset)
        students = [make_user() for _ in range(5)]
        for s in students:
            self.w.sit(self.hw, {q: False}, student=s, when=at(date(2026, 10, 5)))
            self.w.sit(self.hw, {q: True}, student=s, when=at(date(2026, 10, 6)))
        [only] = rank_questions(*OCTOBER)[("math", "junior")]
        self.assertEqual((only.answers, only.correct), (5, 0))

    def test_a_retake_of_last_months_first_attempt_does_not_count(self):
        q = self.w.question(self.aset)
        for _ in range(5):
            s = make_user()
            self.w.sit(self.hw, {q: True}, student=s, when=at(date(2026, 9, 20)))
            self.w.sit(self.hw, {q: False}, student=s, when=at(date(2026, 10, 2)))
        self.assertEqual(ranked_ids(), [])

    def test_the_level_is_the_class_that_sat_it_not_the_set(self):
        aset = self.w.aset(level="junior", secondary_level="middle")
        q = self.w.question(aset)
        middle = self.w.homework(self.w.classroom(level=Classroom.LEVEL_MIDDLE), aset)
        self.w.sit_many(middle, q, right=0, wrong=5)
        self.assertEqual(ranked_ids(("math", "middle")), [q.id])
        self.assertEqual(ranked_ids(("math", "junior")), [])

    def test_a_class_with_no_level_measures_no_cohort(self):
        q = self.w.question(self.aset)
        self.w.sit_many(self.w.homework(self.w.classroom(level=""), self.aset), q, right=0, wrong=5)
        self.assertEqual(rank_questions(*OCTOBER), {})

    def test_open_error_reports_and_switched_off_questions_are_left_out(self):
        reported, fixed, off = (self.w.question(self.aset) for _ in range(3))
        dead_set = self.w.aset(is_active=False)
        in_dead_set = self.w.question(dead_set)
        for q in (reported, fixed, off):
            self.w.sit_many(self.hw, q, right=0, wrong=5)
        self.w.sit_many(self.w.homework(self.cls, dead_set), in_dead_set, right=0, wrong=5)
        reporter = make_user()
        for q, st in ((reported, QuestionErrorReport.STATUS_REVIEWING), (fixed, QuestionErrorReport.STATUS_FIXED)):
            QuestionErrorReport.objects.create(
                system=QuestionErrorReport.SYSTEM_ASSESSMENT, question_id=q.id, reporter=reporter,
                category=QuestionErrorReport.CATEGORY_ANSWER_KEY, status=st,
            )
        AssessmentQuestion.objects.filter(pk=off.pk).update(is_active=False)
        self.assertEqual(ranked_ids(), [fixed.id])

    def test_one_bank_question_in_two_sets_is_one_entry(self):
        bank = BankQuestion.objects.create(
            qb_id="QB-MATH-000001", subject="MATH", question_type="MULTIPLE_CHOICE",
            question_text="shared", difficulty="HARD",
        )
        other_set = self.w.aset()
        a = self.w.question(self.aset, bank_question=bank)
        b = self.w.question(other_set, bank_question=bank)
        self.w.sit_many(self.hw, a, right=0, wrong=2)
        self.w.sit_many(self.w.homework(self.cls, other_set), b, right=1, wrong=2)
        [only] = rank_questions(*OCTOBER)[("math", "junior")]
        self.assertEqual((only.question_id, only.answers, only.correct), (b.id, 5, 1))

    def test_the_list_stops_at_thirty(self):
        questions = [self.w.question(self.aset) for _ in range(POOL_SIZE + 2)]
        students = [make_user() for _ in range(5)]
        for s in students:
            self.w.sit(self.hw, {q: False for q in questions}, student=s)
        self.assertEqual(len(ranked_ids()), POOL_SIZE)


class BuildPoolsTests(TestCase):
    def setUp(self):
        self.w = World()
        cls = self.w.classroom()
        aset = self.w.aset()
        self.q = self.w.question(aset)
        self.hw = self.w.homework(cls, aset)
        self.w.sit_many(self.hw, self.q, right=1, wrong=4)

    def test_every_cohort_gets_a_pool_even_an_empty_one(self):
        pools = build_pools(NOVEMBER)
        self.assertEqual(len(pools), 7)
        pool = DailyQuestionPool.objects.get(month=NOVEMBER, subject="math", level="junior")
        self.assertEqual((pool.stats_from, pool.stats_until), OCTOBER)
        item = pool.items.get()
        self.assertEqual((item.rank, item.question_id, item.correct_percent), (1, self.q.id, 20))
        self.assertFalse(DailyQuestionPool.objects.get(subject="english", level="senior").items.exists())

    def test_building_twice_keeps_the_first_list(self):
        build_pools(NOVEMBER)
        self.w.sit_many(self.hw, self.w.question(self.hw.assessment_set), right=0, wrong=5)
        build_pools(NOVEMBER)
        self.assertEqual(DailyQuestionPool.objects.count(), 7)
        self.assertEqual(pool_for(NOVEMBER, "math", "junior").items.count(), 1)

    def test_a_rebuild_replaces_the_list_and_keeps_the_pool(self):
        before = pool_for(NOVEMBER, "math", "junior")
        newer = self.w.question(self.hw.assessment_set)
        self.w.sit_many(self.hw, newer, right=0, wrong=5)
        build_pools(NOVEMBER, rebuild=True)
        after = pool_for(NOVEMBER, "math", "junior")
        self.assertEqual(after.pk, before.pk)
        self.assertIsNotNone(after.rebuilt_at)
        self.assertEqual(list(after.items.values_list("question_id", flat=True)), [newer.id, self.q.id])

    def test_pool_for_builds_the_month_when_nobody_has(self):
        self.assertFalse(DailyQuestionPool.objects.exists())
        self.assertEqual(pool_for(date(2026, 11, 17), "math", "junior").items.count(), 1)
        self.assertEqual(DailyQuestionPool.objects.count(), 7)


def pool_of(month, subject, level, questions):
    pool = DailyQuestionPool.objects.create(
        month=month, subject=subject, level=level, stats_from=OCTOBER[0], stats_until=OCTOBER[1]
    )
    for rank, q in enumerate(questions, start=1):
        pool.items.create(question=q, rank=rank, answers_count=10, correct_count=1)
    return pool


@override_settings(DAILY_QUESTIONS_ENABLED=True)
class DealTests(TestCase):
    def setUp(self):
        self.w = World()
        self.english = self.w.classroom(Classroom.SUBJECT_ENGLISH, Classroom.LEVEL_JUNIOR)
        self.math = self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_SENIOR)
        en_set = self.w.aset(AssessmentSet.SUBJECT_ENGLISH, "junior")
        math_set = self.w.aset(AssessmentSet.SUBJECT_MATH, "senior")
        self.en_qs = [self.w.question(en_set) for _ in range(3)]
        self.math_qs = [self.w.question(math_set) for _ in range(3)]
        for subject, level in [("english", "middle"), ("english", "senior"),
                               ("math", "foundation"), ("math", "junior"), ("math", "middle")]:
            pool_of(NOVEMBER, subject, level, [])
        pool_of(NOVEMBER, "english", "junior", self.en_qs)
        pool_of(NOVEMBER, "math", "senior", self.math_qs)
        self.student = make_user()
        self.clock(date(2026, 11, 2))

    def clock(self, day, hour=12):
        patcher = mock.patch("django.utils.timezone.now", return_value=at(day, hour))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_each_subject_at_its_own_level(self):
        self.w.enroll(self.student, self.english)
        self.w.enroll(self.student, self.math)
        dealt = daily.todays_questions(self.student)
        self.assertEqual([(a.subject, a.level) for a in dealt], [("english", "junior"), ("math", "senior")])
        self.assertIn(dealt[0].question, self.en_qs)
        self.assertIn(dealt[1].question, self.math_qs)
        self.assertEqual(dealt[1].classroom, self.math)

    def test_one_subject_one_question(self):
        self.w.enroll(self.student, self.math)
        self.assertEqual([a.subject for a in daily.todays_questions(self.student)], ["math"])

    def test_nobody_but_a_centre_student_who_is_not_frozen(self):
        public = make_user(acc_const.ROLE_PUBLIC_STUDENT)
        frozen = make_user(is_frozen=True)
        teacher = make_user(acc_const.ROLE_TEACHER, subject="math")
        for user in (public, frozen, teacher):
            self.w.enroll(user, self.math)
            self.assertEqual(daily.todays_questions(user), [], user.role)
        self.assertFalse(DailyQuestionAssignment.objects.exists())

    @override_settings(FREEZE_ACCESS_EXEMPT_EMAILS=("exempt@example.com",))
    def test_the_freeze_exempt_test_account_still_gets_one(self):
        exempt = User.objects.create_user(
            "exempt@example.com", password="x", username="exempt", role=acc_const.ROLE_STUDENT, is_frozen=True
        )
        self.w.enroll(exempt, self.math)
        self.assertEqual(len(daily.todays_questions(exempt)), 1)

    @override_settings(DAILY_QUESTIONS_ENABLED=False)
    def test_nothing_while_the_flag_is_off(self):
        self.w.enroll(self.student, self.math)
        self.assertEqual(daily.todays_questions(self.student), [])

    def test_removed_invited_and_closed_classes_deal_nothing(self):
        self.w.enroll(self.student, self.math, status=ClassroomMembership.STATUS_REMOVED)
        self.w.enroll(self.student, self.english, status=ClassroomMembership.STATUS_INVITED)
        closed = self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_SENIOR, is_active=False)
        self.w.enroll(self.student, closed)
        self.assertEqual(daily.todays_questions(self.student), [])

    def test_two_classes_in_one_subject_the_newest_wins(self):
        self.w.enroll(self.student, self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_JUNIOR))
        self.w.enroll(self.student, self.math)
        [dealt] = daily.todays_questions(self.student)
        self.assertEqual(dealt.level, "senior")

    def test_a_reload_shows_the_same_question(self):
        self.w.enroll(self.student, self.math)
        first = daily.todays_questions(self.student)[0]
        self.assertEqual(daily.todays_questions(self.student)[0].pk, first.pk)
        self.assertEqual(DailyQuestionAssignment.objects.count(), 1)

    def test_no_repeat_in_the_month_then_round_again(self):
        self.w.enroll(self.student, self.math)
        seen = []
        for day in range(2, 8):
            self.clock(date(2026, 11, day))
            seen.append(daily.todays_questions(self.student)[0].question_id)
        ids = [q.id for q in self.math_qs]
        self.assertCountEqual(seen[:3], ids)
        self.assertCountEqual(seen[3:], ids)

    def test_a_new_month_starts_a_new_deal(self):
        self.w.enroll(self.student, self.math)
        for day in (28, 29, 30):
            self.clock(date(2026, 11, day))
            daily.todays_questions(self.student)
        pool_of(date(2026, 12, 1), "math", "senior", self.math_qs[:1])
        self.clock(date(2026, 12, 1))
        [dealt] = daily.todays_questions(self.student)
        self.assertEqual((dealt.question_id, dealt.pool.month), (self.math_qs[0].id, date(2026, 12, 1)))

    def test_a_class_change_waits_for_tomorrow(self):
        membership = self.w.enroll(self.student, self.math)
        [today] = daily.todays_questions(self.student)
        membership.status = ClassroomMembership.STATUS_REMOVED
        membership.save()
        junior = self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_JUNIOR)
        self.w.enroll(self.student, junior)
        self.assertEqual(daily.todays_questions(self.student)[0].pk, today.pk)

    def test_an_empty_list_deals_nothing_in_that_subject(self):
        self.w.enroll(self.student, self.english)
        self.w.enroll(self.student, self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_JUNIOR))
        self.assertEqual([a.subject for a in daily.todays_questions(self.student)], ["english"])


@override_settings(DAILY_QUESTIONS_ENABLED=True)
class ApiTests(TestCase):
    def setUp(self):
        self.w = World()
        self.math = self.w.classroom(Classroom.SUBJECT_MATH, Classroom.LEVEL_SENIOR)
        aset = self.w.aset(AssessmentSet.SUBJECT_MATH, "senior")
        self.question = self.w.question(aset, correct_answer="A", explanation="Because A.")
        for subject, level in [("english", "junior"), ("english", "middle"), ("english", "senior"),
                               ("math", "foundation"), ("math", "junior"), ("math", "middle")]:
            pool_of(NOVEMBER, subject, level, [])
        pool_of(NOVEMBER, "math", "senior", [self.question])
        self.student = make_user()
        self.w.enroll(self.student, self.math)
        patcher = mock.patch("django.utils.timezone.now", return_value=at(date(2026, 11, 2)))
        patcher.start()
        self.addCleanup(patcher.stop)
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def today(self):
        response = self.client.get("/api/daily-questions/today/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def answer(self, assignment_id, value):
        return self.client.post(f"/api/daily-questions/{assignment_id}/answer/", {"answer": value}, format="json")

    def test_the_key_and_the_solution_stay_home_until_answered(self):
        body = self.today()
        self.assertEqual(body["date"], "2026-11-02")
        self.assertEqual(body["reward"], {"points": 2, "xp": 2})
        [card] = body["questions"]
        self.assertEqual((card["status"], card["result"]), ("open", None))
        self.assertNotIn("correct_answer", card["question"])
        self.assertNotIn("explanation", card["question"])
        self.assertNotIn("Because A.", str(body))

    def test_right_first_time_pays_two_points_and_two_xp(self):
        card = self.today()["questions"][0]
        response = self.answer(card["id"], "A")
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()["result"]
        self.assertEqual(result["is_correct"], True)
        self.assertEqual(result["correct_answer"], "A")
        self.assertEqual(result["explanation"], "Because A.")
        self.assertEqual(result["earned"], {"points": 2, "xp": 2})
        award = PointAward.objects.get(idempotency_key=reward_const.daily_question_key(card["id"]))
        self.assertEqual((award.event, award.points, award.xp, award.classroom), (
            reward_const.EVENT_DAILY_QUESTION, 2, 2, self.math))
        self.assertEqual(self.today()["questions"][0]["result"]["earned"], {"points": 2, "xp": 2})

    def test_a_wrong_answer_shows_the_key_and_pays_nothing(self):
        card = self.today()["questions"][0]
        result = self.answer(card["id"], "B").json()["result"]
        self.assertEqual((result["is_correct"], result["answer"], result["earned"]), (False, "B", {"points": 0, "xp": 0}))
        self.assertEqual(result["correct_answer"], "A")
        self.assertFalse(PointAward.objects.exists())

    def test_one_try_only(self):
        card = self.today()["questions"][0]
        self.answer(card["id"], "B")
        second = self.answer(card["id"], "A")
        self.assertEqual((second.status_code, second.json()["code"]), (409, "already_answered"))
        self.assertFalse(PointAward.objects.exists())

    def test_yesterdays_question_is_gone(self):
        card = self.today()["questions"][0]
        with mock.patch("django.utils.timezone.now", return_value=at(date(2026, 11, 3), 0, 1)):
            late = self.answer(card["id"], "A")
            self.assertEqual((late.status_code, late.json()["code"]), (409, "expired"))
            [fresh] = self.today()["questions"]
        self.assertNotEqual(fresh["id"], card["id"])

    def test_a_blank_answer_is_refused(self):
        card = self.today()["questions"][0]
        for blank in ("", "   ", None):
            self.assertEqual(self.answer(card["id"], blank).status_code, 400)
        self.assertEqual(self.client.post(f"/api/daily-questions/{card['id']}/answer/", {}, format="json").status_code, 400)
        self.assertEqual(self.today()["questions"][0]["status"], "open")

    def test_someone_elses_question_is_not_found(self):
        card = self.today()["questions"][0]
        other = make_user()
        self.client.force_authenticate(other)
        self.assertEqual(self.answer(card["id"], "A").status_code, 404)

    def test_a_frozen_student_is_refused(self):
        card = self.today()["questions"][0]
        User.objects.filter(pk=self.student.pk).update(is_frozen=True)
        self.student.refresh_from_db()
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get("/api/daily-questions/today/").status_code, 403)
        self.assertEqual(self.answer(card["id"], "A").status_code, 403)

    def test_numeric_questions_grade_like_the_runner(self):
        aset = self.w.aset(AssessmentSet.SUBJECT_MATH, "senior")
        grid_in = self.w.question(aset, question_type=AssessmentQuestion.TYPE_NUMERIC, choices=[], correct_answer=["0.5"])
        DailyQuestionPool.objects.get(month=NOVEMBER, subject="math", level="senior").items.all().delete()
        DailyQuestionPool.objects.get(month=NOVEMBER, subject="math", level="senior").items.create(
            question=grid_in, rank=1, answers_count=10, correct_count=1)
        card = self.today()["questions"][0]
        self.assertTrue(self.answer(card["id"], "1/2").json()["result"]["is_correct"])

    @override_settings(DAILY_QUESTIONS_ENABLED=False)
    def test_flag_off_is_an_empty_card(self):
        body = self.today()
        self.assertEqual((body["enabled"], body["questions"]), (False, []))
