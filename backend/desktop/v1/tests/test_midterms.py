"""Midterms on ``/api/desktop/v1/``: prepare (start gate, code, rate limit), open (lockdown token,
live module only), sync (300 s late grace, never a state change), submit (early → 409
``module_not_expired``, never cached; module 2 arrives with it), offscreen (once per key, the third
ends the sitting), result and media — each against its contract fixture."""

from __future__ import annotations

import datetime as _dt
import json
from unittest import mock

from django.conf import settings
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from desktop.proof import sign
from midterms.models import Midterm, MidtermAttempt, MidtermAttemptIdempotencyKey

from desktop.v1 import content
from desktop.v1.tests.support import (
    APP_HEADER,
    AppClient,
    V1TestCase,
    assert_shape,
    fixture,
    grant_midterm,
    iso_ms,
    join,
    make_classroom,
    make_midterm,
    make_student,
    module_qids,
    new_key,
    shift_midterm_clock,
)

KEY_ID = "k2026a"
KEY_HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
PRECHECK = json.dumps({"ok": True, "displays": 1, "remote": False, "vm": False, "apps": []})
MODULE_S = 35 * 60
GRACE_S = 300


def _rates(**rates):
    rf = dict(settings.REST_FRAMEWORK)
    merged = dict(rf.get("DEFAULT_THROTTLE_RATES") or {})
    merged.update(rates)
    rf["DEFAULT_THROTTLE_RATES"] = merged
    return override_settings(REST_FRAMEWORK=rf)


class MidtermCase(V1TestCase):
    def setUp(self):
        super().setUp()
        self.student = make_student()
        self.midterm = make_midterm()
        grant_midterm(self.student, self.midterm)
        self.m1, self.m2 = self.midterm.question_module, self.midterm.question_module_2
        self.q1, self.q2 = module_qids(self.m1), module_qids(self.m2)
        self.app = AppClient(self.student)

    def prepare(self, body=None, *, expect=200, midterm=None):
        res = self.app.post(f"midterms/{(midterm or self.midterm).id}/prepare", body or {})
        self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def call(self, action, attempt_id, body=None, *, key=None, lockdown=None, expect=200):
        res = self.app.post(f"midterms/attempts/{attempt_id}/{action}", body or {}, key=key, lockdown=lockdown)
        self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def opened(self) -> int:
        attempt_id = self.prepare()["attempt"]["id"]
        self.call("open", attempt_id)
        return attempt_id

    def sync(self, attempt_id, module_id, answers, *, flagged=None, seq=1, key=None, lockdown=None, expect=200):
        return self.call("sync", attempt_id, {"module_id": module_id, "seq": seq, "answers": answers, "flagged": flagged or []},
                         key=key or new_key("sync"), lockdown=lockdown, expect=expect)

    def submit(self, attempt_id, module_id, answers=None, *, key=None, lockdown=None, expect=200):
        return self.call("submit", attempt_id, {"module_id": module_id, "seq": 9, "answers": answers or {}},
                         key=key or new_key("submit"), lockdown=lockdown, expect=expect)

    def expire(self, attempt_id, *, order=1, extra=1):
        shift_midterm_clock(attempt_id, seconds_ago=MODULE_S + extra, order=order)


