"""Past papers on ``/api/desktop/v1/``: open (resume / restore / create, never abandon, module 2
up front or deferred), start, sync, submit, pause/resume, result — each against its contract
fixture, plus ownership, idempotent replay and the v1 idempotency rules."""

from __future__ import annotations

import datetime as _dt

from django.test import override_settings
from django.utils import timezone

from exams.models import AttemptIdempotencyKey, TestAttempt

from desktop.v1 import content, idem
from desktop.v1.tests.support import (
    AppClient,
    V1TestCase,
    assert_shape,
    fixture,
    iso_ms,
    make_paper,
    make_student,
    module_qids,
    new_key,
    paper_modules,
    shift_pastpaper_clock,
)

NO_INLINE_SCORING = override_settings(CELERY_BROKER_URL="", CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=False)
INLINE_SCORING = override_settings(CELERY_BROKER_URL="", CELERY_TASK_ALWAYS_EAGER=False, EXAMS_SCORE_INLINE_IF_NO_CELERY=True)


class PastpaperCase(V1TestCase):
    def setUp(self):
        super().setUp()
        self.student = make_student()
        self.paper = make_paper(assign_to=self.student)
        self.m1, self.m2 = paper_modules(self.paper)
        self.q1, self.q2 = module_qids(self.m1), module_qids(self.m2)
        self.app = AppClient(self.student)

    def open(self, *, start=False, have=None, expect=200, paper=None):
        res = self.app.post(f"pastpapers/{(paper or self.paper).id}/open", {"start": start, "have": have or {}})
        self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def write(self, action, attempt_id, body=None, *, key=None, expect=200):
        res = self.app.post(f"pastpapers/attempts/{attempt_id}/{action}", body or {}, key=key)
        self.assertEqual(res.status_code, expect, res.content)
        return res.json()

    def started(self) -> int:
        return self.open(start=True)["attempt"]["id"]


