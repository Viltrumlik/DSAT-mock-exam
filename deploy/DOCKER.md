# Docker — what it is for here, and what it is not

## The honest pitch

Measured on the 2026-08-08 deploy (`release_deploy.sh`, release `20260808-063019-d8eadfb`):

| | |
|---|---|
| Whole deploy | **611s** |
| `npm run build` | **8.4s** |

The build is 1.4% of it. The time goes to a **fresh venv + full `pip install` on every
release**, `npm ci`, and `collectstatic`. So:

**Docker is not a speed fix.** It does not delete that work — it moves it to CI, where it is
cached and where nobody is watching a production server with the maintenance page up. That is
worth something, but so is a `requirements.txt`-hash-keyed venv cache, and that is an
afternoon's work with no new runtime.

**Docker is a drift fix**, and this deployment's incident history is mostly drift:

- two venvs on prod, so a command run from the wrong one silently used the wrong packages
- root-owned files breaking `git fetch` mid-deploy
- an untracked `__init__.py` crashing the workers and triggering an auto-rollback
- `urllib3 (2.6.3) / chardet (7.4.3) doesn't match a supported version` in every run's output
- **`python -m playwright install chromium` is a hand-run step.** Midterm certificates render
  through headless Chromium. When it is missing the failure is a student's certificate, not a
  startup error — nothing tells you.

An image cannot forget the chromium step, cannot have two venvs, and cannot be half-updated.
That is the reason to do this. Speed is a side effect.

## What is here

| File | |
|---|---|
| `backend/Dockerfile` | Django + Celery, one image, three commands. Chromium baked in. |
| `frontend/Dockerfile` | Next.js `output: "standalone"`. |
| `compose.yaml` | The four services, wired the way PM2 wires them today. |
| `.github/workflows/docker_images.yml` | Builds both on every PR that touches them; pushes to GHCR on `main`. |

**Nothing here deploys.** The images exist; production still runs `release_deploy.sh`.

## Three things that will bite if they are not understood

**1. `NEXT_PUBLIC_*` is baked at build time, not read at boot.** Next inlines those values
into the client bundle during `next build`. The frontend image is therefore
environment-specific: an image built with staging's API URL talks to staging wherever you run
it. They arrive as `--build-arg` (CI reads them from repo variables). Moving them to compose
`environment:` would *look* like it worked and change nothing the browser sees.

**2. Postgres stays on the host.** It is not in `compose.yaml` and should not be. It has its
own backups and its own upgrade cadence, and in compose a stray `docker compose down -v`
becomes a data-loss command. Containers reach it via `host.docker.internal`, which on Linux
needs the `extra_hosts: host-gateway` line that is already there.

**3. Nginx stays on the host and stays manual.** TLS, the maintenance page and the 502→503
rewrite live there, and `deploy/RELEASE_LAYOUT.md` already says the nginx config is never
pushed by a script — a bad automated nginx change takes the site down along with the way back
in. The containers listen on `127.0.0.1:8000` and `127.0.0.1:3000`, which is exactly where
nginx already proxies for PM2.

## Before any cutover: port the safety first

`release_deploy.sh` is not just "git pull and restart". It earned each of these the hard way,
and a compose cutover that drops them is a downgrade however clean it looks:

- `pg_dump -Fc` **before** migrate, kept in `shared/backups/`
- `migrate --plan` + `makemigrations --check` — refuse to deploy on schema drift
- health gates before the symlink swap, and again after
- **automatic database restore** when a migration fails
- **automatic rollback** to `previous` when the new release does not come up
- the maintenance page copied into `shared/` *before* PM2 stops

`docker compose pull && docker compose up -d` has none of that. Write the wrapper that does,
prove it on a staging host, and only then consider prod. Concretely:

```bash
# on the VPS, once the wrapper exists
export IMAGE_TAG=sha-<the sha CI pushed>
docker compose pull
docker compose up -d
docker compose ps          # health must be healthy, not just running
```

Rollback is `IMAGE_TAG=<previous sha> docker compose up -d`, which is genuinely better than
the symlink dance — but only once the pre-migrate dump and the restore path exist.

## Recommended order

1. **Cheap wins first, no Docker.** Cache the venv on a `requirements.txt` hash, cache
   `node_modules` on `package-lock.json`, skip `collectstatic` when static inputs are
   unchanged, run the two 45s health waits concurrently. Most of the 611s, none of the risk.
2. Let the image build run in CI for a while. It costs nothing and proves the Dockerfiles stay
   correct as dependencies move.
3. Stand the compose stack up on a **staging** host against a copy of the database.
4. Port the safety list above into a `deploy/compose_deploy.sh`.
5. Only then cut production over.

Skipping to 5 trades a deploy path with automatic rollback for one without.
