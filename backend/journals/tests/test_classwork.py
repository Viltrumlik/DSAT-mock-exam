"""Classwork delivery: visible, assignable, deadline-less, manual-only.

The rules under test are docs/rewards/OVERHAUL.md §7, and every one of them is a decision
rather than an implementation detail:

* the carrier is a PUBLISHED ``classes.Assignment`` categorised CLASSWORK with **no**
  ``due_at`` — a deadline would silently enrol it in ``settle_due_homework`` and switch
  automatic homework scoring back on;
* there is exactly **one** carrier per lesson, shared by the explicit hand-out and by every
  in-class item grant — which is what makes ``classwork:<assignment>:<student>`` a usable
  idempotency key;
* the carrier now carries the whole authored new-topic block, not just its instructions,
  because classwork became student-visible and a page holding one text field showed the
  class none of the material the lesson was built from;
* nothing automatic ever pays it.

The endpoint-level tests for the same feature live in ``classes/tests_classwork.py``; this
file is the service layer (``journals.delivery``).
"""

from __future__ import annotations

from classes.models import Assignment
from journals import delivery, services
from rewards.constants import EVENT_CLASSWORK_MANUAL, classwork_key
from rewards.models import PointAward, PointAwardAudit

from .test_delivery import DeliveryTestBase


class AssignClassworkTests(DeliveryTestBase):
    def _authored_session(self):
        """A session whose classwork block has every authored field filled in."""
        session = self._session()
        cw = services.ensure_classwork(session)
        cw.new_topic_title = "Linear equations"
        cw.new_topic_instructions = "Slope-intercept form"
        cw.new_topic_external_url = "https://example.com/notes"
        cw.new_topic_external_urls = [
            "https://example.com/notes",
            "https://example.com/slides",
        ]
        cw.new_topic_video_url = "https://youtu.be/abc123"
        cw.save()
        self._publish()
        return session

    def test_classwork_is_handed_out_as_a_published_assignment(self):
        session = self._authored_session()
        assignment, created = delivery.assign_classwork(
            self.classroom, session, actor=self.teacher
        )
        self.assertTrue(created)
        self.assertEqual(assignment.classroom_id, self.classroom.id)
        self.assertEqual(assignment.category, Assignment.CATEGORY_CLASSWORK)
        self.assertEqual(assignment.status, Assignment.STATUS_PUBLISHED)
        # Student-facing lists sort and label by Coalesce(published_at, created_at); a null
        # published_at made "when was this given" quietly mean "when was the row made".
        self.assertIsNotNone(assignment.published_at)

    def test_the_carrier_never_has_a_deadline(self):
        """§7's hard constraint. A ``due_at`` enrols the carrier in ``settle_due_homework``
        and switches automatic scoring back on — classwork is paid by hand, only."""
        session = self._authored_session()
        assignment, _ = delivery.assign_classwork(self.classroom, session, actor=self.teacher)
        self.assertIsNone(assignment.due_at)

    def test_the_whole_authored_block_reaches_the_student_not_just_instructions(self):
        """Classwork is student-visible now. The carrier used to drop every authored field
        except ``instructions``, so the class got a page with none of the lesson material."""
        session = self._authored_session()
        assignment, _ = delivery.assign_classwork(self.classroom, session, actor=self.teacher)

        self.assertEqual(assignment.title, "Linear equations")
        self.assertEqual(assignment.instructions, "Slope-intercept form")
        self.assertEqual(assignment.external_url, "https://example.com/notes")
        self.assertEqual(
            list(assignment.external_urls),
            ["https://example.com/notes", "https://example.com/slides"],
        )
        self.assertEqual(assignment.video_url, "https://youtu.be/abc123")

    def test_an_unnamed_topic_falls_back_to_the_lesson_label(self):
        session = self._session()
        cw = services.ensure_classwork(session)
        cw.new_topic_title = ""
        cw.save(update_fields=["new_topic_title"])
        self._publish()
        assignment, _ = delivery.assign_classwork(self.classroom, session, actor=self.teacher)
        self.assertIn("classwork", assignment.title)

    def test_handing_it_out_twice_is_idempotent(self):
        session = self._authored_session()
        first, created_first = delivery.assign_classwork(
            self.classroom, session, actor=self.teacher
        )
        second, created_second = delivery.assign_classwork(
            self.classroom, session, actor=self.teacher
        )
        self.assertTrue(created_first)
        self.assertFalse(created_second)
        self.assertEqual(first.id, second.id)
        self.assertEqual(
            Assignment.objects.filter(
                classroom=self.classroom, category=Assignment.CATEGORY_CLASSWORK
            ).count(),
            1,
        )

    def test_the_hand_out_and_an_item_grant_share_one_carrier(self):
        """One Assignment per lesson, whichever action minted it.

        This is what ``classwork_key(assignment_id, student_id)`` rests on: there is no
        per-item row to key a manual award on, so two carriers for one lesson would let the
        same lesson be paid twice.
        """
        from assessments.models import AssessmentSet

        session = self._session()
        aset = AssessmentSet.objects.create(
            title="Quiz", subject="math", level="middle", created_by=self.admin,
            review_status=AssessmentSet.STATUS_APPROVED,
        )
        self._attach_assessment(session, aset)
        self._publish()

        handed_out, _ = delivery.assign_classwork(self.classroom, session, actor=self.teacher)
        delivery.grant_resource(
            self.classroom, session,
            block="EXERCISES", resource_type="assessment_set", resource_id=aset.id,
            actor=self.teacher,
        )
        self.assertEqual(
            Assignment.objects.filter(
                classroom=self.classroom, category=Assignment.CATEGORY_CLASSWORK
            ).count(),
            1,
        )
        self.assertEqual(
            delivery.classwork_assignment_for(self.classroom, session).id, handed_out.id
        )

    def test_a_lesson_with_no_classwork_plan_is_a_clean_error(self):
        """``add_session`` gives every HOMEWORK session a classwork block, so this is the
        legacy row written before that was true — it must be a 400, not a 500."""
        session = self._session()
        session.classwork.delete()
        session.refresh_from_db()
        self._publish()
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.assign_classwork(self.classroom, session, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "no_classwork")

    def test_a_midterm_session_has_no_classwork_to_give_out(self):
        self._publish()
        session = services.add_session(self.journal, actor=self.admin, lesson_type="MIDTERM")
        with self.assertRaises(delivery.DeliveryError) as ctx:
            delivery.assign_classwork(self.classroom, session, actor=self.teacher)
        self.assertEqual(ctx.exception.code, "midterm_session")

    def test_reading_the_carrier_never_creates_one(self):
        session = self._authored_session()
        self.assertIsNone(delivery.classwork_assignment_for(self.classroom, session))
        self.assertEqual(
            Assignment.objects.filter(
                classroom=self.classroom, category=Assignment.CATEGORY_CLASSWORK
            ).count(),
            0,
        )


