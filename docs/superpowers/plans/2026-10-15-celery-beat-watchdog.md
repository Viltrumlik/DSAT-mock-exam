# Celery beat watchdog — 2026-10-15

**Status:** installed on prod in **DRY-RUN** on 2026-10-15 at 12:24 CEST, with the owner's yes. It
decides and logs, but never restarts or alerts. **Not live.** Going live needs the owner's yes (§7).

## 1. What actually happened

On 2026-10-15 `sat-celery-beat` stopped sending at 06:37 CEST and stayed silent until a manual
restart at 11:42. PM2 said `online` the whole time. That was not the first time. Gaps longer than
10 minutes in beat's "Sending due task" lines, from every beat log on the host:

| Redis restarted (apt) | Beat's last send | Beat silent until | Outage |
|---|---|---|---|
| 2026-08-11 06:57:49 | 06:58:00 | 08-11 15:52 (deploy) | 8.9 h |
| 2026-09-03 06:21:51 | 06:22:00 | 09-05 04:34 (deploy) | **46 h** |
| 2026-10-08 06:11:09 | 06:12:00 | 10-09 09:13 (deploy) | **27 h** |
| 2026-10-15 06:36:20 | 06:37:00 | 10-15 11:42 (manual) | 5.1 h |

Each hang came on the first send after `unattended-upgrades` upgraded systemd/libc libraries and
needrestart bounced `redis-server`. The converse does not hold: Redis also restarted on 07-30,
07-31 and 09-11 without hanging beat, and why is not established. On 08-26, PM2 restarted beat
in the same minute as Redis. The 09-30 gap is an artefact: PM2 itself restarted, and logrotate's
`retain 7` deleted the files.

### The stack — recovered from the log, no debugger needed

PM2's restart sends SIGINT. Python lock acquisition is interruptible, so the handler ran *inside*
the blocked call and beat printed where it was. The stack, innermost last:

```
celery/result.py:417           AsyncResult.__del__
celery/backends/redis.py:184   ResultConsumer.cancel_for  → self._pubsub.unsubscribe(key)
redis/client.py:879            PubSub.execute_command     → with self._lock:   (taken)
redis/client.py:918            _execute → retry: the socket died with redis → _reconnect
redis/connection.py:413        connect → on-connect callbacks
redis/client.py:838            PubSub.on_connect          → self.subscribe(**channels)
redis/client.py:879            PubSub.execute_command     → with self._lock:   ← same thread, waits forever
```

