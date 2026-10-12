# lc-up Integration — Part 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link MasterSAT to the centre's lc-up CRM. Make lc-up the master for groups and membership, so our classes follow it automatically. Auto-create accounts for lc-up students who have none, let them claim those accounts with phone + last-4-digits, and give admins an `/ops/lcup` console to review the links.

**Architecture:** A new Django app `backend/lcup/` owns everything:
- a rate-limited client whose one token is shared through the cache;
- link tables;
- a sync orchestrator run by Celery beat every 15 minutes;
- a claim authentication backend;
- an admin API.

Our existing models (`Classroom`, `ClassroomMembership`, `User`) are written through their normal paths, so the existing signals (membership audit, rewards) keep firing. **No attendance is pushed in this part** — that is Part 2.

**Tech Stack:** Django 6 / DRF, Celery + beat (PM2 `sat-celery-worker`/`sat-celery-beat`), Django cache (Redis in prod via `REDIS_URL`), `requests`, Next.js App Router + TanStack Query.

**Spec:** none — the owner rejected a spec doc ("spec=code"). The design was approved section by section in chat on 2026-10-12. The decisions are recorded in the next section and are binding.

## Owner decisions (binding)

1. Teachers will mark attendance ONLY on our platform (Part 2 pushes it). Nothing in Part 1 writes to lc-up.
2. lc-up is the master for groups and membership; our classes follow it AUTOMATICALLY (adds and removals).
3. lc-up group members with no account on our side get an account AUTO-CREATED.
4. Existing accounts are auto-linked on an exact match; ambiguous ones go to an ADMIN REVIEW queue. **No account is auto-created until an admin marks the initial review done.**
5. Claim: login = phone, first password = last 4 digits of the phone. Lockout after 5 wrong tries; an unclaimed code expires after 14 days; the admin can reissue. After a code login the student must set a password, then complete the profile (the existing gate: names, username, verified email — "add your Gmail").
6. Balance and debt are Part 3 (admin + the student only). Not in Part 1.
7. lc-up `trial` and `frozen` members are ordinary members of our class.
8. lc-up group ↔ our class: an auto-suggested pairing that the admin confirms once. An lc-up group with no candidate gets a NEW class auto-created.
9. (Part 2) EXCUSED → absent + one of lc-up's reasons.
10. (Part 2) Attendance push goes live for all groups at once, behind a kill switch.

Teachers are auto-linked or reviewed, and **never auto-created**. Siblings who share a phone: the admin gives one of them a different phone.

## Global Constraints

- Branch `feat/lcup-foundation`, worktree `/Users/macbook/Projects/dsat-wt-lcup`. Commit after every task as **Viltrumlik <viltrumlik@gmail.com>**, then open a PR to `main`.
- `LCUP_ENABLED` defaults to `False`. With it off, the beat task, the claim backend and the roster guards are all no-ops.
- **`LcupClient` can POST only to `/api/dev/login`.** It has no generic `post()`. `POST /attendance` charges money and messages parents, and Part 1 must be unable to send it.
- Never log or return `LCUP_PASSWORD`, `LCUP_MOBILE` or the token. The token lives only in the cache key `lcup:token`.
- **Every lc-up login revokes the previous tokens.** Log in only on a missing token or a 401, under the cache lock `lcup:login-lock`.
- Limits: 60 req/min per user and 2 concurrent per centre. The client paces itself to 55 requests per minute and 2 concurrent requests. On 429 or 503 it honours `Retry-After` (capped at 60 s).
- lc-up times are naive `Y-m-d H:i:s` in Asia/Tashkent; `TIME_ZONE` is already Asia/Tashkent and `USE_TZ=True`. Parse them with `django.utils.timezone.make_aware`.
- **Never remove a student from a class on incomplete data.** A group whose member fetch failed is skipped entirely. Per class, removals above `max(3, 20% of active students)` are blocked; per run, removals above 15 in total are blocked. A blocked removal raises an alert on the sync run.
- The sync only ever touches `ClassroomMembership` rows with `role=STUDENT`. Staff rows are never touched. Our members not linked to any lc-up student are never removed.
- Tests run with: `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test lcup --settings=config.settings_test_nomigrations -v 1`. Only a literal `OK` counts as green.
- New migrations must also be applied to a throwaway local Postgres before the PR, because the SQLite suite never runs migration DDL.
- **Frontend API mappers whitelist fields.** Every new field read on the client must be added to its zod contract or mapper, or it is silently dropped.
- UI copy on `/ops` is English, matching the rest of the ops console. Wording is growth-oriented: never shame a student.

---

## File map

| Path | Responsibility |
|---|---|
| `backend/lcup/__init__.py`, `apps.py` | App config. `ready()` registers the profile requirement |
| `backend/lcup/conf.py` | `lcup_enabled()`, `credentials()` read from settings |
| `backend/lcup/phones.py` | `normalize_phone()`, `split_lcup_name()`, `name_tokens()` |
| `backend/lcup/client.py` | `LcupClient`: token, lock, pacing, retries, cursor paging |
| `backend/lcup/testing.py` | `FakeLcupClient` for tests (synthetic data) |
| `backend/lcup/models.py` | Link tables, `AccountClaim`, `LcupSyncRun`, `LcupState` |
| `backend/lcup/matching.py` | Teacher / student / group candidate scoring |
| `backend/lcup/accounts.py` | Create an account for an lc-up student + its claim |
| `backend/lcup/roster.py` | Apply lc-up membership to one class (with guards) |
| `backend/lcup/classrooms.py` | Auto-create a class for an unpaired lc-up group |
| `backend/lcup/sync.py` | `run_sync()` orchestrator |
| `backend/lcup/auth_backend.py` | `LcupClaimBackend` (phone + last-4 login) |
| `backend/lcup/claims.py` | Profile requirement `password`; set-initial-password service |
| `backend/lcup/guards.py` | `is_lcup_managed(classroom)`, `lcup_managed_response()` |
| `backend/lcup/tasks.py` | Celery `lcup.tasks.sync` |
| `backend/lcup/management/commands/lcup_sync.py` | `manage.py lcup_sync [--dry-run]` |
| `backend/lcup/serializers.py`, `views.py`, `urls.py` | Admin API under `/api/lcup/` + the claim-password endpoint |
| `backend/lcup/admin.py` | Read-only Django admin registrations |
| `backend/lcup/tests_*.py` | Tests per module |
| `backend/config/settings.py` | App, auth backend, `LCUP_*` env, beat entry |
| `backend/config/urls.py` | `path('api/lcup/', include('lcup.urls'))` |
| `backend/access/host_guard.py` | Allow `/api/lcup/` on the admin console |
| `backend/users/profile_completeness.py` | Requirement registry (`register_requirement`) |
| `backend/classes/views_roster.py`, `classes/views.py`, `classes/serializers.py` | Roster guards + `lcup_claim_pending` |
| `frontend/src/features/lcup/lcupApi.ts`, `lcupHooks.ts` | Client + hooks |
| `frontend/src/app/(ops)/ops/lcup/page.tsx` | 5-tab console |
| `frontend/src/app/(ops)/layout.tsx` | Nav entry |
| `frontend/src/components/ProfileCompletionGate.tsx` | `password` step |
| `frontend/src/app/login/page.tsx` | Hint for lc-up students |
| `frontend/src/lib/api.ts` (+ contract) | `lcup_claim_pending` on roster rows |

---

### Task 1: App skeleton, settings, phone utilities

