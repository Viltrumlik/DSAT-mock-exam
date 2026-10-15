# Ops Detail Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person and every class in `/ops` gets a Django-admin "change form" page. Students, Public users and Staff open `/ops/<section>/<id>`; Classrooms becomes a changelist plus a `/ops/classrooms/<id>` detail page.

**Architecture:** Approach A, approved in chat on 2026-10-15.
- **Core endpoint:** each page has a fast one with identity, form fields, groups, lc-up, and duplicates or staff classes.
- **Parts:** the slower parts (attendance, results, sessions, history) each have their own endpoint and load independently. A slow or failing part never blanks the page.
- **Writes:** they reuse the existing endpoints (`PATCH /users/<id>/update/`, `POST /users/admin/bulk/`, the classes roster and governance endpoints). "Log out everywhere" is the only new write endpoint.
- **Admin audit:** admin edits are newly recorded as `SecurityAuditEvent` rows on the target account, so no migration is needed.
- **lc-up guard:** for lc-up-paired classes, the server refuses changes to the fields lc-up owns, to the teacher, and to the class's existence. The roster is already refused.

**Tech Stack:** Django 6 + DRF (backend/), Next.js App Router + TanStack Query + vitest (frontend/).

**Spec:** none, by owner preference ("spec=code"). The design approved in chat on 2026-10-15 is summarised in "Design decisions" below. Executors read this plan only.

## Owner requests (verbatim)
- "opsda o'quvchilar detaillarini ham o'zgartirish kerak dizayn va fieldlarini. shunga o'xshash suggestionlar bering ops uchun"
- Sections chosen: all four.
  - Groups + lc-up/payments
  - Attendance + results
  - Security + sessions
  - History + duplicates
- Scope chosen: Public + Staff pages, Classrooms list + detail, and the "never signed in" filter (announced).
- Deferred: the system status page, and list tools (⌘K, bulk actions, Excel, saved filters, recent actions).

## Design decisions (from the approved chat design + code facts)

**Pages and layout**

1. **URLs:** `/ops/students/<id>`, `/ops/public/<id>`, `/ops/staff/<id>`, `/ops/classrooms/<id>`.
   - A changelist row links to its page. The first cell is a real link, so it can open in a new tab.
   - The list's query string travels as `?_changelist_filters=<urlencoded>`, as in Django. "Back" and the breadcrumb return to the filtered list.
2. **Wrong section:** a person opened under the wrong section (for example, the sync moved them from student to public) is sent to the right section's URL with `router.replace`.
3. **Layout:**
   - A title row with name, status line and last seen; actions on the right.
   - On `lg+`, two columns: the form on the left (Profile, Account) with one **Save** at its foot; Groups and lc-up & payments on the right.
   - Below, full width: Attendance, Results, Security, History, Same-name accounts.
   - One column at phone width.
4. **Style:** minimal, like Django admin.
   - Plain text: no badges, no tints, no gradients, no icons in headings.
   - Each section is a box with a thin header bar.
   - Tables are dense (34px rows, like the changelist).
   - All copy is English.

**What each section shows and allows**

5. **SAT goal is read-only.** `UserSerializer` does not carry `sat_exam_date`/`target_*`, and it also backs public registration. The student sets these themselves; ops only shows them.
6. **Groups:**
   - A class paired with lc-up (`lcup.guards.is_lcup_managed`) shows the seat read-only with "Change in lc-up".
   - An unpaired class offers **Remove** (`PATCH /classes/<cid>/members/<uid>/ {"status":"REMOVED"}`).
   - **Add to class** lists only active unpaired classes (core `open_classes`).
   - A public user seated in a class becomes a student at the next sync (seat rule); the UI says so.
7. **lc-up & payments** are read-only: `lcup.finance.student_finance(user)` plus link status, lc-up id, `debt_freeze_exempt_at` and the phone-prompt state.
8. **Freeze reason:**
   - `frozen_reason == "lcup_debt"` shows "Frozen — unpaid (lifts when paid)".
   - Any other freeze shows "Frozen — by admin".
   - The **Freeze / Unfreeze** action posts to `/users/admin/bulk/` with one id, which already clears `frozen_reason`.
9. **Homework has no "late"** in this codebase. Homework shows completed / total per class, plus the **overdue** list: published, non-classwork, `due_at < now`, not turned in.
10. **Signup provenance is not stored.** The page shows only what exists: Telegram linked (`telegram_id`), created by lc-up (`LcupStudentLink.status == "created"`), email verified, and date joined.
11. **"Never signed in"** means no `RefreshSession` row at all.
    - `last_login` is never written by JWT login, and sessions are never pruned.
    - Prod on 2026-10-15: 49 students and 127 public accounts.
12. **Log out everywhere** revokes every live `RefreshSession` with `users.views._revoke_session_rows`, the same function behind the user's own "sign out everywhere".
    - It does NOT set `security_step_up_required_until`.
    - An open tab keeps working until its 3-hour access token expires; the confirm text says so.

**Audit and history**

13. **Admin audit** records these events:

    | Action | Event | Detail |
    |---|---|---|
    | `PATCH /users/<id>/update/` | `admin_user_update` | `{actor_id, actor, changes: {field: [old, new]}, password_changed?}` |
    | Bulk freeze or unfreeze that changes state | `admin_freeze` / `admin_unfreeze` | |
    | Log out everywhere | `admin_revoke_sessions` | |

    A password value is never recorded. History starts from deploy; older admin edits were never recorded.
14. **History** merges these sources, newest first, capped at 200:
    - RoleChange
    - ClassroomMembershipEvent (student = this user)
    - SecurityAuditEvent, minus the noise types `ping`, `hello`, `refresh_reuse_grace`
    - LcupPayment

**Permissions and guards**

15. **Permissions:**
    - Reads use `HasManageUsersOrAssignTestAccess` plus `users.views.manageable_users_queryset(actor)`. An out-of-scope id returns 404, the same as a missing one.
    - Mutations use `HasManageUsers` and the same scope. Acting on your own account returns 400.
    - Classroom pages allow a superuser or role `super_admin`/`admin`, the same rule as `_AdminClassroomGovernanceView._guard`.
16. **lc-up owns these class fields** (from `lcup/follow.py follow_details` plus archive/reopen): `name, subject, level, lesson_days, lesson_time, lesson_hours, branch, room_number, start_date, is_active`.
    - On a managed class, `PATCH /classes/<id>/details/` answers 409 `lcup_managed` when the payload CHANGES any of them. Sending them unchanged is fine, because the form posts whole.
    - Assign teacher, transfer ownership and governance delete answer 409 on a managed class.
    - TA (support teacher) seats stay ours.

**Bug fixed on the way**

17. `PEOPLE_FILTER_KEYS` lacks `dupes`, so the live "Duplicates" filter renders but does nothing. Add `dupes` and the new `signin`.

## Global Constraints
- **Where to work:** only in `/Users/macbook/Projects/dsat-wt-ops-detail`. Never switch or edit the primary checkout `/Users/macbook/Projects/DSAT-mock-exam`.
- **Commits:**
  - Author `Viltrumlik <viltrumlik@gmail.com>`; check `git config user.email` first.
  - Messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `git add -A`; add the files you changed by name.
- **Backend tests:** `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test <label> --settings=config.settings_test_nomigrations -v 1`. Only a literal `OK` line is green.
- **Frontend tests:** `cd frontend && npx vitest run <path>`.
- **Typecheck:** `cd frontend && rm -rf .next/dev/types && npx tsc --noEmit -p tsconfig.json`. A run that shows only `.next/` or TS1xxx errors proves nothing.
- **Secrets:** never return or log a refresh JTI, a token or a password.
- **Error is not empty:** every part renders exactly one of loading, error with "Retry", "Nothing yet", or data.
- **Ops UI:**
  - Copy is English.
  - Tables follow the density and tokens of `features/ops/changelist/ChangeList.tsx`: `border-border`, `bg-card`, `text-muted-foreground`, `text-primary` for links, and `text-danger` only for money owed.
  - Plain text everywhere: no badge pills, no tints.

---

## File map

**PR 1 — people pages (branch `feat/ops-detail-pages`)**

| File | Responsibility |
|---|---|
| `backend/users/admin_audit.py` (new) | event names, `snapshot`, `log_admin_update`, `log_admin_action` |
| `backend/users/views.py` (modify) | `UserUpdateView.perform_update` + `UserBulkActionView` call the audit |
| `backend/lcup/guards.py` (modify) | `lcup_managed_ids(classroom_ids) -> set[int]` |
| `backend/users/people_detail.py` (new) | `section_of`, `person_core(user) -> dict` |
| `backend/users/people_parts.py` (new) | `attendance_part`, `results_part`, `security_part`, `history_part` |
| `backend/users/views_people_detail.py` (new) | `PersonDetailView`, `PersonPartView`, `PersonRevokeSessionsView` |
| `backend/users/urls.py` (modify) | 3 routes |
| `backend/users/views_people.py` (modify) | `signin` filter for students + public |
| tests (backend) | `backend/users/tests/test_admin_audit.py`, `test_people_detail.py`, `test_people_parts.py` (new); `test_people_api.py` (+signin) |
| `frontend/src/features/ops/changelist/ChangeList.tsx` (modify) | `rowHref` prop |
| `frontend/src/features/ops/changelist/peopleApi.ts` (modify) | `dupes`, `signin` keys |
| `frontend/src/features/ops/changelist/backLink.ts` (new) | `withListFilters(href, qs)`, `listHrefFrom(search, listPath)` |
| `frontend/src/features/ops/users/PeopleList.tsx` (modify) | rows link to the person page; no modal |
| `frontend/src/features/ops/people/personApi.ts` (new) | types + `usePerson`, `usePersonPart`, `personActions` |
| `frontend/src/features/ops/people/Fieldset.tsx` (new) | section box + `PartBody` state renderer + `Row` |
| `frontend/src/features/ops/people/PersonPage.tsx` (new) | layout, header, actions, wrong-section redirect |
| `frontend/src/features/ops/people/PersonForm.tsx` (new) | the form; logic moved from `EditUserModal` |
| `frontend/src/features/ops/people/sections/*.tsx` (new) | Groups, Lcup, Duplicates, StaffClasses, Attendance, Results, Security, History |
| `frontend/src/app/(ops)/ops/{students,public,staff}/[id]/page.tsx` (new) | thin pages |
| `frontend/src/features/ops/users/EditUserModal.tsx` (delete) | replaced by PersonForm |

**PR 2 — classrooms (branch `feat/ops-classrooms`, stacked on PR 1, targets `main`)**

| File | Responsibility |
|---|---|
| `backend/lcup/guards.py` (modify) | `LCUP_OWNED_CLASS_FIELDS`, `lcup_owned_changes(classroom, data)`, `lcup_managed_response(fields, detail)` |
| `backend/classes/views_assign.py` (modify) | 409 guards on details PATCH / assign / transfer / delete |
| `backend/users/changelist.py` (new) | `apply_search`, `facets`, `paginate` shared by people + classrooms |
| `backend/users/views_people.py` (modify) | use `users.changelist` (behaviour unchanged) |
| `backend/classes/ops_classrooms.py` (new) | changelist defs, `class_row`, `classroom_core`, parts |
| `backend/classes/views_ops_classrooms.py` (new) | `ClassroomChangeListView`, `ClassroomDetailView`, `ClassroomPartView` |
| `backend/classes/urls.py` (modify) | 3 routes |
| tests | `backend/lcup/tests_guards.py` (+), `backend/classes/tests_ops_classrooms.py` (new) |
| `frontend/src/features/ops/classrooms/*` (new) | api, list, create modal (moved), page, form, sections |
| `frontend/src/app/(ops)/ops/classrooms/page.tsx` (replace), `[id]/page.tsx` (new) | |

---

# PR 1 — People pages

### Task 1: Audit admin edits

**Files:**
- Create: `backend/users/admin_audit.py`
- Modify: `backend/users/views.py` (`UserUpdateView.perform_update` ~line 1196; `UserBulkActionView.post` freeze/unfreeze branches ~line 1275)
- Test: `backend/users/tests/test_admin_audit.py`

**Interfaces:**
- Produces:
  - constants `ADMIN_UPDATE="admin_user_update"`, `ADMIN_FREEZE="admin_freeze"`, `ADMIN_UNFREEZE="admin_unfreeze"`, `ADMIN_REVOKE_SESSIONS="admin_revoke_sessions"`, and the tuple `ADMIN_EVENT_TYPES`;
  - `snapshot(user) -> dict`;
  - `log_admin_update(*, request, user, before: dict, password_changed: bool) -> None`;
  - `log_admin_action(*, request, user_id: int, event_type: str, **extra) -> None`.

- [ ] **Step 1: Write the failing tests**

```python
"""Admin edits leave a trail on the account they changed (plan 2026-10-15-ops-detail-pages)."""

import json

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from users.models import SecurityAuditEvent, User

HOST = "admin.mastersat.uz"


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class AdminAuditTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role=C.ROLE_ADMIN,
                                              first_name="Bo", last_name="Ss")
        self.kid = User.objects.create_user(None, password="old-pass-123", username="kid", role=C.ROLE_STUDENT,
                                            first_name="Ali", last_name="Valiyev")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def events(self, kind):
        return list(SecurityAuditEvent.objects.filter(user=self.kid, event_type=kind))

    def test_an_edit_records_who_and_what_changed(self):
        r = self.api.patch(f"/api/users/{self.kid.pk}/update/", {"first_name": "Aziz", "phone_number": "998901112233"},
                           format="json", HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 200, r.content)
        (ev,) = self.events("admin_user_update")
        self.assertEqual(ev.detail["actor_id"], self.admin.pk)
        self.assertEqual(ev.detail["actor"], "Bo Ss")
        self.assertEqual(ev.detail["changes"]["first_name"], ["Ali", "Aziz"])
        self.assertEqual(ev.detail["changes"]["phone_number"], [None, "998901112233"])
        self.assertNotIn("last_name", ev.detail["changes"])

    def test_a_password_is_recorded_as_changed_never_by_value(self):
        self.api.patch(f"/api/users/{self.kid.pk}/update/", {"password": "Secret-Value-987"}, format="json",
                       HTTP_HOST=HOST)
        (ev,) = self.events("admin_user_update")
        self.assertTrue(ev.detail["password_changed"])
        self.assertNotIn("Secret-Value-987", json.dumps(ev.detail))

    def test_a_save_that_changes_nothing_records_nothing(self):
        self.api.patch(f"/api/users/{self.kid.pk}/update/", {"first_name": "Ali"}, format="json", HTTP_HOST=HOST)
        self.assertEqual(self.events("admin_user_update"), [])

    def test_a_bulk_freeze_and_unfreeze_are_recorded_once_each(self):
        for action in ("freeze", "freeze", "unfreeze"):
            self.api.post("/api/users/admin/bulk/", {"action": action, "ids": [self.kid.pk]}, format="json",
                          HTTP_HOST=HOST)
        self.assertEqual(len(self.events("admin_freeze")), 1)  # the second freeze changed nothing
        self.assertEqual(len(self.events("admin_unfreeze")), 1)
        self.assertEqual(self.events("admin_freeze")[0].detail["actor_id"], self.admin.pk)

    def test_unfreezing_a_debt_freeze_says_it_was_one(self):
        User.objects.filter(pk=self.kid.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.api.post("/api/users/admin/bulk/", {"action": "unfreeze", "ids": [self.kid.pk]}, format="json",
                      HTTP_HOST=HOST)
        (ev,) = self.events("admin_unfreeze")
        self.assertEqual(ev.detail["was_reason"], "lcup_debt")
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd backend && SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 python3 manage.py test users.tests.test_admin_audit --settings=config.settings_test_nomigrations -v 1`
Expected: FAIL. `events("admin_user_update")` is empty.

