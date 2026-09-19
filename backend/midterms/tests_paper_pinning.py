"""A sitting keeps the paper it started with; the midterm keeps taking edits.

The 2026-09-18 incident: an admin rebuilt six Junior Math midterms that 215 students had
already sat — Add version, Remove the original, CSV import, switch the scale from 100 to 800
with a 650 pass mark. The live mirror followed the builder faithfully, so it deleted every
question those students had answered and re-read their 0-100 scores on the 800 scale: all
215 turned into "0%, failed", 124 of them students who had passed.

The rule these tests pin down, as the owner put it: an edit must change the midterm; old
grades stay as they were; a student who sits it again after the edit gets the new questions
and a new score.

    python manage.py test midterms.tests_paper_pinning --settings=config.settings_test_nomigrations
"""

from __future__ import annotations

from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from exams.models import MockExam, Module, PracticeTest, Question
from midterms.models import (
    Midterm,
    MidtermAttempt,
    MidtermOutcome,
    MidtermQuestionResult,
    MidtermResit,
)
from midterms.serializers import MidtermAttemptSerializer
from midterms.sync import upsert_midterm_from_legacy
from midterms.tests_api import grant

User = get_user_model()
_QHOST = {"HTTP_HOST": "questions.mastersat.uz"}


def _questions(module, n, *, prefix, key="a"):
    for i in range(n):
        Question.objects.create(
            module=module, question_type="MATH", question_text=f"{prefix} Q{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers=key, score=10, order=i,
        )


def _builder_midterm(*, n=3, scale="SCALE_100", pass_mark=None, two_module=False, n2=0):
    """A builder (legacy) midterm with one authored form, published, and its mirror."""
    exam = MockExam.objects.create(
        title="Junior Math Midterm Month 1", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
        midterm_scoring_scale=scale, midterm_pass_mark=pass_mark,
        midterm_module_count=2 if two_module else 1, midterm_two_module_runtime=two_module,
        midterm_module1_minutes=30, midterm_module2_minutes=30, midterm_module_question_limit=30,
        is_published=True,
    )
    pt = PracticeTest.objects.create(
        mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
    )
    _questions(Module.objects.create(practice_test=pt, module_order=1, time_limit_minutes=30), n, prefix="OLD")
    if two_module:
        _questions(
            Module.objects.create(practice_test=pt, module_order=2, time_limit_minutes=30), n2, prefix="OLD-M2"
        )
    return exam, pt, upsert_midterm_from_legacy(exam)


def _sit(midterm, student, answer="a", *, finish=True):
    """Start a sitting and (by default) finish it, answering every question with ``answer``."""
    att = MidtermAttempt.objects.create(midterm=midterm, student=student)
    att.start_attempt()
    att.refresh_from_db()
    if finish:
        att.submit_final(answers={str(q.id): answer for q in att.effective_questions()})
        att.complete()
        att.refresh_from_db()
    return att


def _builder_question(pt, i=0, order=1):
    return Question.objects.filter(module__practice_test=pt, module__module_order=order).order_by("order", "id")[i]


class StartPinsThePaperTests(TestCase):
    def setUp(self):
        self.exam, self.pt, self.mt = _builder_midterm(n=3, scale="SCALE_100", pass_mark=60)
        self.student = User.objects.create(username="s1", email="s1@x.io")

    def test_start_pins_the_modules_scale_and_pass_mark(self):
        att = _sit(self.mt, self.student, finish=False)
        self.assertEqual(att.paper_module_id, self.mt.question_module_id)
        self.assertIsNone(att.paper_module_2_id)
        self.assertEqual(att.paper_scale, "SCALE_100")
        self.assertEqual(att.paper_pass_mark, 60)

    def test_a_pre_midterm_sitting_is_pinned_as_not_judged(self):
        self.mt.midterm_type = Midterm.TYPE_PRE_MIDTERM
        self.mt.save(update_fields=["midterm_type"])
        att = _sit(self.mt, self.student, finish=False)
        self.assertEqual(att.paper_scale, "SCALE_100")
        self.assertIsNone(att.paper_pass_mark)
        self.assertFalse(att.is_graded)

    def test_an_attempt_that_never_started_is_not_pinned(self):
        att = MidtermAttempt.objects.create(midterm=self.mt, student=self.student)
        self.assertIsNone(att.paper_module_id)
        self.assertEqual(att.paper_scale, "")

    def test_an_unpinned_attempt_still_resolves_through_the_midterm(self):
        """Attempts from before pinning existed must behave exactly as they always did."""
        att = MidtermAttempt.objects.create(
            midterm=self.mt, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=100, completed_at=timezone.now(),
        )
        self.assertEqual([q.id for q in att.effective_questions()], [q.id for q in self.mt.questions()])
        self.assertEqual(att.scoring_scale, "SCALE_100")
        self.assertEqual(att.pass_mark, 60)
        self.assertTrue(att.passed)


