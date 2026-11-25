"""The toolbox API: status, the time machine, the action log and the browser clock (Part A, Task A3).

The time machine is ``deploy/staging/stg_timemachine.py`` (root, on the server); these tests stand in for it by
writing its ``state.json`` into a temporary ``STAGING_TM_DIR`` and reading the request files the API leaves there.
A call the API refuses goes through ``refused()``: Django logs every 4xx/5xx answer, which is expected there."""

import json
import shutil
import tempfile
import time
from datetime import date
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from staging.models import ToolboxAction

User = get_user_model()
ADMIN_HOST = "admin.mastersat-test.example"
MAIN_HOST = "mastersat-test.example"
TEACHER_HOST = "teacher.mastersat-test.example"
HOSTS = override_settings(ALLOWED_HOSTS=[ADMIN_HOST, MAIN_HOST, TEACHER_HOST])
TODAY = date(2026, 11, 25)
PATHS = ("/api/staging/status/", "/api/staging/time/", "/api/staging/actions/")


@HOSTS
class ToolboxApiCase(TestCase):
    copy = True

    def setUp(self):
        self.tm_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tm_dir, True)
        names = {"STAGING_TM_DIR": str(self.tm_dir)}
        if self.copy:
            names.update(STAGING_TOOLBOX=True, STAGING_DB_NAME=connection.settings_dict["NAME"])
        switch = override_settings(**names)
        switch.enable()
        self.addCleanup(switch.disable)
        self.admin = User.objects.create_user(
            None, password=None, username="boss", role="admin", first_name="Aziz", last_name="Karimov"
        )

    def call(self, method, path, data=None, *, user=None, host=ADMIN_HOST, authenticate=True):
        api = APIClient()
        if authenticate:
            api.force_authenticate(user or self.admin)
        return getattr(api, method)(path, data, format="json", HTTP_HOST=host)

    def refused(self, method, path, data=None, **kw):
        """A call the API refuses: Django logs the answer as a warning (an error for a 5xx), as it should."""
        with self.assertLogs("django.request", level="WARNING"):
            return self.call(method, path, data, **kw)

    def state(self, **fields):
        state = {"offset_days": 0, "test_date": "2026-11-25", "checkpoints": [], "busy": None, "last": None, "history": []}
        state.update(fields)
        (self.tm_dir / "state.json").write_text(json.dumps(state))

    def requests(self) -> list[dict]:
        return [json.loads(p.read_text()) for p in sorted((self.tm_dir / "requests").glob("*.json"))]

    def post_time(self, body, *, refused=False, **kw):
        with mock.patch("staging.views._today", return_value=TODAY):
            return (self.refused if refused else self.call)("post", "/api/staging/time/", body, **kw)


class OffTheCopyTests(ToolboxApiCase):
    copy = False

    def test_every_endpoint_is_not_found(self):
        for path in PATHS:
            self.assertEqual(self.refused("get", path).status_code, 404, path)
        self.assertEqual(self.post_time({"action": "forward", "days": 1}, refused=True).status_code, 404)
        self.assertFalse((self.tm_dir / "requests").exists())

    def test_not_found_before_anyone_is_asked_who_they_are(self):
        for path in PATHS:
            self.assertEqual(self.refused("get", path, authenticate=False, host=MAIN_HOST).status_code, 404, path)

    def test_the_clock_script_is_empty_and_not_found(self):
        response = self.refused("get", "/api/staging/clock.js", authenticate=False, host=MAIN_HOST)
        self.assertEqual((response.status_code, response.content), (404, b""))


class WhoMayTests(ToolboxApiCase):
    def test_the_owner_and_an_admin_get_in(self):
        owner = User.objects.create_user(None, password=None, username="owner", role="super_admin")
        with mock.patch("staging.views._worker_alive", return_value=True):
            for user in (self.admin, owner):
                for path in PATHS:
                    self.assertEqual(self.call("get", path, user=user).status_code, 200, path)

    def test_a_student_and_a_teacher_are_refused(self):
        student = User.objects.create_user(None, password=None, username="s", role="student")
        teacher = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        for user in (student, teacher):
            for path in PATHS:
                self.assertEqual(self.refused("get", path, user=user, host=MAIN_HOST).status_code, 403, path)
            self.assertEqual(self.post_time({"action": "today"}, user=user, host=MAIN_HOST, refused=True).status_code, 403)
        self.assertEqual(self.requests(), [])

    def test_an_accountant_is_refused(self):
        accountant = User.objects.create_user(None, password=None, username="a", role="accountant")
        self.assertEqual(self.refused("get", "/api/staging/status/", user=accountant).status_code, 403)


