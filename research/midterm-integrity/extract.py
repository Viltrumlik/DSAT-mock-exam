#!/usr/bin/env python3
"""Read-only, anonymized extract for the midterm integrity study (browser era vs app era).

Runs against a RESTORED COPY of the production database (a dump loaded into a local Postgres),
never against production itself. It writes three files into ``--out``:

    attempts.csv   one row per midterm attempt that started
    strikes.csv    one row per off-screen strike the server counted
    manifest.json  parameters, row counts and data-coverage dates (no identifiers, no salt)

What it never exports: names, phone numbers, emails, Telegram ids, raw user or attempt ids,
answers, any JSON body, the app's machine pre-check, or any free-text column. Student and
attempt ids are replaced by HMAC-SHA256 hashes keyed with a secret salt that lives outside git.

The column meanings, and which ones are inferred rather than logged, are in README.md.

    python3 extract.py --dsn postgresql://me@127.0.0.1:5432/mastersat_copy \\
        --salt-file ~/secrets/midterm-study.salt --out ./data
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import psycopg2

LOCAL_TZ = ZoneInfo("Asia/Tashkent")
SCRIPT_DIR = Path(__file__).resolve().parent

# Request names in midterms_attempt_idempotency_keys.endpoint, by the client that sends them.
WEB_ENDPOINTS = {"start", "save_attempt", "submit_module", "offscreen"}
APP_ENDPOINTS = {"v1.start", "v1.sync", "v1.submit", "v1.offscreen"}
STRIKE_ENDPOINTS = {"offscreen", "v1.offscreen"}
SUBMIT_ENDPOINTS = {"submit_module", "v1.submit"}

STUDENT_ROLES = ("student", "public_student")
OPEN_STATES = {"ACTIVE", "MODULE_2_ACTIVE", "SCORING"}
AUDIT_REASONS = {"hidden", "fullscreen", "blur"}

# Server rules the derived columns are measured against (backend/midterms).
LATE_ANSWER_GRACE_S = 300  # views.LATE_ANSWER_GRACE_SECONDS
SWEEP_GRACE_S = 30 * 60  # sweep_midterm_attempts --grace-minutes default
# The request that caused a submit is stored just after it; anything later than this after
# submitted_at is a separate request.
SUBMIT_MATCH_WINDOW_S = 15


# ── setup ──────────────────────────────────────────────────────────────────────────────────
def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dsn", default=os.environ.get("STUDY_DSN"), help="Postgres URL of the restored copy (or STUDY_DSN).")
    p.add_argument("--salt-file", required=True, help="File holding the secret hashing salt (>= 32 chars), outside git.")
    p.add_argument("--out", default=str(SCRIPT_DIR / "data"), help="Output directory (git-ignored by default).")
    p.add_argument(
        "--allow-remote",
        action="store_true",
        help="Allow a non-local host. Only for a read-only REPLICA; never point this at production.",
    )
    p.add_argument("--continuation-min-s", type=float, default=2.5,
                   help="Smallest gap after the previous strike that still reads as the same absence.")
    p.add_argument("--continuation-max-s", type=float, default=5.0,
                   help="Largest gap after the previous strike that still reads as the same absence.")
    p.add_argument("--sync-gap-s", type=float, default=45.0,
                   help="App only: a silence longer than this between server contacts counts as a sync gap "
                        "(the app syncs every 15 s).")
    p.add_argument("--exclude-user-ids", default="",
                   help="Comma-separated user ids to drop (test accounts). They are never written anywhere.")
    args = p.parse_args(argv)
    if not args.dsn:
        p.error("--dsn (or STUDY_DSN) is required")
    if not 0 < args.continuation_min_s < args.continuation_max_s:
        p.error("need 0 < --continuation-min-s < --continuation-max-s")
    return args


def load_salt(path: str) -> bytes:
    salt_path = Path(path).expanduser().resolve()
    repo_root = SCRIPT_DIR.parent.parent
    if repo_root in salt_path.parents:
        sys.exit(f"Refusing: the salt file must live outside the repository ({repo_root}).")
    salt = salt_path.read_bytes().strip()
    if len(salt) < 32:
        sys.exit("Refusing: the salt must be at least 32 characters.")
    return salt


def check_local(dsn: str, allow_remote: bool) -> None:
    host = urlparse(dsn).hostname or "localhost"
    if host not in {"localhost", "127.0.0.1", "::1"} and not allow_remote:
        sys.exit(f"Refusing: host {host!r} is not local. Restore the dump locally, or pass --allow-remote "
                 "for a read-only replica.")


def connect_read_only(dsn: str):
    """A connection that cannot write: read-only by session default AND by transaction, checked."""
    conn = psycopg2.connect(dsn, options="-c default_transaction_read_only=on -c statement_timeout=600000")
    conn.set_session(readonly=True, autocommit=False)
    with conn.cursor() as cur:
        cur.execute("SHOW transaction_read_only")
        if cur.fetchone()[0] != "on":
            conn.close()
            sys.exit("Refusing: the connection is not read-only.")
    return conn


class Hasher:
    def __init__(self, salt: bytes):
        self._salt = salt

    def __call__(self, kind: str, value: int) -> str:
        return hmac.new(self._salt, f"{kind}:{int(value)}".encode(), hashlib.sha256).hexdigest()[:16]


# ── queries (narrow: only the columns the study needs) ─────────────────────────────────────
ATTEMPTS_SQL = """
SELECT a.id, a.student_id, a.midterm_id,
       m.midterm_type, m.subject, m.level, m.retake_of_id,
       m.scoring_scale, m.pass_mark, m.duration_minutes, m.duration_minutes_2,
       a.started_at, a.module_2_started_at, a.submitted_at, a.completed_at,
       a.current_state, a.is_completed, a.score, a.paper_scale, a.paper_pass_mark,
       a.offscreen_violations, a.terminated_reason,
       v.version_number,
       l.session_opened_at IS NOT NULL AS app_session, l.sessions_opened, l.app_version, l.required,
       (SELECT o.passed FROM midterms_outcome o WHERE o.attempt_id = a.id
         ORDER BY o.decided_at DESC LIMIT 1) AS passed,
       EXISTS (SELECT 1 FROM midterms_resit r WHERE r.attempt_id = a.id) AS used_resit,
       EXISTS (SELECT 1 FROM desktop_exemption e
                WHERE e.student_id = a.student_id AND e.created_at <= a.started_at
                  AND (e.revoked_at IS NULL OR e.revoked_at > a.started_at)) AS exempt_at_start
  FROM midterms_attempt a
  JOIN midterms_midterm m ON m.id = a.midterm_id
  JOIN users u ON u.id = a.student_id
  LEFT JOIN midterms_version v ON v.id = a.version_id
  LEFT JOIN desktop_midterm_lockdown l ON l.attempt_id = a.id
 WHERE a.started_at IS NOT NULL
   AND a.current_state <> 'NOT_STARTED'
   AND u.role IN %(roles)s
   AND NOT u.is_staff AND NOT u.is_superuser
   AND NOT (a.student_id = ANY(%(excluded)s::bigint[]))
 ORDER BY a.started_at, a.id