class OpenTests(PastpaperCase):
    def test_fresh_open_is_the_whole_test_in_the_contract_shape(self):
        body = self.open(start=False)
        self.assertContract(body, "pastpaper_open.response")
        attempt = body["attempt"]
        self.assertEqual((attempt["kind"], attempt["ref_id"], attempt["state"]), ("pastpaper", self.paper.id, "NOT_STARTED"))
        self.assertEqual(attempt["module"], {"id": self.m1.id, "order": 1, "duration_ms": 35 * 60 * 1000})
        self.assertEqual(attempt["module_ids"], [self.m1.id, self.m2.id])
        self.assertIsNone(attempt["timing"]["deadline_at"])
        self.assertEqual(attempt["timing"]["remaining_ms"], 35 * 60 * 1000)
        self.assertTrue(iso_ms(attempt["timing"]["server_now"]))

        m1, m2 = body["modules"]
        self.assertEqual([q["id"] for q in m1["questions"]], self.q1)
        self.assertEqual([q["id"] for q in m2["questions"]], self.q2)
        self.assertEqual([q["order"] for q in m1["questions"]], [1, 2, 3, 4])
        self.assertFalse(m2["deferred"])
        for module in (m1, m2):
            self.assertEqual(module["content_hash"], content.content_hash(module["questions"]))
            self.assertEqual(module["question_count"], len(module["questions"]))
        # Never the answer key.
        self.assertNotIn("correct_answers", str(body["modules"]))
        self.assertNotIn("explanation", str(body["modules"]))
        # Image KEYS in the content, signed URLs only in `media`, each key once.
        grid_in, figure, pictures = m1["questions"][:3]
        self.assertTrue(grid_in["is_math_input"])
        self.assertIsNone(grid_in["options"])
        self.assertTrue(figure["question_image_key"].startswith("question_images/"))
        self.assertEqual(sorted(pictures["options"]), ["A", "B", "C", "D"])
        keys = [m["key"] for m in body["media"]]
        self.assertEqual(len(keys), 5)
        self.assertEqual(len(set(keys)), 5)
        self.assertIn(figure["question_image_key"], keys)
        self.assertTrue(all(iso_ms(m["expires_at"]) for m in body["media"]))
        self.assertEqual(body["answers"], {str(self.m1.id): {}, str(self.m2.id): {}})
        self.assertEqual(body["flagged"], {str(self.m1.id): [], str(self.m2.id): []})
        self.assertEqual(body["test"]["tools"], {"calculator": "graphing", "reference_sheet": True})

    def test_reading_and_writing_has_no_tools(self):
        rw = make_paper(subject="READING_WRITING", assign_to=self.student, images=False)
        body = self.open(paper=rw)
        self.assertEqual(body["test"]["tools"], {"calculator": None, "reference_sheet": False})

    def test_open_with_start_begins_module_1(self):
        body = self.open(start=True)
        self.assertContract(body, "pastpaper_open.response")
        self.assertEqual(body["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertTrue(iso_ms(body["attempt"]["timing"]["deadline_at"]))

    def test_have_skips_content_the_app_already_holds(self):
        first = self.open()
        have = {str(m["id"]): m["content_hash"] for m in first["modules"]}
        again = self.open(have=have)
        self.assertContract(again, "pastpaper_open.response.cached")
        for module in again["modules"]:
            self.assertTrue(module["unchanged"])
            self.assertIsNone(module["questions"])
        self.assertEqual(again["attempt"]["id"], first["attempt"]["id"])
        # A stale hash gets the content again.
        stale = self.open(have={str(self.m1.id): "sha256:" + "0" * 64})
        self.assertIsNotNone(stale["modules"][0]["questions"])

    def test_resume_returns_saved_answers_flags_and_annotations(self):
        from annotations.models import StudyAnnotation

        attempt_id = self.started()
        self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "B"}, "flagged": [self.q1[2]]}, key=new_key("sync"))
        StudyAnnotation.objects.create(
            student=self.student, scope=StudyAnnotation.SCOPE_EXAM, ref=str(attempt_id), target_id=self.q1[1],
            container="passage", data=[{"start": 0, "end": 4, "kind": "highlight", "color": "yellow"}, {"bogus": 1}],
        )
        body = self.open(start=True)
        self.assertContract(body, "pastpaper_open.response.resume")
        self.assertEqual(body["attempt"]["id"], attempt_id)
        self.assertEqual(body["answers"][str(self.m1.id)], {str(self.q1[1]): "B"})
        self.assertEqual(body["flagged"][str(self.m1.id)], [self.q1[2]])
        self.assertEqual(body["annotations"], [
            {"target_id": self.q1[1], "container": "passage", "data": [{"start": 0, "end": 4, "kind": "highlight", "color": "yellow"}]},
        ])

    def test_reopening_during_module_2_resumes_module_2_and_never_abandons(self):
        attempt_id = self.started()
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 2, "answers": {}}, key=new_key("submit"))
        body = self.open(start=False)
        self.assertEqual(body["attempt"]["id"], attempt_id)
        self.assertEqual(body["attempt"]["state"], "MODULE_2_ACTIVE")
        self.assertEqual(body["attempt"]["module"]["id"], self.m2.id)
        self.assertFalse(TestAttempt.objects.filter(student=self.student, current_state=TestAttempt.STATE_ABANDONED).exists())
        self.assertEqual(TestAttempt.objects.filter(student=self.student).count(), 1)

    def test_an_abandoned_sitting_is_restored_from_its_checkpoint(self):
        attempt_id = self.started()
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 2, "answers": {str(self.q1[1]): "B"}}, key=new_key("submit"))
        TestAttempt.objects.filter(pk=attempt_id).update(
            current_state=TestAttempt.STATE_ABANDONED, abandoned_checkpoint_state=TestAttempt.STATE_MODULE_2_ACTIVE,
            current_module=None, current_module_start_time=None,
        )
        body = self.open(start=False)
        self.assertEqual(body["attempt"]["id"], attempt_id)
        self.assertEqual(body["attempt"]["state"], "MODULE_2_ACTIVE")
        self.assertEqual(body["answers"][str(self.m1.id)], {str(self.q1[1]): "B"})

    @INLINE_SCORING
    def test_after_a_finished_sitting_open_creates_a_new_one(self):
        attempt_id = self.started()
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1}, key=new_key("s"))
        self.write("submit", attempt_id, {"module_id": self.m2.id, "seq": 1}, key=new_key("s"))
        self.assertEqual(TestAttempt.objects.get(pk=attempt_id).current_state, TestAttempt.STATE_COMPLETED)
        body = self.open()
        self.assertNotEqual(body["attempt"]["id"], attempt_id)
        self.assertEqual(body["attempt"]["state"], "NOT_STARTED")

    def test_visibility(self):
        other = make_student("other")
        unassigned = make_paper(assign_to=other, images=False)
        self.assertContract(self.open(paper=unassigned, expect=404), "error.404")
        self.assertEqual(self.app.post("pastpapers/999999/open", {}).status_code, 404)
        empty = make_paper(assign_to=self.student, m1=0, m2=0, images=False)
        body = self.open(paper=empty, expect=400)
        self.assertContract(body, "error.400")
        self.assertEqual(body["code"], "practice_test_empty")

    @override_settings(DESKTOP_V1_SHIP_MODULE_2=False)
    def test_module_2_deferred_then_shipped_with_the_module_1_submit(self):
        body = self.open(start=True)
        self.assertContract(body, "pastpaper_open.response.deferred")
        m1, m2 = body["modules"]
        self.assertIsNotNone(m1["questions"])
        self.assertTrue(m2["deferred"])
        self.assertIsNone(m2["questions"])
        self.assertEqual(m2["question_count"], 3)
        attempt_id = body["attempt"]["id"]
        key = new_key("submit")
        submitted = self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 3}, key=key)
        self.assertContract(submitted, "pastpaper_submit.response.deferred")
        self.assertEqual(submitted["next_module"]["id"], self.m2.id)
        self.assertEqual([q["id"] for q in submitted["next_module"]["questions"]], self.q2)
        # A replay (the first answer was lost) carries module 2 too.
        replay = self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 3}, key=key)
        self.assertEqual(replay["next_module"]["id"], self.m2.id)
        # Reopened during module 2, the live module ships.
        reopened = self.open()
        self.assertFalse(reopened["modules"][1]["deferred"])
        self.assertIsNotNone(reopened["modules"][1]["questions"])


