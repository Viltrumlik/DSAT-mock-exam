# Public vs centre users — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split learners into **centre students** (role `student`, the lc-up members) and **public students** (new role `public_student`, self-registered). Public students see only Mock Exam, Events and their profile.

**Architecture:**
- A new canonical role, `public_student`. Every `role == "student"` check then excludes public students by default.
- A **central allowlist** in `access/host_guard.py`. Many student endpoints check no role at all, so the gate lets a public student reach only the mocks, events, profile, notification and auth APIs.
- The lc-up sync owns the role of every **linked** learner, through a new `audience` stage:
  - joins a live group → `student`;
  - leaves → `public_student`;
  - leaves with a negative lc-up balance → `public_student` plus an automatic freeze, lifted once the balance is ≥ 0.
- A one-off command splits the existing users. A role-change log makes that command and every later transition auditable and reversible.

**Tech Stack:** Django 6 / DRF, Celery (lc-up sync), Next.js + TanStack Query + vitest.

**Spec:** none, by the owner's rule ("spec=code"). The design was approved in chat on 2026-10-13, section by section; the decisions are in `~/.claude/projects/-Users-macbook-Projects-DSAT-mock-exam/memory/public-vs-centre-users.md` and restated in Global Constraints below.

## Global Constraints

Owner's decisions (binding):

- A public student sees **only Mock Exam + Events** (plus Profile/settings, so the account is usable). Nothing else is listed, routable or reachable on the API.
- Everyone sees **ALL published mocks** (`mocks.Mock.is_published`). This includes centre students; nothing else changes for them. Teacher-run mock **sessions** (join by code) stay centre-only.
- **Centre** = an account linked to lc-up (`LcupStudentLink.user`) that is in a live lc-up group. Everyone else is public.
- **Leaving the last lc-up group**:
  - lc-up `balance < 0` → `public_student` + frozen (`frozen_reason="lcup_debt"`), auto-unfrozen once `balance >= 0`;
  - otherwise → `public_student`.
  - Active students with debt are never frozen.
  - A manual freeze (`frozen_reason == ""`) is never changed by the sync.
- **First enrollment** at the centre → ALWAYS a new account. The sync no longer matches new lc-up students to existing accounts once the initial review is done.
  - A **returning** student keeps their lc-up id, so the linked account is promoted back to `student`.
  - A phone already on a **public** account **moves** to the new centre account (the old one keeps email/Google). If the old account's **username** is that phone, the link goes to admin review.
- Becoming public **removes every STUDENT classroom membership** (through `.save()`, so the audit, Telegram and library signals fire). A public student cannot join or be added to a class.
- **Admin:**
  - `/ops/users` gets a "Kind" column, filter and counts (Centre / Public / Frozen — debt / Frozen — admin);
  - `/ops` gets a population card (centre, public and frozen-debt counts, sign-ups in 7 and 30 days, joined and left in 30 days);
  - a broadcast page with audience **centre students / public students / all students**.
- **Leaderboards, points and shop** are centre-only. A public student earns no reward, event attendance included.
- **iOS and Windows apps** refuse a public student at sign-in: "This app is for learning center students. Please use mastersat.uz in your browser."
- **Rollout:** IMMEDIATE, with no preview gate.
  - The kill switch `PUBLIC_SPLIT_ENABLED` (env, default False) gates sign-up roles and the sync's role changes.
  - `split_public_students --revert` undoes the initial split from the log.
