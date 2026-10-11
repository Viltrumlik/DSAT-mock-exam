"""``GET /api/desktop/v1/home``: the contract shape, the library states (incl. "assigned again"),
the midterm rows against ``/api/midterms/mine/``, the Windows release policy, ETag/304, and the
query budget."""

from __future__ import annotations

import datetime as _dt

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from classes.models import Assignment
from classes.models_certificates import MidtermCertificate
from classes.models_schedule import MidtermSchedule
from exams.models import TestAttempt
from midterms.models import MidtermAttempt, MidtermResit
from mobile.models import AppReleasePolicy
from mobile.policy import forget_policy
from mobile.versioning import PLATFORM_WINDOWS

from desktop.v1.home import etag_for

from .support import (
    AppClient,
    V1TestCase,
    fixture,
    grant_midterm,
    iso_ms,
    join,
    make_classroom,
    make_midterm,
    make_paper,
    make_student,
)


def _finished(pt, student, *, score=600, days_ago=3):
    when = timezone.now() - _dt.timedelta(days=days_ago)
    return TestAttempt.objects.create(
        practice_test=pt, student=student, score=score, current_state=TestAttempt.STATE_COMPLETED,
        is_completed=True, completed_at=when, submitted_at=when,
    )


class HomeFixtureMixin:
    """A student with one paper in each library state and a classroom + a standalone midterm."""

    def build(self):
        self.student = make_student()
        self.room = make_classroom()
        join(self.room, self.student)
        teacher = self.room.created_by

        self.new = make_paper(assign_to=self.student, label="A", practice_date=_dt.date(2025, 10, 4))
        self.progress = make_paper(subject="READING_WRITING", assign_to=self.student, label="A")
        self.done = make_paper(assign_to=self.student, label="B", practice_date=_dt.date(2025, 8, 23))
        self.again = make_paper(assign_to=self.student, label="C", practice_date=_dt.date(2025, 6, 7))
        make_paper(label="Z")  # not assigned: never on Home

        open_res = AppClient(self.student).post(f"pastpapers/{self.progress.id}/open", {"start": True})
        self.assertEqual(open_res.status_code, 200, open_res.content)
        self.progress_attempt_id = open_res.json()["attempt"]["id"]
        self.done_old = _finished(self.done, self.student, score=590, days_ago=20)
        self.done_new = _finished(self.done, self.student, score=640, days_ago=5)
        self.again_sitting = _finished(self.again, self.student, score=610, days_ago=10)
        # A published homework set after that sitting: the paper is "assigned again".
        self.homework = Assignment.objects.create(
            classroom=self.room, created_by=teacher, title="Retake: June Math",
            category=Assignment.CATEGORY_HOMEWORK, status=Assignment.STATUS_PUBLISHED,
            practice_test=self.again, due_at=timezone.now() + _dt.timedelta(days=5),
        )
        Assignment.objects.filter(pk=self.homework.pk).update(created_at=timezone.now() - _dt.timedelta(days=2))

        # Midterms: a classroom one with an access code (open now), a standalone finished one.
        self.class_mt = make_midterm(title="October Midterm · Math")
        grant_midterm(self.student, self.class_mt, classroom=self.room)
        MidtermSchedule.objects.create(
            classroom=self.room, midterm=self.class_mt, starts_at=timezone.now() - _dt.timedelta(minutes=30),
            deadline=timezone.now() + _dt.timedelta(hours=3), access_code="482913",
        )
        self.solo_mt = make_midterm(title="September Midterm · Reading and Writing", subject="READING_WRITING",
                                    scale="SCALE_100")
        grant_midterm(self.student, self.solo_mt)
        self.solo_attempt = MidtermAttempt.objects.create(
            midterm=self.solo_mt, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=71, completed_at=timezone.now(),
        )


