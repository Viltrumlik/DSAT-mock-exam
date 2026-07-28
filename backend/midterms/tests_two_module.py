"""Regression tests for the TWO-MODULE midterm runtime.

A two-module midterm runs module 1 on its own timer, auto-advances when that timer expires,
then runs module 2 on its own timer, and finally scores BOTH modules. It is opt-in per exam,
so the single-module path (the overwhelming majority of production midterms) must stay
byte-identical — several tests here exist only to pin that down.

This file also pins the fixes from the two-module audit:
  * a stale module-1 submit must never finalize module 2 (the pastpaper "Module 2 skip" class
    of bug, which already cost 16 students their marks once);
  * module-1 flags survive the boundary;
  * counts/durations span both modules and the timer and the payload agree;
  * the single<->two sync flip preserves Question.id so live answers are never orphaned.

    python manage.py test midterms.tests_two_module --settings=config.settings_test_nomigrations
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from access.models import ResourceAccessGrant
from exams.models import Module, Question
from midterms.models import MODULE_BREAK_GRACE_SECONDS, Midterm, MidtermAttempt, MidtermVersion
from midterms.state_machine import (
    STATE_ACTIVE,
    STATE_COMPLETED,
    STATE_MODULE_2_ACTIVE,
    STATE_SCORING,
)
from midterms.timing import get_midterm_timing

User = get_user_model()


# ── fixtures ────────────────────────────────────────────────────────────────────


def _questions(module, n, correct="a", prefix="Q"):
    for i in range(n):
        Question.objects.create(
            module=module, question_type="READING", question_text=f"{prefix}{i}",
            option_a="A", option_b="B", option_c="C", option_d="D",
            correct_answers=correct, is_math_input=False, score=10, order=i,
        )


def make_midterm(*, n1=3, n2=3, mins1=30, mins2=20, two_module=True, scale=Midterm.SCALE_100):
    """A published midterm. ``two_module=False`` (or n2=0) leaves it single-module."""
    m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=mins1)
    m2 = None
    if two_module:
        m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=mins2)
    mt = Midterm.objects.create(
        title="Two Module Midterm",
        subject=Midterm.READING_WRITING,
        scoring_scale=scale,
        duration_minutes=mins1,
        duration_minutes_2=mins2 if two_module else None,
        question_module=m1,
        question_module_2=m2,
        is_published=True,
    )
    _questions(m1, n1, prefix="M1Q")
    if m2 is not None and n2:
        _questions(m2, n2, prefix="M2Q")
    return mt


def grant(user, midterm):
    from access.resources import RT_MIDTERM_V2

    return ResourceAccessGrant.objects.create(
        user=user, scope=ResourceAccessGrant.SCOPE_RESOURCE,
        resource_type=RT_MIDTERM_V2, resource_id=midterm.id,
        status=ResourceAccessGrant.STATUS_ACTIVE,
    )


def expire_module_1(attempt, *, minutes_ago_extra=0):
    """Push module 1's anchor back so its timer has run out."""
    started = timezone.now() - timedelta(
        minutes=attempt.midterm.duration_for_order(1) + 1 + minutes_ago_extra
    )
    MidtermAttempt.objects.filter(pk=attempt.pk).update(started_at=started)
    attempt.refresh_from_db()


def expire_module_2(attempt):
    started = timezone.now() - timedelta(minutes=attempt.midterm.duration_for_order(2) + 1)
    MidtermAttempt.objects.filter(pk=attempt.pk).update(module_2_started_at=started)
    attempt.refresh_from_db()


