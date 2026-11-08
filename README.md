# MasterSAT — Digital SAT Mock Exam Platform

Monorepo for **MasterSAT** ([mastersat.uz](https://mastersat.uz)), a learning and testing
platform for a Digital SAT training centre. Students sit full-length mocks, midterms, past
papers, and practice tests in a Bluebook-style exam runner, do classroom homework, and learn
vocabulary; teachers run classrooms, grading, and attendance; staff author questions and
operate the centre from dedicated consoles. The repo also contains a native iOS student app
and a Windows lockdown app for invigilated sittings.

## Features

**Students (web)**
- Exam runner for full mocks, midterms, past papers, and practice-test packs, with a
  server-owned timer, autosave, and results / answer review
- Question bank practice, review center, and question of the day
- Classrooms with homework, assessments, materials, and a class stream
- Vocabulary word bank and word sets
- Roadmap, progress analytics, and leaderboards
- Rewards: points, coins, and a shop; Live Quiz sessions over WebSockets
- Events, stories, surveys, notifications (including Web Push), and support
- Midterm certificates rendered to PDF

**Teachers** (`teacher.` console)
- Classrooms, homework, grading, gradebook, attendance, materials
- Assessments, midterms, past papers, mock sessions, and question analysis

**Staff and admins**
- Builder (`questions.` console): question bank, PDF import, sets, full mocks, midterms,
  past papers, practice tests, vocabulary, categories
- Ops console (`/ops`): users, staff, students, access control, classrooms, branches,
  finance ledger, SMS, Telegram posts, broadcasts, events, shop, surveys, and more
- Role- and attribute-based access control (`access` app)

**Other clients**
- `ios/` — SwiftUI student app for the daily loop (home, homework, classroom, words, rewards)
- `desktop/` — Windows exam app (Tauri v2 shell) with keyboard lockdown for midterms
- `desktop-native/` — native rewrite of the Windows exam app (Flutter + WebView2 + Rust)

**Integrations** (all optional, configured through environment variables)
Google sign-in, Telegram login, email verification over SMTP (Mailgun), SMS via eskiz.uz,
lc-up CRM sync, Cloudflare R2 media storage, Web Push (VAPID), Apple Push (APNs), and a
Telegram bot for question error reports.

## Tech stack

| Area | Technologies |
|------|--------------|
| Backend | Python 3.12, Django 6.0, Django REST Framework, SimpleJWT, drf-spectacular, Celery + Redis, Django Channels + uvicorn (Live Quiz), PostgreSQL (SQLite for local dev), WhiteNoise, Jazzmin, PyMuPDF, Playwright / ReportLab (PDF) |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, TanStack Query, Zustand, React Hook Form + Zod, Axios, KaTeX, Recharts, dnd-kit |
| iOS | Swift 6, SwiftUI, Swift Package `MasterSATKit` (iOS 17+) |
| Windows | Tauri v2 (Rust) in `desktop/`; Flutter + WebView2 + Rust + Velopack in `desktop-native/` |
| Testing | Django test runner, Vitest, Playwright, k6 (load / chaos) |
| Ops | GitHub Actions, PM2, Nginx, Docker images (GHCR), Prometheus, Alertmanager, Grafana |

## Getting started

### Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- Optional: PostgreSQL and Redis (not required for local development)

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `backend/.env` for local development:

```dotenv
SECRET_KEY=change-me                 # python3 -c "import secrets; print(secrets.token_hex(50))"
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=                        # empty -> SQLite (backend/db.sqlite3)
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

```bash
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver 8000
```

With `DEBUG=True` and no `DATABASE_URL` / `REDIS_URL`, the backend uses SQLite, an
in-process cache, an in-memory channel layer, and scores exam attempts inline, so Postgres,
Redis, and Celery are not needed. Optional extras:

```bash
celery -A config worker -l INFO                     # background jobs
celery -A config beat -l INFO                       # scheduled jobs
uvicorn config.asgi:application --port 8001         # Live Quiz WebSockets (LIVE_QUIZ_ENABLED=true)
python -m playwright install chromium               # midterm certificate PDFs
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
echo "API_PROXY_TARGET=http://localhost:8000" >> .env.local
npm run dev                                         # http://localhost:3000
```

In development, `next.config.ts` proxies `/api/*` to `API_PROXY_TARGET`. If it is not set,
the proxy falls back to the production API (`https://mastersat.uz`), so always set it when
working against a local backend.

The admin, question-author, and teacher consoles are selected by subdomain
(`admin.`, `questions.`, `teacher.`); locally you can use hosts such as
`http://teacher.localhost:3000`.

### Configuration

All variables are documented in [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example). The most important ones:

| Variable | Where | Purpose |
|----------|-------|---------|
| `SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS` | backend | Django core settings |
| `DATABASE_URL`, `DB_SSL` | backend | PostgreSQL (required when `DEBUG=False`) |
| `REDIS_URL` | backend | Shared cache and channel layer (required in production) |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | backend | Celery broker / result backend |
| `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS_EXTRA` | backend | Allowed frontend origins |
| `GOOGLE_CLIENT_ID`, `TELEGRAM_BOT_TOKEN` | backend | Google / Telegram sign-in |
| `EMAIL_*` | backend | SMTP email (off until `EMAIL_SENDING_ENABLED=True`) |
| `ESKIZ_*`, `SMS_DEBT_WARNINGS_ENABLED` | backend | SMS via eskiz.uz |
| `LCUP_*`, `BILLING_*` | backend | lc-up CRM sync and billing ledger (off by default) |
| `R2_*` | backend | Cloudflare R2 media storage (inert unless `R2_BUCKET` is set) |
| `VAPID_*`, `APNS_*` | backend | Web Push and Apple Push notifications |
| `LIVE_QUIZ_ENABLED` | backend | Live Quiz WebSockets |
| `API_PROXY_TARGET` | frontend | Backend URL for the dev `/api` proxy |
| `NEXT_PUBLIC_API_URL` | frontend | Optional absolute API base URL |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | frontend | Google sign-in client ID |
| `NEXT_PUBLIC_TEACHER_PORTAL_URL`, `NEXT_PUBLIC_MAIN_SITE_URL` | frontend | Cross-console links |

## Usage

| Path | Description |
|------|-------------|
| `/` | Student site (dashboard, classes, mocks, practice, vocabulary, rewards) |
| `/builder` | Question and test authoring |
| `/teacher` | Teacher console |
| `/ops` | Operations console |
| `/django-admin/` | Django admin |
| `/api/schema/`, `/api/schema/swagger/` | OpenAPI schema and Swagger UI |
| `/api/health/live/`, `/api/health/ready/` | Health checks |

API route groups live under `/api/` (`auth`, `users`, `exams`, `classes`, `assessments`,
`questionbank`, `midterms`, `mocks`, `vocabulary`, `rewards`, `livequiz`, `notifications`,
`mobile`, `desktop`, and others); see [`backend/config/urls.py`](backend/config/urls.py)
and [`docs/api/API_MAP.md`](docs/api/API_MAP.md).

## Testing

```bash
# Backend
cd backend && python manage.py test

# Frontend
cd frontend
npm run lint
npm run test          # Vitest
npm run test:e2e      # Playwright

# iOS engine and API layer (no Xcode required)
cd ios/MasterSATKit && swift test

# Load tests (see load/README.md)
k6 run -e BASE_URL=... -e TOKEN=... -e PRACTICE_TEST_ID=... load/k6_sat_exam_engine.js
```

## Deployment

Production runs on a VPS with immutable release directories, PM2 (`sat-frontend`,
`sat-backend`, `sat-livequiz`, `sat-celery-worker`, `sat-celery-beat`), host Nginx, and
host PostgreSQL / Redis. See:

- [`deploy/README.md`](deploy/README.md) — server setup, release deploy, and rollback
- [`deploy/RELEASE_LAYOUT.md`](deploy/RELEASE_LAYOUT.md) — release directory layout
- [`deploy/DOCKER.md`](deploy/DOCKER.md) and [`compose.yaml`](compose.yaml) — containerised topology
- [`ops/`](ops) — Prometheus alert rules, Alertmanager, Grafana dashboards

## Project structure

```
DSAT-mock-exam/
├── backend/          # Django project (config/) and apps: exams, mocks, midterms, assessments,
│                     # classes, questionbank, vocabulary, users, access, rewards, shop, livequiz,
│                     # notifications, lcup, billing, sms, mobile, desktop, ...
├── frontend/         # Next.js app: src/app (routes), src/features, src/components, src/lib
├── ios/              # SwiftUI app (MasterSAT/) and Swift package (MasterSATKit/)
├── desktop/          # Windows exam app — Tauri v2 shell
├── desktop-native/   # Windows exam app — Flutter + WebView2 islands + Rust native library
├── deploy/           # Deploy, rollback, backup, Nginx, PM2, watchdog
├── ops/              # Prometheus, Alertmanager, Grafana
├── load/             # k6 load and chaos tests
├── docs/             # ADRs, API map, RBAC policy, design and release notes
├── scripts/          # CI helper scripts
├── .github/workflows # CI, desktop builds, Docker images, smoke tests
└── compose.yaml      # Production container topology
```

## License

Proprietary. Copyright (c) 2026 Viltrumlik. All rights reserved.

The source code is published for reference only. Using, copying, modifying, hosting or distributing it requires prior written permission. See [LICENSE](LICENSE).
