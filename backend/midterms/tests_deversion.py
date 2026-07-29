"""Midterm VERSIONING: two or more authored forms means two or more parallel papers.

Four rules, and the last three are all about the same danger — a version row is not just
metadata. Deleting one cascades its Questions away while ``MidtermAttempt.version`` is
SET_NULL, and attempt answers key on ``Question.id``. So a careless teardown is silent,
total answer loss for everyone sitting that form.

  1. A second authored form becomes a parallel MidtermVersion, automatically. No opt-in.
  2. Creation is DEFERRED while a class is sitting the midterm — versioning a live room
     hands the students who start next a different paper from the ones already writing.
  3. A version is never deleted while an attempt or an assignment references it, no matter
     which path the delete comes from: reducing the forms, or removing one in the builder.
  4. The flat question_module is never touched once versions exist, so an attempt created
     before the flip (version_id=NULL) keeps resolving the exact rows it was served.
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


def _add_form(exam, *, n=3, answer="b", two_module=False, reuse_last=False):
    """Author one more form on an existing midterm — what "Add version" does in the builder.

    ``reuse_last`` fills the empty PracticeTest that is already there instead of making a new
    one, which is the second half of the add-then-author sequence.
    """
    pt = exam.tests.order_by("id").last() if reuse_last else PracticeTest.objects.create(
        mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
    )
    for order in ((1, 2) if two_module else (1,)):
        mod = Module.objects.create(practice_test=pt, module_order=order, time_limit_minutes=30)
        for i in range(n):
            Question.objects.create(
                module=mod, question_type="MATH", question_text=f"ADDM{order}Q{i}",
                option_a="A", option_b="B", option_c="C", option_d="D",
                correct_answers=answer, score=10, order=i,
            )
    return pt


class VersionsAreCreatedTests(TestCase):
    def test_two_forms_create_two_versions(self):
        mt = upsert_midterm_from_legacy(_legacy(forms=2, n=3))
        self.assertEqual(mt.versions.count(), 2)
        for version in mt.versions.order_by("version_number"):
            self.assertEqual(version.total_question_count(), 3)
        self.assertEqual([v.label for v in mt.versions.order_by("version_number")],
                         ["Version A", "Version B"])

    def test_version_numbers_follow_the_authored_form_order(self):
        # The builder labels forms A..D by their position in an id-ordered list; the mirror
        # must number them the same way, or a teacher's answer-key fix lands on the form a
        # different group of students is sitting.
        exam = _legacy(forms=2, n=1)
        mt = upsert_midterm_from_legacy(exam)
        first_pt, second_pt = list(exam.tests.order_by("id"))
        by_number = {v.version_number: v for v in mt.versions.all()}
        self.assertEqual(by_number[1].legacy_practice_test_id, first_pt.id)
        self.assertEqual(by_number[2].legacy_practice_test_id, second_pt.id)

    def test_each_version_gets_both_modules(self):
        mt = upsert_midterm_from_legacy(_legacy(forms=2, n=3, two_module=True))
        self.assertEqual(mt.versions.count(), 2)
        for version in mt.versions.order_by("version_number"):
            self.assertEqual(version.questions_for_order(1).count(), 3)
            self.assertEqual(version.questions_for_order(2).count(), 3)
            self.assertEqual(version.total_question_count(), 6)
            self.assertEqual(version.module_count(), 2)

    def test_each_version_keeps_its_own_answer_key(self):
        exam = _legacy(forms=2, n=2)
        # Give the second form a different key so a cross-wired mirror is visible.
        Question.objects.filter(module__practice_test=exam.tests.order_by("id").last()).update(
            correct_answers="c"
        )
        mt = upsert_midterm_from_legacy(exam)
        keys = [
            sorted({q.correct_answers for q in v.all_questions()})
            for v in mt.versions.order_by("version_number")
        ]
        self.assertEqual(keys, [["a"], ["c"]])

    def test_one_form_stays_unversioned(self):
        mt = upsert_midterm_from_legacy(_legacy(forms=1, n=3))
        self.assertEqual(mt.versions.count(), 0)
        self.assertEqual(mt.questions().count(), 3)

    def test_a_teacher_edit_changes_a_single_form_paper_in_place(self):
        """The user's requirement: edit the test, it changes where it already is."""
        exam = _legacy(forms=1, n=3)
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

    def test_a_teacher_edit_changes_a_versioned_paper_in_place(self):
        exam = _legacy(forms=2, n=3)
        mt = upsert_midterm_from_legacy(exam)
        version = mt.versions.order_by("version_number").first()
        ids_before = [q.id for q in version.questions()]

        first_form_q = Question.objects.filter(
            module__practice_test=exam.tests.order_by("id").first()
        ).order_by("order").first()
        first_form_q.question_text = "EDITED"
        first_form_q.correct_answers = "d"
        first_form_q.save()

        upsert_midterm_from_legacy(exam)
        version.refresh_from_db()
        self.assertEqual([q.id for q in version.questions()], ids_before)  # ids preserved
        edited = version.questions().order_by("order").first()
        self.assertEqual(edited.question_text, "EDITED")
        self.assertEqual(edited.correct_answers, "d")