class EditsAfterASittingTests(TestCase):
    """The midterm takes the edit; the finished paper does not."""

    def setUp(self):
        self.exam, self.pt, self.mt = _builder_midterm(n=3)
        self.student = User.objects.create(username="s1", email="s1@x.io")
        self.done = _sit(self.mt, self.student, answer="a")  # 3/3 -> 100
        self.paper_ids = [q.id for q in self.done.effective_questions()]

    def test_a_content_edit_leaves_the_finished_paper_alone(self):
        src = _builder_question(self.pt)
        src.question_text = "NEW STEM"
        src.correct_answers = "b"
        src.save()
        mt = upsert_midterm_from_legacy(self.exam)

        # The midterm serves the edit — on a fresh module, so the finished paper is untouched.
        self.assertNotEqual(mt.question_module_id, self.done.paper_module_id)
        self.assertEqual(mt.questions().first().question_text, "NEW STEM")
        self.done.refresh_from_db()
        self.assertEqual([q.id for q in self.done.effective_questions()], self.paper_ids)
        first = self.done.effective_questions()[0]
        self.assertEqual(first.question_text, "OLD Q0")
        self.assertEqual(first.correct_answers, "a")
        self.assertEqual(self.done.score, 100)

    def test_nothing_changed_means_no_new_module(self):
        before = self.mt.question_module_id
        mt = upsert_midterm_from_legacy(self.exam)
        self.assertEqual(mt.question_module_id, before)
        self.assertEqual(Module.objects.filter(practice_test__isnull=True).count(), 1)

    def test_a_second_edit_before_anyone_sits_again_edits_in_place(self):
        src = _builder_question(self.pt)
        src.question_text = "EDIT 1"
        src.save()
        mt = upsert_midterm_from_legacy(self.exam)
        fresh_module = mt.question_module_id
        fresh_ids = [q.id for q in mt.questions()]

        src.question_text = "EDIT 2"
        src.save()
        mt = upsert_midterm_from_legacy(self.exam)
        self.assertEqual(mt.question_module_id, fresh_module)  # nobody sat it: no third module
        self.assertEqual([q.id for q in mt.questions()], fresh_ids)
        self.assertEqual(mt.questions().first().question_text, "EDIT 2")

    def test_the_next_sitting_gets_the_new_paper(self):
        src = _builder_question(self.pt)
        src.correct_answers = "b"
        src.save()
        mt = upsert_midterm_from_legacy(self.exam)
        other = User.objects.create(username="s2", email="s2@x.io")
        att = _sit(mt, other, answer="a")
        self.assertEqual(att.paper_module_id, mt.question_module_id)
        self.assertEqual(att.score, 67)  # 2 of 3 under the corrected key
        self.done.refresh_from_db()
        self.assertEqual(self.done.score, 100)  # the old grade stands


