"""Classwork: student-visible, manually assignable, and paid ONLY by a teacher's hand.

docs/rewards/OVERHAUL.md §7. Two things are under test here and they are different kinds of
claim:

1. **Nothing automatic ever pays a CLASSWORK carrier.** This was a live production bug: the
   carrier is a PUBLISHED ``classes.Assignment`` minted by ``journals.delivery``, and
   ``recompute_bundle`` had no category filter, so every assessment a teacher opened in class
   quietly paid homework points nobody decided to give. The regression test drives the REAL
   grading path with ``captureOnCommitCallbacks`` — the reward hook defers to
   ``transaction.on_commit``, so without that wrapper this file would assert nothing at all.

2. **Who may mint points.** The gate is ``can_manage_class`` (Owner + Teacher), deliberately
   NOT ``can_manage_assignments``/``can_grade``, which include TAs. Classwork points are
   *minted* rather than derived from work a student did, so a TA who can mint is a hole in the
   ledger, not a convenience.

Assertions are on ``PointAward`` rows throughout, never on a response code alone:
``services.award`` swallows every exception and logs, so a broken award path returns a
perfectly cheerful 200.
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
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
from journals import delivery, services
from journals.models import Journal
from rewards.constants import EVENT_CLASSWORK_MANUAL, EVENT_HOMEWORK, classwork_key
from rewards.models import PointAward, PointAwardAudit

User = get_user_model()
M = ClassroomMembership


class ClassworkFixture(TestCase):
    """One classroom bound to a published journal, with the full role cast on the roster."""

    def setUp(self):
        def u(email, role=acc_const.ROLE_TEACHER, **kw):
            return User.objects.create_user(email, "secret123", role=role, **kw)

        self.admin = u("cw_admin@t.com", acc_const.ROLE_SUPER_ADMIN)
        self.teacher = u("cw_teacher@t.com", acc_const.ROLE_TEACHER, subject="math")
        self.ta = u("cw_ta@t.com", acc_const.ROLE_TEACHER, subject="math")
        self.student = u("cw_student@t.com", acc_const.ROLE_STUDENT)
        self.outsider = u("cw_outsider@t.com", acc_const.ROLE_STUDENT)

        self.classroom = Classroom.objects.create(
            name="Math Middle A",
            subject=Classroom.SUBJECT_MATH,
            level=Classroom.LEVEL_MIDDLE,
            lesson_days=Classroom.DAYS_ODD,
            lesson_time="18:00",
            created_by=self.admin,
        )
        M.objects.create(classroom=self.classroom, user=self.teacher, role=M.ROLE_TEACHER)
        M.objects.create(classroom=self.classroom, user=self.ta, role=M.ROLE_TA)
        M.objects.create(classroom=self.classroom, user=self.student, role=M.ROLE_STUDENT)

        self.journal, _ = services.create_journal(
            subject="MATH", level="middle", actor=self.admin
        )
        self.session = services.add_session(self.journal, actor=self.admin)
        self.session.title = "Ch.3"
        self.session.instructions = "Do exercises 1-20"
        self.session.save()
        cw = services.ensure_classwork(self.session)
        cw.new_topic_title = "Linear equations"
        cw.new_topic_instructions = "Slope-intercept form"
        cw.save()
        self.journal.status = Journal.STATUS_PUBLISHED
        self.journal.save(update_fields=["status"])

        self.client = APIClient()

    # ── helpers ───────────────────────────────────────────────────────────────

    def as_(self, who):
        self.client.force_authenticate(who)
        return self.client

    @property
    def classwork_url(self):
        return f"/api/classes/{self.classroom.id}/lessons/{self.session.id}/classwork/"

    @property
    def award_url(self):
        return f"{self.classwork_url}award/"

    def carriers(self):
        return Assignment.objects.filter(
            classroom=self.classroom, category=Assignment.CATEGORY_CLASSWORK
        )

    def classwork_awards(self):
        return PointAward.objects.filter(event=EVENT_CLASSWORK_MANUAL)


class NothingAutomaticPaysClassworkTests(ClassworkFixture):
    """The load-bearing one. An assessment opened in class earns NOTHING by itself."""

    def _assessment(self, title):
        aset = AssessmentSet.objects.create(
            title=title, subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        for i in range(4):
            AssessmentQuestion.objects.create(
                assessment_set=aset, order=i, prompt=f"Q{i}",
                question_type=AssessmentQuestion.TYPE_MULTIPLE_CHOICE,
                choices=[{"id": "A", "text": "a"}, {"id": "B", "text": "b"}],
                correct_answer="A", points=1,
            )
        return aset

    def _sit_perfectly(self, homework):
        """Submit and grade one assessment through the real ``grade_attempt``.

        Wrapped in ``captureOnCommitCallbacks`` deliberately: the reward hook defers its
        recompute to ``transaction.on_commit``, which Django's ``TestCase`` never runs. A
        reward test without this wrapper passes no matter what the source does.
        """
        from assessments.grading_service import grade_attempt

        questions = list(homework.assessment_set.questions.order_by("order"))
        attempt = AssessmentAttempt.objects.create(
            homework=homework, student=self.student,
            status=AssessmentAttempt.STATUS_SUBMITTED,
            submitted_at=timezone.now(),
            question_order=[q.id for q in questions],
        )
        for q in questions:
            AssessmentAnswer.objects.create(attempt=attempt, question=q, answer="A")
        with self.captureOnCommitCallbacks(execute=True):
            grade_attempt(attempt_id=attempt.pk)
        return attempt

    def test_a_perfect_assessment_on_a_classwork_carrier_pays_nothing(self):
        aset = self._assessment("In-class quiz")
        cw = services.ensure_classwork(self.session)
        cw.assessments.create(assessment_set=aset, block="EXERCISES", added_by=self.admin)
        delivery.grant_resource(
            self.classroom, self.session,
            block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
            actor=self.teacher,
        )
        homework = HomeworkAssignment.objects.get(
            classroom=self.classroom, assessment_set=aset
        )
        carrier = Assignment.objects.get(pk=homework.assignment_id)
        # The preconditions that make this a real regression test rather than a tautology:
        # the carrier is PUBLISHED and reachable by the homework hook, it just must not pay.
        self.assertEqual(carrier.category, Assignment.CATEGORY_CLASSWORK)
        self.assertEqual(carrier.status, Assignment.STATUS_PUBLISHED)
        self.assertIsNone(carrier.due_at)

        self._sit_perfectly(homework)

        # The bundle really is scoreable and really is at 100%: only the category gate is
        # stopping it. Without this line the test would still pass if the assessment had
        # simply failed to attach, which is the wrong reason to be green.
        from rewards.homework import bundle_percent

        self.assertAlmostEqual(bundle_percent(carrier, self.student), 100.0)
        self.assertEqual(
            PointAward.objects.filter(student=self.student).count(), 0,
            "in-class work must earn nothing until a teacher decides what it was worth",
        )

    def test_a_deadline_on_the_carrier_still_cannot_make_it_pay(self):
        """Defence in depth for §7's "no due_at, ever".

        The null deadline keeps the carrier out of ``settle_due_homework``'s SQL, but the
        thing that must hold is the category gate: if a data fix, an admin edit or a future
        caller ever puts a ``due_at`` on a carrier, in-class work must still earn nothing.
        """
        from rewards.tasks import settle_due_homework

        aset = self._assessment("In-class quiz")
        cw = services.ensure_classwork(self.session)
        cw.assessments.create(assessment_set=aset, block="EXERCISES", added_by=self.admin)
        delivery.grant_resource(
            self.classroom, self.session,
            block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
            actor=self.teacher,
        )
        homework = HomeworkAssignment.objects.get(
            classroom=self.classroom, assessment_set=aset
        )
        self._sit_perfectly(homework)

        carrier = Assignment.objects.get(pk=homework.assignment_id)
        carrier.due_at = timezone.now() - timezone.timedelta(hours=1)
        carrier.save(update_fields=["due_at"])
        stats = settle_due_homework()

        # The sweep really did reach this carrier — it is PUBLISHED and its deadline is now
        # inside the lookback window — and still paid nothing. Asserting the walk happened is
        # what stops this passing for the trivial reason that the sweep selected no rows.
        self.assertEqual(stats["assignments"], 1)
        self.assertEqual(stats["students"], 1)
        self.assertEqual(PointAward.objects.filter(student=self.student).count(), 0)

    def test_a_vocabulary_set_opened_in_class_pays_nothing_either(self):
        """The assessment test above does NOT cover this.

        Vocabulary reaches the ledger through its own signal
        (``rewards.hooks._on_vocab_session_saved`` → ``VocabHomework`` → ``_recompute``), not
        through the assessment one, and §4 rewrote how a vocab set is scored from top to
        bottom. A category gate that held for one hook and not the other would leak in-class
        vocabulary — and it is the kind an in-class grant creates most often.
        """
        from vocabulary.models import (
            VocabSection,
            VocabSet,
            VocabSetItem,
            VocabStudySession,
            VocabWord,
        )

        section = VocabSection.objects.create(title="Bank", slug="bank")
        vset = VocabSet.objects.create(section=section, title="Unit 3")
        word_ids = []
        for i in range(4):
            word = VocabWord.objects.create(
                section=section, word=f"w{i}", definition="d"
            )
            VocabSetItem.objects.create(vocab_set=vset, word=word, order=i)
            word_ids.append(word.id)

        cw = services.ensure_classwork(self.session)
        cw.exercise_vocabulary_set_ids = [vset.id]
        cw.save(update_fields=["exercise_vocabulary_set_ids"])
        delivery.grant_resource(
            self.classroom, self.session,
            block="EXERCISES", resource_type="vocabulary_set", resource_id=vset.id,
            actor=self.teacher,
        )
        link = vset.homework_links.get()
        carrier = link.assignment
        self.assertEqual(carrier.category, Assignment.CATEGORY_CLASSWORK)

        # Play all four modes perfectly, every word reached — 100% under §4's
        # accuracy × coverage rule, so nothing about the *score* excuses paying nothing.
        for mode, _label in VocabStudySession.MODE_CHOICES:
            session = VocabStudySession(
                user=self.student, vocab_set=vset, mode=mode, homework=link,
                total_count=len(word_ids), correct_count=len(word_ids),
                accuracy=100.0, completed_at=timezone.now(),
            )
            session.record_distinct_words(word_ids)
            with self.captureOnCommitCallbacks(execute=True):
                session.save()

        from rewards.homework import bundle_percent

        self.assertAlmostEqual(bundle_percent(carrier, self.student), 100.0)
        self.assertEqual(
            PointAward.objects.filter(student=self.student).count(), 0,
            "vocabulary opened in class must earn nothing until a teacher decides",
        )

    def test_the_same_bundle_on_a_homework_carrier_does_pay(self):
        """The control. Without it, the test above would still pass if the hook were dead."""
        aset = self._assessment("Homework quiz")
        assignment = Assignment.objects.create(
            classroom=self.classroom, title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        homework = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=assignment, assigned_by=self.teacher,
        )

        self._sit_perfectly(homework)

        award = PointAward.objects.get(student=self.student)
        self.assertEqual(award.points, 15)
        # Pinned to the NEW proportional event, not just to the amount: the retired
        # HOMEWORK_FULL band is still priced at 15 (constants.py), so `points == 15` alone
        # would read exactly the same if this path had never left the banded world.
        self.assertEqual(award.event, EVENT_HOMEWORK)

    def test_one_lessons_homework_and_its_classwork_are_two_separate_carriers(self):
        """The lesson has two carriers and they must never be merged into one.

        The homework carrier has a ``due_at`` and settles automatically; the classwork one
        has none and never settles. A refactor that reused a single Assignment for both — the
        obvious tidy-up, since both hang off the same ``ClassroomLesson`` — would hand the
        classwork carrier a deadline and switch automatic scoring back on for in-class work,
        which is precisely the bug §7 exists to close. Nothing else in this file would notice.
        """
        # release_homework refuses a brief with nothing in it, so give the homework side
        # some content of its own. The classwork block is authored separately (setUp).
        self.session.allow_file_upload = True
        self.session.save(update_fields=["allow_file_upload"])

        row, created, _warnings = delivery.release_homework(
            self.classroom, self.session, actor=self.teacher
        )
        classwork, _ = delivery.assign_classwork(
            self.classroom, self.session, actor=self.teacher
        )
        self.assertTrue(created)
        self.assertNotEqual(row.assignment_id, classwork.id)

        homework_carrier = Assignment.objects.get(pk=row.assignment_id)
        self.assertEqual(homework_carrier.category, Assignment.CATEGORY_HOMEWORK)
        self.assertIsNotNone(homework_carrier.due_at)
        self.assertEqual(classwork.category, Assignment.CATEGORY_CLASSWORK)
        self.assertIsNone(classwork.due_at)

    def test_switching_a_paid_homework_to_classwork_stops_it_settling_again(self):
        """The hourly sweep re-runs ``recompute_bundle`` for days after the due date. A
        carrier re-categorised as classwork must simply stop settling — and must not have its
        banked points confiscated either, which returning (rather than revoking) is what buys.
        """
        from rewards.homework import recompute_bundle

        aset = self._assessment("Quiz")
        assignment = Assignment.objects.create(
            classroom=self.classroom, title="Week 1",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            created_by=self.teacher,
        )
        homework = HomeworkAssignment.objects.create(
            classroom=self.classroom, assessment_set=aset,
            assignment=assignment, assigned_by=self.teacher,
        )
        self._sit_perfectly(homework)
        self.assertEqual(PointAward.objects.get(student=self.student).points, 15)

        assignment.category = Assignment.CATEGORY_CLASSWORK
        assignment.save(update_fields=["category"])
        self.assertIsNone(recompute_bundle(assignment, self.student))

        award = PointAward.objects.get(student=self.student)
        self.assertEqual(award.points, 15)


class AssignClassworkEndpointTests(ClassworkFixture):
    def test_teacher_hands_classwork_out(self):
        resp = self.as_(self.teacher).post(self.classwork_url)
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertTrue(body["created"])
        self.assertTrue(body["given"])

        carrier = self.carriers().get()
        self.assertEqual(body["assignment_id"], carrier.id)
        self.assertEqual(carrier.title, "Linear equations")
        self.assertEqual(carrier.status, Assignment.STATUS_PUBLISHED)
        self.assertIsNone(carrier.due_at)

    def test_handing_it_out_twice_makes_one_carrier(self):
        self.as_(self.teacher).post(self.classwork_url)
        resp = self.as_(self.teacher).post(self.classwork_url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()["created"])
        self.assertEqual(self.carriers().count(), 1)

    def test_a_ta_cannot_hand_classwork_out(self):
        """Handing it out is the first half of minting points — the award endpoint creates
        the carrier on the way through — so it carries the same Owner+Teacher gate."""
        resp = self.as_(self.ta).post(self.classwork_url)
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(self.carriers().count(), 0)

    def test_a_student_cannot_hand_classwork_out(self):
        resp = self.as_(self.student).post(self.classwork_url)
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(self.carriers().count(), 0)

    def test_a_non_member_teacher_is_locked_out_entirely(self):
        stranger = User.objects.create_user(
            "cw_stranger@t.com", "secret123", role=acc_const.ROLE_TEACHER, subject="math"
        )
        resp = self.as_(stranger).post(self.classwork_url)
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(self.carriers().count(), 0)

    def test_a_ta_may_still_look_at_the_panel(self):
        """The boundary is on minting points, not on seeing the lesson: a TA runs the room."""
        self.as_(self.teacher).post(self.classwork_url)
        resp = self.as_(self.ta).get(self.classwork_url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertTrue(resp.json()["given"])

    def test_the_panel_reports_an_ungiven_lesson_honestly(self):
        resp = self.as_(self.teacher).get(self.classwork_url)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertFalse(body["given"])
        self.assertIsNone(body["assignment_id"])
        self.assertEqual(body["awards"], [])
        # Sent on both branches so the points field can be bounded before anything is given.
        self.assertGreater(body["max_points"], 0)


class AwardClassworkEndpointTests(ClassworkFixture):
    def _award(self, who, points, **extra):
        return self.as_(who).post(
            self.award_url,
            {"student_id": self.student.id, "points": points, **extra},
            format="json",
        )

    def test_a_teacher_awards_and_the_ledger_shows_it(self):
        resp = self._award(self.teacher, 7, note="led the group")
        self.assertEqual(resp.status_code, 200, resp.content)

        award = self.classwork_awards().get()
        self.assertEqual(award.student_id, self.student.id)
        self.assertEqual(award.points, 7)
        # XP follows points everywhere now (§8) — XP_EXCLUDED_EVENTS is empty.
        self.assertEqual(award.xp, 7)
        self.assertEqual(award.classroom_id, self.classroom.id)
        self.assertEqual(award.note, "led the group")
        self.assertEqual(resp.json()["points"], 7)

    def test_awarding_hands_the_classwork_out_on_the_way_through(self):
        """A teacher mid-lesson must not have to press two buttons in the right order."""
        self.assertEqual(self.carriers().count(), 0)
        resp = self._award(self.teacher, 4)
        self.assertEqual(resp.status_code, 200, resp.content)

        carrier = self.carriers().get()
        award = self.classwork_awards().get()
        self.assertEqual(award.source_type, "assignment")
        self.assertEqual(award.source_id, carrier.id)
        self.assertEqual(award.idempotency_key, classwork_key(carrier.id, self.student.id))

    def test_a_ta_cannot_mint_classwork_points(self):
        """The critical one. ``can_grade``/``can_manage_assignments`` include TAs, and these
        points are created out of nothing rather than derived from a student's work."""
        resp = self._award(self.ta, 50)
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)
        self.assertEqual(self.carriers().count(), 0)

    def test_a_student_cannot_award_themselves(self):
        resp = self.as_(self.student).post(
            self.award_url,
            {"student_id": self.student.id, "points": 50},
            format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_global_admin_may_award(self):
        resp = self._award(self.admin, 6)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.classwork_awards().get().points, 6)

    def test_re_awarding_corrects_the_amount_instead_of_stacking_a_row(self):
        self.assertEqual(self._award(self.teacher, 3).status_code, 200)
        self.assertEqual(self._award(self.teacher, 5).status_code, 200)

        self.assertEqual(self.classwork_awards().count(), 1)
        award = self.classwork_awards().get()
        self.assertEqual(award.points, 5)

    def test_a_correction_is_audited_with_the_actor_who_made_it(self):
        self._award(self.teacher, 3)
        self._award(self.admin, 5)

        award = self.classwork_awards().get()
        events = list(PointAwardAudit.objects.filter(award=award).order_by("id"))
        self.assertEqual(len(events), 2)
        self.assertIsNone(events[0].previous_points)
        self.assertEqual(events[0].new_points, 3)
        self.assertEqual(events[0].actor_id, self.teacher.id)
        self.assertEqual(events[1].previous_points, 3)
        self.assertEqual(events[1].new_points, 5)
        self.assertEqual(events[1].actor_id, self.admin.id)

    def test_a_correction_downwards_moves_points_and_leaves_xp_standing(self):
        """§6: XP is never taken away for doing WORSE. Only a withdrawn fact clears it."""
        self._award(self.teacher, 9)
        self._award(self.teacher, 2)

        award = self.classwork_awards().get()
        self.assertEqual(award.points, 2)
        self.assertEqual(award.xp, 9)

    def test_zero_is_recorded_rather_than_refused(self):
        resp = self._award(self.teacher, 0)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self.classwork_awards().get().points, 0)

    def test_negative_points_are_refused(self):
        resp = self._award(self.teacher, -5)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_an_absurd_amount_is_refused(self):
        from classes.views_lessons import MAX_CLASSWORK_POINTS

        resp = self._award(self.teacher, MAX_CLASSWORK_POINTS + 1)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_missing_points_are_refused_rather_than_defaulted(self):
        resp = self.as_(self.teacher).post(
            self.award_url, {"student_id": self.student.id}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_student_from_another_class_cannot_be_paid_from_here(self):
        """The student id is resolved through THIS classroom's roster: a bare user lookup
        would let a teacher mint points for somebody else's class."""
        resp = self.as_(self.teacher).post(
            self.award_url,
            {"student_id": self.outsider.id, "points": 5},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "not_on_roster")
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_removed_student_cannot_be_paid(self):
        M.objects.filter(classroom=self.classroom, user=self.student).update(
            status=M.STATUS_REMOVED
        )
        resp = self._award(self.teacher, 5)
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_a_teacher_cannot_pay_a_teacher(self):
        resp = self.as_(self.teacher).post(
            self.award_url,
            {"student_id": self.ta.id, "points": 5},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_the_panel_reads_back_what_was_awarded(self):
        self._award(self.teacher, 8, note="explained it to the class")
        resp = self.as_(self.teacher).get(self.classwork_url)
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.json()["awards"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["student_id"], self.student.id)
        self.assertEqual(rows[0]["points"], 8)
        self.assertEqual(rows[0]["note"], "explained it to the class")

    def test_the_student_sees_their_own_classwork_award(self):
        """Classwork has no percentage and no attempt behind it, so the award IS the whole
        of the student's outcome for the lesson."""
        self._award(self.teacher, 8)
        carrier = self.carriers().get()
        resp = self.as_(self.student).get(
            f"/api/classes/{self.classroom.id}/assignments/{carrier.id}/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["classwork_award"]["points"], 8)

    def test_a_students_classwork_award_is_their_own(self):
        """The award is keyed on (carrier, student); a classmate's payment must not show up
        as the viewer's own."""
        classmate = User.objects.create_user(
            "cw_classmate@t.com", "secret123", role=acc_const.ROLE_STUDENT
        )
        M.objects.create(classroom=self.classroom, user=classmate, role=M.ROLE_STUDENT)
        self._award(self.teacher, 8)
        carrier = self.carriers().get()

        resp = self.as_(classmate).get(
            f"/api/classes/{self.classroom.id}/assignments/{carrier.id}/"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsNone(resp.json()["classwork_award"])

    def test_the_classwork_carrier_reaches_the_students_assignment_list(self):
        """§7: classwork became student-visible. A carrier the class cannot see is the whole
        feature missing, and nothing else in this file would notice."""
        self._award(self.teacher, 8)
        carrier = self.carriers().get()

        resp = self.as_(self.student).get(f"/api/classes/{self.classroom.id}/assignments/")
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertIn(carrier.id, [row["id"] for row in rows])


class WithdrawClassworkEndpointTests(ClassworkFixture):
    """``DELETE`` on the award endpoint — the teacher's undo for a mis-typed award.

    Separate from the POST because the two corrections are different facts with different XP
    consequences (OVERHAUL §6), and the whole reason this endpoint exists is that the POST
    cannot express the second one: ``points=0`` is a smaller fact and banks its XP forever.
    """

    def _award(self, who, points, **extra):
        return self.as_(who).post(
            self.award_url,
            {"student_id": self.student.id, "points": points, **extra},
            format="json",
        )

    def _withdraw(self, who, **extra):
        return self.as_(who).delete(
            self.award_url, {"student_id": self.student.id, **extra}, format="json"
        )

    def _row(self):
        return PointAward.objects.get(event=EVENT_CLASSWORK_MANUAL, student=self.student)

    def test_the_typed_amount_can_actually_be_taken_back(self):
        """The defect in one test: 50 typed for 5, corrected the only way the POST allows,
        then withdrawn. The middle assertion is what makes the last one necessary."""
        self._award(self.teacher, 50)
        self._award(self.teacher, 0)
        self.assertEqual((self._row().points, self._row().xp), (0, 50))

        resp = self._withdraw(self.teacher, reason="typed 50 for 5")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((self._row().points, self._row().xp), (0, 0))

    def test_a_withdrawal_keeps_the_row_rather_than_deleting_it(self):
        """Zeroed, not removed. A deleted row would make the student's history disagree with
        their balance, and the panel would read it as "never marked"."""
        self._award(self.teacher, 9)
        self._withdraw(self.teacher)

        self.assertEqual(self.classwork_awards().count(), 1)
        self.assertEqual(self._row().idempotency_key, classwork_key(
            self.carriers().get().id, self.student.id
        ))

    def test_the_withdrawal_is_audited_with_the_teacher_who_pressed_it(self):
        self._award(self.teacher, 9)
        self._withdraw(self.admin, reason="wrong student")

        events = list(PointAwardAudit.objects.filter(award=self._row()).order_by("id"))
        self.assertEqual(len(events), 2)
        self.assertEqual((events[1].previous_points, events[1].new_points), (9, 0))
        self.assertEqual((events[1].previous_xp, events[1].new_xp), (9, 0))
        self.assertEqual(events[1].actor_id, self.admin.id)

    def test_a_ta_cannot_withdraw_points_either(self):
        """Taking points off is as much a ledger write as putting them on, so it carries the
        same Owner+Teacher gate — ``can_manage_assignments``/``can_grade`` include TAs."""
        self._award(self.teacher, 9)
        resp = self._withdraw(self.ta)
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual((self._row().points, self._row().xp), (9, 9))

    def test_a_student_cannot_withdraw_a_classmates_award(self):
        self._award(self.teacher, 9)
        resp = self.as_(self.student).delete(
            self.award_url, {"student_id": self.student.id}, format="json"
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertEqual(self._row().points, 9)

    def test_the_student_id_may_come_from_the_query_string(self):
        """A DELETE body is legal but not universally sent; a client that drops it must still
        be able to name the student."""
        self._award(self.teacher, 9)
        resp = self.as_(self.teacher).delete(
            f"{self.award_url}?student_id={self.student.id}"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((self._row().points, self._row().xp), (0, 0))

    def test_a_student_from_another_class_cannot_be_targeted(self):
        resp = self.as_(self.teacher).delete(
            self.award_url, {"student_id": self.outsider.id}, format="json"
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertEqual(resp.json()["code"], "not_on_roster")

    def test_withdrawing_when_nothing_was_awarded_hands_nothing_out(self):
        """The POST mints the carrier on the way through — paying for work implies the class
        did it. A withdrawal implies nothing, so it must not create one."""
        resp = self._withdraw(self.teacher)
        self.assertEqual(resp.status_code, 404, resp.content)
        self.assertEqual(resp.json()["code"], "no_award")
        self.assertEqual(self.carriers().count(), 0)
        self.assertEqual(PointAward.objects.count(), 0)

    def test_withdrawing_twice_is_still_a_success(self):
        self._award(self.teacher, 9)
        self.assertEqual(self._withdraw(self.teacher).status_code, 200)
        resp = self._withdraw(self.teacher)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual((self._row().points, self._row().xp), (0, 0))

    def test_the_teacher_can_award_the_right_amount_afterwards(self):
        """The recovery a teacher actually performs: withdraw the mistake, then pay properly.
        The XP has to follow the new figure, not the withdrawn one."""
        self._award(self.teacher, 50)
        self._withdraw(self.teacher)
        self.assertEqual(self._award(self.teacher, 5).status_code, 200)
        self.assertEqual((self._row().points, self._row().xp), (5, 5))

    def test_the_panel_shows_the_withdrawal(self):
        self._award(self.teacher, 9)
        self._withdraw(self.teacher)

        resp = self.as_(self.teacher).get(self.classwork_url)
        self.assertEqual(resp.status_code, 200, resp.content)
        rows = resp.json()["awards"]
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["points"], rows[0]["xp"]), (0, 0))
