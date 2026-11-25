#!/usr/bin/env python3
"""The test copy's time machine (/var/www/satapp-staging). Root runs it: systemd ``stg-timemachine.service``.

The toolbox (backend app ``staging``, running as satapp) leaves one JSON request in ``requests/``. This loop takes
them one at a time and writes what happened to ``state.json``, which the toolbox reads:

  {"action": "forward", "days": N}      save a checkpoint, then move the clock one day at a time; after each day
                                        ``manage.py staging_after_day`` does that day's work (lesson charges,
                                        freezes, warnings) and says what it did
  {"action": "back", "checkpoint": id}  the database as it was at that checkpoint and the clock at its day; the
                                        checkpoints after it go, since that future no longer happened
  {"action": "today"}                   back to the base checkpoint (the copy as it was taken from prod)
  {"action": "refresh"}                 a new copy of prod, taken off lc-up the way prod is, as the new base

The copy's processes run under libfaketime and read the clock file (``+Nd``), so the whole copy lives N days ahead
of the real date. The clock only moves forward from a checkpoint; going back is always a checkpoint.

Only these are ever written: the database mastersat_staging (and mastersat_staging_new and stg_cp_N while working),
the files under shared/timemachine, the beat schedule, and the stg-* pm2 apps. prod's database is only read, niced,
by ``refresh`` (pg_dump), exactly as /root/stg-db.sh does.
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import os
import subprocess
import sys
import time
import traceback
from zoneinfo import ZoneInfo

STG = "/var/www/satapp-staging"
TM = f"{STG}/shared/timemachine"
REQ_DIR = f"{TM}/requests"
STATE = f"{TM}/state.json"
CLOCK = f"{TM}/clock"
BEAT = f"{STG}/shared/celerybeat-schedule"
DUMP = "/var/tmp/stg-seed.dump"

DB = "mastersat_staging"
NEW_DB = "mastersat_staging_new"
#: The live database, set aside while a new one is renamed in (``swap_in``), dropped once it is.
OLD_DB = "mastersat_staging_old"
CP_PREFIX = "stg_cp_"
ROLE = "mastersat_stg"
PROD_DB = "mastersat_db"

#: The apps that hold database connections; the frontend only needs a restart to read the new clock.
DB_APPS = ["stg-backend", "stg-celery-worker", "stg-celery-beat"]
ALL_APPS = DB_APPS + ["stg-frontend"]
FAKETIME_LIB = "/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1"
TZ = ZoneInfo("Asia/Tashkent")

MAX_DAYS = 60
#: Checkpoints kept, the base among them. Each is a full copy of the database (~430 MB).
MAX_CHECKPOINTS = 10
HISTORY = 50
PROD_EXCLUDED_DATA = (
    "exams_attempt_idempotency_keys",
    "midterms_attempt_idempotency_keys",
    "users_refresh_sessions",
    "django_session",
)


class Refused(Exception):
    """A request that cannot be done as asked; nothing was changed."""


def log(message: str) -> None:
    print(f"{dt.datetime.now().isoformat(timespec='seconds')} {message}", flush=True)


def now_iso() -> str:
    return dt.datetime.now(TZ).isoformat(timespec="seconds")


def real_today() -> dt.date:
    return dt.datetime.now(TZ).date()


def test_date(offset_days: int) -> str:
    return (real_today() + dt.timedelta(days=offset_days)).isoformat()


# ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────


def load_state() -> dict:
    try:
        with open(STATE) as fh:
            state = json.load(fh)
        if not isinstance(state, dict):
            raise ValueError("not a JSON object")
    except FileNotFoundError:
        state = {}
    except ValueError as exc:
        # A state.json that cannot be read must not stop the time machine: it starts again from the defaults, and the
        # bad file is kept beside it for a person to look at.
        bad = f"{STATE}.bad-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
        os.replace(STATE, bad)
        log(f"state.json could not be read ({exc}); kept as {bad}, starting from the defaults")
        state = {}
    state.setdefault("offset_days", 0)
    state.setdefault("checkpoints", [])
    state.setdefault("busy", None)
    state.setdefault("last", None)
    state.setdefault("history", [])
    return state


def save_state(state: dict) -> None:
    state["test_date"] = test_date(state["offset_days"])
    state["saved_at"] = now_iso()
    tmp = f"{STATE}.tmp"
    with open(tmp, "w") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    os.replace(tmp, STATE)


def write_clock(offset_days: int) -> None:
    tmp = f"{CLOCK}.tmp"
    with open(tmp, "w") as fh:
        fh.write(f"+{offset_days}d\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, CLOCK)


# ── shell ────────────────────────────────────────────────────────────────────────────────────────────────────────


def run(cmd: list[str], *, cwd: str | None = None, timeout: int = 600) -> str:
    done = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if done.returncode != 0:
        tail = (done.stderr or done.stdout or "").strip()[-1500:]
        raise RuntimeError(f"{' '.join(cmd[:6])}… exited {done.returncode}: {tail}")
    return done.stdout


def pg(sql: str, *, db: str = "postgres") -> str:
    return run(["sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", db, "-c", sql])


def pm2(*args: str) -> str:
    return run(["sudo", "-u", "satapp", "-i", "pm2", *args], timeout=180)


def backend_dir() -> str:
    return os.path.realpath(f"{STG}/current/backend")


def manage(args: list[str], offset_days: int, *, timeout: int = 900) -> str:
    """``manage.py`` as satapp, living ``offset_days`` ahead like the copy's own processes."""
    env = [
        "env",
        "DJANGO_SETTINGS_MODULE=config.settings",
        f"LD_PRELOAD={FAKETIME_LIB}",
        f"FAKETIME=+{offset_days}d",
        "FAKETIME_DONT_FAKE_MONOTONIC=1",
        "NO_FAKE_STAT=1",
    ]
    backend = backend_dir()
    return run(["sudo", "-u", "satapp", "-H", *env, f"{backend}/venv/bin/python", "manage.py", *args],
               cwd=backend, timeout=timeout)


