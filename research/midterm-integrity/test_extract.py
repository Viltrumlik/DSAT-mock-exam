"""Tests for extract.py on a throwaway local Postgres, with synthetic rows only.

    STUDY_TEST_DSN=postgresql://me@127.0.0.1:55432/extract_test python3 -m unittest test_extract -v

The database named by STUDY_TEST_DSN is WIPED: its name must contain "test". The tables are a
minimal mirror of the Django ones (only the columns extract.py reads).

Optionally, SCHEMA_CHECK_DSN names a database migrated by Django (`manage.py migrate`); the
schema test then proves every column extract.py reads exists there with the same name.
"""

from __future__ import annotations

import csv
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import psycopg2

import extract

DSN = os.environ.get("STUDY_TEST_DSN", "")
SCHEMA_DSN = os.environ.get("SCHEMA_CHECK_DSN", "")

# Every (table, column) extract.py reads. The schema test checks these against Django's tables.
COLUMNS = {
    "midterms_attempt": [
        "id", "student_id", "midterm_id", "version_id", "started_at", "module_2_started_at", "submitted_at",
        "completed_at", "updated_at", "current_state", "is_completed", "score", "paper_scale",
        "paper_pass_mark", "offscreen_violations", "terminated_reason",
    ],
    "midterms_midterm": [
        "id", "midterm_type", "subject", "level", "retake_of_id", "scoring_scale", "pass_mark",
        "duration_minutes", "duration_minutes_2",
    ],
    "midterms_version": ["id", "version_number"],
    "users": ["id", "role", "is_staff", "is_superuser"],
    "desktop_midterm_lockdown": ["attempt_id", "session_opened_at", "sessions_opened", "app_version", "required"],
    "midterms_outcome": ["attempt_id", "passed", "decided_at"],
    "midterms_resit": ["attempt_id"],
    "desktop_exemption": ["student_id", "created_at", "revoked_at"],
    "midterms_attempt_idempotency_keys": ["id", "attempt_id", "endpoint", "created_at", "response_status", "response_json"],
    "midterms_attempt_engine_audit": ["attempt_id", "event", "detail", "created_at"],
}

DDL = """
DROP TABLE IF EXISTS midterms_attempt_engine_audit, midterms_attempt_idempotency_keys, desktop_exemption,
    midterms_resit, midterms_outcome, desktop_midterm_lockdown, midterms_attempt, midterms_version,
    midterms_midterm, users CASCADE;
CREATE TABLE users (id bigint PRIMARY KEY, role varchar(30), is_staff bool, is_superuser bool,
    email varchar(254), first_name varchar(150), phone_number varchar(32));
CREATE TABLE midterms_midterm (id bigint PRIMARY KEY, title varchar(255), midterm_type varchar(16),
    subject varchar(20), level varchar(16), retake_of_id bigint, scoring_scale varchar(16),
    pass_mark smallint, duration_minutes int, duration_minutes_2 int);
CREATE TABLE midterms_version (id bigint PRIMARY KEY, midterm_id bigint, version_number smallint);
CREATE TABLE midterms_attempt (id bigint PRIMARY KEY, student_id bigint, midterm_id bigint, version_id bigint,
    answers jsonb, started_at timestamptz, module_2_started_at timestamptz, submitted_at timestamptz,
    completed_at timestamptz, updated_at timestamptz, current_state varchar(24), is_completed bool,
    score int, paper_scale varchar(16), paper_pass_mark smallint, offscreen_violations smallint,
    terminated_reason varchar(24));
CREATE TABLE desktop_midterm_lockdown (id bigserial PRIMARY KEY, attempt_id bigint UNIQUE,
    session_opened_at timestamptz, sessions_opened int, app_version varchar(32), required bool, precheck jsonb);
CREATE TABLE midterms_outcome (id bigserial PRIMARY KEY, attempt_id bigint, passed bool, decided_at timestamptz);
CREATE TABLE midterms_resit (id bigserial PRIMARY KEY, attempt_id bigint, reason varchar(255));
CREATE TABLE desktop_exemption (id bigserial PRIMARY KEY, student_id bigint, reason varchar(200),
    created_at timestamptz, revoked_at timestamptz);
CREATE TABLE midterms_attempt_idempotency_keys (id bigserial PRIMARY KEY, attempt_id bigint,
    endpoint varchar(64), key varchar(128), response_status smallint, response_json jsonb,
    created_at timestamptz, expires_at timestamptz);
CREATE TABLE midterms_attempt_engine_audit (id bigserial PRIMARY KEY, attempt_id bigint, event varchar(64),
    from_state varchar(24), to_state varchar(24), version_number int, detail jsonb, created_at timestamptz);
"""