class PrepareTests(MidtermCase):
    def test_standalone_prepare_creates_the_sitting_without_questions(self):
        body = self.prepare()
        self.assertContract(body, "midterm_prepare.response")
        attempt = body["attempt"]
        self.assertEqual((attempt["kind"], attempt["ref_id"], attempt["state"]), ("midterm", self.midterm.id, "NOT_STARTED"))
        self.assertEqual(attempt["module"], {"id": self.m1.id, "order": 1, "duration_ms": MODULE_S * 1000})
        self.assertEqual(attempt["module_ids"], [self.m1.id, self.m2.id])
        self.assertIsNone(attempt["score"])
        self.assertEqual(attempt["midterm"]["late_grace_seconds"], GRACE_S)
        self.assertEqual(attempt["midterm"]["offscreen_limit"], 3)
        self.assertFalse(body["requires_code"])
        self.assertEqual(body["rules"]["question_count"], 5)
        self.assertEqual(body["rules"]["module_count"], 2)
        self.assertEqual(body["rules"]["durations_min"], [35, 35])
        self.assertEqual(body["rules"]["calculator"], "graphing")
        # An 800-scale MIDTERM with no pass mark of its own: the scale's default, quoted.
        self.assertEqual(
            (body["rules"]["scoring_scale"], body["rules"]["pass_mark"], body["rules"]["is_retake"]),
            ("SCALE_800", 500, False),
        )
        self.assertNotIn("questions", json.dumps(body))
        # Again: the same sitting (create-or-resume).
        self.assertEqual(self.prepare()["attempt"]["id"], attempt["id"])
        self.assertEqual(MidtermAttempt.objects.filter(student=self.student).count(), 1)

    def test_the_rules_carry_the_pass_mark_and_the_retake_line(self):
        # A retake on the 100 scale with its own pass mark.
        retake = make_midterm(title="October Retake · Math", scale=Midterm.SCALE_100)
        Midterm.objects.filter(pk=retake.pk).update(
            midterm_type=Midterm.TYPE_RETAKE, retake_of=self.midterm, pass_mark=60
        )
        grant_midterm(self.student, retake)
        body = self.prepare(midterm=retake)
        self.assertContract(body, "midterm_prepare.response")
        rules = body["rules"]
        self.assertEqual((rules["scoring_scale"], rules["pass_mark"], rules["is_retake"]), ("SCALE_100", 60, True))

        # A pre-midterm is never judged pass/fail: no pass mark for the app to quote.
        pre = make_midterm(title="Pre-midterm · Math")
        Midterm.objects.filter(pk=pre.pk).update(midterm_type=Midterm.TYPE_PRE_MIDTERM)
        grant_midterm(self.student, pre)
        body = self.prepare(midterm=pre)
        self.assertContract(body, "midterm_prepare.response")
        rules = body["rules"]
        self.assertEqual((rules["scoring_scale"], rules["pass_mark"], rules["is_retake"]), ("SCALE_800", None, False))

    def test_a_started_sitting_quotes_the_scale_and_mark_it_was_pinned_to(self):
        self.opened()
        Midterm.objects.filter(pk=self.midterm.pk).update(scoring_scale=Midterm.SCALE_100, pass_mark=70)
        rules = self.prepare()["rules"]
        self.assertEqual((rules["scoring_scale"], rules["pass_mark"]), ("SCALE_800", 500))

    def test_the_calculator_follows_the_level_and_foundation_math_has_none(self):
        """Math middle/senior: the full Desmos; junior: Scientific only; Foundation: none —
        worked by hand since 2026-10-11 (Midterm.calculator_mode). The rules screen and the
        runner's tools both carry it."""
        cases = {"senior": "graphing", "middle": "graphing", "junior": "scientific", "foundation": None}
        for level, calculator in cases.items():
            with self.subTest(level=level):
                midterm = make_midterm(title=f"{level} Math", level=level)
                grant_midterm(self.student, midterm)
                body = self.prepare(midterm=midterm)
                self.assertContract(body, "midterm_prepare.response")
                self.assertEqual(body["rules"]["calculator"], calculator)
                opened = self.call("open", body["attempt"]["id"])
                self.assertEqual(opened["test"]["tools"], {"calculator": calculator, "reference_sheet": False})
        rw = make_midterm(title="R&W", subject=Midterm.READING_WRITING, level="junior")
        grant_midterm(self.student, rw)
        self.assertIsNone(self.prepare(midterm=rw)["rules"]["calculator"])

    def test_classroom_code(self):
        room = make_classroom()
        join(room, self.student)
        midterm = make_midterm(title="Class Midterm")
        grant_midterm(self.student, midterm, classroom=room)
        MidtermSchedule.objects.create(classroom=room, midterm=midterm, ignore_start=True, access_code="482913")

        body = self.prepare(midterm=midterm)
        self.assertTrue(body["requires_code"])
        self.assertFalse(body["code_verified"])
        wrong = self.prepare({"code": "000000"}, midterm=midterm, expect=403)
        self.assertContract(wrong, "midterm_prepare.response.code_incorrect")
        self.assertEqual(wrong["code"], "code_incorrect")
        right = self.prepare(fixture("midterm_prepare.request.code"), midterm=midterm)
        self.assertContract(right, "midterm_prepare.response.verified")
        self.assertTrue(right["code_verified"])

        # Open refuses an unverified sitting (another student's view of the same rule).
        other = make_student("other")
        join(room, other)
        grant_midterm(other, midterm, classroom=room)
        other_app = AppClient(other)
        other_id = other_app.post(f"midterms/{midterm.id}/prepare", {}).json()["attempt"]["id"]
        res = other_app.post(f"midterms/attempts/{other_id}/open", {})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["reason"], "code_required")
        self.assertEqual(MidtermAttempt.objects.get(pk=other_id).current_state, MidtermAttempt.STATE_NOT_STARTED)

    def test_start_gate(self):
        self.assertContract(self.prepare(midterm=make_midterm(title="Not mine"), expect=404), "error.404")
        self.assertEqual(self.app.post("midterms/999999/prepare", {}).status_code, 404)
        # Once-only: a finished midterm cannot be prepared again.
        MidtermAttempt.objects.create(
            midterm=self.midterm, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=600,
        )
        body = self.prepare(expect=403)
        self.assertEqual((body["code"], body["reason"]), ("forbidden", "midterm_completed"))

    def test_a_closed_classroom_window_is_refused(self):
        room = make_classroom()
        join(room, self.student)
        midterm = make_midterm(title="Closed")
        grant_midterm(self.student, midterm, classroom=room)
        MidtermSchedule.objects.create(
            classroom=room, midterm=midterm, starts_at=timezone.now() - _dt.timedelta(hours=5),
            deadline=timezone.now() - _dt.timedelta(hours=1), access_code="111111",
        )
        body = self.prepare(midterm=midterm, expect=403)
        self.assertEqual(body["reason"], "midterm_closed")

    @_rates(desktop_v1_code="2/hour", desktop_v1_prepare="5/hour")
    def test_prepare_and_code_guesses_are_rate_limited(self):
        room = make_classroom()
        join(room, self.student)
        midterm = make_midterm(title="Guarded")
        grant_midterm(self.student, midterm, classroom=room)
        MidtermSchedule.objects.create(classroom=room, midterm=midterm, ignore_start=True, access_code="482913")
        for _ in range(2):
            self.prepare({"code": "000000"}, midterm=midterm, expect=403)
        third = self.app.post(f"midterms/{midterm.id}/prepare", {"code": "482913"})
        self.assertEqual(third.status_code, 429)
        assert_shape(self, third.json(), fixture("error.429"))
        self.assertIn("Retry-After", third)
        # Prepares without a code are counted on their own (more generous) budget.
        self.prepare(midterm=midterm)
        self.prepare(midterm=midterm)
        self.assertEqual(self.app.post(f"midterms/{midterm.id}/prepare", {}).status_code, 429)