class ClassworkPointsTests(DeliveryTestBase):
    """``delivery.award_classwork`` — the only thing that ever pays classwork."""

    def setUp(self):
        super().setUp()
        session = self._session()
        self._publish()
        self.assignment, _ = delivery.assign_classwork(
            self.classroom, session, actor=self.teacher
        )

    def _award(self, points, *, note="", actor=None):
        return delivery.award_classwork(
            self.assignment, self.student, points=points,
            actor=actor or self.teacher, note=note,
        )

    def test_a_teacher_award_lands_in_the_ledger(self):
        awarded = self._award(7, note="led the group")
        self.assertIsNotNone(awarded)
        self.assertEqual(awarded.event, EVENT_CLASSWORK_MANUAL)
        self.assertEqual(awarded.points, 7)
        self.assertEqual(awarded.classroom_id, self.classroom.id)
        self.assertEqual(awarded.source_type, "assignment")
        self.assertEqual(awarded.source_id, self.assignment.id)
        self.assertEqual(
            awarded.idempotency_key, classwork_key(self.assignment.id, self.student.id)
        )
        # XP follows points everywhere now (§8): XP_EXCLUDED_EVENTS is empty and
        # CLASSWORK_MANUAL is deliberately unseeded, so it falls back to grants_xp=True.
        self.assertEqual(awarded.xp, 7)

    def test_re_awarding_corrects_the_amount_instead_of_stacking(self):
        """One award per (carrier, student). The carrier is one Assignment per lesson shared
        by every granted item, so a second row would be a second earning for one lesson."""
        self._award(3)
        self._award(5)

        rows = PointAward.objects.filter(
            student=self.student, event=EVENT_CLASSWORK_MANUAL
        )
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().points, 5)

    def test_a_correction_downwards_moves_the_points_and_leaves_the_xp(self):
        """§6's refined rule, at the service layer: XP is never taken away for doing WORSE.
        Only a WITHDRAWN fact (``revoke``) clears XP, and a teacher revising an amount is a
        smaller fact, not a withdrawn one."""
        self._award(9)
        corrected = self._award(2)
        self.assertEqual(corrected.points, 2)
        self.assertEqual(corrected.xp, 9)

    def test_zero_is_a_real_award_not_a_missing_one(self):
        """"Looked at, earned nothing this time" has to be distinguishable from "not marked
        yet" — the panel and the student page both read the row's absence as the latter."""
        awarded = self._award(0)
        self.assertIsNotNone(awarded)
        self.assertEqual(awarded.points, 0)
        self.assertTrue(
            PointAward.objects.filter(
                idempotency_key=classwork_key(self.assignment.id, self.student.id)
            ).exists()
        )

    def test_the_audit_trail_names_the_teacher_who_awarded(self):
        self._award(3)
        self._award(5)

        award_row = PointAward.objects.get(
            idempotency_key=classwork_key(self.assignment.id, self.student.id)
        )
        events = list(
            PointAwardAudit.objects.filter(award=award_row).order_by("id")
        )
        self.assertEqual(len(events), 2)
        self.assertIsNone(events[0].previous_points)
        self.assertEqual(events[0].new_points, 3)
        self.assertEqual(events[1].previous_points, 3)
        self.assertEqual(events[1].new_points, 5)
        self.assertEqual([e.actor_id for e in events], [self.teacher.id, self.teacher.id])

    def test_the_panel_can_read_back_what_each_student_has(self):
        self._award(4, note="great question")
        rows = delivery.classwork_awards(self.assignment)
        self.assertEqual(set(rows), {self.student.id})
        self.assertEqual(rows[self.student.id]["points"], 4)
        self.assertEqual(rows[self.student.id]["note"], "great question")

    def test_awards_are_scoped_to_one_carrier(self):
        """``classwork_awards`` keys on the carrier, so another lesson's payment must not
        leak into this lesson's panel."""
        other_session = self._session()
        other, _ = delivery.assign_classwork(
            self.classroom, other_session, actor=self.teacher
        )
        self._award(4)
        delivery.award_classwork(other, self.student, points=11, actor=self.teacher)

        self.assertEqual(delivery.classwork_awards(self.assignment)[self.student.id]["points"], 4)
        self.assertEqual(delivery.classwork_awards(other)[self.student.id]["points"], 11)


