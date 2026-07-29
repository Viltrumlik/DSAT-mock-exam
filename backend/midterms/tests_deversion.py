"""Midterm VERSIONING is retired: a teacher's test is ONE paper, edited in place.

Two rules, and the second is the dangerous one:
  1. No midterm ever BECOMES versioned. A second authored form is no longer mirrored into a
     parallel MidtermVersion — only the first form is served.
  2. A midterm that is ALREADY versioned keeps working. Its attempts pin a version and
     resolve their questions through it, so the version rows must keep being fed and must
     NOT be deleted while anything references them. Deleting one cascades its Questions
     away, and attempt answers key on Question.id — that is silent, total answer loss for
     everyone mid-sitting.
"""

from django.contrib.auth import get_user_model
from django.test import TestCase

from exams.models import MockExam, Module, PracticeTest, Question
from midterms.models import Midterm, MidtermAttempt, MidtermVersion, MidtermVersionAssignment
from midterms.sync import upsert_midterm_from_legacy

User = get_user_model()


def _legacy(*, forms=2, n=3, two_module=False, answer="a"):
    """A legacy midterm MockExam with `forms` PracticeTests (the old "versions" shape)."""
    exam = MockExam.objects.create(
        title="Deversion Midterm", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
        midterm_scoring_scale="SCALE_100", midterm_module_count=2 if two_module else 1,
        midterm_module1_minutes=30, midterm_module2_minutes=20,
        midterm_module_question_limit=30, midterm_two_module_runtime=two_module,
        is_published=True,
    )
    for f in range(forms):
        pt = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        orders = (1, 2) if two_module else (1,)
        for order in orders:
            mod = Module.objects.create(practice_test=pt, module_order=order, time_limit_minutes=30)
            for i in range(n):
                Question.objects.create(
                    module=mod, question_type="MATH", question_text=f"F{f}M{order}Q{i}",
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers=answer, score=10, order=i,
                )
    return exam


class NoNewVersionsTests(TestCase):
    def test_two_forms_no_longer_create_versions(self):
        mt = upsert_midterm_from_legacy(_legacy(forms=2, n=3))
        self.assertEqual(mt.versions.count(), 0)
        self.assertEqual(mt.questions().count(), 3)  # first form only, not 6

    def test_two_forms_two_module_serves_only_the_first_form(self):
        mt = upsert_midterm_from_legacy(_legacy(forms=2, n=3, two_module=True))
        self.assertEqual(mt.versions.count(), 0)
        self.assertEqual(mt.questions_for_order(1).count(), 3)
        self.assertEqual(mt.questions_for_order(2).count(), 3)
        self.assertEqual(mt.total_question_count(), 6)

    def test_a_teacher_edit_changes_the_paper_in_place(self):
        """The user's requirement: edit the test, it changes where it already is."""
        exam = _legacy(forms=2, n=3)
        mt = upsert_midterm_from_legacy(exam)
        ids_before = [q.id for q in mt.questions()]

        first_form_q = Question.objects.filter(
            module__practice_test=exam.tests.order_by("id").first()
        ).order_by("order").first()
        first_form_q.question_text = "EDITED"
        first_form_q.correct_answers = "d"
        first_form_q.save()

        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual([q.id for q in mt.questions()], ids_before)  # ids preserved
        edited = mt.questions().order_by("order").first()
        self.assertEqual(edited.question_text, "EDITED")
        self.assertEqual(edited.correct_answers, "d")