**Files:**
- Create: `backend/lcup/__init__.py`, `backend/lcup/apps.py`, `backend/lcup/conf.py`, `backend/lcup/phones.py`, `backend/lcup/tests_phones.py`, `backend/lcup/migrations/__init__.py`
- Modify: `backend/config/settings.py` (INSTALLED_APPS after `'desktop.apps.DesktopConfig'`; LCUP env block next to the other feature flags)

**Interfaces — produces:**
- `lcup.conf.lcup_enabled() -> bool`
- `lcup.conf.credentials() -> dict` with keys `base_url`, `domain`, `mobile`, `password`
- `lcup.phones.normalize_phone(raw) -> str | None`, which returns `"998XXXXXXXXX"` or `None`
- `lcup.phones.split_lcup_name(full) -> tuple[str, str]`, which returns `(first_name, last_name)`
- `lcup.phones.name_tokens(full) -> frozenset[str]`

- [ ] **Step 1: Write the failing tests** in `backend/lcup/tests_phones.py`:

```python
from django.test import SimpleTestCase

from lcup.phones import name_tokens, normalize_phone, split_lcup_name


class NormalizePhoneTests(SimpleTestCase):
    def test_accepts_every_local_spelling(self):
        for raw in ("998901234567", "+998 90 123 45 67", "(90) 123-45-67", "901234567", " +998901234567 "):
            self.assertEqual(normalize_phone(raw), "998901234567", raw)

    def test_rejects_non_uzbek_or_short(self):
        for raw in (None, "", "12345", "79001234567", "9989012345678", "abc"):
            self.assertIsNone(normalize_phone(raw), raw)


class NameTests(SimpleTestCase):
    def test_lcup_order_is_last_then_first(self):
        self.assertEqual(split_lcup_name("Karimova Malika"), ("Malika", "Karimova"))
        self.assertEqual(split_lcup_name("Aliyev Vali Ali o'g'li"), ("Vali Ali o'g'li", "Aliyev"))
        self.assertEqual(split_lcup_name("  Madonna "), ("Madonna", ""))

    def test_tokens_ignore_case_and_apostrophe_variants(self):
        self.assertEqual(name_tokens("O‘g‘iloy  ALIYEVA"), name_tokens("o'g'iloy aliyeva"))
```

- [ ] **Step 2: Run** `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test lcup.tests_phones --settings=config.settings_test_nomigrations -v 1`. Expected: an ImportError (`No module named 'lcup'`).

- [ ] **Step 3: Implement.** `apps.py` (`ready()` is a no-op until Task 8 registers the profile requirement):

```python
from django.apps import AppConfig


class LcupConfig(AppConfig):
    name = "lcup"
    verbose_name = "lc-up CRM integration"
```

`conf.py`:

```python
from django.conf import settings


def lcup_enabled() -> bool:
    return bool(getattr(settings, "LCUP_ENABLED", False))


def credentials() -> dict:
    return {
        "base_url": (getattr(settings, "LCUP_BASE_URL", "") or "").rstrip("/"),
        "domain": getattr(settings, "LCUP_DOMAIN", "") or "",
        "mobile": getattr(settings, "LCUP_MOBILE", "") or "",
        "password": getattr(settings, "LCUP_PASSWORD", "") or "",
    }
```

`phones.py`:

```python
import re
import unicodedata

_NON_DIGIT = re.compile(r"\D+")
_APOSTROPHES = str.maketrans({"‘": "'", "’": "'", "ʻ": "'", "ʼ": "'", "`": "'"})


def normalize_phone(raw) -> str | None:
    digits = _NON_DIGIT.sub("", str(raw or ""))
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) == 12 and digits.startswith("998"):
        return digits
    return None


def _clean(full) -> str:
    return " ".join(unicodedata.normalize("NFKC", str(full or "")).translate(_APOSTROPHES).split())


def split_lcup_name(full) -> tuple[str, str]:
    """lc-up writes "Last First [Patronymic]"; ours stores first and last apart."""
    parts = _clean(full).split(" ")
    if len(parts) < 2:
        return (parts[0] if parts and parts[0] else "", "")
    return (" ".join(parts[1:]), parts[0])


def name_tokens(full) -> frozenset[str]:
    return frozenset(t.casefold() for t in _clean(full).split(" ") if t)
```

`settings.py`: add `'lcup.apps.LcupConfig',` to INSTALLED_APPS. Add the env block:

```python
# lc-up CRM integration (backend/lcup). Off by default: with it off, nothing calls lc-up, the
# claim login backend refuses everyone and the roster guards do not apply.
LCUP_ENABLED = os.getenv("LCUP_ENABLED", "false").strip().lower() in ("1", "true", "yes")
LCUP_BASE_URL = os.getenv("LCUP_BASE_URL", "https://master-sat.lc-up.com").strip()
LCUP_DOMAIN = os.getenv("LCUP_DOMAIN", "").strip()
LCUP_MOBILE = os.getenv("LCUP_MOBILE", "").strip()
LCUP_PASSWORD = os.getenv("LCUP_PASSWORD", "")
```

- [ ] **Step 4: Run the tests again.** Expected: `OK`.
- [ ] **Step 5: Commit** `feat(lcup): app skeleton, settings and phone/name normalisation`.

---

### Task 2: Models and migration

**Files:**
- Create: `backend/lcup/models.py`, `backend/lcup/migrations/0001_initial.py` (via makemigrations), `backend/lcup/admin.py`, `backend/lcup/tests_models.py`

**Interfaces — produces:**
- the models below, with their exact field names;
- `AccountClaim.can_attempt(now) -> bool`, `AccountClaim.record_failure(now) -> None`, `AccountClaim.record_success(now) -> None`;
- `LcupState.get() -> LcupState`;
- the enums `LinkStatus`, `GroupLinkStatus`.

- [ ] **Step 1: Write the failing tests** in `tests_models.py`:

```python
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from lcup.models import AccountClaim, LcupState
from users.models import User


class AccountClaimTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.user = User.objects.create_user(None, password=None, username="998901234567", role="student")
        self.claim = AccountClaim.objects.create(user=self.user, phone="998901234567", expires_at=self.now + timedelta(days=14))

    def test_fresh_claim_can_attempt(self):
        self.assertTrue(self.claim.can_attempt(self.now))

    def test_five_failures_lock(self):
        for _ in range(5):
            self.claim.record_failure(self.now)
        self.claim.refresh_from_db()
        self.assertIsNotNone(self.claim.locked_at)
        self.assertFalse(self.claim.can_attempt(self.now))

    def test_expired_or_finished_claim_cannot_attempt(self):
        self.assertFalse(self.claim.can_attempt(self.now + timedelta(days=15)))
        self.claim.password_set_at = self.now
        self.assertFalse(self.claim.can_attempt(self.now))


class LcupStateTests(TestCase):
    def test_singleton(self):
        self.assertEqual(LcupState.get().pk, LcupState.get().pk)
```

- [ ] **Step 2: Run.** Expected: ImportError.
- [ ] **Step 3: Implement** `models.py`:

```python
from django.conf import settings
from django.db import models, transaction
from django.db.models import F

MAX_CLAIM_FAILURES = 5


class LinkStatus(models.TextChoices):
    UNMATCHED = "unmatched", "Unmatched"
    AUTO = "auto", "Auto-linked"
    NEEDS_REVIEW = "needs_review", "Needs review"
    CONFIRMED = "confirmed", "Confirmed"
    CREATED = "created", "Account created"
    IGNORED = "ignored", "Ignored"


