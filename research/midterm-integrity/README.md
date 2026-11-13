# Midterm integrity study: data extraction

This folder holds the read-only, anonymized extract for the study comparing midterms sat in the browser with midterms sat in the native app (RQ1–RQ3). `extract.py` reads a **restored copy** of the production database and writes three files. Nothing here touches production.

## Rules this code enforces

| Rule | How |
|---|---|
| Never write to the database | The connection is read-only twice over (`default_transaction_read_only=on` plus a read-only session), and the script checks `transaction_read_only = on` before any query. A test proves an `UPDATE` fails. |
| Never production | Only a local host is accepted (`localhost`, `127.0.0.1`, `::1`). `--allow-remote` exists only for a read-only replica. |
| No identifiers | Student and attempt ids become HMAC-SHA256 hashes (16 hex characters) keyed with a secret salt. No name, email, phone, Telegram id, answer, JSON body, machine pre-check or free-text column is read into the output. A test seeds fake personal data and checks that none of it, and no raw id, reaches any output file. |
| Salt stays secret | The salt file must sit **outside** the repository and be at least 32 characters. It is never written anywhere. Keep it, or the hashes can't be reproduced; lose it, or share it, and pseudonymity is gone. |
| Extracts stay out of git | `.gitignore` here ignores `data/`, `*.csv`, `manifest.json`, `*.salt` and dumps. |
| Small groups suppressed | The extract is row-level and private. Any **reported** figure must suppress groups smaller than 10 students (done in the Phase 3 analysis, not here). |

## Running it

**1. Get a copy.** Use the minimal export (recommended), not a full dump. `export_minimal.sql` copies only the ~40 columns `extract.py` reads, in a read-only transaction. No names, emails, phones, answers, response bodies or free text leave the server; `users` contributes only id, role and the staff flags.

```bash
# On the server (as a user that can read backend.env), from a checkout of this folder:
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' /var/www/satapp/shared/backend.env | cut -d= -f2-)" \
  bash export_minimal.sh /tmp/midterm-study-export          # writes /tmp/midterm-study-export.tar.gz

# Locally: unpack, then rebuild it in a throwaway local database.
mkdir export && tar -xzf midterm-study-export.tar.gz -C export
createdb -h 127.0.0.1 midterm_copy
bash load_copy.sh ./export postgresql://$USER@127.0.0.1:5432/midterm_copy
```

A full dump also works (`pg_restore -h 127.0.0.1 -d mastersat_copy --no-owner --no-privileges <dump>`), but it brings every student's personal data onto the machine.

```bash
# 2. Make a salt once, outside the repository, and keep it.
head -c 48 /dev/urandom | base64 > ~/secrets/midterm-study.salt

# 3. Extract. List test accounts to drop with --exclude-user-ids.
python3 extract.py --dsn postgresql://$USER@127.0.0.1:5432/mastersat_copy \
  --salt-file ~/secrets/midterm-study.salt --exclude-user-ids <ids> --out ./data
```

Needs Python 3.10+ and `psycopg2`. Defaults that can be changed: `--continuation-min-s 2.5`, `--continuation-max-s 5.0`.

**Who is included:** every midterm attempt that started (`started_at` set, state not `NOT_STARTED`) by a user whose role is `student` or `public_student` and who is neither staff nor superuser. The manifest counts the attempts left out.

## Tests

```bash
STUDY_TEST_DSN=postgresql://me@127.0.0.1:55432/extract_test \
SCHEMA_CHECK_DSN=postgresql://me@127.0.0.1:55432/schema_check \
python3 -m unittest test_extract -v
```

`STUDY_TEST_DSN` must be a throwaway database whose name contains `test`; it is wiped and filled with synthetic rows. Setting `STUDY_TEST_COPY_DSN` to a second one adds the round-trip test: export → load → extract must equal extracting the source directly, and the export must hold none of the seeded personal data. `SCHEMA_CHECK_DSN` (optional) is an empty database migrated with `manage.py migrate`; that test proves every column the script reads exists in Django's schema.

## Data dictionary

Flags are `1`/`0`. An empty cell means **not applicable or not known**, never zero. Dates are local Tashkent time; manifest timestamps are UTC.

**Logged** = copied from a column. **Derived** = computed by a fixed rule from logged values. **Inferred** = a proxy that can be wrong; check it before relying on it.

### `attempts.csv` (one row per started attempt)