class OpenTests(MidtermCase):
    def test_open_starts_the_clock_and_ships_the_live_module_only(self):
        attempt_id = self.prepare()["attempt"]["id"]
        body = self.call("open", attempt_id, fixture("midterm_open.request"))
        self.assertContract(body, "midterm_open.response")
        self.assertEqual(body["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertTrue(iso_ms(body["attempt"]["timing"]["deadline_at"]))
        self.assertEqual(len(body["modules"]), 1)
        module = body["modules"][0]
        self.assertEqual(module["id"], self.m1.id)
        self.assertEqual([q["id"] for q in module["questions"]], self.q1)
        self.assertEqual(module["content_hash"], content.content_hash(module["questions"]))
        self.assertNotIn("correct_answers", json.dumps(body))
        self.assertEqual([m["key"] for m in body["media"]], ["question_images/mt-m1-q1.png"])
        self.assertEqual(body["test"]["tools"], {"calculator": "graphing", "reference_sheet": False})
        expires = _dt.datetime.strptime(body["media"][0]["expires_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=_dt.timezone.utc)
        self.assertLessEqual(expires - timezone.now(), _dt.timedelta(minutes=15))
        # Reopening keeps the clock and returns saved answers.
        self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "C"}, flagged=[self.q1[1]])
        again = self.call("open", attempt_id, {"have": {str(self.m1.id): module["content_hash"]}})
        self.assertEqual(again["attempt"]["timing"]["deadline_at"], body["attempt"]["timing"]["deadline_at"])
        self.assertTrue(again["modules"][0]["unchanged"])
        self.assertIsNone(again["modules"][0]["questions"])
        self.assertEqual(again["answers"], {str(self.m1.id): {str(self.q1[0]): "C"}})
        self.assertEqual(again["flagged"], {str(self.m1.id): [self.q1[1]]})

    def test_in_module_2_only_module_2_ships(self):
        attempt_id = self.opened()
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id)
        body = self.call("open", attempt_id)
        self.assertEqual([m["id"] for m in body["modules"]], [self.m2.id])
        self.assertEqual(body["attempt"]["state"], "MODULE_2_ACTIVE")
        self.assertEqual([m["key"] for m in body["media"]], ["question_images/mt-m2-q0.png"])

    def test_a_handed_in_midterm_does_not_open(self):
        attempt_id = self.opened()
        MidtermAttempt.objects.filter(pk=attempt_id).update(current_state=MidtermAttempt.STATE_SCORING)
        body = self.call("open", attempt_id, expect=409)
        self.assertContract(body, "error.409")


class SyncTests(MidtermCase):
    def test_sync_banks_answers_and_never_changes_state(self):
        attempt_id = self.opened()
        body = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "C", str(self.q1[1]): ""}, flagged=[self.q1[2]],
                         key=f"sync.{attempt_id}.{self.m1.id}.5")
        self.assertContract(body, "midterm_sync.response")
        self.assertEqual((body["applied"], body["reason"]), (True, None))
        attempt = MidtermAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.answers[str(self.q1[0])], "C")
        self.assertEqual(attempt.flagged, [self.q1[2]])
        # Past the deadline (inside the grace) it still banks — and still does not move.
        self.expire(attempt_id, extra=30)
        late = self.sync(attempt_id, self.m1.id, {str(self.q1[2]): "B"})
        self.assertTrue(late["applied"])
        self.assertEqual(late["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertEqual(late["attempt"]["timing"]["remaining_ms"], 0)

    def test_late_grace_boundary(self):
        attempt_id = self.opened()
        self.expire(attempt_id, extra=GRACE_S - 3)  # 3 s inside the 300 s grace
        inside = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"})
        self.assertEqual((inside["applied"], inside["reason"]), (True, None))
        self.expire(attempt_id, extra=GRACE_S + 3)  # 3 s past it
        outside = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "D", str(self.q1[1]): "B"})
        self.assertContract(outside, "midterm_sync.response.late")
        self.assertEqual((outside["applied"], outside["reason"]), (False, "late"))
        attempt = MidtermAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.answers, {str(self.q1[0]): "A"})
        self.assertEqual(attempt.current_state, MidtermAttempt.STATE_ACTIVE)

    def test_a_module_1_copy_after_module_2_began_banks_inside_module_1s_grace(self):
        attempt_id = self.opened()
        self.expire(attempt_id, extra=10)
        self.submit(attempt_id, self.m1.id)
        late_copy = self.sync(attempt_id, self.m1.id, {str(self.q1[2]): "B"})
        self.assertTrue(late_copy["applied"])
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers[str(self.q1[2])], "B")
        # Module 2's own question in a module-1 body is ignored.
        self.sync(attempt_id, self.m1.id, {str(self.q2[0]): "A"})
        self.assertNotIn(str(self.q2[0]), MidtermAttempt.objects.get(pk=attempt_id).answers)
        # A sync naming module 2 while on module 1 is never applied.
        fresh = self.opened_other()
        refused = self.sync(fresh, self.m2.id, {str(self.q2[0]): "A"})
        self.assertEqual((refused["applied"], refused["reason"]), (False, "module_not_active"))

    def opened_other(self) -> int:
        student = make_student("second")
        grant_midterm(student, self.midterm)
        self.app = AppClient(student)
        return self.opened()

    def test_replay_returns_the_stored_outcome_with_a_fresh_attempt(self):
        attempt_id = self.opened()
        key = f"sync.{attempt_id}.{self.m1.id}.1"
        first = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"}, key=key)
        self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "B"})
        replay = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"}, key=key)
        self.assertTrue(replay["applied"])
        self.assertGreater(replay["attempt"]["version"], first["attempt"]["version"])
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers[str(self.q1[0])], "B")

    def test_not_running(self):
        attempt_id = self.prepare()["attempt"]["id"]
        body = self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"})
        self.assertEqual((body["applied"], body["reason"]), (False, "module_not_active"))