class TimeMachineTests(ToolboxApiCase):
    def lock(self, *, age: float):
        """The lock file a worker holds while it writes a request, taken ``age`` seconds ago."""
        folder = self.tm_dir / "requests"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / ".ask.lock").write_text(str(time.time() - age))

    def test_forward_two_days_leaves_one_request_for_the_time_machine(self):
        response = self.post_time({"action": "forward", "days": 2})
        self.assertEqual(response.status_code, 202)
        [request] = self.requests()
        self.assertEqual(
            {k: request[k] for k in ("id", "action", "days", "by")},
            {"id": response.data["id"], "action": "forward", "days": 2, "by": "Aziz Karimov"},
        )
        # Written whole, and the lock released: nothing but the request itself is left in the directory.
        self.assertEqual([p.suffix for p in (self.tm_dir / "requests").iterdir()], [".json"])

    def test_a_second_request_while_one_waits_is_a_conflict(self):
        self.assertEqual(self.post_time({"action": "forward", "days": 1}).status_code, 202)
        response = self.post_time({"action": "forward", "days": 1}, refused=True)
        self.assertEqual(response.status_code, 409)
        self.assertIn("waiting", response.data["detail"])
        self.assertEqual(len(self.requests()), 1)

    def test_a_request_being_written_at_the_same_moment_is_a_conflict(self):
        self.lock(age=1)
        response = self.post_time({"action": "today"}, refused=True)
        self.assertEqual(response.status_code, 409)
        self.assertIn("being made", response.data["detail"])
        self.assertEqual(self.requests(), [])

    def test_a_lock_left_by_a_dead_worker_is_taken_over_and_released(self):
        self.lock(age=120)
        self.assertEqual(self.post_time({"action": "today"}).status_code, 202)
        self.assertEqual([p.suffix for p in (self.tm_dir / "requests").iterdir()], [".json"])

    def test_a_folder_that_cannot_be_written_is_a_503_and_logged(self):
        (self.tm_dir / "requests").write_text("a file where the folder should be")
        response = self.post_time({"action": "today"}, refused=True)
        self.assertEqual(response.status_code, 503)
        self.assertIn("cannot be written", response.data["detail"])
        row = ToolboxAction.objects.get()
        self.assertEqual((row.user, row.action), (self.admin, "time.today"))
        self.assertIn("cannot be written", row.detail["refused"])

    def test_a_busy_time_machine_is_a_conflict(self):
        self.state(busy={"id": "x", "action": "forward", "params": {"days": 1}, "by": "Owner", "started_at": "…"})
        response = self.post_time({"action": "today"}, refused=True)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.requests(), [])

    def test_to_a_date_is_forward_by_the_days_between(self):
        response = self.post_time({"action": "to", "date": "2026-12-01"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual((self.requests()[0]["action"], self.requests()[0]["days"]), ("forward", 6))

    def test_to_a_past_date_or_today_is_refused(self):
        for day in ("2026-11-20", "2026-11-25", "2026-02-30", "soon"):
            self.assertEqual(self.post_time({"action": "to", "date": day}, refused=True).status_code, 400, day)
        self.assertEqual(self.requests(), [])

    def test_days_outside_1_to_60_are_refused(self):
        for days in (0, 61, -1, "2", None, True):
            self.assertEqual(self.post_time({"action": "forward", "days": days}, refused=True).status_code, 400, days)
        self.assertEqual(self.post_time({"action": "to", "date": "2027-02-01"}, refused=True).status_code, 400)  # 68 days
        self.assertEqual(self.requests(), [])

    def test_back_to_a_checkpoint(self):
        self.state(checkpoints=[{"id": 0, "kind": "base"}, {"id": 3, "kind": "jump"}])
        self.assertEqual(self.post_time({"action": "back", "checkpoint": 7}, refused=True).status_code, 400)
        self.assertEqual(self.post_time({"action": "back", "checkpoint": 3}).status_code, 202)
        self.assertEqual({k: self.requests()[0][k] for k in ("action", "checkpoint")}, {"action": "back", "checkpoint": 3})

    def test_today_and_refresh_need_nothing_else(self):
        self.assertEqual(self.post_time({"action": "refresh"}).status_code, 202)
        self.assertEqual(self.requests()[0]["action"], "refresh")
        self.assertEqual(self.post_time({"action": "fly"}, refused=True).status_code, 400)

    def test_every_post_is_written_to_the_action_log(self):
        self.post_time({"action": "forward", "days": 2})
        self.post_time({"action": "forward", "days": 99}, refused=True)
        rows = list(ToolboxAction.objects.order_by("id"))
        self.assertEqual([(r.user, r.action) for r in rows], [(self.admin, "time.forward"), (self.admin, "time.forward")])
        self.assertEqual(rows[0].detail["days"], 2)
        self.assertIn("refused", rows[1].detail)
        log = self.call("get", "/api/staging/actions/").data
        self.assertEqual([(row["action"], row["by"]) for row in log], [("time.forward", "Aziz Karimov")] * 2)
        self.assertIn("refused", log[0]["detail"])

    def test_the_test_date_is_the_copys_own_today_not_the_snapshot_in_the_file(self):
        # The machine writes test_date when it saves; after real midnight that snapshot is a day behind the copy.
        self.state(offset_days=2, test_date="2026-11-27")
        with mock.patch("staging.timemachine._today", return_value=date(2026, 11, 28)):
            data = self.call("get", "/api/staging/time/").data
        self.assertEqual((data["offset_days"], data["test_date"], data["pending"]), (2, "2026-11-28", False))
        self.post_time({"action": "forward", "days": 1})
        self.assertTrue(self.call("get", "/api/staging/time/").data["pending"])

    def test_no_state_file_yet_reads_as_today_with_nothing_done(self):
        data = self.call("get", "/api/staging/time/").data
        self.assertEqual(
            (data["offset_days"], data["checkpoints"], data["busy"], data["last"], data["history"]), (0, [], None, None, [])
        )


class StatusTests(ToolboxApiCase):
    def test_the_status_of_the_copy(self):
        self.state(offset_days=3, checkpoints=[
            {"id": 0, "kind": "base", "label": "Copy of prod", "taken_at": "2026-11-22T18:42:00+05:00"},
            {"id": 1, "kind": "jump", "label": "Before +3 days", "taken_at": "2026-11-25T10:00:00+05:00"},
        ])
        with mock.patch("staging.views._worker_alive", return_value=True):
            data = self.call("get", "/api/staging/status/").data
        self.assertEqual(
            (data["database"], data["toolbox"], data["capture"], data["clock"]["offset_days"], data["worker_alive"]),
            (connection.settings_dict["NAME"], True, True, 3, True),
        )
        self.assertEqual(data["database_copied_at"], "2026-11-22T18:42:00+05:00")  # the base checkpoint's
        self.assertIn("test_now", data["clock"])
        self.assertIsNone(data["release"])
        for key in ("last_tick", "left_lcup", "finished"):
            self.assertIn(key, data)

    def test_a_copy_with_no_base_checkpoint_has_no_known_age(self):
        with mock.patch("staging.views._worker_alive", return_value=False):
            self.assertIsNone(self.call("get", "/api/staging/status/").data["database_copied_at"])


class ClockScriptTests(ToolboxApiCase):
    def test_the_script_shifts_the_browser_by_the_offset(self):
        self.state(offset_days=2)
        response = self.call("get", "/api/staging/clock.js", authenticate=False, host=MAIN_HOST)
        self.assertEqual(response.status_code, 200)
        self.assertIn("javascript", response["Content-Type"])
        self.assertEqual(response["Cache-Control"], "no-store")
        body = response.content.decode()
        self.assertIn("var o=172800000;", body)
        self.assertIn("window.__STG_OFFSET_DAYS__=2;", body)

    def test_no_offset_is_a_script_that_changes_nothing(self):
        body = self.call("get", "/api/staging/clock.js", authenticate=False, host=MAIN_HOST).content.decode()
        self.assertIn("var o=0;", body)
        self.assertIn("window.__STG_OFFSET_DAYS__=0;", body)


class HostGuardTests(ToolboxApiCase):
    def test_the_admin_host_serves_the_toolbox(self):
        with mock.patch("staging.views._worker_alive", return_value=False):
            self.assertEqual(self.call("get", "/api/staging/status/", host=ADMIN_HOST).status_code, 200)

    def test_every_host_serves_the_clock_to_anyone(self):
        for host in (ADMIN_HOST, MAIN_HOST, TEACHER_HOST):
            response = self.call("get", "/api/staging/clock.js", authenticate=False, host=host)
            self.assertEqual(response.status_code, 200, host)

    def test_the_teacher_host_does_not_serve_the_toolbox(self):
        response = self.refused("get", "/api/staging/status/", authenticate=False, host=TEACHER_HOST)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], "You do not have permission to access the Teacher Portal.")