class GroupLinkStatus(models.TextChoices):
    SUGGESTED = "suggested", "Suggested"
    NEEDS_TEACHER = "needs_teacher", "Needs a linked teacher"
    CONFIRMED = "confirmed", "Confirmed"
    IGNORED = "ignored", "Ignored"


class LcupState(models.Model):
    initial_review_done_at = models.DateTimeField(null=True, blank=True)
    initial_review_done_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    @classmethod
    def get(cls) -> "LcupState":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class LcupFilialLink(models.Model):
    lcup_filial_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    branch = models.ForeignKey("classes.Branch", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_filials")
    last_seen_at = models.DateTimeField(null=True, blank=True)


class LcupTeacherLink(models.Model):
    lcup_teacher_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_teacher_link")
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)


class LcupStudentLink(models.Model):
    lcup_student_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True, default="", db_index=True)
    lcup_filial_id = models.PositiveIntegerField(null=True, blank=True)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_student_link")
    status = models.CharField(max_length=16, choices=LinkStatus.choices, default=LinkStatus.UNMATCHED, db_index=True)
    candidates = models.JSONField(default=list, blank=True)
    match_reason = models.CharField(max_length=200, blank=True, default="")
    deleted_in_lcup = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)


class LcupGroupLink(models.Model):
    lcup_group_id = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=200)
    snapshot = models.JSONField(default=dict, blank=True)
    classroom = models.OneToOneField("classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="lcup_group_link")
    status = models.CharField(max_length=16, choices=GroupLinkStatus.choices, default=GroupLinkStatus.SUGGESTED, db_index=True)
    suggestion = models.ForeignKey("classes.Classroom", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    suggestion_score = models.FloatField(default=0)
    suggestion_reasons = models.JSONField(default=list, blank=True)
    deleted_in_lcup_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)


class LcupMembership(models.Model):
    group = models.ForeignKey(LcupGroupLink, on_delete=models.CASCADE, related_name="memberships")
    student = models.ForeignKey(LcupStudentLink, on_delete=models.CASCADE, related_name="memberships")
    lcup_status = models.CharField(max_length=10)  # active | trial | frozen
    start_date = models.DateField(null=True, blank=True)
    joined_at = models.DateTimeField(null=True, blank=True)
    left_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["group", "student"], name="lcup_membership_unique")]