"""

EXCLUDED_COUNT_SQL = """
SELECT count(*) FROM midterms_attempt a JOIN users u ON u.id = a.student_id
 WHERE a.started_at IS NOT NULL AND a.current_state <> 'NOT_STARTED'
   AND (u.role NOT IN %(roles)s OR u.is_staff OR u.is_superuser OR a.student_id = ANY(%(excluded)s::bigint[]))
"""

# Only numbers are read out of the stored response: the strike count. The browser stores the
# response itself; the app stores {"outcome": {...}}.
REQUESTS_SQL = """
SELECT k.attempt_id, k.endpoint, k.created_at, k.response_status,
       CASE WHEN k.endpoint IN ('offscreen', 'v1.offscreen') THEN
            NULLIF(regexp_replace(COALESCE(k.response_json->>'violations',
                                           k.response_json->'outcome'->>'violations', ''), '[^0-9]', '', 'g'), '')::int
       END AS strike_no
  FROM midterms_attempt_idempotency_keys k
 WHERE k.attempt_id = ANY(%(ids)s::bigint[])
   AND k.endpoint IN %(endpoints)s
 ORDER BY k.attempt_id, k.created_at, k.id
"""

AUDIT_SQL = """
SELECT attempt_id, detail->>'reason', detail->>'continuing', detail->>'violations'
  FROM midterms_attempt_engine_audit
 WHERE event = 'offscreen' AND attempt_id = ANY(%(ids)s::bigint[])