class SubmitTests(MidtermCase):
    def test_early_submit_is_409_module_not_expired_and_never_cached(self):
        attempt_id = self.opened()
        key = f"submit.{attempt_id}.{self.m1.id}"
        body = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "C"}, key=key, expect=409)
        self.assertContract(body, "midterm_submit.response.not_expired")
        self.assertEqual(body["code"], "module_not_expired")
        self.assertGreater(body["retry_after_ms"], (MODULE_S - 10) * 1000)
        self.assertLessEqual(body["retry_after_ms"], MODULE_S * 1000)
        self.assertEqual(body["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertFalse(MidtermAttemptIdempotencyKey.objects.filter(attempt_id=attempt_id).exists())
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers, {})
        # Just before the deadline: still early, with the small remainder.
        shift_midterm_clock(attempt_id, seconds_ago=MODULE_S - 2)
        close = self.submit(attempt_id, self.m1.id, key=key, expect=409)
        self.assertLessEqual(close["retry_after_ms"], 2000)
        # Once the time is up the SAME key goes through.
        self.expire(attempt_id)
        done = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "C"}, key=key)
        self.assertEqual(done["transitioned_to"], "MODULE_2_ACTIVE")

    def test_module_1_submit_brings_module_2(self):
        attempt_id = self.opened()
        self.expire(attempt_id)
        key = f"submit.{attempt_id}.{self.m1.id}"
        body = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "C", str(self.q1[1]): "B"}, key=key)
        self.assertContract(body, "midterm_submit.response")
        self.assertEqual((body["applied"], body["transitioned_to"]), (True, "MODULE_2_ACTIVE"))
        self.assertEqual(body["next_module"]["id"], self.m2.id)
        self.assertEqual([q["id"] for q in body["next_module"]["questions"]], self.q2)
        self.assertEqual([m["key"] for m in body["media"]], ["question_images/mt-m2-q0.png"])
        self.assertEqual(body["attempt"]["module"]["id"], self.m2.id)
        self.assertIsNone(body["result"])
        # The replay (the answer was lost on the way) brings module 2 again — and is not early.
        replay = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "C"}, key=key)
        self.assertEqual(replay["next_module"]["id"], self.m2.id)
        self.assertEqual(replay["transitioned_to"], "MODULE_2_ACTIVE")
        # A module-1 submit under a new key is a stale-target no-op, never module 2's end.
        stale = self.submit(attempt_id, self.m1.id)
        self.assertEqual((stale["applied"], stale["reason"]), (False, "module_not_active"))
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).current_state, MidtermAttempt.STATE_MODULE_2_ACTIVE)

    def test_final_submit_goes_to_scoring(self):
        attempt_id = self.opened()
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id)
        self.expire(attempt_id, order=2)
        with mock.patch("desktop.v1.midterms.enqueue_midterm_scoring") as enqueue:
            body = self.submit(attempt_id, self.m2.id, {str(self.q2[0]): "B"}, key=f"submit.{attempt_id}.{self.m2.id}")
        self.assertContract(body, "midterm_submit.response.final")
        self.assertEqual(body["transitioned_to"], "SCORING")
        self.assertEqual(body["result"], {"poll_after_ms": 2000})
        self.assertIsNone(body["next_module"])
        self.assertIsNone(body["attempt"]["score"])
        enqueue.assert_called_once()
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers[str(self.q2[0])], "B")

    def test_inside_the_grace_the_submit_banks_its_answers(self):
        attempt_id = self.opened()
        self.expire(attempt_id, extra=GRACE_S - 3)  # 3 s inside the 300 s grace
        body = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "D"})
        self.assertEqual((body["applied"], body["reason"], body["transitioned_to"]), (True, None, "MODULE_2_ACTIVE"))
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers, {str(self.q1[0]): "D"})

    def test_past_the_grace_the_module_still_ends_without_unseen_answers(self):
        attempt_id = self.opened()
        self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"})
        self.expire(attempt_id, extra=GRACE_S + 5)
        body = self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "D", str(self.q1[1]): "C"})
        self.assertEqual((body["applied"], body["reason"], body["transitioned_to"]), (False, "late", "MODULE_2_ACTIVE"))
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers, {str(self.q1[0]): "A"})

    def test_a_module_2_submit_that_arrives_first_is_not_remembered(self):
        attempt_id = self.opened()
        key = f"submit.{attempt_id}.{self.m2.id}"
        early = self.submit(attempt_id, self.m2.id, {str(self.q2[0]): "B"}, key=key)
        self.assertEqual((early["applied"], early["reason"]), (False, "module_not_active"))
        self.assertFalse(MidtermAttemptIdempotencyKey.objects.filter(attempt_id=attempt_id, key=key).exists())
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id)
        self.expire(attempt_id, order=2)
        with mock.patch("desktop.v1.midterms.enqueue_midterm_scoring"):
            final = self.submit(attempt_id, self.m2.id, {str(self.q2[0]): "B"}, key=key)
        self.assertEqual((final["applied"], final["transitioned_to"]), (True, "SCORING"))

    def test_a_late_sync_is_not_remembered_either(self):
        attempt_id = self.opened()
        self.expire(attempt_id, extra=GRACE_S + 3)
        key = f"sync.{attempt_id}.{self.m1.id}.1"
        self.assertEqual(self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"}, key=key)["reason"], "late")
        self.assertFalse(MidtermAttemptIdempotencyKey.objects.filter(attempt_id=attempt_id, key=key).exists())

    def test_a_forfeited_sitting_may_hand_in_early(self):
        attempt_id = self.opened()
        MidtermAttempt.objects.filter(pk=attempt_id).update(offscreen_violations=3)
        body = self.submit(attempt_id, self.m1.id)
        self.assertEqual(body["transitioned_to"], "MODULE_2_ACTIVE")


class OffscreenTests(MidtermCase):
    def test_strikes_are_counted_once_per_key_and_the_third_ends_the_sitting(self):
        attempt_id = self.opened()
        req = fixture("midterm_offscreen.request")
        key = f"off.{attempt_id}.{req['event_id']}"
        first = self.call("offscreen", attempt_id, req, key=key)
        self.assertContract(first, "midterm_offscreen.response")
        self.assertEqual((first["violations"], first["limit"], first["grace_seconds"], first["terminated"]), (1, 3, 3, False))
        self.assertEqual(first["attempt"]["midterm"]["offscreen_violations"], 1)
        replay = self.call("offscreen", attempt_id, req, key=key)
        self.assertEqual(replay["violations"], 1)
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).offscreen_violations, 1)

        self.call("offscreen", attempt_id, {}, key=new_key("off"))
        with mock.patch("desktop.v1.midterms.enqueue_midterm_scoring") as enqueue:
            third = self.call("offscreen", attempt_id, {}, key=new_key("off"))
        self.assertContract(third, "midterm_offscreen.response.terminated")
        self.assertEqual((third["violations"], third["grace_seconds"], third["terminated"]), (3, 0, True))
        self.assertEqual(third["attempt"]["state"], "SCORING")
        self.assertEqual(third["attempt"]["midterm"]["terminated_reason"], "OFFSCREEN")
        enqueue.assert_called_once()
        # A late event from a closing window is a harmless no-op.
        after = self.call("offscreen", attempt_id, {}, key=new_key("off"))
        self.assertEqual((after["violations"], after["terminated"]), (3, True))

    def test_the_third_strike_during_module_2_ends_the_whole_sitting(self):
        attempt_id = self.opened()
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id)
        MidtermAttempt.objects.filter(pk=attempt_id).update(offscreen_violations=2)
        body = self.call("offscreen", attempt_id, {}, key=new_key("off"))
        self.assertTrue(body["terminated"])
        self.assertIn(body["attempt"]["state"], ("SCORING", "COMPLETED"))