- **Copy:** English UI, US spelling. It is a **learning center**, never a "school".
- **Commits:** author **Viltrumlik <viltrumlik@gmail.com>**.
- **Never** switch the primary checkout. Work in `/Users/macbook/Projects/dsat-wt-public` (branch `feat/public-vs-centre-users`).
- **lc-up:** never `POST` to lc-up (the client has no `post()`; keep it that way).
- **Backend tests:**
  ```
  cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <labels> --settings=config.settings_test_nomigrations -v 1
  ```
  Only a literal `OK` counts. The classes baseline on main is 0 red (#259).
- **Frontend checks**, from `frontend/`: `npx vitest run <files>`, `npx tsc --noEmit` (no stale `.next`), `npx eslint <files>`.
- **New migrations** must apply on a fresh Postgres (initdb in the scratchpad, port 55432) before the PR.

---

## File structure

**Backend — new files**

| File | Responsibility |
|---|---|
| `backend/users/audience.py` | The ONE place that changes a learner's role and freeze: `make_public`, `make_centre`, `clear_debt_freeze`, `kind_of`, `self_signup_role` |
| `backend/users/migrations/0029_public_student.py` | Role choices, `User.frozen_reason`, `RoleChange` |
| `backend/users/management/commands/split_public_students.py` | The initial split (`--dry-run`, `--apply`, `--revert`) |
| `backend/users/views_population.py` | `GET /api/users/admin/population/` |
| `backend/lcup/audience.py` | Plans and applies the sync's role transitions (caps, error hold) |
| `backend/lcup/migrations/0002_lcupstudentlink_balance.py` | `balance`, `balance_seen_at` |

**Backend — new tests**

| File | Covers |
|---|---|
| `backend/users/tests/test_public_student_role.py` | Constants, normalization, permissions, frozen, sign-up roles |
| `backend/users/tests/test_public_student_surfaces.py` | Gate, sweep, classes, packs, mocks, events, broadcast, native apps |
| `backend/users/tests/test_audience_service.py` | `users/audience.py` |
| `backend/users/tests/test_split_public_students.py` | The split command |
| `backend/users/tests/test_population_api.py` | Kind filter, kind field, population counts |
| `backend/lcup/tests_audience.py` | The sync's audience stage, new-enrollment accounts, phone move |

**Backend — modified files**

| File | Change |
|---|---|
| `backend/access/constants.py` | `ROLE_PUBLIC_STUDENT`, `LEARNER_ROLES`, `CANONICAL_ROLES`, `ROLE_CHOICES` |
| `backend/access/services.py` | Permission map entry and default; override and early-refusal checks on learners |
| `backend/access/engine/visibility_service.py` | `_is_student` covers learners; public sees nothing |
| `backend/access/models.py` | Override guard on learners |
| `backend/access/host_guard.py` | Public-student allowlist; admin/questions bounce public too |
| `backend/access/views.py` | Grant endpoints refuse a public target |
| `backend/access/management/commands/verify_access_integrity.py` | Learners |
| `backend/users/models.py` | `frozen_reason`, `RoleChange` |
| `backend/users/permissions.py` | Frozen block for learners |
| `backend/users/serializers.py` | Role rank, `is_admin=False`, sign-up role, subject clearing, `kind` field |
| `backend/users/views.py` | Google/Telegram sign-up role, native-app refusal, `?kind=` filter |
| `backend/users/urls.py` | `admin/population/` |
| `backend/users/email_verification.py` | Learners |
| `backend/config/settings.py` | `PUBLIC_SPLIT_ENABLED` |
| `backend/classes/views.py` | `JoinClassView` refuses public |
| `backend/classes/telegram_group.py` | `may_enforce_against` covers learners |
| `backend/exams/views.py` | Practice packs and mock-portal assignment |
| `backend/midterms/views_teacher.py` | Midterm grant refuses a public target |
| `backend/mocks/views.py`, `backend/mocks/views_student.py`, `backend/mocks/views_session.py`, `backend/mocks/sessions.py` | Not-frozen permission; sessions centre-only |
| `backend/events/services.py` | Learners sign up; reward only for centre |
| `backend/notifications/serializers.py`, `backend/notifications/views.py` | New audiences |
| `backend/desktop/views.py`, `backend/desktop/v1/conventions.py` | Refuse public |
| `backend/lcup/models.py` | Balance fields |
| `backend/lcup/sync.py` | Store balance; `_audience` stage; no matching after the review |
| `backend/lcup/accounts.py` | Phone move |
| `backend/lcup/views.py` | Admin link accepts learners |

**Frontend**

| File | Change |
|---|---|
| `frontend/src/lib/roles.ts` | `public_student`, labels, `isPublicStudent`, `isStudentSiteRole`, `isPublicStudentPath`, `homePathFor` |
| `frontend/src/components/AuthGuard.tsx` | The public path guard |
| `frontend/src/app/login/page.tsx` | Redirect by role |
| `frontend/src/features/testing-simulation/pages/ExamRunnerPage.tsx` | `isAdmin` fix; exit home |
| `frontend/src/features/events/EventInviteDialog.tsx` | Learners eligible |
| `frontend/src/features/profile/profileModel.ts` | Label |
| `frontend/src/app/(main)/profile/page.tsx` | Settings-only for public |
| `frontend/src/components/shell/navConfig.ts` | `publicStudentNav` |
| `frontend/src/components/shell/StudentAppShell.tsx` | Nav and header by role |
| `frontend/src/components/shell/StudentHeaderExtras.tsx` | Split out `EventsHeaderButton` and `EventsMenuRow` |
| `frontend/src/components/shell/StudentPrompts.tsx` | `surveys` prop |
| `frontend/src/features/mock/MockList.tsx` | Hide the sessions panel for public |
| `frontend/src/app/(ops)/ops/users/page.tsx` | Kind column, filter, counts; role option |
| `frontend/src/app/(ops)/ops/page.tsx` | Population card |
| `frontend/src/app/(ops)/ops/broadcast/page.tsx` | **New**: broadcast composer (super_admin) |
| `frontend/src/app/(ops)/layout.tsx` | Broadcast nav item |
| `frontend/src/features/notifications/notificationsApi.ts` | `broadcast()` |
| `frontend/src/lib/usersAdminApi.ts` | **New**: `population()` |
| Tests | `frontend/src/lib/__tests__/roles.public.test.ts`, `frontend/src/components/__tests__/AuthGuard.public.test.tsx`, `frontend/src/components/shell/__tests__/navConfig.public.test.ts`, `frontend/src/app/(ops)/ops/broadcast/__tests__/page.test.tsx` |

---

### Task 1: The role itself — constants, normalization, permissions, frozen block, migration

**Files:**
- Modify: `backend/access/constants.py:110-139`, `backend/access/services.py:140,491,497,527,552,577,597`, `backend/access/models.py:137`, `backend/access/engine/visibility_service.py:42,125`, `backend/access/management/commands/verify_access_integrity.py:79`, `backend/users/permissions.py:16`, `backend/users/serializers.py:604-627,699,739`, `backend/users/email_verification.py:74`, `backend/users/models.py:275`
- Create: `backend/users/migrations/0029_public_student.py` (`makemigrations`; this task's slice is the role AlterField only. Task 2 adds the rest to the same migration before the first commit that contains it.)
- Test: `backend/users/tests/test_public_student_role.py`

**Interfaces:**
- Produces:
  - `access.constants.ROLE_PUBLIC_STUDENT = "public_student"`
  - `access.constants.LEARNER_ROLES: frozenset[str]` (`{ROLE_STUDENT, ROLE_PUBLIC_STUDENT}`)
  - `normalized_role(user)` returns `"public_student"` for that role.

- [ ] **Step 1: Write the failing tests**

```python
# backend/users/tests/test_public_student_role.py
"""public_student is a real role: it normalizes to itself, holds no permission, is blocked when
frozen, and cannot be granted staff powers by a per-user override."""
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from access.services import effective_permissions, normalized_role
from users.models import User
from users.serializers import UserSerializer


def public(username="pub", **kw):
    return User.objects.create_user(f"{username}@example.com", password="Pass-12345678", username=username,
                                    role=C.ROLE_PUBLIC_STUDENT, **kw)


class RoleBasicsTests(TestCase):
    def test_the_role_is_canonical_and_normalizes_to_itself(self):
        self.assertIn(C.ROLE_PUBLIC_STUDENT, C.CANONICAL_ROLES)
        self.assertIn((C.ROLE_PUBLIC_STUDENT, "Public student"), C.ROLE_CHOICES)
        self.assertEqual(C.LEARNER_ROLES, frozenset({C.ROLE_STUDENT, C.ROLE_PUBLIC_STUDENT}))
        self.assertEqual(normalized_role(public()), C.ROLE_PUBLIC_STUDENT)

    def test_it_holds_no_permission_not_even_submit_test(self):
        self.assertEqual(effective_permissions(public()), frozenset())

    def test_every_canonical_role_has_a_rank(self):
        self.assertTrue(C.CANONICAL_ROLES <= set(UserSerializer._ROLE_RANK))

    def test_a_frozen_public_student_is_blocked(self):
        u = public(is_frozen=True)
        api = APIClient()
        api.force_authenticate(u)
        self.assertEqual(api.get("/api/notifications/").status_code, 403)
```

Check the real name of the effective-permissions function at `access/services.py:~480` (the function containing `granted: set[str] = set(_role_permissions_map().get(role, ...))`) and import that one. If notifications use `IsAuthenticated` (they do), assert the frozen block on a DEFAULT-permission view instead: `/api/users/me/` PATCH returns 403 for a frozen user (`users/tests_frozen_access.py` shows the pattern).

- [ ] **Step 2: Run, and expect FAIL** (`AttributeError: ROLE_PUBLIC_STUDENT`)

```
python3 manage.py test users.tests.test_public_student_role ...
```

- [ ] **Step 3: Implement**

`access/constants.py`, after `ROLE_STUDENT = "student"`:
```python
#: A learner who signed up on the site and is not (or no longer) at the learning center. Sees only
#: mock exams, events and their own profile — the host guard's allowlist enforces it. The lc-up sync
#: moves people between this role and ROLE_STUDENT; nothing else should.
ROLE_PUBLIC_STUDENT = "public_student"
```
Add `ROLE_PUBLIC_STUDENT` to `CANONICAL_ROLES`. Add `(ROLE_PUBLIC_STUDENT, "Public student"),` right after the student pair in `ROLE_CHOICES`. After `SUBJECT_SCOPED_STAFF_ROLES`:
```python
#: Everyone who learns here, centre or public. Use it where both must be treated as learners
#: (frozen block, subject clearing, override guards); keep ROLE_STUDENT where only the centre counts.
LEARNER_ROLES = frozenset({ROLE_STUDENT, ROLE_PUBLIC_STUDENT})
```

`access/services.py`:
- Add `constants.ROLE_PUBLIC_STUDENT: frozenset(),` to the role map (after the student entry).
- Change `.get(role, frozenset({constants.PERM_SUBMIT_TEST}))` to `.get(role, frozenset())`.
- Override guard (`:497`): `role in constants.LEARNER_ROLES and ov.permission.codename in ...`.
- The early refusals in `can_edit_tests` / `can_view_tests` / `can_assign_tests` (`:527/552/577`): `if normalized_role(user) in constants.LEARNER_ROLES: return False`.
- `access_level_for_practice_test` (`:597`): `return "none"` for learners.

`access/models.py:137`: same, `in LEARNER_ROLES`.

`access/engine/visibility_service.py`: `_is_student` returns `normalized_role(user) in LEARNER_ROLES`. In `filter_visible`, before the staff fall-through: `if normalized_role(user) == ROLE_PUBLIC_STUDENT: return queryset.none()`.

`verify_access_integrity.py:79`: `role__in=C.LEARNER_ROLES`.

`users/permissions.py`:
```python
from access import constants as acc_const
...
        if role in acc_const.LEARNER_ROLES and getattr(user, "is_frozen", False):
            return False
```

`users/serializers.py`:
- `_ROLE_RANK`: add `acc_const.ROLE_PUBLIC_STUDENT: 1,`.
- `_incoming_role_code` `is_admin is False` branch: `return None if getattr(self, "instance", None) is not None else acc_const.ROLE_STUDENT`. That way a staff edit sending `is_admin: false` never flips a public student to centre.
- Subject clearing on create (`:699`): `elif role in acc_const.LEARNER_ROLES:`.
- Subject clearing on update (`:739`): add `acc_const.ROLE_PUBLIC_STUDENT` to the tuple.

`users/email_verification.py:74`: `not in acc_const.LEARNER_ROLES`.

`users/models.py:275` (`clean`): `elif role in (auth_const.ROLE_STUDENT, auth_const.ROLE_PUBLIC_STUDENT):`.

Then:
```
python3 manage.py makemigrations users -n public_student
```
Expected: one `AlterField` on `user.role`, choices only.

- [ ] **Step 4: Run Task 1's tests, `users`, `access`. Expect OK.**

Fix any test that walks `ROLE_CHOICES` or `CANONICAL_ROLES` and pins a count (grep `len(ROLE_CHOICES)` and `CANONICAL_ROLES` in tests).

- [ ] **Step 5: Commit** `feat(users): public_student — a canonical learner role with no permission`

---

### Task 2: The audience service, the freeze reason and the role-change log

**Files:**
- Modify: `backend/users/models.py` (`User.frozen_reason`, new `RoleChange`), `backend/users/migrations/0029_public_student.py` (regenerate), `backend/config/settings.py` (`PUBLIC_SPLIT_ENABLED` after the LCUP block)
- Create: `backend/users/audience.py`
- Test: `backend/users/tests/test_audience_service.py`

**Interfaces:**
- Consumes: `ROLE_PUBLIC_STUDENT`, `LEARNER_ROLES` (Task 1).
- Produces (all in `users.audience`):
  - Constants: `FROZEN_LCUP_DEBT = "lcup_debt"`; `SOURCE_SYNC = "lcup_sync"`, `SOURCE_SPLIT = "split"`.
  - Reasons: `REASON_INITIAL_SPLIT = "initial_split"`, `REASON_JOINED = "lcup_joined"`, `REASON_LEFT = "lcup_left"`, `REASON_LEFT_WITH_DEBT = "lcup_left_with_debt"`, `REASON_DEBT_PAID = "lcup_debt_paid"`.
  - `make_public(user, *, reason, source, freeze_for_debt=False, run_id=None) -> RoleChange`
  - `make_centre(user, *, reason, source, run_id=None) -> RoleChange`
  - `clear_debt_freeze(user, *, source, run_id=None) -> RoleChange | None`
  - `kind_of(user) -> str`: one of `"centre" | "public" | "frozen_debt" | "frozen_admin" | "staff"`
  - `self_signup_role() -> str`
- Produces (in `users.models`):
  - `User.frozen_reason`: `CharField(max_length=24, blank=True, default="", db_default="")`
  - `RoleChange`: fields `user`, `from_role`, `to_role`, `froze`, `unfroze`, `reason`, `source`, `lcup_run_id`, `removed_membership_ids` (JSON list), `created_at`, `reverted_at`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/users/tests/test_audience_service.py
from django.test import TestCase, override_settings

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from users import audience
from users.models import RoleChange, User


class AudienceServiceTests(TestCase):
    def setUp(self):
        self.t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="R", subject="MATH", created_by=self.t, teacher=self.t)
        self.s = User.objects.create_user(None, password=None, username="s", role=C.ROLE_STUDENT)
        self.m = ClassroomMembership.objects.create(classroom=self.room, user=self.s, role="STUDENT")

    def test_make_public_removes_every_student_seat_and_logs_it(self):
        change = audience.make_public(self.s, reason=audience.REASON_LEFT, source=audience.SOURCE_SYNC, run_id=7)
        self.s.refresh_from_db(); self.m.refresh_from_db()
        self.assertEqual(self.s.role, C.ROLE_PUBLIC_STUDENT)
        self.assertEqual(self.m.status, ClassroomMembership.STATUS_REMOVED)
        self.assertEqual((change.from_role, change.to_role, change.lcup_run_id), ("student", "public_student", 7))
        self.assertEqual(change.removed_membership_ids, [self.m.pk])
        self.assertFalse(self.s.is_frozen)

    def test_leaving_with_debt_freezes_with_the_debt_reason(self):
        audience.make_public(self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True)
        self.s.refresh_from_db()
        self.assertTrue(self.s.is_frozen)
        self.assertEqual(self.s.frozen_reason, audience.FROZEN_LCUP_DEBT)
        self.assertEqual(audience.kind_of(self.s), "frozen_debt")

    def test_a_manual_freeze_is_never_relabelled_or_lifted(self):
        self.s.is_frozen = True; self.s.save(update_fields=["is_frozen"])
        audience.make_public(self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True)
        self.s.refresh_from_db()
        self.assertEqual((self.s.is_frozen, self.s.frozen_reason), (True, ""))
        self.assertIsNone(audience.clear_debt_freeze(self.s, source=audience.SOURCE_SYNC))
        self.assertEqual(audience.kind_of(self.s), "frozen_admin")

    def test_paying_the_debt_lifts_only_the_debt_freeze(self):
        audience.make_public(self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True)
        change = audience.clear_debt_freeze(self.s, source=audience.SOURCE_SYNC)
        self.s.refresh_from_db()
        self.assertEqual((self.s.is_frozen, self.s.frozen_reason, change.unfroze), (False, "", True))
        self.assertEqual(audience.kind_of(self.s), "public")

    def test_coming_back_restores_the_role_and_lifts_a_debt_freeze(self):
        audience.make_public(self.s, reason=audience.REASON_LEFT_WITH_DEBT, source=audience.SOURCE_SYNC, freeze_for_debt=True)
        audience.make_centre(self.s, reason=audience.REASON_JOINED, source=audience.SOURCE_SYNC)
        self.s.refresh_from_db()
        self.assertEqual((self.s.role, self.s.is_frozen), (C.ROLE_STUDENT, False))
        self.assertEqual(audience.kind_of(self.s), "centre")
        self.assertEqual(RoleChange.objects.filter(user=self.s).count(), 2)

    def test_staff_are_never_moved(self):
        with self.assertRaises(ValueError):
            audience.make_public(self.t, reason=audience.REASON_LEFT, source=audience.SOURCE_SYNC)
        self.assertEqual(audience.kind_of(self.t), "staff")

    @override_settings(PUBLIC_SPLIT_ENABLED=True)
    def test_sign_up_role_follows_the_switch(self):
        self.assertEqual(audience.self_signup_role(), C.ROLE_PUBLIC_STUDENT)
        with self.settings(PUBLIC_SPLIT_ENABLED=False):
            self.assertEqual(audience.self_signup_role(), C.ROLE_STUDENT)
```

- [ ] **Step 2: Run, and expect FAIL** (`ImportError: users.audience`)

- [ ] **Step 3: Implement**

`config/settings.py`, after the LCUP env block:
```python
# Public vs centre learners (docs/superpowers/plans/2026-10-13-public-vs-centre-users.md). Off:
# sign-ups are "student" and the lc-up sync changes no role. On: sign-ups are "public_student" and
# the sync moves linked learners between the two roles.
PUBLIC_SPLIT_ENABLED = os.getenv("PUBLIC_SPLIT_ENABLED", "False").lower() == "true"
```

`users/models.py`, `User`, next to `is_frozen`:
```python
    #: Why the account is frozen. "" = an administrator froze it (the sync never touches those);
    #: "lcup_debt" = the student left the learning center owing money, lifted automatically once
    #: lc-up shows the balance paid (users.audience).
    frozen_reason = models.CharField(max_length=24, blank=True, default="", db_default="")
```
At the end of the module:
```python
class RoleChange(models.Model):
    """Every move between the learner roles, and every automatic freeze or unfreeze: who, from what
    to what, why, and which classroom seats it removed (so ``split_public_students --revert`` can
    put them back)."""

    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="role_changes")
    from_role = models.CharField(max_length=32)
    to_role = models.CharField(max_length=32)
    froze = models.BooleanField(default=False)
    unfroze = models.BooleanField(default=False)
    reason = models.CharField(max_length=32, db_index=True)
    source = models.CharField(max_length=16)
    lcup_run_id = models.PositiveIntegerField(null=True, blank=True)
    removed_membership_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