T0 = datetime(2026, 9, 12, 5, 0, tzinfo=timezone.utc)  # 10:00 in Tashkent
STUDENT_A, STUDENT_B, STUDENT_C, TEACHER, TEST_ACCOUNT = 987654301, 987654302, 987654303, 987654304, 987654305
SECRET_TEXT = "Secret Name +998901234567"


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def seed(cur) -> None:
    cur.execute(DDL)
    for uid, role, staff in [(STUDENT_A, "student", False), (STUDENT_B, "student", False),
                             (STUDENT_C, "public_student", False), (TEACHER, "teacher", True),
                             (TEST_ACCOUNT, "student", False)]:
        cur.execute("INSERT INTO users VALUES (%s,%s,%s,false,%s,%s,%s)",
                    (uid, role, staff, f"{uid}@example.com", SECRET_TEXT, "+998901234567"))
    # 60-minute single-module midterm; a two-module one (30 + 30); a retake of the first.
    cur.execute("INSERT INTO midterms_midterm VALUES (11,'Sept R&W','MIDTERM','READING_WRITING','middle',NULL,'100',60,60,NULL)")
    cur.execute("INSERT INTO midterms_midterm VALUES (12,'Oct Math','MIDTERM','MATH','senior',NULL,'800',600,30,30)")
    cur.execute("INSERT INTO midterms_midterm VALUES (13,'Sept R&W retake','RETAKE','READING_WRITING','middle',11,'100',60,60,NULL)")
    cur.execute("INSERT INTO midterms_version VALUES (21,12,3)")

    def attempt(aid, student, midterm, *, version=None, start=0.0, m2=None, submitted=None, state="COMPLETED",
                score=70, strikes=0, terminated=""):
        cur.execute(
            "INSERT INTO midterms_attempt VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (aid, student, midterm, version, json.dumps({"1": SECRET_TEXT}), at(start),
             at(m2) if m2 is not None else None, at(submitted) if submitted is not None else None,
             at(submitted + 5) if submitted is not None and state == "COMPLETED" else None, at(9000), state,
             state == "COMPLETED", score if state == "COMPLETED" else None, "", None, strikes, terminated),
        )

    def req(aid, endpoint, seconds, body=None, status=200):
        cur.execute(
            "INSERT INTO midterms_attempt_idempotency_keys (attempt_id, endpoint, key, response_status,"
            " response_json, created_at, expires_at) VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (aid, endpoint, f"{endpoint}.{aid}.{seconds}", status, json.dumps(body or {"note": SECRET_TEXT}),
             at(seconds), at(seconds + 86400)),
        )

    def audit(aid, seconds, violations, reason, continuing):
        cur.execute(
            "INSERT INTO midterms_attempt_engine_audit (attempt_id, event, detail, created_at) VALUES (%s,'offscreen',%s,%s)",
            (aid, json.dumps({"reason": reason, "continuing": continuing, "violations": violations}), at(seconds)),
        )

    # 1. Browser: two separate short absences, handed in by the client at 0:00, then two saves
    #    from a screen that still thought the paper was running.
    attempt(1, STUDENT_A, 11, submitted=3600, strikes=2)
    req(1, "start", 1)
    req(1, "save_attempt", 100)
    req(1, "offscreen", 600, {"violations": 1, "terminated": False})
    req(1, "offscreen", 1500, {"violations": 2, "terminated": False})
    req(1, "submit_module", 3600.4)
    req(1, "save_attempt", 3700)
    req(1, "save_attempt", 3720)

    # 2. Browser: ONE continuous absence spends all three strikes ~3.15 s apart (forfeit).
    attempt(2, STUDENT_B, 11, submitted=906.3, strikes=3, terminated="OFFSCREEN")
    req(2, "start", 1)
    for n, s in [(1, 900.0), (2, 903.15), (3, 906.3)]:
        req(2, "offscreen", s, {"violations": n, "terminated": n == 3})
        audit(2, s - 0.01, n, "fullscreen", n > 1)
    req(2, "offscreen", 906.35, {"violations": 3}, status=409)  # a refused duplicate: not a strike

    # 3. Browser: stranded, closed by the sweeper 40 minutes after the deadline.
    attempt(3, STUDENT_C, 11, submitted=3600 + 2400)
    req(3, "start", 1)
    req(3, "save_attempt", 1200)

    # 4. App, two modules, version 3: syncs every 15 s with one 120 s silence in module 1,
    #    one strike, handed in at module 2's deadline.
    attempt(4, STUDENT_A, 12, version=21, m2=1800, submitted=3600, strikes=1, score=640)
    t = 1.0
    while t < 1800:
        if not 600 < t < 720:
            req(4, "v1.sync", t, {"outcome": {"applied": True}})
        t += 15
    t = 1801.0
    while t < 3600:
        req(4, "v1.sync", t, {"outcome": {"applied": True}})
        t += 15
    req(4, "v1.offscreen", 1000, {"outcome": {"violations": 1, "terminated": False}})
    req(4, "v1.submit", 1800.2)
    req(4, "v1.submit", 3600.3)
    cur.execute("INSERT INTO desktop_midterm_lockdown (attempt_id, session_opened_at, sessions_opened, app_version,"
                " required, precheck) VALUES (4,%s,2,'0.3.2',true,%s)", (at(0), json.dumps({"apps": ["Telegram"]})))
    cur.execute("INSERT INTO midterms_outcome (attempt_id, passed, decided_at) VALUES (4,true,%s)", (at(3700),))

    # 5. Still open at the snapshot (never handed in).
    attempt(5, STUDENT_B, 12, state="ACTIVE", start=5000)
    req(5, "save_attempt", 5100)

    # 6. Retake sat in the browser by an exempt student, with a re-sit.
    attempt(6, STUDENT_C, 13, start=86400, submitted=86400 + 3600)
    req(6, "submit_module", 86400 + 3600.5)
    cur.execute("INSERT INTO midterms_resit (attempt_id, reason) VALUES (6,%s)", (SECRET_TEXT,))
    cur.execute("INSERT INTO desktop_exemption (student_id, reason, created_at) VALUES (%s,%s,%s)",
                (STUDENT_C, SECRET_TEXT, at(3000)))

    # 7–9. Excluded: a teacher, a test account, and an attempt that never started.
    attempt(7, TEACHER, 11, submitted=3600)
    attempt(8, TEST_ACCOUNT, 11, submitted=3600)
    cur.execute("INSERT INTO midterms_attempt (id, student_id, midterm_id, current_state, offscreen_violations,"
                " is_completed) VALUES (9,%s,11,'NOT_STARTED',0,false)", (STUDENT_A,))