class AccountClaim(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="lcup_claim")
    phone = models.CharField(max_length=20, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_at = models.DateTimeField(null=True, blank=True)
    first_login_at = models.DateTimeField(null=True, blank=True)
    password_set_at = models.DateTimeField(null=True, blank=True)
    reissued_count = models.PositiveSmallIntegerField(default=0)

    def can_attempt(self, now) -> bool:
        return self.password_set_at is None and self.locked_at is None and self.expires_at > now

    def record_failure(self, now) -> None:
        with transaction.atomic():
            AccountClaim.objects.filter(pk=self.pk).update(failed_attempts=F("failed_attempts") + 1)
            self.refresh_from_db(fields=["failed_attempts"])
            if self.failed_attempts >= MAX_CLAIM_FAILURES and self.locked_at is None:
                self.locked_at = now
                self.save(update_fields=["locked_at"])

    def record_success(self, now) -> None:
        updates = {"failed_attempts": 0}
        if self.first_login_at is None:
            updates["first_login_at"] = now
        AccountClaim.objects.filter(pk=self.pk).update(**updates)
        for k, v in updates.items():
            setattr(self, k, v)


class LcupSyncRun(models.Model):
    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    dry_run = models.BooleanField(default=False)
    ok = models.BooleanField(default=False)
    counts = models.JSONField(default=dict, blank=True)
    errors = models.JSONField(default=list, blank=True)
    alerts = models.JSONField(default=list, blank=True)
```

`admin.py`: register every model read-only (`readonly_fields` = all fields, with a `list_display` of the key columns); the work happens in `/ops/lcup`. Generate the migration with `makemigrations lcup` (same env vars, default settings), then apply it to a throwaway Postgres (the `local-postgres-verify-orm-sql` recipe): `migrate lcup` must succeed.

- [ ] **Step 4: Run the tests.** Expected: `OK`.
- [ ] **Step 5: Commit** `feat(lcup): link tables, account claims, sync runs`.

---

### Task 3: lc-up client (shared token, pacing, retries, paging)

**Files:**
- Create: `backend/lcup/client.py`, `backend/lcup/testing.py`, `backend/lcup/tests_client.py`

**Interfaces — produces:**
- `LcupError(Exception)`, `LcupAuthError(LcupError)`, `LcupUnavailable(LcupError)`
- `LcupClient(*, base_url, domain, mobile, password, session=None, cache=None, sleep=time.sleep, clock=time.time)`
- `.get(path: str, params: dict | None = None) -> dict` (the JSON body)
- `.fetch_all(path: str, params: dict | None = None) -> list[dict]`, which follows `meta.next_cursor` and raises on ANY failure, so a partial list is never returned
- `lcup.client.default_client() -> LcupClient`, built from `conf.credentials()`
- `lcup.testing.FakeLcupClient(data: dict)`, with the same `.get`/`.fetch_all` API. Values are row lists, body dicts, or `Exception` instances to raise; `.calls` records every call.

- [ ] **Step 1: Write the failing tests.** Use a stub `session` whose `.request()` returns queued fake responses (`status_code`, `json()`, `headers`) and a fresh `LocMemCache`:
  1. The first `get()` logs in once (one POST to `/api/dev/login` with JSON `{mobile_number, password, domain}`), caches the token and sends `Authorization: Bearer <token>`.
  2. A second client sharing the cache does NOT log in again.
  3. On a 401 the client logs in again (under the lock) and retries the request once. A second consecutive 401 raises `LcupAuthError`.
  4. A login answering 422 raises `LcupAuthError` and caches no token.
  5. 429 with `Retry-After: 2` → `sleep(2)`, then it succeeds. Four 503s raise `LcupUnavailable`.
  6. `fetch_all` follows two cursors and concatenates the rows. An empty middle page with a `next_cursor` still continues. A failure on page 2 raises (no partial list).
  7. `self.assertFalse(hasattr(LcupClient, "post"))`.
  8. Pacing: with `clock` fixed inside one minute, the 56th request calls `sleep` until the next minute.

- [ ] **Step 2: Run** `... manage.py test lcup.tests_client ...`. Expected: ImportError.
- [ ] **Step 3: Implement** `client.py`:

```python
"""The only door to lc-up. Every login revokes the previous tokens of the integration user, so
the token is shared by every process through the cache and a login happens under a lock — only
when there is no token, or the one we sent was refused."""
from __future__ import annotations

import time

import requests
from django.core.cache import cache as default_cache

from . import conf

TOKEN_KEY = "lcup:token"
LOCK_KEY = "lcup:login-lock"
RPM_KEY = "lcup:rpm:{minute}"
SLOT_KEYS = ("lcup:slot:0", "lcup:slot:1")
REQUESTS_PER_MINUTE = 55
TIMEOUT = (5, 20)
MAX_RETRIES = 3
MAX_RETRY_AFTER = 60


class LcupError(Exception):
    pass


class LcupAuthError(LcupError):
    pass


class LcupUnavailable(LcupError):
    pass


class LcupClient:
    def __init__(self, *, base_url, domain, mobile, password, session=None, cache=None, sleep=time.sleep, clock=time.time):
        self.base_url = base_url.rstrip("/")
        self._creds = {"mobile_number": mobile, "password": password, "domain": domain}
        self.session = session or requests.Session()
        self.cache = cache or default_cache
        self.sleep = sleep
        self.clock = clock

    def get(self, path: str, params: dict | None = None) -> dict:
        token = self._token()
        for attempt in range(MAX_RETRIES + 1):
            resp = self._send("GET", path, params=params, token=token)
            if resp.status_code == 401:
                if attempt:
                    raise LcupAuthError("lc-up refused a fresh token")
                token = self._token(stale=token)
                continue
            if resp.status_code in (409, 429, 503) or resp.status_code >= 500:
                if attempt == MAX_RETRIES:
                    raise LcupUnavailable(f"lc-up {resp.status_code} on {path}")
                retry_after = resp.headers.get("Retry-After")
                self.sleep(min(int(retry_after), MAX_RETRY_AFTER) if retry_after else 2 ** attempt)
                continue
            if resp.status_code >= 400:
                raise LcupError(f"lc-up {resp.status_code} on {path}")
            return resp.json()
        raise LcupUnavailable(f"lc-up gave up on {path}")

    def fetch_all(self, path: str, params: dict | None = None) -> list[dict]:
        params = dict(params or {}, per_page=200)
        rows: list[dict] = []
        while True:
            body = self.get(path, params)
            rows.extend(body.get("data") or [])
            cursor = (body.get("meta") or {}).get("next_cursor")
            if not cursor:
                return rows
            params["cursor"] = cursor

    def _token(self, stale: str | None = None) -> str:
        token = self.cache.get(TOKEN_KEY)
        if token and token != stale:
            return token
        if self.cache.add(LOCK_KEY, "1", timeout=30):
            try:
                token = self.cache.get(TOKEN_KEY)
                if token and token != stale:
                    return token
                token = self._login()
                self.cache.set(TOKEN_KEY, token, timeout=None)
                return token
            finally:
                self.cache.delete(LOCK_KEY)
        for _ in range(30):
            self.sleep(1)
            token = self.cache.get(TOKEN_KEY)
            if token and token != stale:
                return token
        raise LcupUnavailable("timed out waiting for another process to log in to lc-up")

    def _login(self) -> str:
        resp = self._send("POST", "/api/dev/login", json=self._creds, token=None)
        if resp.status_code != 200:
            self.cache.delete(TOKEN_KEY)
            raise LcupAuthError(f"lc-up login refused ({resp.status_code})")
        token = ((resp.json() or {}).get("data") or {}).get("access_token")
        if not isinstance(token, str) or not token:
            raise LcupAuthError("lc-up login returned no access_token")
        return token

    def _send(self, method, path, *, params=None, json=None, token):
        self._pace()
        slot = self._acquire_slot()
        try:
            headers = {"Accept": "application/json"}
            if token:
                headers["Authorization"] = f"Bearer {token}"
            try:
                return self.session.request(method, self.base_url + path, params=params, json=json, headers=headers, timeout=TIMEOUT)
            except requests.RequestException as exc:
                raise LcupUnavailable(f"lc-up unreachable: {type(exc).__name__}") from None
        finally:
            self.cache.delete(slot)

    def _pace(self) -> None:
        now = self.clock()
        minute = int(now // 60)
        key = RPM_KEY.format(minute=minute)
        self.cache.add(key, 0, timeout=120)
        try:
            count = self.cache.incr(key)
        except ValueError:
            self.cache.set(key, 1, timeout=120)
            count = 1
        if count > REQUESTS_PER_MINUTE:
            self.sleep((minute + 1) * 60 - now + 0.05)

    def _acquire_slot(self) -> str:
        for _ in range(240):
            for key in SLOT_KEYS:
                if self.cache.add(key, "1", timeout=30):
                    return key
            self.sleep(0.25)
        raise LcupUnavailable("no free lc-up request slot")


def default_client() -> LcupClient:
    return LcupClient(**conf.credentials())
```

`testing.py`:

```python
class FakeLcupClient:
    """Answers from a dict keyed by path. A value may be a list (fetch_all rows), a dict (get body)
    or an Exception instance (raised). Records every call in .calls."""

    def __init__(self, data):
        self.data = data
        self.calls = []

    def _lookup(self, path, params):
        self.calls.append((path, dict(params or {})))
        value = self.data.get(path, [])
        if isinstance(value, Exception):
            raise value
        return value

    def get(self, path, params=None):
        value = self._lookup(path, params)
        return value if isinstance(value, dict) else {"success": True, "data": value}

    def fetch_all(self, path, params=None):
        value = self._lookup(path, params)
        return list(value.get("data", [])) if isinstance(value, dict) else list(value)
```

- [ ] **Step 4: Run.** Expected: `OK`.
- [ ] **Step 5: Commit** `feat(lcup): shared-token client with pacing, retries and cursor paging`.

---

### Task 4: Matching (teachers, students, groups)

**Files:**
- Create: `backend/lcup/matching.py`, `backend/lcup/tests_matching.py`

**Interfaces — produces:**
- `MatchResult` dataclass: `user_id: int | None`, `status: str` (a `LinkStatus` value), `reason: str`, `candidates: list[dict]` (`{"user_id", "name", "reason"}`)
- `match_teacher(link) -> MatchResult`
- `match_student(link, *, shared_phones: set[str], class_user_ids: set[int]) -> MatchResult`. `class_user_ids` are the student ids in our classes paired to this student's lc-up groups.
- `GroupSuggestion` dataclass: `classroom_id: int | None`, `score: float`, `reasons: list[str]`
- `suggest_classroom(snapshot: dict, *, teacher_user_ids: set[int], branch_id: int | None, taken_classroom_ids: set[int]) -> GroupSuggestion`
- `subject_from(snapshot) -> str | None`, `level_from(snapshot) -> str`, `days_from(snapshot) -> str | None` (also used by Task 5)
- `SUGGEST_THRESHOLD = 8`

**Rules (these are what the tests assert):**
- **Teacher:**
  - exactly one user with a role in `access.constants.TEACHER_PORTAL_ROLES` whose normalised `phone_number` equals the link phone → `AUTO`, reason `"phone"`;
  - else exactly one such user whose `name_tokens(first + last)` equals `name_tokens(link.name)` → `NEEDS_REVIEW`, `"name only"`;
  - else `UNMATCHED`, `"no match"`.
- **Student:**
  - the phone is in `shared_phones` → `NEEDS_REVIEW`, `"phone shared by siblings in lc-up"` (the phone owner as candidate if any);
  - one `role="student"` user with that phone and ≥1 common name token → `AUTO`, `"phone + name"`;
  - one with that phone and no common token → `NEEDS_REVIEW`, `"phone matches, name differs"`;
  - otherwise, exactly one user in `class_user_ids` with ≥2 common tokens (or equal token sets) → `NEEDS_REVIEW`, `"name in paired class"`;
  - else `UNMATCHED`, `"no match"`.
  - Users already linked to another lc-up student (`lcup_student_link__isnull=False`) are never candidates. Phone lookup: `phone_number__endswith=phone[-9:]`, then `normalize_phone(u.phone_number) == phone` in Python.
- **Group score** (max 14; skip `taken_classroom_ids` and `is_active=False`):

  | Signal | Points |
  |---|---|
  | subject from the course name (`"math"`→`MATH`, `"english"`→`ENGLISH`) equals `subject` | 3 |
  | level token (`foundation`/`junior`/`middle`/`senior`) found in course or group name equals `level` | 3 |
  | `days` `[1,3,5]`→`ODD`, `[2,4,6]`→`EVEN` equals `lesson_days` | 2 |
  | `start_time[:5]` in `lesson_time` | 1 |
  | `teacher_id` in `teacher_user_ids` | 2 |
  | `branch_id` equal | 1 |
  | group number token (regex `\bG\d+\b`, casefolded) in the classroom name | 2 |

  The best score ≥ `SUGGEST_THRESHOLD` → that classroom; else `classroom_id=None`. Reasons are short strings such as `"subject"`, `"level"`, `"days"`, `"time"`, `"teacher"`, `"branch"`, `"number G21"`.

- [ ] **Step 1: Tests**, one per bullet above. Build users with `User.objects.create_user(None, password=None, username=..., role=..., phone_number=..., first_name=..., last_name=...)` and classrooms with `Classroom.objects.create(name=..., subject=..., level=..., lesson_days=..., lesson_time="18:00", created_by=t, teacher=t)`. Assert `status`, `user_id`/`classroom_id` and the `reason` exactly.
- [ ] **Steps 2–4:** run → ImportError; implement; run → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): candidate matching for teachers, students and groups`.

---

### Task 5: Account creation + class auto-creation

**Files:**
- Create: `backend/lcup/accounts.py`, `backend/lcup/classrooms.py`, `backend/lcup/tests_accounts.py`

**Interfaces — produces:**
- `CLAIM_DAYS = 14`
- `create_account_for(link: LcupStudentLink, *, now, phone_override: str | None = None) -> User | None`
- `reissue_claim(claim: AccountClaim, *, now) -> AccountClaim`
- `create_classroom_for(link: LcupGroupLink, *, teacher_users: list[User], branch) -> Classroom`

**Rules:**
- **`create_account_for`:**
  - phone = `normalize_phone(phone_override or link.phone)`. Missing → link `NEEDS_REVIEW`, `"no phone in lc-up"`, return `None`.
  - In `transaction.atomic()`: `User.objects.create_user(None, password=None, username=phone, phone_number=phone, first_name=…, last_name=… (from split_lcup_name), role="student")`, then `user.set_unusable_password(); user.save(update_fields=["password"])`, then `AccountClaim.objects.create(user=user, phone=phone, expires_at=now + timedelta(days=CLAIM_DAYS))`. The link becomes `user=user`, `status=CREATED`, `match_reason="account created"`.
  - An `IntegrityError` (username or phone taken) → link `NEEDS_REVIEW`, `"phone already used by another account"`, return `None`.
- **`reissue_claim`:** `failed_attempts=0`, `locked_at=None`, `expires_at=now+14d`, `reissued_count += 1`.
- **`create_classroom_for`:**
  - `Classroom(name=link.name[:120], subject=subject_from(snapshot), level=level_from(snapshot), lesson_days=days_from(snapshot), lesson_time=(snapshot.get("start_time") or "")[:5], branch=branch, created_by=teacher_users[0], teacher=teacher_users[0])`.
  - Then memberships mirroring how the normal class-create path adds its creator. **Read `ClassroomViewSet.perform_create` (or the create serializer) first:** if it adds `OWNER`/`ADMIN` for the creator, add the same for `teacher_users[0]`, and `TEACHER` for the rest.
  - The link becomes `classroom=…`, `status=CONFIRMED`. Raises `ValueError` when `subject_from` or `days_from` is None (the caller marks the link and alerts).

- [ ] **Step 1: Tests:**
  - an account is created with the right username, names, role and an unusable password, and a claim with a 14-day expiry;
  - a phone already on another user → `None` + `NEEDS_REVIEW`;
  - no phone → `None` + `NEEDS_REVIEW` (`"no phone in lc-up"`);
  - `phone_override` is used;
  - `reissue_claim` unlocks and extends;
  - `create_classroom_for` builds `MATH`/`junior`/`ODD`/`"18:00"` from `{"course": {"name": "Junior Math"}, "days": [1,3,5], "start_time": "18:00:00", "name": "Junior G21 | Math | Abdulaziz"}`, and `classroom_capabilities(teacher, classroom)` lets the teacher manage the roster.
- [ ] **Steps 2–4:** run → fail; implement; run → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): auto-created student accounts with claims, and classes for unpaired groups`.

---

### Task 6: Roster application with guards

**Files:**
- Create: `backend/lcup/roster.py`, `backend/lcup/tests_roster.py`

**Interfaces — produces:**
- `RosterPlan` dataclass: `to_add: set[int]`, `to_reactivate: set[int]`, `to_remove: set[int]`, `blocked_removals: bool`
- `plan_group(link: LcupGroupLink) -> RosterPlan`
- `apply_plan(link: LcupGroupLink, plan: RosterPlan, *, allow_removals: bool) -> dict`, returning `{"added": n, "reactivated": n, "removed": n}`
- `MAX_REMOVALS_PER_RUN = 15`, `per_class_removal_cap(active_count: int) -> int`, which returns `max(3, int(active_count * 0.2))`

**Rules:**
- **desired** = `{m.student.user_id for m in link.memberships.select_related("student") if m.left_at is None and m.student.user_id}` (trial and frozen included).
- **rows** = `ClassroomMembership.objects.filter(classroom=link.classroom, user_id__in=desired | current)`.
- `to_add` = desired users with no row. `to_reactivate` = desired users whose row is `REMOVED` or `INVITED`, with `role=STUDENT`. A desired user whose row has a staff role is skipped.
- **current** = user ids of `role=STUDENT, status=ACTIVE` rows.
- `to_remove` = current users that have a `lcup_student_link` and are not in desired. Unlinked users are never removed.
- `blocked_removals` is True when `len(to_remove) > per_class_removal_cap(len(current))`.
- Writes go through `ClassroomMembership.save()` / `.objects.create()` (never `.update()`), so `classes/membership_hooks.py` records them.

- [ ] **Step 1: Tests:**
  - add a new student; reactivate a removed one;
  - remove a linked student who left lc-up;
  - KEEP an unlinked member;
  - never touch a TEACHER row;
  - a trial or frozen member is added;
  - 4 linked removals out of 10 active → `blocked_removals` (cap 3);
  - `apply_plan(..., allow_removals=False)` removes nobody but still adds;
  - an add writes the membership audit row. Read `membership_hooks._write` for the model name and assert its row exists.
- [ ] **Steps 2–4:** run → fail; implement; run → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): apply lc-up membership to paired classes with removal guards`.

---

### Task 7: Sync orchestrator, Celery task, management command

**Files:**
- Create: `backend/lcup/sync.py`, `backend/lcup/tasks.py`, `backend/lcup/management/__init__.py`, `backend/lcup/management/commands/__init__.py`, `backend/lcup/management/commands/lcup_sync.py`, `backend/lcup/tests_sync.py`
- Modify: `backend/config/settings.py` (`CELERY_BEAT_SCHEDULE`)

**Interfaces — produces:**
- `run_sync(client, *, dry_run: bool = False, now=None) -> LcupSyncRun`
- the Celery task `lcup.tasks.sync`, which returns `run.counts`, `{"skipped": "disabled"}` or `{"skipped": "already running"}`
- `manage.py lcup_sync [--dry-run]`, which prints the counts, alerts and errors as JSON

**Order inside `run_sync`.** Each stage has its own `try`. A failure appends `{"stage": name, "error": f"{type(e).__name__}: {e}"}` to `errors`, and later stages that need its output are skipped:
1. `client.get("/api/external/v1/filials")["data"]` → upsert `LcupFilialLink`. If the link has no branch and exactly one `Branch` has `name__iexact`, set it.
2. `client.fetch_all("/api/external/v1/teachers")` → upsert `name`, `phone=normalize_phone(...) or ""`, `last_seen_at`. Run `match_teacher` for links not in `CONFIRMED`/`IGNORED` and save the result.
3. `client.fetch_all("/api/external/v1/groups", {"include_deleted": "true"})` → upsert `name`, `snapshot=row`, `last_seen_at`.
   - If `row["deleted_at"]` → set `deleted_in_lcup_at` (if empty) and add the alert `f"lc-up group deleted: {name}"`. The class is untouched.
   - If the link has no classroom and status is `SUGGESTED`/`NEEDS_TEACHER`: `teacher_users` = users linked to `row["teachers"][*].id`; `branch` = the filial link's branch for `row["filial_id"]`; run `suggest_classroom(...)`.
     - A suggestion → set `suggestion`, `suggestion_score`, `suggestion_reasons`, status `SUGGESTED`.
     - No suggestion and `teacher_users` → `create_classroom_for` (alert `f"class created for lc-up group {name}"`).
     - No suggestion and no teacher → `NEEDS_TEACHER`.
4. `client.fetch_all("/api/external/v1/students")` → upsert `name`, `phone`, `lcup_filial_id`, `last_seen_at`.
5. For each group link that is not `IGNORED` and has no `deleted_in_lcup_at`: `client.get(f"/api/external/v1/groups/{lcup_group_id}/students", {"include_left": "true"})["data"]` → upsert `LcupMembership(group, student)`. Create the student link if missing, from the row's `student_id`, `name` and `phone`. Set `lcup_status`, `start_date`, `joined_at`, and `left_at` (`parse_datetime` + `make_aware`). On exception, add the group id to `skipped_groups` and record the error.
6. `shared_phones` = phones on ≥2 student links. For student links in ≥1 live membership whose status is not in `CONFIRMED`/`IGNORED`/`CREATED`/`AUTO`: `class_user_ids` = active STUDENT member ids of the confirmed classrooms of that student's groups; run `match_student` and save.
7. If `LcupState.get().initial_review_done_at`: `create_account_for(link, now=now)` for every `UNMATCHED` student link with ≥1 live membership.
8. Plans = `{link: plan_group(link)}` for `CONFIRMED` group links with a classroom, not in `skipped_groups`.
   - `total = sum(len(p.to_remove) for p in plans if not p.blocked_removals)`. If `total > MAX_REMOVALS_PER_RUN`, set `allow = False` for all and alert `f"removals held: {total} > 15"`.
   - A per-class `blocked_removals` → alert `f"removals held for {classroom.name}: {n}"`.
   - Apply each plan and sum the counts.
9. Save the counts (`teachers`, `students`, `groups`, `auto_linked`, `needs_review`, `accounts_created`, `added`, `reactivated`, `removed`, `removals_held`), the errors and alerts, `ok = not errors` and `finished_at`.

`dry_run=True`: compute everything inside `with transaction.atomic(): ...; transaction.set_rollback(True)`, then create the `LcupSyncRun(dry_run=True, …)` row AFTER the block, from the collected counts, alerts and errors.

**`tasks.py`:**

```python
import logging

from celery import shared_task
from django.core.cache import cache

from .client import LcupAuthError, default_client
from .conf import lcup_enabled
from .sync import run_sync

log = logging.getLogger("lcup")


@shared_task(name="lcup.tasks.sync")
def sync() -> dict:
    if not lcup_enabled():
        return {"skipped": "disabled"}
    if not cache.add("lcup:sync-running", "1", timeout=14 * 60):
        return {"skipped": "already running"}
    try:
        try:
            run = run_sync(default_client())
        except LcupAuthError:
            log.error("lc-up login refused; sync stopped")
            raise
        return run.counts
    finally:
        cache.delete("lcup:sync-running")
```

(Read `config/ops_alerting.py`. If it exposes a callable that sends an ops message, call it next to `log.error`. If not, the log line plus the run row is enough.)

**Beat entry**, appended to `CELERY_BEAT_SCHEDULE`:

```python
    # lc-up: groups, members and accounts follow the centre's CRM (backend/lcup). The task returns
    # at once while LCUP_ENABLED is off.
    "lcup-sync": {
        "task": "lcup.tasks.sync",
        "schedule": crontab(minute="*/15"),
    },
```

- [ ] **Step 1: Tests**, with `FakeLcupClient` holding synthetic data — 2 teachers, 3 groups (one deleted), 5 students (two sharing a phone), and memberships:
  - a full run creates links and statuses as expected;
  - a deleted group alerts and keeps its class;
  - a member fetch raising `LcupUnavailable("x")` for one group leaves that class untouched, and the run has `ok=False`;
  - no accounts are created before the review is done, and they are after `initial_review_done_at` is set;
  - the run-wide removal cap holds every removal;
  - a dry run writes no links or memberships, but its `LcupSyncRun` row has counts;
  - `sync()` under `override_settings(LCUP_ENABLED=False)` returns `{"skipped": "disabled"}`;
  - `call_command("lcup_sync", "--dry-run")` prints JSON (patch `default_client` to return the fake).
- [ ] **Steps 2–4:** run → fail; implement; run → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): sync orchestrator, beat task and lcup_sync command`.

---

### Task 8: Claim login + the password step (backend)

**Files:**
- Create: `backend/lcup/auth_backend.py`, `backend/lcup/claims.py`, `backend/lcup/tests_claim.py`
- Modify: `backend/users/profile_completeness.py`, `backend/lcup/apps.py` (`ready()`), `backend/config/settings.py` (append `'lcup.auth_backend.LcupClaimBackend'` LAST in `AUTHENTICATION_BACKENDS`)

**Interfaces — produces:**
- `users.profile_completeness.register_requirement(fn) -> fn`. `missing_profile_fields` puts registered fields FIRST, in registration order, without duplicates.
- `lcup.claims.password_requirement(user) -> list[str]`, which returns `["password"]` iff `not user.has_usable_password()` and an `AccountClaim` with `password_set_at IS NULL` exists for the user. It does no query when the password is usable.
- `lcup.claims.set_initial_password(user, raw_password, *, now) -> None`. It runs `validate_password(raw_password, user)`, then `set_password`, saves, and sets `claim.password_set_at = now`. It raises `ValidationError` on a weak password and `PermissionError` when there is no open claim (missing, or a password already set).
- `LcupClaimBackend.authenticate(request, username=None, password=None, **kw) -> User | None`

**`profile_completeness.py` change.** Keep the existing rule exactly; add:

```python
#: Extra requirements other apps contribute (lc-up adds "password" for an account it created
#: that has not chosen one yet). Each returns field names; they are asked FIRST.
_EXTRA_REQUIREMENTS: list = []