```
(Import `django.utils.timezone` if the module does not already.)

`users/audience.py`:
```python
"""The one place a learner's role or debt-freeze changes (public vs centre, plan 2026-10-13).

Centre = role ``student``: an lc-up member. Public = role ``public_student``: everyone else. The
lc-up sync and ``split_public_students`` call these; nothing else should set either role on an
existing account. Each call is one transaction and writes one ``RoleChange``.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction

from access import constants as C

from .models import RoleChange, User

FROZEN_LCUP_DEBT = "lcup_debt"
SOURCE_SYNC = "lcup_sync"
SOURCE_SPLIT = "split"
REASON_INITIAL_SPLIT = "initial_split"
REASON_JOINED = "lcup_joined"
REASON_LEFT = "lcup_left"
REASON_LEFT_WITH_DEBT = "lcup_left_with_debt"
REASON_DEBT_PAID = "lcup_debt_paid"


def self_signup_role() -> str:
    return C.ROLE_PUBLIC_STUDENT if getattr(settings, "PUBLIC_SPLIT_ENABLED", False) else C.ROLE_STUDENT


def kind_of(user) -> str:
    role = str(getattr(user, "role", "") or "").strip().lower()
    if role not in C.LEARNER_ROLES:
        return "staff"
    if getattr(user, "is_frozen", False):
        return "frozen_debt" if getattr(user, "frozen_reason", "") == FROZEN_LCUP_DEBT else "frozen_admin"
    return "centre" if role == C.ROLE_STUDENT else "public"


def _locked(user) -> User:
    fresh = User.objects.select_for_update().get(pk=user.pk)
    if fresh.role not in C.LEARNER_ROLES:
        raise ValueError(f"user {fresh.pk} is staff ({fresh.role}); learner roles only")
    return fresh


def _remove_student_seats(user) -> list[int]:
    from classes.models import ClassroomMembership

    removed = []
    seats = ClassroomMembership.objects.filter(user=user, role=ClassroomMembership.ROLE_STUDENT).exclude(
        status=ClassroomMembership.STATUS_REMOVED
    )
    for seat in seats:  # .save(), never .update(): the audit, Telegram and library signals must fire
        seat.status = ClassroomMembership.STATUS_REMOVED
        seat.save()
        removed.append(seat.pk)
    return removed


@transaction.atomic
def make_public(user, *, reason, source, freeze_for_debt=False, run_id=None) -> RoleChange:
    u = _locked(user)
    froze = False
    fields = ["role"]
    from_role, u.role = u.role, C.ROLE_PUBLIC_STUDENT
    if freeze_for_debt and not u.is_frozen:  # an admin's freeze keeps its "" reason
        u.is_frozen, u.frozen_reason, froze = True, FROZEN_LCUP_DEBT, True
        fields += ["is_frozen", "frozen_reason"]
    u.save(update_fields=fields)
    removed = _remove_student_seats(u)
    user.role, user.is_frozen, user.frozen_reason = u.role, u.is_frozen, u.frozen_reason
    return RoleChange.objects.create(user=u, from_role=from_role, to_role=u.role, froze=froze, reason=reason,
                                     source=source, lcup_run_id=run_id, removed_membership_ids=removed)


@transaction.atomic
def make_centre(user, *, reason, source, run_id=None) -> RoleChange:
    u = _locked(user)
    unfroze = False
    fields = ["role"]
    from_role, u.role = u.role, C.ROLE_STUDENT
    if u.is_frozen and u.frozen_reason == FROZEN_LCUP_DEBT:  # back at the center: the debt freeze is moot
        u.is_frozen, u.frozen_reason, unfroze = False, "", True
        fields += ["is_frozen", "frozen_reason"]
    u.save(update_fields=fields)
    user.role, user.is_frozen, user.frozen_reason = u.role, u.is_frozen, u.frozen_reason
    return RoleChange.objects.create(user=u, from_role=from_role, to_role=u.role, unfroze=unfroze, reason=reason,
                                     source=source, lcup_run_id=run_id)


@transaction.atomic
def clear_debt_freeze(user, *, source, run_id=None) -> RoleChange | None:
    u = _locked(user)
    if not (u.is_frozen and u.frozen_reason == FROZEN_LCUP_DEBT):
        return None
    u.is_frozen, u.frozen_reason = False, ""
    u.save(update_fields=["is_frozen", "frozen_reason"])
    user.is_frozen, user.frozen_reason = False, ""
    return RoleChange.objects.create(user=u, from_role=u.role, to_role=u.role, unfroze=True,
                                     reason=REASON_DEBT_PAID, source=source, lcup_run_id=run_id)
```

Then run `python3 manage.py makemigrations users -n public_student`. Delete the Task 1 file first, so one `0029` holds the AlterField, the AddField `frozen_reason` (db_default) and the CreateModel `RoleChange`.

- [ ] **Step 4: Run Task 2's tests, then `users`. Expect OK.**

- [ ] **Step 5: Commit** `feat(users): one service moves learners between centre and public, logged`

---

### Task 3: Sign-up gives `public_student` (while the switch is on)

**Files:**
- Modify: `backend/users/serializers.py:667-668`, `backend/users/views.py:1478-1485` (Google), `backend/users/views.py:1734-1741` (`_create_telegram_user`)
- Test: append `SignUpRoleTests` to `backend/users/tests/test_public_student_role.py`

**Interfaces:**
- Consumes: `users.audience.self_signup_role()`.

- [ ] **Step 1: Write the failing tests**

```python
@override_settings(PUBLIC_SPLIT_ENABLED=True)
class SignUpRoleTests(TestCase):
    def test_self_registration_is_public(self):
        resp = APIClient().post("/api/users/register/", {
            "email": "new@example.com", "username": "newbie", "password": "Kitob-va-Qalam-2026",
            "first_name": "New", "last_name": "Learner",
        }, format="json", HTTP_ORIGIN="http://localhost:3000", HTTP_REFERER="http://localhost:3000/register")
        self.assertIn(resp.status_code, (200, 201), resp.content[:300])
        self.assertEqual(User.objects.get(username="newbie").role, C.ROLE_PUBLIC_STUDENT)

    def test_an_admin_creating_without_a_role_still_makes_a_centre_student(self):
        admin = User.objects.create_user("a@example.com", password="x", username="adm", role="super_admin")
        s = UserSerializer(data={"email": "c@example.com", "username": "c", "password": "Kitob-va-Qalam-2026"},
                           context={"request": type("R", (), {"user": admin})()})
        s.is_valid(raise_exception=True)
        self.assertEqual(s.save().role, C.ROLE_STUDENT)

    def test_telegram_sign_up_is_public(self):
        from users.views import _create_telegram_user
        u = _create_telegram_user(telegram_id=123456789012345678, first_name="Tg", last_name="", username="tguser")
        self.assertEqual(u.role, C.ROLE_PUBLIC_STUDENT)
```

Match `_create_telegram_user`'s real signature (`users/views.py:~1720`) and the registration payload the existing tests use (`users/tests/test_registration_and_email_hardening.py`). For Google, patch the token verifier the way `users/tests/test_google_auth_audience.py` does, and assert a new account gets `public_student`.

- [ ] **Step 2: Run, and expect FAIL** (the role is `student`)

- [ ] **Step 3: Implement**
- `serializers.py`, the end of `_resolve_system_role_for_write`:
  ```python
  if instance is None:
      # Self-registration (anonymous) is a public learner once the split is on; an administrator
      # creating an account without naming a role still makes a centre student, as before.
      return acc_const.ROLE_STUDENT if self._actor_is_authenticated() else self_signup_role()
  ```
  Add the helper `_actor_is_authenticated(self)`: `request = self.context.get("request"); u = getattr(request, "user", None); return bool(u and u.is_authenticated)`. Import `from .audience import self_signup_role` (lazily inside the method if a cycle appears; `users.audience` imports `users.models` only).
- Google (`views.py:~1480`) and `_create_telegram_user` (`:~1736`): `role=self_signup_role(),` in place of `role=acc_const.ROLE_STUDENT` / `"student"`.

- [ ] **Step 4: Run Task 3's tests, then `users`. Expect OK.**

- [ ] **Step 5: Commit** `feat(users): signing up on the site makes a public learner`

---

### Task 4: The central gate — a public student reaches only the allowlist; the apps refuse them

**Files:**
- Modify: `backend/access/host_guard.py:120-140` (role gate), `backend/users/views.py:1371-1397` (`_console_refusal_for`), `backend/desktop/views.py:53-72,106` (AuthCode, AuthExchange), `backend/desktop/v1/conventions.py:147-172` (`V1APIView.initial`)
- Test: `backend/users/tests/test_public_student_surfaces.py` (`GateTests`, `NativeAppTests`)

**Interfaces:**
- Produces:
  - `access.host_guard.PUBLIC_STUDENT_API_PREFIXES: tuple[str, ...]`
  - `access.host_guard.PUBLIC_STUDENT_DENIED_PREFIXES: tuple[str, ...]`
  - `access.host_guard.public_student_may(path: str) -> bool`
  - The 403 body `{"detail": ..., "code": "centre_only"}`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/users/tests/test_public_student_surfaces.py
from django.test import TestCase, override_settings
from django.urls import get_resolver
from rest_framework.test import APIClient

from access import constants as C
from access.host_guard import public_student_may
from users.models import User

PUBLIC_NAMESPACES = {
    "/api/auth/", "/api/users/", "/api/mocks/", "/api/events/", "/api/notifications/",
    "/api/realtime/", "/api/annotations/", "/api/question-reports/", "/api/health/",
    "/api/schema/", "/api/csp-report/",
}


def top_level_api_prefixes():
    out = set()
    for p in get_resolver().url_patterns:
        route = str(p.pattern)
        if route.startswith("api/"):
            out.add("/" + route.split("/")[0] + "/" + route.split("/")[1] + "/")
    return out


class GateTests(TestCase):
    def setUp(self):
        self.pub = User.objects.create_user("p@example.com", password="x", username="pub", role=C.ROLE_PUBLIC_STUDENT)
        self.api = APIClient()
        self.api.force_authenticate(self.pub)

    def test_a_new_api_namespace_is_closed_to_public_students_by_default(self):
        # Pins the allowlist: anything outside PUBLIC_NAMESPACES must be refused, so adding an app
        # never opens it to public learners by accident.
        for prefix in top_level_api_prefixes():
            if prefix not in PUBLIC_NAMESPACES:
                self.assertFalse(public_student_may(prefix + "x/"), prefix)

    def test_inside_users_only_me_and_sign_in_paths_are_open(self):
        self.assertTrue(public_student_may("/api/users/me/"))
        for closed in ("/api/users/admin/list/", "/api/users/42/update/", "/api/users/activity/"):
            self.assertFalse(public_student_may(closed), closed)

    def test_mock_sessions_stay_centre_only(self):
        self.assertTrue(public_student_may("/api/mocks/mine/"))
        self.assertFalse(public_student_may("/api/mocks/sessions/join/"))

    def test_requests_are_refused_with_the_centre_only_code(self):
        resp = self.api.get("/api/classes/")
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(resp.json()["code"], "centre_only")
        self.assertEqual(self.api.get("/api/mocks/mine/").status_code, 200)

    def test_a_centre_student_is_not_gated(self):
        s = User.objects.create_user("s@example.com", password="x", username="stu", role=C.ROLE_STUDENT)
        api = APIClient(); api.force_authenticate(s)
        self.assertNotEqual(api.get("/api/classes/").status_code, 403)


class NativeAppTests(TestCase):
    def test_the_ios_app_refuses_a_public_student_at_sign_in(self):
        User.objects.create_user("p@example.com", password="Kitob-va-Qalam-2026", username="pub", role=C.ROLE_PUBLIC_STUDENT)
        resp = APIClient().post("/api/auth/login/", {"email": "pub", "password": "Kitob-va-Qalam-2026"}, format="json",
                                HTTP_X_MASTERSAT_CLIENT="ios/1.4.0")
        self.assertEqual(resp.status_code, 403)
        self.assertIn("learning center students", resp.json()["detail"])
```

`force_authenticate` skips the JWT middleware, so `request.user` may not be set when `host_guard` runs. If so, authenticate the way `access/tests` host-guard tests do: mint a JWT with `RefreshToken.for_user(u).access_token` and send `HTTP_AUTHORIZATION=f"Bearer {token}"`. Follow the existing `test_*host_guard*` pattern (grep `HostGuard` in `backend/access/tests*`).

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**

`access/host_guard.py`, module level:
```python
#: What a public learner (role public_student) may reach. Everything else under /api/ is the learning
#: center's and answers 403 {"code": "centre_only"}. An ALLOWLIST on purpose: a new app is closed to
#: them until someone adds it here (users/tests/test_public_student_surfaces.py pins the list).
PUBLIC_STUDENT_API_PREFIXES = (
    "/api/auth/", "/api/users/me/", "/api/users/exam-dates/", "/api/users/register/",
    "/api/users/google/", "/api/users/telegram/", "/api/mocks/", "/api/events/",
    "/api/notifications/", "/api/realtime/", "/api/annotations/", "/api/question-reports/",
    "/api/health/", "/api/schema/", "/api/csp-report/",
)
#: Inside an allowed app, the parts that are still the center's.
PUBLIC_STUDENT_DENIED_PREFIXES = ("/api/mocks/sessions/",)


def public_student_may(path: str) -> bool:
    if not path.startswith("/api/"):
        return True
    if path.startswith(PUBLIC_STUDENT_DENIED_PREFIXES):
        return False
    return path.startswith(PUBLIC_STUDENT_API_PREFIXES)
```

In `__call__`, right after `role` is computed (before the admin/questions checks):
```python
        if role == _c.ROLE_PUBLIC_STUDENT and not public_student_may(path):
            return JsonResponse(
                {"detail": "This is available to learning center students only.", "code": "centre_only"},
                status=403,
            )
```
Change the admin and questions checks to `role in (_c.ROLE_STUDENT, _c.ROLE_PUBLIC_STUDENT)`. Use whatever alias the module already imports for `access.constants`.

`users/views.py`, `_console_refusal_for`, before `return None`:
```python
    client = str(request.headers.get(NATIVE_CLIENT_HEADER, "") or "").strip().lower()
    if role == acc_const.ROLE_PUBLIC_STUDENT and client.startswith(("ios/", "windows/")):
        return Response(
            {"detail": "This app is for learning center students. Please use mastersat.uz in your browser."},
            status=status.HTTP_403_FORBIDDEN,
        )
```
Import `NATIVE_CLIENT_HEADER` from `users.auth_cookies`. The desktop exchange already calls `_console_refusal_for`. Add the same role refusal at the top of `AuthCodeView.post` (`desktop/views.py:53`), so the website's "link the app" page fails early. In `V1APIView.initial` (`desktop/v1/conventions.py`), after `super().initial(...)`:
```python
        if str(getattr(request.user, "role", "") or "").lower() == ROLE_PUBLIC_STUDENT:
            raise forbidden("This app is for learning center students. Please use mastersat.uz in your browser.")
```

- [ ] **Step 4: Run Task 4's tests, then `access`, `users`, `desktop`. Expect OK.**

- [ ] **Step 5: Commit** `feat(access): public learners reach only mocks, events and their profile`

---

### Task 5: Per-surface hardening (defence in depth behind the gate)

**Files:**
- Modify:
  - `backend/classes/views.py:1919` (`JoinClassView.post`)
  - `backend/classes/telegram_group.py:232`
  - `backend/exams/views.py:474,496,1854`
  - `backend/access/views.py:124,383,417`
  - `backend/midterms/views_teacher.py:139`
  - `backend/mocks/views.py:75`, `backend/mocks/views_student.py:14`: `permission_classes = [IsAuthenticatedAndNotFrozen]`
  - `backend/mocks/sessions.py:64` (`request_place`), `backend/mocks/views_session.py:42-77`
  - `backend/events/services.py:51-63,285-298`
  - `backend/notifications/serializers.py:24-29`, `backend/notifications/views.py:159-170`
- Test: append to `backend/users/tests/test_public_student_surfaces.py`: `SurfaceTests`, `EventsTests`, `BroadcastTests`

**Interfaces:**
- Produces: notification audiences `"centre_students"`, `"public_students"`, `"all_students"`. `"students"` stays and means centre.

- [ ] **Step 1: Write the failing tests**

Call each view directly where the gate would stop the request first: `APIRequestFactory` plus `View.as_view()`, or the service functions.

```python
class SurfaceTests(TestCase):
    def setUp(self):
        self.pub = User.objects.create_user("p@example.com", password="x", username="pub", role=C.ROLE_PUBLIC_STUDENT)

    def test_join_by_code_refuses_a_public_learner(self):
        from rest_framework.test import APIRequestFactory, force_authenticate
        from classes.views import JoinClassView
        req = APIRequestFactory().post("/api/classes/join/", {"join_code": "ANY"}, format="json")
        force_authenticate(req, self.pub)
        self.assertEqual(JoinClassView.as_view()(req).status_code, 403)

    def test_mock_sessions_refuse_a_public_learner(self):
        from mocks import sessions
        ok, reason = sessions.request_place(self.pub, "ANYCODE")  # match the real return shape
        self.assertFalse(ok)
        self.assertEqual(reason, "centre_only")

    def test_every_published_mock_is_listed_and_startable(self):
        from mocks.models import Mock
        m = Mock.objects.create(title="Mock 1", is_published=True)
        api = APIClient(); api.force_authenticate(self.pub)
        self.assertIn(m.pk, [row["mock_id"] for row in api.get("/api/mocks/mine/").json()])  # match the payload shape
        self.assertEqual(api.post("/api/mocks/attempts/", {"mock": m.pk}, format="json").status_code, 201)


class EventsTests(TestCase):
    """Fill from backend/events/tests*.py (the mark_attendance tests): build an event plus a
    registration for a public learner and for a centre student, mark both ATTENDED, then assert
    no PointAward for the public learner and exactly one for the centre student. Also assert
    services.is_signupable_student(public_learner) is True."""


class BroadcastTests(TestCase):
    def test_the_new_audiences_pick_the_right_people(self):
        from notifications.views import _AUDIENCE_ROLES
        self.assertEqual(set(_AUDIENCE_ROLES["centre_students"]), {C.ROLE_STUDENT})
        self.assertEqual(set(_AUDIENCE_ROLES["public_students"]), {C.ROLE_PUBLIC_STUDENT})
        self.assertEqual(set(_AUDIENCE_ROLES["all_students"]), set(C.LEARNER_ROLES))
        self.assertEqual(set(_AUDIENCE_ROLES["students"]), {C.ROLE_STUDENT})
```

`EventsTests` must hold the two real tests (sign-up allowed; no award for public, one award for centre), built from the existing events fixtures. Its docstring describes them.

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**
- `JoinClassView.post`, first lines:
  ```python
  if normalized_role(request.user) == acc_const.ROLE_PUBLIC_STUDENT:
      return Response({"detail": "Classes are for learning center students.", "code": "centre_only"}, status=403)
  ```
- `telegram_group.py:232`: `return str(...).strip().lower() in acc_const.LEARNER_ROLES`.
- `exams/views.py`:
  - `PracticeTestPackStudentListView` / `DetailView`: `if normalized_role(user) == acc_const.ROLE_PUBLIC_STUDENT: return base.none()`, before the student branch.
  - `_may_receive_mock_portal`: `if normalized_role(u) == acc_const.ROLE_PUBLIC_STUDENT: return False`, first.
- `access/views.py` grant endpoints and `midterms/views_teacher.py:139`: drop public targets with `users = [u for u in users if normalized_role(u) != acc_const.ROLE_PUBLIC_STUDENT]`. For the single-target grant at `access/views.py:124`, return 400 `{"detail": "Public accounts cannot be given learning center content."}`.
- Mocks: `permission_classes = [IsAuthenticatedAndNotFrozen]` on `MyMocksView` and `MockAttemptViewSet`. `sessions.request_place`: return the module's refusal shape with reason `"centre_only"` when `normalized_role(user) != acc_const.ROLE_STUDENT`, and add `"centre_only": "Mock sessions are for learning center students."` to `REASON_DETAIL`. `MyMockSessionsView` returns `[]` for public.
- Events:
  - `is_signupable_student`: `normalized_role(user) in acc_const.LEARNER_ROLES`.
  - `mark_attendance`: wrap the `award(...)` call in `if normalized_role(registration.student) == acc_const.ROLE_STUDENT:`. Keep `revoke` unconditional.
- Notifications:
  - `serializers.py`: `AUDIENCE_CENTRE_STUDENTS = "centre_students"`, `AUDIENCE_PUBLIC_STUDENTS = "public_students"`, `AUDIENCE_ALL_STUDENTS = "all_students"`, appended to `AUDIENCE_CHOICES`.
  - `views.py` `_AUDIENCE_ROLES`: add `AUDIENCE_CENTRE_STUDENTS: (ROLE_STUDENT,)`, `AUDIENCE_PUBLIC_STUDENTS: (ROLE_PUBLIC_STUDENT,)`, `AUDIENCE_ALL_STUDENTS: (ROLE_STUDENT, ROLE_PUBLIC_STUDENT)`. Keep `students` as is.

- [ ] **Step 4: Run Task 5's tests, then `classes`, `exams`, `mocks`, `events`, `notifications`, `access`, `midterms`. Expect OK** (`classes` baseline 0 red).

- [ ] **Step 5: Commit** `feat: classes, packs, grants, mock sessions and rewards stay with the learning center`

---

### Task 6: lc-up — store the balance; stop matching new students once the review is done; move a public phone

**Files:**
- Modify: `backend/lcup/models.py:81-93`, `backend/lcup/sync.py` (`_students`, `_run_stages`), `backend/lcup/accounts.py:34-63`, `backend/lcup/views.py:206`
- Create: `backend/lcup/migrations/0002_lcupstudentlink_balance.py` (`makemigrations lcup -n lcupstudentlink_balance`)
- Test: `backend/lcup/tests_audience.py` (`BalanceAndEnrollmentTests`)

**Interfaces:**
- Produces:
  - `LcupStudentLink.balance`: `DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)`
  - `LcupStudentLink.balance_seen_at`: `DateTimeField(null=True, blank=True)`
  - `create_account_for` now moves a phone held by one public account.

- [ ] **Step 1: Write the failing tests**

```python
# backend/lcup/tests_audience.py
from decimal import Decimal
from django.test import TestCase, override_settings
from django.utils import timezone

from access import constants as C
from lcup.accounts import create_account_for
from lcup.models import LcupState, LcupStudentLink, LinkStatus
from lcup.sync import run_sync
from lcup.testing import FakeLcupClient
from lcup.tests_sync import API, lcup_data
from users.models import User


@override_settings(LCUP_ENABLED=True, PUBLIC_SPLIT_ENABLED=True)
class BalanceAndEnrollmentTests(TestCase):
    def setUp(self):
        self.now = timezone.now()

    def data(self):
        d = lcup_data()
        for row in d[f"{API}/students"]:
            row["balance"] = "-150000.00" if row["id"] == 102 else "0"
        return d

    def test_the_balance_is_stored(self):
        run_sync(FakeLcupClient(self.data()), now=self.now)
        self.assertEqual(LcupStudentLink.objects.get(lcup_student_id=102).balance, Decimal("-150000.00"))

    def test_after_the_review_a_new_lcup_student_always_gets_a_new_account(self):
        # Same phone + name as an existing public account: still a NEW account, and the phone moves.
        old = User.objects.create_user("aziz@gmail.com", password="x", username="aziz", role=C.ROLE_PUBLIC_STUDENT,
                                       phone_number="998903333333", first_name="Aziz", last_name="Tursunov")
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})
        run_sync(FakeLcupClient(self.data()), now=self.now)
        link = LcupStudentLink.objects.get(lcup_student_id=102)
        self.assertNotEqual(link.user_id, old.pk)
        self.assertEqual(link.user.username, "998903333333")
        old.refresh_from_db()
        self.assertIsNone(old.phone_number)
        self.assertEqual(old.role, C.ROLE_PUBLIC_STUDENT)

    def test_a_phone_that_is_another_accounts_username_still_goes_to_review(self):
        User.objects.create_user(None, password=None, username="998903333333", role=C.ROLE_PUBLIC_STUDENT)
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="Tursunov Aziz", phone="998903333333")
        self.assertIsNone(create_account_for(link, now=self.now))
        link.refresh_from_db()
        self.assertEqual(link.status, LinkStatus.NEEDS_REVIEW)
```

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**
- `models.py`: add the two fields to `LcupStudentLink`, then `makemigrations lcup`.
- `sync._students`: add to `defaults`:
  ```python
  "balance": _money(row.get("balance")),
  "balance_seen_at": run.now,
  ```
  `_money(v)` returns `Decimal(str(v))` or `None` on missing/garbage (catch `InvalidOperation`).
- `sync._run_stages`: run `match_students` only while the initial review is NOT done:
  ```python
  if not run.review_done:  # afterwards, a new lc-up student always gets a new account (owner, 2026-10-13)
      _stage(run, "match_students", lambda: _match_students(run))
  ```
- `accounts.create_account_for`: replace the "phone already used" refusal with:
  ```python
  if User.objects.filter(username__iexact=phone).exists():
      _send_to_review(link, "phone already used by another account")
      return None
  owners = phone_owners(User.objects.all(), phone)
  if owners:
      if len(owners) == 1 and owners[0].role == acc_const.ROLE_PUBLIC_STUDENT:
          # The phone follows the person to their new learning-center account; the public one keeps
          # its email / Google sign-in.
          moved = owners[0]
          moved.phone_number = None
          moved.save(update_fields=["phone_number"])
          SecurityAuditEvent.objects.create(user=moved, event_type="lcup_phone_moved")
      else:
          _send_to_review(link, "phone already used by another account")
          return None
  ```
  Match the `SecurityAuditEvent` field names and signature by copying the call in `lcup/auth_backend.py`.
- `lcup/views.py:206`: `role__in=acc_const.LEARNER_ROLES`.

- [ ] **Step 4: Run Task 6's tests, then `lcup`. Expect OK.**

Some old `tests_sync` tests assume matching after the review (`test_after_the_review_accounts_and_missing_classes_are_created`). Update them only where they relied on post-review matching, and say so in the commit message.

- [ ] **Step 5: Commit** `feat(lcup): balances stored; after the review a new student always gets a new account`

---

### Task 7: The sync's `audience` stage — joined, left, left with debt, debt paid

**Files:**
- Create: `backend/lcup/audience.py`
- Modify: `backend/lcup/sync.py` (`_run_stages`: an `audience` stage between `accounts` and `rosters`)
- Test: `backend/lcup/tests_audience.py` (`AudienceStageTests`)

**Interfaces:**
- Consumes:
  - `users.audience.make_public`, `make_centre`, `clear_debt_freeze`, and the reason/source constants;
  - `lcup.sync.live_student_ids()`;
  - `run.errors`, `run.alerts`, `run.counts`, `run.review_done`.
- Produces:
  - `lcup.audience.MAX_DEMOTIONS_PER_RUN = 20`
  - `lcup.audience.apply(run) -> None`
  - Counts `became_centre`, `became_public`, `frozen_for_debt`, `debt_cleared`, `demotions_held`.

- [ ] **Step 1: Write the failing tests**

```python
@override_settings(LCUP_ENABLED=True, PUBLIC_SPLIT_ENABLED=True)
class AudienceStageTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        LcupState.objects.update_or_create(pk=1, defaults={"initial_review_done_at": self.now})

    def sync(self, data):
        return run_sync(FakeLcupClient(data), now=self.now)

    def linked(self, lcup_id, username, role=C.ROLE_STUDENT):
        u = User.objects.create_user(None, password=None, username=username, role=role)
        LcupStudentLink.objects.update_or_create(lcup_student_id=lcup_id, defaults={"name": username, "user": u, "status": LinkStatus.CONFIRMED})
        return u

    def data(self, balance_102="0", left_102=False):
        d = lcup_data()
        for row in d[f"{API}/students"]:
            row["balance"] = balance_102 if row["id"] == 102 else "0"
        if left_102:
            d[f"{API}/groups/10/students"] = [m for m in d[f"{API}/groups/10/students"] if m["student_id"] != 102]
            d[f"{API}/groups/11/students"] = []
        return d

    def test_leaving_without_debt_makes_a_public_learner(self):
        u = self.linked(102, "aziz")
        self.sync(self.data())
        self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_PUBLIC_STUDENT, False))

    def test_leaving_with_debt_freezes_and_paying_lifts_it(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(balance_102="-150000"))
        self.sync(self.data(balance_102="-150000", left_102=True))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen, u.frozen_reason), (C.ROLE_PUBLIC_STUDENT, True, "lcup_debt"))
        self.sync(self.data(balance_102="0", left_102=True))
        u.refresh_from_db()
        self.assertFalse(u.is_frozen)

    def test_an_active_student_in_debt_is_never_frozen(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(balance_102="-150000"))
        u.refresh_from_db()
        self.assertEqual((u.role, u.is_frozen), (C.ROLE_STUDENT, False))

    def test_coming_back_makes_them_centre_again(self):
        u = self.linked(102, "aziz", role=C.ROLE_PUBLIC_STUDENT)
        self.sync(self.data())
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)

    def test_a_run_with_errors_changes_no_role(self):
        from lcup.client import LcupUnavailable
        u = self.linked(102, "aziz")
        d = self.data(left_102=True)
        d[f"{API}/teachers"] = LcupUnavailable("503")
        self.sync(d)
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)

    def test_too_many_leavers_at_once_are_held(self):
        from unittest import mock
        u = self.linked(102, "aziz")
        self.sync(self.data())
        with mock.patch("lcup.audience.MAX_DEMOTIONS_PER_RUN", 0):
            run = self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
        self.assertTrue(any(a.startswith("role changes held") for a in run.alerts))

    @override_settings(PUBLIC_SPLIT_ENABLED=False)
    def test_with_the_switch_off_nothing_moves(self):
        u = self.linked(102, "aziz")
        self.sync(self.data(left_102=True))
        u.refresh_from_db()
        self.assertEqual(u.role, C.ROLE_STUDENT)
```

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**

```python
# backend/lcup/audience.py
"""The sync's say over who is a centre student (plan 2026-10-13).