class HomeShapeTests(HomeFixtureMixin, V1TestCase):
    def setUp(self):
        super().setUp()
        self.build()
        self.client_app = AppClient(self.student)

    def test_matches_the_contract_field_for_field(self):
        res = self.client_app.get("home")
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()
        self.assertContract(body, "home.response")
        self.assertEqual(body["schema"], 1)
        self.assertTrue(iso_ms(body["server_now"]))
        self.assertEqual(body["student"], {"id": self.student.id, "first_name": "Aziza", "last_name": "Karimova"})

    def test_library_states_new_progress_completed_and_assigned_again(self):
        rows = {r["id"]: r for r in self.client_app.get("home").json()["pastpapers"]}
        self.assertEqual(len(rows), 4, "only the student's assigned papers")

        new = rows[self.new.id]["state"]
        self.assertEqual((new["status"], new["sittings"], new["open_attempt_id"]), ("new", 0, None))
        self.assertEqual(rows[self.new.id]["history"], [])
        self.assertEqual(rows[self.new.id]["modules"], [
            {"order": 1, "time_limit_minutes": 35, "question_count": 4},
            {"order": 2, "time_limit_minutes": 35, "question_count": 3},
        ])

        progress = rows[self.progress.id]["state"]
        self.assertEqual(progress["status"], "progress")
        self.assertEqual(progress["open_attempt_id"], self.progress_attempt_id)
        self.assertEqual(progress["open_state"], "MODULE_1_ACTIVE")

        done = rows[self.done.id]
        self.assertEqual(done["state"]["status"], "completed")
        self.assertEqual(done["state"]["last_attempt_id"], self.done_new.id)
        self.assertEqual(done["state"]["last_score"], 640)
        self.assertEqual(done["state"]["sittings"], 2)
        self.assertEqual([h["attempt_id"] for h in done["history"]], [self.done_new.id, self.done_old.id])
        self.assertEqual([h["score"] for h in done["history"]], [640, 590])
        self.assertTrue(all(iso_ms(h["completed_at"]) for h in done["history"]))

        again = rows[self.again.id]["state"]
        self.assertEqual(again["status"], "reopened")
        self.assertEqual(again["reopened"]["assignment_id"], self.homework.id)
        self.assertEqual(again["reopened"]["assignment_title"], "Retake: June Math")
        self.assertEqual(again["reopened"]["classroom_name"], "SAT Evening B")
        self.assertTrue(iso_ms(again["reopened"]["set_at"]))
        self.assertTrue(iso_ms(again["reopened"]["due_at"]))

    def test_a_sitting_after_the_homework_clears_assigned_again(self):
        _finished(self.again, self.student, score=650, days_ago=1)
        row = next(r for r in self.client_app.get("home").json()["pastpapers"] if r["id"] == self.again.id)
        self.assertEqual(row["state"]["status"], "completed")
        self.assertIsNone(row["state"]["reopened"])
        self.assertEqual(row["state"]["sittings"], 2)

    def test_an_abandoned_sitting_after_the_last_finish_is_still_in_progress(self):
        """v1 ``open`` restores it, so Home must offer Resume — not Start."""
        abandoned = TestAttempt.objects.create(
            practice_test=self.done, student=self.student, current_state=TestAttempt.STATE_ABANDONED,
            abandoned_checkpoint_state=TestAttempt.STATE_MODULE_2_ACTIVE,
        )
        row = next(r for r in self.client_app.get("home").json()["pastpapers"] if r["id"] == self.done.id)
        self.assertEqual(row["state"]["status"], "progress")
        self.assertEqual(row["state"]["open_attempt_id"], abandoned.id)
        self.assertEqual(row["state"]["open_state"], "ABANDONED")

    def test_midterm_rows(self):
        rows = {r["midterm_id"]: r for r in self.client_app.get("home").json()["midterms"]}
        cls = rows[self.class_mt.id]
        self.assertEqual(cls["flavor"], "CLASSROOM")
        self.assertTrue(cls["requires_code"])
        self.assertTrue(cls["is_open"])
        self.assertEqual(cls["state"], "NOT_STARTED")
        self.assertTrue(iso_ms(cls["available_at"]) and iso_ms(cls["deadline"]))
        self.assertEqual(cls["question_count"], 5)
        solo = rows[self.solo_mt.id]
        self.assertEqual(solo["flavor"], "STANDALONE")
        self.assertFalse(solo["requires_code"])
        self.assertEqual((solo["state"], solo["submitted"], solo["score"]), ("COMPLETED", True, 71))
        self.assertIsNone(solo["available_at"])

    def test_wire_state_names_for_a_running_midterm(self):
        MidtermAttempt.objects.create(
            midterm=self.class_mt, student=self.student, current_state=MidtermAttempt.STATE_ACTIVE,
            started_at=timezone.now(),
        )
        row = next(r for r in self.client_app.get("home").json()["midterms"] if r["midterm_id"] == self.class_mt.id)
        self.assertEqual(row["state"], "MODULE_1_ACTIVE")