- [ ] **Step 3: Implement `backend/users/admin_audit.py`**

```python
"""Who changed an account from /ops, and what (plan 2026-10-15-ops-detail-pages).

Each edit an admin makes to another account is a ``SecurityAuditEvent`` on the TARGET account with the
admin in ``detail``: the model has no actor column, and a new table is not worth a migration. A password
is recorded as changed, never by value. The person page's History reads these back.
"""

from __future__ import annotations

from .security_audit import log_security_event

ADMIN_UPDATE = "admin_user_update"
ADMIN_FREEZE = "admin_freeze"
ADMIN_UNFREEZE = "admin_unfreeze"
ADMIN_REVOKE_SESSIONS = "admin_revoke_sessions"
ADMIN_EVENT_TYPES = (ADMIN_UPDATE, ADMIN_FREEZE, ADMIN_UNFREEZE, ADMIN_REVOKE_SESSIONS)

#: The fields whose before and after are kept.
TRACKED = ("first_name", "last_name", "username", "email", "phone_number", "role", "subject", "is_frozen")


def snapshot(user) -> dict:
    return {f: getattr(user, f, None) for f in TRACKED}


def actor_of(request) -> dict:
    a = getattr(request, "user", None)
    name = f"{getattr(a, 'first_name', '') or ''} {getattr(a, 'last_name', '') or ''}".strip()
    return {"actor_id": getattr(a, "pk", None), "actor": name or getattr(a, "username", "") or ""}


def log_admin_update(*, request, user, before: dict, password_changed: bool) -> None:
    after = snapshot(user)
    changes = {f: [before.get(f), after[f]] for f in TRACKED if before.get(f) != after[f]}
    if not changes and not password_changed:
        return
    detail = {**actor_of(request), "changes": changes}
    if password_changed:
        detail["password_changed"] = True
    log_security_event(user_id=user.pk, event_type=ADMIN_UPDATE, request=request, detail=detail)


def log_admin_action(*, request, user_id: int, event_type: str, **extra) -> None:
    log_security_event(user_id=user_id, event_type=event_type, request=request, detail={**actor_of(request), **extra})
```

- [ ] **Step 4: Hook it into `backend/users/views.py`**

At the top, add `from . import admin_audit`. In `UserUpdateView`, replace `perform_update`. The existing `logger.info(...)` call stays unchanged, after the audit line:

```python
    def perform_update(self, serializer):
        before = admin_audit.snapshot(serializer.instance)
        super().perform_update(serializer)
        inst = serializer.instance
        admin_audit.log_admin_update(
            request=self.request, user=inst, before=before,
            password_changed=bool(serializer.validated_data.get("password")),
        )
        actor = self.request.user
        logger.info(
            "user_updated target_id=%s role=%s subject=%s actor_id=%s is_superuser=%s",
            inst.pk,
            inst.role,
            getattr(inst, "subject", None),
            getattr(actor, "pk", None),
            getattr(actor, "is_superuser", False)
            or normalized_role(actor) == acc_const.ROLE_SUPER_ADMIN,
        )
```

In `UserBulkActionView.post`, the freeze and unfreeze branches become:

```python
                    if action == "freeze":
                        was = target.is_frozen
                        target.is_frozen, target.frozen_reason = True, ""
                        target.save(update_fields=["is_frozen", "frozen_reason"])
                        if not was:
                            admin_audit.log_admin_action(request=request, user_id=uid, event_type=admin_audit.ADMIN_FREEZE)
                        results.append({"id": uid, "ok": True, "is_frozen": True})
                    elif action == "unfreeze":
                        was, was_reason = target.is_frozen, target.frozen_reason
                        target.is_frozen, target.frozen_reason = False, ""
                        target.save(update_fields=["is_frozen", "frozen_reason"])
                        if was:
                            admin_audit.log_admin_action(
                                request=request, user_id=uid, event_type=admin_audit.ADMIN_UNFREEZE,
                                was_reason=was_reason or "",
                            )
                        results.append({"id": uid, "ok": True, "is_frozen": False})
```

- [ ] **Step 5: Run the new tests and the neighbours**

Run the backend command with labels `users.tests.test_admin_audit users.tests.test_people_api`. Add the bulk and update tests too: run `grep -rl "admin/bulk\|/update/" backend/users/tests` and add each module's label.
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add backend/users/admin_audit.py backend/users/views.py backend/users/tests/test_admin_audit.py
git commit -m "feat(ops): an admin's edit, freeze and unfreeze are recorded on the account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Person core endpoint

**Files:**
- Modify: `backend/lcup/guards.py` (add `lcup_managed_ids`)
- Create: `backend/users/people_detail.py`, `backend/users/views_people_detail.py`
- Modify: `backend/users/urls.py`
- Test: `backend/users/tests/test_people_detail.py`

**Interfaces:**
- Consumes: `users.views.manageable_users_queryset`, `users.audience.kind_of`, `users.activity.with_activity_counts`, `lcup.finance.student_finance`.
- Produces:
  - `lcup.guards.lcup_managed_ids(classroom_ids) -> set[int]`;
  - `users.people_detail.section_of(user) -> str` (`"students" | "public" | "staff"`), `iso(value)`, `display_name(u) -> str`, `last_seen_map(user_ids) -> dict`, `status_of(user, section) -> str`, `person_core(user) -> dict`;
  - `users.views_people_detail.scoped_person(request, pk) -> User | None`;
  - route `GET /api/users/admin/people/<int:pk>/` (name `users-admin-person`).

**Core response shape** (every key is always present; `null` where noted):

```json
{
  "id": 7, "section": "students", "username": "aziz", "first_name": "Aziz", "last_name": "Tursunov",
  "name": "Aziz Tursunov", "email": "", "email_verified": false, "phone": "998901234567",
  "role": "student", "subject": "", "status": "centre", "is_frozen": false, "frozen_reason": null,
  "date_joined": "ISO", "last_seen": "ISO|null", "attempt_count": 0,
  "telegram_linked": false, "lcup_created": false,
  "sat": {"exam_date": "YYYY-MM-DD|null", "target_score": null, "target_english": null, "target_math": null},
  "groups": [{"id": 1, "name": "Junior G21 Math", "subject": "MATH", "teacher": "Vali Aliyev",
              "joined_at": "ISO", "lcup_managed": true}],
  "past_groups": [{"id": 2, "name": "Old class", "left_at": "ISO|null"}],
  "open_classes": [{"id": 3, "name": "Own class"}],
  "lcup": null,
  "duplicates": [{"id": 9, "name": "aziz TURSUNOV", "username": "aziz2", "section": "students",
                  "status": "centre", "last_seen": null, "groups": ["Junior G21 Math"]}],
  "staff": null
}
```

- **`frozen_reason`:** `"debt"` when `frozen_reason == "lcup_debt"`, `"admin"` for any other freeze, `null` when the account is not frozen.
- **`lcup`:** `null` when the account is not linked. Otherwise it is `student_finance(user)` plus `{"status", "lcup_student_id", "exempt": bool, "phone_prompt": "pending"|"confirmed"|"not_me"|"superseded"|null}`.
- **`staff`:** `null` for learners. For staff it is `{"lcup_teacher": {"status","name"}|null, "classes": [{"id","name","subject","as":"teacher"|"ta","students":int,"lcup_managed":bool}], "workload": {"classes":int,"students":int,"to_review":int}}`.
- **Lists for staff:** `groups`, `past_groups`, `open_classes` and `duplicates` are `[]`.

- [ ] **Step 1: Write the failing tests** — `backend/users/tests/test_people_detail.py`

```python
"""GET /api/users/admin/people/<id>/ — one account's change form (plan 2026-10-15-ops-detail-pages)."""

from decimal import Decimal

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership, Submission
from lcup.models import GroupLinkStatus, LcupGroupLink, LcupStudentLink, LinkStatus
from users.models import RefreshSession, User

HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST], LCUP_ENABLED=True)
class PersonCoreTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN)
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math", first_name="Vali", last_name="Aliyev")
        self.paired = Classroom.objects.create(name="Junior G21 Math", subject="MATH", created_by=self.teacher,
                                               teacher=self.teacher)
        self.own = Classroom.objects.create(name="Own class", subject="MATH", created_by=self.teacher,
                                            teacher=self.teacher)
        self.old = Classroom.objects.create(name="Old class", subject="MATH", created_by=self.teacher,
                                            teacher=self.teacher, is_active=False)
        LcupGroupLink.objects.create(lcup_group_id=10, name="G21", classroom=self.paired,
                                     status=GroupLinkStatus.CONFIRMED)
        self.aziz = make("aziz", first_name="Aziz", last_name="Tursunov", phone_number="998901234567")
        ClassroomMembership.objects.create(classroom=self.paired, user=self.aziz, role="STUDENT")
        ClassroomMembership.objects.create(classroom=self.old, user=self.aziz, role="STUDENT")
        LcupStudentLink.objects.create(lcup_student_id=1, name="Tursunov Aziz", user=self.aziz,
                                       status=LinkStatus.CREATED, balance=Decimal("-250000"))

    def get(self, pk, user=None):
        api = APIClient()
        api.force_authenticate(user or self.admin)
        return api.get(f"/api/users/admin/people/{pk}/", HTTP_HOST=HOST)

    def test_a_student_opens_with_groups_lcup_and_past_groups(self):
        body = self.get(self.aziz.pk).json()
        self.assertEqual((body["section"], body["status"], body["name"]), ("students", "centre", "Aziz Tursunov"))
        self.assertEqual([(g["name"], g["lcup_managed"]) for g in body["groups"]], [("Junior G21 Math", True)])
        self.assertEqual([g["name"] for g in body["past_groups"]], ["Old class"])
        self.assertEqual(body["open_classes"], [{"id": self.own.pk, "name": "Own class"}])
        self.assertEqual((body["lcup"]["balance"], body["lcup"]["debt"]), (-250000, 250000))
        self.assertEqual(body["lcup"]["status"], "created")
        self.assertTrue(body["lcup_created"])
        self.assertIsNone(body["staff"])

    def test_the_freeze_reason_is_debt_or_admin(self):
        User.objects.filter(pk=self.aziz.pk).update(is_frozen=True, frozen_reason="lcup_debt")
        self.assertEqual(self.get(self.aziz.pk).json()["frozen_reason"], "debt")
        User.objects.filter(pk=self.aziz.pk).update(frozen_reason="")
        self.assertEqual(self.get(self.aziz.pk).json()["frozen_reason"], "admin")

    def test_same_name_accounts_are_listed_but_not_itself(self):
        twin = make("aziz2", C.ROLE_PUBLIC_STUDENT, first_name="aziz", last_name="TURSUNOV")
        dupes = self.get(self.aziz.pk).json()["duplicates"]
        self.assertEqual([(d["id"], d["section"]) for d in dupes], [(twin.pk, "public")])

    def test_last_seen_is_the_newest_session(self):
        RefreshSession.objects.create(user=self.aziz, refresh_jti="a")
        self.assertIsNotNone(self.get(self.aziz.pk).json()["last_seen"])

    def test_staff_get_their_classes_and_workload(self):
        ta = make("ta1", C.ROLE_SUPPORT_TEACHER, subject="math")
        ClassroomMembership.objects.create(classroom=self.own, user=ta, role="TA")
        a = Assignment.objects.create(classroom=self.paired, title="HW1", status="PUBLISHED", created_by=self.teacher)
        Submission.objects.create(assignment=a, student=self.aziz, status="SUBMITTED")
        body = self.get(self.teacher.pk).json()
        self.assertEqual(body["section"], "staff")
        self.assertEqual(sorted((c["name"], c["as"]) for c in body["staff"]["classes"]),
                         [("Junior G21 Math", "teacher"), ("Own class", "teacher")])
        self.assertEqual(body["staff"]["workload"], {"classes": 2, "students": 1, "to_review": 1})
        self.assertEqual([(c["name"], c["as"]) for c in self.get(ta.pk).json()["staff"]["classes"]],
                         [("Own class", "ta")])

    def test_out_of_scope_or_missing_is_404_and_learners_are_403(self):
        self.assertEqual(self.get(999999).status_code, 404)
        self.assertEqual(self.get(self.aziz.pk, user=self.aziz).status_code, 403)
```

Check two names against the code and adjust the test if they differ:
- the minimum required fields of `Assignment` (read `classes/models.py:315`);
- the role constant name `ROLE_SUPPORT_TEACHER` (read `access/constants.py`).

- [ ] **Step 2: Run and see it fail**

Run the backend command with label `users.tests.test_people_detail`.
Expected: 404 for every request (the route does not exist).

- [ ] **Step 3: Add `lcup_managed_ids` to `backend/lcup/guards.py`**

```python
def lcup_managed_ids(classroom_ids) -> set[int]:
    """The classes among ``classroom_ids`` that follow lc-up — ``is_lcup_managed`` for many at once."""
    ids = [i for i in classroom_ids if i is not None]
    if not lcup_enabled() or not ids:
        return set()
    return set(
        LcupGroupLink.objects.filter(
            classroom_id__in=ids, status=GroupLinkStatus.CONFIRMED, deleted_in_lcup_at__isnull=True
        ).values_list("classroom_id", flat=True)
    )
```

- [ ] **Step 4: Implement `backend/users/people_detail.py`**