class TwoModuleEngineTests(TestCase):
    def setUp(self):
        self.student = User.objects.create(username="s-2mod", email="s2@x.io")

    def _start(self, mt):
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()
        return att

    # ── module shape ────────────────────────────────────────────────────────

    def test_module_count_is_two_and_questions_are_split(self):
        mt = make_midterm(n1=3, n2=4)
        att = self._start(mt)
        self.assertEqual(att.module_count(), 2)
        self.assertEqual(att.effective_questions_for_order(1).count(), 3)
        self.assertEqual(att.effective_questions_for_order(2).count(), 4)
        self.assertEqual(len(att.effective_questions()), 7)

    def test_empty_module_2_degrades_to_single_module(self):
        """An opted-in but EMPTY module 2 must behave as a single-module paper."""
        mt = make_midterm(n1=3, n2=0)
        att = self._start(mt)
        self.assertEqual(att.module_count(), 1)
        att.submit()
        self.assertEqual(att.current_state, STATE_SCORING)  # finished, not advanced

    def test_effective_questions_is_always_a_list(self):
        """Single-module used to return a QuerySet and two-module a list."""
        for two in (True, False):
            att = self._start(make_midterm(two_module=two))
            self.assertIsInstance(att.effective_questions(), list)
            att.delete()

    # ── the boundary ────────────────────────────────────────────────────────

    def test_submit_on_module_1_advances_instead_of_finishing(self):
        mt = make_midterm()
        att = self._start(mt)
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]

        self.assertTrue(att.submit(answers={q1[0]: "a"}))
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        self.assertIsNotNone(att.module_2_started_at)
        self.assertFalse(att.is_completed)

        # submit() is a ONE-STEP advance, so from module 2 the next step legitimately
        # finishes the paper. Guarding a *stale duplicate* is the view's job (module
        # targeting), not this method's — see
        # TwoModuleApiTests.test_stale_module_1_submit_does_not_finalize_module_2.
        self.assertTrue(att.submit())
        self.assertEqual(att.current_state, STATE_SCORING)
        # ...and only THEN is it idempotent.
        self.assertFalse(att.submit())

    def test_module_1_answers_survive_the_boundary_and_both_modules_score(self):
        mt = make_midterm(n1=2, n2=2, scale=Midterm.SCALE_100)
        att = self._start(mt)
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]
        q2 = [str(q.id) for q in att.effective_questions_for_order(2)]

        att.submit(answers={q1[0]: "a", q1[1]: "a"})  # both module-1 correct
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        # module-1 answers are still on the attempt while module 2 runs
        self.assertEqual(set(att.answers), set(q1))

        att.submit_final(answers={q2[0]: "a", q2[1]: "b"})  # one module-2 correct
        att.complete()
        self.assertEqual(att.current_state, STATE_COMPLETED)
        # 3 of 4 correct across BOTH modules
        self.assertEqual(att.score, 75)

    def test_timer_is_per_module(self):
        mt = make_midterm(mins1=30, mins2=20)
        att = self._start(mt)
        self.assertEqual(get_midterm_timing(att).limit_seconds, 30 * 60)
        att.submit()
        self.assertEqual(get_midterm_timing(att).limit_seconds, 20 * 60)
        # module 2's clock is fresh — module 1's elapsed time doesn't carry over
        self.assertGreater(get_midterm_timing(att).remaining_seconds, 20 * 60 - 60)

    def test_module_2_anchor_is_capped_so_a_break_cannot_be_banked(self):
        """Advancing long after module 1's deadline must not hand out a full fresh timer."""
        mt = make_midterm(mins1=30, mins2=20)
        att = self._start(mt)
        expire_module_1(att, minutes_ago_extra=60)  # went offline for an hour
        att.submit()

        deadline = att.started_at + timedelta(minutes=30)
        self.assertLessEqual(
            att.module_2_started_at, deadline + timedelta(seconds=MODULE_BREAK_GRACE_SECONDS + 1)
        )
        # ...and therefore module 2 is already expired rather than fully available
        self.assertTrue(get_midterm_timing(att).is_expired)

    def test_advancing_on_time_keeps_the_whole_module_2_timer(self):
        mt = make_midterm(mins1=30, mins2=20)
        att = self._start(mt)
        expire_module_1(att)  # just past the deadline, as a live client would be
        att.submit()
        timing = get_midterm_timing(att)
        self.assertFalse(timing.is_expired)
        self.assertGreater(timing.remaining_seconds, 20 * 60 - 180)

    def test_flags_from_module_1_survive_the_first_module_2_save(self):
        mt = make_midterm(n1=2, n2=2)
        att = self._start(mt)
        q1 = [q.id for q in att.effective_questions_for_order(1)]
        q2 = [q.id for q in att.effective_questions_for_order(2)]

        att.autosave(flagged=[q1[0]])
        att.submit()
        # The runner only ever holds the LIVE module's flags, so it posts module-2 flags only.
        att.autosave(flagged=[q2[1]])
        self.assertIn(q1[0], att.flagged)  # module-1 flag NOT blanked
        self.assertIn(q2[1], att.flagged)

    def test_single_module_flag_replace_is_unchanged(self):
        mt = make_midterm(two_module=False, n1=3)
        att = self._start(mt)
        qs = [q.id for q in att.effective_questions_for_order(1)]
        att.autosave(flagged=[qs[0], qs[1]])
        att.autosave(flagged=[qs[2]])  # client is authoritative for the whole paper
        self.assertEqual(att.flagged, [qs[2]])

    # ── single-module regression ────────────────────────────────────────────

    def test_single_module_goes_straight_to_scoring(self):
        mt = make_midterm(two_module=False, n1=3)
        att = self._start(mt)
        self.assertEqual(att.module_count(), 1)
        att.submit()
        self.assertEqual(att.current_state, STATE_SCORING)
        self.assertIsNone(att.module_2_started_at)

    def test_duration_for_order_falls_back_when_module_2_minutes_missing(self):
        """A NULL duration_minutes_2 must not mean 'zero-length' in one place and
        'never expires' in another."""
        mt = make_midterm(mins1=25)
        Midterm.objects.filter(pk=mt.pk).update(duration_minutes_2=None)
        mt.refresh_from_db()
        self.assertEqual(mt.duration_for_order(2), 25)

        att = self._start(mt)
        att.submit()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        # timer and payload agree on the same non-zero, finite limit
        self.assertEqual(get_midterm_timing(att).limit_seconds, 25 * 60)

    # ── counts ──────────────────────────────────────────────────────────────

    def test_question_counts_span_both_modules(self):
        mt = make_midterm(n1=3, n2=4)
        self.assertEqual(mt.total_question_count(), 7)
        self.assertEqual(mt.display_question_count(), 7)
        self.assertTrue(mt.has_questions())
        # questions() stays module 1 only, and stays a QuerySet (callers chain on it)
        self.assertEqual(mt.questions().count(), 3)

    def test_midterm_with_questions_only_in_module_2_still_publishes(self):
        mt = make_midterm(n1=0, n2=3)
        self.assertEqual(mt.display_question_count(), 3)
        self.assertTrue(mt.has_questions())

    def test_start_attempt_no_ops_after_an_advance(self):
        """A racing/retried start landing after the attempt advanced must not raise."""
        mt = make_midterm()
        att = self._start(mt)
        att.submit()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        stale = MidtermAttempt.objects.get(pk=att.pk)
        stale.current_state = "NOT_STARTED"  # simulate a stale in-memory copy
        self.assertFalse(stale.start_attempt())