@unittest.skipUnless(DSN and "test" in (urlparse(DSN).path or ""), "set STUDY_TEST_DSN to a throwaway *test* database")
class ExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        conn = psycopg2.connect(DSN)
        with conn, conn.cursor() as cur:
            seed(cur)
        conn.close()
        cls.tmp = tempfile.TemporaryDirectory()
        salt = Path(cls.tmp.name) / "study.salt"
        salt.write_text("x" * 48)
        cls.out = Path(cls.tmp.name) / "out"
        cls.manifest = extract.run(extract.parse_args(
            ["--dsn", DSN, "--salt-file", str(salt), "--out", str(cls.out), "--exclude-user-ids", str(TEST_ACCOUNT)]
        ))
        cls.hasher = extract.Hasher(b"x" * 48)
        with (cls.out / "attempts.csv").open() as f:
            cls.attempts = {r["attempt_hash"]: r for r in csv.DictReader(f)}
        with (cls.out / "strikes.csv").open() as f:
            cls.strikes = list(csv.DictReader(f))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def row(self, attempt_id):
        return self.attempts[self.hasher("attempt", attempt_id)]

    def strikes_of(self, attempt_id):
        h = self.hasher("attempt", attempt_id)
        return sorted((s for s in self.strikes if s["attempt_hash"] == h), key=lambda s: int(s["strike_no"]))

    def test_only_started_student_attempts_are_kept(self):
        self.assertEqual(len(self.attempts), 6)
        self.assertEqual(self.manifest["rows"]["attempts_excluded_non_student"], 2)
        self.assertEqual(self.manifest["rows"]["students"], 3)

    def test_no_identifier_or_free_text_leaves_the_database(self):
        blob = "".join(p.read_text() for p in self.out.iterdir())
        for uid in (STUDENT_A, STUDENT_B, STUDENT_C, TEACHER, TEST_ACCOUNT):
            self.assertNotIn(str(uid), blob)
        for needle in ("Secret", "998901234567", "example.com", "Telegram"):
            self.assertNotIn(needle, blob)

    def test_same_student_same_hash_across_attempts(self):
        self.assertEqual(self.row(1)["student_hash"], self.row(4)["student_hash"])
        self.assertNotEqual(self.row(1)["student_hash"], self.row(2)["student_hash"])

    def test_browser_attempt_with_two_short_absences(self):
        r = self.row(1)
        self.assertEqual((r["client_type"], r["warnings"], r["warning_rows"], r["absences_inferred"]),
                         ("browser", "2", "2", "2"))
        self.assertEqual((r["forced_submit"], r["submit_source"], r["on_time_submission"]), ("0", "client_submit", "1"))
        self.assertEqual((r["month"], r["exam_date"]), ("2026-09", "2026-09-12"))
        self.assertEqual(r["post_close_saves"], "2")
        self.assertEqual([s["still_away_at_grace_end"] for s in self.strikes_of(1)], ["0", "0"])

    def test_one_continuous_absence_that_forfeits(self):
        r = self.row(2)
        self.assertEqual((r["warnings"], r["warning_rows"], r["absences_inferred"], r["forced_submit"]),
                         ("3", "3", "1", "1"))
        self.assertEqual((r["submit_source"], r["on_time_submission"]), ("forfeit", ""))
        s = self.strikes_of(2)
        self.assertEqual([x["inferred_continuation"] for x in s], ["0", "1", "1"])
        self.assertEqual([x["still_away_at_grace_end"] for x in s], ["1", "1", ""])
        self.assertEqual([x["gap_prev_s"] for x in s], ["", "3.15", "3.15"])
        self.assertEqual([x["audit_reason"] for x in s], ["fullscreen"] * 3)
        self.assertEqual([x["audit_continuing"] for x in s], ["false", "true", "true"])
        self.assertEqual([x["ended_paper"] for x in s], ["0", "0", "1"])

    def test_stranded_attempt_closed_by_the_sweeper(self):
        r = self.row(3)
        self.assertEqual((r["submit_source"], r["submit_delay_s"], r["swept_late"], r["stuck_incomplete"]),
                         ("no_client_request", "2400", "1", "1"))
        self.assertEqual(r["on_time_submission"], "0")

    def test_app_attempt_two_modules(self):
        r = self.row(4)
        self.assertEqual((r["client_type"], r["app_version"], r["app_sessions_opened"], r["app_lockdown_required"]),
                         ("app", "0.3.2", "2", "1"))
        self.assertEqual((r["version"], r["reached_module_2"], r["score"], r["scoring_scale"], r["passed"]),
                         ("3", "1", "640", "800", "1"))
        self.assertEqual((r["warnings"], r["warning_rows"], r["submit_source"], r["on_time_submission"]),
                         ("1", "1", "client_submit", "1"))
        self.assertEqual(self.strikes_of(4)[0]["strike_client"], "app")

    def test_no_connection_measure_is_exported(self):
        # Stored app syncs track answer changes, not connectivity (see extract.py).
        self.assertFalse(any("sync" in c for c in extract.ATTEMPT_COLUMNS))

    def test_open_attempt(self):
        r = self.row(5)
        self.assertEqual((r["submit_source"], r["open_at_snapshot"], r["stuck_incomplete"], r["on_time_submission"]),
                         ("not_submitted", "1", "1", "0"))

    def test_retake_resit_and_exemption(self):
        r = self.row(6)
        self.assertEqual((r["is_retake"], r["retake_of_exam_id"], r["used_resit"], r["browser_exempt_at_start"]),
                         ("1", "11", "1", "1"))
        self.assertEqual(self.row(1)["browser_exempt_at_start"], "0")

    def test_manifest(self):
        self.assertEqual(self.manifest["client_type_counts"], {"browser": 5, "app": 1, "mixed": 0, "unknown": 0})
        self.assertEqual(self.manifest["rows"]["attempts_warning_count_ne_strike_rows"], 0)
        self.assertEqual(self.manifest["rows"]["strikes"], 6)
        self.assertTrue(self.manifest["coverage_utc"]["first_required_app_session"].startswith("2026-09-12T05:00"))

    def test_extract_connection_cannot_write(self):
        conn = extract.connect_read_only(DSN)
        try:
            with self.assertRaises(psycopg2.errors.ReadOnlySqlTransaction), conn.cursor() as cur:
                cur.execute("UPDATE midterms_attempt SET score = 0")
        finally:
            conn.rollback()
            conn.close()