```python
"""One account for /ops — what its change form opens with (plan 2026-10-15-ops-detail-pages).

The slower parts (attendance, results, sessions, history) are ``users.people_parts``, each its own
request, so a slow or failing part never blanks the page.
"""

from __future__ import annotations

from django.db.models import Count, Max, Q
from django.db.models.functions import Lower

from access import constants as C
from classes.models import Classroom, ClassroomMembership, Submission
from classes.models_membership_audit import ClassroomMembershipEvent

from . import audience as A
from .activity import with_activity_counts
from .models import RefreshSession, User

STUDENT, ACTIVE = ClassroomMembership.ROLE_STUDENT, ClassroomMembership.STATUS_ACTIVE


def section_of(user) -> str:
    if user.role == C.ROLE_STUDENT:
        return "students"
    if user.role == C.ROLE_PUBLIC_STUDENT:
        return "public"
    return "staff"


def iso(value):
    return value.isoformat() if value else None


def display_name(u) -> str:
    if u is None:
        return ""
    return f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username or f"User {u.pk}"


def last_seen_map(user_ids) -> dict:
    rows = RefreshSession.objects.filter(user_id__in=list(user_ids)).values("user_id").annotate(t=Max("last_seen_at"))
    return {r["user_id"]: r["t"] for r in rows}


def status_of(user, section: str) -> str:
    return A.kind_of(user) if section != "staff" else ("frozen" if user.is_frozen else "active")


def _freeze_reason(user):
    if not user.is_frozen:
        return None
    return "debt" if user.frozen_reason == A.FROZEN_LCUP_DEBT else "admin"


def _live_seats(user_ids):
    return ClassroomMembership.objects.filter(
        user_id__in=list(user_ids), role=STUDENT, status=ACTIVE, classroom__is_active=True
    ).select_related("classroom__teacher")


def _groups(user) -> list[dict]:
    from lcup.guards import lcup_managed_ids

    seats = list(_live_seats([user.pk]).order_by("classroom__name"))
    managed = lcup_managed_ids(s.classroom_id for s in seats)
    return [
        {
            "id": s.classroom_id,
            "name": s.classroom.name,
            "subject": s.classroom.subject,
            "teacher": display_name(s.classroom.teacher),
            "joined_at": iso(s.joined_at),
            "lcup_managed": s.classroom_id in managed,
        }
        for s in seats
    ]


def _past_groups(user) -> list[dict]:
    seats = (
        ClassroomMembership.objects.filter(user=user, role=STUDENT)
        .exclude(status=ACTIVE, classroom__is_active=True)
        .select_related("classroom")
        .order_by("classroom__name")
    )
    left = dict(
        ClassroomMembershipEvent.objects.filter(student=user, action=ClassroomMembershipEvent.ACTION_REMOVED)
        .values("classroom_id").annotate(t=Max("created_at")).values_list("classroom_id", "t")
    )
    return [{"id": s.classroom_id, "name": s.classroom.name, "left_at": iso(left.get(s.classroom_id))} for s in seats]


def _open_classes(user) -> list[dict]:
    """Active classes NOT paired with lc-up that this learner is not in — the "Add to class" choices."""
    from lcup.guards import lcup_managed_ids

    mine = ClassroomMembership.objects.filter(user=user, status=ACTIVE).values("classroom_id")
    rooms = list(Classroom.objects.filter(is_active=True).exclude(pk__in=mine).order_by("name").values_list("pk", "name"))
    managed = lcup_managed_ids(pk for pk, _ in rooms)
    return [{"id": pk, "name": name} for pk, name in rooms if pk not in managed]


def _lcup(user):
    from lcup.finance import student_finance
    from lcup.models import LcupPhonePrompt, LcupStudentLink

    link = LcupStudentLink.objects.filter(user=user).first()
    if link is None:
        return None
    prompt = LcupPhonePrompt.objects.filter(user=user).values_list("state", flat=True).first()
    return {
        **student_finance(user),
        "status": link.status,
        "lcup_student_id": link.lcup_student_id,
        "exempt": link.debt_freeze_exempt_at is not None,
        "phone_prompt": prompt,
    }


def same_name_accounts(user) -> list[dict]:
    first, last = (user.first_name or "").strip().lower(), (user.last_name or "").strip().lower()
    if not first or not last:
        return []
    twins = list(
        User.objects.filter(role__in=C.LEARNER_ROLES, is_active=True)
        .exclude(pk=user.pk)
        .annotate(f=Lower("first_name"), l=Lower("last_name"))
        .filter(f=first, l=last)
        .order_by("pk")
    )
    seen = last_seen_map(t.pk for t in twins)
    groups: dict[int, list[str]] = {}
    for s in _live_seats(t.pk for t in twins).order_by("classroom__name"):
        groups.setdefault(s.user_id, []).append(s.classroom.name)
    out = []
    for t in twins:
        section = section_of(t)
        out.append({
            "id": t.pk, "name": display_name(t), "username": t.username, "section": section,
            "status": status_of(t, section), "last_seen": iso(seen.get(t.pk)), "groups": groups.get(t.pk, []),
        })
    return out


def _staff(user) -> dict:
    from lcup.guards import lcup_managed_ids
    from lcup.models import LcupTeacherLink

    seats = Count("memberships", filter=Q(memberships__role=STUDENT, memberships__status=ACTIVE), distinct=True)
    taught = list(Classroom.objects.filter(teacher=user, is_active=True).annotate(n=seats).order_by("name"))
    ta_ids = ClassroomMembership.objects.filter(
        user=user, role=ClassroomMembership.ROLE_TA, status=ACTIVE
    ).values("classroom_id")
    ta = list(
        Classroom.objects.filter(is_active=True, pk__in=ta_ids).exclude(teacher=user).annotate(n=seats).order_by("name")
    )
    rooms = [(c, "teacher") for c in taught] + [(c, "ta") for c in ta]
    managed = lcup_managed_ids(c.pk for c, _ in rooms)
    ids = [c.pk for c, _ in rooms]
    students = (
        ClassroomMembership.objects.filter(classroom_id__in=ids, role=STUDENT, status=ACTIVE)
        .values("user_id").distinct().count()
    )
    to_review = Submission.objects.filter(assignment__classroom_id__in=ids, status=Submission.STATUS_SUBMITTED).count()
    link = LcupTeacherLink.objects.filter(user=user).first()
    return {
        "lcup_teacher": {"status": link.status, "name": link.name} if link else None,
        "classes": [
            {"id": c.pk, "name": c.name, "subject": c.subject, "as": role, "students": c.n,
             "lcup_managed": c.pk in managed}
            for c, role in rooms
        ],
        "workload": {"classes": len(rooms), "students": students, "to_review": to_review},
    }


def person_core(user) -> dict:
    from lcup.models import LcupStudentLink, LinkStatus

    section = section_of(user)
    counted = with_activity_counts(User.objects.filter(pk=user.pk)).values_list("attempt_count", flat=True).first()
    learner = section != "staff"
    return {
        "id": user.pk,
        "section": section,
        "username": user.username or "",
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "name": display_name(user),
        "email": user.email or "",
        "email_verified": bool(user.email_verified),
        "phone": user.phone_number or "",
        "role": user.role,
        "subject": user.subject or "",
        "status": status_of(user, section),
        "is_frozen": user.is_frozen,
        "frozen_reason": _freeze_reason(user),
        "date_joined": iso(user.date_joined),
        "last_seen": iso(last_seen_map([user.pk]).get(user.pk)),
        "attempt_count": counted or 0,
        "telegram_linked": bool(user.telegram_id),
        "lcup_created": LcupStudentLink.objects.filter(user=user, status=LinkStatus.CREATED).exists(),
        "sat": {
            "exam_date": iso(user.sat_exam_date),
            "target_score": user.target_score,
            "target_english": user.target_english,
            "target_math": user.target_math,
        },
        "groups": _groups(user) if learner else [],
        "past_groups": _past_groups(user) if learner else [],
        "open_classes": _open_classes(user) if learner else [],
        "lcup": _lcup(user) if learner else None,
        "duplicates": same_name_accounts(user) if learner else [],
        "staff": None if learner else _staff(user),
    }
```

- [ ] **Step 5: Implement `backend/users/views_people_detail.py` and the route**

```python
"""/ops person pages: ``GET /api/users/admin/people/<id>/`` and its parts (plan 2026-10-15-ops-detail-pages).

Whoever can see a person in the people lists can open them; anyone else, and a missing id, get 404.
"""

from __future__ import annotations

from rest_framework.response import Response
from rest_framework.views import APIView

from access.permissions import HasManageUsersOrAssignTestAccess

from .people_detail import person_core
from .views import manageable_users_queryset


def scoped_person(request, pk):
    return manageable_users_queryset(request.user).filter(pk=pk).first()


class PersonDetailView(APIView):
    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request, pk: int):
        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(person_core(user))
```

In `backend/users/urls.py`, import `from .views_people_detail import PersonDetailView` and add this after the `admin/people/` route:

```python
    path('admin/people/<int:pk>/', PersonDetailView.as_view(), name='users-admin-person'),
```

- [ ] **Step 6: Run until `OK`** with labels `users.tests.test_people_detail users.tests.test_people_api lcup.tests_guards`.

- [ ] **Step 7: Commit**

```bash
git add backend/lcup/guards.py backend/users/people_detail.py backend/users/views_people_detail.py backend/users/urls.py backend/users/tests/test_people_detail.py
git commit -m "feat(ops): one person's change-form data — groups, lc-up, same-name accounts, staff classes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Person parts + log out everywhere

**Files:**
- Create: `backend/users/people_parts.py`
- Modify: `backend/users/views_people_detail.py`, `backend/users/urls.py`
- Test: `backend/users/tests/test_people_parts.py`

**Interfaces:**
- Consumes:
  - from Task 2: `users.people_detail.iso`;
  - from Task 1: `users.admin_audit.ADMIN_EVENT_TYPES`, `ADMIN_REVOKE_SESSIONS`, `log_admin_action`;
  - `users.views._revoke_session_rows(qs) -> int`;
  - `classes.progress._attendance_for(classroom, student)` and `_homework_for(classroom, student)`;
  - `classes.analytics._academic_assignments(classroom)` and `_completion_map(classroom, ids, assignments)`;
  - `rewards.services.xp_balance(student)`.
- Produces:
  - `PARTS = {"attendance": attendance_part, "results": results_part, "security": security_part, "history": history_part}`, each `(user) -> dict`;
  - `GET /api/users/admin/people/<pk>/<part>/` (name `users-admin-person-part`);
  - `POST /api/users/admin/people/<pk>/revoke-sessions/` (name `users-admin-person-revoke`).

**Part shapes:**

```json
// attendance
{"classes": [{"id": 1, "name": "…", "active": true, "rate": 87.5, "present": 6, "late": 1, "absent": 1,
              "excused": 0, "counted": 8}],
 "recent": [{"date": "YYYY-MM-DD", "class_id": 1, "class_name": "…", "status": "ABSENT", "note": "",
             "reason": "Kasal", "lcup_push": "sent"}]}
// results
{"homework": [{"class_id": 1, "class_name": "…", "rate": 50.0, "completed": 1, "total": 2}],
 "overdue": [{"id": 3, "title": "HW2", "class_name": "…", "due_at": "ISO"}],
 "assessments": [{"title": "…", "percent": 80.0, "at": "ISO"}],
 "mocks": [{"title": "…", "english": 600, "math": 650, "total": 1250, "at": "ISO"}],
 "practice": [{"title": "…", "score": 1210, "at": "ISO"}],
 "midterms": [{"title": "…", "score": 74, "scale": "100", "passed": true, "at": "ISO"}],
 "events": [{"title": "…", "starts_at": "ISO", "status": "REGISTERED", "attendance": "ATTENDED"}],
 "rewards": {"xp": 120, "coins": 15}}
// security
{"sessions": [{"id": 5, "created_at": "ISO", "last_seen_at": "ISO", "ip": "1.2.3.4", "device": "Mozilla/5.0 …"}],
 "telegram_linked": false, "email_verified": false, "last_password_change": "ISO|null"}
// history
{"items": [{"at": "ISO", "kind": "role|group|admin|security|payment", "title": "…", "by": "…"}],
 "truncated": false}
```

**Part rules:**
- **Attendance `classes`:** every class this user held a STUDENT seat in that has records.
- **Attendance `recent`:** the last 30 days, at most 60 rows, newest first.
- **`lcup_push`:** the `LcupAttendancePush.state` for that class's group and date, or `null`.
- **`passed`:** `true`, `false` or `null`.
- **`attendance`:** an event's attendance mark, or `null`.
- **Results lists:** at most 20 each, newest first. That includes `overdue`.

- [ ] **Step 1: Write the failing tests** — `backend/users/tests/test_people_parts.py`

```python
"""The person page's lazy parts and "log out everywhere" (plan 2026-10-15-ops-detail-pages)."""

from datetime import timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from access import constants as C
from classes.models import Assignment, Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord, AttendanceSession
from users.models import RefreshSession, RoleChange, SecurityAuditEvent, User

HOST = "admin.mastersat.uz"


def make(username, role=C.ROLE_STUDENT, **extra):
    return User.objects.create_user(None, password=None, username=username, role=role, **extra)


@override_settings(ALLOWED_HOSTS=["testserver", HOST])
class PersonPartsTests(TestCase):
    def setUp(self):
        self.admin = make("boss", C.ROLE_ADMIN, first_name="Bo", last_name="Ss")
        self.teacher = make("t1", C.ROLE_TEACHER, subject="math")
        self.room = Classroom.objects.create(name="Own class", subject="MATH", created_by=self.teacher,
                                             teacher=self.teacher)
        self.kid = make("kid", first_name="Ali", last_name="Valiyev")
        ClassroomMembership.objects.create(classroom=self.room, user=self.kid, role="STUDENT")
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def part(self, name, pk=None):
        return self.api.get(f"/api/users/admin/people/{pk or self.kid.pk}/{name}/", HTTP_HOST=HOST)

    def test_attendance_counts_and_recent_marks(self):
        today = timezone.localdate()
        for i, status in enumerate(["PRESENT", "LATE", "ABSENT"]):
            s = AttendanceSession.objects.create(classroom=self.room, date=today - timedelta(days=i))
            AttendanceRecord.objects.create(session=s, student=self.kid, status=status)
        body = self.part("attendance").json()
        (c,) = body["classes"]
        self.assertEqual((c["present"], c["late"], c["absent"], c["counted"]), (1, 1, 1, 3))
        self.assertEqual([r["status"] for r in body["recent"]], ["PRESENT", "LATE", "ABSENT"])
        self.assertIsNone(body["recent"][0]["lcup_push"])

    def test_results_list_overdue_homework(self):
        Assignment.objects.create(classroom=self.room, title="HW late", status="PUBLISHED", created_by=self.teacher,
                                  due_at=timezone.now() - timedelta(days=1))
        body = self.part("results").json()
        self.assertEqual([o["title"] for o in body["overdue"]], ["HW late"])
        self.assertEqual(body["homework"][0]["total"], 1)
        self.assertEqual(body["rewards"], {"xp": 0, "coins": 0})

    def test_security_lists_live_sessions_without_tokens(self):
        RefreshSession.objects.create(user=self.kid, refresh_jti="secret-jti", user_agent="Mozilla/5.0 Chrome")
        RefreshSession.objects.create(user=self.kid, refresh_jti="old", revoked_at=timezone.now())
        body = self.part("security").json()
        self.assertEqual(len(body["sessions"]), 1)
        self.assertNotIn("secret-jti", str(body))

    def test_history_merges_sources_newest_first(self):
        RoleChange.objects.create(user=self.kid, from_role="student", to_role="public_student",
                                  reason="lcup_left", source="lcup_sync")
        SecurityAuditEvent.objects.create(user=self.kid, event_type="admin_freeze",
                                          detail={"actor_id": self.admin.pk, "actor": "Bo Ss"})
        SecurityAuditEvent.objects.create(user=self.kid, event_type="ping")
        items = self.part("history").json()["items"]
        kinds = [i["kind"] for i in items]
        self.assertIn("role", kinds)
        self.assertIn("group", kinds)  # the seat added in setUp
        self.assertEqual(next(i for i in items if i["kind"] == "admin")["by"], "Bo Ss")
        self.assertNotIn("ping", str(items))
        self.assertEqual(items, sorted(items, key=lambda i: i["at"], reverse=True))

    def test_an_unknown_part_is_404(self):
        self.assertEqual(self.part("passwords").status_code, 404)

    def test_log_out_everywhere_revokes_and_is_recorded(self):
        RefreshSession.objects.create(user=self.kid, refresh_jti="a")
        RefreshSession.objects.create(user=self.kid, refresh_jti="b")
        r = self.api.post(f"/api/users/admin/people/{self.kid.pk}/revoke-sessions/", HTTP_HOST=HOST)
        self.assertEqual(r.json(), {"revoked": 2})
        self.assertFalse(RefreshSession.objects.filter(user=self.kid, revoked_at__isnull=True).exists())
        ev = SecurityAuditEvent.objects.get(user=self.kid, event_type="admin_revoke_sessions")
        self.assertEqual((ev.detail["actor_id"], ev.detail["sessions"]), (self.admin.pk, 2))

    def test_log_out_everywhere_refuses_your_own_account(self):
        r = self.api.post(f"/api/users/admin/people/{self.admin.pk}/revoke-sessions/", HTTP_HOST=HOST)
        self.assertEqual(r.status_code, 400)
