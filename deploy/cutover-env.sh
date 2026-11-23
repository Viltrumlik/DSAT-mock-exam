#!/usr/bin/env bash
# Leaving lc-up (billing.cutover; runbook deploy/CUTOVER.md): switch the flags in shared/backend.env, with zero downtime.
#
#   on   lc-up off, the ledger the master, per lesson   (between `billing_cutover prepare --apply` and `finish`)
#   off  back: lc-up the master, the ledger following it (before `billing_cutover reverse`)
#
# Run as root on the prod host. Touches only the 11 flags of billing.cutover.LEFT_LCUP and never prints any other
# value of the file. "on" keeps the flags' earlier values in shared/cutover-env.before, which "off" puts back.
#   1. backup of backend.env (600, satapp), then the flags rewritten in place
#   2. a fresh Django process must import with the new file and `billing_cutover check` must agree
#   3. gunicorn: TTIN x3 (new workers read the file), probe, TTOU x3 (the old retire)
#   4. celery worker + beat restarted (they read settings only at boot)
#
# The rehearsal on the test copy runs the same script with
#   CUTOVER_APP=/var/www/satapp-staging CUTOVER_BACKEND=stg-backend CUTOVER_PORT=8030 CUTOVER_CELERY="" \
#   CUTOVER_HOST=mastersat-test.65-109-100-104.sslip.io
set -euo pipefail
APP=${CUTOVER_APP:-/var/www/satapp}
BACKEND=${CUTOVER_BACKEND:-sat-backend}
PORT=${CUTOVER_PORT:-8000}
CELERY=${CUTOVER_CELERY-sat-celery-worker sat-celery-beat}
ENVF=$APP/shared/backend.env
BEFORE=$APP/shared/cutover-env.before
PM2="sudo -u satapp pm2"
H=(-H "Host: ${CUTOVER_HOST:-mastersat.uz}" -H "X-Forwarded-Proto: https" -A "cutover-env")
log() { echo "[C $(date +%T)] $*"; }
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "${H[@]}" "http://127.0.0.1:$PORT$1"; }

MODE="${1:-}"
[[ "$MODE" == on || "$MODE" == off ]] || { log "usage: $0 on|off"; exit 1; }
[[ "$(id -u)" == 0 ]] || { log "run as root"; exit 1; }

exec 9>"$APP/shared/.deploy.lock"
flock -n 9 || { log "another deploy holds the lock"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
cp -p "$ENVF" "$ENVF.pre-cutover-$MODE-$STAMP"
chmod 600 "$ENVF.pre-cutover-$MODE-$STAMP"
log "backup: $ENVF.pre-cutover-$MODE-$STAMP"

python3 - "$ENVF" "$BEFORE" "$MODE" <<'PY'
import os, sys
envf, before_path, mode = sys.argv[1:4]
LEFT = {
    "LCUP_ENABLED": "False", "LCUP_ARCHIVE_ENABLED": "False", "LCUP_ATTENDANCE_PULL_ENABLED": "False",
    "LCUP_ATTENDANCE_PUSH_ENABLED": "False", "LCUP_ATTENDANCE_CHECKS_ENABLED": "False",
    "LCUP_PROFILE_SYNC_ENABLED": "False", "LCUP_DEBT_FREEZE_ENABLED": "False", "SMS_DEBT_WARNINGS_ENABLED": "False",
    "BILLING_SHADOW_ENABLED": "False", "BILLING_PAYMENTS_OPEN": "True", "BILLING_MODE": "lesson",
}
WITH = {"LCUP_ENABLED": "True", "BILLING_SHADOW_ENABLED": "True", "BILLING_PAYMENTS_OPEN": "False", "BILLING_MODE": "month"}
lines = open(envf).read().splitlines()

def current():
    out = {}
    for line in lines:
        k, sep, v = line.partition("=")
        if sep and k.strip() in LEFT and not line.lstrip().startswith("#"):
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out

if mode == "on":
    was = current()
    with open(before_path, "w") as f:  # the flags only: booleans and "month"/"lesson", never a credential
        for k in LEFT:
            f.write(f"{k}={was.get(k, '')}\n")
    want = LEFT
else:
    if not os.path.exists(before_path):
        sys.exit("[C] no shared/cutover-env.before: was 'on' ever run here?")
    was = dict(line.split("=", 1) for line in open(before_path).read().splitlines() if "=" in line)
    want = {k: (v or "False") for k, v in was.items()}
    want.update(WITH)  # whatever they were, these must be back for lc-up to be the master

seen, out = set(), []
for line in lines:
    k, sep, _ = line.partition("=")
    key = k.strip()
    if sep and key in want and not line.lstrip().startswith("#"):
        if key in seen:
            continue  # a duplicate line would win or lose by order: keep exactly one
        out.append(f"{key}={want[key]}")
        seen.add(key)
    else:
        out.append(line)
out += [f"{k}={v}" for k, v in want.items() if k not in seen]
open(envf, "w").write("\n".join(out) + "\n")
for k in LEFT:
    print(f"  {k:32} {want.get(k, '(unchanged)')}")
PY
chown satapp:satapp "$ENVF" "$BEFORE" && chmod 600 "$ENVF" "$BEFORE"

cd "$APP/current/backend"
log "fresh-process check with the new env file"
CHECK=$(sudo -u satapp env DJANGO_SETTINGS_MODULE=config.settings venv/bin/python -W ignore manage.py billing_cutover check 2>/dev/null)
LEFT_NOW=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["left_lcup"])' <<<"$CHECK")
log "billing_cutover check: left_lcup=$LEFT_NOW"
if [[ "$MODE" == on && "$LEFT_NOW" != True ]] || [[ "$MODE" == off && "$LEFT_NOW" != False ]]; then
  log "the new file does not read as '$MODE' — NOT reloading; the backup is above"; exit 1