class TwoModuleVersionTests(TestCase):
    """A version-pinned attempt serves ITS OWN version's two modules."""

    def setUp(self):
        self.student = User.objects.create(username="s-ver", email="sv@x.io")

    def test_versioned_attempt_uses_the_version_modules(self):
        mt = make_midterm(n1=1, n2=1)
        v_m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        v_m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=20)
        _questions(v_m1, 2, prefix="V1M1Q")
        _questions(v_m2, 3, prefix="V1M2Q")
        version = MidtermVersion.objects.create(
            midterm=mt, version_number=1, question_module=v_m1, question_module_2=v_m2
        )

        att = MidtermAttempt.objects.create(midterm=mt, student=self.student, version=version)
        att.start_attempt()
        self.assertEqual(att.module_count(), 2)
        self.assertEqual(att.effective_questions_for_order(1).count(), 2)
        self.assertEqual(att.effective_questions_for_order(2).count(), 3)
        self.assertEqual(len(att.effective_questions()), 5)
        # the midterm's own (dormant) flat module is NOT what gets served
        self.assertEqual(mt.display_question_count(), 5)  # version-aware

        att.submit()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)


class TwoModuleApiTests(TestCase):
    """Endpoint-level behaviour, including the stale-submit race."""

    def setUp(self):
        self.user = User.objects.create(username="api-2mod", email="a2@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _attempt(self, mt):
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        aid = r.json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        return aid

    def test_payload_serves_only_the_live_module(self):
        mt = make_midterm(n1=3, n2=4)
        aid = self._attempt(mt)

        r = self.client.get(f"/api/midterms/attempts/{aid}/")
        d = r.json()
        self.assertEqual(d["current_state"], "MODULE_1_ACTIVE")
        self.assertEqual(len(d["current_module_details"]["questions"]), 3)
        self.assertEqual(len(d["practice_test_details"]["modules"]), 2)
        # Only the pre-exam screen needs the whole-paper size, so it is omitted while a
        # module is live rather than costing a COUNT on every poll.
        self.assertIsNone(d["practice_test_details"]["total_question_count"])

        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        r = self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        d = r.json()
        self.assertEqual(d["current_state"], "MODULE_2_ACTIVE")
        self.assertEqual(len(d["current_module_details"]["questions"]), 4)
        # the PAPER is not over — the runner must render module 2, not the results screen
        self.assertFalse(d["is_completed"])

    def test_cannot_submit_either_module_early(self):
        mt = make_midterm()
        aid = self._attempt(mt)
        r = self.client.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {}}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        # module 2 has its own fresh timer, so it is early-locked too
        r = self.client.post(f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {}}, format="json")
        self.assertEqual(r.status_code, 403, r.content)

    def test_stale_module_1_submit_does_not_finalize_module_2(self):
        """THE regression: a retried module-1 submit landing after the attempt advanced used
        to end module 2 the instant it began, scoring it with module-1's answers."""
        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        module_1_id = att.effective_module_for_order(1).id
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]

        expire_module_1(att)
        # the attempt advances (e.g. an autosave got there first)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {q1[0]: "a"}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)

        # Expire module 2 as well, so the early-submit lock CANNOT be what saves us: the
        # request now gets all the way through to the engine, which is exactly where the
        # production race landed (the front-door check runs before the row lock, so an
        # attempt can advance underneath an in-flight submit).
        expire_module_2(att)

        # ...and now the module-1 submit retry lands, still targeting module 1.
        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {q1[0]: "a"}, "module_id": module_1_id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)  # NOT scored/finished
        self.assertFalse(att.is_completed)

    def test_module_2_targeted_submit_still_finalizes(self):
        """The stale-target guard must not over-block: the CURRENT module's submit works."""
        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        module_2_id = att.effective_module_for_order(2).id
        expire_module_2(att)

        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {}, "module_id": module_2_id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertIn(att.current_state, (STATE_SCORING, STATE_COMPLETED))

    def test_module_2_submit_finishes_the_paper(self):
        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()

        module_2_id = att.effective_module_for_order(2).id
        expire_module_2(att)
        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/", {"answers": {}, "module_id": module_2_id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        att.refresh_from_db()
        self.assertIn(att.current_state, (STATE_SCORING, STATE_COMPLETED))

    def test_background_flush_never_starts_module_2(self):
        """A pagehide keepalive proves the student is NOT looking at the screen, so it may
        save but must not start module 2's clock."""
        mt = make_midterm()
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]
        expire_module_1(att)

        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {q1[0]: "b"}, "background": True},
            format="json",
        )
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ACTIVE)  # still module 1
        self.assertIsNone(att.module_2_started_at)
        # The payload itself is post-deadline, so it is NOT banked — see
        # BackgroundFlushSecurityTests for why accepting it would be an unlimited-time cheat.
        self.assertEqual(att.answers, {})

    def test_single_module_api_flow_is_unchanged(self):
        mt = make_midterm(two_module=False, n1=3)
        aid = self._attempt(mt)
        r = self.client.get(f"/api/midterms/attempts/{aid}/")
        d = r.json()
        self.assertEqual(d["current_state"], "MODULE_1_ACTIVE")
        self.assertEqual(len(d["practice_test_details"]["modules"]), 1)

        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        r = self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        self.assertTrue(r.json()["is_expired"])  # the paper IS over for a single-module exam
        att.refresh_from_db()
        self.assertIn(att.current_state, (STATE_SCORING, STATE_COMPLETED))


