# Deployment Guide — MasterSAT Mock Exam

## Prerequisites

- Hetzner VPS running **Ubuntu 22.04 LTS** (minimum 2GB RAM)
- A domain name pointed to your VPS IP
- SSH access to the server

---

## Production layout (recommended)

Immutable **releases** under `/var/www/satapp/releases/<RELEASE_ID>/`, a **`current`** symlink, and **`shared/`** for secrets and media. See **[RELEASE_LAYOUT.md](RELEASE_LAYOUT.md)** for the full diagram and one-time migration.

**Canonical deploy command:**

```bash
bash /var/www/satapp/deploy/release_deploy.sh origin/main
```

This acquires a **non-blocking flock** on `shared/.deploy.lock` (no concurrent deploys), builds from `git archive`, stops Celery (including `pm2 delete` so workers cannot linger), runs `pg_dump` (pre-migrate), runs **`migrate` only from the new release’s venv** (before `current/` changes), `collectstatic`, then **`check --deploy`**, **`migrate --check`**, and static/`.next` sanity checks **before** flipping `current/`. If anything fails after the symlink (for example PM2 reload), `current/` is **reverted** to the prior release when possible. `shared/release_state.json` is written **only after** a successful PM2 reload, with an **absolute** `rollback_db_dump` path.

Optional env: `SKIP_HEALTH_CHECKS=1` (emergency only), `SKIP_PM2_RELOAD=1` (debug), `AUTO_DB_RESTORE_ON_FAIL=0` (disable automatic `pg_restore` on failure after migrate), `DEPLOY_HEALTH_URL=` (empty skips post-cutover HTTP curl), `PM2_ONLINE_WAIT_S=45`, `KEEP_BACKUP_DUMPS_N=40` (retain newest N `pg_*.dump` files under `shared/backups/`; this deploy’s dump is never deleted in that pass).

**Rollback (code + DB to state before last cutover):**

```bash
bash /var/www/satapp/deploy/rollback.sh
```

Uses the **same lock file** (blocking wait). DB restore uses **only** `rollback_db_dump` from `release_state.json` (must be an absolute path to an existing file) or **`--dump /absolute/path/to.dump`**. No path guessing. Options: `--no-db` (symlink only), `--release ...`, `--purge-celery`.

**PM2** uses [`ecosystem.config.js`](ecosystem.config.js): `sat-frontend`, `sat-backend`, `sat-celery-worker`, `sat-celery-beat` (all under `/var/www/satapp/current/...`). If you run Celery beat on another host, `pm2 delete sat-celery-beat` on this server.

**Nginx** must serve static from `current` and media from `shared` (see [`nginx.conf`](nginx.conf)).

---

## Step 1 — Initial Server Setup (Run Once)

```bash
# SSH into your server
ssh root@YOUR_SERVER_IP

# Upload and run the setup script
bash /path/to/deploy/setup_server.sh yourdomain.com
```

This installs: Node.js, PM2, Python 3, Nginx, Certbot. Install **`postgresql-client`** on the app host for `pg_dump` / `pg_restore` / `psql`.

---

## Step 2 — Clone the Repository

```bash
su - satapp
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /var/www/satapp
```

---

## Step 3 — First-time migration to `shared/` + releases

```bash
bash /var/www/satapp/deploy/migrate_to_release_layout.sh
```

Creates `shared/`, moves `backend/.env` → `shared/backend.env` and `frontend/.env.production` → `shared/frontend.env.production`, syncs media into `shared/media/`, and prepares `releases/`.

Fill secrets if the script reported missing files:

```bash
chmod 600 /var/www/satapp/shared/backend.env /var/www/satapp/shared/frontend.env.production
```

Example `shared/backend.env` (same variables as before):

