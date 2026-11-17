#!/usr/bin/env bash
# Rebuild the minimal export (export_minimal.sql) as a database extract.py can read.
#
#   bash load_copy.sh <export-dir> postgresql://me@127.0.0.1:5432/midterm_copy
#
# The target must be a LOCAL, throwaway database: its study tables are dropped and recreated.
set -euo pipefail

dir=${1:?usage: load_copy.sh <export-dir> <local-dsn>}
dsn=${2:?usage: load_copy.sh <export-dir> <local-dsn>}
case "$dsn" in
  *@127.0.0.1[:/]* | *@localhost[:/]* | *@\[::1\][:/]*) ;;
  *) echo "Refusing: $dsn is not a local database." >&2; exit 1 ;;
esac

tables=(users midterms_midterm midterms_version midterms_attempt desktop_midterm_lockdown midterms_outcome
        midterms_resit desktop_exemption midterms_attempt_idempotency_keys midterms_attempt_engine_audit)

{
  echo 'DROP TABLE IF EXISTS midterms_attempt_engine_audit, midterms_attempt_idempotency_keys, desktop_exemption,'
  echo '  midterms_resit, midterms_outcome, desktop_midterm_lockdown, midterms_attempt, midterms_version,'
  echo '  midterms_midterm, users CASCADE;'
  cat <<'SQL'
CREATE TABLE users (id bigint PRIMARY KEY, role varchar(30), is_staff bool, is_superuser bool);
CREATE TABLE midterms_midterm (id bigint PRIMARY KEY, midterm_type varchar(16), subject varchar(20),
    level varchar(16), retake_of_id bigint, scoring_scale varchar(16), pass_mark smallint,
    duration_minutes int, duration_minutes_2 int);
CREATE TABLE midterms_version (id bigint PRIMARY KEY, version_number smallint);
CREATE TABLE midterms_attempt (id bigint PRIMARY KEY, student_id bigint, midterm_id bigint, version_id bigint,
    started_at timestamptz, module_2_started_at timestamptz, submitted_at timestamptz, completed_at timestamptz,
    updated_at timestamptz, current_state varchar(24), is_completed bool, score int, paper_scale varchar(16),
    paper_pass_mark smallint, offscreen_violations smallint, terminated_reason varchar(24));
CREATE TABLE desktop_midterm_lockdown (attempt_id bigint UNIQUE, session_opened_at timestamptz,
    sessions_opened int, app_version varchar(32), required bool);
CREATE TABLE midterms_outcome (attempt_id bigint, passed bool, decided_at timestamptz);
CREATE TABLE midterms_resit (attempt_id bigint);
CREATE TABLE desktop_exemption (student_id bigint, created_at timestamptz, revoked_at timestamptz);
CREATE TABLE midterms_attempt_idempotency_keys (id bigint PRIMARY KEY, attempt_id bigint, endpoint varchar(64),
    created_at timestamptz, response_status smallint, response_json jsonb);
CREATE TABLE midterms_attempt_engine_audit (attempt_id bigint, event varchar(64), detail jsonb,
    created_at timestamptz);
SQL
  for t in "${tables[@]}"; do
    f="$dir/$t.csv"
    [ -f "$f" ] || { echo "missing $f" >&2; exit 1; }
    echo "\\copy $t($(head -1 "$f")) FROM '$f' WITH (FORMAT csv, HEADER)"
  done
  echo 'CREATE INDEX ON midterms_attempt_idempotency_keys (attempt_id);'
  echo 'CREATE INDEX ON midterms_attempt_engine_audit (attempt_id);'
  echo 'ANALYZE;'
} | psql "$dsn" -X -q -v ON_ERROR_STOP=1 -1

for t in "${tables[@]}"; do
  printf '%-36s %s rows\n' "$t" "$(psql "$dsn" -X -At -c "SELECT count(*) FROM $t")"
done