class TwoModuleProctoringTests(TestCase):
    def setUp(self):
        self.user = User.objects.create(username="proc-2mod", email="p2@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_offscreen_forfeit_on_module_1_ends_the_whole_paper(self):
        """A forfeit is a termination, not a module boundary — it must not merely advance."""
        from midterms.proctoring import VIOLATION_LIMIT

        mt = make_midterm()
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        aid = r.json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")

        for _ in range(VIOLATION_LIMIT):
            self.client.post(f"/api/midterms/attempts/{aid}/offscreen/", {}, format="json")

        att = MidtermAttempt.objects.get(pk=aid)
        self.assertIn(att.current_state, (STATE_SCORING, STATE_COMPLETED))
        self.assertNotEqual(att.current_state, STATE_MODULE_2_ACTIVE)


class TwoModuleSyncTests(TestCase):
    """The legacy->mirror flip. This is what protects LIVE answers: flipping a running
    exam to two-module must MOVE question rows, never delete and re-create them, or every
    saved answer to a module-2 question is silently orphaned (which is how 16 students lost
    their marks in production)."""

    def _legacy_two_module(self, *, n1=3, n2=3, two_module=True):
        from exams.models import MockExam, PracticeTest

        exam = MockExam.objects.create(
            title="Legacy Two Module",
            kind=MockExam.KIND_MIDTERM,
            midterm_subject="MATH",
            midterm_scoring_scale="SCALE_800",
            midterm_module_count=2,
            midterm_module1_minutes=30,
            midterm_module2_minutes=20,
            midterm_module_question_limit=30,
            midterm_two_module_runtime=two_module,
            is_published=True,
        )
        pt = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        for order, n in ((1, n1), (2, n2)):
            mod = Module.objects.create(practice_test=pt, module_order=order, time_limit_minutes=30)
            for i in range(n):
                Question.objects.create(
                    module=mod, question_type="MATH", question_text=f"M{order}Q{i}",
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers="a", score=10, order=i,
                )
        return exam

    def test_flag_off_flattens_both_modules_into_one(self):
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy_two_module(n1=3, n2=3, two_module=False)
        mt = upsert_midterm_from_legacy(exam)
        self.assertIsNone(mt.question_module_2_id)
        self.assertEqual(mt.questions().count(), 6)  # flattened
        self.assertEqual(mt.total_question_count(), 6)

    def test_flag_on_splits_into_two_modules(self):
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy_two_module(n1=3, n2=4)
        mt = upsert_midterm_from_legacy(exam)
        self.assertIsNotNone(mt.question_module_2_id)
        self.assertEqual(mt.questions_for_order(1).count(), 3)
        self.assertEqual(mt.questions_for_order(2).count(), 4)
        self.assertEqual(mt.duration_minutes, 30)
        self.assertEqual(mt.duration_minutes_2, 20)

    def test_single_to_two_flip_preserves_question_ids(self):
        """THE answer-survival guarantee: ids must be re-homed, not re-created."""
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy_two_module(n1=3, n2=3, two_module=False)
        mt = upsert_midterm_from_legacy(exam)
        flat_ids = [q.id for q in mt.questions()]  # 6 ids, module 1 then module 2
        self.assertEqual(len(flat_ids), 6)

        exam.midterm_two_module_runtime = True
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)

        self.assertEqual([q.id for q in mt.questions_for_order(1)], flat_ids[:3])
        self.assertEqual([q.id for q in mt.questions_for_order(2)], flat_ids[3:])

    def test_two_to_single_revert_preserves_question_ids(self):
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy_two_module(n1=3, n2=3)
        mt = upsert_midterm_from_legacy(exam)
        ids_before = [q.id for q in mt.questions_for_order(1)] + [q.id for q in mt.questions_for_order(2)]

        exam.midterm_two_module_runtime = False
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)

        self.assertIsNone(mt.question_module_2_id)
        self.assertEqual([q.id for q in mt.questions()], ids_before)

    def test_revert_is_deferred_while_a_student_sits_module_2(self):
        """Dropping module 2 under a live attempt would leave it with no questions, no
        timer and no way to submit."""
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy_two_module(n1=2, n2=2)
        mt = upsert_midterm_from_legacy(exam)
        student = User.objects.create(username="mid-m2", email="m2@x.io")
        att = MidtermAttempt.objects.create(midterm=mt, student=student)
        att.start_attempt()
        att.submit()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)

        exam.midterm_two_module_runtime = False
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)

        self.assertIsNotNone(mt.question_module_2_id)  # kept
        att.refresh_from_db()
        att._module_count_memo = None
        self.assertEqual(att.module_count(), 2)
        self.assertEqual(att.effective_questions_for_order(2).count(), 2)


class ErrorReportTargetTests(TestCase):
    """A 'Report a problem' on a module-2 question must still name its midterm."""

    def test_module_2_question_resolves_to_its_midterm(self):
        from question_reports.models import QuestionErrorReport
        from question_reports.targets import resolve_target

        mt = make_midterm(n1=2, n2=2)
        q2 = mt.questions_for_order(2).first()
        target = resolve_target("exam", q2.id)
        self.assertEqual(target.resource_type, QuestionErrorReport.RESOURCE_MIDTERM)
        self.assertEqual(target.resource_id, mt.id)
        self.assertEqual(target.resource_title, mt.title)

    def test_versioned_module_question_resolves_to_the_parent_midterm(self):
        from question_reports.models import QuestionErrorReport
        from question_reports.targets import resolve_target

        mt = make_midterm(n1=1, n2=1)
        v_m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        v_m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=20)
        _questions(v_m1, 1, prefix="VQ1")
        _questions(v_m2, 1, prefix="VQ2")
        MidtermVersion.objects.create(
            midterm=mt, version_number=1, question_module=v_m1, question_module_2=v_m2
        )
        for module in (v_m1, v_m2):
            q = Question.objects.filter(module=module).first()
            target = resolve_target("exam", q.id)
            self.assertEqual(target.resource_type, QuestionErrorReport.RESOURCE_MIDTERM)
            self.assertEqual(target.resource_id, mt.id)