def check_copy(offset_days: int) -> None:
    """Every manage.py step reads the release's environment file, which names the database. ``staging_check`` exits
    non-zero unless that is the copy's own (and STAGING_TOOLBOX is on), so a prod environment file copied here by
    mistake stops the action at this step, before ``migrate`` or the cutover could write to another database."""
    manage(["staging_check", "--json"], offset_days, timeout=120)


def last_json(text: str) -> dict:
    """The JSON object a command printed: the whole output, else its last line that parses."""
    try:
        return json.loads(text)
    except ValueError:
        pass
    for line in reversed(text.strip().splitlines()):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return {"output": text.strip()[-500:]}


# ── databases ────────────────────────────────────────────────────────────────────────────────────────────────────


def safe_name(name: str) -> str:
    """Only the copy's own databases are ever created or dropped here."""
    if name in (DB, NEW_DB, OLD_DB) or (name.startswith(CP_PREFIX) and name[len(CP_PREFIX):].isdigit()):
        return name
    raise RuntimeError(f"refusing to touch database {name!r}")


def exists(name: str) -> bool:
    return pg(f"SELECT 1 FROM pg_database WHERE datname = '{safe_name(name)}'").strip() == "1"


def disconnect(name: str) -> None:
    pg(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
       f"WHERE datname = '{safe_name(name)}' AND pid <> pg_backend_pid()")


def drop(name: str) -> None:
    if exists(name):
        disconnect(name)
        pg(f'DROP DATABASE "{safe_name(name)}"')


def copy_db(source: str, target: str) -> None:
    """A whole database copied on disk. The source must have no connections, so the copy's apps are stopped."""
    safe_name(source)
    safe_name(target)
    for attempt in range(1, 6):
        disconnect(source)
        try:
            pg(f'CREATE DATABASE "{target}" TEMPLATE "{source}" OWNER {ROLE}')
            return
        except RuntimeError as exc:
            if "being accessed by other users" not in str(exc) or attempt == 5:
                raise
            time.sleep(2)


def swap_in(new: str) -> None:
    """``new`` becomes mastersat_staging. The live one is renamed aside first and dropped only once the new one is in,
    so a failure between the steps leaves a mastersat_staging: the old one put back, or the new one. (A crash between
    the two renames is put right by ``recover`` when the time machine starts again.)"""
    drop(OLD_DB)
    if exists(DB):
        disconnect(DB)
        pg(f'ALTER DATABASE "{DB}" RENAME TO "{OLD_DB}"')
    try:
        pg(f'ALTER DATABASE "{safe_name(new)}" RENAME TO "{DB}"')
    except Exception:
        if exists(OLD_DB) and not exists(DB):
            pg(f'ALTER DATABASE "{OLD_DB}" RENAME TO "{DB}"')
        raise
    drop(OLD_DB)


