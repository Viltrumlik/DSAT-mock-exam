-- Minimal, read-only export of what extract.py needs: ~40 columns from 10 tables.
--
-- Run with psql in an EMPTY directory (each \copy writes <table>.csv there), on a read-only
-- session; export_minimal.sh does both. It copies:
--   * no names, emails, phones, Telegram ids, answers, free text or machine pre-checks;
--   * users: only id, role and the staff flags, and only for users who sat a midterm;
--   * request and audit rows: only the strike count and the browser's reason/continuing flags,
--     rebuilt into a small JSON object. The stored response bodies never leave the server.
-- Raw ids are kept so the copy keeps its joins; extract.py hashes them.

\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

\copy (SELECT id, role, is_staff, is_superuser FROM users WHERE id IN (SELECT student_id FROM midterms_attempt)) TO 'users.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, midterm_type, subject, level, retake_of_id, scoring_scale, pass_mark, duration_minutes, duration_minutes_2 FROM midterms_midterm) TO 'midterms_midterm.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, version_number FROM midterms_version) TO 'midterms_version.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, student_id, midterm_id, version_id, started_at, module_2_started_at, submitted_at, completed_at, updated_at, current_state, is_completed, score, paper_scale, paper_pass_mark, offscreen_violations, terminated_reason FROM midterms_attempt) TO 'midterms_attempt.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT attempt_id, session_opened_at, sessions_opened, app_version, required FROM desktop_midterm_lockdown) TO 'desktop_midterm_lockdown.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT attempt_id, passed, decided_at FROM midterms_outcome WHERE attempt_id IS NOT NULL) TO 'midterms_outcome.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT attempt_id FROM midterms_resit WHERE attempt_id IS NOT NULL) TO 'midterms_resit.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT student_id, created_at, revoked_at FROM desktop_exemption) TO 'desktop_exemption.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT id, attempt_id, endpoint, created_at, response_status, CASE WHEN endpoint IN ('offscreen', 'v1.offscreen') THEN jsonb_build_object('violations', COALESCE(response_json->>'violations', response_json->'outcome'->>'violations')) ELSE '{}'::jsonb END AS response_json FROM midterms_attempt_idempotency_keys WHERE endpoint IN ('start', 'save_attempt', 'submit_module', 'offscreen', 'v1.start', 'v1.sync', 'v1.submit', 'v1.offscreen')) TO 'midterms_attempt_idempotency_keys.csv' WITH (FORMAT csv, HEADER)
\copy (SELECT attempt_id, event, jsonb_build_object('reason', detail->>'reason', 'continuing', detail->'continuing', 'violations', detail->'violations') AS detail, created_at FROM midterms_attempt_engine_audit WHERE event = 'offscreen') TO 'midterms_attempt_engine_audit.csv' WITH (FORMAT csv, HEADER)

COMMIT;