class StartSyncTests(PastpaperCase):
    def test_start_after_the_welcome_screen_and_its_replay(self):
        attempt_id = self.open(start=False)["attempt"]["id"]
        key = f"start.{attempt_id}"
        body = self.write("start", attempt_id, key=key)
        self.assertContract(body, "pastpaper_start.response")
        self.assertEqual(body["attempt"]["state"], "MODULE_1_ACTIVE")
        version = body["attempt"]["version"]
        again = self.write("start", attempt_id, key=key)
        self.assertEqual(again["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertEqual(again["attempt"]["version"], version)

    def test_sync_merges_answers_and_flags_and_clears(self):
        attempt_id = self.started()
        mid = str(self.m1.id)
        req = fixture("pastpaper_sync.request")
        self.assertEqual(sorted(req), ["answers", "flagged", "module_id", "seq"])
        body = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[0]): "7/2", str(self.q1[1]): "C"}, "flagged": [self.q1[1]]}, key=f"sync.{attempt_id}.{mid}.1")
        self.assertContract(body, "pastpaper_sync.response")
        self.assertEqual((body["applied"], body["reason"]), (True, None))
        body = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 2, "answers": {str(self.q1[1]): "", str(self.q1[3]): "B"}, "flagged": []}, key=f"sync.{attempt_id}.{mid}.2")
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.module_answers[mid], {str(self.q1[0]): "7/2", str(self.q1[3]): "B"})
        self.assertEqual(attempt.flagged_questions[mid], [])
        self.assertEqual(attempt.current_state, TestAttempt.STATE_MODULE_1_ACTIVE)

    def test_sync_drops_answers_to_questions_outside_the_module(self):
        attempt_id = self.started()
        self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q2[0]): "A", "99999": "B"}}, key=new_key("sync"))
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.module_answers[str(self.m1.id)], {})

    def test_sync_replay_returns_the_stored_outcome_with_a_fresh_attempt(self):
        attempt_id = self.started()
        key = f"sync.{attempt_id}.{self.m1.id}.1"
        first = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "A"}}, key=key)
        # Something else moves the attempt on (a second sync)…
        self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 2, "answers": {str(self.q1[1]): "D"}}, key=new_key("sync"))
        # …then the first request's retry arrives: same outcome, today's attempt, nothing rewritten.
        replay = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "A"}}, key=key)
        self.assertEqual((replay["applied"], replay["reason"]), (True, None))
        self.assertGreater(replay["attempt"]["version"], first["attempt"]["version"])
        self.assertEqual(TestAttempt.objects.get(pk=attempt_id).module_answers[str(self.m1.id)][str(self.q1[1])], "D")
        row = AttemptIdempotencyKey.objects.get(attempt_id=attempt_id, endpoint=idem.ENDPOINT_SYNC, key=key)
        self.assertEqual(row.response_json, {"outcome": {"applied": True, "reason": None}})

    def test_sync_to_a_module_that_is_not_live_is_not_applied(self):
        attempt_id = self.open(start=False)["attempt"]["id"]
        body = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "A"}}, key=new_key("sync"))
        self.assertContract(body, "pastpaper_sync.response.not_active")
        self.assertEqual((body["applied"], body["reason"]), (False, "module_not_active"))
        attempt_id = self.started()
        body = self.write("sync", attempt_id, {"module_id": self.m2.id, "seq": 1, "answers": {str(self.q2[0]): "A"}}, key=new_key("sync"))
        self.assertEqual((body["applied"], body["reason"]), (False, "module_not_active"))

    def test_sync_never_changes_state_even_after_the_deadline(self):
        attempt_id = self.started()
        shift_pastpaper_clock(attempt_id, seconds_ago=36 * 60)
        body = self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 9, "answers": {str(self.q1[1]): "B"}}, key=new_key("sync"))
        self.assertTrue(body["applied"])
        self.assertEqual(body["attempt"]["state"], "MODULE_1_ACTIVE")
        self.assertEqual(body["attempt"]["timing"]["remaining_ms"], 0)

    def test_bad_bodies(self):
        attempt_id = self.started()
        for bad in ({"seq": 1}, {"module_id": self.m1.id, "answers": ["B"]}, {"module_id": self.m1.id, "answers": {"1": 5}}):
            body = self.write("sync", attempt_id, bad, key=new_key("sync"), expect=400)
            self.assertContract(body, "error.400")