def recover() -> None:
    """No mastersat_staging but the one set aside: a crash came between ``swap_in``'s two renames. It goes back."""
    if not exists(DB) and exists(OLD_DB):
        pg(f'ALTER DATABASE "{OLD_DB}" RENAME TO "{DB}"')
        log(f"{DB} was missing: put {OLD_DB} back")


def put_in_place(source: str) -> None:
    """mastersat_staging becomes a copy of ``source`` (a checkpoint). The old one goes only once the new one is in."""
    drop(NEW_DB)
    copy_db(source, NEW_DB)
    swap_in(NEW_DB)


# ── apps ─────────────────────────────────────────────────────────────────────────────────────────────────────────


def stop_apps() -> None:
    pm2("stop", *DB_APPS)


def start_apps() -> None:
    for pattern in (BEAT, f"{BEAT}.*"):
        for path in glob.glob(pattern):
            os.remove(path)  # a schedule saved at another date would hold tasks back, or run them twice
    pm2("restart", *ALL_APPS, "--update-env")


# ── checkpoints ──────────────────────────────────────────────────────────────────────────────────────────────────


def checkpoint(state: dict, label: str, *, kind: str = "jump") -> dict:
    ids = [cp["id"] for cp in state["checkpoints"]]
    cp_id = 0 if kind == "base" else max(ids, default=0) + 1
    name = f"{CP_PREFIX}{cp_id}"
    drop(name)
    copy_db(DB, name)
    cp = {
        "id": cp_id,
        "db": name,
        "kind": kind,
        "label": label,
        "offset_days": state["offset_days"],
        "test_date": test_date(state["offset_days"]),
        "taken_at": now_iso(),
    }
    state["checkpoints"] = [c for c in state["checkpoints"] if c["id"] != cp_id] + [cp]
    return cp


def prune(state: dict) -> None:
    keep_jumps = MAX_CHECKPOINTS - 1
    jumps = sorted((c for c in state["checkpoints"] if c["kind"] != "base"), key=lambda c: c["id"])
    for cp in jumps[:-keep_jumps] if len(jumps) > keep_jumps else []:
        drop(cp["db"])
        state["checkpoints"].remove(cp)


def find(state: dict, cp_id: int) -> dict:
    for cp in state["checkpoints"]:
        if cp["id"] == cp_id:
            return cp
    raise Refused(f"There is no checkpoint {cp_id}.")


# ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────


def forward(state: dict, days: int) -> dict:
    if not 1 <= days <= MAX_DAYS:
        raise Refused(f"Move 1 to {MAX_DAYS} days at a time.")
    check_copy(state["offset_days"])  # before its first manage.py step, and before anything is stopped or copied
    stop_apps()
    try:
        start_offset = state["offset_days"]
        cp = checkpoint(state, f"Before +{days} day{'s' if days > 1 else ''}")
        save_state(state)
        reports = []
        try:
            for _ in range(days):
                state["offset_days"] += 1
                write_clock(state["offset_days"])
                save_state(state)
                report = last_json(manage(["staging_after_day", "--json"], state["offset_days"]))
                report.setdefault("test_date", test_date(state["offset_days"]))
                reports.append(report)
        except Exception:
            # Nothing half-done: the database and the clock go back to the checkpoint just taken.
            put_in_place(cp["db"])
            state["offset_days"] = start_offset
            write_clock(start_offset)
            raise
        prune(state)
        return {"checkpoint": cp["id"], "days": reports}
    finally:
        save_state(state)
        start_apps()


def back(state: dict, cp_id: int) -> dict:
    cp = find(state, cp_id)
    stop_apps()
    try:
        put_in_place(cp["db"])
        state["offset_days"] = cp["offset_days"]
        write_clock(cp["offset_days"])
        for later in [c for c in state["checkpoints"] if c["id"] > cp_id]:
            drop(later["db"])
            state["checkpoints"].remove(later)
        return {"checkpoint": cp_id, "test_date": test_date(cp["offset_days"])}
    finally:
        save_state(state)
        start_apps()


def today(state: dict) -> dict:
    base = [c for c in state["checkpoints"] if c["kind"] == "base"]
    if not base:
        raise Refused("There is no base checkpoint yet: refresh the copy from prod first.")
    return back(state, base[0]["id"])