class HomeMidtermParityTests(HomeFixtureMixin, V1TestCase):
    """Home's batched midterm rows are ``/api/midterms/mine/``'s, field for field, across the
    flavours and release states that view distinguishes."""

    def setUp(self):
        super().setUp()
        self.build()

    def _compare(self):
        website = APIClient()
        website.force_authenticate(self.student)
        theirs = website.get("/api/midterms/mine/").json()["results"]
        ours = AppClient(self.student).get("home").json()["midterms"]
        self.assertEqual([r["midterm_id"] for r in ours], [r["midterm_id"] for r in theirs])
        from desktop.v1.conventions import iso_from_string
        from midterms.state_machine import WIRE_STATE

        for mine, web in zip(ours, theirs):
            expected = dict(web)
            expected["available_at"] = iso_from_string(web["available_at"])
            expected["deadline"] = iso_from_string(web["deadline"])
            expected["state"] = WIRE_STATE.get(web["state"], web["state"])
            got = {k: v for k, v in mine.items() if k != "requires_code"}
            self.assertEqual(got, expected, f"midterm {web['midterm_id']}")
        return ours

    def test_parity_baseline(self):
        self._compare()

    def test_parity_before_start_awaiting_code_released_certificate_resit_and_unpublished(self):
        # Before start.
        later = make_midterm(title="Later Midterm")
        grant_midterm(self.student, later, classroom=self.room)
        MidtermSchedule.objects.create(
            classroom=self.room, midterm=later, starts_at=timezone.now() + _dt.timedelta(days=1),
            deadline=timezone.now() + _dt.timedelta(days=1, hours=3), access_code="111111",
        )
        # Open window, no code yet → awaiting_code.
        waiting = make_midterm(title="Waiting Midterm")
        grant_midterm(self.student, waiting, classroom=self.room)
        MidtermSchedule.objects.create(classroom=self.room, midterm=waiting, ignore_start=True)
        # A finished classroom midterm whose results are released, with a certificate.
        released = make_midterm(title="Released Midterm")
        grant_midterm(self.student, released, classroom=self.room)
        MidtermSchedule.objects.create(classroom=self.room, midterm=released, results_released=True, access_code="222222")
        att = MidtermAttempt.objects.create(
            midterm=released, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=680, completed_at=timezone.now(),
        )
        MidtermCertificate.objects.create(
            student=self.student, midterm=released, classroom=self.room, midterm_attempt=att,
            flavor=MidtermCertificate.FLAVOR_CLASSROOM, student_name="Aziza Karimova",
            midterm_title=released.title, score=680, rank=4, cohort_size=23,
        )
        # A finished classroom midterm NOT released: score hidden.
        hidden = make_midterm(title="Hidden Midterm")
        grant_midterm(self.student, hidden, classroom=self.room)
        MidtermSchedule.objects.create(classroom=self.room, midterm=hidden, access_code="333333")
        MidtermAttempt.objects.create(
            midterm=hidden, student=self.student, current_state=MidtermAttempt.STATE_COMPLETED,
            is_completed=True, score=500, completed_at=timezone.now(),
        )
        # A re-sit granted on the standalone midterm.
        MidtermResit.objects.create(midterm=self.solo_mt, student=self.student)
        # Unpublished + granted: invisible. Unpublished + attempted: visible.
        draft = make_midterm(title="Draft Midterm")
        draft.is_published = False
        draft.save(update_fields=["is_published"])
        grant_midterm(self.student, draft)

        ours = self._compare()
        by_id = {r["midterm_id"]: r for r in ours}
        self.assertNotIn(draft.id, by_id)
        self.assertTrue(by_id[later.id]["is_before_start"])
        self.assertTrue(by_id[waiting.id]["awaiting_code"])
        self.assertFalse(by_id[waiting.id]["requires_code"])
        self.assertEqual(by_id[released.id]["certificate"]["rank"], 4)
        self.assertEqual(by_id[released.id]["score"], 680)
        self.assertIsNone(by_id[hidden.id]["score"])
        self.assertFalse(by_id[hidden.id]["results_visible"])
        self.assertTrue(by_id[self.solo_mt.id]["resit_open"])