def register_requirement(fn):
    if fn not in _EXTRA_REQUIREMENTS:
        _EXTRA_REQUIREMENTS.append(fn)
    return fn
```

At the end of `missing_profile_fields` (only for a non-None user):

```python
    extra: list[str] = []
    for fn in _EXTRA_REQUIREMENTS:
        for field in fn(user):
            if field not in extra and field not in missing:
                extra.append(field)
    return extra + missing
```

**`apps.py`:**

```python
    def ready(self):
        from users.profile_completeness import register_requirement

        from .claims import password_requirement

        register_requirement(password_requirement)
```

**`auth_backend.py`:**

```python
import hmac

from django.contrib.auth.backends import BaseBackend
from django.utils import timezone

from users.models import SecurityAuditEvent, User

from .conf import lcup_enabled
from .models import AccountClaim
from .phones import normalize_phone


def _audit(user, event_type, request, **detail):
    try:
        SecurityAuditEvent.objects.create(
            user=user,
            event_type=event_type,
            ip=(request.META.get("REMOTE_ADDR", "") if request else "")[:64],
            user_agent=(request.META.get("HTTP_USER_AGENT", "") if request else "")[:512],
            detail=detail,
        )
    except Exception:
        pass  # an audit failure must never decide a sign-in


class LcupClaimBackend(BaseBackend):
    """First sign-in for an account the lc-up sync created: login = phone, password = its last
    four digits — only while the claim is open (no password chosen, not locked, not expired)."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        if not lcup_enabled() or not password:
            return None
        phone = normalize_phone(username or kwargs.get(User.USERNAME_FIELD))
        if not phone:
            return None
        claim = AccountClaim.objects.select_related("user").filter(phone=phone).first()
        now = timezone.now()
        if claim is None or not claim.can_attempt(now):
            return None
        user = claim.user
        if not user.is_active or user.has_usable_password():
            return None
        if hmac.compare_digest(str(password), phone[-4:]):
            claim.record_success(now)
            _audit(user, "lcup_claim_login", request)
            return user
        claim.record_failure(now)
        _audit(user, "lcup_claim_failed", request, attempts=claim.failed_attempts)
        return None

    def get_user(self, user_id):
        return User.objects.filter(pk=user_id, is_active=True).first()
```

(Check `SecurityAuditEvent`'s required fields and severity default when implementing. Pass `severity` explicitly if the model has no default.)

- [ ] **Step 1: Tests** (read the existing login test first for the exact payload keys sent to `/api/auth/login/`):
  - phone + last 4 → 200 for a claimed account; `"+998 90 123 45 67"` works too;
  - the wrong code ×5 → the right code then fails;
  - an expired claim fails;
  - after `set_initial_password`, the last-4 code fails and the new password works;
  - a user with a usable password is never let in by this backend;
  - `override_settings(LCUP_ENABLED=False)` → refused;
  - `GET /api/users/me/` → `missing_fields[0] == "password"` for the claimed user, and `"password"` is absent after `set_initial_password`;
  - a regular user's `missing_fields` is unchanged.
- [ ] **Steps 2–4:** run → fail; implement; run `lcup` plus the module holding the profile-completeness tests (`grep -rl missing_profile_fields backend/users`) → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): claim sign-in with phone + last four digits; password as a profile requirement`.

---

### Task 9: Roster guards + `lcup_claim_pending`

**Files:**
- Create: `backend/lcup/guards.py`, `backend/lcup/tests_guards.py`
- Modify:
  - `backend/classes/views_roster.py`: `MemberManageView.patch` — when `membership.role == ROLE_STUDENT` and `new_status is not None`; `ClassroomRosterView.post`; `ClassroomRosterView.get` passes the context `lcup_pending_user_ids`;
  - `backend/classes/views.py`: `JoinClassView.post`, right after the classroom is resolved;
  - `backend/classes/serializers.py`: `ClassroomMembershipSerializer` gets `lcup_claim_pending = serializers.SerializerMethodField()` plus `"lcup_claim_pending"` in `fields`.

**Interfaces — produces:**

```python
from rest_framework import status
from rest_framework.response import Response

from .conf import lcup_enabled
from .models import AccountClaim, GroupLinkStatus, LcupGroupLink


def is_lcup_managed(classroom) -> bool:
    if not lcup_enabled() or classroom is None:
        return False
    return LcupGroupLink.objects.filter(classroom=classroom, status=GroupLinkStatus.CONFIRMED).exists()


def lcup_managed_response() -> Response:
    return Response(
        {"detail": "This class's students come from lc-up. Add or remove students there.", "code": "lcup_managed"},
        status=status.HTTP_409_CONFLICT,
    )


def pending_claim_user_ids(user_ids) -> set[int]:
    return set(
        AccountClaim.objects.filter(user_id__in=list(user_ids), password_set_at__isnull=True).values_list("user_id", flat=True)
    )
```

Serializer method: `return obj.user_id in self.context.get("lcup_pending_user_ids", ())`. Import `lcup.guards` lazily inside the views (local import), so `classes` gets no import-time dependency on `lcup`.

- [ ] **Step 1: Tests:**
  - for a managed class: PATCH removing a student → 409 `lcup_managed`;
  - PATCH promoting a student to TA → allowed as before;
  - POST adding a student → 409; joining by code → 409;
  - for an unmanaged class all three behave as before;
  - `LCUP_ENABLED=False` → nothing is blocked;
  - the roster GET row has `lcup_claim_pending: true` for an unclaimed auto account and `false` otherwise.
- [ ] **Steps 2–4:** run → fail; implement; run `lcup` plus the roster test module (`grep -rl "members/" backend/classes/tests*`) → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): lock student roster edits on lc-up-managed classes; flag unclaimed accounts`.

---

### Task 10: Admin API `/api/lcup/` + host guard

**Files:**
- Create: `backend/lcup/serializers.py`, `backend/lcup/views.py`, `backend/lcup/urls.py`, `backend/lcup/tests_views.py`
- Modify:
  - `backend/config/urls.py`: after `api/desktop/`, add `path('api/lcup/', include('lcup.urls')),`;
  - `backend/access/host_guard.py`: in the `kind == "admin"` block, after `/api/desktop/exemptions/`, add:

```python
            # lc-up CRM integration: pairing, review queues and sync are run from /ops/lcup.
            if path.startswith("/api/lcup/"):
                return self.get_response(request)
```

**Permission:** `class IsGlobalAdmin(BasePermission): has_permission = lambda self, request, view: bool(request.user and request.user.is_authenticated and is_global_admin(request.user))`, using `classes.capabilities.is_global_admin`.

**Endpoints:**

| Method | Path | Does |
|---|---|---|
| GET | `/api/lcup/status/` | `{enabled, initial_review_done_at, last_run, recent_runs[5], counts: {needs_review_students, needs_review_teachers, groups_pending, unclaimed_accounts}}` |
| POST | `/api/lcup/sync/` | `lcup.tasks.sync.delay()` → 202 `{queued: true}`. With `?dry_run=1`: `run_sync(default_client(), dry_run=True)` inline → 200 with the run |
| GET | `/api/lcup/groups/` | Group links: name, course, days, start/finish, teachers (from the snapshot), status, `classroom {id,name}`, `suggestion {id,name,score,reasons}`, `deleted` |
| POST | `/api/lcup/groups/<id>/confirm/` `{classroom_id}` | Pairs and confirms. 400 if the classroom is paired elsewhere |
| POST | `/api/lcup/groups/<id>/create-class/` | `create_classroom_for` with linked teachers. 400 if none |
| POST | `/api/lcup/groups/<id>/ignore/` | Status IGNORED |
| GET | `/api/lcup/students/?status=needs_review\|unmatched\|all` | Links: name, phone, group names, candidates, reason, `user {id,name,username}` |
| POST | `/api/lcup/students/<id>/link/` `{user_id}` | Status CONFIRMED. 400 if the user is linked elsewhere |
| POST | `/api/lcup/students/<id>/create-account/` `{phone?}` | `create_account_for(..., phone_override=phone)` |
| POST | `/api/lcup/students/<id>/ignore/` | Status IGNORED |
| GET | `/api/lcup/teachers/` | Same as students |
| POST | `/api/lcup/teachers/<id>/link/`, `/ignore/` | Same as students |
| GET | `/api/lcup/unlinked-members/` | Our STUDENT members of confirmed classes with no `lcup_student_link`: `{classroom, user}` |
| POST | `/api/lcup/review-done/` | Sets `initial_review_done_at` and `_by`. 400 while a student link in a live group is `NEEDS_REVIEW` |
| GET | `/api/lcup/accounts/` | Claims: `state` = `locked` / `expired` / `done` (password set) / `signed_in` (first login, no password) / `pending` |
| POST | `/api/lcup/accounts/<user_id>/reissue/` | `reissue_claim` |
| POST | `/api/lcup/claim/password/` `{password}` | **IsAuthenticated**: `set_initial_password` → 204; 400 with the validator messages; 403 with no open claim |

- [ ] **Step 1: Tests:**
  - every admin endpoint → 403 for a teacher, 200/202 for an admin;
  - confirm, link, create-account and ignore change state as described;
  - `review-done` → 400 while a review item is pending;
  - `claim/password` sets the password (204) and refuses a second call (403);
  - a host-guard test: `HTTP_HOST=admin.<domain>` + `GET /api/lcup/status/` is not refused by the middleware. Mirror an existing host-guard test (`grep -rl SubdomainAPIGuardMiddleware backend/access`).
- [ ] **Steps 2–4:** run → fail; implement; run `lcup access` → `OK`.
- [ ] **Step 5: Commit** `feat(lcup): admin API for pairing, review, accounts and sync`.

---

### Task 11: Frontend — `/ops/lcup` console

**Files:**
- Create: `frontend/src/features/lcup/lcupApi.ts`, `frontend/src/features/lcup/lcupHooks.ts`, `frontend/src/app/(ops)/ops/lcup/page.tsx`, `frontend/src/features/lcup/__tests__/lcupApi.test.ts`
- Modify: `frontend/src/app/(ops)/layout.tsx` — a nav item with a short comment, as its neighbours have: `{ href: "/ops/lcup", label: "lc-up", icon: RefreshCw, exact: false }` (import `RefreshCw` from `lucide-react`)

**Patterns to copy:**
- `features/org/orgApi.ts`: `import api from "@/lib/api"`; typed functions returning `r.data`.
- `features/org/orgHooks.ts`: `useQuery`/`useMutation`; `invalidateQueries({ queryKey: ["lcup"] })` on success.
- Page shell from `app/(ops)/ops/branches/page.tsx`: `OpsPageHeader`, and `Alert`, `Badge`, `Button`, `Input`, `Select` from `@/components/ui`.

**Tabs:**
1. **Status:**
   - an "Enabled"/"Off" badge; last run time, ok/error and the counts;
   - the alerts list;
   - "Sync now" and "Dry run" (which shows the returned counts);
   - "Mark initial review done", disabled while `needs_review_students > 0`, behind a confirm dialog.
2. **Groups:** a row per group with name, course, days, time, teachers and status. Per row:
   - a suggestion score chip and reason badges;
   - actions Confirm (the suggestion, or a `Select` from `useOrgClassrooms()`), Create class, Ignore;
   - deleted groups get a warning badge.
3. **Students:** a filter `needs_review` (default) / `unmatched` / `all`. Per row:
   - lc-up name, phone, groups and reason;
   - each candidate with a "Link" button; "Create account" with an optional phone input (siblings); "Ignore".
   - Below, a section "Members not in lc-up".
4. **Teachers:** as Students, without "Create account".
5. **Accounts:** state badge, phone, expiry; "Reissue" on expired or locked rows.

A failed query renders an `Alert` with a Retry button. It never renders the empty state.

- [ ] **Step 1: Test.** In `lcupApi.test.ts`, copy the mocking pattern of an existing `__tests__` API test:
  - `lcupApi.status()` GETs `/lcup/status/`;
  - `lcupApi.confirmGroup(5, 9)` POSTs `{ classroom_id: 9 }` to `/lcup/groups/5/confirm/`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/features/lcup` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Check:**
  - vitest → pass;
  - `npx tsc --noEmit -p .` → no NEW errors versus `main`'s count (tsc can be falsely green: compare the counts);
  - `npx eslint src/features/lcup "src/app/(ops)/ops/lcup"` → clean.
- [ ] **Step 5: Commit** `feat(lcup): /ops/lcup console — status, groups, students, teachers, accounts`.

---

### Task 12: Frontend — claim experience

**Files:**
- Modify:
  - `frontend/src/components/ProfileCompletionGate.tsx`;
  - `frontend/src/app/login/page.tsx`;
  - `frontend/src/features/lcup/lcupApi.ts` (`setInitialPassword(password)` → POST `/lcup/claim/password/`);
  - `frontend/src/lib/api.ts` (the members row type near the `/classes/${classId}/members/` call at ~L1509) and its zod contract, if the row is parsed;
  - the roster row component that renders those members (find the callers of that `api.ts` function).

**Behaviour:**
- **Gate:** when `missing_fields` includes `"password"`, show FIRST a "Choose your password" card (new password + confirm; the server's validator messages inline). On 204, refetch `me`. `password` drops out of `missing_fields`, and the gate continues with its existing name/username/email steps unchanged.
- **Username:** in the gate, when the username matches `/^998\d{9}$/`, show a hint: "You sign in with this phone number. If you change it, sign in with your email or Google instead."
- **Login page:** one muted line under the form: "Enrolled through the learning centre? Sign in with your phone number — your first password is its last 4 digits."
- **Roster:** `lcup_claim_pending: true` rows get a neutral badge "Not signed in yet". A 409 with `code: "lcup_managed"` from an add or remove shows the server's `detail` in the existing error UI.

- [ ] **Step 1: Tests (vitest):**
  - the gate renders the password card only when `missing_fields[0] === "password"`, and submitting calls `setInitialPassword`;
  - the roster badge renders for `lcup_claim_pending: true`.
- [ ] **Steps 2–4:** fail → implement → pass; tsc count versus main; eslint on the touched files.
- [ ] **Step 5: Commit** `feat(lcup): first-password step, login hint and "not signed in yet" roster badge`.

---

### Task 13: Verification and PR

- [ ] **Backend tests:** `... manage.py test lcup classes users access --settings=config.settings_test_nomigrations -v 1` → a literal `OK`. Compare any failure against `main` before chasing it: `tests_attendance_auto` has 4 known reds on `main`.
- [ ] **Checks:** `manage.py check` and `makemigrations --check --dry-run` → clean.
- [ ] **Postgres:** a throwaway local Postgres plus `manage.py migrate` → success.
- [ ] **Frontend:** `npx vitest run` → green; tsc count versus main; eslint.
- [ ] **Graph:** run `graphify update .` in the worktree.
- [ ] **PR:** `git push origin HEAD:refs/heads/feat/lcup-foundation`. Open a PR to `main` whose body lists the 10 owner decisions, states that `LCUP_ENABLED=False` is the default, and gives the deploy steps below. End it with the Claude Code attribution line.

**Deploy (after merge; the owner approves separately):**
1. Zero-downtime full release switch (this ships a migration).
2. Server `backend/.env` (chmod 600): add the `LCUP_*` values with `LCUP_ENABLED=false`.
3. Restart `sat-celery-worker` and `sat-celery-beat` so the task and the beat entry load.
4. `manage.py lcup_sync --dry-run` on the server; review the counts with the owner.
5. `LCUP_ENABLED=true`, then restart backend, worker and beat. The first real sync links and suggests; no accounts are created yet.
6. The owner, in `/ops/lcup`: confirm groups → clear the review → "Mark initial review done". The next sync creates the accounts.