class ResultTests(MidtermCase):
    def test_scoring(self):
        attempt_id = self.opened()
        MidtermAttempt.objects.filter(pk=attempt_id).update(current_state=MidtermAttempt.STATE_SCORING)
        res = self.app.get(f"midterms/attempts/{attempt_id}/result")
        self.assertContract(res.json(), "midterm_result.response.scoring")
        self.assertEqual(res.json()["poll_after_ms"], 2000)

    def test_standalone_is_released_on_completion(self):
        attempt_id = self.opened()
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id, {str(self.q1[0]): "B"})
        self.expire(attempt_id, order=2)
        self.submit(attempt_id, self.m2.id)  # scored inline (no broker)
        body = self.app.get(f"midterms/attempts/{attempt_id}/result").json()
        self.assertContract(body, "midterm_result.response.released")
        self.assertTrue(body["released"])
        self.assertEqual(body["scoring_scale"], "SCALE_800")
        self.assertEqual(body["score_ceiling"], 800)
        self.assertIsNotNone(body["total_score"])

    def test_classroom_waits_for_release_then_shows_the_certificate(self):
        room = make_classroom()
        join(room, self.student)
        midterm = make_midterm(title="Class")
        grant_midterm(self.student, midterm, classroom=room)
        schedule = MidtermSchedule.objects.create(classroom=room, midterm=midterm, ignore_start=True, access_code="1")
        attempt = MidtermAttempt.objects.create(
            midterm=midterm, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=680, completed_at=timezone.now(),
        )
        hidden = self.app.get(f"midterms/attempts/{attempt.id}/result").json()
        self.assertContract(hidden, "midterm_result.response.awaiting_release")
        self.assertEqual((hidden["released"], hidden["total_score"], hidden["certificate"]), (False, None, None))
        MidtermSchedule.objects.filter(pk=schedule.pk).update(results_released=True)
        MidtermCertificate.objects.create(
            student=self.student, midterm=midterm, classroom=room, midterm_attempt=attempt,
            flavor=MidtermCertificate.FLAVOR_CLASSROOM, student_name="Aziza Karimova",
            midterm_title=midterm.title, score=680, rank=4, cohort_size=23,
        )
        shown = self.app.get(f"midterms/attempts/{attempt.id}/result").json()
        self.assertContract(shown, "midterm_result.response.released")
        self.assertEqual((shown["total_score"], shown["certificate"]["rank"]), (680, 4))

    def test_not_handed_in_is_a_conflict(self):
        attempt_id = self.opened()
        res = self.app.get(f"midterms/attempts/{attempt_id}/result")
        self.assertEqual(res.status_code, 409)
        assert_shape(self, res.json(), fixture("error.409"))