class SubmitTests(PastpaperCase):
    def test_module_1_submit_moves_to_module_2(self):
        attempt_id = self.started()
        mid = str(self.m1.id)
        self.write("sync", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "B", str(self.q1[2]): "C"}}, key=new_key("sync"))
        body = self.write(
            "submit", attempt_id,
            {"module_id": self.m1.id, "seq": 2, "answers": {str(self.q1[0]): "3.5", str(self.q1[2]): ""}, "flagged": [self.q1[0]]},
            key=f"submit.{attempt_id}.{mid}",
        )
        self.assertContract(body, "pastpaper_submit.response")
        self.assertEqual((body["applied"], body["transitioned_to"]), (True, "MODULE_2_ACTIVE"))
        self.assertEqual(body["attempt"]["module"]["id"], self.m2.id)
        self.assertIsNone(body["next_module"])
        self.assertEqual(body["media"], [])
        self.assertIsNone(body["result"])
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.module_answers[mid], {str(self.q1[0]): "3.5", str(self.q1[1]): "B"})
        self.assertEqual(attempt.flagged_questions[mid], [self.q1[0]])

    def test_a_replayed_module_1_submit_never_ends_module_2(self):
        attempt_id = self.started()
        key = f"submit.{attempt_id}.{self.m1.id}"
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1}, key=key)
        replay = self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1}, key=key)
        self.assertEqual((replay["applied"], replay["transitioned_to"]), (True, "MODULE_2_ACTIVE"))
        self.assertEqual(replay["attempt"]["state"], "MODULE_2_ACTIVE")
        # The same module-1 payload under a NEW key (the app lost the key) is a no-op.
        stale = self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1}, key=new_key("submit"))
        self.assertContract(stale, "pastpaper_submit.response.noop")
        self.assertEqual((stale["applied"], stale["reason"], stale["transitioned_to"]), (False, "module_not_active", None))
        self.assertEqual(TestAttempt.objects.get(pk=attempt_id).current_state, TestAttempt.STATE_MODULE_2_ACTIVE)

    @NO_INLINE_SCORING
    def test_final_submit_goes_to_scoring_with_a_poll_hint(self):
        attempt_id = self.started()
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1}, key=new_key("s"))
        body = self.write("submit", attempt_id, {"module_id": self.m2.id, "seq": 1, "answers": {str(self.q2[0]): "B"}}, key=f"submit.{attempt_id}.{self.m2.id}")
        self.assertContract(body, "pastpaper_submit.response.final")
        self.assertEqual(body["transitioned_to"], "SCORING")
        self.assertEqual(body["result"], {"poll_after_ms": 2000})
        self.assertIsNone(body["attempt"]["module"])
        self.assertIsNone(body["attempt"]["timing"]["deadline_at"])

    def test_a_module_1_submit_while_not_started_starts_then_hands_in(self):
        """The welcome screen's background `start` never landed; the student sat module 1
        offline. The submit is the proof: module 1 is kept, not thrown away."""
        attempt_id = self.open(start=False)["attempt"]["id"]
        body = self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[1]): "B"}}, key=new_key("s"))
        self.assertEqual(body["transitioned_to"], "MODULE_2_ACTIVE")
        self.assertEqual(TestAttempt.objects.get(pk=attempt_id).module_answers[str(self.m1.id)], {str(self.q1[1]): "B"})


