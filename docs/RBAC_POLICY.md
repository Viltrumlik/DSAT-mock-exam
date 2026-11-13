## RBAC policy (backend authoritative)

This document describes **who can do what** across subdomains. Frontend UI may hide buttons, but the backend is the authority.

### Subdomains (coarse routing / defense-in-depth)
- **`questions.*`**: staff authoring console (exams authoring + assessments authoring)
- **`admin.*`**: operations console (users + bulk assign + assessments homework assign + read-only assessment admin)
- **main/apex**: student/teacher portal (attempt flows, practice library browsing, classroom flows)

### Roles (normalized)
- `student`
- `teacher`
- `test_admin`
- `admin`
- `super_admin` (and Django superuser)

### Exams / tests (PracticeTest / MockExam) actions

#### List/author tests & questions (`/api/exams/admin/**`)
- **Allowed**: `test_admin`, `admin`, `super_admin`, Django superuser
- **Denied**: `teacher`, `student`
- **Canonical host(s)**:
  - `questions.*`: allowed (preferred)
  - `admin.*`: allowed (supported)
  - main/apex: allowed (same-origin SPA deployments), but still gated by DRF permissions

#### Public practice library (`/api/exams/`)
- **Audience**: anon + students + teachers (scoped) + staff browsing
- **Staff consoles guard**:
  - On `questions.*` and `admin.*`, if a **global staff** user hits `GET /api/exams/`, backend returns **400** with a message pointing at `/api/exams/admin/tests/` (prevents “silent empty list” confusion).

#### Attempt flows (`/api/exams/attempts/**`)
- **Allowed**: authenticated users with `submit_test` (students)
- **Denied**: non-students without submit permission (enforced via DRF `RequiresSubmitTest`)
- **Canonical host**: main/apex (also works on same-origin, but UX is portal-centric)

### Assigning exams to students (bulk assign)

#### Bulk assign (`POST /api/exams/bulk_assign/`)
- **Allowed**: staff with `assign_access` for all subjects implied by request payload (wildcard allowed)
- **Typical roles**: `admin`, `test_admin`, `teacher` (subject-scoped)
- **Canonical host(s)**: `admin.*` (primary), also allowed on `questions.*` by host guard

### Assessments (sets/questions) actions

#### Author assessments (`/api/assessments/admin/**`)
- **Allowed**: staff with `CanEditTests`/`CanManageQuestions`-adjacent permissions (policy via `access.permissions.CanEditTests`)
- **Canonical host**: `questions.*`
- **admin.* policy**: **GET-only** (browse); POST/PATCH/DELETE denied by host guard

#### Assign assessments as homework (`POST /api/assessments/homework/assign/`)
- **Allowed**:
  - Actor must be a **class admin** for target classroom
  - Must pass `CanAssignTests`
  - If actor is `teacher`: must be teacher-owner of classroom and set subject must match teacher domain
- **Canonical host**: `admin.*` (also callable from other hosts if not blocked by guard)

### CRM (ops console) actions

Each CRM endpoint names one permission with `access.permissions.Requires(...)` and never compares role names
(`access/tests/test_crm_permissions.py` walks every URL and fails on a CRM view without one). The permissions
take no subject. A role is a preset of them (`access.services._role_permissions_map`), and a per-person tick
(`access.UserPermission`) adds or removes one for one person; a removal wins over the role.

| Permission | Endpoints |
|---|---|
| `view_people` | `/api/classes/admin/classrooms/**` reads, `/api/classes/admin/lessons/today/`, parents' contacts on person pages |
| `edit_people` | `/api/users/admin/people/<id>/parent/` |
| `view_money` | `/api/billing/` reads, `/api/lcup/finance/debtors/` and `payments/` |
| `take_payment` / `adjust_balance` | `/api/billing/accounts/<id>/entries/` (a payment or refund / an adjustment) |
| `void_payment` | `/api/billing/entries/<id>/void/` |
| `set_prices` | `/api/billing/seats/<id>/price/`, a class's `monthly_price` |
| `debt_freeze` | `/api/lcup/finance/exempt/<id>/` |
| `enroll` | seat add, new student, `activate`; `/api/lcup/followups/`; adding a student without a join code |
| `manage_seats` | seat freeze, return, move, leave, fix-date |
| `manage_groups` | a class's teacher, owner, support teachers, details, deletion, Telegram removal |
| `send_sms` / `send_debt_sms` | `/api/sms/admin/**` / its `debt/` routes; the journal opens to either |
| `view_reports` | `/api/lcup/finance/summary/` |
| `events_shop` | staff views of shop, events, stories, Telegram posts; somebody else's coins |
| `lcup_tools` | the rest of `/api/lcup/` except a learner's own claim and finance |
| `manage_staff` | none yet (the Staff page) |

Presets today: `super_admin` holds everything, `admin` every CRM permission, every other role none.

### Telemetry counters (Prometheus via `/api/exams/prometheus/`)
- **`exams_wrong_staff_endpoint_total`**: increments when global staff on `admin/questions` consoles hits `GET /api/exams/` instead of `/api/exams/admin/tests/`.\n+- **`exams_forbidden_admin_route_total`**: increments when host guard blocks console-only routes (students hitting `admin/questions`, blocked assessments authoring on `admin.*`, etc.).