Only LINKED learners are touched: lc-up decides about its own people, an administrator about
everyone else. In a live group → student. Out of every live group → public_student, frozen first
when lc-up shows a negative balance; the freeze lifts once the balance is back to zero or above.

Two brakes: a run that hit any error changes no role (a failed page must never read as "left"),
and more than MAX_DEMOTIONS_PER_RUN leavers at once are held as an alert for a human to look at.
"""

from __future__ import annotations

from django.conf import settings

from access import constants as C
from users import audience as A

from .models import LcupStudentLink

MAX_DEMOTIONS_PER_RUN = 20


def apply(run) -> None:
    if not getattr(settings, "PUBLIC_SPLIT_ENABLED", False) or not run.review_done:
        return
    if run.errors:
        run.alerts.append("role changes held: this sync had errors")
        return
    from .sync import live_student_ids

    live = live_student_ids()
    links = LcupStudentLink.objects.filter(user__isnull=False, user__role__in=C.LEARNER_ROLES).select_related("user")
    joining, leaving, paid = [], [], []
    for link in links:
        u = link.user
        if link.pk in live and not link.deleted_in_lcup:
            if u.role != C.ROLE_STUDENT or u.frozen_reason == A.FROZEN_LCUP_DEBT:
                joining.append(u)
        elif u.role == C.ROLE_STUDENT:
            leaving.append((u, link.balance is not None and link.balance < 0))
        elif u.frozen_reason == A.FROZEN_LCUP_DEBT and link.balance is not None and link.balance >= 0:
            paid.append(u)

    for u in joining:
        A.make_centre(u, reason=A.REASON_JOINED, source=A.SOURCE_SYNC)
        run.counts["became_centre"] += 1
    if len(leaving) > MAX_DEMOTIONS_PER_RUN:
        run.alerts.append(f"role changes held: {len(leaving)} leavers > {MAX_DEMOTIONS_PER_RUN} in one run")
        run.counts["demotions_held"] += len(leaving)
    else:
        for u, owes in leaving:
            A.make_public(u, reason=A.REASON_LEFT_WITH_DEBT if owes else A.REASON_LEFT, source=A.SOURCE_SYNC,
                          freeze_for_debt=owes)
            run.counts["became_public"] += 1
            run.counts["frozen_for_debt"] += int(owes)
    for u in paid:
        if A.clear_debt_freeze(u, source=A.SOURCE_SYNC):
            run.counts["debt_cleared"] += 1
```

In `sync._run_stages`, after the accounts stage and before the rosters stage:
```python
    _stage(run, "audience", lambda: audience.apply(run))
```
(`from . import audience`.) Running it before rosters means a returning student is `student` when the roster adds them, and a leaver's seats are already gone.

`_stage` appends to `run.errors` only for its own failure, so the error check at the top of `apply` sees earlier stages only. That is the intent.

`lcup_run_id` stays `None` from the sync: the `LcupSyncRun` row is written after the stages. Do not restructure `run_sync` for it.

- [ ] **Step 4: Run Task 7's tests, then `lcup`. Expect OK.**

- [ ] **Step 5: Commit** `feat(lcup): the sync moves linked learners between centre and public, debt freeze included`

---

### Task 8: `split_public_students` — the one-off split, reversible

**Files:**
- Create: `backend/users/management/commands/split_public_students.py`
- Test: `backend/users/tests/test_split_public_students.py`

**Interfaces:**
- Consumes: `users.audience.make_public`, `REASON_INITIAL_SPLIT`, `SOURCE_SPLIT`, `FROZEN_LCUP_DEBT`; `lcup.sync.live_student_ids`; `LcupStudentLink`.
- Produces: `manage.py split_public_students [--dry-run | --apply | --revert]`, printing JSON counts.

- [ ] **Step 1: Write the failing tests**

```python
# backend/users/tests/test_split_public_students.py
import json
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from access import constants as C
from classes.models import Classroom, ClassroomMembership
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupMembership, LcupStudentLink, LinkStatus
from users.models import RoleChange, User


class SplitTests(TestCase):
    def setUp(self):
        t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="R", subject="MATH", created_by=t, teacher=t)
        group = LcupGroupLink.objects.create(lcup_group_id=10, name="G", status=GroupLinkStatus.CONFIRMED, classroom=self.room)
        self.centre = User.objects.create_user(None, password=None, username="centre", role=C.ROLE_STUDENT)
        link = LcupStudentLink.objects.create(lcup_student_id=1, name="c", user=self.centre, status=LinkStatus.AUTO)
        LcupMembership.objects.create(group=group, student=link, lcup_status="active")
        self.walkin = User.objects.create_user(None, password=None, username="walkin", role=C.ROLE_STUDENT)
        self.seat = ClassroomMembership.objects.create(classroom=self.room, user=self.walkin, role="STUDENT")
        self.leaver = User.objects.create_user(None, password=None, username="leaver", role=C.ROLE_STUDENT)
        LcupStudentLink.objects.create(lcup_student_id=2, name="l", user=self.leaver, status=LinkStatus.AUTO, balance=Decimal("-1"))

    def run_cmd(self, *args):
        out = StringIO()
        call_command("split_public_students", *args, stdout=out)
        return json.loads(out.getvalue())

    def test_dry_run_writes_nothing(self):
        counts = self.run_cmd("--dry-run")
        self.assertEqual((counts["to_public"], counts["to_freeze"]), (2, 1))
        self.assertEqual(User.objects.filter(role=C.ROLE_PUBLIC_STUDENT).count(), 0)

    def test_apply_splits_and_revert_undoes_it(self):
        self.run_cmd("--apply")
        for u in (self.walkin, self.leaver, self.centre):
            u.refresh_from_db()
        self.assertEqual((self.walkin.role, self.leaver.role, self.centre.role),
                         (C.ROLE_PUBLIC_STUDENT, C.ROLE_PUBLIC_STUDENT, C.ROLE_STUDENT))
        self.assertTrue(self.leaver.is_frozen)
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, ClassroomMembership.STATUS_REMOVED)
        self.run_cmd("--revert")
        for u in (self.walkin, self.leaver):
            u.refresh_from_db()
        self.assertEqual((self.walkin.role, self.leaver.role, self.leaver.is_frozen), (C.ROLE_STUDENT, C.ROLE_STUDENT, False))
        self.seat.refresh_from_db()
        self.assertEqual(self.seat.status, ClassroomMembership.STATUS_ACTIVE)
        self.assertFalse(RoleChange.objects.filter(reason="initial_split", reverted_at__isnull=True).exists())
```

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**

```python
# backend/users/management/commands/split_public_students.py
"""The one-off split (plan 2026-10-13): every active ``student`` who is not a live lc-up member
becomes ``public_student`` — a linked leaver with a negative lc-up balance is frozen for the debt —
and loses their classroom seats. ``--revert`` puts back exactly what ``--apply`` changed."""

import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from access import constants as C
from classes.models import ClassroomMembership
from users import audience as A
from users.models import RoleChange, User


class Command(BaseCommand):
    help = "Split learners into centre (lc-up members) and public. --dry-run | --apply | --revert"

    def add_arguments(self, parser):
        g = parser.add_mutually_exclusive_group(required=True)
        g.add_argument("--dry-run", action="store_true")
        g.add_argument("--apply", action="store_true")
        g.add_argument("--revert", action="store_true")

    def handle(self, *args, **opts):
        if opts["revert"]:
            return self._out(self._revert())
        plan = self._plan()
        counts = {"to_public": len(plan), "to_freeze": sum(owes for _, owes in plan)}
        if opts["apply"]:
            for u, owes in plan:
                A.make_public(u, reason=A.REASON_INITIAL_SPLIT, source=A.SOURCE_SPLIT, freeze_for_debt=owes)
            counts["applied"] = True
        self._out(counts)

    def _plan(self):
        from lcup.models import LcupStudentLink
        from lcup.sync import live_student_ids

        live_links = live_student_ids()  # LcupStudentLink pks with a live membership
        links = {link.user_id: link for link in LcupStudentLink.objects.filter(user__isnull=False)}
        plan = []
        for u in User.objects.filter(role=C.ROLE_STUDENT, is_active=True).order_by("pk"):
            link = links.get(u.pk)
            if link is not None and link.pk in live_links and not link.deleted_in_lcup:
                continue  # a centre student
            owes = bool(link is not None and link.balance is not None and link.balance < 0)
            plan.append((u, owes))
        return plan

    @transaction.atomic
    def _revert(self):
        n = 0
        rows = RoleChange.objects.select_for_update().filter(reason=A.REASON_INITIAL_SPLIT, reverted_at__isnull=True)
        for ch in rows:
            u = ch.user
            fields = ["role"]
            u.role = ch.from_role
            if ch.froze and u.frozen_reason == A.FROZEN_LCUP_DEBT:
                u.is_frozen, u.frozen_reason = False, ""
                fields += ["is_frozen", "frozen_reason"]
            u.save(update_fields=fields)
            for seat in ClassroomMembership.objects.filter(pk__in=ch.removed_membership_ids):
                seat.status = ClassroomMembership.STATUS_ACTIVE
                seat.save()
            ch.reverted_at = timezone.now()
            ch.save(update_fields=["reverted_at"])
            n += 1
        return {"reverted": n}

    def _out(self, data):
        self.stdout.write(json.dumps(data))
```

- [ ] **Step 4: Run Task 8's tests. Expect OK.**

- [ ] **Step 5: Commit** `feat(users): split_public_students — the one-off split, with --revert`

---

### Task 9: Admin API — kind on users, the population endpoint

**Files:**
- Modify: `backend/users/serializers.py` (`UserSerializer`: read-only `kind`, `frozen_reason`), `backend/users/views.py:1105-1153` (`UserListView` `?kind=`), `backend/users/urls.py`
- Create: `backend/users/views_population.py`
- Test: `backend/users/tests/test_population_api.py`

**Interfaces:**
- Produces:
  - `GET /api/users/admin/population/` returns `{centre, public, frozen_debt, frozen_admin, signups_7d, signups_30d, joined_30d, left_30d}`. Permission: `HasManageUsersOrAssignTestAccess` (as the list).
  - `UserSerializer` fields `kind` and `frozen_reason`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/users/tests/test_population_api.py
from django.test import TestCase
from rest_framework.test import APIClient

from access import constants as C
from users import audience as A
from users.models import User


class PopulationTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user("a@example.com", password="x", username="adm", role="super_admin")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        User.objects.create_user(None, password=None, username="c", role=C.ROLE_STUDENT)
        User.objects.create_user(None, password=None, username="p", role=C.ROLE_PUBLIC_STUDENT)
        d = User.objects.create_user(None, password=None, username="d", role=C.ROLE_STUDENT)
        A.make_public(d, reason=A.REASON_LEFT_WITH_DEBT, source=A.SOURCE_SYNC, freeze_for_debt=True)

    def test_counts(self):
        body = self.api.get("/api/users/admin/population/").json()
        self.assertEqual((body["centre"], body["public"], body["frozen_debt"], body["left_30d"]), (1, 1, 1, 1))
        self.assertGreaterEqual(body["signups_30d"], 3)

    def test_kind_filter_and_field(self):
        rows = self.api.get("/api/users/admin/list/", {"kind": "public"}).json()
        rows = rows["results"] if isinstance(rows, dict) else rows
        self.assertEqual([r["username"] for r in rows], ["p"])
        self.assertEqual(rows[0]["kind"], "public")
```

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**
- `UserSerializer`: `kind = serializers.SerializerMethodField()` with `def get_kind(self, obj): return kind_of(obj)`. Add `"kind", "frozen_reason"` to `Meta.fields`, and `frozen_reason` to the read-only fields.
- `UserListView.get_queryset`, after the role filter:
  ```python
  kind = (self.request.query_params.get("kind") or "").strip().lower()
  if kind == "centre":
      qs = qs.filter(role=acc_const.ROLE_STUDENT, is_frozen=False)
  elif kind == "public":
      qs = qs.filter(role=acc_const.ROLE_PUBLIC_STUDENT, is_frozen=False)
  elif kind == "frozen_debt":
      qs = qs.filter(is_frozen=True, frozen_reason="lcup_debt")
  elif kind == "frozen_admin":
      qs = qs.filter(is_frozen=True, role__in=acc_const.LEARNER_ROLES).exclude(frozen_reason="lcup_debt")
  ```
- `views_population.py`:
  ```python
  """Learner population for the /ops card: centre vs public vs frozen, and how people moved lately."""
  from datetime import timedelta

  from django.db.models import Count, Q
  from django.utils import timezone
  from rest_framework.response import Response
  from rest_framework.views import APIView

  from access import constants as C
  from access.permissions import HasManageUsersOrAssignTestAccess  # the same class UserListView uses
  from users import audience as A
  from users.models import RoleChange, User


  class PopulationView(APIView):
      permission_classes = [HasManageUsersOrAssignTestAccess]

      def get(self, request):
          now = timezone.now()
          learners = User.objects.filter(is_active=True, role__in=C.LEARNER_ROLES)
          body = learners.aggregate(
              centre=Count("id", filter=Q(role=C.ROLE_STUDENT, is_frozen=False)),
              public=Count("id", filter=Q(role=C.ROLE_PUBLIC_STUDENT, is_frozen=False)),
              frozen_debt=Count("id", filter=Q(is_frozen=True, frozen_reason=A.FROZEN_LCUP_DEBT)),
              frozen_admin=Count("id", filter=Q(is_frozen=True) & ~Q(frozen_reason=A.FROZEN_LCUP_DEBT)),
              signups_7d=Count("id", filter=Q(date_joined__gte=now - timedelta(days=7))),
              signups_30d=Count("id", filter=Q(date_joined__gte=now - timedelta(days=30))),
          )
          recent = RoleChange.objects.filter(created_at__gte=now - timedelta(days=30), reverted_at__isnull=True)
          body["joined_30d"] = recent.filter(reason=A.REASON_JOINED).count()
          body["left_30d"] = recent.filter(reason__in=(A.REASON_LEFT, A.REASON_LEFT_WITH_DEBT)).count()
          return Response(body)
  ```
  Import `HasManageUsersOrAssignTestAccess` from wherever `users/views.py` imports it.
- `users/urls.py`: `path("admin/population/", PopulationView.as_view(), name="users-admin-population"),`.

- [ ] **Step 4: Run Task 9's tests, then `users`. Expect OK.**

- [ ] **Step 5: Commit** `feat(users): admin can see who is centre, public or frozen, and how many moved`

---

### Task 10: Frontend — the role, the guard, the navigation, the profile

**Files:** see the File structure. Tests: `frontend/src/lib/__tests__/roles.public.test.ts`, `frontend/src/components/__tests__/AuthGuard.public.test.tsx`, `frontend/src/components/shell/__tests__/navConfig.public.test.ts`.

**Interfaces:**
- Produces (`@/lib/roles`):
  - `CANONICAL_ROLES` now includes `"public_student"`
  - `ROLE_LABELS: Record<CanonicalRole, string>`
  - `isPublicStudent(r)`, `isStudentSiteRole(r)`, `isPublicStudentPath(p)`, `homePathFor(r)`
  - `PUBLIC_STUDENT_HOME = "/mock-exam"`
- Produces (`navConfig.ts`): `publicStudentNav(nav)`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/__tests__/roles.public.test.ts
import { describe, expect, it } from "vitest";
import { homePathFor, isPublicStudent, isPublicStudentPath, isStudentSiteRole, ROLE_LABELS } from "@/lib/roles";

describe("public_student", () => {
  it("is a student-site role with its own home", () => {
    expect(isPublicStudent("public_student")).toBe(true);
    expect(isStudentSiteRole("public_student")).toBe(true);
    expect(isStudentSiteRole("teacher")).toBe(false);
    expect(homePathFor("public_student")).toBe("/mock-exam");
    expect(homePathFor("student")).toBe("/");
    expect(ROLE_LABELS.public_student).toBe("Public student");
  });
  it("may open only mock exams, the runner, events and the profile", () => {
    for (const p of ["/mock-exam", "/mock-exam/result/5", "/exam/9", "/events", "/profile"]) expect(isPublicStudentPath(p)).toBe(true);
    for (const p of ["/", "/classes", "/pastpapers", "/leaderboard", "/mock-examx"]) expect(isPublicStudentPath(p)).toBe(false);
  });
});
```

```ts
// frontend/src/components/shell/__tests__/navConfig.public.test.ts
import { describe, expect, it } from "vitest";
import { flattenNav, publicStudentNav, studentNav } from "@/components/shell/navConfig";

describe("publicStudentNav", () => {
  it("keeps Mock Exam, Events and Profile only", () => {
    const hrefs = flattenNav(publicStudentNav(studentNav)).map((i) => i.href).sort();
    expect(hrefs).toEqual(["/events", "/mock-exam", "/profile"]);
  });
});
```

`AuthGuard.public.test.tsx`: copy the harness from an existing AuthGuard test (grep `__tests__` for `AuthGuard`). Mock `useMe` to return `{ bootState: "AUTHENTICATED", me: { id: 1, role: "public_student", profile_complete: true } }` and `usePathname` to return `"/classes"`. Assert `router.replace` was called with `"/mock-exam"`. With pathname `"/mock-exam"`, assert it was not called.

- [ ] **Step 2: Run, and expect FAIL** (`npx vitest run src/lib/__tests__/roles.public.test.ts src/components/shell/__tests__/navConfig.public.test.ts src/components/__tests__/AuthGuard.public.test.tsx`)

- [ ] **Step 3: Implement**

1. **`lib/roles.ts`**:
   - Add `"public_student"` to `CANONICAL_ROLES`, after `"student"`.
   - Add:
     ```ts
     export const ROLE_LABELS: Record<CanonicalRole, string> = {
       student: "Student", public_student: "Public student", teacher: "Teacher", support_teacher: "Support teacher",
       test_admin: "Test admin", test_auditor: "Test auditor", admin: "Admin", super_admin: "Super admin",
     };
     const norm = (r: unknown) => String(r ?? "").trim().toLowerCase();
     /** Roles whose home is the student site. */
     export const isStudentSiteRole = (r: unknown) => norm(r) === "student" || norm(r) === "public_student";
     export const isPublicStudent = (r: unknown) => norm(r) === "public_student";
     export const PUBLIC_STUDENT_HOME = "/mock-exam";
     /** What a public learner may open (owner, 2026-10-13: mock exams + events + the profile). The runner is
      *  /exam/<id>; the backend decides which attempts it serves them. */
     const PUBLIC_STUDENT_PATH_PREFIXES = ["/mock-exam", "/exam", "/events", "/profile"] as const;
     export function isPublicStudentPath(p: string): boolean {
       return PUBLIC_STUDENT_PATH_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
     }
     export const homePathFor = (r: unknown) => (isPublicStudent(r) ? PUBLIC_STUDENT_HOME : "/");
     ```
2. **`AuthGuard.tsx`**:
   - `const pathname = usePathname() || "";`
   - `const isPublic = roleRaw === "public_student";`
   - `const isStudent = roleRaw === "student" || isPublic;`
   - `const publicBlocked = isPublic && consoleMode === "main" && !isPublicStudentPath(pathname);`
   - In the role effect, after the `adminOnly` branch: `if (publicBlocked) { router.replace(PUBLIC_STUDENT_HOME); return; }`. Add `publicBlocked` to the deps.
   - Extend `willRedirectAway` with `|| publicBlocked`.
3. **`app/login/page.tsx`**: `getRedirectTarget(role?: unknown)` returns `homePathFor(role)` instead of `"/"`. `completeLogin` passes `me?.role` from the `getMe()` it already makes.
4. **`ExamRunnerPage.tsx`**:
   - `:112`: `const isAdmin = role !== "" && !isStudentSiteRole(role);`
   - `:786`: `router.push(inShell ? DESKTOP_HOME : homePathFor(role));`
5. **`EventInviteDialog.tsx:70`**: `const eligible = isStudentSiteRole(role) && !onEventsRoute && featured != null;`
6. **`profileModel.ts` `roleLabel`**: `if (r === "public_student") return "Student";`
7. **`navConfig.ts`**: add `publicStudentNav`, using the code below. **`StudentAppShell.tsx`**:
   - `const isPublic = isPublicStudent(m?.role);`
   - `const isReviewer = !isPublic && isReviewerRole(m?.role);`
   - `nav = isPublic ? publicStudentNav(studentNav) : ...`
   - Header slot: `isPublic ? <EventsHeaderButton /> : <StudentHeaderExtras />`.
   - Account menu: `isPublic ? <EventsMenuRow /> : <StudentAccountMenuRows />`.
   - `<StudentPrompts surveys={!isPublic} />`.
   ```ts
   import { isPublicStudentPath } from "@/lib/roles";
   /** The student IA cut to what a public learner may open. A group left with one route collapses into it. */
   export function publicStudentNav(nav: NavSection[]): NavSection[] {
     const keep = (items: NavItem[]): NavItem[] =>
       items.flatMap((i) => {
         if (i.children?.length) {
           const kids = keep(i.children);
           if (!kids.length) return [];
           return kids.length === 1 ? kids : [{ ...i, children: kids }];
         }
         return i.href && isPublicStudentPath(i.href) ? [i] : [];
       });
     return nav.map((s) => ({ ...s, items: keep(s.items) })).filter((s) => s.items.length > 0);
   }
   ```
8. **`StudentHeaderExtras.tsx`**:
   - Move the Events button (`:29-52` and the JSX at `:104-124`) into `export function EventsHeaderButton()`, unchanged.
   - Move the mobile Events row (`:167-168` and `:205-219`) into `export function EventsMenuRow()`.
   - `StudentHeaderExtras` and `StudentAccountMenuRows` render these in the old places, so the centre view is byte-for-byte the same.
9. **`StudentPrompts.tsx`**: `({ surveys = true }: { surveys?: boolean })` renders `{surveys ? <SurveyInviteDialog /> : null}<EventInviteDialog />`.
10. **`app/(main)/profile/page.tsx`**: for a public learner (`isPublicStudent(sessionMe?.role)`):
    - tabs = `[settings]` only, initial tab `"settings"`;
    - ignore `?tab=` values other than `settings`;
    - skip `classesApi.list()` (resolve an empty list) and skip the rewards, homework and attempts loaders.
11. **`features/mock/MockList.tsx`**: do not render `<MockSessionPanel />` when `isPublicStudent(me?.role)`.

- [ ] **Step 4: Run Task 10's tests and the existing tests of every touched file, then `npx tsc --noEmit`, `npx eslint <touched files>`. Expect all green.**

Also run the full `npx vitest run`; baseline is all green.

- [ ] **Step 5: Commit** `feat(frontend): public learners see mock exams, events and their profile — nothing else`

---

### Task 11: Frontend — admin users list, population card, broadcast page

**Files:**
- Modify: `frontend/src/app/(ops)/ops/users/page.tsx:62,93,95-113,492,756-769,880-986`, `frontend/src/app/(ops)/ops/page.tsx`, `frontend/src/app/(ops)/layout.tsx:40-166` (OPS_NAV, super-admin-only like `/ops/mobile`), `frontend/src/features/notifications/notificationsApi.ts`
- Create: `frontend/src/lib/usersAdminApi.ts`, `frontend/src/app/(ops)/ops/broadcast/page.tsx`, `frontend/src/app/(ops)/ops/broadcast/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `GET /users/admin/population/`, `GET /users/admin/list/?kind=`, `POST /notifications/broadcast/`.
- Produces:
  - `usersAdminApi.population(): Promise<Population>`
  - `notificationsApi.broadcast(p: { title: string; body?: string; link_url?: string; audience: BroadcastAudience; push?: boolean })`, returning the counts the backend view returns (read its `Response(...)` in `notifications/views.py`).

- [ ] **Step 1: Write the failing test** (`broadcast/__tests__/page.test.tsx`). Render the page with `notificationsApi.broadcast` mocked, choose "Public students", fill the title, submit, confirm. Assert it was called with `{ title: "Hello", audience: "public_students", push: false }`. Also assert the three student audiences are offered: "Learning center students", "Public students", "All students".

- [ ] **Step 2: Run, and expect FAIL**

- [ ] **Step 3: Implement**
- **Users page:**
  - `RoleFilter = "all" | CanonicalRole`; `ALL_ROLES = CANONICAL_ROLES`.
  - Use `ROLE_LABELS` from `@/lib/roles`; add `public_student: "bg-sky-100 text-sky-800"` to `ROLE_COLORS`.
  - Add `<option value="public_student">Public students</option>`.
  - A new **Kind** select (`all`, `centre` "Learning center", `public` "Public", `frozen_debt` "Frozen — debt", `frozen_admin` "Frozen — admin") sent as `kind`, beside `role`.
  - A **Kind** column showing a badge from `u.kind`.
  - Counts in the header from `usersAdminApi.population()`: "Learning center N · Public N · Frozen — debt N".
  - Seed `roleFilter` and `kindFilter` from `?role=` / `?kind=` (`useSearchParams`), so the dashboard links work.
- **`ops/page.tsx`**: a "Learners" card above Quick access, from `usersAdminApi.population()`, showing:
  - centre / public / frozen-debt, each a link to `/ops/users?kind=…`;
  - "New sign-ups: N this week, M this month";
  - "Joined the learning center: J · Left: L (last 30 days)".
  
  Loading and error states: an error shows a retry, never zeros (error state ≠ empty state).
- **Broadcast page** (super_admin only; OPS_NAV entry "Broadcast", icon `Megaphone`, beside `/ops/mobile`):
  - title, body, link URL and push toggle;
  - an audience select: `centre_students` "Learning center students", `public_students` "Public students", `all_students` "All students", `teachers` "Teachers", `staff` "Staff", `all` "Everyone";
  - a confirm step showing the audience; then a result line with the count the API returns.
  
  Copy: English, "learning center".

- [ ] **Step 4: Run Task 11's tests and the users-page tests, then `npx tsc --noEmit`, eslint, the full vitest run.**

- [ ] **Step 5: Commit** `feat(ops): learners by kind, a population card, and a broadcast page with audiences`

---

### Task 12: Verification, PR

- [ ] **Backend** (only a literal `OK` counts): `python3 manage.py test users access lcup classes exams mocks events notifications midterms desktop rewards`. The `classes` baseline is 0 red. Also `manage.py check` and `makemigrations --check`.
- [ ] **Postgres**: apply all migrations on a fresh Postgres (initdb in the scratchpad, `DATABASE_URL=postgres://dsat_probe@127.0.0.1:55432/postgres`), then run `users lcup` there.
- [ ] **Frontend**: `npx tsc --noEmit` (0 errors, no `.next`), eslint on touched files, full `npx vitest run`.
- [ ] **Push and open the PR** (Viltrumlik). The body covers: the decisions, the deploy steps below, the empty `mocks.Mock` table on prod (0 mocks: public learners see an empty Mock page until mocks are published), and the iOS/Windows refusal.

### Deploy (owner approved "immediately")

1. **Migrate first** on the live DB, with the live venv and `lock_timeout`, guarding the exact plan:
   - `users.0029` adds a choices AlterField, an AddField with db_default, and a CreateModel;
   - `lcup.0002` adds two nullable AddFields.
   
   Take a fresh `pg_dump` first.
2. **Zero-downtime full release switch**: `bg-phaseA.<sha>.sh` + `bg-phaseB.sh`. `PUBLIC_SPLIT_ENABLED` is still absent.
3. **Wait for one sync**, so `LcupStudentLink.balance` is filled.
4. **Split**: `manage.py split_public_students --dry-run`, then `--apply`. Record the JSON in the PR.
5. **Switch on**: add `PUBLIC_SPLIT_ENABLED=True` to `shared/backend.env`, then reload with zero downtime: TTIN/TTOU + celery restart.
6. **Smoke** (a test public account):
   - `/mock-exam` loads;
   - `/api/classes/` → 403 `centre_only`;
   - a centre student is unaffected;
   - the iOS login refusal works;
   - the next sync is ok with no role changes.

**Rollback**: remove `PUBLIC_SPLIT_ENABLED`, reload, then run `split_public_students --revert`.