class SweepMidtermAttemptsTests(TestCase):
    """The reaper that closes attempts nobody came back to.

    Without it a midterm attempt only moves when a request arrives, so a student who shuts
    the tab is left unscored forever AND blocked from re-sitting by the active-attempt
    uniqueness constraint. This is exactly how fifteen students ended up with no result.
    """

    def setUp(self):
        self.student = User.objects.create(username="sweep-s", email="sw@x.io")

    def _stranded(self, mt, *, minutes_late=90):
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()
        MidtermAttempt.objects.filter(pk=att.pk).update(
            started_at=timezone.now() - timedelta(minutes=mt.duration_for_order(1) + minutes_late)
        )
        att.refresh_from_db()
        return att

    def _sweep(self, **kwargs):
        from django.core.management import call_command

        call_command("sweep_midterm_attempts", **kwargs)

    def test_single_module_stranded_attempt_is_scored(self):
        mt = make_midterm(two_module=False, n1=2)
        att = self._stranded(mt)
        self._sweep()
        att.refresh_from_db()
        self.assertTrue(att.is_completed)
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertIsNotNone(att.score)

    def test_two_module_stranded_in_module_1_drains_through_both(self):
        mt = make_midterm(n1=2, n2=2)
        att = self._stranded(mt)
        self._sweep()
        att.refresh_from_db()
        self.assertTrue(att.is_completed)
        self.assertIsNotNone(att.score)

    def test_stranded_in_module_2_is_scored(self):
        mt = make_midterm(n1=2, n2=2)
        att = self._stranded(mt, minutes_late=90)
        att.submit()  # advance into module 2
        expire_module_2(att)
        MidtermAttempt.objects.filter(pk=att.pk).update(
            module_2_started_at=timezone.now() - timedelta(hours=4)
        )
        self._sweep()
        att.refresh_from_db()
        self.assertTrue(att.is_completed)

    def test_live_attempt_within_its_timer_is_left_alone(self):
        mt = make_midterm(n1=2, n2=2)
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        att.start_attempt()
        self._sweep()
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ACTIVE)
        self.assertFalse(att.is_completed)

    def test_recently_expired_attempt_is_inside_the_grace_window(self):
        mt = make_midterm(two_module=False, n1=2)
        self._stranded(mt, minutes_late=2)  # only 2 minutes late, grace is 30
        att = MidtermAttempt.objects.get(midterm=mt, student=self.student)
        self._sweep()
        att.refresh_from_db()
        self.assertFalse(att.is_completed)

    def test_not_started_attempt_is_never_force_started(self):
        mt = make_midterm(two_module=False, n1=2)
        att = MidtermAttempt.objects.create(midterm=mt, student=self.student)
        self._sweep()
        att.refresh_from_db()
        self.assertEqual(att.current_state, "NOT_STARTED")

    def test_dry_run_changes_nothing(self):
        mt = make_midterm(two_module=False, n1=2)
        att = self._stranded(mt)
        self._sweep(dry_run=True)
        att.refresh_from_db()
        self.assertFalse(att.is_completed)

    def test_late_answers_are_not_accepted_by_the_reaper(self):
        """Whatever was autosaved before the student vanished is what gets graded."""
        mt = make_midterm(two_module=False, n1=2)
        att = self._stranded(mt)
        q = [str(x.id) for x in att.effective_questions_for_order(1)]
        MidtermAttempt.objects.filter(pk=att.pk).update(answers={q[0]: "a"})
        self._sweep()
        att.refresh_from_db()
        self.assertEqual(att.answers, {q[0]: "a"})
        self.assertEqual(att.score, 50)  # 1 of 2, nothing invented