fi
sudo -u satapp env DJANGO_SETTINGS_MODULE=config.settings venv/bin/python -W ignore manage.py check 2>&1 | tail -1

P=$($PM2 pid "$BACKEND" | tr -d '[:space:]')
[[ -n "$P" && -d /proc/$P ]] || { log "no gunicorn master pid"; exit 1; }
OLD=$(pgrep -P "$P" | sort -n | paste -sd' ')
log "gunicorn master $P, workers before: $OLD"
[[ "$(code /api/health/live/)" == 200 ]] || { log "baseline :$PORT not 200"; exit 1; }
for i in 1 2 3; do kill -TTIN "$P"; sleep 1; done
for i in $(seq 1 60); do n=$(pgrep -P "$P" | wc -l); (( n >= 6 )) && break; sleep 1; done
NEW=$(comm -13 <(echo "$OLD" | tr ' ' '\n' | sort) <(pgrep -P "$P" | sort) | paste -sd' ')
log "workers now: $(pgrep -P "$P" | wc -l), new: $NEW"
[[ $(wc -w <<<"$NEW") == 3 ]] || { log "expected 3 new workers — NOT retiring the old ones"; exit 1; }
sleep 8
for w in $NEW; do [[ -d /proc/$w ]] || { log "new worker $w died — NOT retiring the old ones"; exit 1; }; done
ok=0; for i in $(seq 1 60); do [[ "$(code /api/health/live/)" == 200 ]] && ok=$((ok+1)); sleep 0.1; done
log "probes across 6 workers: $ok/60 x 200"
(( ok == 60 )) || { log "not every probe was 200 — NOT retiring the old ones"; exit 1; }
for i in 1 2 3; do kill -TTOU "$P"; sleep 1; done
for i in $(seq 1 120); do left=0; for w in $OLD; do [[ -d /proc/$w ]] && left=$((left+1)); done; (( left == 0 )) && break; sleep 1; done
log "old workers still alive: $left; workers now: $(pgrep -P "$P" | sort -n | paste -sd' ')"
ok=0; for i in $(seq 1 30); do [[ "$(code /api/health/live/)" == 200 ]] && ok=$((ok+1)); sleep 0.1; done
log "probes after retiring: $ok/30 x 200"

if [[ -n "$CELERY" ]]; then
  log "restart $CELERY"
  $PM2 restart $CELERY >/dev/null
  sleep 12
fi
$PM2 jlist | python3 -c '
import json, sys
for p in json.load(sys.stdin):
    if p["name"].startswith(("sat-", "stg-")):
        print("  %-20s %s" % (p["name"], p["pm2_env"]["status"]))'
log "CUTOVER_ENV_OK $MODE"