"""

COVERAGE_SQL = {
    "first_browser_strike_row": "SELECT min(created_at) FROM midterms_attempt_idempotency_keys WHERE endpoint = 'offscreen'",
    "first_app_request_row": "SELECT min(created_at) FROM midterms_attempt_idempotency_keys WHERE endpoint LIKE 'v1.%%'",
    "first_app_session": "SELECT min(session_opened_at) FROM desktop_midterm_lockdown",
    "first_required_app_session": "SELECT min(session_opened_at) FROM desktop_midterm_lockdown WHERE required",
    "first_strike_audit_row": "SELECT min(created_at) FROM midterms_attempt_engine_audit WHERE event = 'offscreen'",
    "last_attempt_update": "SELECT max(updated_at) FROM midterms_attempt",
}


# ── derivation ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Request:
    endpoint: str
    at: datetime
    status: int
    strike_no: int | None


@dataclass
class Strike:
    strike_no: int
    at: datetime
    client: str
    gap_prev_s: float | None = None
    continuation: bool | None = None
    audit_reason: str = ""
    audit_continuing: str = ""
    still_away_at_grace_end: bool | None = None


@dataclass
class Derived:
    client_type: str
    web_requests: int
    app_requests: int
    strikes: list[Strike] = field(default_factory=list)
    submit_source: str = ""
    submit_delay_s: int | None = None
    on_time: bool | None = None
    swept_late: bool = False
    open_at_snapshot: bool = False
    post_close_saves: int = 0
    app_sync_gaps: int | None = None
    app_max_sync_gap_s: int | None = None


def module_windows(row) -> list[tuple[datetime, datetime]]:
    """Each module's [start, deadline]. Durations are the midterm's current ones (not pinned)."""
    d1 = int(row["duration_minutes"] or 0)
    d2 = int(row["duration_minutes_2"] or row["duration_minutes"] or 0)
    out = [(row["started_at"], row["started_at"] + timedelta(minutes=d1))]
    if row["module_2_started_at"]:
        out.append((row["module_2_started_at"], row["module_2_started_at"] + timedelta(minutes=d2)))
    return out


def classify_client(requests: list[Request], app_session: bool) -> tuple[str, int, int]:
    web = sum(1 for r in requests if r.endpoint in WEB_ENDPOINTS)
    app = sum(1 for r in requests if r.endpoint in APP_ENDPOINTS)
    app_evidence = app > 0 or app_session
    if app_evidence and web:
        kind = "mixed"
    elif app_evidence:
        kind = "app"
    elif web:
        kind = "browser"
    else:
        kind = "unknown"
    return kind, web, app


def derive_strikes(requests, audit_rows, *, forced: bool, cmin: float, cmax: float) -> list[Strike]:
    seen: dict[int, Strike] = {}
    for r in requests:
        if r.endpoint not in STRIKE_ENDPOINTS or r.strike_no is None or r.status >= 400:
            continue
        if r.strike_no not in seen:  # one row per counted strike; the first arrival wins
            client = "app" if r.endpoint.startswith("v1.") else "browser"
            seen[r.strike_no] = Strike(strike_no=r.strike_no, at=r.at, client=client)
    strikes = sorted(seen.values(), key=lambda s: (s.at, s.strike_no))
    for prev, cur in zip(strikes, strikes[1:]):
        cur.gap_prev_s = round((cur.at - prev.at).total_seconds(), 3)
        cur.continuation = cmin <= cur.gap_prev_s <= cmax
    if strikes:
        strikes[0].continuation = False
    by_no = {}
    for reason, continuing, violations in audit_rows:
        if violations and str(violations).isdigit():
            by_no[int(violations)] = (
                reason if reason in AUDIT_REASONS else "",
                continuing if continuing in ("true", "false") else "",
            )
    for i, s in enumerate(strikes):
        s.audit_reason, s.audit_continuing = by_no.get(s.strike_no, ("", ""))
        nxt = strikes[i + 1] if i + 1 < len(strikes) else None
        if nxt is not None:
            s.still_away_at_grace_end = bool(nxt.continuation)
        elif forced:
            s.still_away_at_grace_end = None  # this strike ended the paper; there was no grace
        else:
            s.still_away_at_grace_end = False
    return strikes


def derive_submission(row, requests, d: Derived) -> None:
    submitted = row["submitted_at"]
    end_deadline = module_windows(row)[-1][1]
    forced = row["terminated_reason"] == "OFFSCREEN"
    d.open_at_snapshot = (not row["is_completed"]) and row["current_state"] in OPEN_STATES
    if not submitted:
        d.submit_source = "not_submitted"
        d.on_time = False
        return
    d.submit_delay_s = int((submitted - end_deadline).total_seconds())
    near = [
        r for r in requests
        if timedelta(seconds=-1) <= r.at - submitted <= timedelta(seconds=SUBMIT_MATCH_WINDOW_S)
    ]
    if forced:
        d.submit_source = "forfeit"
    elif any(r.endpoint in SUBMIT_ENDPOINTS for r in near):
        d.submit_source = "client_submit"
    elif any(r.endpoint == "save_attempt" for r in near):
        d.submit_source = "autosave_after_expiry"
    else:
        d.submit_source = "no_client_request"
    d.on_time = None if forced else d.submit_delay_s <= LATE_ANSWER_GRACE_S
    d.swept_late = d.submit_source == "no_client_request" and d.submit_delay_s >= SWEEP_GRACE_S
    late_cutoff = submitted + timedelta(seconds=SUBMIT_MATCH_WINDOW_S)
    d.post_close_saves = sum(1 for r in requests if r.endpoint == "save_attempt" and r.at > late_cutoff)


def derive_sync_gaps(row, requests, d: Derived, gap_s: float) -> None:
    """App only: silences between the app's stored requests while a module was running."""
    contacts = sorted(r.at for r in requests if r.endpoint in APP_ENDPOINTS)
    if not contacts:
        return
    gaps, longest = 0, 0.0
    for start, deadline in module_windows(row):
        end = min(deadline, row["submitted_at"]) if row["submitted_at"] else deadline
        if end <= start:
            continue
        points = [start] + [t for t in contacts if start < t < end] + [end]
        for a, b in zip(points, points[1:]):
            g = (b - a).total_seconds()
            longest = max(longest, g)
            if g > gap_s:
                gaps += 1
    d.app_sync_gaps, d.app_max_sync_gap_s = gaps, int(longest)