class EditsDuringASittingTests(TestCase):
    def test_an_answer_key_correction_reaches_a_student_mid_exam_but_not_a_finished_grade(self):
        """A wrong key found during the sitting must not mis-grade the room still sitting it;
        a student who already handed in keeps the grade they were given."""
        exam, pt, mt = _builder_midterm(n=3)
        done = _sit(mt, User.objects.create(username="done", email="d@x.io"), answer="a")
        live = _sit(mt, User.objects.create(username="live", email="l@x.io"), finish=False)
        module = mt.question_module_id

        src = _builder_question(pt)
        src.correct_answers = "b"
        src.save()
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.question_module_id, module)  # a correction is not a new paper

        live.refresh_from_db()
        answers = {str(q.id): "a" for q in live.effective_questions()}
        answers[str(live.effective_questions()[0].id)] = "b"
        live.submit_final(answers=answers)
        live.complete()
        live.refresh_from_db()
        self.assertEqual(live.score, 100)  # graded on the corrected key
        done.refresh_from_db()
        self.assertEqual(done.score, 100)  # the old grade stands

    def test_a_student_mid_exam_finishes_on_the_paper_they_started(self):
        exam, pt, mt = _builder_midterm(n=3)
        student = User.objects.create(username="s1", email="s1@x.io")
        att = _sit(mt, student, finish=False)
        served = [q["question_text"] for q in MidtermAttemptSerializer(att).data["current_module_details"]["questions"]]

        src = _builder_question(pt)
        src.question_text = "CHANGED MID-EXAM"
        src.correct_answers = "b"
        src.save()
        upsert_midterm_from_legacy(exam)

        att.refresh_from_db()
        payload = MidtermAttemptSerializer(att).data["current_module_details"]["questions"]
        self.assertEqual([q["question_text"] for q in payload], served)
        att.submit_final(answers={str(q.id): "a" for q in att.effective_questions()})
        att.complete()
        att.refresh_from_db()
        self.assertEqual(att.score, 100)