class RevertDeferProbeTests(TestCase):
    """Two bugs an adversarial pass found in the deferred-revert guard itself."""

    def _legacy(self, *, two_module=True):
        from exams.models import MockExam, PracticeTest

        exam = MockExam.objects.create(
            title="Defer Probe", kind=MockExam.KIND_MIDTERM, midterm_subject="MATH",
            midterm_scoring_scale="SCALE_800", midterm_module_count=2,
            midterm_module1_minutes=30, midterm_module2_minutes=45,
            midterm_module_question_limit=30, midterm_two_module_runtime=two_module,
            is_published=True,
        )
        pt = PracticeTest.objects.create(
            mock_exam=exam, subject="MATH", form_type="INTERNATIONAL", skip_default_modules=True
        )
        for order in (1, 2):
            mod = Module.objects.create(practice_test=pt, module_order=order, time_limit_minutes=30)
            for i in range(2):
                Question.objects.create(
                    module=mod, question_type="MATH", question_text=f"M{order}Q{i}",
                    option_a="A", option_b="B", option_c="C", option_d="D",
                    correct_answers="a", score=10, order=i,
                )
        return exam

    def test_deferred_revert_keeps_the_module_2_timer(self):
        """Deferring the revert must not blank duration_minutes_2 — the live module-2
        student's clock would silently fall back to module 1's length."""
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy()
        mt = upsert_midterm_from_legacy(exam)
        self.assertEqual(mt.duration_minutes_2, 45)

        student = User.objects.create(username="defer-m2", email="d2@x.io")
        att = MidtermAttempt.objects.create(midterm=mt, student=student)
        att.start_attempt()
        att.submit()  # into module 2

        exam.midterm_two_module_runtime = False
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)

        self.assertIsNotNone(mt.question_module_2_id)
        self.assertEqual(mt.duration_minutes_2, 45)  # NOT wiped
        self.assertEqual(mt.duration_for_order(2), 45)

    def test_revert_is_deferred_for_a_module_1_student_too(self):
        """A student mid-module-1 still has module 2 ahead of them: flattening now would
        rewrite the paper underneath them."""
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy()
        mt = upsert_midterm_from_legacy(exam)
        student = User.objects.create(username="defer-m1", email="d1@x.io")
        att = MidtermAttempt.objects.create(midterm=mt, student=student)
        att.start_attempt()
        self.assertEqual(att.current_state, STATE_ACTIVE)

        exam.midterm_two_module_runtime = False
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)

        self.assertIsNotNone(mt.question_module_2_id)  # kept
        att.refresh_from_db()
        att._module_count_memo = None
        self.assertEqual(att.module_count(), 2)

    def test_revert_proceeds_once_nobody_is_sitting_it(self):
        from midterms.sync import upsert_midterm_from_legacy

        exam = self._legacy()
        mt = upsert_midterm_from_legacy(exam)
        student = User.objects.create(username="defer-done", email="dd@x.io")
        att = MidtermAttempt.objects.create(midterm=mt, student=student)
        att.start_attempt()
        att.submit()
        att.submit_final()
        att.complete()

        exam.midterm_two_module_runtime = False
        exam.save(update_fields=["midterm_two_module_runtime"])
        mt = upsert_midterm_from_legacy(exam)
        self.assertIsNone(mt.question_module_2_id)
        self.assertEqual(mt.questions().count(), 4)  # flattened


class ModuleBoundaryContractTests(TestCase):
    """What the M1->M2 boundary must and must NOT do.

    The boundary is the single most dangerous edge in this feature: overshoot it and the
    paper ends half-sat (the production incident), undershoot it and the student is stuck.
    These pin the exact contract on BOTH server-driven entry points — the autosave that
    notices the deadline, and an explicit submit that arrives on/after it.
    """

    def setUp(self):
        self.user = User.objects.create(username="bound-2mod", email="b2@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _attempt(self, mt):
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        aid = r.json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        return aid

    def test_submit_module_on_module_1_expiry_advances_instead_of_finalizing(self):
        """An explicit submit landing at the module-1 deadline is an ADVANCE, not the end of
        the paper — the case the incident got wrong (54 questions served as one flat module)."""
        mt = make_midterm(n1=2, n2=3)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        module_1_id = att.effective_module_for_order(1).id
        expire_module_1(att)

        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {}, "module_id": module_1_id},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)

        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        self.assertIsNotNone(att.module_2_started_at)
        self.assertFalse(att.is_completed)
        self.assertIsNone(att.score)  # nothing was graded at the boundary
        # ...and the response hands the runner module 2, not a results screen.
        d = r.json()
        self.assertEqual(d["current_state"], "MODULE_2_ACTIVE")
        self.assertEqual(len(d["current_module_details"]["questions"]), 3)

    def test_advance_via_save_does_not_enqueue_scoring(self):
        """Scoring is enqueued ONLY when the whole paper is in. Enqueuing at the boundary
        would grade module 1 alone and mark the attempt done."""
        from unittest.mock import patch

        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)

        with patch("midterms.views.enqueue_midterm_scoring") as enqueue:
            r = self.client.post(
                f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json"
            )
            self.assertEqual(r.status_code, 200, r.content)
            enqueue.assert_not_called()

        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        self.assertIsNotNone(att.module_2_started_at)
        self.assertIsNone(att.score)
        # is_expired is the "your paper is over" flag; at the boundary it must stay down or
        # the runner shows the results screen instead of module 2.
        self.assertFalse(r.json()["is_expired"])

    def test_paper_end_via_save_does_enqueue_scoring_and_flags_expired(self):
        """The mirror image: module 2's deadline DOES end the paper."""
        from unittest.mock import patch

        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        expire_module_2(att)

        with patch("midterms.views.enqueue_midterm_scoring") as enqueue:
            r = self.client.post(
                f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json"
            )
            self.assertEqual(r.status_code, 200, r.content)
            enqueue.assert_called_once()

        self.assertTrue(r.json()["is_expired"])
        att.refresh_from_db()
        # scoring was stubbed out, so it parks in SCORING — the transition is what matters
        self.assertEqual(att.current_state, STATE_SCORING)


