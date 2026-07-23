#!/usr/bin/env bash
# ============================================================
# release_deploy.sh — Immutable release deploy + atomic cutover
#
# Prerequisites: deploy/RELEASE_LAYOUT.md (shared/*.env, media, backups)
#
# Safety: flock, pre-migrate plan + makemigrations --check, optional auto DB
# restore on failure after migrate, health + PM2 verification, post-cutover
# validation with automatic rollback, backup retention.
#
# Usage (on VPS as satapp):
#   bash /var/www/satapp/deploy/release_deploy.sh origin/main
#
# Env:
#   APP_DIR=/var/www/satapp
#   APP_GIT_DIR=/var/www/satapp
#   KEEP_LAST_N=5
#   KEEP_BACKUP_DUMPS_N=40          # retain newest N pg_*.dump under shared/backups
#   SKIP_PM2_RELOAD=1               # debug
#   SKIP_HEALTH_CHECKS=1            # emergency only
#   AUTO_DB_RESTORE_ON_FAIL=1       # restore pre-migrate dump if deploy fails after migrate (default 1)
#   DEPLOY_HEALTH_URL=http://127.0.0.1:8000/api/health/live/  # HTTP check after PM2 (empty to skip curl)
#   PM2_ONLINE_WAIT_S=45            # max wait for PM2 PIDs + HTTP
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/satapp}"
SHARED="$APP_DIR/shared"
DEPLOY_DIR="$APP_DIR/deploy"
ECOSYSTEM_FILE="$DEPLOY_DIR/ecosystem.config.js"
APP_GIT_DIR="${APP_GIT_DIR:-$APP_DIR}"
KEEP_LAST_N="${KEEP_LAST_N:-5}"
KEEP_BACKUP_DUMPS_N="${KEEP_BACKUP_DUMPS_N:-40}"

# PM2 must manage the SERVICE user's daemon. The app runs under `satapp`; when
# this deploy runs as root, a bare `pm2` talks to root's OWN daemon instead,
# leaving the real (satapp) processes serving STALE code across deploys. Route
# every pm2 *command* to the service user's daemon so reloads actually restart
# the processes that serve traffic.
PM2_USER="${PM2_USER:-satapp}"
if [ "$(id -un)" = "$PM2_USER" ]; then
  PM2="pm2"
else
  PM2="sudo -u $PM2_USER pm2"
fi
SKIP_PM2_RELOAD="${SKIP_PM2_RELOAD:-0}"
SKIP_HEALTH_CHECKS="${SKIP_HEALTH_CHECKS:-0}"
AUTO_DB_RESTORE_ON_FAIL="${AUTO_DB_RESTORE_ON_FAIL:-1}"
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:8000/api/health/live/}"
# Frontend SSR health (set empty to skip). Backend health alone missed the
# 2026-07-23 outage where every Next.js route 500'd at runtime.
DEPLOY_FRONTEND_HEALTH_URL="${DEPLOY_FRONTEND_HEALTH_URL-http://127.0.0.1:3000/}"
PM2_ONLINE_WAIT_S="${PM2_ONLINE_WAIT_S:-45}"

LOCK_FILE="$SHARED/.deploy.lock"
DEPLOY_STAGE="init"
FAILED_RELEASE_DIR=""
SYMLINK_DONE="0"
OLD_CURRENT_REAL=""
MIGRATION_APPLIED="0"
DBURL=""
DUMP_ABS=""
RELEASE_DIR=""
VENV=""
RELEASE_ID=""

release_lock() {
  flock -u 9 2>/dev/null || true
  exec 9>&- 2>/dev/null || true
}