| Column | Kind | Meaning and source |
|---|---|---|
| `attempt_hash` | logged → hashed | HMAC of `midterms_attempt.id`. Joins to `strikes.csv`. |
| `student_hash` | logged → hashed | HMAC of the student's user id. The same across all of a student's attempts. |
| `exam_id` | logged | `midterm_id`. Not personal. |
| `exam_type` | logged | `PRE_MIDTERM`, `MIDTERM` or `RETAKE` (`midterms_midterm.midterm_type`). |
| `subject`, `level` | logged | From the midterm. |
| `is_retake` | derived | `exam_type = RETAKE`, or the attempt used a granted re-sit. |
| `retake_of_exam_id` | logged | The midterm a retake repeats. |
| `used_resit` | derived | A `midterms_resit` row points at this attempt. Its free-text reason is not exported. |
| `exam_date`, `month` | derived | Local date and `YYYY-MM` of `started_at`. |
| `version` | logged | 1–4 from `midterms_version`. Empty when the midterm has no versions. |
| `reached_module_2` | derived | `module_2_started_at` is set. |
| `client_type` | **inferred** | No column records the client. `app`: the attempt has requests from the app's API (`v1.*`) or a signed app session. `browser`: only the website's requests (`start`, `save_attempt`, `submit_module`, `offscreen`). `mixed`: both, which also covers app 0.1.0 (Oct 11), since it used the website's requests. `unknown`: neither. |
| `web_requests`, `app_requests` | derived | Number of stored requests of each kind. These are only requests that sent an idempotency key. |
| `app_version`, `app_sessions_opened`, `app_lockdown_required` | logged | From `desktop_midterm_lockdown`. Only present when the app opened a **signed** session, which needs `DESKTOP_PROOF_KEYS` on the server. `app_sessions_opened > 1` means the app was restarted mid-paper. |
| `browser_exempt_at_start` | derived | The student held a live browser exemption when the attempt started. |
| `warnings` | logged | `offscreen_violations`: strikes the server counted. |
| `warning_rows` | derived | Strikes found as stored requests. Should equal `warnings`; the manifest counts attempts where it doesn't. |
| `absences_inferred` | **inferred** | Strikes that were not a continuation of the previous one (see `strikes.csv`). One absence of about 6.5 s or more produces 3 strikes but 1 absence. |
| `forced_submit` | logged | `terminated_reason = OFFSCREEN`. |
| `submit_source` | **inferred** | From the request stored within 15 s after `submitted_at`. `forfeit`: forced. `client_submit`: a `submit_module`/`v1.submit` request. `autosave_after_expiry`: an autosave arriving after time ran out made the server submit. `no_client_request`: no matching request (the cleanup job, or a request without a key). `not_submitted`: still open. |
| `submit_delay_s` | derived | `submitted_at` minus the deadline of the last module reached, in seconds. Negative = before the deadline (forfeits). Deadlines use the midterm's **current** durations, which could have been edited after the sitting. |
| `on_time_submission` | derived | Submitted within 300 s of the deadline (the server's late-answer grace). Empty for forfeits; `0` when never submitted. |
| `swept_late` | **inferred** | `no_client_request` and submitted at least 30 min after the deadline: the pattern of `sweep_midterm_attempts`. Whether that job runs on a schedule on prod is not recorded in the repo. |
| `open_at_snapshot` | derived | Not completed and still `ACTIVE`, `MODULE_2_ACTIVE` or `SCORING` when the dump was taken. |
| `stuck_incomplete` | derived | `swept_late` or `open_at_snapshot`. |
| `post_close_saves` | **inferred** | Browser autosaves stored more than 15 s after `submitted_at`: a screen still running a paper the server had closed (a client–server mismatch). The app's late syncs are not stored, so this is browser-only. |
| `state` | logged | `current_state`. |
| `score`, `scoring_scale`, `pass_mark` | logged | The score and the scale/pass mark the sitting was pinned to. If it was never pinned, the midterm's current ones. |
| `passed` | logged | From `midterms_outcome`. Empty when not judged (e.g. a pre-midterm). |

### `strikes.csv` (one row per counted strike)

| Column | Kind | Meaning and source |
|---|---|---|
| `attempt_hash`, `student_hash`, `exam_id`, `month`, `attempt_client_type` | | As in `attempts.csv`. |
| `strike_client` | logged | `browser` (request `offscreen`) or `app` (request `v1.offscreen`). |
| `strike_no` | logged | The strike count the server returned (1, 2, 3). Rejected requests (status ≥ 400) are skipped. |
| `seconds_since_start` | derived | When the **server stored** the strike, relative to `started_at`. For the app this is arrival time: the app queues strikes while offline, and the time a strike actually happened is not stored. |
| `gap_prev_s` | derived | Seconds since the previous strike of the same attempt. |
| `inferred_continuation` | **inferred** | The gap falls in [2.5 s, 5.0 s]: the 3 s grace ran out and the same absence was charged again. The browser's own measurements put these gaps at about 3.1–3.2 s. Validate the window against `audit_continuing` (below) before using it. |
| `still_away_at_grace_end` | **inferred** | `1`: the next strike was a continuation, so the student was still away about 3 s after leaving. `0`: no continuation followed, so they came back within the grace, or the paper ended. Empty for the strike that ended the paper. |
| `audit_reason` | logged | `hidden`, `fullscreen` or `blur`, as the browser saw it. **Browser only, and only since PR #231 (merged 2026-10-16).** The app writes no such row. The browser can't tell a notification from a deliberate switch. |
| `audit_continuing` | logged | `true`/`false`: the browser's own flag that this strike is the same absence. Same coverage as `audit_reason`. |
| `ended_paper` | derived | This strike forfeited the paper. |

### `manifest.json`

Generation time, the script's SHA-256, every parameter, row counts (attempts, strikes, students, excluded attempts, attempts where `warnings` ≠ `warning_rows`), counts by `client_type`, and data-coverage dates: the first browser strike row, the first app request, the first app session, the first session made while the app was **required**, the first strike audit row, and the last attempt update (≈ when the dump was taken).

## Not in the data (do not infer it)

- **Time outside fullscreen.** The browser never reports the return. The app's `away_ms` is time away *so far* when it reports, and goes only to the server log (about 7 days). Only the 3 s boundary is recoverable, through `still_away_at_grace_end`.
- **Connection drops, in either era.** The browser sends no online/offline or reconnect events. The app syncs every 15 s, but its sync key carries the answer revision, so a heartbeat with no new answer replays the previous key and stores nothing: stored sync rows track answer changes, not connectivity. (Checked on prod 2026-10-27: one attempt logged 325 syncs and stored about 34.) Heartbeats appear only in the server log, which is kept about 7 days.
- **What the student's screen showed.** A stuck screen that sent nothing leaves no trace. Crash reports and "late answers declined" go only to the server log.
- **The date the app became required.** It is a server setting (`MIDTERM_DESKTOP_REQUIRED`), not data. `coverage_utc.first_required_app_session` gives the first sitting that was actually bound to the app.
- **Midterms before 2026-07-08.** They lived in the older `exams` tables, with no strike data.