```env
SECRET_KEY=<generate with: python3 -c "import secrets; print(secrets.token_hex(50))">
DEBUG=False
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/DBNAME
DB_SSL=False
GOOGLE_CLIENT_ID=....apps.googleusercontent.com
CORS_ALLOWED_ORIGINS=https://yourdomain.com
REDIS_URL=redis://127.0.0.1:6379/0
CELERY_BROKER_URL=redis://127.0.0.1:6379/1
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/2
# Web Push — optional, but push is DEAD until these are set. See "Step 6b" below.
# Generate with: python manage.py generate_vapid_keys   (never commit the private key)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

`shared/frontend.env.production`:

```env
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
```

User profile photos live under **`shared/media/profiles/`** (Nginx `alias` in `nginx.conf`).

---

## Step 4 — Configure Nginx (release paths)

```bash
sudo cp /var/www/satapp/deploy/nginx.conf /etc/nginx/sites-available/satapp
# Edit server_name if needed
sudo nginx -t && sudo systemctl reload nginx
```

Static files: `/var/www/satapp/current/backend/staticfiles/`. Media: `/var/www/satapp/shared/media/`.

---

## Step 5 — First release + PM2

```bash
bash /var/www/satapp/deploy/release_deploy.sh origin/main
pm2 status
```

---

## Step 6 — Enable SSL (HTTPS)

Issue/expand one certificate covering the apex plus every console subdomain
(`admin.`, `questions.`, `teacher.`). Re-running this command with all `-d` flags
expands the existing cert in place; auto-renewal then covers all names.

```bash
sudo certbot --nginx \
  -d mastersat.uz -d www.mastersat.uz \
  -d admin.mastersat.uz -d questions.mastersat.uz \
  -d teacher.mastersat.uz