restore_database_from_dump() {
  local dump="${1:-}"
  [[ -n "$dump" ]] && [[ -f "$dump" ]] || { echo "[restore_database_from_dump] missing dump"; return 1; }
  [[ -n "$DBURL" ]] || { echo "[restore_database_from_dump] missing DBURL"; return 1; }
  if ! command -v pg_restore >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
    echo "[restore_database_from_dump] psql/pg_restore not installed"
    return 1
  fi
  echo "-> pg_restore (auto) from $dump"
  set +e
  psql "$DBURL" -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();" >/dev/null 2>&1
  pg_restore -d "$DBURL" --no-owner --no-acl --clean --if-exists "$dump"
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]] && [[ "$rc" -ne 1 ]]; then
    echo "[restore_database_from_dump] pg_restore failed (exit $rc)"
    return "$rc"
  fi
  [[ "$rc" -eq 1 ]] && echo "   (pg_restore exited 1 = warnings only; continuing)"
  return 0
}

log_fail() {
  echo ""
  echo "[DEPLOY FAILED] stage=${DEPLOY_STAGE} (exit ${1:-unknown})"
  if [[ "$SYMLINK_DONE" != "1" ]]; then
    echo "  Symlink current/ was NOT updated to the new release."
  else
    echo "  Symlink may have been reverted to the prior current/ target (see messages above)."
  fi
  if [[ -n "${FAILED_RELEASE_DIR:-}" ]] && [[ -d "$FAILED_RELEASE_DIR" ]]; then
    echo "  Partial release dir: $FAILED_RELEASE_DIR"
    echo "  Remove after investigation: rm -rf \"$FAILED_RELEASE_DIR\""
  fi
  echo ""
}

on_error() {
  local code=$?
  if [[ "${AUTO_DB_RESTORE_ON_FAIL:-0}" == "1" ]] && [[ "$MIGRATION_APPLIED" == "1" ]] && [[ -n "${DUMP_ABS:-}" ]] && [[ -f "$DUMP_ABS" ]]; then
    echo "[DEPLOY FAILED] Auto DB restore (schema rolled back to pre-migrate dump)"
    restore_database_from_dump "$DUMP_ABS" || echo "[WARN] Auto DB restore failed — run rollback.sh or pg_restore manually."
  fi
  if [[ "$SYMLINK_DONE" == "1" ]] && [[ -n "$OLD_CURRENT_REAL" ]] && [[ -d "$OLD_CURRENT_REAL" ]]; then
    echo "[DEPLOY FAILED] Reverting $APP_DIR/current -> $OLD_CURRENT_REAL"
    ln -sfn "$OLD_CURRENT_REAL" "$APP_DIR/current" || true
    SYMLINK_DONE=0
    if command -v pm2 >/dev/null 2>&1 && [[ "$SKIP_PM2_RELOAD" != "1" ]]; then
      $PM2 startOrReload "$ECOSYSTEM_FILE" --update-env 2>/dev/null || true
      $PM2 save 2>/dev/null || true
    fi
  fi
  log_fail "$code"
  trap - ERR
  exit "$code"
}
trap on_error ERR

GIT_REF="${1:-${GIT_REF:-}}"
if [[ -z "$GIT_REF" ]]; then
  echo "Usage: release_deploy.sh <git-ref>"
  echo "  Example: release_deploy.sh origin/main"
  exit 1
fi

mkdir -p "$SHARED"
if [[ ! -d "$SHARED" ]]; then
  echo "Cannot create or access $SHARED"
  exit 1
fi

exec 9>>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[DEPLOY FAILED] Another process holds the deploy lock: $LOCK_FILE"
  exit 1
fi
trap 'release_lock' EXIT

echo "========================================="
echo " release_deploy (locked)"
echo " APP_DIR=$APP_DIR"
echo " GIT_REF=$GIT_REF"
echo "========================================="

DEPLOY_STAGE="preflight"
if [[ ! -d "$APP_GIT_DIR/.git" ]]; then
  echo "No .git at APP_GIT_DIR=$APP_GIT_DIR — set APP_GIT_DIR to your repo checkout."
  exit 1
fi
if [[ ! -f "$SHARED/backend.env" ]]; then
  echo "Missing $SHARED/backend.env — run deploy/migrate_to_release_layout.sh or create it."
  exit 1
fi
if [[ ! -f "$SHARED/frontend.env.production" ]]; then
  echo "Missing $SHARED/frontend.env.production"
  exit 1