class WithdrawClassworkTests(DeliveryTestBase):
    """``delivery.withdraw_classwork`` — the only way a mis-typed classwork award comes off.

    CLASSWORK_MANUAL is the one event whose amount a human types by hand, so it is the one
    that gets typed wrong. The correction that already existed — re-awarding a lower number —
    is a *smaller fact* and deliberately keeps its XP (OVERHAUL §6), which means it cannot
    undo a mis-click: the wrong figure stays on the XP board forever. A *withdrawn* fact is a
    different claim and clears both.
    """

    def setUp(self):
        super().setUp()
        session = self._session()
        self._publish()
        self.assignment, _ = delivery.assign_classwork(
            self.classroom, session, actor=self.teacher
        )

    def _key(self):
        return classwork_key(self.assignment.id, self.student.id)

    def _row(self):
        return PointAward.objects.filter(idempotency_key=self._key()).first()

    def test_correcting_down_to_zero_does_not_take_the_xp_back(self):
        """The defect, stated as a test. This is the behaviour the withdrawal path exists
        BECAUSE of — not a bug in ``award``, which is doing exactly what §6 tells it to."""
        delivery.award_classwork(self.assignment, self.student, points=50, actor=self.teacher)
        corrected = delivery.award_classwork(
            self.assignment, self.student, points=0, actor=self.teacher
        )
        self.assertEqual(corrected.points, 0)
        self.assertEqual(corrected.xp, 50)

    def test_withdrawing_zeroes_the_points_and_the_xp(self):
        delivery.award_classwork(self.assignment, self.student, points=50, actor=self.teacher)
        row = delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)

        self.assertIsNotNone(row)
        self.assertEqual(row.points, 0)
        self.assertEqual(row.xp, 0)
        # And on the stored row, not just the returned object.
        self.assertEqual(self._row().xp, 0)

    def test_a_withdrawal_survives_a_correction_that_came_before_it(self):
        """50 → 5 banks 50 XP; withdrawing afterwards must still clear all of it, not the 5.

        The high-water mark is what makes this worth a test of its own: ``previous_xp`` on
        the row is 50 while ``points`` reads 5, so a withdrawal that reasoned from the points
        would leave 45 XP standing.
        """
        delivery.award_classwork(self.assignment, self.student, points=50, actor=self.teacher)
        delivery.award_classwork(self.assignment, self.student, points=5, actor=self.teacher)
        self.assertEqual(self._row().xp, 50)

        delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)
        self.assertEqual(self._row().xp, 0)

    def test_re_awarding_after_a_withdrawal_starts_the_xp_over(self):
        """The whole point: a teacher who typed 50 for 5 can reach a student who has 5 and 5.

        Without the withdrawal the best reachable state was 5 points on 50 XP, and no
        sequence of awards could ever get that 50 back down.
        """
        delivery.award_classwork(self.assignment, self.student, points=50, actor=self.teacher)
        delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)
        fixed = delivery.award_classwork(
            self.assignment, self.student, points=5, actor=self.teacher
        )
        self.assertEqual(fixed.points, 5)
        self.assertEqual(fixed.xp, 5)

    def test_the_withdrawal_is_audited_with_the_teacher_who_made_it(self):
        delivery.award_classwork(self.assignment, self.student, points=8, actor=self.teacher)
        delivery.withdraw_classwork(
            self.assignment, self.student, actor=self.admin, reason="wrong student"
        )

        events = list(PointAwardAudit.objects.filter(award=self._row()).order_by("id"))
        self.assertEqual(len(events), 2)
        self.assertEqual(events[1].previous_points, 8)
        self.assertEqual(events[1].new_points, 0)
        # The XP leaving is recorded rather than left to be inferred — "why did my XP drop?"
        # has to be answerable from the ledger alone.
        self.assertEqual(events[1].previous_xp, 8)
        self.assertEqual(events[1].new_xp, 0)
        self.assertEqual(events[1].actor_id, self.admin.id)
        self.assertIn("wrong student", events[1].reason)

    def test_withdrawing_twice_changes_nothing_the_second_time(self):
        delivery.award_classwork(self.assignment, self.student, points=8, actor=self.teacher)
        delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)
        before = PointAwardAudit.objects.filter(award=self._row()).count()

        row = delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)

        # Still a row, still zeroed — the caller checks the ROW, so a repeat has to come back
        # looking like a success rather than like a failure.
        self.assertEqual((row.points, row.xp), (0, 0))
        self.assertEqual(PointAwardAudit.objects.filter(award=self._row()).count(), before)

    def test_withdrawing_an_award_that_was_never_made_writes_nothing(self):
        """None, deliberately not an award of 0: a zero row reads as "a teacher marked this
        lesson", which is the exact claim a withdrawal retracts."""
        self.assertIsNone(
            delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)
        )
        self.assertFalse(PointAward.objects.filter(idempotency_key=self._key()).exists())

    def test_a_withdrawal_is_scoped_to_one_student(self):
        from django.contrib.auth import get_user_model
        from classes.models import ClassroomMembership

        classmate = get_user_model().objects.create_user(
            email="d_classmate@test.com", password="x", role="student"
        )
        ClassroomMembership.objects.create(
            classroom=self.classroom, user=classmate,
            role=ClassroomMembership.ROLE_STUDENT,
            status=ClassroomMembership.STATUS_ACTIVE,
        )
        delivery.award_classwork(self.assignment, self.student, points=6, actor=self.teacher)
        delivery.award_classwork(self.assignment, classmate, points=6, actor=self.teacher)

        delivery.withdraw_classwork(self.assignment, self.student, actor=self.teacher)

        rows = delivery.classwork_awards(self.assignment)
        self.assertEqual(rows[self.student.id]["xp"], 0)
        self.assertEqual(rows[classmate.id]["xp"], 6)