class HomeCachingAndPolicyTests(HomeFixtureMixin, V1TestCase):
    def setUp(self):
        super().setUp()
        self.build()
        self.client_app = AppClient(self.student)

    def tearDown(self):
        forget_policy(PLATFORM_WINDOWS)
        super().tearDown()

    def test_etag_and_if_none_match_304(self):
        first = self.client_app.get("home")
        etag = first["ETag"]
        self.assertRegex(etag, r'^"sha256:[0-9a-f]{64}"$')
        body = first.json()
        self.assertEqual(etag, etag_for({k: v for k, v in body.items() if k != "server_now"}))

        again = self.client_app.get("home", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(again.status_code, 304)
        self.assertEqual(again.content, b"")
        self.assertEqual(again["ETag"], etag)

        # Something the student would see changes → a new body and a new ETag.
        AppClient(self.student).post(f"pastpapers/{self.new.id}/open", {"start": False})
        changed = self.client_app.get("home", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(changed.status_code, 200)
        self.assertNotEqual(changed["ETag"], etag)

    def test_etag_is_per_student(self):
        other = make_student("other")
        etag = self.client_app.get("home")["ETag"]
        self.assertEqual(AppClient(other).get("home", HTTP_IF_NONE_MATCH=etag).status_code, 200)

    def test_app_block_reads_the_windows_release_policy(self):
        app = self.client_app.get("home").json()["app"]
        self.assertEqual(app["update"], "none")
        self.assertEqual(app["update_url"], "https://mastersat.uz/downloads/desktop/MasterSAT-Setup.exe")

        AppReleasePolicy.objects.create(
            platform=PLATFORM_WINDOWS, minimum_version="0.2.0", latest_version="0.2.3",
            message="A newer MasterSAT app is ready.",
        )
        forget_policy(PLATFORM_WINDOWS)
        res = self.client_app.get("home")
        body = res.json()
        self.assertContract(body, "home.response.update_available")
        self.assertEqual(body["app"]["latest_version"], "0.2.3")
        self.assertEqual(body["app"]["minimum_version"], "0.2.0")
        self.assertEqual(body["app"]["update"], fixture("home.response.update_available")["app"]["update"])
        self.assertEqual(body["app"]["message"], "A newer MasterSAT app is ready.")


class HomeQueryBudgetTests(V1TestCase):
    """One response, a fixed number of queries: more papers, more sittings and more midterms
    must not add a single query."""

    BUDGET = 16  # measured: 15 (10 midterm, 3 library, 2 reopened check)

    def _count(self, student) -> int:
        client = AppClient(student)
        client.get("home")  # warm the release-policy cache, like every request after the first
        with CaptureQueriesContext(connection) as ctx:
            res = client.get("home")
        self.assertEqual(res.status_code, 200)
        return len(ctx.captured_queries)

    def _world(self, username: str, *, papers: int, sittings: int, midterms: int):
        student = make_student(username)
        room = make_classroom(teacher_username=f"t-{username}")
        join(room, student)
        for i in range(papers):
            pt = make_paper(assign_to=student, label=chr(65 + i), images=False)
            for s in range(sittings):
                _finished(pt, student, score=500 + s, days_ago=30 - s)
            if i % 2:
                TestAttempt.objects.create(practice_test=pt, student=student)
        for i in range(midterms):
            mt = make_midterm(title=f"Midterm {username} {i}")
            if i % 2:
                grant_midterm(student, mt, classroom=room)
                MidtermSchedule.objects.create(classroom=room, midterm=mt, access_code="123456", results_released=True)
                MidtermAttempt.objects.create(
                    midterm=mt, student=student, current_state=MidtermAttempt.STATE_COMPLETED,
                    is_completed=True, score=600, completed_at=timezone.now(),
                )
            else:
                grant_midterm(student, mt)
        # The reopened check runs: a finished paper set again by a homework.
        pt = make_paper(assign_to=student, label="R", images=False)
        _finished(pt, student, days_ago=9)
        Assignment.objects.create(
            classroom=room, created_by=room.created_by, title="again", category=Assignment.CATEGORY_HOMEWORK,
            status=Assignment.STATUS_PUBLISHED, practice_test=pt,
        )
        return student

    def test_query_count_does_not_grow_with_history(self):
        small = self._count(self._world("small", papers=1, sittings=1, midterms=2))
        large = self._count(self._world("large", papers=6, sittings=4, midterms=8))
        self.assertEqual(small, large, "a query per paper, sitting or midterm crept into Home")
        self.assertLessEqual(large, self.BUDGET)

    def test_an_empty_home_is_cheap(self):
        self.assertLessEqual(self._count(make_student("empty")), 12)
