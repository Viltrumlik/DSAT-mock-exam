// The TEST COPY beside prod (/var/www/satapp-staging): its own ports, database and redis dbs. Built by stg-build.sh.
// Every app runs under libfaketime and reads the time machine's clock file ("+Nd"), so the whole copy lives N days
// ahead of the real date (deploy/staging/stg_timemachine.py moves it). The monotonic clock is shifted too: with it left
// real, libfaketime 0.9.10 makes Python's time.sleep() fail with EINVAL (gunicorn and beat crash). File times stay real.
const cur = '/var/www/satapp-staging/current';
const shared = '/var/www/satapp-staging/shared';
const clock = {
  LD_PRELOAD: '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1',
  FAKETIME_TIMESTAMP_FILE: `${shared}/timemachine/clock`,
  NO_FAKE_STAT: '1',
  FAKETIME_CACHE_DURATION: '5',
};
const common = { instances: 1, autorestart: true, watch: false, log_date_format: 'YYYY-MM-DD HH:mm:ss' };
const django = { DJANGO_SETTINGS_MODULE: 'config.settings', ...clock };

module.exports = {
  apps: [
    {
      ...common,
      name: 'stg-frontend',
      cwd: `${cur}/frontend`,
      script: 'npm',
      args: 'run start',
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: 3030, ...clock },
    },
    {
      ...common,
      name: 'stg-backend',
      cwd: `${cur}/backend`,
      script: `${cur}/backend/venv/bin/gunicorn`,
      args: 'config.wsgi:application --bind 127.0.0.1:8030 --workers 2 --timeout 120 --access-logfile - --error-logfile -',
      interpreter: 'none',
      max_memory_restart: '512M',
      env: django,
    },
    {
      ...common,
      name: 'stg-celery-worker',
      cwd: `${cur}/backend`,
      script: `${cur}/backend/venv/bin/celery`,
      args: '-A config worker -l INFO --concurrency 1 -n stg@%h',
      interpreter: 'none',
      max_memory_restart: '400M',
      env: django,
    },
    {
      ...common,
      name: 'stg-celery-beat',
      cwd: `${cur}/backend`,
      script: `${cur}/backend/venv/bin/celery`,
      args: `-A config beat -l INFO --schedule ${shared}/celerybeat-schedule`,
      interpreter: 'none',
      max_memory_restart: '300M',
      env: django,
    },
  ],
};