`PubSub._lock` is a plain `threading.Lock` in redis-py 6.2.0 (ours, `redis==6.2.0` since April).
On reconnect it re-enters itself. Upstream: [redis/redis-py#3640](https://github.com/redis/redis-py/issues/3640)
(introduced in 5.3.0; fixed for 7.0.0, where master uses `threading.RLock()`).

Beat only *has* a PubSub because of the Redis result backend (`CELERY_RESULT_BACKEND`, redis db 2).
Celery subscribes the sending process to every task's result channel
(`RedisBackend.on_task_call` → `consume_from`) unless the result is ignored. Beat never reads a
result: it subscribes on send and unsubscribes when the `AsyncResult` is dropped. After Redis
restarts, the first such unsubscribe reconnects, and the reconnect deadlocks.

**Gunicorn workers hit the same frame.** `WORKER TIMEOUT` at 06:43:53, 07:29:06 and 07:29:50
today. Each worker printed the identical stack ending in `with self._lock:` /
`gunicorn/workers/base.py handle_abort`. Each worker's first `.delay()` after the Redis restart
hung for 120 s until gunicorn killed it, so those requests failed. Gunicorn's timeout is the only
reason the web recovers on its own. Beat has no equivalent, hence hours to days.

The hypotheses in the brief do not apply. A logging lock inside a signal handler is not it:
`logging` uses RLocks, and no signal arrived before 11:42. Shelve is not it either: it has no
locks, and the schedule file stopped because the loop stopped.

## 2. The root-cause fix (recommended; separate PR, separate yes)

`CELERY_TASK_IGNORE_RESULT = True` in `config/settings.py`.

- Celery 5.5.3 `Task.apply_async` defaults `ignore_result` from `task_ignore_result`
  (`celery/app/task.py:576`). `send_task` only calls `backend.on_task_call` when the result is not
  ignored (`celery/app/base.py:928`). So no process ever opens a result PubSub, and the deadlock
  path is unreachable in beat *and* gunicorn.
- Nothing reads a result: no `AsyncResult`, `.get()`, `chord`, `group` or `chain` anywhere in
  `backend/`. Workers stop writing `celery-task-meta-*` keys to redis db 2, and nothing reads
  those keys either.
- Alternative: redis-py ≥ 7.0. That is a major bump, and kombu 5.5.4 already declares
  `redis<=5.2.1` (we run 6.2.0 outside that range today). It is more risk than one setting.

The watchdog below stays useful after this fix. The next hang need not look like this one.

## 3. Watchdog options weighed

| Option | Verdict |
|---|---|
| **systemd timer, beat log mtime + schedule-file mtime** | **Chosen.** Both files are written only by beat's own loop: a log line every minute (`assessments-dispatch-pending-grading` is `*/1`) and a schedule sync every 180 s (measured on prod: 11:52:59 → 11:56:00). No app code is involved, and it works when the release is broken. |
| Newest `LcupSyncRun.started_at` | Rejected as the trigger. It measures worker + `LCUP_ENABLED` + the lc-up API too, so a stale row says nothing about *beat*, and restarting beat for a worker or lc-up fault is wrong. It also puts a DB query in the watchdog. |
| PM2 `cron_restart` | Rejected. It is blind: about 24 restarts a day, no detection, no log line, no alert. It caps an outage at the interval and teaches nobody anything. |
| Heartbeat key in Redis written by beat | Rejected. It needs beat-side code and leans on Redis, the thing whose restart caused this. The two mtimes already are a heartbeat written by beat's loop. |
| cron vs systemd timer | systemd: no overlapping runs (oneshot), `TimeoutStartSec`, journald, `StateDirectory`. |

## 4. Design (`deploy/watchdog/`)

Once a minute at :30, run as root:

1. `shared/beat-watchdog.pause` exists → do nothing.
2. satapp's PM2 daemon is not alive → alert `pm2_unreachable` (hourly), and never call `pm2`.
   `pm2 jlist` would *spawn* an empty daemon.
3. `pm2 jlist` (as satapp) → beat's pid, status, start time, log path. Only those fields are kept;
   `pm2_env` also carries the process environment.
4. Status `stopped` → leave it: a person or a deploy did that. `errored` or missing → alert, no restart.
5. Up less than 10 min → leave it (startup grace).
6. **Stalled = log AND schedule file both older than 10 min.** Healthy ages are ≤ 60 s and ≤ ~4 min.
   Either one alone can go quiet for a reason a restart does not fix.
7. Stalled → save `/proc/<pid>/{status,wchan,syscall,stack}`, a 3 s strace, beat's sockets, the
   log tail, and py-spy output if installed, into `/var/lib/sat-beat-watchdog/incidents/<ts>/`.
   Then **`pm2 restart sat-celery-beat`**, save the traceback beat prints as it dies
   (`shutdown.log`), and alert `stalled_restarted`. The alert is labelled
   "redis-py PubSub self-deadlock" when the traceback matches.
8. Next healthy check after a restart → alert `recovered`, once.
9. At most 3 restarts per hour, then alert `restart_budget_exhausted` (hourly) and leave beat alone.

**Blast radius.** `APP = "sat-celery-beat"` is a constant. The only PM2 commands in the file are
`jlist` and `restart APP`, run as satapp with `env -i`. Tests assert that no command ever names
another app or `all`.

**Why root, and why `/usr/local/sbin`.** `ptrace_scope=1` on prod, so only root can strace or
py-spy beat. A root service must not execute a file satapp can edit, so `install.sh` copies the
script to a root-owned path rather than running it from `/var/www/satapp`.

**Detection time** is about 11 min (10 min threshold + the 1 min timer), against the 5–46 h above.

**Logging.** Every check goes to journald (`journalctl -u sat-beat-watchdog`). Everything except
"healthy" also goes to `/var/log/sat-beat-watchdog.log`: the short record of what it did.

## 5. Alerting: what "the app's existing alerting" is, and the gap

- `assessments.ops_alerts.deliver_ops_alert` is used by `alert_on_assessment_slo` and homework
  abuse. It writes a CRITICAL log line, posts to `ASSESSMENT_OPS_WEBHOOK_URL` or
  `CLASSROOM_OPS_WEBHOOK_URL` (raw JSON), falls back to email at
  `CLASSROOM_OPS_EMAIL_RECIPIENTS`, and persists a `SecurityAlert` row (Django admin).
- `classes.alerting.notify_ops_critical`: the same channels, Slack-style text, dedupe via cache.
- `config.ops_alerting.AlertmanagerWebhookView` forwards to Telegram, but no Alertmanager runs.
- lc-up has no outbound alerts: its "alerts" are strings on `LcupSyncRun.alerts`, shown in `/ops/lcup`.

The watchdog uses the first, through `manage.py celery_beat_watchdog_alert` (JSON on stdin, run as
satapp). Rows have `source="watchdog"` and `alert_type="celery_beat.<event>"`.

**Gap, for the owner:** on prod, *none* of `CLASSROOM_OPS_WEBHOOK_URL`, `ASSESSMENT_OPS_WEBHOOK_URL`,
`CLASSROOM_OPS_EMAIL_RECIPIENTS` or `ALERT_TELEGRAM_*` is set. Today every ops alert, the existing
SLO alerts included, ends as a log line and an admin row that nobody is told about. The zero-code
fix is `CLASSROOM_OPS_EMAIL_RECIPIENTS=<owner email>` in `shared/backend.env` (`DEFAULT_FROM_EMAIL`
is set), followed by a backend and worker restart.

## 6. py-spy on prod?

Not now. The stack above came free: PM2's SIGINT interrupts any wait inside Python, and the
watchdog saves what beat prints (`shutdown.log`) along with `/proc`, `wchan` and strace. py-spy only
adds native frames, which matter only for a hang inside C code that SIGINT cannot interrupt. If an
incident ever arrives with an empty `shutdown.log`, install it (`pip install py-spy` into its own
venv, on PATH for root). The watchdog already calls it when present.

## 7. Rollout (each step needs the owner's yes)

0. Merge; a normal release deploy ships `celery_beat_watchdog_alert` (no migration).
1. `bash /var/www/satapp/current/deploy/watchdog/install.sh` installs it in **dry-run**: it logs
   `would_restart` but never restarts or alerts. Watch `journalctl -u sat-beat-watchdog` across a
   deploy and a night. Expect only `healthy`, `starting` and `not_online`.
2. `bash /var/www/satapp/current/deploy/watchdog/install.sh --live`.
3. Optional drill at a quiet hour: `kill -STOP <beat pid>`. Within about 11 min expect `stalled` →
   `restarted` → an alert row, then `recovered`. A stopped process still takes PM2's SIGKILL.
4. Separately: the §2 fix, and the §5 email recipient.

**Off switches:** `touch /var/www/satapp/shared/beat-watchdog.pause` (instant), or
`install.sh --uninstall` (incidents are kept).

### Dry-run install, done 2026-10-15 12:24 CEST (owner's yes)

This was installed before merge. `install.sh` ran from a root-only copy of the branch's files,
`/root/sat-beat-watchdog/` (commit `f2158333`, checksums verified). After merge and deploy, run
`/var/www/satapp/current/deploy/watchdog/install.sh --live` from the release instead; it re-copies
the script. Then delete `/root/sat-beat-watchdog/`.

- Installed: `/usr/local/sbin/sat-beat-watchdog`, both units, `sat-beat-watchdog.service.d/10-dry-run.conf`
  (`SAT_BEAT_WD_DRY_RUN=1`), `/var/lib/sat-beat-watchdog/` (0700), and `/var/log/sat-beat-watchdog.log` (0640).
- Timer runs at 12:25:30 and 12:26:30 were `healthy` with `dry_run: true`, log ages 30 s and
  schedule ages 90/150 s. They left 0 PAM session lines, because the script uses `setpriv` (runuser
  would log ~2,900 a day). Beat was untouched: pid 2902891, 25 restarts before and after.
- What to watch: `journalctl -u sat-beat-watchdog`. The action log `/var/log/sat-beat-watchdog.log`
  stays empty until something other than "healthy" happens. Expect `not_online` / `starting`
  during deploys, and `would_restart` only on a real stall.

Checked on prod before that, without installing: one `--dry-run` from `/tmp` read the real PM2 list
and files (`healthy`, log 14 s, schedule 134 s). With a 5 s threshold it took the stall path to
`would_restart`. Beat was untouched (same pid, restart count 25). `systemd-analyze verify` passed
both units. The temp files were removed.