class TwoModuleEndToEndScoreTests(TestCase):
    """The whole paper, over HTTP, scored across both modules."""

    def setUp(self):
        self.user = User.objects.create(username="e2e-2mod", email="e2@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_full_two_module_sitting_scores_both_modules(self):
        mt = make_midterm(n1=2, n2=2, scale=Midterm.SCALE_100)
        grant(self.user, mt)
        aid = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json").json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")

        att = MidtermAttempt.objects.get(pk=aid)
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]
        q2 = [str(q.id) for q in att.effective_questions_for_order(2)]

        # Module 1: both correct, autosaved BEFORE the deadline (a post-deadline payload is
        # deliberately refused, so only banked answers count — that is the real student flow).
        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {q1[0]: "a", q1[1]: "a"}}, format="json",
        )
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)

        # Module 2: one right, one wrong.
        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {q2[0]: "a", q2[1]: "d"}}, format="json",
        )
        att.refresh_from_db()
        module_2_id = att.effective_module_for_order(2).id
        expire_module_2(att)
        r = self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {}, "module_id": module_2_id}, format="json",
        )
        self.assertEqual(r.status_code, 200, r.content)

        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertTrue(att.is_completed)
        # 3 of 4 across BOTH modules — module 1's answers were neither lost nor double-counted.
        self.assertEqual(att.score, 75)
        # The denominator is the whole paper, not one module.
        from midterms.scoring import score_midterm_attempt

        self.assertEqual(score_midterm_attempt(att)["total_count"], 4)

    def test_versioned_counts_span_both_modules(self):
        mt = make_midterm(n1=1, n2=1)
        v_m1 = Module.objects.create(practice_test=None, module_order=1, time_limit_minutes=30)
        v_m2 = Module.objects.create(practice_test=None, module_order=2, time_limit_minutes=20)
        _questions(v_m1, 2, prefix="VC1")
        _questions(v_m2, 3, prefix="VC2")
        version = MidtermVersion.objects.create(
            midterm=mt, version_number=1, question_module=v_m1, question_module_2=v_m2
        )
        self.assertEqual(version.total_question_count(), 5)
        self.assertEqual(version.module_count(), 2)
        self.assertEqual(mt.display_question_count(), 5)  # version-aware, both modules


class OffscreenForfeitOnModule2Tests(TestCase):
    """The off-screen rule polices module 2 exactly as it polices module 1."""

    def setUp(self):
        self.user = User.objects.create(username="proc-m2", email="pm2@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_third_strike_in_module_2_finalizes_and_scores_the_whole_paper(self):
        from midterms.proctoring import VIOLATION_LIMIT

        mt = make_midterm(n1=2, n2=2, scale=Midterm.SCALE_100)
        grant(self.user, mt)
        aid = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json").json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")

        att = MidtermAttempt.objects.get(pk=aid)
        q1 = [str(q.id) for q in att.effective_questions_for_order(1)]
        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {q1[0]: "a", q1[1]: "a"}}, format="json",
        )
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)

        for _ in range(VIOLATION_LIMIT - 1):
            r = self.client.post(f"/api/midterms/attempts/{aid}/offscreen/", {}, format="json")
            self.assertFalse(r.data["terminated"])
            att.refresh_from_db()
            self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)  # still sitting it

        r = self.client.post(f"/api/midterms/attempts/{aid}/offscreen/", {}, format="json")
        self.assertTrue(r.data["terminated"])

        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_COMPLETED)
        self.assertEqual(att.terminated_reason, MidtermAttempt.TERMINATION_OFFSCREEN)
        # A forfeit still grades the WHOLE paper: 2 of 4, not 2 of 2.
        self.assertEqual(att.score, 50)


