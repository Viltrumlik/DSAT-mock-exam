# Release layout (`/releases`, `/current`, `/shared`)

Production deploys use **immutable release directories** under `releases/<RELEASE_ID>/`, a **`current` symlink** for running code, and **`shared/`** for secrets and user media that survive across releases.

## Directory layout

```text
/var/www/satapp/
  deploy/                    # ecosystem.config.js, scripts (this repo’s deploy/)
  releases/<RELEASE_ID>/     # one tree per deploy (backend/, frontend/, no secrets in git)
  current -> releases/<RELEASE_ID>
  previous -> releases/<OLDER_ID>    # updated after a successful cutover
  shared/
    backend.env              # Django env (chmod 600); was backend/.env
    frontend.env.production  # Next public API URL etc.
    media/                   # real uploads (e.g. profiles/); Nginx serves this path
    backups/                 # pg_dump -Fc files + release_state.json
    release_state.json       # written by release_deploy.sh / rollback.sh
    maintenance/             # 503 page Nginx serves while PM2 is down mid-deploy
```

### Maintenance page

`release_deploy.sh` copies `deploy/maintenance/` → `shared/maintenance/` at the
`link_shared` stage — before PM2 stops, so the refreshed page is already in place when the
downtime starts. It lives under `shared/` rather than `current/` precisely because the
`current` symlink is being swapped exactly when the page is needed.

Nginx turns the resulting 502 into it (`error_page 502 503 504`), answering **503 +
`Retry-After: 60`** so crawlers hold the ranking. Three different bodies by request type:
a page gets the HTML, `/api/` gets JSON (axios would choke on HTML), and a static asset gets
a bare bodyless 503. The page polls `/api/health/live/` and reloads itself on recovery.

**Nginx config is NOT deployed by the script** — after pulling this change, update the server
once by hand:

```bash
sudo cp /var/www/satapp/current/deploy/nginx.conf /etc/nginx/sites-available/satapp
sudo nginx -t && sudo systemctl reload nginx
```

`RELEASE_ID` format: `YYYYMMDD-HHMMSS-<short_git_sha>` (example: `20260504-143022-a1b2c3d`).

## One-time migration (legacy flat tree)

Run on the VPS as the app user (`satapp`) from any directory:

```bash
bash /var/www/satapp/deploy/migrate_to_release_layout.sh
```

The script:

- Creates `shared/`, `releases/`, and empty `media/` / `backups/` as needed.
- Moves `backend/.env` → `shared/backend.env` and `frontend/.env.production` → `shared/frontend.env.production` when those files still live under the legacy paths.
- Rsyncs `backend/media/` → `shared/media/` when appropriate.
- Moves legacy `backups/` into `shared/backups/` if present.

Then:

1. Update Nginx to use `current/backend/staticfiles` and `shared/media` (see `deploy/nginx.conf` in repo).
2. Reload Nginx: `sudo nginx -t && sudo systemctl reload nginx`.
3. Point PM2 at `current` (see `deploy/ecosystem.config.js`).
4. Build the first release and cut over:

   ```bash
   bash /var/www/satapp/deploy/release_deploy.sh origin/main
   ```

After `current` exists, you can remove or ignore the legacy top-level `backend/` and `frontend/` source trees on the server **only if** you no longer use `deploy/deploy.sh` (in-place pull). Prefer keeping a `.git` checkout at `/var/www/satapp` for `git archive` / fetch, or set `APP_GIT_DIR` to a clone used only for deploys.

## State file (`shared/release_state.json`)

Written by `release_deploy.sh` **only after** a successful PM2 reload. Fields include `active_release_id`, `previous_release_id`, and **`rollback_db_dump`**: an **absolute** filesystem path to the `pg_dump -Fc` file taken immediately before that deploy’s `migrate`. `rollback.sh` restores from that path only (or from an explicit `--dump` absolute path); there is no inferred backup path.

## Backups

`deploy/backup_postgres.sh` prefers `shared/backend.env` and `current/backend/venv` when present, and falls back to the legacy `backend/.env` layout.

## Legacy in-place deploy

`deploy/deploy.sh` still pulls the repo at `APP_DIR` and builds `backend/` + `frontend/` in place. It reloads PM2 with **`deploy/ecosystem.legacy.config.js`** (fixed `/var/www/satapp/backend` paths). Release-based production uses **`deploy/ecosystem.config.js`** (`/current/...`) via `release_deploy.sh`.