class ExistingVersionsSurviveTests(TestCase):
    """The 15-live-students case: an already-versioned midterm must not be disturbed."""

    def setUp(self):
        self.student = User.objects.create(username="dv-stud", email="dv@x.io")

    def _versioned(self, **kw):
        exam = _legacy(**kw)
        mt = Midterm.objects.create(
            title="Legacy Versioned", subject=Midterm.MATH, scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, legacy_mock_exam_id=exam.id, is_published=True,
        )
        # Build the versioned shape the old sync used to produce.
        for n, pt in enumerate(exam.tests.all().order_by("id"), start=1):
            mod = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
            for i, src in enumerate(Question.objects.filter(module__practice_test=pt).order_by("id")):
                Question.objects.create(
                    module=mod, question_type="MATH", question_text=src.question_text,
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers=src.correct_answers, score=10, order=i,
                )
            MidtermVersion.objects.create(
                midterm=mt, version_number=n, question_module=mod, legacy_practice_test_id=pt.id
            )
        return exam, mt

    def test_a_pinned_live_attempt_keeps_its_questions_and_answers(self):
        exam, mt = self._versioned(forms=2, n=3)
        version = mt.versions.order_by("version_number").first()
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()
        qids = [str(q.id) for q in att.effective_questions()]
        att.autosave(answers={qids[0]: "a", qids[1]: "b"})

        upsert_midterm_from_legacy(exam)  # a teacher saves a question -> full resync

        att.refresh_from_db()
        self.assertIsNotNone(att.version_id)
        self.assertEqual(mt.versions.count(), 2)  # nothing deleted
        # every answered question id still exists and still resolves for this attempt
        still = {str(q.id) for q in att.effective_questions()}
        self.assertTrue(set(att.answers).issubset(still))
        self.assertEqual(att.answers, {qids[0]: "a", qids[1]: "b"})

    def test_versioned_midterm_still_receives_builder_edits(self):
        exam, mt = self._versioned(forms=2, n=3)
        version = mt.versions.order_by("version_number").first()
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()

        src = Question.objects.filter(
            module__practice_test=exam.tests.order_by("id").first()
        ).order_by("order").first()
        src.correct_answers = "d"
        src.save()
        upsert_midterm_from_legacy(exam)

        served = list(att.effective_questions())
        self.assertEqual(served[0].correct_answers, "d")  # the fix reached the student

    def test_a_referenced_version_is_never_retired_even_when_forms_shrink(self):
        """The old teardown deleted versions unconditionally, cascading their Questions and
        de-referencing every pinned attempt's answers."""
        exam, mt = self._versioned(forms=2, n=3)
        version = mt.versions.order_by("version_number").first()
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()
        qids = [str(q.id) for q in att.effective_questions()]
        att.autosave(answers={qids[0]: "a"})

        exam.tests.order_by("id").last().delete()  # down to ONE form
        upsert_midterm_from_legacy(exam)

        self.assertTrue(MidtermVersion.objects.filter(pk=version.pk).exists())
        att.refresh_from_db()
        self.assertEqual(att.version_id, version.pk)
        self.assertEqual(Question.objects.filter(pk=int(qids[0])).count(), 1)  # not cascaded
        self.assertEqual(att.answers, {qids[0]: "a"})

    def test_an_assigned_but_unstarted_version_is_not_retired(self):
        from classes.models import Classroom

        exam, mt = self._versioned(forms=2, n=3)
        version = mt.versions.order_by("version_number").last()
        teacher = User.objects.create(username="dv-teach", email="dvt@x.io")
        room = Classroom.objects.create(
            name="DV-1", subject=Classroom.SUBJECT_MATH, level="junior", description="x",
            lesson_days="ODD", teacher=teacher, created_by=teacher,
        )
        MidtermVersionAssignment.objects.create(
            midterm=mt, student=self.student, version=version, classroom=room
        )

        exam.tests.order_by("id").last().delete()
        upsert_midterm_from_legacy(exam)

        self.assertTrue(MidtermVersion.objects.filter(pk=version.pk).exists())

    def test_an_unreferenced_version_is_cleaned_up(self):
        exam, mt = self._versioned(forms=2, n=3)
        exam.tests.order_by("id").last().delete()
        upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 0)  # nothing pointed at them


class MirrorModuleClockTests(TestCase):
    """A version's mirror module must follow the exam's configured minutes on EVERY sync.

    It used to be set only at creation, so versions provisioned back when the sync summed
    the two builder fields still carried the summed value (64 for a 32+32 paper) long after
    the real durations became 40+40. Nothing was MIS-TIMED — the runtime reads
    Midterm.duration_for_order — but every surface displaying this field quoted a number the
    exam had not used for weeks, which is how the builder ended up showing "40 + 40 min" in
    its header and "32 min" on the module rows underneath.
    """

    def test_version_module_times_follow_a_duration_change(self):
        from midterms.sync import upsert_midterm_from_legacy

        exam = _legacy(forms=2, n=3, two_module=True)
        mt = Midterm.objects.create(
            title="Clock", subject=Midterm.MATH, scoring_scale=Midterm.SCALE_100,
            duration_minutes=30, legacy_mock_exam_id=exam.id, is_published=True,
        )
        # a version provisioned with a stale (summed) clock, as production had
        stale1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=64)
        stale2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=64)
        MidtermVersion.objects.create(
            midterm=mt, version_number=1, question_module=stale1, question_module_2=stale2,
            legacy_practice_test_id=exam.tests.order_by("id").first().id,
        )

        upsert_midterm_from_legacy(exam)

        stale1.refresh_from_db(); stale2.refresh_from_db()
        self.assertEqual(stale1.time_limit_minutes, 30)  # midterm_module1_minutes
        self.assertEqual(stale2.time_limit_minutes, 20)  # midterm_module2_minutes