class GuardTest(unittest.TestCase):
    def test_refuses_a_remote_host(self):
        with self.assertRaises(SystemExit):
            extract.check_local("postgresql://reader@db.example.org/prod", allow_remote=False)
        extract.check_local("postgresql://reader@127.0.0.1/copy", allow_remote=False)

    def test_refuses_a_salt_inside_the_repository(self):
        inside = extract.SCRIPT_DIR / "tmp-test.salt"
        inside.write_text("y" * 40)
        try:
            with self.assertRaises(SystemExit):
                extract.load_salt(str(inside))
        finally:
            inside.unlink()

    def test_refuses_a_short_salt(self):
        with tempfile.NamedTemporaryFile("w", suffix=".salt", delete=False) as f:
            f.write("short")
        try:
            with self.assertRaises(SystemExit):
                extract.load_salt(f.name)
        finally:
            os.unlink(f.name)


COPY_DSN = os.environ.get("STUDY_TEST_COPY_DSN", "")


@unittest.skipUnless(DSN and COPY_DSN and "test" in urlparse(COPY_DSN).path,
                     "set STUDY_TEST_DSN and STUDY_TEST_COPY_DSN to two throwaway *test* databases")
class MinimalExportRoundTripTest(unittest.TestCase):
    """export_minimal.sh -> load_copy.sh -> extract.py gives what extract.py gives on the source."""

    def test_round_trip(self):
        import subprocess

        conn = psycopg2.connect(DSN)
        with conn, conn.cursor() as cur:
            seed(cur)
        conn.close()
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            salt = tmp / "s.salt"
            salt.write_text("z" * 40)
            export = tmp / "export"
            subprocess.run(["bash", str(extract.SCRIPT_DIR / "export_minimal.sh"), str(export)],
                           env={**os.environ, "DATABASE_URL": DSN}, check=True, capture_output=True)
            exported = "".join(p.read_text() for p in export.glob("*.csv"))
            for needle in ("Secret", "998901234567", "example.com", "Telegram"):
                self.assertNotIn(needle, exported)
            subprocess.run(["bash", str(extract.SCRIPT_DIR / "load_copy.sh"), str(export), COPY_DSN],
                           check=True, capture_output=True)
            outputs = {}
            for name, dsn in (("source", DSN), ("copy", COPY_DSN)):
                out = tmp / name
                extract.run(extract.parse_args(["--dsn", dsn, "--salt-file", str(salt), "--out", str(out),
                                                "--exclude-user-ids", str(TEST_ACCOUNT)]))
                outputs[name] = {f: (out / f).read_text() for f in ("attempts.csv", "strikes.csv")}
            self.assertEqual(outputs["source"], outputs["copy"])
            self.assertGreater(outputs["copy"]["strikes.csv"].count("\n"), 1)


@unittest.skipUnless(SCHEMA_DSN, "set SCHEMA_CHECK_DSN to a database migrated by Django")
class DjangoSchemaTest(unittest.TestCase):
    def test_every_column_read_exists_in_the_django_schema(self):
        conn = psycopg2.connect(SCHEMA_DSN)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'")
                have = set(cur.fetchall())
        finally:
            conn.close()
        missing = [(t, c) for t, cols in COLUMNS.items() for c in cols if (t, c) not in have]
        self.assertEqual(missing, [])


if __name__ == "__main__":
    unittest.main()