# ── output ─────────────────────────────────────────────────────────────────────────────────
ATTEMPT_COLUMNS = [
    "attempt_hash", "student_hash", "exam_id", "exam_type", "subject", "level", "is_retake",
    "retake_of_exam_id", "used_resit", "exam_date", "month", "version", "reached_module_2",
    "client_type", "web_requests", "app_requests", "app_version", "app_sessions_opened",
    "app_lockdown_required", "browser_exempt_at_start",
    "warnings", "warning_rows", "absences_inferred", "forced_submit",
    "submit_source", "submit_delay_s", "on_time_submission", "swept_late", "open_at_snapshot",
    "stuck_incomplete", "post_close_saves", "app_sync_gaps", "app_max_sync_gap_s",
    "state", "score", "scoring_scale", "pass_mark", "passed",
]
STRIKE_COLUMNS = [
    "attempt_hash", "student_hash", "exam_id", "month", "attempt_client_type", "strike_client",
    "strike_no", "seconds_since_start", "gap_prev_s", "inferred_continuation",
    "still_away_at_grace_end", "audit_reason", "audit_continuing", "ended_paper",
]


def flag(v) -> str:
    return "" if v is None else ("1" if v else "0")


def blank(v):
    return "" if v is None else v


def attempt_row(row, d: Derived, h: Hasher) -> dict:
    local_start = row["started_at"].astimezone(LOCAL_TZ)
    forced = row["terminated_reason"] == "OFFSCREEN"
    pinned = bool(row["paper_scale"])
    return {
        "attempt_hash": h("attempt", row["id"]),
        "student_hash": h("student", row["student_id"]),
        "exam_id": row["midterm_id"],
        "exam_type": row["midterm_type"],
        "subject": row["subject"],
        "level": row["level"] or "",
        "is_retake": flag(row["midterm_type"] == "RETAKE" or row["used_resit"]),
        "retake_of_exam_id": blank(row["retake_of_id"]),
        "used_resit": flag(row["used_resit"]),
        "exam_date": local_start.date().isoformat(),
        "month": local_start.strftime("%Y-%m"),
        "version": blank(row["version_number"]),
        "reached_module_2": flag(row["module_2_started_at"] is not None),
        "client_type": d.client_type,
        "web_requests": d.web_requests,
        "app_requests": d.app_requests,
        "app_version": (row["app_version"] or "")[:32],
        "app_sessions_opened": blank(row["sessions_opened"]),
        "app_lockdown_required": flag(row["required"]),
        "browser_exempt_at_start": flag(row["exempt_at_start"]),
        "warnings": int(row["offscreen_violations"] or 0),
        "warning_rows": len(d.strikes),
        "absences_inferred": sum(1 for s in d.strikes if not s.continuation),
        "forced_submit": flag(forced),
        "submit_source": d.submit_source,
        "submit_delay_s": blank(d.submit_delay_s),
        "on_time_submission": flag(d.on_time),
        "swept_late": flag(d.swept_late),
        "open_at_snapshot": flag(d.open_at_snapshot),
        "stuck_incomplete": flag(d.swept_late or d.open_at_snapshot),
        "post_close_saves": d.post_close_saves,
        "app_sync_gaps": blank(d.app_sync_gaps),
        "app_max_sync_gap_s": blank(d.app_max_sync_gap_s),
        "state": row["current_state"],
        "score": blank(row["score"]),
        "scoring_scale": (row["paper_scale"] if pinned else row["scoring_scale"]) or "",
        "pass_mark": blank(row["paper_pass_mark"] if pinned else row["pass_mark"]),
        "passed": flag(row["passed"]),
    }