```

> Each `-d` host must already resolve to this server (HTTP-01 challenge). Verify with
> `dig +short teacher.mastersat.uz` before running certbot.

---

## Adding a new console subdomain (e.g. teacher.mastersat.uz)

The frontend is a single Next.js app that serves every console by Host header, so a new
subdomain is additive config — no second app/process.

1. **DNS:** add an `A` record `teacher` → this server's IP (same as the apex). Wait for
   propagation (`dig +short teacher.mastersat.uz`).
2. **nginx:** add the host to both `server_name` lines in `nginx.conf` (already done for
   `teacher.`), then `sudo nginx -t && sudo systemctl reload nginx`.
3. **SSL:** expand the cert (Step 6 above) to include the new `-d` host.
4. **Backend env** (`shared/backend.env`): append the host to `ALLOWED_HOSTS`
   (e.g. `,teacher.mastersat.uz`). `CSRF_TRUSTED_ORIGINS` already lists it in
   `settings.py`; cookie domain `.mastersat.uz` already covers it.
5. **Frontend env** (`shared/frontend.env.production`): ensure
   `NEXT_PUBLIC_TEACHER_PORTAL_URL` and `NEXT_PUBLIC_MAIN_SITE_URL` are set.
6. Redeploy (`release_deploy.sh`) so the new env is picked up.

Access rules and routing for the teacher console are enforced in code:
`frontend/middleware.ts`, `frontend/src/components/AuthGuard.tsx`,
`backend/access/host_guard.py`, and the login gate in `backend/users/views.py`.

---

## Step 6b — Web Push (VAPID keys)

The whole Web Push stack — `pywebpush`, the `PushSubscription` model, the Celery sender,
`frontend/public/sw.js`, the nginx `location = /sw.js` no-cache block — ships and works. Push
is nevertheless **off in production**, for exactly one reason: the three settings below default
to empty, `notifications.push.is_configured()` therefore returns `False`, and every send is
skipped. The in-app bell is unaffected either way.

| Variable | What it is |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Base64url. Served to the browser by `GET /api/notifications/push/config/` and handed to `PushManager.subscribe()` as the `applicationServerKey`. Public by nature. |
| `VAPID_PRIVATE_KEY` | Base64url. **Secret.** The Celery worker signs every push with it. |
| `VAPID_SUBJECT` | `mailto:` address or https URL — how a push service reaches a human if this platform misbehaves. Required by the spec; some services reject a subscription without it. |

### Generate a pair

Run this **on the server, in the release venv**, and paste the output into
`shared/backend.env`:

```bash
cd /var/www/satapp/current/backend
./venv/bin/python manage.py generate_vapid_keys
```

The command prints the three lines and **stores nothing**. It writes no file, and there is no
key committed anywhere in this repository — deliberately. A VAPID private key in git is usable
by anyone with repository access for the whole life of the history, and the only remedy is
rotation, which invalidates every subscription every student has ever granted. **Never paste
the private key into a tracked file, a sample env, a ticket, or a chat message.**

```bash
chmod 600 /var/www/satapp/shared/backend.env
```

### Restart BOTH processes

Settings are read once at start, and two different processes read these:

```bash
pm2 restart sat-backend         # serves the public key to the browser
pm2 restart sat-celery-worker   # signs and sends the actual pushes
```

Restarting only one leaves push half-configured. If only the worker has the keys, the client
is told `enabled: false` and never asks the student for permission, so nothing subscribes and
nothing is ever sent. If only the web process has them, students are asked for a permission
that no worker can act on — and **a refused notification permission is permanent per origin**,
so a half-configured deployment can burn the platform's one chance to ask.

### Verify

```bash
curl -s -H "Authorization: Bearer <token>" https://yourdomain.com/api/notifications/push/config/
# {"enabled": true, "public_key": "B..."}
```

`enabled: false` after a restart means the keys did not reach that process, or `pywebpush` is
missing from the venv.

### Rotation

Rotating invalidates every existing subscription; browsers do **not** re-ask on their own. Plan
it as a user-visible event, not a maintenance detail. Dead endpoints are stamped `failed_at`
by the sender and reaped by the `notifications-prune-push-subscriptions` beat entry.

### Scheduled notification jobs

Both live in `CELERY_BEAT_SCHEDULE` and therefore need `sat-celery-beat` running:

| Entry | Cadence | What breaks without it |
| --- | --- | --- |
| `notifications-homework-due-soon` | every 30 min | `HOMEWORK_DUE_SOON` has no other producer at all — a deadline is newsworthy because time passed, so nothing can hook it. No beat, no reminders. |
| `notifications-prune-push-subscriptions` | daily 04:25 | Dead subscription rows accumulate forever. |

---

## Step 7 — PM2 Auto-start on Reboot

```bash
pm2 startup systemd -u satapp --hp /home/satapp
pm2 save
```

---

## Verification Checklist

```bash
pm2 status
sudo nginx -t
curl https://yourdomain.com/api/
curl https://yourdomain.com
```

---

## Ongoing releases

```bash
bash /var/www/satapp/deploy/release_deploy.sh origin/main
# or a SHA:  bash ... abc123def
```

Optional: `KEEP_LAST_N=10` to retain more release directories. `SKIP_PM2_RELOAD=1` builds only (debug).

**Manual backup** (any time):

```bash
bash /var/www/satapp/deploy/backup_postgres.sh
```

Writes a custom-format dump under `shared/backups/` (or `backups/` on legacy trees).

---

## Post-deploy smoke + rollback

- **Smoke runner**: `deploy/run_post_deploy_smoke.sh`
- **Playwright spec**: `frontend/tests/e2e/release_smoke_api.spec.ts`

If smoke fails after a release:

```bash
bash /var/www/satapp/deploy/rollback.sh
```

---

## Legacy in-place deploy (no `releases/`)

`deploy/deploy.sh` still supports a flat tree at `/var/www/satapp` (`git pull`, venv under `backend/venv`, etc.). It uses **[ecosystem.legacy.config.js](ecosystem.legacy.config.js)** (only `sat-frontend` + `sat-backend`). Override with `ECOSYSTEM_FILE=...` if needed.

Do **not** run plain `npm ci` from `deploy/` expecting the Next app; use `frontend/` as documented in older notes:

```bash
npm ci --prefix /var/www/satapp/frontend --no-audit --no-fund
npm run build --prefix /var/www/satapp/frontend
```

---

## Useful Commands

```bash
pm2 status
pm2 logs sat-backend
pm2 logs sat-frontend
pm2 logs sat-celery-worker
sudo tail -f /var/log/nginx/satapp-error.log
```

---

## Security Checklist

- [ ] `DEBUG=False` in `shared/backend.env`
- [ ] Unique `SECRET_KEY` generated
- [ ] UFW firewall active (ports 22, 80, 443 only)
- [ ] SSL certificate installed
- [ ] Root SSH login disabled (optional): `PermitRootLogin no` in `/etc/ssh/sshd_config`
