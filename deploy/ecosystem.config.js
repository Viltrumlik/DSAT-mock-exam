// ============================================================
// ecosystem.config.js — PM2 Process Manager Configuration
//
// Paths use /current so each deploy is an atomic symlink swap
// (see deploy/RELEASE_LAYOUT.md and deploy/release_deploy.sh).
// Legacy in-place deploys: run deploy/deploy.sh (fixed paths) or
// migrate with deploy/migrate_to_release_layout.sh then release_deploy.
// ============================================================

const backendCwd = '/var/www/satapp/current/backend';
const frontendCwd = '/var/www/satapp/current/frontend';
const venvGunicorn = '/var/www/satapp/current/backend/venv/bin/gunicorn';
const venvCelery = '/var/www/satapp/current/backend/venv/bin/celery';
const venvUvicorn = '/var/www/satapp/current/backend/venv/bin/uvicorn';
// Celery beat persists its schedule (a shelve DB) to disk. The cwd is the
// per-release tree (created root-owned by the deploy), so the default
// `celerybeat-schedule` file there is unwritable by the `satapp` service user
// → beat crash-loops with PermissionError. Pin it to the satapp-owned shared/
// dir, which is also stable across releases.
const beatSchedule = '/var/www/satapp/shared/celerybeat-schedule';

module.exports = {
  apps: [
    {
      // ── Next.js Frontend ──────────────────────────────────
      name: 'sat-frontend',
      cwd: frontendCwd,
      script: 'npm',
      args: 'run start',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // ── Django Backend (Gunicorn) ─────────────────────────
      name: 'sat-backend',
      cwd: backendCwd,
      script: venvGunicorn,
      args:
        'config.wsgi:application --bind 127.0.0.1:8000 --workers 3 --timeout 120 --access-logfile - --error-logfile -',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        DJANGO_SETTINGS_MODULE: 'config.settings',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // ── Live quiz WebSockets (ASGI, separate from Gunicorn) ─
      //
      // Its own process on its own port, and that is the whole point. A WebSocket held
      // open for a 20-minute quiz would park one of Gunicorn's three SYNC workers for the
      // duration — which is precisely how /api/realtime/events/ took the site down in
      // August 2026. Here, thirty open sockets cost one async process and nothing else.
      //
      // nginx routes only /ws/ here (deploy/nginx.conf). Everything else still goes to
      // Gunicorn on :8000, untouched.
      //
      // ONE worker on purpose. The in-memory channel layer does not span processes, so
      // without REDIS_URL a second worker would put half a class in a lobby that had
      // already started. Prod does set REDIS_URL, but one async worker carries far more
      // sockets than this school will ever open at once, so the risk buys nothing.
      name: 'sat-livequiz',
      cwd: backendCwd,
      script: venvUvicorn,
      args:
        'config.asgi:application --host 127.0.0.1 --port 8001 --workers 1 --log-level info',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        DJANGO_SETTINGS_MODULE: 'config.settings',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // ── Celery worker (same venv + code as Gunicorn) ───────
      name: 'sat-celery-worker',
      cwd: backendCwd,
      script: venvCelery,
      args: '-A config worker -l INFO --concurrency 2',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '768M',
      env: {
        DJANGO_SETTINGS_MODULE: 'config.settings',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      // ── Celery beat (single host only; delete if beat runs elsewhere)
      name: 'sat-celery-beat',
      cwd: backendCwd,
      script: venvCelery,
      args: `-A config beat -l INFO --schedule ${beatSchedule}`,
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env: {
        DJANGO_SETTINGS_MODULE: 'config.settings',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