def strike_rows(row, d: Derived, base: dict) -> list[dict]:
    forced = row["terminated_reason"] == "OFFSCREEN"
    last = len(d.strikes) - 1
    return [
        {
            "attempt_hash": base["attempt_hash"],
            "student_hash": base["student_hash"],
            "exam_id": base["exam_id"],
            "month": base["month"],
            "attempt_client_type": d.client_type,
            "strike_client": s.client,
            "strike_no": s.strike_no,
            "seconds_since_start": round((s.at - row["started_at"]).total_seconds(), 3),
            "gap_prev_s": blank(s.gap_prev_s),
            "inferred_continuation": flag(s.continuation),
            "still_away_at_grace_end": flag(s.still_away_at_grace_end),
            "audit_reason": s.audit_reason,
            "audit_continuing": s.audit_continuing,
            "ended_paper": flag(forced and i == last),
        }
        for i, s in enumerate(d.strikes)
    ]


def write_csv(path: Path, columns: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=columns)
        w.writeheader()
        w.writerows(rows)


def iso(v):
    return v.astimezone(timezone.utc).isoformat() if isinstance(v, datetime) else v


# ── main ───────────────────────────────────────────────────────────────────────────────────
def run(args) -> dict:
    check_local(args.dsn, args.allow_remote)
    h = Hasher(load_salt(args.salt_file))
    excluded = [int(x) for x in args.exclude_user_ids.split(",") if x.strip()]
    params = {"roles": STUDENT_ROLES, "excluded": excluded}

    conn = connect_read_only(args.dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(ATTEMPTS_SQL, params)
            cols = [c.name for c in cur.description]
            attempts = [dict(zip(cols, r)) for r in cur.fetchall()]
            cur.execute(EXCLUDED_COUNT_SQL, params)
            excluded_attempts = cur.fetchone()[0]
            ids = [a["id"] for a in attempts]

            requests: dict[int, list[Request]] = defaultdict(list)
            cur.execute(REQUESTS_SQL, {"ids": ids, "endpoints": tuple(sorted(WEB_ENDPOINTS | APP_ENDPOINTS))})
            for attempt_id, endpoint, at, status, strike_no in cur.fetchall():
                requests[attempt_id].append(Request(endpoint, at, int(status or 200), strike_no))

            audit: dict[int, list] = defaultdict(list)
            cur.execute(AUDIT_SQL, {"ids": ids})
            for attempt_id, reason, continuing, violations in cur.fetchall():
                audit[attempt_id].append((reason, continuing, violations))

            coverage = {}
            for name, sql in COVERAGE_SQL.items():
                cur.execute(sql)
                coverage[name] = iso(cur.fetchone()[0])
        conn.rollback()  # nothing was written; end the read-only transaction explicitly
    finally:
        conn.close()

    out_attempts, out_strikes = [], []
    mismatched = 0
    for row in attempts:
        reqs = requests.get(row["id"], [])
        kind, web, app = classify_client(reqs, bool(row["app_session"]))
        d = Derived(client_type=kind, web_requests=web, app_requests=app)
        d.strikes = derive_strikes(reqs, audit.get(row["id"], []), forced=row["terminated_reason"] == "OFFSCREEN",
                                   cmin=args.continuation_min_s, cmax=args.continuation_max_s)
        derive_submission(row, reqs, d)
        derive_sync_gaps(row, reqs, d, args.sync_gap_s)
        base = attempt_row(row, d, h)
        if base["warnings"] != base["warning_rows"]:
            mismatched += 1
        out_attempts.append(base)
        out_strikes.extend(strike_rows(row, d, base))

    out = Path(args.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "attempts.csv", ATTEMPT_COLUMNS, out_attempts)
    write_csv(out / "strikes.csv", STRIKE_COLUMNS, out_strikes)

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "parameters": {
            "continuation_window_s": [args.continuation_min_s, args.continuation_max_s],
            "app_sync_gap_s": args.sync_gap_s,
            "late_answer_grace_s": LATE_ANSWER_GRACE_S,
            "sweep_grace_s": SWEEP_GRACE_S,
            "submit_match_window_s": SUBMIT_MATCH_WINDOW_S,
            "student_roles": list(STUDENT_ROLES),
            "excluded_user_count": len(excluded),
        },
        "rows": {
            "attempts": len(out_attempts),
            "strikes": len(out_strikes),
            "students": len({r["student_hash"] for r in out_attempts}),
            "attempts_excluded_non_student": excluded_attempts,
            "attempts_warning_count_ne_strike_rows": mismatched,
        },
        "client_type_counts": {
            k: sum(1 for r in out_attempts if r["client_type"] == k) for k in ("browser", "app", "mixed", "unknown")
        },
        "coverage_utc": coverage,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv=None) -> int:
    manifest = run(parse_args(argv))
    print(json.dumps(manifest["rows"], indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