class PauseResumeTests(PastpaperCase):
    def test_pause_freezes_the_clock_and_resume_banks_it(self):
        attempt_id = self.started()
        paused = self.write("pause", attempt_id)
        self.assertContract(paused, "pastpaper_pause.response")
        self.assertTrue(paused["attempt"]["timing"]["paused"])
        self.assertIsNone(paused["attempt"]["timing"]["deadline_at"])
        frozen = paused["attempt"]["timing"]["remaining_ms"]
        self.assertGreater(frozen, 0)
        self.assertTrue(self.write("pause", attempt_id)["attempt"]["timing"]["paused"])  # idempotent
        TestAttempt.objects.filter(pk=attempt_id).update(pause_started_at=timezone.now() - _dt.timedelta(seconds=120))
        resumed = self.write("resume", attempt_id)
        self.assertContract(resumed, "pastpaper_resume.response")
        self.assertFalse(resumed["attempt"]["timing"]["paused"])
        self.assertTrue(iso_ms(resumed["attempt"]["timing"]["deadline_at"]))
        attempt = TestAttempt.objects.get(pk=attempt_id)
        self.assertGreaterEqual(attempt.module_1_paused_seconds, 120)
        self.assertGreater(resumed["attempt"]["timing"]["remaining_ms"], 35 * 60 * 1000 - 5000)
        self.assertFalse(self.write("resume", attempt_id)["attempt"]["timing"]["paused"])  # idempotent

    def test_pause_outside_a_running_module_is_a_state_conflict(self):
        attempt_id = self.open(start=False)["attempt"]["id"]
        body = self.write("pause", attempt_id, expect=409)
        self.assertContract(body, "error.409")
        self.assertEqual(body["code"], "state_conflict")
        self.assertEqual(body["attempt"]["state"], "NOT_STARTED")