class VersioningSafetyTests(TestCase):
    """The guards that stop restoring versioning from hurting anyone mid-sitting."""

    def setUp(self):
        self.student = User.objects.create(username="safety-stud", email="safety@x.io")

    def test_restoring_versioning_does_not_dereference_a_live_attempts_answers(self):
        exam = _legacy(forms=1, n=3)
        mt = upsert_midterm_from_legacy(exam)
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()
        qids = [str(q.id) for q in att.effective_questions()]
        att.autosave(answers={qids[0]: "a", qids[1]: "b"})
        att.submit_final()  # finish, so the sitting no longer defers version creation

        # A second form is authored -> the midterm becomes versioned.
        _add_form(exam, n=3, answer="c")
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 2)

        att.refresh_from_db()
        self.assertIsNone(att.version_id)  # still resolves through the flat module
        still = {str(q.id) for q in att.effective_questions()}
        self.assertEqual(set(qids), still)  # every Question.id survived
        self.assertEqual(att.answers, {qids[0]: "a", qids[1]: "b"})

    def test_a_live_sitting_defers_version_creation(self):
        exam = _legacy(forms=1, n=3)
        mt = upsert_midterm_from_legacy(exam)
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()  # the room is now occupied

        _add_form(exam, n=3)
        mt = upsert_midterm_from_legacy(exam)
        # Versioning a live room would hand the next student to press Start a different
        # paper from the person already writing.
        self.assertEqual(mt.versions.count(), 0)
        self.assertEqual(mt.questions().count(), 3)

        att.submit_final()
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 2)  # created once the room empties

    def test_an_already_versioned_midterm_is_fed_even_mid_sitting(self):
        # The deferral must not starve a midterm that is ALREADY versioned: its attempts
        # resolve through their pinned version, so cutting the feed freezes their content.
        exam = _legacy(forms=2, n=3)
        mt = upsert_midterm_from_legacy(exam)
        version = mt.versions.order_by("version_number").first()
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()

        Question.objects.filter(
            module__practice_test=exam.tests.order_by("id").first()
        ).update(question_text="EDITED MID-SITTING")
        upsert_midterm_from_legacy(exam)

        version.refresh_from_db()
        self.assertEqual(version.questions().count(), 3)
        self.assertTrue(all(q.question_text == "EDITED MID-SITTING" for q in version.questions()))

    def test_removing_a_form_does_not_cascade_a_live_versions_questions(self):
        # "Remove" in the builder deletes the PracticeTest; the mirror then finds a version
        # whose form is gone. That tail used to be a bare delete() — a two-click path to
        # destroying the answers of whoever was sitting that form.
        exam = _legacy(forms=2, n=3)
        mt = upsert_midterm_from_legacy(exam)
        version = mt.versions.order_by("version_number").last()
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()
        qids = [str(q.id) for q in att.effective_questions()]
        att.autosave(answers={qids[0]: "a"})

        exam.tests.order_by("id").last().delete()
        upsert_midterm_from_legacy(exam)

        version.refresh_from_db()
        att.refresh_from_db()
        self.assertEqual(att.version_id, version.id)
        self.assertEqual(version.questions().count(), 3)
        self.assertEqual({str(q.id) for q in att.effective_questions()}, set(qids))
        self.assertEqual(att.answers, {qids[0]: "a"})

    def test_an_empty_added_form_does_not_become_a_version(self):
        # "Add version" makes an EMPTY PracticeTest and resyncs immediately. Minting a
        # version from it would put a blank paper into the assignable pool of a published
        # midterm and seat a student on nothing.
        exam = _legacy(forms=1, n=3)
        upsert_midterm_from_legacy(exam)
        PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 0)

        # ...and once it has questions, it does.
        _add_form(exam, n=3, reuse_last=True)
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.versions.count(), 2)


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