```

Adjust `Assignment`'s required fields to the model. The membership hook (`classes/membership_hooks.py`) writes an ADDED event when a seat is created; confirm this by reading the hook.

- [ ] **Step 2: Run and see it fail** (label `users.tests.test_people_parts`): you should get 404s.

- [ ] **Step 3: Implement `backend/users/people_parts.py`**

```python
"""The person page's slower parts, one request each (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.utils import timezone

from classes.models import Assignment, Classroom, ClassroomMembership
from classes.models_attendance import AttendanceRecord
from classes.models_membership_audit import ClassroomMembershipEvent

from .admin_audit import ADMIN_EVENT_TYPES
from .models import RefreshSession, RoleChange, SecurityAuditEvent
from .people_detail import iso

RESULTS_LIMIT = 20
HISTORY_LIMIT = 200
NOISE = {"ping", "hello", "refresh_reuse_grace"}


def _student_rooms(user, *, live_only=False):
    seats = ClassroomMembership.objects.filter(user=user, role=ClassroomMembership.ROLE_STUDENT)
    if live_only:
        seats = seats.filter(status=ClassroomMembership.STATUS_ACTIVE, classroom__is_active=True)
    return list(Classroom.objects.filter(pk__in=seats.values("classroom_id")).order_by("name"))


def attendance_part(user) -> dict:
    from classes.progress import _attendance_for  # ungated on FINALIZED: prod never finalizes a session
    from lcup.models import LcupAbsenceReason, LcupAttendancePush

    live_ids = set(
        ClassroomMembership.objects.filter(
            user=user, role=ClassroomMembership.ROLE_STUDENT, status=ClassroomMembership.STATUS_ACTIVE,
            classroom__is_active=True,
        ).values_list("classroom_id", flat=True)
    )
    classes = []
    for room in _student_rooms(user):
        stats = _attendance_for(room, user)
        if stats:
            classes.append({"id": room.pk, "name": room.name, "active": room.pk in live_ids, **stats})

    since = timezone.localdate() - timedelta(days=30)
    rows = list(
        AttendanceRecord.objects.filter(student=user, session__date__gte=since)
        .select_related("session__classroom").order_by("-session__date", "-pk")[:60]
    )
    reasons = dict(LcupAbsenceReason.objects.values_list("lcup_reason_id", "title"))
    pushes = {
        (p["group__classroom_id"], p["date"]): p["state"]
        for p in LcupAttendancePush.objects.filter(
            group__classroom_id__in={r.session.classroom_id for r in rows}, date__gte=since
        ).values("group__classroom_id", "date", "state")
    }
    recent = [
        {
            "date": r.session.date.isoformat(),
            "class_id": r.session.classroom_id,
            "class_name": r.session.classroom.name,
            "status": r.status,
            "note": r.note or "",
            "reason": reasons.get(r.lcup_reason_id, "") if r.lcup_reason_id else "",
            "lcup_push": pushes.get((r.session.classroom_id, r.session.date)),
        }
        for r in rows
    ]
    return {"classes": classes, "recent": recent}


def _homework(user):
    from classes.analytics import _academic_assignments, _completion_map
    from classes.progress import _homework_for

    per_class, overdue = [], []
    now = timezone.now()
    for room in _student_rooms(user, live_only=True):
        stats = _homework_for(room, user)
        if stats:
            per_class.append({"class_id": room.pk, "class_name": room.name, **stats})
        work = [a for a in _academic_assignments(room) if a.category != Assignment.CATEGORY_CLASSWORK]
        done = _completion_map(room, [user.pk], work).get(user.pk, set())
        overdue += [
            {"id": a.pk, "title": a.title, "class_name": room.name, "due_at": iso(a.due_at)}
            for a in work
            if a.status == Assignment.STATUS_PUBLISHED and a.due_at and a.due_at < now and a.pk not in done
        ]
    overdue.sort(key=lambda o: o["due_at"], reverse=True)
    return per_class, overdue[:RESULTS_LIMIT]


def results_part(user) -> dict:
    from assessments.models import AssessmentAttempt
    from events.models import EventRegistration
    from exams.models import TestAttempt
    from midterms.models import MidtermAttempt, MidtermOutcome
    from mocks.models import MockAttempt
    from rewards.models import StudentWallet
    from rewards.services import xp_balance

    homework, overdue = _homework(user)
    assessments = (
        AssessmentAttempt.objects.filter(
            student=user, status__in=[AssessmentAttempt.STATUS_SUBMITTED, AssessmentAttempt.STATUS_GRADED]
        ).select_related("result", "homework__assessment_set").order_by("-submitted_at")[:RESULTS_LIMIT]
    )
    outcomes = dict(MidtermOutcome.objects.filter(student=user).values_list("midterm_id", "passed"))

    def _result_percent(a):
        result = getattr(a, "result", None)  # the reverse one-to-one raises when missing; getattr's default catches it
        return float(result.percent) if result is not None else None

    return {
        "homework": homework,
        "overdue": overdue,
        "assessments": [
            {
                "title": getattr(getattr(a.homework, "assessment_set", None), "title", "") or "Assessment",
                "percent": _result_percent(a),
                "at": iso(a.submitted_at),
            }
            for a in assessments
        ],
        "mocks": [
            {"title": m.mock.title if m.mock_id else "Mock", "english": m.english_score, "math": m.math_score,
             "total": m.total_score, "at": iso(m.completed_at)}
            for m in MockAttempt.objects.filter(student=user, is_completed=True)
            .select_related("mock").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "practice": [
            {"title": str(t.practice_test) if t.practice_test_id else "Test", "score": t.score, "at": iso(t.completed_at)}
            for t in TestAttempt.objects.filter(student=user, is_completed=True)
            .select_related("practice_test").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "midterms": [
            {"title": m.midterm.title, "score": m.score, "scale": str(m.midterm.scoring_scale),
             "passed": outcomes.get(m.midterm_id), "at": iso(m.completed_at)}
            for m in MidtermAttempt.objects.filter(student=user, is_completed=True)
            .select_related("midterm").order_by("-completed_at")[:RESULTS_LIMIT]
        ],
        "events": [
            {"title": r.event.title, "starts_at": iso(r.event.starts_at), "status": r.status,
             "attendance": r.attendance}
            for r in EventRegistration.objects.filter(student=user).select_related("event")
            .order_by("-registered_at")[:RESULTS_LIMIT]
        ],
        "rewards": {
            "xp": xp_balance(user),
            # Read, never get_or_create: a page view must not write a wallet.
            "coins": StudentWallet.objects.filter(student=user).values_list("coins_balance", flat=True).first() or 0,
        },
    }


def security_part(user) -> dict:
    sessions = RefreshSession.objects.filter(user=user, revoked_at__isnull=True).order_by("-last_seen_at")[:20]
    return {
        "sessions": [
            {"id": s.pk, "created_at": iso(s.created_at), "last_seen_at": iso(s.last_seen_at), "ip": s.ip or "",
             "device": (s.user_agent or "").strip()[:120] or "Unknown device"}
            for s in sessions
        ],
        "telegram_linked": bool(user.telegram_id),
        "email_verified": bool(user.email_verified),
        "last_password_change": iso(user.last_password_change),
    }


ROLE_REASONS = {
    "initial_split": "no class seat",
    "lcup_joined": "joined a group in lc-up",
    "lcup_left": "left every group in lc-up",
    "lcup_left_with_debt": "left lc-up with a debt",
    "lcup_debt_paid": "debt paid",
}
EVENT_TITLES = {
    "admin_freeze": "Frozen by an admin",
    "admin_unfreeze": "Unfrozen by an admin",
    "admin_revoke_sessions": "Signed out of every device by an admin",
    "password_change": "Changed their password",
    "session_revoke_all": "Signed out everywhere",
    "session_revoke_others": "Signed out of other devices",
    "lcup_phone_confirmed": "Confirmed their phone number",
    "lcup_phone_moved": "Phone number moved to a new lc-up account",
    "lcup_claim_login": "First sign-in with an lc-up code",
    "email_verify_confirmed": "Verified their email",
    "auto_revoke_all_sessions": "Signed out everywhere by the risk check",
}
MEMBERSHIP_ACTIONS = {
    "ADDED": "Added to", "REMOVED": "Removed from", "REINSTATED": "Back in",
    "ROLE_CHANGED": "Role changed in", "STATUS_CHANGED": "Status changed in", "DELETED": "Seat deleted in",
}
FIELD_LABELS = {"first_name": "first name", "last_name": "last name", "phone_number": "phone", "is_frozen": "frozen"}


def _event_title(ev) -> str:
    detail = ev.detail or {}
    if ev.event_type == "admin_user_update":
        fields = [FIELD_LABELS.get(f, f.replace("_", " ")) for f in detail.get("changes", {})]
        if detail.get("password_changed"):
            fields.append("password")
        return "Edited by an admin: " + (", ".join(fields) or "no fields")
    return EVENT_TITLES.get(ev.event_type) or ev.event_type.replace("_", " ").capitalize()


def _day(d):
    return timezone.make_aware(datetime.combine(d, time.min)) if d else None


def history_part(user) -> dict:
    from lcup.models import LcupPayment, LcupStudentLink

    items = []
    for rc in RoleChange.objects.filter(user=user).order_by("-created_at")[:HISTORY_LIMIT]:
        extra = " and frozen" if rc.froze else (" and unfrozen" if rc.unfroze else "")
        why = ROLE_REASONS.get(rc.reason, rc.reason.replace("_", " "))
        items.append({"at": iso(rc.created_at), "kind": "role",
                      "title": f"Role {rc.from_role} → {rc.to_role}{extra} ({why})",
                      "by": "lc-up sync" if rc.source == "lcup_sync" else rc.source})
    for ev in ClassroomMembershipEvent.objects.filter(student=user).order_by("-created_at")[:HISTORY_LIMIT]:
        items.append({"at": iso(ev.created_at), "kind": "group",
                      "title": f"{MEMBERSHIP_ACTIONS.get(ev.action, ev.action)} {ev.classroom_name}",
                      "by": ev.actor_name or ""})
    for ev in SecurityAuditEvent.objects.filter(user=user).exclude(event_type__in=NOISE)[:HISTORY_LIMIT]:
        admin = ev.event_type in ADMIN_EVENT_TYPES
        items.append({"at": iso(ev.created_at), "kind": "admin" if admin else "security",
                      "title": _event_title(ev), "by": (ev.detail or {}).get("actor", "") if admin else ""})
    link = LcupStudentLink.objects.filter(user=user).first()
    if link:
        for p in LcupPayment.objects.filter(lcup_student_id=link.lcup_student_id).order_by("-paid_on")[:HISTORY_LIMIT]:
            amount = f"{abs(int(p.amount)):,}".replace(",", " ")
            items.append({"at": iso(_day(p.paid_on)), "kind": "payment",
                          "title": f"{p.kind.capitalize()} {amount} UZS" + (f" for {p.month}" if p.month else ""),
                          "by": "lc-up"})
    items = [i for i in items if i["at"]]
    items.sort(key=lambda i: i["at"], reverse=True)
    return {"items": items[:HISTORY_LIMIT], "truncated": len(items) > HISTORY_LIMIT}


PARTS = {
    "attendance": attendance_part,
    "results": results_part,
    "security": security_part,
    "history": history_part,
}
```

Check two things before relying on them, and use what the models actually have:
- the date field on `LcupPayment` is `paid_on`;
- the amount sign convention for refunds (read `lcup/finance.py _payment_row`).

- [ ] **Step 4: Add the views and routes** — append to `backend/users/views_people_detail.py`:

```python
from access.permissions import HasManageUsers

from . import admin_audit
from .models import RefreshSession
from .people_parts import PARTS


class PersonPartView(APIView):
    permission_classes = [HasManageUsersOrAssignTestAccess]

    def get(self, request, pk: int, part: str):
        build = PARTS.get(part)
        user = scoped_person(request, pk) if build else None
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(build(user))


class PersonRevokeSessionsView(APIView):
    """POST — sign this account out of every device. An open tab keeps its access token until it expires."""

    permission_classes = [HasManageUsers]

    def post(self, request, pk: int):
        from .views import _revoke_session_rows

        user = scoped_person(request, pk)
        if user is None:
            return Response({"detail": "Not found."}, status=404)
        if user.pk == request.user.pk:
            return Response({"detail": "Use your own account's sign-out instead."}, status=400)
        n = _revoke_session_rows(RefreshSession.objects.filter(user=user, revoked_at__isnull=True))
        admin_audit.log_admin_action(request=request, user_id=user.pk, event_type=admin_audit.ADMIN_REVOKE_SESSIONS,
                                     sessions=n)
        return Response({"revoked": n})
```

Add the routes in `backend/users/urls.py`. The `revoke-sessions/` route must come BEFORE `<str:part>/`:

```python
    path('admin/people/<int:pk>/revoke-sessions/', PersonRevokeSessionsView.as_view(), name='users-admin-person-revoke'),
    path('admin/people/<int:pk>/<str:part>/', PersonPartView.as_view(), name='users-admin-person-part'),
```

- [ ] **Step 5: Run until `OK`** with labels `users.tests.test_people_parts users.tests.test_people_detail users.tests.test_admin_audit`.

- [ ] **Step 6: Commit**

```bash
git add backend/users/people_parts.py backend/users/views_people_detail.py backend/users/urls.py backend/users/tests/test_people_parts.py
git commit -m "feat(ops): a person's attendance, results, sessions and history, and log out everywhere

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: "Signed in" filter + the dead "Duplicates" filter

**Files:**
- Modify: `backend/users/views_people.py` (FILTERS for `students` and `public`)
- Modify: `backend/users/tests/test_people_api.py` (+1 test)
- Modify: `frontend/src/features/ops/changelist/peopleApi.ts` (`PEOPLE_FILTER_KEYS`)
- Test: `frontend/src/features/ops/changelist/__tests__/peopleApi.test.ts` (new)

**Interfaces:**
- Produces: filter key `signin` with values `never` and `yes`, on students and public.

- [ ] **Step 1: Failing backend test** (append to `PeopleListTests` in `test_people_api.py`)

```python
    def test_never_signed_in_means_no_session_at_all(self):
        from users.models import RefreshSession

        RefreshSession.objects.create(user=self.aziz, refresh_jti="x")
        self.assertEqual(self.ids(self.get(section="students", signin="never").json()), [self.malika.pk])
        self.assertEqual(self.facet(self.get(section="students").json(), "signin"), {"never": 1, "yes": 1})
        self.assertEqual(self.ids(self.get(section="public", signin="never").json()), [self.pub.pk])
```

- [ ] **Step 2: Failing frontend test** — `frontend/src/features/ops/changelist/__tests__/peopleApi.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { PEOPLE_FILTER_KEYS, peopleQuery } from "../peopleApi";

describe("PEOPLE_FILTER_KEYS", () => {
  // Every filter the server sends must be a key the list reads, or clicking it does nothing
  // (the live "Duplicates" filter did exactly that until 2026-10-15).
  it("covers every filter the server offers", () => {
    expect(PEOPLE_FILTER_KEYS.students).toEqual(["status", "group", "teacher", "lcup", "debt", "dupes", "signin"]);
    expect(PEOPLE_FILTER_KEYS.public).toEqual(["status", "joined", "verified", "dupes", "signin"]);
    expect(PEOPLE_FILTER_KEYS.staff).toEqual(["role", "subject", "status"]);
  });

  it("sends a chosen duplicates filter to the server", () => {
    const q = peopleQuery("students", { q: "", o: "", page: 1, pageSize: 50, filters: { dupes: "yes" } });
    expect(q.dupes).toBe("yes");
  });
});
```

- [ ] **Step 3: Run both; see them fail.**

- [ ] **Step 4: Implement.** In `views_people.py`, below `_SAME_NAME`:

```python
def _signin_q(value):
    ever = Q(pk__in=RefreshSession.objects.values("user_id"))
    return {"never": ~ever, "yes": ever}.get(value)


# "Never" is no session at all: JWT sign-in never writes last_login, and sessions are never pruned.
_SIGNED_IN = (
    "Signed in",
    lambda qs: [
        ("never", "Never", qs.filter(_signin_q("never")).count()),
        ("yes", "Has signed in", qs.filter(_signin_q("yes")).count()),
    ],
    _signin_q,
)
```

Then add `"signin": _SIGNED_IN,` after `"dupes": _SAME_NAME,` in both the `students` and `public` dicts. In `peopleApi.ts`, set the keys exactly as the test expects.

- [ ] **Step 5: Run both until green; commit**

```bash
git add backend/users/views_people.py backend/users/tests/test_people_api.py frontend/src/features/ops/changelist/peopleApi.ts frontend/src/features/ops/changelist/__tests__/peopleApi.test.ts
git commit -m "fix(ops): the Duplicates filter does something; a Never-signed-in filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rows link to the change form

**Files:**
- Modify: `frontend/src/features/ops/changelist/ChangeList.tsx` (`rowHref` prop; first cell a `next/link`)
- Create: `frontend/src/features/ops/changelist/backLink.ts`
- Modify: `frontend/src/features/ops/users/PeopleList.tsx` (rowHref; the modal is dropped)
- Modify: `frontend/src/app/(ops)/ops/students/__tests__/page.test.tsx` (row → link)
- Test: `frontend/src/features/ops/changelist/__tests__/ChangeList.test.tsx` (+ cases), `__tests__/backLink.test.ts`

**Interfaces:**
- Produces:
  - `ChangeListProps.rowHref?: (row: R) => string`;
  - `withListFilters(href: string, listQueryString: string): string`;
  - `listHrefFrom(search: URLSearchParams, listPath: string): string`.

- [ ] **Step 1: Failing tests** — `backLink.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listHrefFrom, withListFilters } from "../backLink";

describe("back to the filtered list", () => {
  it("carries the list's query string, as Django's _changelist_filters", () => {
    expect(withListFilters("/ops/students/7", "status=frozen_debt&p=2")).toBe(
      "/ops/students/7?_changelist_filters=status%3Dfrozen_debt%26p%3D2",
    );
    expect(withListFilters("/ops/students/7", "")).toBe("/ops/students/7");
  });
  it("rebuilds the list address from it", () => {
    const search = new URLSearchParams("_changelist_filters=status%3Dfrozen_debt%26p%3D2");
    expect(listHrefFrom(search, "/ops/students")).toBe("/ops/students?status=frozen_debt&p=2");
    expect(listHrefFrom(new URLSearchParams(""), "/ops/students")).toBe("/ops/students");
  });
});
```

In `ChangeList.test.tsx` (follow its render helper), add two cases using `rowHref={(r) => "/ops/students/" + r.id}`:
- the first cell is an `<a>` whose `href` ends with `/ops/students/<id>`;
- a plain click on another cell of the row calls `router.push` with that href.

Mock `next/navigation` the way the file already does.

- [ ] **Step 2: Run; fail.**

- [ ] **Step 3: Implement** — `backLink.ts`:

```ts
/**
 * A change form remembers the changelist it was opened from, the way Django admin does with
 * `?_changelist_filters=`: Back and the breadcrumb return to the same search, filters and page.
 */
export const LIST_FILTERS_PARAM = "_changelist_filters";

export function withListFilters(href: string, listQueryString: string): string {
  return listQueryString ? `${href}?${LIST_FILTERS_PARAM}=${encodeURIComponent(listQueryString)}` : href;
}

export function listHrefFrom(search: URLSearchParams, listPath: string): string {
  const qs = search.get(LIST_FILTERS_PARAM) ?? "";
  return qs ? `${listPath}?${qs}` : listPath;
}
```

**`ChangeList.tsx`:**
- Add the prop `rowHref?: (row: R) => string;` with the doc comment "Each row's change form. The first cell becomes a link, so it opens in a new tab."
- Import `Link` from `next/link` and `useRouter` from `next/navigation`.
- In each row, compute `const href = rowHref?.(row);`.
- The `<tr onClick>` becomes `href ? () => router.push(href) : onRowClick ? () => onRowClick(row) : undefined`. Add the cursor class when either is set.
- When `href` is set, the first cell renders `<Link href={href} onClick={(e) => e.stopPropagation()} className={<the existing button's classes>}>{col.render(row)}</Link>`.
- Otherwise the existing `onRowClick` button branch stays unchanged.

**`PeopleList.tsx`:**
- Remove `EditUserModal`, the `editing` state, `onRowClick` and `rowToUser`.
- Take `queryString` from `useChangeListParams(PEOPLE_FILTER_KEYS[section])`, which already returns it.
- Pass `rowHref={(row) => withListFilters(\`/ops/${section}/${row.id}\`, queryString)}`.
- The bulk actions stay.

**`students/__tests__/page.test.tsx`:** the "a row opens the editor" case becomes "a row's name links to its change form". It asserts the anchor `href` is `/ops/students/<id>`.

- [ ] **Step 4: Run** `cd frontend && npx vitest run src/features/ops "src/app/(ops)"` until green; then the typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ops/changelist/ChangeList.tsx frontend/src/features/ops/changelist/backLink.ts frontend/src/features/ops/changelist/__tests__/backLink.test.ts frontend/src/features/ops/changelist/__tests__/ChangeList.test.tsx frontend/src/features/ops/users/PeopleList.tsx "frontend/src/app/(ops)/ops/students/__tests__/page.test.tsx"
git commit -m "feat(ops): a person's row opens their page, and the page remembers the list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Person page — layout, form, actions, core sections

**Files:**
- Create: `frontend/src/features/ops/people/personApi.ts`, `Fieldset.tsx`, `PersonPage.tsx`, `PersonForm.tsx`
- Create: `frontend/src/features/ops/people/sections/GroupsSection.tsx`, `LcupSection.tsx`, `DuplicatesSection.tsx`, `StaffClassesSection.tsx`, plus stub `AttendanceSection.tsx`, `ResultsSection.tsx`, `SecuritySection.tsx` and `HistorySection.tsx` (Task 7 fills these in)
- Create: `frontend/src/app/(ops)/ops/students/[id]/page.tsx`, `public/[id]/page.tsx`, `staff/[id]/page.tsx`
- Delete: `frontend/src/features/ops/users/EditUserModal.tsx`. Its save, role/subject and error logic moves into `PersonForm.tsx` unchanged.
- Test: `frontend/src/features/ops/people/__tests__/PersonPage.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /users/admin/people/<id>/` (Task 2 shape);
  - `PATCH /users/<id>/update/`;
  - `POST /users/admin/bulk/ {action, ids:[id]}`;
  - `PATCH /classes/<cid>/members/<uid>/ {status:"REMOVED"}`;
  - `POST /classes/<cid>/members/ {user_id}`;
  - `withListFilters` and `listHrefFrom` (Task 5);
  - `ConfirmBulkModal` (existing).
- Produces:
  - types `PersonCore`, `PersonGroup`, `PersonLcup`, `PersonDuplicate`, `PersonStaff`, `PersonPartName`;
  - `personKeys`, `usePerson(id)`, `usePersonPart<T>(id, part)`, `personActions.revokeSessions(id)`;
  - `Fieldset`, `PartBody`, `Row`.

- [ ] **Step 1: Failing test** — `PersonPage.test.tsx`.

Mock `@/lib/api` (`get`, `patch`, `post`), `@/components/ToastProvider` and `next/navigation` as `students/__tests__/page.test.tsx` does. Add a `replace` and `push` spy, and `useSearchParams: () => new URLSearchParams("")`.

Render `<PersonPage section="students" id={7} />` inside a `QueryClientProvider` (`retry: false`). Route `get` by URL: the core URL returns the core fixture; the part URLs return `{}`-shaped data unless a case says otherwise. Cases:
1. **Core renders.** The fixture is Aziz with one group (`lcup_managed: true`) and lcup balance -250000. Expect the heading "Aziz Tursunov", the group row with the text "Change in lc-up", NO "Remove" button in that row, and the text "250,000 UZS".
2. **Wrong section.** The core returns `section: "public"`, so `replace` is called with `/ops/public/7`.
3. **404.** `get` for the core rejects with `{response:{status:404}}`. Expect "This account does not exist or is outside your scope." and NOT "Nothing yet".
4. **Save.** Change "First name" to "Azizbek" and click "Save". Expect `patch` to be called with `/users/7/update/` and a payload containing `first_name: "Azizbek"`, and the core `get` to be called again.
5. **A part failing does not blank the page.** `get` for `/users/admin/people/7/history/` rejects. The History box shows "Could not load." and a "Retry" button, while the heading is still shown.

- [ ] **Step 2: Run; fail (module not found).**

- [ ] **Step 3: `personApi.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";

/** `GET /users/admin/people/<id>/` and its parts (backend/users/views_people_detail.py). */

export type PersonGroup = {
  id: number; name: string; subject: string; teacher: string; joined_at: string | null; lcup_managed: boolean;
};
export type PersonLcup = {
  linked: true; balance: number | null; debt: number | null; updated_at: string | null; frozen_for_debt: boolean;
  freeze_day: number; monthly_cost: number; groups: { name: string; monthly_cost: number }[];
  payments: Record<string, unknown>[];
  status: string; lcup_student_id: number; exempt: boolean; phone_prompt: string | null;
};
export type PersonDuplicate = {
  id: number; name: string; username: string; section: PeopleSection; status: string; last_seen: string | null;
  groups: string[];
};
export type PersonStaff = {
  lcup_teacher: { status: string; name: string } | null;
  classes: { id: number; name: string; subject: string; as: "teacher" | "ta"; students: number; lcup_managed: boolean }[];
  workload: { classes: number; students: number; to_review: number };
};
export type PersonCore = {
  id: number; section: PeopleSection; username: string; first_name: string; last_name: string; name: string;
  email: string; email_verified: boolean; phone: string; role: string; subject: string; status: string;
  is_frozen: boolean; frozen_reason: "debt" | "admin" | null; date_joined: string | null; last_seen: string | null;
  attempt_count: number; telegram_linked: boolean; lcup_created: boolean;
  sat: { exam_date: string | null; target_score: number | null; target_english: number | null; target_math: number | null };
  groups: PersonGroup[]; past_groups: { id: number; name: string; left_at: string | null }[];
  open_classes: { id: number; name: string }[]; lcup: PersonLcup | null; duplicates: PersonDuplicate[];
  staff: PersonStaff | null;
};
export type PersonPartName = "attendance" | "results" | "security" | "history";

export const personKeys = {
  all: ["ops", "person"] as const,
  core: (id: number) => ["ops", "person", id] as const,
  part: (id: number, part: PersonPartName) => ["ops", "person", id, part] as const,
};

const notFound = (err: unknown) => (err as { response?: { status?: number } })?.response?.status === 404;

export function usePerson(id: number) {
  return useQuery({
    queryKey: personKeys.core(id),
    queryFn: async () => (await api.get<PersonCore>(`/users/admin/people/${id}/`)).data,
    retry: (count, err) => !notFound(err) && count < 2,
  });
}

export function usePersonPart<T>(id: number, part: PersonPartName) {
  return useQuery({
    queryKey: personKeys.part(id, part),
    queryFn: async () => (await api.get<T>(`/users/admin/people/${id}/${part}/`)).data,
  });
}

export const personActions = {
  async revokeSessions(id: number): Promise<number> {
    const { data } = await api.post<{ revoked: number }>(`/users/admin/people/${id}/revoke-sessions/`);
    return data.revoked;
  },
};
```

Read `_payment_row` in `backend/lcup/finance.py`. Replace `Record<string, unknown>[]` with an exact `PersonPayment` type that has its keys.

- [ ] **Step 4: `Fieldset.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

/** A Django-admin fieldset: a thin header bar and its rows. Plain — no tint, no icon. */
export function Fieldset({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card" aria-label={title}>
      <header className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {right}
      </header>
      <div className="p-3 text-sm">{children}</div>
    </section>
  );
}

/** One part's body: loading, error with Retry, "Nothing yet", or the data. An error is never the empty text. */
export function PartBody<T>({
  query, isEmpty, render,
}: { query: UseQueryResult<T>; isEmpty: (d: T) => boolean; render: (d: T) => ReactNode }) {
  if (query.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (query.isError) {
    return (
      <p className="text-muted-foreground">
        Could not load.{" "}
        <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>
          Retry
        </button>
      </p>
    );
  }
  if (isEmpty(query.data)) return <p className="text-muted-foreground">Nothing yet</p>;
  return <>{render(query.data)}</>;
}

/** A label/value row, as Django's read-only field. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 border-b border-border py-1.5 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}
```

- [ ] **Step 5: `PersonForm.tsx`** — move `EditUserModal`'s body here as an inline `<Fieldset title="Profile">` with a `<form>`.
  - **Fields:** First name, Last name, Username, Email, Phone, Role, Subject (shown when `requiresSubject(role)`), New password (with the show toggle).
  - **Save logic:** keep `EditUserModal`'s `handleSave` payload rules and `firstFieldError` exactly. Set `namesKnown` to true always, because the core sends both name parts.
  - **No Frozen checkbox:** freezing is a header action.
  - **Props:** `{ person: PersonCore; onSaved: () => void }`.
  - **Read-only rows** below the inputs, each a `Row`:
    - "SAT exam date": the date, or "—".
    - "Targets": `EN 650 · Math 700 · Total 1350` (only the parts that are set; "—" if none), with the caption "Set by the student".
    - "Joined".
    - "Email verified": Yes or No.
    - "Telegram": Linked or Not linked.
    - "Created by lc-up": Yes or No.
  - **Save button:** sits at the foot of the fieldset, on the right. On success it calls `onSaved()` and toasts "Saved."; an error shows inline above Save.
  - **Inputs:** use the changelist's compact input style (`h-8 rounded-md border border-border bg-card px-2 text-sm`), with labels above them in `text-xs text-muted-foreground`.

- [ ] **Step 6: `PersonPage.tsx`**

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ToastProvider";
import { peopleKeys, type PeopleSection } from "@/features/ops/changelist/peopleApi";
import { listHrefFrom } from "@/features/ops/changelist/backLink";
import { formatLastSeen, statusLabel } from "@/features/ops/users/peopleColumns";
import { ConfirmBulkModal } from "@/features/ops/users/ConfirmBulkModal";
import { personActions, personKeys, usePerson } from "./personApi";
import { PersonForm } from "./PersonForm";
import { GroupsSection } from "./sections/GroupsSection";
import { LcupSection } from "./sections/LcupSection";
import { DuplicatesSection } from "./sections/DuplicatesSection";
import { StaffClassesSection } from "./sections/StaffClassesSection";
import { AttendanceSection } from "./sections/AttendanceSection";
import { ResultsSection } from "./sections/ResultsSection";
import { SecuritySection } from "./sections/SecuritySection";
import { HistorySection } from "./sections/HistorySection";

const LIST_TITLE: Record<PeopleSection, string> = { students: "Students", public: "Public users", staff: "Staff" };

function ActionButton({ children, danger, ...rest }: { children: ReactNode; danger?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "h-8 rounded-md border border-border bg-card px-3 text-sm hover:bg-surface-2 disabled:opacity-50",
        danger ? "text-danger" : "text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function PersonPage({ section, id }: { section: PeopleSection; id: number }) {
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const query = usePerson(id);
  const person = query.data;
  const backHref = listHrefFrom(search, `/ops/${section}`);
  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);

  // The sync can move a person between sections; their page follows them.
  useEffect(() => {
    if (person && person.section !== section) router.replace(`/ops/${person.section}/${id}`);
  }, [person, section, id, router]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: personKeys.all });
    void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
  };

  if (query.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (query.isError) {
    const missing = (query.error as { response?: { status?: number } })?.response?.status === 404;
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="text-muted-foreground">
          {missing ? "This account does not exist or is outside your scope." : "Could not load this account."}
        </p>
        <p className="flex gap-3">
          {missing ? null : (
            <button type="button" className="text-primary hover:underline" onClick={() => void query.refetch()}>
              Retry
            </button>
          )}
          <Link href={backHref} className="text-primary hover:underline">Back to {LIST_TITLE[section]}</Link>
        </p>
      </div>
    );
  }
  if (!person || person.section !== section) return null;

  const bulk = async (action: "freeze" | "unfreeze" | "delete") => {
    setBusy(true);
    try {
      const r = await api.post("/users/admin/bulk/", { action, ids: [id] });
      const row = r.data?.results?.[0];
      if (!row?.ok) {
        push({ tone: "error", message: row?.error ? `Not done: ${row.error}` : "That did not go through. Try again." });
        return;
      }
      if (action === "delete") {
        void queryClient.invalidateQueries({ queryKey: peopleKeys.all });
        router.push(backHref);
        return;
      }
      push({ tone: "success", message: action === "freeze" ? "Account frozen." : "Account unfrozen." });
      refresh();
    } catch {
      push({ tone: "error", message: "That did not go through. Try again." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const n = await personActions.revokeSessions(id);
      push({ tone: "success", message: `Signed out of ${n} device${n === 1 ? "" : "s"}.` });
      refresh();
    } catch {
      push({ tone: "error", message: "Could not sign them out. Try again." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const statusText =
    person.frozen_reason === "debt" ? "Frozen — unpaid (lifts when paid)" : statusLabel(person.status, person.is_frozen);
  const learner = person.staff === null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <Link href={backHref} className="text-primary hover:underline">{LIST_TITLE[section]}</Link> › {person.name}
          </p>
          <h1 className="mt-1 truncate text-xl font-semibold text-foreground">{person.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[person.username, statusText, `Last seen ${formatLastSeen(person.last_seen)}`].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton disabled={busy} onClick={() => void bulk(person.is_frozen ? "unfreeze" : "freeze")}>
            {person.is_frozen ? "Unfreeze" : "Freeze"}
          </ActionButton>
          <ActionButton disabled={busy} onClick={() => setConfirm("revoke")}>Log out everywhere</ActionButton>
          <ActionButton disabled={busy} danger onClick={() => setConfirm("delete")}>Delete</ActionButton>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PersonForm person={person} onSaved={refresh} />
        <div className="space-y-4">
          {learner ? (
            <>
              <GroupsSection person={person} onChanged={refresh} />
              {person.lcup ? <LcupSection lcup={person.lcup} /> : null}
            </>
          ) : (
            <StaffClassesSection staff={person.staff!} />
          )}
        </div>
      </div>

      {learner ? <AttendanceSection id={id} /> : null}
      {learner ? <ResultsSection id={id} section={section} /> : null}
      <SecuritySection id={id} />
      <HistorySection id={id} />
      {learner ? <DuplicatesSection duplicates={person.duplicates} /> : null}

      {confirm === "delete" ? (
        <ConfirmBulkModal action="delete" count={1} attemptTotal={person.attempt_count} busy={busy}
          onCancel={() => setConfirm(null)} onConfirm={() => void bulk("delete")} />
      ) : null}
      {confirm === "revoke" ? (
        <ConfirmDialog
          title="Log out everywhere?"
          body="Every device is signed out. A tab that is open now keeps working for up to 3 hours."
          confirmLabel="Log out everywhere"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void revoke()}
        />
      ) : null}
    </div>
  );
}
```

`ConfirmDialog`: create `frontend/src/features/ops/people/ConfirmDialog.tsx` by copying `ConfirmBulkModal`'s dialog markup (overlay, focus, Escape) with plain `title`, `body`, `confirmLabel`, `busy`, `onCancel` and `onConfirm` props. Add the import.

- [ ] **Step 7: Core sections.** All four use `Fieldset`, and their tables use the changelist's 34px rows.
  - **`GroupsSection` `{person, onChanged}`:**
    - Title "Groups". Table columns: Class (link to `/ops/classrooms/<id>`), Teacher, Joined, and a last cell.
    - The last cell shows "Change in lc-up" (muted) when `lcup_managed`. Otherwise it shows a "Remove" button: `PATCH /classes/<cid>/members/<uid>/ {status:"REMOVED"}`, then `onChanged()`. On an error, toast the server's `detail`.
    - When there are no groups, show "Not in any class."
    - Below the table: an **Add to class** `<select>` of `person.open_classes`, plus an "Add" button. It calls `POST /classes/<cid>/members/ {user_id: person.id}` and then `onChanged()`. Hide it when `open_classes` is empty.
    - For `person.section === "public"`, add the caption "They become a student at the next sync (within 15 minutes)."
    - When `past_groups` is non-empty, add the sub-heading "Earlier groups" and list each as `name · left <date>`, or `name · left —` when there is no date.
  - **`LcupSection` `{lcup}`:** title "lc-up & payments".
    - `Row`s:
      - Link: `confirmed`/`auto` → "Linked"; `created` → "Created by lc-up"; anything else shows the raw value.
      - lc-up ID.
      - Balance: negative → "Owes X UZS" in `text-danger`; zero or positive → "Paid up"; null → "—".
      - Balance updated.
      - Monthly cost.
      - Debt freeze: `frozen_for_debt` → "Frozen (day {freeze_day} rule)"; `exempt` → "Exempt"; otherwise "—".
      - Phone form: `phone_prompt`, or "—".
    - Then a "Payments" table (Date, Kind, Amount, Month, Group). Show the first 10 rows, with a "Show all N" toggle.
    - Money uses `formatUzs`.
  - **`DuplicatesSection` `{duplicates}`:** renders NOTHING when the list is empty. Otherwise its title is "Same-name accounts" and its table has these columns:
    - Name (link to `/ops/<section>/<id>`);
    - Username;
    - List ("Students" / "Public users");
    - Status (`statusLabel`);
    - Groups (joined);
    - Last seen.
  - **`StaffClassesSection` `{staff}`:**
    - Title "Classes".
    - `Row`s: "lc-up teacher" (`name · status`, or "Not linked") and "Workload" (`N classes · N students · N to review`).
    - Table: Class (link), As (Teacher / TA), Students, lc-up (Yes / —).
  - **Stubs for Task 7:** `AttendanceSection({id})`, `ResultsSection({id, section})`, `SecuritySection({id})` and `HistorySection({id})`. Each renders `<Fieldset title="…"><PartBody query={usePersonPart(id, "<part>")} isEmpty={() => false} render={() => null} /></Fieldset>`.

- [ ] **Step 8: The three pages** — `frontend/src/app/(ops)/ops/students/[id]/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PersonPage } from "@/features/ops/people/PersonPage";

export default function OpsStudentPage() {
  const { id } = useParams<{ id: string }>();
  // useSearchParams (inside PersonPage) needs a Suspense boundary for the production build.
  return (
    <Suspense fallback={null}>
      <PersonPage section="students" id={Number(id)} />
    </Suspense>
  );
}
```

`public/[id]` and `staff/[id]` are the same, with `section="public"` / `"staff"` and their own component names.

- [ ] **Step 9: Run the test, all of `src/features/ops` and `src/app/(ops)`, and tsc. Everything must be green.**

- [ ] **Step 10: Commit**

```bash
git rm frontend/src/features/ops/users/EditUserModal.tsx
git add frontend/src/features/ops/people "frontend/src/app/(ops)/ops/students/[id]/page.tsx" "frontend/src/app/(ops)/ops/public/[id]/page.tsx" "frontend/src/app/(ops)/ops/staff/[id]/page.tsx"
git commit -m "feat(ops): a change form for every person — profile, groups, lc-up, same-name accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Person page — attendance, results, security, history

**Files:**
- Modify: `frontend/src/features/ops/people/personApi.ts` (+ part types)
- Modify: `frontend/src/features/ops/people/sections/AttendanceSection.tsx`, `ResultsSection.tsx`, `SecuritySection.tsx`, `HistorySection.tsx`
- Test: `frontend/src/features/ops/people/__tests__/sections.test.tsx`

**Interfaces:**
- Consumes: `usePersonPart<T>(id, part)`; `Fieldset`, `PartBody`, `Row`; `formatDate` and `formatLastSeen` from `features/ops/users/peopleColumns`; `formatUzs`.
- Produces: the types `PersonAttendance`, `PersonResults`, `PersonSecurity` and `PersonHistory`, copied field-for-field from the Task 3 JSON shapes.

- [ ] **Step 1: Failing tests.** Each section renders against a mocked `api.get`.
  - **Attendance:**
    - per class it shows "87.5% of 8" and the four counts;
    - in the recent table, an ABSENT row with reason "Kasal" shows "Absent — Kasal";
    - the lc-up column shows "Sent".
  - **Results:**
    - "Overdue homework" lists the title and due date;
    - with every list empty, each subsection shows "Nothing yet" and the line "XP 0 · Coins 0" is present;
    - with `section="public"`, there are no "Homework" or "Midterms" headings.
  - **Security:**
    - the sessions table shows Device, IP, Signed in and Last active;
    - an empty list shows "No signed-in devices";
    - the rows "Telegram", "Email verified" and "Password changed" are present.
  - **History:**
    - items are rendered newest first as `date · title · by`;
    - "Showing the latest 200." appears when `truncated`;
    - a rejected request shows "Could not load." and NOT "Nothing yet".

- [ ] **Step 2: Run; fail. Step 3: Implement.**
  - **`AttendanceSection`**, titled "Attendance (last 30 days)":
    - One line per class: `Name — 87.5% of 8 · present 6 · late 1 · absent 1 · excused 0`. Add "(left)" when the class is not `active`. Show "—%" when `rate` is null.
    - A table with the columns Date | Class | Mark | Note | lc-up.
    - Mark labels: PRESENT→Present, LATE→Late, ABSENT→Absent, EXCUSED→Excused. When there is a reason, show `Absent — <reason>`.
    - lc-up labels: sent→Sent, failed→Failed, refused→Refused, null→—.
    - `isEmpty`: `classes` and `recent` are both empty.
  - **`ResultsSection` `{id, section}`**, titled "Results". Each subsection is an `h3` (`text-xs font-semibold uppercase text-muted-foreground`) followed by a table, or "Nothing yet":
    - Homework: Class | Done (`completed/total`) | Rate
    - Overdue homework: Title | Class | Due
    - Assessments: Title | Score % | Date
    - Mock exams: Title | EN | Math | Total | Date
    - Practice tests: Title | Score | Date
    - Midterms: Title | Score (`74 / 100`) | Passed (Yes/No/—) | Date
    - Events: Event | Date | Status | Attended
    - Then the line `XP {xp} · Coins {coins}`.
    - For `section === "public"`, show only Mock exams, Practice tests, Events and the XP line.
    - `isEmpty` is always false.
  - **`SecuritySection`**, titled "Security":
    - `Row`s: Telegram (Linked / Not linked), Email verified (Yes / No), Password changed (date, or "Never").
    - A sessions table: Device | IP | Signed in | Last active (`formatLastSeen`). An empty list shows "No signed-in devices".
  - **`HistorySection`**, titled "History":
    - An `<ol>` of `formatDate(at)` + time `HH:mm` · title, followed by ` · by X` (muted) when `by` is set.
    - The caption "Admin edits are recorded from 15 Oct 2026." (muted).
    - "Showing the latest 200." when `truncated`.
    - `isEmpty`: `items.length === 0`.

- [ ] **Step 4: Run the tests, all ops vitest, and tsc. Step 5: Commit**

```bash
git add frontend/src/features/ops/people
git commit -m "feat(ops): a person's attendance, results, devices and history on their page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: PR 1 — verify and open

- [ ] **Backend.** Each run must print a literal `OK`:
  - the whole `users` app;
  - `lcup.tests_guards lcup.tests_audience lcup.tests_finance`;
  - `classes.tests_roster_add classes.tests_membership_audit`.
- [ ] **Postgres.** Run `users.tests.test_people_detail users.tests.test_people_parts users.tests.test_people_api` with the memory `local-postgres-verify-orm-sql` recipe (port 55432, `--no-locale`, TCP). It proves itself with the line `Creating test database … 'test_postgres'`.
- [ ] **Frontend.** Run the full `npx vitest run` (the baseline is fully green) and the tsc probe from Global Constraints.
- [ ] **Screenshots.** Render `/ops/students/<id>`, `/ops/public/<id>` and `/ops/staff/<id>` with stubbed API data at desktop width and at 390px. Use the memory `render-react-pages-to-png` recipe; a worktree `next dev` proxies `/api` to PROD, so stub the API.
- [ ] **Push and open the PR.** Push `HEAD:refs/heads/feat/ops-detail-pages` and open the PR against `main`. The body covers what changed, the dead "Duplicates" filter fix, that there is no migration, and the test runs. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

# PR 2 — Classrooms

Branch `feat/ops-classrooms`, created from PR 1's head with `git checkout --no-track -b feat/ops-classrooms <PR1 head>`. The PR targets `main`, and its title says "merge after #<PR1>".

### Task 9: lc-up guards for class governance

**Files:**
- Modify: `backend/lcup/guards.py`
- Modify: `backend/classes/views_assign.py`: `ClassroomGovernanceUpdateView` (~412), `AssignTeacherView` (~221), `TransferOwnershipView` (~243) and `ClassroomGovernanceDeleteView` (~269)
- Test: `backend/lcup/tests_guards.py` (+ class)

**Interfaces:**
- Produces:
  - `LCUP_OWNED_CLASS_FIELDS: tuple[str, ...]`;
  - `lcup_owned_changes(classroom, data) -> list[str]`;
  - `lcup_managed_response(fields: list[str] | None = None, detail: str | None = None) -> Response`. With no arguments, the body is exactly what it is today.

- [ ] **Step 1: Failing tests** (append to `backend/lcup/tests_guards.py` and add the imports it lacks):

```python
@override_settings(LCUP_ENABLED=True, ALLOWED_HOSTS=["testserver", "admin.mastersat.uz"])
class GovernanceGuardTests(TestCase):
    HOST = "admin.mastersat.uz"

    def setUp(self):
        self.admin = User.objects.create_user(None, password=None, username="boss", role="admin")
        self.t = User.objects.create_user(None, password=None, username="t", role="teacher", subject="math")
        self.t2 = User.objects.create_user(None, password=None, username="t2", role="teacher", subject="math")
        self.room = Classroom.objects.create(name="G21", subject="MATH", created_by=self.t, teacher=self.t,
                                             room_number="301")
        LcupGroupLink.objects.create(lcup_group_id=10, name="G21", classroom=self.room, status=GroupLinkStatus.CONFIRMED)
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def patch(self, data):
        return self.api.patch(f"/api/classes/{self.room.pk}/details/", data, format="json", HTTP_HOST=self.HOST)

    def test_changing_a_field_lcup_owns_is_refused(self):
        r = self.patch({"room_number": "302"})
        self.assertEqual((r.status_code, r.json()["code"], r.json()["fields"]), (409, "lcup_managed", ["room_number"]))
        self.room.refresh_from_db()
        self.assertEqual(self.room.room_number, "301")

    def test_sending_lcup_fields_unchanged_with_our_own_is_fine(self):
        r = self.patch({"name": "G21", "room_number": "301", "description": "Morning group", "is_active": True})
        self.assertEqual(r.status_code, 200, r.content)
        self.room.refresh_from_db()
        self.assertEqual(self.room.description, "Morning group")

    def test_teacher_changes_and_delete_are_refused(self):
        for url in (f"/api/classes/{self.room.pk}/assign-teacher/", f"/api/classes/{self.room.pk}/transfer-ownership/"):
            r = self.api.post(url, {"user_id": self.t2.pk}, format="json", HTTP_HOST=self.HOST)
            self.assertEqual(r.status_code, 409, url)
        r = self.api.delete(f"/api/classes/{self.room.pk}/governance-delete/", HTTP_HOST=self.HOST)
        self.assertEqual(r.status_code, 409)
        self.assertTrue(Classroom.objects.filter(pk=self.room.pk).exists())

    def test_ta_seats_stay_ours(self):
        ta = User.objects.create_user(None, password=None, username="ta", role="support_teacher", subject="math")
        r = self.api.post(f"/api/classes/{self.room.pk}/support-teachers/", {"user_id": ta.pk}, format="json",
                          HTTP_HOST=self.HOST)
        self.assertIn(r.status_code, (200, 201), r.content)

    @override_settings(LCUP_ENABLED=False)
    def test_nothing_is_refused_while_the_integration_is_off(self):
        self.assertEqual(self.patch({"room_number": "302"}).status_code, 200)
```

Check every URL against `backend/classes/urls.py` and fix any literal that differs. Check that `Classroom.objects.create` has every required field (for example `lesson_days`), and add what the model requires.

- [ ] **Step 2: Run; fail. Step 3: Implement** in `lcup/guards.py`:

```python
#: What lc-up writes onto a paired class (lcup.follow.follow_details, archive_class, reopen_class) — changed
#: here, it would be undone within 15 minutes, and archiving would turn its students public at the next sync.
LCUP_OWNED_CLASS_FIELDS = (
    "name", "subject", "level", "lesson_days", "lesson_time", "lesson_hours", "branch", "room_number",
    "start_date", "is_active",
)


def _as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value).strip()


def lcup_owned_changes(classroom, data) -> list[str]:
    """The lc-up-owned fields ``data`` would CHANGE on ``classroom`` — the same value sent again is no change."""
    out = []
    for field in LCUP_OWNED_CLASS_FIELDS:
        if field not in data:
            continue
        current = classroom.branch_id if field == "branch" else getattr(classroom, field, None)
        raw = data[field]
        if field == "branch" and isinstance(raw, dict):
            raw = raw.get("id")
        if isinstance(current, bool):
            raw = str(raw).strip().lower() in ("1", "true", "yes", "on")
        if _as_text(current) != _as_text(raw):
            out.append(field)
    return out


def lcup_managed_response(fields: list[str] | None = None, detail: str | None = None) -> Response:
    if not fields and not detail:
        body = {"detail": "This class's students come from lc-up. Add or remove students there.", "code": "lcup_managed"}
    else:
        body = {
            "detail": detail or "lc-up sets " + ", ".join(f.replace("_", " ") for f in fields) + " for this class. "
            "Change it in lc-up.",
            "code": "lcup_managed",
            "fields": list(fields or []),
        }
    return Response(body, status=status.HTTP_409_CONFLICT)
```

This replaces the old `lcup_managed_response`.

In `views_assign.py`, import inside the handlers: `from lcup.guards import is_lcup_managed, lcup_managed_response, lcup_owned_changes`.
- **`ClassroomGovernanceUpdateView.patch`:** after the classroom is loaded and `_guard` passes, BEFORE serializer validation:

  ```python
  if is_lcup_managed(room):
      changed = lcup_owned_changes(room, request.data)
      if changed:
          return lcup_managed_response(changed)
  ```

- **`AssignTeacherView` and `TransferOwnershipView`:** after the classroom is loaded, add `if is_lcup_managed(room): return lcup_managed_response(["teacher"])`.
- **`ClassroomGovernanceDeleteView`:** add `if is_lcup_managed(room): return lcup_managed_response(["class"], detail="This class follows an lc-up group. Archive or delete the group in lc-up.")`.

- [ ] **Step 4: Run until `OK`:** `lcup.tests_guards classes.tests_classroom_details classes.tests_support_teacher_assign classes.tests_classroom_create_admin_only`.

  If an existing details test PATCHes a paired class's owned field with LCUP_ENABLED on, that test asserted the old, wrong behaviour. Fix it, and say so in the commit message.

- [ ] **Step 5: Commit**

```bash
git add backend/lcup/guards.py backend/classes/views_assign.py backend/lcup/tests_guards.py
git commit -m "fix(classes): a paired class's lc-up fields, teacher and existence can't be changed here

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shared changelist helpers + classrooms changelist endpoint

**Files:**
- Create: `backend/users/changelist.py`
- Modify: `backend/users/views_people.py` (use the helpers; responses unchanged)
- Create: `backend/classes/ops_classrooms.py`, `backend/classes/views_ops_classrooms.py`
- Modify: `backend/classes/urls.py`
- Test: `backend/classes/tests_ops_classrooms.py` (new). `backend/users/tests/test_people_api.py` must stay green WITHOUT edits.

**Interfaces:**
- Produces:
  - `users.changelist.to_int(raw)`;
  - `users.changelist.apply_search(qs, q: str, fields: list[str])`;
  - `users.changelist.facets(qs, defs: dict, params) -> (filtered_qs, filters_payload)`, where `defs` is `{key: (label, choices(qs) -> [(value, label, count)], to_q(value) -> Q | None)}`;
  - `users.changelist.paginate(qs, params) -> (window_qs, {count, page, page_size, pages})`;
  - `classes.ops_classrooms.CLASS_FILTERS`, `CLASS_ORDERING`, `CLASS_SEARCH`, `STUDENT_SEATS`, `PAIRED`, `class_row(room, managed: set[int]) -> dict`;
  - `classes.views_ops_classrooms.is_ops_admin(user) -> bool`;
  - `GET /api/classes/admin/classrooms/` (name `ops-classrooms`).

**Row shape:**

```json
{"id": 1, "name": "G21", "subject": "MATH", "level": "JUNIOR", "teacher": {"id": 3, "name": "Vali Aliyev"},
 "students": 12, "lesson_days": "MWF", "lesson_time": "14:00", "room_number": "301", "branch": "Chilonzor",
 "lcup": true, "is_active": true, "created_at": "ISO"}
```

- `teacher` is `null` when unset, and `branch` is `""` when unset.
- Filters:
  - `subject`, `level` (a blank level is the value `untagged`), `teacher`, `branch`, `days`;
  - `lcup`: `paired` / `unpaired`. Paired means a `confirmed` link not deleted in lc-up;
  - `status`: `active` / `archived`.
- Search covers the class name, the room and the teacher's names.
- Ordering: `name`, `-name`, `students`, `-students`, `created`, and `-created` (the default).

- [ ] **Step 1: Failing tests** (`tests_ops_classrooms.py`; setUp creates an admin, a teacher "Vali Aliyev", a paired class with 2 students and 1 TA, an unpaired class in room "301" with 1 student, and an archived class):
  - The list returns all 3 classes, newest first. A teacher gets 403.
  - `?lcup=paired` returns only the paired class. The `lcup` facet counts are `{"paired": 1, "unpaired": 2}`.
  - `?status=archived` returns only the archived class.
  - `?q=301` finds the room-301 class. `?q=aliyev` finds all of Vali's classes.
  - `?o=-students` puts the paired class first with `students == 2`, because the TA is not counted.
  - `page_size=25&page=9` clamps to page 1.
  - A row's `teacher` is `{"id", "name"}`, and `lcup` is a bool.

- [ ] **Step 2: `users/changelist.py`** — move the logic out of `PeopleListView` with no behaviour change:

```python
"""What a Django-admin changelist needs from the server — search, facets counted with the OTHER filters
applied, and clamped pages. Shared by the /ops people and classrooms lists."""

from __future__ import annotations

from django.db.models import Q

PAGE_SIZES = (25, 50, 100)
DEFAULT_PAGE_SIZE = 50


def to_int(raw):
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def apply_search(qs, q: str, fields: list[str]):
    for term in (q or "").split()[:5]:
        cond = Q()
        for f in fields:
            cond |= Q(**{f"{f}__icontains": term})
        qs = qs.filter(cond)
    return qs


def facets(qs, defs: dict, params):
    chosen = {}
    for key, (_, _, to_q) in defs.items():
        value = (params.get(key) or "").strip()
        q = to_q(value) if value else None
        if q is not None:
            chosen[key] = (value, q)

    def applied(base, skip=None):
        for key, (_, q) in chosen.items():
            if key != skip:
                base = base.filter(q)
        return base

    filters = [
        {
            "key": key,
            "label": label,
            "options": [{"value": v, "label": lab, "count": n} for v, lab, n in choices(applied(qs, skip=key))],
            "selected": chosen[key][0] if key in chosen else None,
        }
        for key, (label, choices, _) in defs.items()
    ]
    return applied(qs), filters


def paginate(qs, params):
    count = qs.count()
    size = to_int(params.get("page_size"))
    size = size if size in PAGE_SIZES else DEFAULT_PAGE_SIZE
    pages = max(1, -(-count // size))
    page = min(max(to_int(params.get("page")) or 1, 1), pages)
    return qs[(page - 1) * size: page * size], {"count": count, "page": page, "page_size": size, "pages": pages}
```

Rewrite `PeopleListView.get` with these helpers.
- Keep `_int` as an alias of `to_int`, because `FILTERS` uses it.
- Keep `PAGE_SIZES` and `DEFAULT_PAGE_SIZE` importable from `views_people`, via `from .changelist import PAGE_SIZES, DEFAULT_PAGE_SIZE`.
- Count on the unannotated qs. Then apply `with_activity_counts` to the window only, as today:

  ```python
  window, meta = paginate(qs, params)
  window = with_activity_counts(window)
  ```

  If Django refuses to annotate a sliced queryset, slice the annotated queryset with `meta`: `with_activity_counts(qs)[(meta["page"]-1)*meta["page_size"]: meta["page"]*meta["page_size"]]`.

Run `users.tests.test_people_api` and get `OK` BEFORE moving on.

- [ ] **Step 3: `classes/ops_classrooms.py`**

```python
"""/ops Classrooms as a Django-admin changelist and change form (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from django.db.models import Count, F, Q

from users.changelist import to_int
from users.people_detail import display_name, iso

from .models import Classroom, ClassroomMembership

STUDENT_SEATS = Count(
    "memberships",
    filter=Q(memberships__role=ClassroomMembership.ROLE_STUDENT, memberships__status=ClassroomMembership.STATUS_ACTIVE),
    distinct=True,
)
PAIRED = Q(lcup_group_link__status="confirmed", lcup_group_link__deleted_in_lcup_at__isnull=True)


def _present(qs, field, label_of=lambda v: v, blank=None):
    rows = qs.order_by().values(field).annotate(n=Count("pk", distinct=True))
    out = []
    for r in rows:
        v = r[field]
        if v in (None, ""):
            if blank:
                out.append((blank[0], blank[1], r["n"]))
            continue
        out.append((str(v), str(label_of(v)), r["n"]))
    return sorted(out, key=lambda c: c[1].casefold())


def _teacher_choices(qs):
    rows = (
        qs.exclude(teacher__isnull=True).order_by()
        .values("teacher_id", "teacher__first_name", "teacher__last_name", "teacher__username")
        .annotate(n=Count("pk", distinct=True))
    )
    out = [
        (str(r["teacher_id"]),
         f"{r['teacher__first_name']} {r['teacher__last_name']}".strip() or r["teacher__username"], r["n"])
        for r in rows
    ]
    return sorted(out, key=lambda c: c[1].casefold())


def _branch_choices(qs):
    rows = (
        qs.exclude(branch__isnull=True).order_by().values("branch_id", "branch__name")
        .annotate(n=Count("pk", distinct=True))
    )
    return sorted(((str(r["branch_id"]), r["branch__name"], r["n"]) for r in rows), key=lambda c: c[1].casefold())


CLASS_FILTERS = {
    "subject": ("Subject", lambda qs: _present(qs, "subject", lambda v: dict(Classroom.SUBJECT_CHOICES).get(v, v)),
                lambda v: Q(subject=v)),
    "level": ("Level", lambda qs: _present(qs, "level", blank=("untagged", "No level")),
              lambda v: (Q(level="") | Q(level__isnull=True)) if v == "untagged" else Q(level=v)),
    "teacher": ("Teacher", _teacher_choices, lambda v: Q(teacher_id=to_int(v)) if to_int(v) else None),
    "branch": ("Branch", _branch_choices, lambda v: Q(branch_id=to_int(v)) if to_int(v) else None),
    "days": ("Days", lambda qs: _present(qs, "lesson_days", lambda v: dict(Classroom.DAYS_CHOICES).get(v, v)),
             lambda v: Q(lesson_days=v)),
    "lcup": ("lc-up",
             lambda qs: [("paired", "Paired", qs.filter(PAIRED).count()),
                         ("unpaired", "Not paired", qs.exclude(PAIRED).count())],
             lambda v: {"paired": PAIRED, "unpaired": ~PAIRED}.get(v)),
    "status": ("Status",
               lambda qs: [("active", "Active", qs.filter(is_active=True).count()),
                           ("archived", "Archived", qs.filter(is_active=False).count())],
               lambda v: {"active": Q(is_active=True), "archived": Q(is_active=False)}.get(v)),
}

CLASS_ORDERING = {
    "name": (F("name").asc(),), "-name": (F("name").desc(),),
    "students": (F("students").asc(),), "-students": (F("students").desc(),),
    "created": (F("created_at").asc(),), "-created": (F("created_at").desc(),),
}
CLASS_SEARCH = ["name", "room_number", "teacher__first_name", "teacher__last_name", "teacher__username"]


def class_row(room, managed: set[int]) -> dict:
    return {
        "id": room.pk, "name": room.name, "subject": room.subject, "level": room.level or "",
        "teacher": {"id": room.teacher_id, "name": display_name(room.teacher)} if room.teacher_id else None,
        "students": getattr(room, "students", 0) or 0, "lesson_days": room.lesson_days or "",
        "lesson_time": room.lesson_time or "", "room_number": room.room_number or "",
        "branch": room.branch.name if room.branch_id else "", "lcup": room.pk in managed,
        "is_active": room.is_active, "created_at": iso(room.created_at),
    }
```

Check `SUBJECT_CHOICES` and `DAYS_CHOICES` against `classes/models.py`, and check the branch model's name field. Adjust them if they differ.

The `~PAIRED` exclude crosses a nullable reverse one-to-one, so a class with no link must count as unpaired. The Postgres run in Task 14 is where this is proved.

- [ ] **Step 4: `classes/views_ops_classrooms.py` + route**

```python
"""/ops Classrooms: changelist, change form and its parts (plan 2026-10-15-ops-detail-pages)."""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.changelist import apply_search, facets, paginate

from .models import Classroom
from .ops_classrooms import CLASS_FILTERS, CLASS_ORDERING, CLASS_SEARCH, STUDENT_SEATS, class_row


def is_ops_admin(user) -> bool:
    """The governance rule (views_assign._AdminClassroomGovernanceView._guard): superuser, super_admin, admin."""
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return str(getattr(user, "role", "") or "").strip().lower() in ("super_admin", "admin")


class ClassroomChangeListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from lcup.guards import lcup_managed_ids

        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        params = request.query_params
        qs = Classroom.objects.select_related("teacher", "branch").annotate(students=STUDENT_SEATS)
        qs = apply_search(qs, params.get("q") or "", CLASS_SEARCH)
        qs, filters = facets(qs, CLASS_FILTERS, params)
        ordering = params.get("o") or "-created"
        if ordering not in CLASS_ORDERING:
            ordering = "-created"
        window, meta = paginate(qs.order_by(*CLASS_ORDERING[ordering], "-pk"), params)
        rooms = list(window)
        managed = lcup_managed_ids(r.pk for r in rooms)
        return Response({**meta, "ordering": ordering, "results": [class_row(r, managed) for r in rooms],
                         "filters": filters})
```

In `classes/urls.py`, add `path('admin/classrooms/', ClassroomChangeListView.as_view(), name='ops-classrooms')`. Place it before any catch-all `<pk>`/router include that would shadow `admin/`. The URL becomes `/api/classes/admin/classrooms/`; confirm this from `config/urls.py`. Search with a teacher join can duplicate rows: if a test shows duplicates, add `.distinct()` after `apply_search`.

- [ ] **Step 5: Run** `classes.tests_ops_classrooms users.tests.test_people_api` until `OK`. **Commit:**

```bash
git add backend/users/changelist.py backend/users/views_people.py backend/classes/ops_classrooms.py backend/classes/views_ops_classrooms.py backend/classes/urls.py backend/classes/tests_ops_classrooms.py
git commit -m "feat(ops): Classrooms as a changelist — search, filters with counts, pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Classroom change-form endpoints

**Files:**
- Modify: `backend/classes/ops_classrooms.py` (+ `classroom_core`, `roster_part`, `class_attendance_part`, `homework_part`, `class_history_part`, `CLASS_PARTS`)
- Modify: `backend/classes/views_ops_classrooms.py` (+ `ClassroomDetailView`, `ClassroomPartView`)
- Modify: `backend/classes/urls.py`
- Test: `backend/classes/tests_ops_classrooms.py` (+ cases)

**Interfaces:**
- Produces:
  - `GET /api/classes/admin/classrooms/<pk>/` (name `ops-classroom`);
  - `GET /api/classes/admin/classrooms/<pk>/<part>/` (name `ops-classroom-part`), where part is one of `roster`, `attendance`, `homework`, `history`.

**Core shape:**

```json
{"id": 1, "name": "G21", "subject": "MATH", "level": "JUNIOR", "description": "", "lesson_days": "MWF",
 "lesson_time": "14:00", "lesson_hours": 2, "start_date": "YYYY-MM-DD", "room_number": "301",
 "branch": {"id": 2, "name": "Chilonzor"}, "telegram_chat_id": "", "telegram_group_url": "",
 "max_students": null, "is_active": true, "join_code": "ABC123", "created_at": "ISO",
 "teacher": {"id": 3, "name": "Vali Aliyev"}, "tas": [{"id": 4, "name": "…"}], "students": 12,
 "lcup": {"managed": true, "group_name": "G21 Math", "status": "confirmed", "locked_fields": ["name", "…"]}}
```

- `start_date`, `branch` and `teacher` may be `null`.
- `lcup` is `null` when the class has no `LcupGroupLink` at all.
- `locked_fields` is `list(LCUP_OWNED_CLASS_FIELDS)` when `managed`, and `[]` otherwise.

**Parts:**

```json
// roster
{"students": [{"id": 7, "name": "…", "username": "…", "section": "students", "joined_at": "ISO",
               "owes": 250000, "attendance_rate": 87.5, "homework_rate": 50.0}]}
// attendance
{"sessions": [{"date": "YYYY-MM-DD", "present": 10, "late": 1, "absent": 2, "excused": 0, "lcup_push": "sent"}],
 "rate": 85.0}
// homework
{"assignments": [{"id": 3, "title": "HW2", "due_at": "ISO", "turned_in": 9, "students": 12}]}
// history
{"items": [{"at": "ISO", "title": "Added — Aziz Tursunov", "by": "Vali Aliyev"}], "truncated": false}
```

**roster**
- Active STUDENT seats, sorted by name.
- `section`: `"students"` or `"public"`, from `users.people_detail.section_of`.
- `owes`: `-balance` when the lc-up balance is below 0, otherwise `null`.
- `attendance_rate`: `classes.attendance.compute_attendance_score` over that student's statuses in this class. Read the statuses in ONE query: `AttendanceRecord.objects.filter(session__classroom=room, student_id__in=ids).values_list("student_id", "status")`. It is `null` when the student has no records.
- `homework_rate`: `100 * done / published`, where:
  - the work is `[a for a in _academic_assignments(room) if a.category != CLASSWORK]`;
  - published is the subset with `status == PUBLISHED`;
  - done comes from `_completion_map(room, ids, work)`.

  It is `null` when nothing is published. It is rounded to 1 decimal.

**attendance**
- The last 20 `AttendanceSession`s, newest first.
- Each session's counts come from one `values("session_id", "status").annotate(n=Count("pk"))` query.
- `lcup_push`: the state for the session's date from `LcupAttendancePush.objects.filter(group__classroom=room)`, or `null`.
- `rate`: `compute_attendance_score` over every status in the class, or `null`.

**homework**
- The last 20 published non-classwork assignments, ordered by `-due_at` with nulls last, then `-created_at`.
- `turned_in`: from `_completion_map(room, active_student_ids, work)`.
- `students`: the active student count.

**history**
- `ClassroomMembershipEvent.objects.filter(classroom=room)` (FK) newest first, at most 200.
- `title`: `"{MEMBERSHIP_ACTIONS label} — {student_name}"`. Reuse `users.people_parts.MEMBERSHIP_ACTIONS`; the labels read "Added to …" there, so use a separate class-side dict here: `{"ADDED": "Added", "REMOVED": "Removed", "REINSTATED": "Back", "ROLE_CHANGED": "Role changed", "STATUS_CHANGED": "Status changed", "DELETED": "Seat deleted"}`.
- `by`: `actor_name`.

- [ ] **Step 1: Failing tests** (one per shape):
  - The core of the paired class has `lcup.managed` true and `locked_fields == list(LCUP_OWNED_CLASS_FIELDS)`. The unpaired class has `lcup` null.
  - In the roster, a student with PRESENT and ABSENT records gets `attendance_rate` 50.0. A student with lc-up balance -100000 gets `owes` 100000.
  - Attendance: a session with 1 PRESENT and 1 ABSENT counts `present` 1 and `absent` 1.
  - Homework: a SUBMITTED submission makes `turned_in` 1.
  - History: the list includes an "Added" item.
  - An unknown part returns 404, a missing class returns 404, and a teacher gets 403.

- [ ] **Step 2: Implement** the functions as specified. Add the views:

```python
class ClassroomDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        from .ops_classrooms import classroom_core

        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        room = Classroom.objects.select_related("teacher", "branch").filter(pk=pk).first()
        if room is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(classroom_core(room))


class ClassroomPartView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int, part: str):
        from .ops_classrooms import CLASS_PARTS

        if not is_ops_admin(request.user):
            return Response({"detail": "Admins only."}, status=403)
        build = CLASS_PARTS.get(part)
        room = Classroom.objects.filter(pk=pk).first() if build else None
        if room is None:
            return Response({"detail": "Not found."}, status=404)
        return Response(build(room))
```

Routes: `admin/classrooms/<int:pk>/` and `admin/classrooms/<int:pk>/<str:part>/`.

- [ ] **Step 3: Run until `OK`. Step 4: Commit**

```bash
git add backend/classes/ops_classrooms.py backend/classes/views_ops_classrooms.py backend/classes/urls.py backend/classes/tests_ops_classrooms.py
git commit -m "feat(ops): one class's change-form data — fields lc-up owns, roster rates, attendance, homework, history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Classrooms changelist page

**Files:**
- Create: `frontend/src/features/ops/classrooms/classroomsApi.ts`, `ClassroomList.tsx`, `CreateClassroomModal.tsx`
- Replace: `frontend/src/app/(ops)/ops/classrooms/page.tsx` (becomes a thin page rendering `<ClassroomList />` inside `Suspense`)
- Test: `frontend/src/features/ops/classrooms/__tests__/ClassroomList.test.tsx`

**Interfaces:**
- Consumes: `ChangeList`, `useChangeListParams`, `withListFilters`, `GET /classes/admin/classrooms/` (+ Task 11 endpoints).
- Produces:
  - types `ClassroomRow`, `ClassroomCore`, `ClassroomPartName = "roster" | "attendance" | "homework" | "history"`;
  - `classroomKeys`;
  - `useClassrooms(params)`, `useClassroom(id)`, `useClassroomPart<T>(id, part)`;
  - `CLASSROOM_FILTER_KEYS = ["subject", "level", "teacher", "branch", "days", "lcup", "status"]`;
  - `classroomQuery(params)`.

  The hooks follow the same pattern as `peopleApi.ts` and `personApi.ts`.

- [ ] **Step 1: Failing test:**
  - Rows show the columns Name (link `/ops/classrooms/<id>`, plus `_changelist_filters` when the URL has a query), Subject, Level, Teacher, Students, Schedule (`MWF 14:00`), Room, lc-up (Yes / —) and Status (Active / Archived).
  - The header button "Add classroom" opens the create modal (heading "Add classroom").
  - With `?lcup=paired` in the URL, the request carries `lcup: "paired"`.
- [ ] **Step 2: Move the create flow** into `CreateClassroomModal.tsx` (`{open, onClose, onCreated: (id: number) => void}`). Move these from the old page with behaviour unchanged:
  - the create modal JSX;
  - its state (`createForm`, the region→branch pickers via `useRegions`/`useBranches`, the teacher and support-teacher pickers);
  - the `classesApi.create` call.

  After a successful create, `ClassroomList` routes to `/ops/classrooms/<id>`.
- [ ] **Step 3: Implement `ClassroomList.tsx`.** It is `ChangeList` with:
  - `title="Classrooms"`, `noun={{singular: "class", plural: "classes"}}`;
  - `headerAction` = the "Add classroom" button;
  - `rowHref`;
  - `filterKeys={CLASSROOM_FILTER_KEYS}`;
  - `searchPlaceholder="Search class, room or teacher"`;
  - no `actions`.

  Delete the old page's subject→level drill-down, the edit, students, support and assign modals, and the delete flow. Their jobs move to the change form in Task 13. Leave `classesApi`'s helpers in `lib/api.ts` alone; Task 13 uses them.
- [ ] **Step 4: Run vitest + tsc. Step 5: Commit**

```bash
git add frontend/src/features/ops/classrooms "frontend/src/app/(ops)/ops/classrooms/page.tsx"
git commit -m "feat(ops): Classrooms is a changelist like the people lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Classroom change-form page

**Files:**
- Create: `frontend/src/features/ops/classrooms/ClassroomPage.tsx`, `ClassroomForm.tsx`, `sections/RosterSection.tsx`, `sections/StaffSection.tsx`, `sections/ClassAttendanceSection.tsx`, `sections/ClassHomeworkSection.tsx`, `sections/ClassHistorySection.tsx`
- Create: `frontend/src/app/(ops)/ops/classrooms/[id]/page.tsx`
- Test: `frontend/src/features/ops/classrooms/__tests__/ClassroomPage.test.tsx`

**Interfaces:**
- Consumes:
  - the Task 11 endpoints;
  - from `@/lib/api`: `classesApi.governanceUpdate(id, payload)`, `assignTeacher(id, userId)`, `transferOwnership`, `supportTeachers`, `assignSupportTeacher`, `removeSupportTeacher`, `addMember`, `removeMember` and `governanceDelete` (read their exact signatures in `lib/api.ts`);
  - `useRegions` and `useBranches`, as the old page imported them;
  - `Fieldset`, `PartBody` and `Row` from `features/ops/people/Fieldset.tsx`;
  - `ConfirmDialog` from `features/ops/people/ConfirmDialog.tsx`;
  - `listHrefFrom`.

- [ ] **Step 1: Failing tests:**
  - **Paired class form:**
    - the inputs Name, Level, Days, Time, Lesson hours, Start date, Room and Branch are `disabled`, and each has the caption "Set in lc-up";
    - Description, Telegram chat id, Telegram link and Max students are enabled;
    - Save sends `governanceUpdate` whose payload contains the unchanged locked values plus the edited description.
  - **Paired class, other places:**
    - the roster has no "Add student" and no "Remove", and reads "Students come from lc-up.";
    - the teacher row has no "Change";
    - TAs still have Add and Remove;
    - the header has no "Delete" and no "Archive".
  - **Unpaired class:**
    - everything is enabled;
    - "Delete" asks for confirmation, then calls `governanceDelete` and routes back to the list.
  - **A 409 from Save** shows the server's `detail` inline above Save.
  - **Roster:** a student's name links to `/ops/students/<id>` or `/ops/public/<id>`, depending on `section`. `owes` shows in `text-danger` through `formatUzs`.
- [ ] **Step 2: Implement.**

  **Layout:** the same as `PersonPage`.
  - The title row reads `Classrooms › <name>`, with the subline `Subject · Level · lc-up group "<group_name>"` (or `Not paired`) · `N students`.
  - Actions:
    - for an unpaired class: Archive / Restore (`governanceUpdate({is_active})`) and Delete (confirm);
    - for a paired class: no actions, only the muted text "Managed in lc-up".
  - Columns: `ClassroomForm` on the left, `StaffSection` on the right. Below them, full width: Roster, Attendance, Homework, History.

  **`ClassroomForm`:**
  - Fields: Name, Level (the choices by subject, the same as the old edit modal), Description, Days, Time, Lesson hours, Start date, Room, Region→Branch, Telegram chat id, Telegram link, Max students.
  - A field in `core.lcup?.locked_fields` is disabled and has the caption "Set in lc-up".
  - Read-only `Row`s: Subject, Join code, Created.
  - Save sends every field (locked ones unchanged) through `governanceUpdate`.

  **`StaffSection`:**
  - The teacher row shows the name. For an unpaired class there is a "Change" control: a select of teachers of the class's subject, from `GET /users/admin/people/?section=staff&role=teacher&subject=<math|english>&page_size=100`, then `assignTeacher`.
  - Support teachers: a list with Remove, plus an Add select (`role=support_teacher`). This works for both kinds of class.

  **`RosterSection`:**
  - A table: Name | Joined | Owes | Attendance | Homework | (Remove, unpaired only).
  - "Add student" (unpaired only) is a search input. It queries `GET /users/admin/people/?section=students&q=…` and `?section=public&q=…` and merges both result lists. Picking a person calls `addMember`.
  - For a paired class, the caption reads "Students come from lc-up."

  **Attendance, Homework and History sections:** tables of the Task 11 shapes in `PartBody`, with the same labels as the person sections.

  **The page file:** `app/(ops)/ops/classrooms/[id]/page.tsx`, built like the person pages (`useParams` + `Suspense`).
- [ ] **Step 3: Run the full vitest + tsc. Step 4: Commit**

```bash
git add frontend/src/features/ops/classrooms "frontend/src/app/(ops)/ops/classrooms/[id]/page.tsx"
git commit -m "feat(ops): a change form for every class — lc-up fields locked, roster, staff, attendance, homework

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: PR 2 — verify and open

- [ ] **Backend.** Run `classes.tests_ops_classrooms lcup.tests_guards lcup.tests_follow users.tests.test_people_api`, plus the classes modules listed in Task 9. Each must print `OK`. If the parallel runner crashes on pickling, run the classes modules one at a time with xargs.
- [ ] **Postgres.** Run `classes.tests_ops_classrooms users.tests.test_people_api`. This covers the `~PAIRED` exclude across the nullable one-to-one, and DISTINCT with the annotate.
- [ ] **Frontend.** Run the full vitest and the tsc probe. Take screenshots of `/ops/classrooms` and of `/ops/classrooms/<id>` (one paired, one unpaired), at desktop width and at 390px.
- [ ] **Push and open the PR:**
  1. Push `HEAD:refs/heads/feat/ops-classrooms`.
  2. Open the PR against `main`, titled "… (merge after #<PR1>)".
  3. The body says that the diff shows PR 1's commits until PR 1 lands.
  4. Run the merge-tree simulation from memory `stacked-pr-targets-main`.

## Rollout (both PRs)
- **No migration.** Deploy with a zero-downtime full release switch (`shared/bg-phaseA.<sha>.sh` + `bg-phaseB.sh`), only after the owner says yes.
- **Smoke test on prod:**
  - open one student, one public user, one staff member, and one paired and one unpaired class;
  - a PATCH of a paired class's room must return 409.