def refresh(state: dict) -> dict:
    stop_apps()
    try:
        if os.path.exists(DUMP):
            os.remove(DUMP)
        excludes = [f"--exclude-table-data={table}" for table in PROD_EXCLUDED_DATA]
        run(["sudo", "-u", "postgres", "nice", "-n", "19", "ionice", "-c3", "pg_dump", "-Fc", "-Z", "3", *excludes,
             "-f", DUMP, PROD_DB], timeout=3600)
        drop(NEW_DB)
        pg(f'CREATE DATABASE "{NEW_DB}" OWNER {ROLE}')
        run(["sudo", "-u", "postgres", "nice", "-n", "19", "ionice", "-c3", "pg_restore", "--no-owner",
             "--no-privileges", f"--role={ROLE}", "-j", "4", "-d", NEW_DB, DUMP], timeout=3600)
        pg("ANALYZE", db=NEW_DB)
        os.remove(DUMP)
        swap_in(NEW_DB)
        for cp in list(state["checkpoints"]):
            drop(cp["db"])
        state["checkpoints"] = []
        state["offset_days"] = 0
        write_clock(0)
        save_state(state)
        check_copy(0)  # the restore is in; migrate and the cutover's writes only once the env file names it
        manage(["migrate", "--no-input"], 0, timeout=1800)
        report = {"cutover": last_json(manage(["billing_cutover", "check"], 0)).get("finished")}
        if not report["cutover"]:
            # prod still follows lc-up: take the copy off it the way prod goes on its evening (deploy/CUTOVER.md).
            first_day = test_date(1)
            manage(["billing_cutover", "prepare", "--day", first_day, "--apply", "--no-pull"], 0, timeout=1800)
            manage(["billing_cutover", "finish", "--day", first_day, "--apply"], 0, timeout=1800)
            report["cutover"] = f"finished here, first day {first_day}"
        report["seed"] = last_json(manage(["staging_seed", "--json"], 0))
        cp = checkpoint(state, "Copy of prod", kind="base")
        report["checkpoint"] = cp["id"]
        return report
    finally:
        save_state(state)
        start_apps()


ACTIONS = {
    "forward": lambda state, req: forward(state, int(req.get("days") or 0)),
    "back": lambda state, req: back(state, int(req["checkpoint"])),
    "today": lambda state, req: today(state),
    "refresh": lambda state, req: refresh(state),
}


def handle(path: str) -> None:
    state = load_state()
    try:
        with open(path) as fh:
            req = json.load(fh)
    except (OSError, ValueError) as exc:
        log(f"unreadable request {path}: {exc}")
        os.remove(path)
        return
    os.remove(path)  # taken: a crash below must not run it again
    action = req.get("action")
    entry = {
        "id": req.get("id"),
        "action": action,
        "params": {k: v for k, v in req.items() if k in ("days", "checkpoint")},
        "by": req.get("by"),
        "started_at": now_iso(),
    }
    state["busy"] = entry
    save_state(state)
    log(f"start {entry}")
    try:
        if action not in ACTIONS:
            raise Refused(f"Unknown action {action!r}.")
        result = ACTIONS[action](state, req)
        entry.update(ok=True, result=result)
    except Refused as refused:
        entry.update(ok=False, error=str(refused))
    except Exception as exc:  # noqa: BLE001 - recorded for the toolbox; the loop goes on
        entry.update(ok=False, error=f"{type(exc).__name__}: {exc}"[:2000])
        log(traceback.format_exc())
        try:
            start_apps()
        except Exception:  # noqa: BLE001
            log(traceback.format_exc())
    state = load_state()
    entry["finished_at"] = now_iso()
    state["busy"] = None
    state["last"] = entry
    state["history"] = ([entry] + state["history"])[:HISTORY]
    save_state(state)
    log(f"done ok={entry.get('ok')} {entry.get('error', '')}")


def prepare_dirs() -> None:
    os.makedirs(REQ_DIR, exist_ok=True)
    run(["chown", "root:satapp", TM])
    os.chmod(TM, 0o755)
    run(["chown", "satapp:satapp", REQ_DIR])
    os.chmod(REQ_DIR, 0o770)
    if not os.path.exists(CLOCK):
        write_clock(load_state()["offset_days"])


def main() -> None:
    prepare_dirs()
    recover()
    state = load_state()
    if state.get("busy"):
        # Stopped while working: say so, and make sure the copy is running.
        state["last"] = {**state["busy"], "ok": False, "error": "interrupted (the time machine restarted)"}
        state["busy"] = None
        save_state(state)
        try:
            start_apps()
        except Exception:  # noqa: BLE001
            log(traceback.format_exc())
    save_state(state)
    log("time machine ready")
    while True:
        for path in sorted(glob.glob(f"{REQ_DIR}/*.json")):
            handle(path)
        time.sleep(2)


if __name__ == "__main__":
    sys.exit(main())