class ResultTests(PastpaperCase):
    def _finish(self):
        attempt_id = self.started()
        self.write("submit", attempt_id, {"module_id": self.m1.id, "seq": 1, "answers": {str(self.q1[0]): "3.5", str(self.q1[1]): "B", str(self.q1[2]): "A"}, "flagged": [self.q1[2]]}, key=new_key("s"))
        self.write("submit", attempt_id, {"module_id": self.m2.id, "seq": 1, "answers": {str(self.q2[0]): "B"}}, key=new_key("s"))
        return attempt_id

    @NO_INLINE_SCORING
    def test_while_scoring(self):
        attempt_id = self._finish()
        res = self.app.get(f"pastpapers/attempts/{attempt_id}/result")
        self.assertEqual(res.status_code, 200)
        self.assertContract(res.json(), "pastpaper_result.response.scoring")
        self.assertEqual(res.json(), {"schema": 1, "attempt_id": attempt_id, "state": "SCORING", "poll_after_ms": 2000})

    @INLINE_SCORING
    def test_completed_result_with_review_content_then_cached(self):
        attempt_id = self._finish()
        res = self.app.get(f"pastpapers/attempts/{attempt_id}/result")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertContract(body, "pastpaper_result.response.completed")
        self.assertEqual(body["totals"], {"questions": 7, "answered": 4, "correct": 3, "incorrect": 1, "skipped": 3})
        rows = {q["id"]: q for q in body["questions"]}
        self.assertTrue(rows[self.q1[0]]["is_correct"])  # "3.5" matches "7/2, 3.5"
        self.assertFalse(rows[self.q1[2]]["is_correct"])
        self.assertTrue(rows[self.q1[2]]["was_flagged"])
        self.assertIsNone(rows[self.q1[3]]["student_answer"])
        self.assertEqual([m["correct"] for m in body["modules"]], [2, 1])
        self.assertIsNotNone(body["score"])
        self.assertTrue(iso_ms(body["completed_at"]))
        have = ",".join(f"{mid}:{block['content_hash']}" for mid, block in body["content"].items())
        cached = self.app.get(f"pastpapers/attempts/{attempt_id}/result?have={have}").json()
        self.assertContract(cached, "pastpaper_result.response.completed_cached")
        self.assertTrue(all(block["questions"] is None for block in cached["content"].values()))
        self.assertEqual(cached["media"], [])

    def test_not_handed_in_yet_is_a_conflict(self):
        attempt_id = self.started()
        res = self.app.get(f"pastpapers/attempts/{attempt_id}/result")
        self.assertEqual(res.status_code, 409)
        assert_shape(self, res.json(), fixture("error.409"))


class OwnershipTests(PastpaperCase):
    def test_another_students_attempt_is_not_visible_anywhere(self):
        attempt_id = self.started()
        intruder = AppClient(make_student("intruder"))
        for action in ("start", "sync", "submit", "pause", "resume"):
            res = intruder.post(f"pastpapers/attempts/{attempt_id}/{action}", {"module_id": self.m1.id, "seq": 1}, key=new_key(action))
            self.assertEqual(res.status_code, 404, action)
            self.assertContract(res.json(), "error.404")
        for path in (f"pastpapers/attempts/{attempt_id}/result", f"attempts/pastpaper/{attempt_id}/media"):
            res = intruder.get(path)
            self.assertEqual(res.status_code, 404, path)
        self.assertEqual(TestAttempt.objects.get(pk=attempt_id).module_answers or {}, {})


