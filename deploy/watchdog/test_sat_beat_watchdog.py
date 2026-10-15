"""
Tests for sat_beat_watchdog.py. Stdlib only, like the script:

    python3 -I -B -m unittest discover -s deploy/watchdog -p 'test_*.py'

PM2, /proc and the clock are faked; the log and schedule file are real temp files whose
mtimes the tests set, because file age is the whole signal.
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import sat_beat_watchdog as wd  # noqa: E402

OTHER_APPS = ("sat-frontend", "sat-backend", "sat-livequiz", "sat-celery-worker", "pm2-logrotate")
AS_SATAPP = ["setpriv", "--reuid=satapp", "--regid=satapp", "--init-groups", "--"]
T0 = 1_760_500_000.0  # a fixed "now"

# What beat printed on 2026-10-15 when PM2's SIGINT interrupted the stuck acquire (abridged).
DEADLOCK_TRACEBACK = """\
Exception ignored in: <function AsyncResult.__del__ at 0x7f3e4c461f80>
  File "redis/client.py", line 1059, in unsubscribe
  File "redis/client.py", line 838, in on_connect
  File "redis/client.py", line 879, in execute_command
    with self._lock:
SystemExit
"""


class FakePM2:
    """Answers the commands the watchdog runs; records every argv it was given."""

    def __init__(self, test: "WatchdogTestCase"):
        self.t = test
        self.calls: list[list[str]] = []
        self.alerts: list[dict] = []
        self.beat = {"pid": 4242, "status": "online", "started_at": T0 - 86_400}
        self.present = True
        self.restart_rc = 0
        self.restart_writes = DEADLOCK_TRACEBACK
        self.jlist_rc = 0

    def jlist(self) -> str:
        apps = [
            {"name": name, "pid": 100 + i, "pm2_env": {"status": "online", "pm_uptime": 0, "env": {}}}
            for i, name in enumerate(OTHER_APPS)
        ]
        if self.present:
            apps.append({
                "name": wd.APP,
                "pid": self.beat["pid"],
                "pm2_env": {
                    "status": self.beat["status"],
                    "pm_uptime": int(self.beat["started_at"] * 1000),
                    "restart_time": 25,
                    "pm_err_log_path": self.t.log_path,
                    # The real pm2_env carries the process environment; it must never be repeated.
                    "env": {"SECRET_KEY": "do-not-leak-me"},
                    "SECRET_KEY": "do-not-leak-me",
                },
            })
        return json.dumps(apps)

    def __call__(self, argv, *, timeout, input=None, cwd=None):
        self.calls.append(list(argv))
        if "celery_beat_watchdog_alert" in argv:
            self.alerts.append(json.loads(input))
            return subprocess.CompletedProcess(argv, 0, '{"persisted": true}\n', "")
        if argv[-1] == "jlist":
            return subprocess.CompletedProcess(argv, self.jlist_rc, self.jlist(), "boom" if self.jlist_rc else "")
        if argv[-2:] == ["restart", wd.APP]:
            if self.restart_rc == 0:
                with open(self.t.log_path, "a", encoding="utf-8") as fh:
                    fh.write(self.restart_writes)
                self.beat = {"pid": self.beat["pid"] + 1, "status": "online", "started_at": self.t.now}
            return subprocess.CompletedProcess(argv, self.restart_rc, "", "" if self.restart_rc == 0 else "nope")
        return subprocess.CompletedProcess(argv, 0, f"output of {argv[0]}\n", "")

    def pm2_calls(self) -> list[list[str]]:
        return [c for c in self.calls if "/usr/bin/pm2" in c]


class WatchdogTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.tmp.name
        self.now = T0
        self.log_path = os.path.join(root, "sat-celery-beat-error-7.log")
        self.schedule = os.path.join(root, "celerybeat-schedule")
        self.proc = os.path.join(root, "proc")
        self.pm2_home = os.path.join(root, "pm2")
        os.makedirs(self.pm2_home)
        with open(os.path.join(self.pm2_home, "pm2.pid"), "w") as fh:
            fh.write("777\n")
        for pid in ("777", "4242"):
            os.makedirs(os.path.join(self.proc, pid))
        with open(os.path.join(self.proc, "4242", "status"), "w") as fh:
            fh.write("Name:\tcelery\nState:\tS (sleeping)\nThreads:\t1\n")
        with open(os.path.join(self.proc, "4242", "wchan"), "w") as fh:
            fh.write("futex_wait_queue")
        with open(self.log_path, "w") as fh:
            fh.write("2026-10-15 06:37:00: [..] Scheduler: Sending due task assessments-dispatch-pending-grading\n")
        open(self.schedule, "w").close()
        self.config = wd.Config(
            pm2_home=self.pm2_home,
            schedule_file=self.schedule,
            backend_dir=os.path.join(root, "backend"),
            state_dir=os.path.join(root, "state"),
            log_file=os.path.join(root, "watchdog.log"),
            pause_file=os.path.join(root, "beat-watchdog.pause"),
            proc_root=self.proc,
        )
        self.pm2 = FakePM2(self)
        self.out = io.StringIO()
        self.ages(log=30, schedule=120)

    def tearDown(self):
        self.tmp.cleanup()

    def ages(self, *, log: float, schedule: float) -> None:
        os.utime(self.log_path, (self.now - log, self.now - log))
        os.utime(self.schedule, (self.now - schedule, self.now - schedule))

    def check(self, config: wd.Config | None = None) -> str:
        dog = wd.Watchdog(
            config or self.config,
            runner=self.pm2,
            clock=lambda: self.now,
            sleep=lambda s: None,
            which=lambda name: None,
            out=self.out,
        )
        return dog.check()

    def events(self) -> list[str]:
        return [json.loads(line)["event"] for line in self.out.getvalue().splitlines()]

    def state(self) -> dict:
        with open(os.path.join(self.config.state_dir, "state.json")) as fh:
            return json.load(fh)


class HealthyTests(WatchdogTestCase):
    def test_a_ticking_beat_is_left_alone(self):
        self.assertEqual(self.check(), "healthy")
        self.assertEqual([c[-1] for c in self.pm2.pm2_calls()], ["jlist"])
        self.assertEqual(self.pm2.alerts, [])

    def test_a_quiet_log_alone_is_not_a_stall(self):
        # e.g. somebody lowered beat's log level: the schedule file still moves.
        self.ages(log=3600, schedule=60)
        self.assertEqual(self.check(), "healthy")

    def test_a_quiet_schedule_file_alone_is_not_a_stall(self):
        self.ages(log=20, schedule=3600)
        self.assertEqual(self.check(), "healthy")

    def test_healthy_checks_stay_out_of_the_log_file(self):
        self.check()
        self.assertFalse(os.path.exists(self.config.log_file))
        self.assertEqual(self.events(), ["healthy"])


class StallTests(WatchdogTestCase):
    def setUp(self):
        super().setUp()
        self.ages(log=700, schedule=800)

    def test_restarts_beat_and_only_beat(self):
        self.assertEqual(self.check(), "restarted")
        restarts = [c for c in self.pm2.pm2_calls() if "restart" in c]
        self.assertEqual(len(restarts), 1)
        self.assertEqual(restarts[0][-2:], ["restart", wd.APP])
        self.assertEqual(restarts[0][:5], AS_SATAPP)
        for argv in self.pm2.calls:
            for other in OTHER_APPS:
                self.assertNotIn(other, " ".join(argv))
            self.assertNotIn("all", argv)

    def test_alerts_through_the_app_with_the_evidence(self):
        self.check()
        self.assertEqual(len(self.pm2.alerts), 1)
        alert = self.pm2.alerts[0]
        self.assertEqual(alert["event"], "stalled_restarted")
        self.assertEqual(alert["signature"], "redis-py PubSub self-deadlock (redis/redis-py#3640)")
        self.assertEqual((alert["pid_before"], alert["pid_after"]), (4242, 4243))
        self.assertEqual(alert["log_age_s"], 700)
        self.assertEqual(alert["wchan"], "futex_wait_queue")
        self.assertEqual(alert["proc_threads"], "1")
        alert_call = next(c for c in self.pm2.calls if "celery_beat_watchdog_alert" in c)
        self.assertEqual(alert_call[:5], AS_SATAPP)

    def test_keeps_an_incident_directory(self):
        self.check()
        incident = self.state()["pending_recovery"]["incident"]
        for name in ("summary.json", "shutdown.log", "proc_status.txt", "proc_wchan.txt", "strace.txt", "log_tail.txt"):
            self.assertTrue(os.path.exists(os.path.join(incident, name)), name)
        with open(os.path.join(incident, "shutdown.log")) as fh:
            self.assertIn("with self._lock:", fh.read())

    def test_logs_the_restart_to_the_file(self):
        self.check()
        with open(self.config.log_file) as fh:
            events = [json.loads(line)["event"] for line in fh]
        self.assertEqual(events, ["stalled", "restarted", "alert_sent"])

    def test_never_repeats_the_process_environment(self):
        self.check()
        self.assertNotIn("do-not-leak-me", self.out.getvalue())
        self.assertNotIn("do-not-leak-me", json.dumps(self.pm2.alerts))

    def test_an_unknown_hang_is_labelled_unknown(self):
        self.pm2.restart_writes = "beat: Shutting down...\n"
        self.check()
        self.assertEqual(self.pm2.alerts[0]["signature"], "unknown")

    def test_a_failed_restart_says_so(self):
        self.pm2.restart_rc = 1
        self.assertEqual(self.check(), "restart_failed")
        self.assertEqual(self.pm2.alerts[0]["event"], "restart_failed")
        self.assertEqual(self.pm2.alerts[0]["restart_stderr"], "nope")

    def test_recovery_is_reported_once(self):
        self.assertEqual(self.check(), "restarted")
        self.now += 11 * 60  # past the startup grace, beat ticking again
        self.ages(log=10, schedule=100)
        self.assertEqual(self.check(), "recovered")
        self.assertEqual([a["event"] for a in self.pm2.alerts], ["stalled_restarted", "recovered"])
        self.now += 60
        self.ages(log=10, schedule=100)
        self.assertEqual(self.check(), "healthy")
        self.assertEqual(len(self.pm2.alerts), 2)

    def test_restart_budget_then_alert_only(self):
        for _ in range(3):
            self.pm2.beat["started_at"] = self.now - 86_400
            self.assertEqual(self.check(), "restarted")
            self.now += 60
            self.ages(log=700, schedule=800)
        self.pm2.beat["started_at"] = self.now - 86_400
        self.assertEqual(self.check(), "budget_exhausted")
        self.now += 60
        self.ages(log=700, schedule=800)
        self.assertEqual(self.check(), "budget_exhausted")
        restarts = [c for c in self.pm2.pm2_calls() if "restart" in c]
        self.assertEqual(len(restarts), 3)
        events = [a["event"] for a in self.pm2.alerts]
        self.assertEqual(events.count("restart_budget_exhausted"), 1)  # the second one is in cooldown

    def test_budget_refills_after_the_window(self):
        os.makedirs(self.config.state_dir, exist_ok=True)
        with open(os.path.join(self.config.state_dir, "state.json"), "w") as fh:
            json.dump({"restarts": [self.now - 4000] * 3}, fh)
        self.assertEqual(self.check(), "restarted")

    def test_dry_run_never_restarts_or_alerts(self):
        config = wd.Config(**{**self.config.__dict__, "dry_run": True})
        self.assertEqual(self.check(config), "would_restart")
        self.assertEqual([c[-1] for c in self.pm2.pm2_calls()], ["jlist"])
        self.assertEqual(self.pm2.alerts, [])


class LeaveItAloneTests(WatchdogTestCase):
    def test_paused(self):
        self.ages(log=700, schedule=800)
        open(self.config.pause_file, "w").close()
        self.assertEqual(self.check(), "paused")
        self.assertEqual(self.pm2.calls, [])

    def test_a_stopped_beat_is_somebodys_decision(self):
        self.ages(log=7000, schedule=8000)
        self.pm2.beat["status"] = "stopped"
        self.assertEqual(self.check(), "not_online")
        self.assertEqual([c[-1] for c in self.pm2.pm2_calls()], ["jlist"])
        self.assertEqual(self.pm2.alerts, [])

    def test_an_errored_beat_is_reported_not_restarted(self):
        self.pm2.beat["status"] = "errored"
        self.assertEqual(self.check(), "not_online")
        self.assertEqual([c[-1] for c in self.pm2.pm2_calls()], ["jlist"])
        self.assertEqual([a["status"] for a in self.pm2.alerts], ["errored"])

    def test_a_missing_beat_is_reported(self):
        self.pm2.present = False
        self.assertEqual(self.check(), "not_running")
        self.assertEqual(self.pm2.alerts[0]["event"], "not_running")

    def test_just_started(self):
        self.ages(log=700, schedule=800)
        self.pm2.beat["started_at"] = self.now - 120
        self.assertEqual(self.check(), "starting")

    def test_a_missing_schedule_file_is_not_evidence(self):
        self.ages(log=700, schedule=800)
        os.unlink(self.schedule)
        self.assertEqual(self.check(), "signal_unavailable")
        self.assertEqual([c[-1] for c in self.pm2.pm2_calls()], ["jlist"])

    def test_never_spawns_a_pm2_daemon(self):
        os.unlink(os.path.join(self.pm2_home, "pm2.pid"))
        self.assertEqual(self.check(), "pm2_unreachable")
        self.assertEqual(self.pm2.pm2_calls(), [])
        self.assertEqual(self.pm2.alerts[0]["event"], "pm2_unreachable")

    def test_pm2_errors_alert_once_per_cooldown(self):
        self.pm2.jlist_rc = 1
        self.assertEqual(self.check(), "pm2_unreachable")
        self.now += 60
        self.assertEqual(self.check(), "pm2_unreachable")
        self.assertEqual(len(self.pm2.alerts), 1)


class ParseJlistTests(unittest.TestCase):
    def test_skips_a_notice_before_the_json(self):
        text = ">>>> In-memory PM2 is out-of-date, do:\n>>>> $ pm2 update\n[PM2] noise\n" + json.dumps([{"name": "x"}])
        self.assertEqual(wd.parse_jlist(text), [{"name": "x"}])

    def test_rejects_output_without_a_list(self):
        with self.assertRaises(ValueError):
            wd.parse_jlist("[PM2] Spawning PM2 daemon")


class ConfigTests(unittest.TestCase):
    def test_env_overrides_are_typed(self):
        env = {"SAT_BEAT_WD_STALE_AFTER": "900", "SAT_BEAT_WD_DRY_RUN": "1", "SAT_BEAT_WD_PM2_USER": "x"}
        old = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        try:
            config = wd.Config.from_env()
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.assertEqual((config.stale_after, config.dry_run, config.pm2_user), (900, True, "x"))


if __name__ == "__main__":
    unittest.main()
