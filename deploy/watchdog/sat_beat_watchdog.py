#!/usr/bin/env python3
"""
Restart sat-celery-beat when it has stopped ticking while PM2 still calls it "online".

Why this exists. Beat hung silently four times between August and October 2026 — 8.9 h, 46 h,
27 h and 5 h — each time within a minute of unattended-upgrades restarting redis-server.
PM2 showed it "online" with no restarts throughout: the process was alive, its only thread
parked forever on a lock it already held (redis-py's PubSub reconnect re-enters its own
non-reentrant lock, redis/redis-py#3640). Every periodic task stopped with it: attendance
registers, the lc-up sync, grading dispatch, homework settling. Nobody was told.
docs/superpowers/plans/2026-10-15-celery-beat-watchdog.md has the evidence and the root-cause fix;
this is the safety net that stays after it, because the next hang need not look like this one.

How it decides. A healthy beat leaves two marks that nothing else writes:
  * its PM2 log gains a line every minute (assessments-dispatch-pending-grading is */1), and
  * its PersistentScheduler rewrites the schedule file every 3 minutes.
Beat is "stalled" only when BOTH are older than STALE_AFTER. Either one alone could go quiet
for a reason that is not a hang (a log-level change, a schedule file someone moved), and a
restart is not the answer to those.

What it touches. Run as root by sat-beat-watchdog.timer once a minute. The only PM2 commands
it can issue are `pm2 jlist` and `pm2 restart sat-celery-beat`, both as satapp — APP is a
constant and nothing takes a process name as input. Web, worker and livequiz are never named.
It never starts a PM2 daemon either: when satapp's daemon is down it reports and stops.

On a stall, in order: snapshot /proc, strace and (if installed) py-spy into an incident
directory, restart beat, keep the traceback beat prints as it dies (PM2's SIGINT interrupts
the blocked acquire, which is how the 2026-10-15 stack was recovered), then alert through the
app's own ops alerting (`manage.py celery_beat_watchdog_alert`, which calls
assessments.ops_alerts.deliver_ops_alert). When beat is ticking again it says so once.
No more than MAX_RESTARTS within RESTART_WINDOW; past that it alerts and leaves beat alone.

Stdlib only, so it runs on the system python3 even when a release's venv is broken.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
from typing import Any, Callable

# The one process this script may restart. Not configurable, on purpose.
APP = "sat-celery-beat"

# What the shutdown traceback of the known hang contains. Used only to label the alert.
KNOWN_HANG_MARKERS = ("redis/client.py", "with self._lock:", "on_connect")

# Logged to journald every minute, but kept out of LOG_FILE so that file stays short.
QUIET_EVENTS = frozenset({"healthy"})


@dataclasses.dataclass(frozen=True)
class Config:
    pm2_user: str = "satapp"
    pm2_home: str = "/home/satapp/.pm2"
    pm2_bin: str = "/usr/bin/pm2"
    user_home: str = "/home/satapp"
    schedule_file: str = "/var/www/satapp/shared/celerybeat-schedule"
    backend_dir: str = "/var/www/satapp/current/backend"
    state_dir: str = "/var/lib/sat-beat-watchdog"
    log_file: str = "/var/log/sat-beat-watchdog.log"
    # An operator who wants beat left alone (a long maintenance, a debugging session) touches this.
    pause_file: str = "/var/www/satapp/shared/beat-watchdog.pause"
    proc_root: str = "/proc"
    # Healthy ages: log < 1 min, schedule file < ~4 min (3 min sync + up to one tick).
    stale_after: int = 600
    # A beat that has just started has written nothing yet; give it the same allowance.
    startup_grace: int = 600
    max_restarts: int = 3
    restart_window: int = 3600
    # Repeats of the same non-restart alert (budget exhausted, beat errored, PM2 down).
    alert_cooldown: int = 3600
    dry_run: bool = False

    @classmethod
    def from_env(cls, **overrides: Any) -> "Config":
        values: dict[str, Any] = {}
        for field in dataclasses.fields(cls):
            raw = os.environ.get(f"SAT_BEAT_WD_{field.name.upper()}")
            if raw is None:
                continue
            if field.type in ("int", int):
                values[field.name] = int(raw)
            elif field.type in ("bool", bool):
                values[field.name] = raw.strip().lower() in ("1", "true", "yes", "on")
            else:
                values[field.name] = raw
        values.update({k: v for k, v in overrides.items() if v is not None})
        return cls(**values)


Runner = Callable[..., "subprocess.CompletedProcess[str]"]


def run_command(argv: list[str], *, timeout: float, input: str | None = None, cwd: str | None = None):
    return subprocess.run(argv, input=input, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def parse_jlist(text: str) -> list[dict]:
    """`pm2 jlist` can print a notice ("In-memory PM2 is out-of-date ...") before the JSON."""
    decoder = json.JSONDecoder()
    idx = text.find("[")
    while idx != -1:
        try:
            value, _ = decoder.raw_decode(text[idx:])
        except ValueError:
            idx = text.find("[", idx + 1)
            continue
        if isinstance(value, list):
            return value
        idx = text.find("[", idx + 1)
    raise ValueError("no JSON list in pm2 jlist output")


def _age(path: str, now: float) -> float | None:
    try:
        return max(0.0, now - os.stat(path).st_mtime)
    except OSError:
        return None


class Watchdog:
    def __init__(
        self,
        config: Config,
        *,
        runner: Runner = run_command,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        which: Callable[[str], str | None] = shutil.which,
        out=sys.stdout,
    ):
        self.c = config
        self.run = runner
        self.now = clock
        self.sleep = sleep
        self.which = which
        self.out = out
        self.state_path = os.path.join(config.state_dir, "state.json")

    # ── output ────────────────────────────────────────────────────────────────

    def log(self, event: str, **fields: Any) -> dict:
        record = {"ts": dt.datetime.fromtimestamp(self.now()).isoformat(timespec="seconds"), "event": event}
        if self.c.dry_run:
            record["dry_run"] = True
        record.update(fields)
        line = json.dumps(record, sort_keys=True, default=str)
        print(line, file=self.out, flush=True)
        if event in QUIET_EVENTS:
            return record  # journald only; the file is the record of what the watchdog did
        try:
            with open(self.c.log_file, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass  # journald has the same line
        return record

    # ── state ─────────────────────────────────────────────────────────────────

    def load_state(self) -> dict:
        try:
            with open(self.state_path, encoding="utf-8") as fh:
                state = json.load(fh)
        except (OSError, ValueError):
            state = {}
        state.setdefault("restarts", [])
        state.setdefault("pending_recovery", None)
        state.setdefault("last_alert", {})
        return state

    def save_state(self, state: dict) -> None:
        os.makedirs(self.c.state_dir, mode=0o700, exist_ok=True)
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh, sort_keys=True)
        os.replace(tmp, self.state_path)

    # ── PM2, always as satapp, only ever jlist / restart APP ─────────────────

    def _as_app_user(self) -> list[str]:
        # setpriv, not runuser: runuser opens a PAM session, which writes two auth-log lines per
        # call — about 2,900 a day at one `pm2 jlist` a minute. satapp's group has its name.
        user = self.c.pm2_user
        return ["setpriv", f"--reuid={user}", f"--regid={user}", "--init-groups", "--"]

    def _pm2(self, *args: str, timeout: float):
        argv = [
            *self._as_app_user(),
            "env", "-i", f"HOME={self.c.user_home}", f"PM2_HOME={self.c.pm2_home}", "PATH=/usr/bin:/bin",
            self.c.pm2_bin, *args,
        ]
        return self.run(argv, timeout=timeout)

    def pm2_daemon_alive(self) -> bool:
        # `pm2 jlist` with no daemon would START an empty one; never do that.
        try:
            with open(os.path.join(self.c.pm2_home, "pm2.pid"), encoding="utf-8") as fh:
                pid = int(fh.read().strip())
        except (OSError, ValueError):
            return False
        return os.path.exists(os.path.join(self.c.proc_root, str(pid)))

    def beat_process(self) -> dict | None:
        proc = self._pm2("jlist", timeout=30)
        if proc.returncode != 0:
            raise RuntimeError(f"pm2 jlist exited {proc.returncode}: {proc.stderr.strip()[:300]}")
        for app in parse_jlist(proc.stdout):
            if isinstance(app, dict) and app.get("name") == APP:
                env = app.get("pm2_env") or {}
                # Only these fields leave this function: pm2_env also carries the process
                # environment, which is not ours to log.
                return {
                    "pid": app.get("pid"),
                    "status": env.get("status"),
                    "started_at": (env.get("pm_uptime") or 0) / 1000.0,
                    "restart_time": env.get("restart_time"),
                    "err_log": env.get("pm_err_log_path"),
                }
        return None

    def restart_beat(self):
        return self._pm2("restart", APP, timeout=60)

    # ── alerting, through the app ────────────────────────────────────────────

    def alert(self, state: dict, event: str, /, *, cooldown: bool = False, **payload: Any) -> None:
        now = self.now()
        if cooldown:
            last = state["last_alert"].get(event)
            if last is not None and now - last < self.c.alert_cooldown:
                self.log("alert_suppressed", alert=event, cooldown_s=self.c.alert_cooldown)
                return
        if self.c.dry_run:
            self.log("alert_skipped_dry_run", alert=event)
            return
        state["last_alert"][event] = now
        body = json.dumps({"event": event, "host": os.uname().nodename, **payload}, sort_keys=True, default=str)
        argv = [
            *self._as_app_user(),
            "env", "-i", f"HOME={self.c.user_home}", "PATH=/usr/bin:/bin", "DJANGO_SETTINGS_MODULE=config.settings",
            os.path.join(self.c.backend_dir, "venv", "bin", "python"), "manage.py", "celery_beat_watchdog_alert",
        ]
        try:
            proc = self.run(argv, timeout=120, input=body, cwd=self.c.backend_dir)
        except (OSError, subprocess.SubprocessError) as exc:
            self.log("alert_failed", alert=event, error=f"{exc.__class__.__name__}: {exc}"[:300])
            return
        if proc.returncode != 0:
            self.log("alert_failed", alert=event, rc=proc.returncode, stderr=proc.stderr.strip()[-500:])
            return
        delivery: Any = proc.stdout.strip().splitlines()[-1:] or [""]
        try:
            delivery = json.loads(delivery[0])
        except ValueError:
            delivery = delivery[0][:300]
        self.log("alert_sent", alert=event, delivery=delivery)

    # ── evidence ─────────────────────────────────────────────────────────────

    def collect_diagnostics(self, incident: str, beat: dict) -> dict:
        """Best effort and bounded: nothing here may stop the restart that follows."""
        os.makedirs(incident, mode=0o700, exist_ok=True)
        notes: dict[str, Any] = {}
        pid = beat.get("pid")
        proc_dir = os.path.join(self.c.proc_root, str(pid)) if pid else None

        def save(name: str, text: str) -> None:
            with open(os.path.join(incident, name), "w", encoding="utf-8") as fh:
                fh.write(text)

        if proc_dir:
            for name in ("status", "wchan", "syscall", "stack"):
                try:
                    with open(os.path.join(proc_dir, name), encoding="utf-8", errors="replace") as fh:
                        text = fh.read()
                except OSError as exc:
                    text = f"unreadable: {exc}"
                save(f"proc_{name}.txt", text)
                if name == "wchan":
                    notes["wchan"] = text.strip()[:80]
                if name == "status":
                    for line in text.splitlines():
                        if line.startswith(("State:", "Threads:")):
                            key, _, value = line.partition(":")
                            notes[f"proc_{key.lower()}"] = value.strip()

            tools = [
                ("strace.txt", ["timeout", "-s", "INT", "3", "strace", "-f", "-tt", "-p", str(pid)]),
                ("sockets.txt", ["ss", "-tanp"]),
            ]
            if self.which("py-spy"):
                tools.append(("py-spy.txt", ["py-spy", "dump", "--native", "--pid", str(pid)]))
            for name, argv in tools:
                try:
                    proc = self.run(argv, timeout=15)
                    text = (proc.stdout or "") + (proc.stderr or "")
                except (OSError, subprocess.SubprocessError) as exc:
                    text = f"{exc.__class__.__name__}: {exc}"
                if name == "sockets.txt":
                    text = "\n".join(line for line in text.splitlines() if f"pid={pid}," in line)
                save(name, text)

        log_path = beat.get("err_log")
        if log_path:
            try:
                with open(log_path, "rb") as fh:
                    fh.seek(max(0, os.fstat(fh.fileno()).st_size - 16384))
                    tail = fh.read().decode("utf-8", "replace").splitlines()[-40:]
                save("log_tail.txt", "\n".join(tail) + "\n")
                notes["last_log_line"] = tail[-1][:300] if tail else ""
            except OSError as exc:
                notes["log_tail_error"] = str(exc)[:200]
        return notes

    def shutdown_traceback(self, log_path: str | None, offset: int | None) -> str:
        if not log_path or offset is None:
            return ""
        try:
            with open(log_path, "rb") as fh:
                size = os.fstat(fh.fileno()).st_size
                if size < offset:  # rotated meanwhile
                    offset = 0
                fh.seek(offset)
                return fh.read(65536).decode("utf-8", "replace")
        except OSError:
            return ""

    # ── the check ────────────────────────────────────────────────────────────

    def check(self) -> str:
        c = self.c
        if os.path.exists(c.pause_file):
            self.log("paused", pause_file=c.pause_file)
            return "paused"

        state = self.load_state()
        try:
            return self._check(state)
        finally:
            self.save_state(state)

    def _check(self, state: dict) -> str:
        c = self.c
        if not self.pm2_daemon_alive():
            self.log("pm2_unreachable", reason="satapp PM2 daemon not running")
            self.alert(state, "pm2_unreachable", cooldown=True, reason="satapp PM2 daemon not running")
            return "pm2_unreachable"
        try:
            beat = self.beat_process()
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as exc:
            reason = f"{exc.__class__.__name__}: {exc}"[:300]
            self.log("pm2_unreachable", reason=reason)
            self.alert(state, "pm2_unreachable", cooldown=True, reason=reason)
            return "pm2_unreachable"

        if beat is None:
            self.log("not_running", status="missing from pm2")
            self.alert(state, "not_running", cooldown=True, status="missing from pm2")
            return "not_running"
        if beat["status"] != "online":
            # "stopped" is a person or a deploy; restarting it would fight them. "errored" means PM2
            # itself gave up on a crash loop — say so, but a restart is PM2's call, not ours.
            self.log("not_online", status=beat["status"])
            if beat["status"] == "errored":
                self.alert(state, "not_running", cooldown=True, status="errored")
            return "not_online"

        now = self.now()
        uptime = now - beat["started_at"]
        if uptime < c.startup_grace:
            self.log("starting", uptime_s=round(uptime))
            return "starting"

        log_age = _age(beat["err_log"], now) if beat["err_log"] else None
        schedule_age = _age(c.schedule_file, now)
        ages = {
            "log_age_s": None if log_age is None else round(log_age),
            "schedule_age_s": None if schedule_age is None else round(schedule_age),
            "uptime_s": round(uptime),
            "pid": beat["pid"],
        }
        if log_age is None or schedule_age is None:
            # Cannot see one of the two marks; do not restart on half the evidence.
            self.log("signal_unavailable", **ages)
            return "signal_unavailable"

        if log_age < c.stale_after or schedule_age < c.stale_after:
            pending = state["pending_recovery"]
            if pending:
                state["pending_recovery"] = None
                self.log("recovered", incident=pending.get("incident"), **ages)
                self.alert(state, "recovered", incident=pending.get("incident"),
                           restarted_at=pending.get("restarted_at"), **ages)
                return "recovered"
            self.log("healthy", **ages)
            return "healthy"

        return self._stalled(state, beat, ages)

    def _stalled(self, state: dict, beat: dict, ages: dict) -> str:
        c = self.c
        now = self.now()
        state["restarts"] = [t for t in state["restarts"] if now - t < c.restart_window]
        if len(state["restarts"]) >= c.max_restarts:
            self.log("restart_budget_exhausted", restarts_in_window=len(state["restarts"]), **ages)
            self.alert(state, "restart_budget_exhausted", cooldown=True,
                       restarts_in_window=len(state["restarts"]), window_s=c.restart_window, **ages)
            return "budget_exhausted"

        if c.dry_run:
            self.log("would_restart", **ages)
            return "would_restart"

        incident_id = dt.datetime.fromtimestamp(now).strftime("%Y%m%d-%H%M%S")
        incident = os.path.join(c.state_dir, "incidents", incident_id)
        notes = self.collect_diagnostics(incident, beat)
        self.log("stalled", incident=incident, **ages, **notes)

        offset = None
        if beat.get("err_log"):
            try:
                offset = os.stat(beat["err_log"]).st_size
            except OSError:
                pass

        state["restarts"].append(now)
        try:
            proc = self.restart_beat()
            restart_rc, restart_err = proc.returncode, proc.stderr.strip()[-300:]
        except (OSError, subprocess.SubprocessError) as exc:
            restart_rc, restart_err = -1, f"{exc.__class__.__name__}: {exc}"[:300]

        self.sleep(5)
        traceback = self.shutdown_traceback(beat.get("err_log"), offset)
        if traceback:
            with open(os.path.join(incident, "shutdown.log"), "w", encoding="utf-8") as fh:
                fh.write(traceback)
        known = all(marker in traceback for marker in KNOWN_HANG_MARKERS)

        try:
            after = self.beat_process()
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError):
            after = None
        ok = restart_rc == 0 and bool(after) and after["status"] == "online" and after["pid"] != beat["pid"]

        summary = {
            "incident": incident,
            "restart_rc": restart_rc,
            "pid_before": beat["pid"],
            "pid_after": after and after["pid"],
            "status_after": after and after["status"],
            "signature": "redis-py PubSub self-deadlock (redis/redis-py#3640)" if known else "unknown",
            **ages,
            **notes,
        }
        if restart_err:
            summary["restart_stderr"] = restart_err
        with open(os.path.join(incident, "summary.json"), "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, sort_keys=True, default=str)

        if ok:
            state["pending_recovery"] = {"incident": incident, "restarted_at": now}
            self.log("restarted", **summary)
            self.alert(state, "stalled_restarted", **summary)
            return "restarted"
        self.log("restart_failed", **summary)
        self.alert(state, "restart_failed", **summary)
        return "restart_failed"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=f"Restart {APP} when it stops ticking.")
    parser.add_argument("--dry-run", action="store_true", help="Decide and log, but never restart or alert.")
    args = parser.parse_args(argv)
    config = Config.from_env(dry_run=True if args.dry_run else None)

    os.makedirs(config.state_dir, mode=0o700, exist_ok=True)
    with open(os.path.join(config.state_dir, "lock"), "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"event": "already_running"}), flush=True)
            return 0
        outcome = Watchdog(config).check()
    return 1 if outcome == "restart_failed" else 0


if __name__ == "__main__":
    sys.exit(main())