class NullModule2DurationPayloadTests(TestCase):
    """A NULL ``duration_minutes_2`` must mean ONE thing everywhere.

    It used to mean "zero-length module" to the serializer and "never expires" to the timer
    — a module that can never be finished by the clock, i.e. a stuck student.
    """

    def setUp(self):
        self.user = User.objects.create(username="nulldur", email="nd@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_payload_and_timer_agree_when_module_2_minutes_is_null(self):
        mt = make_midterm(n1=2, n2=2, mins1=25, mins2=20)
        Midterm.objects.filter(pk=mt.pk).update(duration_minutes_2=None)
        mt.refresh_from_db()

        grant(self.user, mt)
        aid = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json").json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)

        d = self.client.get(f"/api/midterms/attempts/{aid}/").json()
        # falls back to module 1's duration — never 0
        self.assertEqual(d["module_duration_seconds"], 25 * 60)
        m2_meta = [m for m in d["practice_test_details"]["modules"] if m["module_order"] == 2][0]
        self.assertEqual(m2_meta["time_limit_minutes"], 25)
        # the server-side clock agrees with the number the runner was handed, exactly
        self.assertEqual(get_midterm_timing(att).limit_seconds, d["module_duration_seconds"])
        # and the module is genuinely finishable: time is running, not infinite
        self.assertGreater(d["remaining_seconds"], 0)
        self.assertLessEqual(d["remaining_seconds"], 25 * 60)
        self.assertFalse(d["is_expired"])


class BackgroundFlushSecurityTests(TestCase):
    """`background:true` is client-assertable, so it must never buy the client TIME."""

    def setUp(self):
        self.user = User.objects.create(username="bg-cheat", email="bg@x.io")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _attempt(self, mt):
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        aid = r.json()["id"]
        self.client.post(f"/api/midterms/attempts/{aid}/start/", {}, format="json")
        return aid

    def test_background_flush_after_the_deadline_banks_nothing(self):
        """Otherwise a crafted client keeps a module open forever by setting the flag:
        autosave has no expiry check of its own."""
        mt = make_midterm(two_module=False, n1=3)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        q = [str(x.id) for x in att.effective_questions_for_order(1)]

        # legitimate pre-deadline answer
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {q[0]: "a"}}, format="json")
        expire_module_1(att)

        # post-deadline "background" flush trying to bank more answers
        for _ in range(3):
            self.client.post(
                f"/api/midterms/attempts/{aid}/save_attempt/",
                {"answers": {q[1]: "a", q[2]: "a"}, "background": True},
                format="json",
            )
        att.refresh_from_db()
        self.assertEqual(att.answers, {q[0]: "a"})  # nothing banked after the deadline

    def test_a_real_interaction_after_the_deadline_still_finalizes(self):
        """The attempt must not be left open forever by the rule above."""
        mt = make_midterm(two_module=False, n1=3)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        expire_module_1(att)
        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}, "background": True}, format="json"
        )
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_ACTIVE)  # background did not advance

        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertIn(att.current_state, (STATE_SCORING, STATE_COMPLETED))

    def test_background_flush_before_the_deadline_still_saves(self):
        mt = make_midterm(two_module=False, n1=3)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        q = [str(x.id) for x in att.effective_questions_for_order(1)]
        self.client.post(
            f"/api/midterms/attempts/{aid}/save_attempt/",
            {"answers": {q[0]: "b"}, "background": True},
            format="json",
        )
        att.refresh_from_db()
        self.assertEqual(att.answers.get(q[0]), "b")

    def test_stale_target_no_op_still_banks_the_payload(self):
        """The no-op must not cost marks: the racing payload may hold the only copy of an
        answer to the module that just closed."""
        mt = make_midterm(n1=2, n2=2)
        aid = self._attempt(mt)
        att = MidtermAttempt.objects.get(pk=aid)
        module_1_id = att.effective_module_for_order(1).id
        q1 = [str(x.id) for x in att.effective_questions_for_order(1)]

        expire_module_1(att)
        self.client.post(f"/api/midterms/attempts/{aid}/save_attempt/", {"answers": {}}, format="json")
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)
        expire_module_2(att)

        self.client.post(
            f"/api/midterms/attempts/{aid}/submit_module/",
            {"answers": {q1[0]: "a", q1[1]: "a"}, "module_id": module_1_id},
            format="json",
        )
        att.refresh_from_db()
        self.assertEqual(att.current_state, STATE_MODULE_2_ACTIVE)  # still not finalized
        self.assertEqual(att.answers.get(q1[0]), "a")  # ...but the answers were kept
        self.assertEqual(att.answers.get(q1[1]), "a")

    def test_total_question_count_is_served_before_the_exam_starts(self):
        mt = make_midterm(n1=3, n2=4)
        grant(self.user, mt)
        r = self.client.post("/api/midterms/attempts/", {"midterm": mt.id}, format="json")
        self.assertEqual(r.json()["practice_test_details"]["total_question_count"], 7)


class AdminQuestionEditorTests(TestCase):
    """The builder/Review-Center question endpoint on a two-module midterm."""

    def setUp(self):
        self.staff = User.objects.create(username="qa-staff", email="qa@x.io", is_staff=True, is_superuser=True)
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def _url(self, mt, suffix=""):
        return f"/api/midterms/admin/midterms/{mt.id}/questions/{suffix}"

    def test_listing_without_a_module_param_returns_the_whole_paper(self):
        """The Review Center passes no param — an auditor must not approve half a paper."""
        mt = make_midterm(n1=3, n2=4)
        r = self.client.get(self._url(mt))
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        rows = body if isinstance(body, list) else body.get("results", body)
        self.assertEqual(len(rows), 7)

    def test_listing_can_still_be_scoped_to_one_module(self):
        mt = make_midterm(n1=3, n2=4)
        for order, expected in ((1, 3), (2, 4)):
            r = self.client.get(self._url(mt) + f"?module={order}")
            body = r.json()
            rows = body if isinstance(body, list) else body.get("results", body)
            self.assertEqual(len(rows), expected)

    def test_a_module_2_question_is_reachable_by_id(self):
        mt = make_midterm(n1=2, n2=2)
        q2 = mt.questions_for_order(2).first()
        r = self.client.get(self._url(mt, f"{q2.id}/"))
        self.assertEqual(r.status_code, 200, r.content)

    def test_adding_a_module_2_question_never_invents_a_second_module(self):
        """Auto-provisioning module 2 here would silently flip a single-module midterm into
        a two-module one for every student mid-flight."""
        mt = make_midterm(two_module=False, n1=2)
        self.assertIsNone(mt.question_module_2_id)

        r = self.client.post(self._url(mt) + "?module=2", {"question_text": "sneaky"}, format="json")
        self.assertEqual(r.status_code, 400, r.content)

        mt.refresh_from_db()
        self.assertIsNone(mt.question_module_2_id)
        att = MidtermAttempt.objects.create(
            midterm=mt, student=User.objects.create(username="victim", email="v@x.io")
        )
        att.start_attempt()
        self.assertEqual(att.module_count(), 1)  # still a one-module paper

    def test_bulk_reorder_does_not_provision_module_2(self):
        mt = make_midterm(two_module=False, n1=2)
        r = self.client.post(self._url(mt, "bulk-reorder/") + "?module=2", {"ordered_ids": []}, format="json")
        self.assertEqual(r.status_code, 400, r.content)
        mt.refresh_from_db()
        self.assertIsNone(mt.question_module_2_id)

    def test_adding_to_module_2_works_when_it_genuinely_exists(self):
        mt = make_midterm(n1=2, n2=2)
        r = self.client.post(self._url(mt) + "?module=2", {"question_text": "legit"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(mt.questions_for_order(2).count(), 3)
        self.assertEqual(mt.questions_for_order(1).count(), 2)  # module 1 untouched