class MediaTests(MidtermCase):
    def test_live_module_images_only(self):
        attempt_id = self.prepare()["attempt"]["id"]
        self.assertEqual(self.app.get(f"attempts/midterm/{attempt_id}/media").json()["media"], [])
        self.call("open", attempt_id)
        body = self.app.get(f"attempts/midterm/{attempt_id}/media").json()
        self.assertContract(body, "media.response")
        self.assertEqual([m["key"] for m in body["media"]], ["question_images/mt-m1-q1.png"])
        self.expire(attempt_id)
        self.submit(attempt_id, self.m1.id)
        keys = [m["key"] for m in self.app.get(f"attempts/midterm/{attempt_id}/media").json()["media"]]
        self.assertEqual(keys, ["question_images/mt-m2-q0.png"])


class OwnershipTests(MidtermCase):
    def test_another_students_sitting_is_not_visible(self):
        attempt_id = self.opened()
        intruder = AppClient(make_student("intruder"))
        for action in ("open", "sync", "submit", "offscreen"):
            res = intruder.post(f"midterms/attempts/{attempt_id}/{action}", {"module_id": self.m1.id}, key=new_key(action))
            self.assertEqual(res.status_code, 404, action)
            self.assertContract(res.json(), "error.404")
        self.assertEqual(intruder.get(f"midterms/attempts/{attempt_id}/result").status_code, 404)
        self.assertEqual(intruder.get(f"attempts/midterm/{attempt_id}/media").status_code, 404)
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).offscreen_violations, 0)