fi
if [[ ! -f "$ECOSYSTEM_FILE" ]]; then
  echo "Missing $ECOSYSTEM_FILE"
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found; install postgresql-client"
  exit 1
fi

ENV_FILE="$SHARED/backend.env" python3 <<'PY'
import os
import sys
from pathlib import Path

def load_simple(path: Path) -> dict:
    out = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith(";"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        out[k] = v
    return out

p = Path(os.environ["ENV_FILE"])
vals = load_simple(p)
debug = (vals.get("DEBUG") or "False").lower() == "true"
dburl = (vals.get("DATABASE_URL") or "").strip()
if not debug and not dburl:
    print("ERROR: DATABASE_URL required when DEBUG is not true.", file=sys.stderr)
    sys.exit(1)
PY

DEPLOY_STAGE="git_fetch"
echo "-> Fetching git objects..."
FETCH_OK=1
git -C "$APP_GIT_DIR" fetch --tags origin 2>/dev/null || git -C "$APP_GIT_DIR" fetch origin 2>/dev/null || FETCH_OK=0
if [[ "$FETCH_OK" != "1" ]]; then
  echo "[WARN] git fetch failed (often root-owned .git objects — chown -R satapp:satapp $APP_GIT_DIR)."
fi
# Guard against silently deploying a STALE ref: if the fetch could not update local
# refs, the locally-resolved SHA can lag the remote tip and we'd ship old code with a
# success banner. For branch-style refs (e.g. origin/main), compare against ls-remote.
case "$GIT_REF" in
  origin/*)
    _rd_branch="${GIT_REF#origin/}"
    _rd_remote_sha="$(git -C "$APP_GIT_DIR" ls-remote origin "refs/heads/$_rd_branch" 2>/dev/null | awk '{print $1}')"
    _rd_local_sha="$(git -C "$APP_GIT_DIR" rev-parse "${GIT_REF}^{commit}" 2>/dev/null || true)"
    if [[ -n "$_rd_remote_sha" && -n "$_rd_local_sha" && "$_rd_remote_sha" != "$_rd_local_sha" ]]; then
      echo "[FAIL] Local $GIT_REF ($_rd_local_sha) != remote tip ($_rd_remote_sha)."
      echo "       git fetch did not update refs — refusing to deploy stale code."
      echo "       Fix: chown -R satapp:satapp $APP_GIT_DIR/.git && re-run."
      exit 1
    fi
    ;;
esac

FULL_SHA="$(git -C "$APP_GIT_DIR" rev-parse "${GIT_REF}^{commit}")"
SHORT_SHA="$(git -C "$APP_GIT_DIR" rev-parse --short=7 "$FULL_SHA")"
RELEASE_ID="${RELEASE_ID:-$(date +%Y%m%d-%H%M%S)-$SHORT_SHA}"
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"

if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release already exists: $RELEASE_DIR"
  exit 1
fi
FAILED_RELEASE_DIR="$RELEASE_DIR"

mkdir -p "$APP_DIR/releases" "$SHARED/backups" "$SHARED/media/profiles"

DEPLOY_STAGE="git_archive"
echo "-> Materializing tree from git archive ($FULL_SHA) -> $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
( cd "$APP_GIT_DIR" && git archive --format=tar "$FULL_SHA" ) | tar -x -C "$RELEASE_DIR"

if [[ ! -f "$RELEASE_DIR/backend/manage.py" ]]; then
  echo "Archive missing backend/manage.py"
  exit 1
fi

DEPLOY_STAGE="link_shared"
echo "-> Linking shared env + media"
rm -rf "$RELEASE_DIR/backend/media" 2>/dev/null || true
ln -sfn "../../../shared/backend.env" "$RELEASE_DIR/backend/.env"
ln -sfn "../../../shared/frontend.env.production" "$RELEASE_DIR/frontend/.env.production"
ln -sfn "../../../shared/media" "$RELEASE_DIR/backend/media"

if [[ -L "$APP_DIR/current" ]]; then
  OLD_CURRENT_REAL="$(readlink -f "$APP_DIR/current" || true)"
fi

DEPLOY_STAGE="venv_pip"
echo "-> Python venv + requirements"
VENV="$RELEASE_DIR/backend/venv"
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip
"$VENV/bin/pip" install -r "$RELEASE_DIR/backend/requirements.txt"

run_manage() {
  ( cd "$RELEASE_DIR/backend" && DJANGO_SETTINGS_MODULE=config.settings "$VENV/bin/python" ./manage.py "$@" )
}

DEPLOY_STAGE="read_dburl"
DBURL="$("$VENV/bin/python" -c "
from pathlib import Path
from dotenv import dotenv_values
vals = dotenv_values(Path('$SHARED') / 'backend.env')
print((vals.get('DATABASE_URL') or '').strip())
")"
if [[ -z "$DBURL" ]]; then
  echo "DATABASE_URL empty in shared/backend.env"
  exit 1
fi

DEPLOY_STAGE="django_check"
echo "-> Django check (new release tree)"
run_manage check

DEPLOY_STAGE="frontend_build"
echo "-> Frontend npm ci + build"
npm ci --prefix "$RELEASE_DIR/frontend" --no-audit --no-fund
npm run build --prefix "$RELEASE_DIR/frontend"

DEPLOY_STAGE="pm2_stop_before_migrate"
echo "-> Stop PM2 app processes (Celery first, then API/frontend)"
$PM2 stop sat-celery-worker 2>/dev/null || true
$PM2 stop sat-celery-beat 2>/dev/null || true
$PM2 delete sat-celery-worker 2>/dev/null || true
$PM2 delete sat-celery-beat 2>/dev/null || true
$PM2 stop sat-backend 2>/dev/null || true
$PM2 stop sat-frontend 2>/dev/null || true
sleep 1

DUMP="$SHARED/backups/pg_${RELEASE_ID}_pre.dump"

DEPLOY_STAGE="pg_dump"
echo "-> pg_dump -> $DUMP"
pg_dump "$DBURL" --no-owner --no-acl -Fc -f "$DUMP"
if [[ ! -s "$DUMP" ]]; then
  echo "pg_dump produced an empty file; aborting."
  exit 1
fi
DUMP_ABS="$(readlink -f "$DUMP" 2>/dev/null || echo "$DUMP")"

# --- Pre-migrate: migration graph + no missing migration files (does not apply migrations) ---
DEPLOY_STAGE="pre_migrate_validate"
echo "-> Pre-migrate validation (migrate --plan, makemigrations --check)"
run_manage migrate --plan
run_manage makemigrations --check --dry-run

DEPLOY_STAGE="migrate"
echo "-> migrate (release: $RELEASE_ID, venv under release tree only)"
run_manage migrate --no-input
MIGRATION_APPLIED="1"

DEPLOY_STAGE="collectstatic"
mkdir -p "$RELEASE_DIR/backend/staticfiles"
run_manage collectstatic --no-input

DEPLOY_STAGE="pre_cutover_health"
if [[ "$SKIP_HEALTH_CHECKS" == "1" ]]; then
  echo "!! SKIP_HEALTH_CHECKS=1 — skipping extended pre-cutover checks"
else
  echo "-> Pre-cutover health (release tree, before current/ symlink)"
  run_manage migrate --check
  run_manage check --deploy
  echo "-> Django boot + DB connection (release venv)"
  run_manage shell -c "from django.db import connection; connection.ensure_connection(); print('db_ok')"
  if [[ ! -d "$RELEASE_DIR/backend/staticfiles" ]] || [[ -z "$(find "$RELEASE_DIR/backend/staticfiles" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    echo "collectstatic output missing or empty"
    exit 1
  fi
  if [[ ! -d "$RELEASE_DIR/frontend/.next" ]]; then
    echo "Next.js build missing: .next/"
    exit 1
  fi
  if [[ ! -f "$RELEASE_DIR/frontend/.next/BUILD_ID" ]]; then
    echo "Next.js BUILD_ID missing — build incomplete ($RELEASE_DIR/frontend/.next/BUILD_ID)"
    exit 1
  fi
  echo "   OK: migrate --check, check --deploy, DB, staticfiles, BUILD_ID"
fi

DEPLOY_STAGE="symlink_cutover"
echo "-> Atomic symlink: current -> $RELEASE_DIR"
ln -sfn "$RELEASE_DIR" "$APP_DIR/current"
SYMLINK_DONE="1"

if [[ -n "$OLD_CURRENT_REAL" ]] && [[ -d "$OLD_CURRENT_REAL" ]] && [[ "$OLD_CURRENT_REAL" != "$(readlink -f "$RELEASE_DIR")" ]]; then
  ln -sfn "$OLD_CURRENT_REAL" "$APP_DIR/previous"
  echo "-> previous -> $OLD_CURRENT_REAL"
fi

COMMIT_MSG="$(git -C "$APP_GIT_DIR" log -1 --oneline "$FULL_SHA" 2>/dev/null || echo "")"
export RD_RELEASE_DIR="$RELEASE_DIR"
export RD_FULL_SHA="$FULL_SHA"
export RD_SHORT_SHA="$SHORT_SHA"
export RD_GIT_REF="$GIT_REF"
export RD_COMMIT_MSG="$COMMIT_MSG"
python3 <<'PY'
import json
import os
from pathlib import Path

rd = os.environ["RD_RELEASE_DIR"]
meta = {
    "release_id": Path(rd).name,
    "git_sha": os.environ["RD_FULL_SHA"],
    "git_short": os.environ["RD_SHORT_SHA"],
    "git_ref_requested": os.environ["RD_GIT_REF"],
    "commit_oneline": os.environ.get("RD_COMMIT_MSG", ""),
}
Path(rd, "RELEASE.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
PY

perform_post_cutover_failure_rollback() {
  set +e
  echo ""
  echo "[POST-DEPLOY FAILED] Validation after symlink; rolling back DB + current + PM2"
  $PM2 stop sat-frontend 2>/dev/null || true
  $PM2 stop sat-backend 2>/dev/null || true
  $PM2 stop sat-celery-worker 2>/dev/null || true
  $PM2 stop sat-celery-beat 2>/dev/null || true
  $PM2 delete sat-celery-worker 2>/dev/null || true
  $PM2 delete sat-celery-beat 2>/dev/null || true
  sleep 1
  if [[ -n "${DUMP_ABS:-}" ]] && [[ -f "$DUMP_ABS" ]]; then
    restore_database_from_dump "$DUMP_ABS" || echo "[WARN] pg_restore during post-deploy rollback failed"
  fi
  if [[ -n "$OLD_CURRENT_REAL" ]] && [[ -d "$OLD_CURRENT_REAL" ]]; then
    ln -sfn "$OLD_CURRENT_REAL" "$APP_DIR/current"
    SYMLINK_DONE=0
  fi
  if [[ "$SKIP_PM2_RELOAD" != "1" ]]; then
    $PM2 startOrReload "$ECOSYSTEM_FILE" --update-env || $PM2 start "$ECOSYSTEM_FILE"
    $PM2 save
  fi
  MIGRATION_APPLIED="0"
  SYMLINK_DONE="0"
  set -e
  echo "[POST-DEPLOY FAILED] Rollback steps completed (verify pm2 status and site manually)."
}

wait_for_http_health() {
  local url="$1"
  local max="${2:-45}"
  [[ -n "$url" ]] || return 0
  echo "-> Waiting for HTTP $url (max ${max}s)"
  local i=0
  while [[ "$i" -lt "$max" ]]; do
    if curl -fsS --connect-timeout 2 --max-time 8 "$url" >/dev/null 2>&1; then
      echo "   HTTP OK"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "   HTTP health check failed after ${max}s"
  return 1
}

verify_pm2_pids() {
  local app
  for app in sat-backend sat-frontend sat-celery-worker sat-celery-beat; do
    local pid
    pid="$($PM2 pid "$app" 2>/dev/null || true)"
    if [[ -z "$pid" ]] || [[ "$pid" == "0" ]]; then
      echo "PM2 app $app has no PID (not online)"
      return 1
    fi
  done
  echo "   PM2 PIDs OK for sat-backend, sat-frontend, sat-celery-worker, sat-celery-beat"
  return 0
}

run_manage_current() {
  local cur="${APP_DIR}/current"
  local vb="${cur}/backend/venv/bin/python"
  ( cd "${cur}/backend" && DJANGO_SETTINGS_MODULE=config.settings "$vb" ./manage.py "$@" )
}

DEPLOY_STAGE="pm2_reload"
if [[ "$SKIP_PM2_RELOAD" == "1" ]]; then
  echo "!! SKIP_PM2_RELOAD=1 — skipping PM2 and post-cutover validation"
else
  echo "-> PM2 startOrReload"
  $PM2 startOrReload "$ECOSYSTEM_FILE" --update-env || $PM2 start "$ECOSYSTEM_FILE"
  $PM2 save

  DEPLOY_STAGE="pm2_wait_online"
  echo "-> Verify PM2 processes (backend, frontend, Celery)"
  waited=0
  while [[ "$waited" -lt "$PM2_ONLINE_WAIT_S" ]]; do
    if verify_pm2_pids; then
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done
  if ! verify_pm2_pids; then
    echo "[FAIL] PM2 processes not online within ${PM2_ONLINE_WAIT_S}s"
    trap - ERR
    perform_post_cutover_failure_rollback
    exit 1
  fi

  if [[ "$SKIP_HEALTH_CHECKS" != "1" ]]; then
    DEPLOY_STAGE="post_cutover_http"
    if [[ -n "${DEPLOY_HEALTH_URL:-}" ]]; then
      wait_for_http_health "$DEPLOY_HEALTH_URL" "$PM2_ONLINE_WAIT_S" || {
        trap - ERR
        perform_post_cutover_failure_rollback
        exit 1
      }
    fi

    # Frontend SSR check. The backend URL above says nothing about Next.js: an
    # App Router misconfiguration (e.g. two different slug names at the same
    # dynamic path position) passes `next build` but throws at runtime under
    # `next start`, 500-ing EVERY route while the backend health stays green —
    # exactly the 2026-07-23 outage. Curl the real frontend so that class of
    # failure rolls back automatically instead of shipping a dead site.
    DEPLOY_STAGE="post_cutover_frontend_http"
    if [[ -n "${DEPLOY_FRONTEND_HEALTH_URL:-}" ]]; then
      wait_for_http_health "$DEPLOY_FRONTEND_HEALTH_URL" "$PM2_ONLINE_WAIT_S" || {
        trap - ERR
        perform_post_cutover_failure_rollback
        exit 1
      }
    fi

    DEPLOY_STAGE="post_cutover_django"
    echo "-> Post-cutover Django (current/ venv): check + DB"
    run_manage_current check
    run_manage_current migrate --check
    run_manage_current shell -c "from django.db import connection; connection.ensure_connection(); print('db_ok_post')"

    DEPLOY_STAGE="post_cutover_buildid"
    if [[ ! -f "$APP_DIR/current/frontend/.next/BUILD_ID" ]]; then
      echo "[FAIL] current/frontend/.next/BUILD_ID missing after cutover"
      trap - ERR
      perform_post_cutover_failure_rollback
      exit 1
    fi
    echo "   Post-cutover validation OK"
  fi
fi

# The new release is now LIVE and post-cutover validated. Everything below (state-file
# write, release/backup pruning) is non-critical bookkeeping. Disarm the destructive ERR
# trap and clear MIGRATION_APPLIED here so that a failure in those steps — e.g. a
# root-owned file that `rm` cannot remove — can NEVER trigger an automatic pg_restore
# that would wipe every write made since cutover. Real post-cutover failures above are
# already handled explicitly via perform_post_cutover_failure_rollback.
MIGRATION_APPLIED="0"
trap - ERR

STATE_FILE="$SHARED/release_state.json"
PREV_ID=""
if [[ -n "$OLD_CURRENT_REAL" ]] && [[ -d "$OLD_CURRENT_REAL" ]]; then
  PREV_ID="$(basename "$OLD_CURRENT_REAL")"
fi
export SD_STATE_FILE="$STATE_FILE"
export SD_ACTIVE="$RELEASE_ID"
export SD_PREV="$PREV_ID"
export SD_SHA="$FULL_SHA"
export SD_DUMP_ABS="$DUMP_ABS"
python3 <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

p = Path(os.environ["SD_STATE_FILE"])
dump = os.environ["SD_DUMP_ABS"].strip()
if not dump:
    raise SystemExit("internal error: empty rollback_db_dump")

state = {
    "active_release_id": os.environ["SD_ACTIVE"],
    "previous_release_id": os.environ.get("SD_PREV", ""),
    "git_sha": os.environ["SD_SHA"],
    "rollback_db_dump": dump,
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "last_deploy_action": "release_deploy_success",
}
p.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
PY

DEPLOY_STAGE="prune_releases"
echo "-> Prune old releases (keep $KEEP_LAST_N)"
if [[ -d "$APP_DIR/releases" ]] && [[ "$KEEP_LAST_N" =~ ^[0-9]+$ ]] && [[ "$KEEP_LAST_N" -gt 0 ]]; then
  CUR_BN=""
  if [[ -L "$APP_DIR/current" ]]; then
    CUR_BN="$(basename "$(readlink -f "$APP_DIR/current")")"
  fi
  # shellcheck disable=SC2012
  mapfile -t ALL < <(ls -1t "$APP_DIR/releases" 2>/dev/null || true)
  i=0
  for name in "${ALL[@]}"; do
    [[ -z "$name" ]] && continue
    ((i++)) || true
    if [[ "$i" -le "$KEEP_LAST_N" ]]; then
      continue
    fi
    if [[ "$name" == "$CUR_BN" ]]; then
      continue
    fi
    PREV_BN=""
    if [[ -L "$APP_DIR/previous" ]]; then
      PREV_BN="$(basename "$(readlink -f "$APP_DIR/previous" 2>/dev/null)" 2>/dev/null || true)"
    fi
    if [[ "$name" == "$PREV_BN" ]]; then
      continue
    fi
    echo "   Removing old release: $name"
    rm -rf "${APP_DIR:?}/releases/${name}" || echo "   [WARN] could not remove old release $name (leftover, non-fatal)"
  done
fi

DEPLOY_STAGE="prune_backups"
if [[ "$KEEP_BACKUP_DUMPS_N" =~ ^[0-9]+$ ]] && [[ "$KEEP_BACKUP_DUMPS_N" -gt 0 ]]; then
  echo "-> Prune old DB dumps under $SHARED/backups (keep newest $KEEP_BACKUP_DUMPS_N, never drop this deploy's dump)"
  # shellcheck disable=SC2012
  mapfile -t DUMPS < <(ls -1t "$SHARED/backups"/pg_*.dump 2>/dev/null || true)
  j=0
  for f in "${DUMPS[@]}"; do
    [[ -z "$f" ]] && continue
    ((j++)) || true
    if [[ "$j" -le "$KEEP_BACKUP_DUMPS_N" ]]; then
      continue
    fi
    fr="$(readlink -f "$f" 2>/dev/null || echo "$f")"
    if [[ "$fr" == "$DUMP_ABS" ]]; then
      continue
    fi
    echo "   Removing old backup: $f"
    rm -f "$f" || echo "   [WARN] could not remove old backup $f (non-fatal)"
  done
fi

FAILED_RELEASE_DIR=""
MIGRATION_APPLIED="0"
trap - ERR
DEPLOY_STAGE="done"
echo ""
echo "========================================="
echo " Release $RELEASE_ID deployed."
echo " current -> $RELEASE_DIR"
echo " rollback_db_dump (absolute): $DUMP_ABS"
echo "========================================="
