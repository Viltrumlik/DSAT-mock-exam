# SMS control panel in /ops: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Every task is TDD: write the failing tests, see them fail, implement, see them pass, commit.

**Goal:** a `/ops/sms` section that gives super_admin and admin everything the SMS system can do:
- the balance and the eskiz status;
- a journal of every SMS;
- the eskiz templates, with submitting a new one to moderation;
- a test SMS;
- control of the debt warning: on/off, the two templates, the send hour, the next list, and "send now";
- manual campaigns ("jo'natma") to one student, a group or the debtors, sent now or at a set time, with cancel and retry.

**Architecture:** this extends `backend/sms` (built in #299 and #300).
- **New models:**
  - `SmsSettings`: a singleton with the debt-warning switch, hour and templates.
  - `EskizTemplate`: a cache of eskiz's templates.
  - `SmsCampaign`: one manual send.
- **`SmsMessage`** gains a `campaign` FK and a `created_by` FK.
- **Engine:** `sms/campaigns.py` resolves the recipients AT SEND TIME and sends through the existing `delivery.deliver`.
- **API:** `/api/sms/admin/…` (plain `APIView`s guarded by `IsGlobalAdmin`, allowlisted in `host_guard`).
- **Frontend:** `features/ops/sms/`, a page with 5 tabs plus a campaign detail page.

**Spec:** none, by the owner's rule "spec = code". The design was approved in chat on 2026-10-18 (approach A, 3 sections) and is recorded in memory `sms-ops-panel.md`. The predecessor plan is `2026-10-18-eskiz-sms-debt-warnings.md`.

## Global Constraints

- **Who:** super_admin + admin (`classes.capabilities.is_global_admin`). Students and teachers get 403; signed-out users get 401.
- **UI language:** English, like the rest of /ops. SMS texts stay as eskiz approved them.
- **Recipients:**
  - The kinds are one student, a group (a class's ACTIVE STUDENT members) and debtors: linked learners with `balance < 0`, not `deleted_in_lcup`, **frozen ones included**.
  - There are **no free-typed numbers**.
  - The phone is ALWAYS the lc-up phone (`LcupStudentLink.phone`, normalised). No link or no phone means the person is skipped and listed.
  - Recipients are **resolved at send time**, so a scheduled debtors campaign skips anyone who has since paid.
- **Limits and money:**
  - At most **300 recipients** per campaign, checked at preview, at create and again at send.
  - Every paid action (campaign, send-now, test) shows the count and the estimated cost and asks to confirm.
  - Cost = parts × `SMS_PRICE_PER_PART` (env, default 170 so'm; measured 2026-10-18).
  - Parts = GSM: ≤160 chars is 1 part, otherwise ⌈n/153⌉; with any non-ASCII character, ≤70 is 1, otherwise ⌈n/67⌉.
- **Never twice:**
  - The campaign dedupe key is `campaign:<id>:student:<lcup_student_id>` (kind `campaign`).
  - A campaign is claimed SCHEDULED→SENDING in one `UPDATE … WHERE status='SCHEDULED'`.
  - Every existing guarantee of `deliver` holds: UNCERTAIN is never resent, FAILED may be resent.
- **Debt warning:**
  - The behaviour stays the same; only the knobs move into `SmsSettings`.
  - The defaults are what is live now: on, hour 10, #64942 / #52393, slots `["student"]`.
  - `SMS_DEBT_WARNINGS_ENABLED` (env) stays as the **master kill-switch**: env off means nothing goes out, whatever the panel says.
  - The beat becomes hourly at :00. At `hour` it runs a normal run; at `hour+1` and `hour+2` it runs retry-only.
  - "Send now" works on warning days only, through the same `send()` (the dedupe makes a later scheduled run a no-op).
- **Templates:**
  - An `EskizTemplate` row is eskiz's `template` (pattern) plus `original_text`, `status` and `eskiz_id`.
  - It is synced by a button and by a beat at 09:00 daily.
  - Only `service`/`reklama` templates can be used. `reklama` is labelled "ad price".
  - Submitting a template is `POST /user/template` (form field `template`), then a sync.
- **Slot roles** (one per `%d`/`%w` slot):
  - `student`: the lc-up name, ≤4 words, followed by the punctuation that comes after the placeholder in `original_text`, when it can be found.
  - `debt`: digits.
  - `text`: typed once, the same for all.
  - The roles are guessed from `original_text`: `(STUDENT)` or `{name}` → `student`, everything else → `text`. The admin can change them.
  - Debt-warning templates may use only `student` and `debt`.
- **Logins:** eskiz logins stay rare. The balance is cached 5 min, and the overview never forces a login when no token is cached and the last login was refused.
- **Git and tests:**
  - Git as Viltrumlik; commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Backend tests: `SECRET_KEY=test-secret DEBUG=True LMS_FORCE_SQLITE_FOR_TESTS=1 /Users/macbook/.pyenv/versions/3.12.2/bin/python3 manage.py test <label> --settings=config.settings_test_nomigrations -v 1`. Only `OK` counts.
  - Frontend: `npx vitest run <path>` and `npx tsc --noEmit -p .` (memory: tsc false green, so check the exit code AND the output).

## File Structure

| File | Responsibility |
|---|---|
| `backend/sms/models.py` | + `SmsSettings`, `EskizTemplate`, `SmsCampaign`; `SmsMessage` + `campaign`, `created_by`, kind `campaign` |
| `backend/sms/migrations/0002_*.py` | generated (the `SmsSettings` row is created lazily by `SmsSettings.get()` with the live defaults) |
| `backend/sms/eskiz.py` | + `submit_template(text)` |
| `backend/sms/templates.py` | + `parts(text)`, `slots(pattern)`, `guess_roles(original, pattern)`, `role_suffixes(original, pattern)` |
| `backend/sms/switchboard.py` | `current() -> SmsSettings`, `debt_enabled()`, `debt_templates() -> (SmsTemplate, SmsTemplate)`, `price_per_part()` |
| `backend/sms/eskiz_templates.py` | `sync(client)`, `submit(client, text, user)`, `usable()` |
| `backend/sms/debt_warnings.py` | the templates come from `switchboard`; + `runs(days)` history |
| `backend/sms/campaigns.py` | `resolve()`, `render_for()`, `preview()`, `create()`, `dispatch_due()`, `send_campaign()`, `cancel()`, `retry_failed()` |
| `backend/sms/tasks.py` | + `debt_warnings_tick`, `debt_warnings_now`, `send_due_campaigns`, `sync_templates` |
| `backend/sms/views.py`, `backend/sms/urls.py` | the admin API |
| `backend/config/urls.py`, `backend/access/host_guard.py`, `backend/config/settings.py` | route, allowlist, beat + `SMS_PRICE_PER_PART` |
| `frontend/src/features/ops/sms/*` | `smsApi.ts`, `smsHooks.ts`, `format.ts`, `SmsPage.tsx`, `OverviewPanel.tsx`, `TestSmsForm.tsx`, `JournalPanel.tsx`, `CampaignsPanel.tsx`, `CampaignWizard.tsx`, `CampaignPage.tsx`, `DebtPanel.tsx`, `TemplatesPanel.tsx`, `SubmitTemplateModal.tsx` + `__tests__/` |
| `frontend/src/app/(ops)/ops/sms/page.tsx`, `.../sms/campaigns/[id]/page.tsx` | routes |
| `frontend/src/features/ops/shell/opsNav.ts`, `adminScope.ts`, `shell/__tests__/opsNav.test.ts` | nav entry "SMS" in "Centre" (after Finance) |

---

## Backend

### Task 1: Models and migration

**Fields:**
- `SmsSettings` (one row, pk=1; `SmsSettings.get()` creates it):
  - `debt_enabled` bool, default True
  - `debt_hour` smallint, default 10, 8..20
  - `warning_template_id` int, default 64942; `warning_pattern` text (default = `templates.DEBT_WARNING.text`); `warning_slots` json, default `["student"]`
  - `last_day_template_id` int, default 52393; `last_day_pattern` text; `last_day_slots` json
  - `updated_by` FK user, null; `updated_at`
- `EskizTemplate`:
  - `eskiz_id` int unique, `pattern` text, `original` text, `status` char(16), `synced_at`
  - `submitted_by` FK user, null; `submitted_at` null
- `SmsCampaign`:
  - `template_eskiz_id` int; `pattern` text (a snapshot); `original` text
  - `slot_roles` json (list of `student|debt|text`); `slot_texts` json (list, "" for non-text slots)
  - `audience` char: `student|group|debtors`; `audience_ids` json (user ids, or [classroom id], or [])
  - `scheduled_at` datetime
  - `status` char: `SCHEDULED|SENDING|DONE|CANCELLED|FAILED`
  - `result` json (counts and skipped lists)
  - `error` char(400); `created_by` FK; `created_at`, `started_at`, `finished_at`
- `SmsMessage`: + `campaign` FK null (related `messages`); + `created_by` FK null; kind choice + `campaign`.

- [ ] Write `sms/tests_models_panel.py`:
  - the `SmsSettings.get()` defaults equal the live behaviour (hour 10, ids 64942/52393, patterns equal `templates.DEBT_WARNING.text` / `DEBT_LAST_DAY.text`);
  - the singleton stays at pk 1;
  - campaign status defaults to SCHEDULED;
  - an `SmsMessage` can be created with `kind="campaign"` and a campaign.
- [ ] Run → fail. Implement the models, then `makemigrations sms` (0002). Check the generated migration touches only `sms`.
- [ ] Run → OK. Commit `feat(sms): settings, template cache and campaigns in the database`.

### Task 2: eskiz submit + template helpers

- `EskizClient.submit_template(text) -> dict`: POST `/user/template` with form field `template`. It raises `EskizError` on HTTP ≥ 400 and is a terminal-style read like `templates()`.
- `templates.parts(text) -> int`: GSM/UCS-2 as in the Global Constraints.
- `templates.slots(pattern) -> list[dict]`, each `{kind: "d"|"w", min, max}` (`%w` = 1..1, `%w{a,b}` = a..b, `%d` = 1..1).
- `templates.guess_roles(original, pattern) -> list[str]`: the placeholders in `original` matching `\(([A-Z_]+)\)|\{(\w+)\}`, in order. When their count equals the slot count, map `STUDENT`/`name`/`student` to `student`, else `text`. Otherwise every slot is `text`.
- `templates.role_suffixes(original, pattern) -> list[str]`: per slot, the run of `[,.!?:;]` right after the matching placeholder (only when the counts match); otherwise "".
- [ ] Tests in `sms/tests_eskiz.py` (submit: the POST form and an error raised) and `sms/tests_templates.py`:
  - parts: 160 ASCII = 1, 161 = 2, 70 non-ASCII = 1, 71 = 2;
  - slots of `"%w{1,4} sizda %d"`;
  - `guess_roles`: #64942 → `["student"]`; #61959 has 3 placeholders but 2 slots → `["text", "text"]`;
  - `role_suffixes`: #64942 → `[","]`, #94973 `"(STUDENT)!"` → `["!"]`.
- [ ] Implement, OK, commit.

### Task 3: Switchboard and template cache

- `switchboard.current()` = `SmsSettings.get()`.
- `switchboard.debt_enabled()` = env `SMS_DEBT_WARNINGS_ENABLED` AND `current().debt_enabled`.
- `switchboard.debt_templates()` → `(SmsTemplate("debt_warning", warning_pattern, tuple(warning_slots)), SmsTemplate("debt_last_day", …))`.
- `switchboard.price_per_part()` reads `settings.SMS_PRICE_PER_PART` (int, default 170).
- `eskiz_templates.sync(client) -> {"added", "updated", "total"}`: upsert every row from `client.templates()` by `eskiz_id`. Rows eskiz no longer lists are kept, and their status becomes `gone`.
- `eskiz_templates.submit(client, text, user)`:
  - The text is stripped and must be ≤ 1000 chars and contain at least one letter.
  - It calls `client.submit_template`, then `sync`, and stamps `submitted_by`/`submitted_at` on the row whose `original` equals the text.
- `eskiz_templates.usable()` = status in (`service`, `reklama`).
- [ ] Tests (`sms/tests_switchboard.py`, `sms/tests_eskiz_templates.py`, with `FakeEskiz` gaining `template_rows` + `submitted`):
  - env off beats db on;
  - db off beats env on;
  - the templates follow the settings;
  - sync adds, updates and marks gone;
  - submit stamps the user;
  - submit refuses an empty or over-long text.
- [ ] Implement, OK, commit.

### Task 4: Debt warnings read their knobs from the switchboard

- `debt_warnings.plan()`:
  - uses `switchboard.debt_enabled()`; both the lc-up freeze flag AND `debt_enabled` are needed;
  - takes its templates from `switchboard.debt_templates()`; the code constants stay only as migration defaults;
  - adds a `debt` value to `_values`, and the slots are validated to be ⊆ {`student`, `debt`}.
- `debt_warnings.runs(days=60)`: rows of `{run_on, total, by_status: {...}, parts, cost}` from `SmsMessage(kind=debt_warning)`, newest first.
- `tasks.debt_warnings_tick()`: on each hourly beat, if the local hour == `debt_hour` it runs normally; at +1 or +2 it runs retry-only; otherwise it skips. It keeps the existing `RUNNING_KEY` lock. The old `debt_warnings`/`retry_debt_warnings` stay registered (manual use).
- `tasks.debt_warnings_now()` is "Send now": a normal run, refused (returns `{"skipped": …}`) unless enabled and it is a warning day.
- `settings.py` beat:
  - replace `sms-debt-warnings` (10:00) and `sms-debt-warnings-retry` (11,12) with `sms-debt-warnings-tick` = `crontab(minute=0)`;
  - add `sms-sync-templates` = `crontab(hour=9, minute=0)` and `sms-send-due-campaigns` = `crontab()` (every minute);
  - add `SMS_PRICE_PER_PART`.
- [ ] Update `sms/tests_debt_warnings.py` and `sms/tests_tasks.py`:
  - patch the switchboard instead of the module constants;
  - tick: hour 10 → normal, 11/12 → retry-only, 13 → skip, and a changed hour 9 is honoured;
  - the db switch off → disabled;
  - `runs()` totals.
  - Every old behaviour test still passes.
- [ ] Implement, OK, commit.

### Task 5: Campaign engine

- **Audience:**
  - `student` = `audience_ids` user ids (1..300);
  - `group` = [classroom id] → ACTIVE `ClassroomMembership` with `role=STUDENT` and `classroom.is_active`;
  - `debtors` = `LcupStudentLink(user≠null, user.role∈LEARNER_ROLES, balance<0, deleted_in_lcup=False)`.
- `resolve(campaign_like) -> (recipients, skipped)`:
  - A recipient is `{user, link, phone, text}`.
  - `skipped` is a dict `reason → [{user_id, name}]`, where the reason is `no_link`, `no_phone`, `not_debtor` (only for `student`/`group` when a `debt` slot is used and the balance ≥ 0) or `bad_text`.
  - One recipient per lc-up student.
- `render_for(campaign_like, user, link) -> str`: builds an `SmsTemplate(pattern, roles)`. The values are `student` = name ≤4 words + suffix, `debt` = `int(abs(balance))`, `text` = `slot_texts[i]`. It raises `TemplateError`.
- `preview(draft) -> {count, skipped, samples[≤3], parts_max, parts_total, cost, over_limit}`. The draft is validated:
  - the template is usable;
  - the roles list has the slot count;
  - every `text` slot is non-empty;
  - an audience is present;
  - `scheduled_at` is ≥ now − 1 min (null means now).
- `create(draft, user) -> SmsCampaign`: the same validation, plus `count` between 1 and 300; it snapshots the pattern and original. "now" means `scheduled_at=now`, then `on_commit(tasks.send_due_campaigns.delay)`.
- `dispatch_due(client, now) -> int`: claims each campaign with `filter(pk, status=SCHEDULED, scheduled_at<=now).update(status=SENDING, started_at=now)`, then calls `send_campaign`.
- `send_campaign(client, campaign)`:
  - resolves the recipients; if there are more than 300, the campaign is FAILED with an error and nothing is sent;
  - for each recipient, `deliver(kind=campaign, run_on=localdate, dedupe_key=f"campaign:{id}:student:{lcup_id}", …, campaign=…, created_by=campaign.created_by)`; this needs `deliver` to accept `campaign=` and `created_by=` (an additive change);
  - an exception for one recipient is logged by type and counted;
  - stores `result = {sent, failed, rejected, uncertain, errors, skipped}`; the status becomes DONE.
- `cancel(campaign)`: only SCHEDULED, otherwise `CampaignRefused`.
- `retry_failed(campaign, client)`: only DONE; re-delivers the FAILED rows (deliver's re-claim) and returns a count.
- [ ] Tests (`sms/tests_campaigns.py`):
  - each audience resolves;
  - debtors include the frozen;
  - skips: no link, no phone, a paid debtor at send time;
  - a 301-recipient group is refused at create, and FAILED at send if it grew;
  - a SCHEDULED future campaign is not sent before its time;
  - dispatch claims once (two calls → one send);
  - cancel works only when SCHEDULED;
  - retry resends FAILED, not UNCERTAIN;
  - the rendered text for #64942 with the role suffix equals `"MASTER SAT'dan yozyabmiz. Karimova Malika, sizda …"`;
  - the preview cost = parts × price.
- [ ] Implement, OK, commit.

### Task 6: Admin API

`sms/urls.py` under `api/sms/` (`config/urls.py`), all `IsGlobalAdmin`:

| Method + path | Does |
|---|---|
| GET `admin/overview/` | `{configured, balance (cached 5 min; null on error), sender, price_per_part, eskiz: {token_cached, login_refused, last_error}, debt: {enabled, env_enabled, db_enabled, hour, next_day, next_count}, last7: {by_status}, today: {total}}` |
| GET `admin/messages/` | changelist. Search: phone, text, user first/last name, lcup name. Facets: `kind`, `status`, `when` (today/7d/30d). Ordering `-created_at`. Rows: `{id, created_at, kind, status, eskiz_status, phone, text, parts, request_id, user: {id, name} \| null, campaign_id, created_by_name, error}` |
| GET `admin/campaigns/` · POST `admin/campaigns/` · POST `admin/campaigns/preview/` · GET `admin/campaigns/<id>/` (+ its messages) · POST `admin/campaigns/<id>/cancel/` · POST `admin/campaigns/<id>/retry/` | campaigns |
| GET `admin/settings/` · PATCH `admin/settings/` | `debt_enabled`, `debt_hour`, the warning/last-day template id + slots. The pattern is taken from `EskizTemplate`, which must be usable with slots ⊆ {student, debt}. Records `updated_by` |
| GET `admin/debt/preview/?day=YYYY-MM-DD` · POST `admin/debt/send-now/` (202, enqueues) · GET `admin/debt/runs/` | debt warning |
| GET `admin/templates/` · POST `admin/templates/sync/` · POST `admin/templates/` (submit) | templates. Each row adds `slots`, `guessed_roles`, `parts`, `ascii` |
| POST `admin/test/` | `{phone, template_id, slot_texts?}`. Renders with `SAMPLE_VALUES` + texts and delivers kind `test` with `created_by` |
| GET `admin/audience/classrooms/` · GET `admin/audience/students/?q=` | pickers: active classes with student counts; linked learners with name, lcup name, phone, balance (≤20) |

- `host_guard`: `if path.startswith("/api/sms/"): return self.get_response(request)` in the admin-console block.
- Errors are `{"detail"}` 400s. Domain refusals raise `CampaignRefused`/`SettingsRefused` with a `code`.
- [ ] Tests (`sms/tests_api.py`):
  - 401 signed out; 403 for a student and a teacher; 200 for admin and super_admin;
  - the admin host is allowed;
  - every route is guarded (loop over the URLconf like `telegram_posts/tests_api.py`);
  - the overview shape; the messages filters, search and pagination;
  - campaign create, preview, cancel and retry through the API;
  - a settings PATCH validates the hour range and the template's slots, and is refused when the template is unusable;
  - send-now refused off a warning day;
  - templates sync and submit go through `FakeEskiz`;
  - a test SMS is delivered with `created_by`.
- [ ] Implement, OK, commit.

## Frontend

### Task 7: API client, hooks, formatting, nav, page shell

- `smsApi.ts`: typed functions for every endpoint above (root-relative paths `"/sms/admin/…"`; no `/api/`). The types are the response shapes above.
- `smsHooks.ts`: React Query hooks with keys under `["sms", …]`; every mutation invalidates `["sms"]`.
- `format.ts`: `statusBadge(status)`, `kindLabel`, `money(n)` → "1 020 so'm", `roleLabel`.
- Nav: `{ href: "/ops/sms", label: "SMS", icon: MessageSquareText }` after Finance in "Centre"; add `/ops/sms` to `ADMIN_OPS_SECTIONS`; update `opsNav.test.ts`.
- `app/(ops)/ops/sms/page.tsx` → `SmsPage`:
  - an `OpsPageHeader` ("SMS", the description);
  - `Tabs` Overview | Journal | Campaigns | Debt warnings | Templates; the state is in `?tab=` (`useSearchParams` + `router.replace`).
- [ ] Tests:
  - `opsNav.test.ts` (labels);
  - `__tests__/format.test.ts`;
  - `__tests__/SmsPage.test.tsx` (the tabs render the right panel, using mocked hooks).
- [ ] Implement; vitest OK, tsc 0; commit.

### Task 8: Overview + test SMS

- `OverviewPanel` cards:
  - Balance (with the price per part);
  - Sender;
  - eskiz (an OK/warning badge, the last error);
  - Debt warning (on/off, hour, next day + count; a link to the tab);
  - Last 7 days (delivered / undelivered / other);
  - Today.
- An `Alert` if not configured or the env switch is off.
- `TestSmsForm`:
  - fields: phone input, template select (usable templates), one input per `text` slot, a preview of the rendered sample;
  - Send → `window.confirm("Send 1 SMS (~N so'm) to 998…?")` → POST → an inline Alert with the result.
- [ ] Tests:
  - renders the balance and the not-configured alert;
  - the test form refuses a bad phone, confirms, then posts the payload.
- [ ] Implement, OK, commit.

### Task 9: Journal

- `JournalPanel` uses `ChangeList` + `useChangeListParams` over `admin/messages/`.
- Columns: time, recipient (name + phone), kind, status badge (eskiz status in the title), parts, text (truncated), by.
- A row click opens a `Drawer` with the full text, the request id, the error, and the campaign link.
- [ ] Tests: rows render, a filter click changes the URL params, the drawer shows the full text.
- [ ] Implement, OK, commit.

### Task 10: Campaigns: list, wizard, detail

- `CampaignsPanel`: a list (status badge, template first line, audience label, scheduled time, sent/failed counts, by) and a "New campaign" button.
- `CampaignWizard` (Modal) steps:
  1. Pick a usable template; the pattern and original are shown.
  2. Slots: a role select per slot (student/debt/text, defaulting to `guessed_roles`) and a text input for `text` slots.
  3. Audience: a segmented choice. Student → a search box (`audience/students`) with a multi-pick of chips; Group → a classroom select; Debtors → nothing to pick.
  4. When: Now / At (datetime-local, `lib/datetimeLocal`).
  5. Preview (POST preview): count, skipped lists, ≤3 samples, parts, cost, an over-limit error.
  6. Confirm: `window.confirm` with the count and cost → POST create → close + toast.
- `CampaignPage` (`/ops/sms/campaigns/[id]`):
  - a header card (status, template, audience, when, by, result counts);
  - the per-recipient messages table;
  - Cancel (when SCHEDULED) and Retry failed (when DONE with failures), both confirmed.
- [ ] Tests:
  - the wizard defaults the roles from the guess;
  - it blocks Next when a text slot is empty;
  - the preview numbers show;
  - confirm posts the exact body;
  - the detail page shows Cancel only when SCHEDULED.
- [ ] Implement, OK, commit.

### Task 11: Debt warnings tab

- `DebtPanel`:
  - a `Switch` (on/off; disabled with a note when the env master is off);
  - an hour select (08–20);
  - two template selects (only usable templates whose slots fit), each with a role select per slot (student/debt) and a rendered sample;
  - Save → PATCH (confirm when turning off).
- "Next warning day" list: `debt/preview` for the next warning day, with skipped counts.
- "Send now": shown on warning days only; confirm with the count and cost → POST send-now → a notice "queued".
- History table: `debt/runs`.
- [ ] Tests: Save posts the PATCH, Send now shows only on a warning day, the master-off note shows.
- [ ] Implement, OK, commit.

### Task 12: Templates tab

- `TemplatesPanel`:
  - a table: id, status badge (service / ad price / moderation / rejected / gone), pattern, original, slots, parts, an ASCII warning;
  - a "Refresh from eskiz" button → POST sync → a toast with the counts;
  - "New template" → `SubmitTemplateModal`: a textarea with a parts/ASCII counter and a hint about `(STUDENT)`; it posts, closes and shows a toast saying "sent to eskiz moderation".
- [ ] Tests: the rows render, refresh posts, submit refuses empty text and posts.
- [ ] Implement, OK, commit.

## Task 13: Verify, review, PR

- [ ] Run `sms lcup` (SQLite), then `sms` on Postgres with migrate 0002 on a fresh cluster.
- [ ] Run vitest for `features/ops` + `shell`, then tsc (exit code and output).
- [ ] An independent review of the branch (Django + React reviewers, read-only). Fix what they find, with tests.
- [ ] Push, open the PR, bind it.

## Rollout (owner's go-ahead each step)

1. Zero-downtime full release:
   - online pg_dump, then migrate-first `sms.0002`; the old code never reads the new tables or columns, and the `SmsMessage` columns are nullable;
   - phase A/B blue-green, which restarts celery worker + beat for the new beat entries;
   - **phase A must accept the live HOTPATCH.md from #300**: it is merged and an ancestor, so check it with `merge-base --is-ancestor`.
2. Verify:
   - `/ops/sms` loads;
   - the overview shows the balance;
   - templates sync;
   - the debt settings show on, 10:00, #64942 / #52393.
3. A test SMS from the panel to 998880032508.
4. Owner review. Then phase 2: replace lc-up's automatic SMS, as its own brainstorm.