class IdempotencyLayerTests(PastpaperCase):
    """``idem.run`` directly: only outcomes below 500 are stored; a crash stores nothing."""

    def test_a_5xx_outcome_is_never_stored_and_the_next_try_runs_again(self):
        attempt = TestAttempt.objects.get(pk=self.started())
        calls = []

        def failing(locked):
            calls.append(1)
            return idem.Outcome(status=503, body={"why": "upstream"})

        def working(locked):
            calls.append(2)
            return idem.Outcome(body={"applied": True})

        self.assertEqual(idem.run(attempt=attempt, endpoint="v1.test", key="k1", compute=failing).status, 503)
        self.assertFalse(AttemptIdempotencyKey.objects.filter(key="k1").exists())
        out = idem.run(attempt=attempt, endpoint="v1.test", key="k1", compute=working)
        self.assertEqual((out.status, out.body, out.replayed), (200, {"applied": True}, False))
        replay = idem.run(attempt=attempt, endpoint="v1.test", key="k1", compute=working)
        self.assertEqual((replay.body, replay.replayed), ({"applied": True}, True))
        self.assertEqual(calls, [1, 2])

    def test_an_exception_stores_nothing(self):
        attempt = TestAttempt.objects.get(pk=self.started())

        def boom(locked):
            raise RuntimeError("db went away")

        with self.assertRaises(RuntimeError):
            idem.run(attempt=attempt, endpoint="v1.test", key="k2", compute=boom)
        self.assertFalse(AttemptIdempotencyKey.objects.filter(key="k2").exists())

    def test_an_expired_key_is_computed_again(self):
        attempt = TestAttempt.objects.get(pk=self.started())
        idem.run(attempt=attempt, endpoint="v1.test", key="k3", compute=lambda locked: idem.Outcome(body={"n": 1}))
        AttemptIdempotencyKey.objects.filter(key="k3").update(expires_at=timezone.now() - _dt.timedelta(seconds=1))
        out = idem.run(attempt=attempt, endpoint="v1.test", key="k3", compute=lambda locked: idem.Outcome(body={"n": 2}))
        self.assertEqual((out.body, out.replayed), ({"n": 2}, False))
        self.assertEqual(AttemptIdempotencyKey.objects.filter(key="k3").count(), 1)

    def test_outcomes_marked_do_not_store_are_not_stored(self):
        attempt = TestAttempt.objects.get(pk=self.started())
        idem.run(attempt=attempt, endpoint="v1.test", key="k4", compute=lambda locked: idem.Outcome(body={}, store=False))
        self.assertFalse(AttemptIdempotencyKey.objects.filter(key="k4").exists())


class MediaTests(PastpaperCase):
    def test_fresh_urls_for_this_attempts_images_only(self):
        attempt_id = self.started()
        other_paper = make_paper(assign_to=self.student)
        AppClient(self.student).post(f"pastpapers/{other_paper.id}/open", {"start": True})
        res = self.app.get(f"attempts/pastpaper/{attempt_id}/media")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertContract(body, "media.response")
        self.assertEqual((body["attempt_id"], body["kind"]), (attempt_id, "pastpaper"))
        keys = {m["key"] for m in body["media"]}
        self.assertEqual(len(keys), 5)
        self.assertTrue(all(k.startswith((f"question_images/{self.paper.id}-", "option_images/")) for k in keys), keys)
        self.assertFalse(any(k.startswith(f"question_images/{other_paper.id}-") for k in keys))

    @override_settings(DESKTOP_V1_SHIP_MODULE_2=False)
    def test_a_deferred_module_contributes_no_images(self):
        rw = make_paper(subject="READING_WRITING", assign_to=self.student, images=False)
        from exams.models import Question

        Question.objects.filter(module=paper_modules(rw)[1]).update(question_image="question_images/m2-secret.png")
        attempt_id = self.open(paper=rw, start=True)["attempt"]["id"]
        keys = {m["key"] for m in self.app.get(f"attempts/pastpaper/{attempt_id}/media").json()["media"]}
        self.assertNotIn("question_images/m2-secret.png", keys)

    def test_an_unknown_kind_is_not_visible(self):
        attempt_id = self.started()
        self.assertEqual(self.app.get(f"attempts/mock/{attempt_id}/media").status_code, 404)