@override_settings(ALLOWED_HOSTS=["testserver", "localhost", "questions.mastersat.uz"])
class TheIncidentSequenceTests(TestCase):
    """What the admin actually clicked on 2026-09-18, through the real builder endpoints."""

    def setUp(self):
        self.exam, self.pt, self.mt = _builder_midterm(n=3, scale="SCALE_100")
        self.student = User.objects.create(username="s1", email="s1@x.io")
        self.done = _sit(self.mt, self.student, answer="a")
        self.admin = APIClient()
        self.admin.force_authenticate(User.objects.create_user(
            email="admin@x.io", password="pw", role="super_admin", is_staff=True, is_superuser=True,
        ))

    def _url(self, suffix=""):
        return f"/api/exams/admin/mock-exams/{self.exam.pk}/{suffix}"

    def test_replacing_the_version_keeps_what_finished_students_answered(self):
        frozen = set(MidtermQuestionResult.objects.filter(attempt=self.done).values_list("question_id", flat=True))
        r = self.admin.post(self._url("add-midterm-version/"), {}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 201, r.content)
        new_pt = r.data["id"]
        r = self.admin.delete(self._url("remove-midterm-version/"), {"test_id": self.pt.pk}, format="json", **_QHOST)
        self.assertEqual(r.status_code, 200, r.content)
        new_mod = Module.objects.get(practice_test_id=new_pt, module_order=1)
        for _ in range(2):
            r = self.admin.post(
                f"/api/exams/admin/tests/{new_pt}/modules/{new_mod.pk}/questions/", {}, format="json", **_QHOST
            )
            self.assertEqual(r.status_code, 201, r.content)

        self.assertEqual(Question.objects.filter(id__in=frozen).count(), 3)  # nothing deleted
        self.done.refresh_from_db()
        self.assertEqual({q.id for q in self.done.effective_questions()}, frozen)
        self.mt.refresh_from_db()
        self.assertEqual(self.mt.questions().count(), 2)  # the midterm is the new paper
        self.assertFalse({q.id for q in self.mt.questions()} & frozen)

    def test_a_settings_only_save_reaches_the_student_side(self):
        r = self.admin.patch(
            self._url(),
            {"midterm_type": "PRE_MIDTERM", "midterm_module1_minutes": 45, "title": "Renamed"},
            format="json", **_QHOST,
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.mt.refresh_from_db()
        self.assertEqual(self.mt.midterm_type, "PRE_MIDTERM")
        self.assertEqual(self.mt.duration_minutes, 45)
        self.assertEqual(self.mt.title, "Renamed")

    def test_switching_the_scale_leaves_old_results_on_their_own_scale(self):
        r = self.admin.patch(
            self._url(), {"midterm_scoring_scale": "SCALE_800", "midterm_pass_mark": 650}, format="json", **_QHOST
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.mt.refresh_from_db()
        self.assertEqual(self.mt.scoring_scale, "SCALE_800")

        self.done.refresh_from_db()
        self.assertEqual(self.done.scoring_scale, "SCALE_100")
        self.assertEqual(self.done.score_ceiling, 100)
        self.assertEqual(self.done.pass_mark, 50)
        self.assertTrue(self.done.passed)
        self.assertTrue(MidtermOutcome.objects.get(attempt=self.done).passed)

        grant(self.student, self.mt)
        me = APIClient()
        me.force_authenticate(self.student)
        body = me.get(f"/api/midterms/attempts/{self.done.id}/review/").json()
        self.assertEqual((body["total_score"], body["score_ceiling"]), (100, 100))
        row = me.get("/api/midterms/mine/").json()["results"][0]
        self.assertEqual((row["score"], row["score_ceiling"]), (100, 100))


class ResitAfterAnEditTests(TestCase):
    def test_a_resit_after_the_edit_sits_the_new_paper_and_its_score_supersedes(self):
        exam, pt, mt = _builder_midterm(n=2, scale="SCALE_100")
        student = User.objects.create(username="s1", email="s1@x.io")
        grant(student, mt)
        old = _sit(mt, student, answer="a")  # 100/100, passed at 50

        exam.midterm_scoring_scale = "SCALE_800"
        exam.midterm_pass_mark = 650
        exam.save()
        _questions(Module.objects.get(practice_test=pt, module_order=1), 2, prefix="NEW", key="b")
        mt = upsert_midterm_from_legacy(exam)  # now 4 questions, 800 scale

        MidtermResit.objects.create(midterm=mt, student=student, reason="repeated the month")
        c = APIClient()
        c.force_authenticate(student)
        r = c.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        new = MidtermAttempt.objects.get(pk=r.json()["id"])
        new.start_attempt()
        new.refresh_from_db()
        self.assertEqual(len(new.effective_questions()), 4)
        self.assertEqual(new.scoring_scale, "SCALE_800")
        new.submit_final(answers={str(q.id): "a" for q in new.effective_questions()})
        new.complete()
        new.refresh_from_db()
        self.assertEqual(new.score, 500)  # 2 of 4 on the 800 scale

        outcome = MidtermOutcome.objects.get(midterm=mt, student=student)
        self.assertEqual(outcome.attempt_id, new.id)
        self.assertEqual((outcome.scoring_scale, outcome.pass_mark, outcome.passed), ("SCALE_800", 650, False))
        old.refresh_from_db()
        self.assertEqual((old.score, old.score_ceiling, old.passed), (100, 100, True))


class VersionedAndTwoModuleTests(TestCase):
    def test_editing_a_version_someone_sat_moves_only_that_version(self):
        exam, pt, mt = _builder_midterm(n=2)
        pt2 = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        _questions(Module.objects.create(practice_test=pt2, module_order=1, time_limit_minutes=30), 2, prefix="V2")
        mt = upsert_midterm_from_legacy(exam)
        v1 = mt.versions.get(legacy_practice_test_id=pt.id)
        v2 = mt.versions.get(legacy_practice_test_id=pt2.id)
        student = User.objects.create(username="s1", email="s1@x.io")
        att = MidtermAttempt.objects.create(midterm=mt, student=student, version=v1)
        att.start_attempt()
        att.refresh_from_db()
        att.submit_final(answers={str(q.id): "a" for q in att.effective_questions()})
        att.complete()
        v1_module, v2_module = v1.question_module_id, v2.question_module_id

        src = _builder_question(pt)
        src.question_text = "V1 EDITED"
        src.save()
        other = _builder_question(pt2)
        other.question_text = "V2 EDITED"
        other.save()
        upsert_midterm_from_legacy(exam)

        v1.refresh_from_db()
        v2.refresh_from_db()
        self.assertNotEqual(v1.question_module_id, v1_module)  # sat -> copy
        self.assertEqual(v2.question_module_id, v2_module)  # never sat -> in place
        att.refresh_from_db()
        self.assertEqual(att.effective_questions()[0].question_text, "OLD Q0")

    def test_a_versionless_attempt_on_a_versioned_midterm_gets_a_version_when_it_starts(self):
        exam, pt, mt = _builder_midterm(n=2)
        student = User.objects.create(username="s1", email="s1@x.io")
        grant(student, mt)
        att = MidtermAttempt.objects.create(midterm=mt, student=student)  # made before versioning
        pt2 = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        _questions(Module.objects.create(practice_test=pt2, module_order=1, time_limit_minutes=30), 2, prefix="V2")
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 2)

        att.start_attempt()
        att.refresh_from_db()
        self.assertIsNotNone(att.version_id)
        self.assertEqual(att.paper_module_id, att.version.question_module_id)

    def test_reverting_two_modules_to_one_keeps_a_finished_two_module_paper(self):
        exam, pt, mt = _builder_midterm(n=2, two_module=True, n2=2)
        student = User.objects.create(username="s1", email="s1@x.io")
        att = _sit(mt, student)
        self.assertEqual(att.module_count(), 2)
        m2 = att.paper_module_2_id

        exam.midterm_two_module_runtime = False
        exam.midterm_module_count = 1
        exam.save()
        mt = upsert_midterm_from_legacy(exam)

        self.assertIsNone(mt.question_module_2_id)
        self.assertEqual(mt.questions().count(), 4)  # flattened, on a new module
        self.assertTrue(Module.objects.filter(pk=m2).exists())  # detached, not deleted
        att.refresh_from_db()
        att._module_count_memo = None
        self.assertEqual(att.module_count(), 2)
        self.assertEqual(len(att.effective_questions()), 4)


class ResultScreensTests(TestCase):
    """Every place a finished score is shown reads the sitting's own scale."""

    def setUp(self):
        from classes.models import Classroom, ClassroomMembership

        self.exam, self.pt, self.mt = _builder_midterm(n=2, scale="SCALE_100")
        self.teacher = User.objects.create(username="t", email="t@x.io", is_staff=True)
        self.room = Classroom.objects.create(
            name="MATH-1", subject=Classroom.SUBJECT_MATH, level="junior", description="x",
            lesson_days="ODD", teacher=self.teacher, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.old_timer = User.objects.create(username="old", email="old@x.io")
        self.resitter = User.objects.create(username="new", email="new@x.io")
        for s in (self.old_timer, self.resitter):
            ClassroomMembership.objects.create(
                classroom=self.room, user=s, role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            )
            grant(s, self.mt, classroom=self.room)
        self.old = _sit(self.mt, self.old_timer, answer="a")  # 100 / 100
        self.exam.midterm_scoring_scale = "SCALE_800"
        self.exam.midterm_pass_mark = 650
        self.exam.save()
        self.mt = upsert_midterm_from_legacy(self.exam)
        self.new = _sit(self.mt, self.resitter, answer="b")  # 0 of 2 -> 200 / 800

    def test_classroom_panel_rows_carry_their_own_ceiling_and_rank_by_share_of_the_work(self):
        c = APIClient()
        c.force_authenticate(self.teacher)
        body = c.get(f"/api/classes/{self.room.id}/midterms-v2/{self.mt.id}/panel/").json()
        rows = {r["student_id"]: r for r in body["students"]}
        self.assertEqual((rows[self.old_timer.id]["score"], rows[self.old_timer.id]["score_ceiling"]), (100, 100))
        self.assertEqual((rows[self.resitter.id]["score"], rows[self.resitter.id]["score_ceiling"]), (200, 800))
        self.assertEqual(rows[self.old_timer.id]["rank"], 1)  # 100% beats 0%, not "100 < 200"
        self.assertEqual(rows[self.old_timer.id]["score_on_scale"], 800)
        self.assertEqual(body["stats"]["highest"], 800)  # on the midterm's current scale
        self.assertEqual(body["stats"]["lowest"], 200)
        self.assertTrue(body["stats"]["mixed_scales"])

    def test_error_report_judges_the_sitting_by_its_own_pass_mark(self):
        from midterms.views_report import build_error_report

        report = build_error_report(self.old)
        self.assertEqual(report["midterm"]["score_ceiling"], 100)
        self.assertEqual(report["midterm"]["scoring_scale"], "SCALE_100")
        self.assertEqual((report["pass_mark"], report["passed"]), (50, True))

    def test_admin_report_sitting_uses_the_sittings_own_verdict(self):
        from midterms.admin_report import sitting_for

        MidtermOutcome.objects.filter(attempt=self.old).delete()  # force the fallback path
        s = sitting_for(self.mt, self.old_timer.id, {self.old_timer.id: self.old}, {})
        self.assertEqual((s["score"], s["score_ceiling"], s["passed"]), (100, 100, True))

    def test_certificate_snapshot_uses_the_sittings_scale(self):
        from midterms.certificate_service import _snapshot

        kwargs = _snapshot(cert_defaults={}, midterm=self.mt, student=self.old_timer, attempt=self.old)
        self.assertEqual((kwargs["score"], kwargs["scoring_scale"]), (100, "SCALE_100"))


class PinBackfillCommandTests(TestCase):
    """Attempts that started before pinning existed get pinned after the fact."""

    def setUp(self):
        self.exam, self.pt, self.mt = _builder_midterm(n=2, scale="SCALE_800", pass_mark=650)
        self.s1 = User.objects.create(username="s1", email="s1@x.io")
        self.s2 = User.objects.create(username="s2", email="s2@x.io")
        # A finished SCALE_100 sitting from before the scale switch, paper still intact.
        self.intact = self._legacy_completed(self.s1, score=100, frozen=list(self.mt.questions()))
        MidtermOutcome.objects.create(
            midterm=self.mt, student=self.s1, attempt=self.intact, score=100, pass_mark=50,
            scoring_scale="SCALE_100", passed=True,
        )
        # A finished sitting whose questions were deleted by the old sync.
        self.orphan = self._legacy_completed(self.s2, score=40, frozen_ids=[999_001, 999_002])

    def _legacy_completed(self, student, *, score, frozen=None, frozen_ids=None):
        att = MidtermAttempt.objects.create(
            midterm=self.mt, student=student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=score, completed_at=timezone.now(), started_at=timezone.now(),
        )
        ids = frozen_ids if frozen_ids is not None else [q.id for q in frozen]
        for i, qid in enumerate(ids):
            MidtermQuestionResult.objects.create(attempt=att, question_id=qid, order=i, is_correct=True, answered=True)
        return att

    def test_dry_run_writes_nothing(self):
        out = StringIO()
        call_command("pin_midterm_papers", stdout=out)
        self.intact.refresh_from_db()
        self.assertEqual(self.intact.paper_scale, "")
        self.assertIn("DRY RUN", out.getvalue())

    def test_commit_pins_scale_verdict_and_intact_papers_only(self):
        call_command("pin_midterm_papers", "--commit", stdout=StringIO())
        self.intact.refresh_from_db()
        self.orphan.refresh_from_db()
        self.assertEqual((self.intact.paper_scale, self.intact.paper_pass_mark), ("SCALE_100", 50))
        self.assertEqual(self.intact.paper_module_id, self.mt.question_module_id)
        # Scale read off the score (a 0-100 score is never an 800-scale one); no outcome to
        # read a pass mark from, so the 100-scale default.
        self.assertEqual((self.orphan.paper_scale, self.orphan.paper_pass_mark), ("SCALE_100", 50))
        self.assertIsNone(self.orphan.paper_module_id)  # its paper is gone: not pinned to a stranger's
        self.assertEqual((self.orphan.score_ceiling, self.orphan.passed), (100, False))

    def test_commit_is_idempotent(self):
        call_command("pin_midterm_papers", "--commit", stdout=StringIO())
        out = StringIO()
        call_command("pin_midterm_papers", "--commit", stdout=out)
        self.assertIn("pinned 0", out.getvalue())


class MirrorQuestionEditorTests(TestCase):
    """The mirror's own question editor writes rows in place, so it must not touch a paper
    somebody has sat — that was a second door to the 2026-09-18 incident."""

    def setUp(self):
        self.exam, self.pt, self.mt = _builder_midterm(n=3)
        self.staff = User.objects.create(username="qa", email="qa@x.io", is_staff=True, is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def _url(self, suffix=""):
        return f"/api/midterms/admin/midterms/{self.mt.id}/questions/{suffix}"

    def test_every_write_is_refused_once_the_paper_was_sat(self):
        _sit(self.mt, User.objects.create(username="s", email="s@x.io"))
        q = self.mt.questions().first()
        ids = [x.id for x in self.mt.questions()]
        attempts = (
            self.client.post(self._url(), {"question_text": "extra"}, format="json"),
            self.client.patch(self._url(f"{q.id}/"), {"question_text": "reworded"}, format="json"),
            self.client.delete(self._url(f"{q.id}/")),
            self.client.post(self._url("bulk-reorder/"), {"ordered_ids": ids[::-1]}, format="json"),
        )
        self.assertEqual([r.status_code for r in attempts], [400, 400, 400, 400])
        self.assertEqual([x.id for x in self.mt.questions()], ids)
        self.assertEqual(self.mt.questions().first().question_text, "OLD Q0")

    def test_an_unsat_paper_can_still_be_edited_here(self):
        q = self.mt.questions().first()
        r = self.client.patch(self._url(f"{q.id}/"), {"question_text": "reworded"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)


class PinBackfillPassMarkTests(TestCase):
    def test_a_superseded_sitting_takes_the_pass_mark_its_day_was_judged_on(self):
        """A verdict row points at a student's LATEST sitting only; an earlier sitting learns
        the pass mark of its day from the midterm's verdicts, not from today's setting."""
        exam, pt, mt = _builder_midterm(n=2, scale="SCALE_100", pass_mark=60)
        student = User.objects.create(username="s1", email="s1@x.io")
        now = timezone.now()
        first = MidtermAttempt.objects.create(
            midterm=mt, student=student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=65, completed_at=now, started_at=now,
        )
        resit = MidtermAttempt.objects.create(
            midterm=mt, student=student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=90, completed_at=now, started_at=now,
        )
        MidtermOutcome.objects.create(
            midterm=mt, student=student, attempt=resit, score=90, pass_mark=60,
            scoring_scale="SCALE_100", passed=True,
        )
        mt.pass_mark = 70  # raised since
        mt.save(update_fields=["pass_mark"])

        call_command("pin_midterm_papers", "--commit", stdout=StringIO())
        first.refresh_from_db()
        self.assertEqual((first.paper_scale, first.paper_pass_mark, first.passed), ("SCALE_100", 60, True))


class SummaryBasisTests(TestCase):
    """A total over a class's sittings speaks the scale that class sat on (outcomes.summary_basis)."""

    def setUp(self):
        from classes.models import Classroom, ClassroomMembership

        self.exam, self.pt, self.mt = _builder_midterm(n=2, scale="SCALE_100")
        self.teacher = User.objects.create(username="t2", email="t2@x.io", is_staff=True)
        self.room = Classroom.objects.create(
            name="MATH-2", subject=Classroom.SUBJECT_MATH, level="junior", description="x",
            lesson_days="ODD", teacher=self.teacher, created_by=self.teacher,
        )
        ClassroomMembership.objects.create(
            classroom=self.room, user=self.teacher, role=ClassroomMembership.ROLE_TEACHER,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        self.sitters = []
        for i, answer in enumerate(("a", "b")):  # 100 and 0 on the 100 scale
            s = User.objects.create(username=f"k{i}", email=f"k{i}@x.io")
            ClassroomMembership.objects.create(
                classroom=self.room, user=s, role=ClassroomMembership.ROLE_STUDENT,
                status=ClassroomMembership.STATUS_ACTIVE,
            )
            grant(s, self.mt, classroom=self.room)
            self.sitters.append(_sit(self.mt, s, answer=answer))
        # The whole class has sat it; THEN the midterm moves to the 800 scale.
        self.exam.midterm_scoring_scale = "SCALE_800"
        self.exam.midterm_pass_mark = 650
        self.exam.save()
        self.mt = upsert_midterm_from_legacy(self.exam)

    def test_basis_is_the_class_own_scale_and_pass_mark(self):
        from midterms.outcomes import summary_basis

        self.assertEqual(
            summary_basis(self.sitters, self.mt),
            {"scoring_scale": "SCALE_100", "score_ceiling": 100, "pass_mark": 50, "mixed_scales": False},
        )
        # Nobody sat yet: the midterm as it stands now.
        self.assertEqual(
            summary_basis([], self.mt),
            {"scoring_scale": "SCALE_800", "score_ceiling": 800, "pass_mark": 650, "mixed_scales": False},
        )

    def test_classroom_panel_totals_are_out_of_what_the_room_sat(self):
        c = APIClient()
        c.force_authenticate(self.teacher)
        stats = c.get(f"/api/classes/{self.room.id}/midterms-v2/{self.mt.id}/panel/").json()["stats"]
        self.assertEqual(
            (stats["score_ceiling"], stats["average"], stats["highest"], stats["lowest"], stats["mixed_scales"]),
            (100, 50, 100, 0, False),
        )

    def test_admin_report_summary_states_the_class_pass_mark(self):
        from midterms.admin_report import build_midterm_rows

        _rows, summary = build_midterm_rows(self.room, self.mt, [])
        self.assertEqual(
            (summary["pass_mark"], summary["score_ceiling"], summary["average_score"], summary["mixed_scales"]),
            (50, 100, 50, False),
        )