@override_settings(MIDTERM_DESKTOP_REQUIRED=True, DESKTOP_PROOF_KEYS={KEY_ID: KEY_HEX})
class LockdownTests(MidtermCase):
    """With the rule on, the content and every write need the sitting's lockdown token —
    obtained through the existing challenge/session handshake, exactly as the app does."""

    def handshake(self, attempt_id) -> str:
        site = APIClient()
        site.force_authenticate(self.student)
        base = f"/api/midterms/attempts/{attempt_id}"
        res = site.post(f"{base}/desktop_challenge/", {}, format="json", HTTP_X_MASTERSAT_CLIENT=APP_HEADER)
        self.assertEqual(res.status_code, 200, res.content)
        assert_shape(self, res.json(), fixture("midterm_challenge.response"))
        nonce = res.json()["nonce"]
        proof = {
            "nonce": nonce, "key_id": KEY_ID, "app_version": "0.2.0", "precheck": PRECHECK,
            "mac": sign(secret_hex=KEY_HEX, attempt_id=attempt_id, nonce=nonce, app_version="0.2.0", precheck=PRECHECK),
        }
        assert_shape(self, proof, fixture("midterm_session.request"))
        res = site.post(f"{base}/desktop_session/", proof, format="json", HTTP_X_MASTERSAT_CLIENT=APP_HEADER)
        self.assertEqual(res.status_code, 200, res.content)
        assert_shape(self, res.json(), fixture("midterm_session.response"))
        return res.json()["lockdown_session"]

    def test_the_whole_sitting_through_the_lockdown_token(self):
        prepared = self.prepare()
        self.assertTrue(prepared["attempt"]["midterm"]["desktop_required"])
        attempt_id = prepared["attempt"]["id"]

        refused = self.call("open", attempt_id, expect=403)
        self.assertContract(refused, "error.403.lockdown")
        self.assertEqual(refused["reason"], "desktop_required")
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).current_state, MidtermAttempt.STATE_NOT_STARTED)

        token = self.handshake(attempt_id)
        opened = self.call("open", attempt_id, lockdown=token)
        self.assertEqual(opened["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertTrue(opened["attempt"]["midterm"]["desktop_required"])

        # No token: nothing about the running paper, and nothing written.
        for action, body in (("open", {}), ("sync", {"module_id": self.m1.id, "answers": {str(self.q1[0]): "A"}}),
                             ("submit", {"module_id": self.m1.id}), ("offscreen", {})):
            res = self.app.post(f"midterms/attempts/{attempt_id}/{action}", body, key=new_key(action))
            self.assertEqual(res.status_code, 403, action)
            self.assertEqual(res.json()["reason"], "desktop_required", action)
            self.assertNotIn("questions", json.dumps(res.json()))
        self.assertEqual(self.app.get(f"attempts/midterm/{attempt_id}/media").status_code, 403)
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).answers, {})
        self.assertEqual(MidtermAttempt.objects.get(pk=attempt_id).offscreen_violations, 0)

        # With it, everything works.
        self.assertTrue(self.sync(attempt_id, self.m1.id, {str(self.q1[0]): "A"}, lockdown=token)["applied"])
        self.assertEqual(self.call("offscreen", attempt_id, {}, key=new_key("off"), lockdown=token)["violations"], 1)
        self.assertEqual(self.app.get(f"attempts/midterm/{attempt_id}/media", lockdown=token).status_code, 200)
        self.submit(attempt_id, self.m1.id, lockdown=token, expect=409)

        # The app reopened (a new session): the old token is "replaced", not "required".
        newer = self.handshake(attempt_id)
        stale = self.sync(attempt_id, self.m1.id, {}, lockdown=token, expect=403)
        self.assertEqual(stale["reason"], "desktop_session_replaced")
        self.assertTrue(self.sync(attempt_id, self.m1.id, {str(self.q1[1]): "B"}, lockdown=newer)["applied"])

    def test_the_result_needs_no_token(self):
        attempt_id = self.prepare()["attempt"]["id"]
        token = self.handshake(attempt_id)
        self.call("open", attempt_id, lockdown=token)
        MidtermAttempt.objects.filter(pk=attempt_id).update(
            current_state=MidtermAttempt.STATE_COMPLETED, is_completed=True, score=700,
        )
        self.assertEqual(self.app.get(f"midterms/attempts/{attempt_id}/result").status_code, 200)
