# SMS panel — API contract (backend ⇄ frontend)

This file is binding for both lanes of `2026-10-18-sms-ops-panel.md`.

- All paths are under `/api/sms/admin/`. The frontend calls them root-relative as `"/sms/admin/…"`.
- Every endpoint needs super_admin, admin or a Django superuser. A signed-out caller gets 401; any other role gets 403.
- An error is `{"detail": "<human text>", "code"?: "<machine code>"}` with status 400, unless stated otherwise.
- A body that is not a JSON object (a list, a string, a number, `null`) sent to POST `campaigns/`, POST `campaigns/preview/`, POST `templates/`, POST `test/` or PATCH `settings/` is a 400 with `code: "body"`, never a 500.
- **No SMS POST is retried by the client** (React Query `retry: false` on every SMS mutation). A paid POST (campaign create, `debt/send-now/`, `test/`) that fails with no HTTP answer may have gone out: the panel refetches everything under `["sms"]` and says so.
- Times are ISO 8601 with an offset (DRF default). Dates are `YYYY-MM-DD` (Tashkent local).
- The enums are listed under [Enums](#enums) at the end.

## GET overview/

```json
{
  "configured": true,
  "balance": 63460,
  "price_per_part": 170,
  "sender": "4546",
  "eskiz": {
    "token_cached": true,
    "login_refused": false,
    "last_error": "HTTP 422: mobile_phone: …"
  },
  "debt": {
    "enabled": true,
    "env_enabled": true,
    "db_enabled": true,
    "freeze_enabled": true,
    "hour": 10,
    "next_day": "2026-11-01",
    "next_count": 0,
    "today_sent": 0,
    "today_left": 0
  },
  "today": { "total": 2, "by_status": { "DELIVERED": 2 } },
  "last7": { "total": 2, "by_status": { "DELIVERED": 2 } }
}
```

- `balance` is null when eskiz could not be asked. It is cached for 5 min. One request at a time asks eskiz (cache lock `sms:balance-lock`, 30 s); another request meanwhile answers from the cache, or null.
- `last_error` is the newest non-empty `SmsMessage.error`, or `""`.
- `debt.enabled` = `env_enabled` AND `db_enabled` AND `freeze_enabled`.
- `forecast` (plan 2026-11-01-sms-v2, Task 3) is `{"debt", "campaigns", "automations", "total", "balance", "short"}`, all in so'm. It is what the next 24 hours will spend:
  - `debt`: today's warnings not yet sent while today's runs are on (up to hour + 2), plus tomorrow's list once today's hour has passed;
  - `campaigns`: SCHEDULED campaigns due within 24 h;
  - `automations`: 0 until the builder.
  `short` = `balance` is known AND `balance < total`. The panel shows the red banner on every tab when it is true.
- `month` (Task 3) is `{"sent", "rate", "cost"}` for the current Tashkent month, with the same meanings as `GET stats/` totals.

## GET stats/

Added by plan 2026-11-01-sms-v2, Task 2. The query is `?from=YYYY-MM-DD&to=YYYY-MM-DD`, inclusive, on Tashkent days of `created_at`.
- No `to` means today.
- No `from` means 30 days ending at `to`.
- `to` before `from`, more than 366 days, or a date it cannot read: **400** with `code: "range"`.
- `campaign=<id>` narrows it to that campaign's messages, and `debt_effect` is then `[]`. A value that is not an id is a 400 with `code: "range"`.

```json
{
  "from": "2026-10-03", "to": "2026-11-01",
  "totals": {"sent": 190, "delivered": 178, "undelivered": 11, "rejected": 1, "failed": 0, "pending": 0, "rate": 0.937, "cost": 32300},
  "by_day": [{"day": "2026-11-01", "sent": 190, "delivered": 178, "undelivered": 11, "rejected": 1, "failed": 0, "pending": 0, "rate": 0.937, "cost": 32300}],
  "by_operator": [{"operator": "Uzmobile", "total": 60, "delivered": 51, "rate": 0.85}],
  "cost_by_month": [{"month": "2026-11", "debt_warning": 32300, "campaign": 0, "automation": 0, "test": 340, "total": 32640}],
  "debt_effect": [{"month": "2026-11", "warned": 194, "paid_1": 40, "paid_3": 88, "paid_5": 120, "open": 0, "unpaid": 74}]
}
```

- `sent` counts what eskiz took: SENT, DELIVERED and UNDELIVERED.
- `pending` counts what has not reached its end: SENT, PENDING and UNCERTAIN.
- `rate` = delivered ÷ (delivered + undelivered + rejected), or null when that sum is 0.
- `cost` is in so'm: parts × the row's `unit_price`, or today's price for rows from before prices were kept. FAILED and REJECTED cost 0. The panel labels it an estimate.
- `by_operator` lists, in this order, Beeline, Ucell, Uzmobile, Mobiuz, Perfectum, Humans, then Other. It names the operator from the two digits after 998 and omits any operator with no rows.
- `debt_effect` covers the last 3 months up to `to`, oldest first, and only months that had warnings:
  - `warned` counts distinct lc-up students with a debt warning eskiz took;
  - `paid_N` counts those with an lc-up `payment` within N days of their first warning that month, where the first day counts as day 1;
  - `open` (review fix) counts those not paid yet whose 5 days are not over at `to`;
  - `unpaid` = `warned − paid_5 − open`, so it holds only those whose 5 days ran out.

## GET messages/

A changelist, the same shape as `users/views_people`.

- **Query:** `q`, `kind`, `status`, `when` (`today|7d|30d`), `operator`, `group`, `teacher`, `template`, `campaign`, `from`, `to`, `page` and `page_size` (25/50/100).
  - `resendable=1` (Task 8) keeps only UNDELIVERED, REJECTED and FAILED, before the facets are counted. The overview's "Did not arrive" list uses it.
  - `from` and `to` are `YYYY-MM-DD` Tashkent days, inclusive. They narrow the rows before the facets are counted. An unreadable date is ignored.
- **Response:** `{count, page, pages, page_size, results: [Message], filters: [ChangeListFilter]}`.
- **Message:**

  ```json
  {
    "id": 3,
    "created_at": "…",
    "sent_at": "…|null",
    "kind": "campaign",
    "status": "DELIVERED",
    "eskiz_status": "DELIVERED",
    "phone": "998901234567",
    "text": "…",
    "parts": 1,
    "request_id": "uuid|''",
    "error": "",
    "user": { "id": 5, "name": "Malika Karimova" },
    "lcup_student_id": 101,
    "campaign_id": 7,
    "created_by_name": "Admin Name|''",
    "attempts": 1,
    "checked_at": "…|null",
    "operator": "Uzmobile",
    "groups": ["Junior G21 | Math"],
    "source": { "type": "campaign", "id": 7, "label": "Campaign #7 · Debtors" },
    "template": { "id": 64942, "label": "#64942" },
    "cost": 170,
    "can_resend": false
  }
  ```

  - `user` is null when the message has no user.
  - Added 2026-11-01 (plan sms-v2, Task 4): the seven fields from `attempts` to `cost`.
    - `operator` comes from the two digits after 998; an unlisted code is "Other".
    - `groups` are the student's active classes NOW, by name.
    - `source.type` is `debt_warning`, `campaign` or `test`. Its label is "Debt warning", "Campaign #<id> · <audience label>" or "Test".
    - `template.label` is `#<id>` (Part 2 replaces it with the alias), or "" when there is none.
    - `cost` is in so'm. FAILED and REJECTED cost 0, as in `GET stats/`.
    - `can_resend` (review fix, 2026-11-02) says whether `POST messages/resend/` would take the SMS now. It must be UNDELIVERED, REJECTED or FAILED. A debt warning also needs to be from today, with the warning switched on (env, panel and freeze), because its text names its day and the student may have paid since.
- **Filters**, in this order:
  - `kind` (Debt warning / Campaign / Test);
  - `status` (every status);
  - `when` (Today / Last 7 days / Last 30 days);
  - `operator`: the operator names that have rows, Other last;
  - `group`: active classes holding a matching message's student in an active seat now, by class id and name;
  - `teacher`: the teachers of those classes, by user id and name;
  - `template`: by eskiz id, label `#<id>`;
  - `campaign`: by id, label `#<id> · <audience label>`.
  The group and teacher filters list a message once, even when its student sits in several matching classes.

## GET messages/export/

Added by plan 2026-11-01-sms-v2, Task 5. It takes the same query as `GET messages/`, without `page`/`page_size`. It returns every matching row, newest first, at most 50 000, as `text/csv` in UTF-8 with a BOM, so Excel reads Uzbek letters. The file is named `sms-journal-YYYY-MM-DD.csv`.

Columns, in this order: `Date` (Tashkent, `YYYY-MM-DD HH:MM`), `Name`, `Phone`, `Groups` (joined by `; `), `Operator`, `Kind`, `Source`, `Template`, `Status`, `Reason`, `Parts`, `Cost`, `Text`. `Reason` uses the same words as the panel's status text:
- Delivered;
- Operator rejected;
- Phone off or out of reach;
- Not delivered;
- Forbidden word;
- eskiz refused;
- eskiz not reached;
- Unknown — may have gone;
- Waiting for the operator.

` · try N` is added when attempts > 1.

## POST messages/resend/

Added by Task 5. Body: `{"ids": [int]}`, 1–300 ids. Anything else: **400** with `code: "ids"`. Response: `{"queued": [ids], "not_resendable": [ids]}`.
- Only UNDELIVERED, REJECTED and FAILED (`RESENDABLE`) are queued. An unknown id counts as not resendable.
- The queued ones go to `sms.tasks.resend_messages` after the commit. Each one goes once more under its own (kind, day, key), to the student's CURRENT lc-up phone; `attempts` + 1.
- A row that has changed status in the meantime is skipped. Two resends at once send one SMS.
- The panel confirms the count and price first, and never retries the request.

## GET students/<user_id>/messages/

Added by Task 5. Response: `{"summary": {"DELIVERED": 3, …}, "results": [Message]}`. `results` holds that student's SMS, newest first, at most 200. `summary` counts all of them by status.

## Campaigns

### Campaign object

```json
{
  "id": 7,
  "status": "SCHEDULED",
  "template_eskiz_id": 64942,
  "pattern": "MASTER SAT'dan yozyabmiz. %w{1,4} sizda …",
  "original": "MASTER SAT'dan yozyabmiz. (STUDENT), sizda …",
  "slot_roles": ["student"],
  "slot_texts": [""],
  "audience": "group",
  "audience_ids": [61],
  "audience_label": "Group: Junior G21 | Math",
  "scheduled_at": "…",
  "created_at": "…",
  "started_at": "…|null",
  "finished_at": "…|null",
  "created_by_name": "…",
  "error": "",
  "result": {
    "sent": 0,
    "failed": 0,
    "rejected": 0,
    "uncertain": 0,
    "delivered": 0,
    "undelivered": 0,
    "errors": 0,
    "skipped": { "no_phone": [{ "user_id": 9, "name": "…" }] }
  }
}
```

`audience_label` comes from the server. Examples: `"Debtors"`, `"Group: <classroom name>"`, `"2 groups"`, `"Math · Junior · Chilonzor"`, `"3 students"`, `"Student: <name>"`.

A Campaign also carries `audience_filter` (`{"subjects", "levels", "branches", "days"}` lists; `{}` unless the audience is `filter`) and `excluded_user_ids` (the people taken out by hand).

`result.delivered` and `result.undelivered` are counted live from the campaign's messages. The other counts are filled at send time.

How a campaign's `status` moves:

- `SCHEDULED` → `SENDING` when its time comes (claimed once).
- `SENDING` → `DONE` when every recipient was tried.
- `SENDING` → `FAILED` when it is over the limit at send time, when the recipients cannot be worked out, or when **5 sends in a row** came back FAILED or UNCERTAIN (or raised). Then `error` is `"eskiz kept failing — stopped after <N> sent; press Retry to continue"` and the remaining recipients have no message yet.
- A `SENDING` campaign whose `started_at` (a heartbeat, bumped every 20 recipients) is older than **15 min** lost its worker: the minute beat claims it again and finishes it, skipping every recipient whose SMS already exists.
- `DONE` / `FAILED` → `SENDING` on Retry (below).

`result.skipped` and the preview's `skipped` always carry `no_link`, `no_phone`, `stale_balance`, `not_debtor`, `bad_text` and `excluded` (taken out by hand); `same_phone` appears when a sibling on the same phone gets the same words (one SMS between them).

- `stale_balance`: the audience is `debtors`, or a slot is `debt`, and lc-up's `balance_seen_at` is missing or older than 24 h. This is checked at preview, at create and again at send.

### Endpoints

| Endpoint | Response |
|---|---|
| GET `campaigns/` | `{"campaigns": [Campaign]}`, newest first, at most 200 |
| GET `campaigns/<id>/` | `{"campaign": Campaign, "messages": [Message]}` |
| POST `campaigns/preview/` | Preview (below) |
| POST `campaigns/` | 201 `{"campaign": Campaign}`, or 400 |
| POST `campaigns/<id>/cancel/` | `{"campaign": Campaign}`. 400 with `code: "not_scheduled"` unless the campaign is SCHEDULED |
| POST `campaigns/<id>/retry/` | `{"queued": n}`. 400 with `code: "not_done"` unless the campaign is DONE or FAILED; 400 `code: "not_configured"` when eskiz has no keys |

`campaigns/<id>/retry/` is a **resume**:

- In the request, the campaign is claimed `SENDING` in one UPDATE (`started_at` = now, `finished_at` = null, `error` = ""). A second click, or a second admin, gets `not_done`.
- A queued task then sends it again. The recipients are worked out anew, so a debtor who has paid since is skipped. The text is rendered again. FAILED messages are re-claimed and sent with the new text. Recipients with no message yet are sent. Every other message (SENT, DELIVERED, UNCERTAIN, …) is never sent again.
- `queued` (best effort) is how many that would send: the recipients as of now whose message is missing or FAILED.
- A campaign's messages are filed under the day it was **scheduled for** (`run_on`), so a resume or a retry on a later day still finds them.

### Draft (request body of preview and create)

```json
{
  "template_id": 64942,
  "slot_roles": ["student"],
  "slot_texts": [""],
  "audience": "student",
  "audience_ids": [5, 9],
  "scheduled_at": null
}
```

- `template_id` is an `EskizTemplate.eskiz_id`.
- `slot_texts` has one entry per slot. A `text` slot needs a value; other slots ignore theirs.
- `audience_ids` depends on the audience:
  - `student`: user ids, 1 to 300 of them;
  - `group`: 1 to 50 active classroom ids;
  - `debtors` and `filter`: an empty list.
- `audience: "filter"` takes `audience_filter`: `{"subjects": ["MATH"], "levels": ["junior"], "branches": [3], "days": ["ODD"]}`. Active classes only: AND across the keys, OR within one. Values are `ENGLISH`/`MATH`, `foundation`/`junior`/`middle`/`senior`, branch ids, `ODD`/`EVEN`. With no value at all it is refused (`code: "audience"`).
- `excluded_user_ids` (optional, any audience): these people are skipped under `excluded`.
- A student in two of the classes gets one SMS. Who is in a class or a filter is decided when it goes out.
- `scheduled_at` null means send now.

### Preview

```json
{
  "count": 2,
  "over_limit": false,
  "limit": 300,
  "samples": [{ "name": "Malika Karimova", "phone": "998901234567", "text": "…", "parts": 1 }],
  "parts_total": 2,
  "cost": 340,
  "skipped": { "no_link": [], "no_phone": [{ "user_id": 9, "name": "…" }], "stale_balance": [], "not_debtor": [], "bad_text": [] }
}
```

- `samples` holds at most 3 entries.
- `cost` = `parts_total` × `price_per_part`.

### Create refusals

Each refusal is a 400 with a `code`:

| Code | When |
|---|---|
| `template` | The template is unknown or not usable. |
| `slots` | `slot_roles` or `slot_texts` has the wrong length, or a `text` slot is empty. |
| `audience` | No audience or a wrong id. |
| `empty` | Nobody would receive it. |
| `body` | The body is not a JSON object. |
| `over_limit` | More than 300 recipients. |
| `past` | `scheduled_at` is more than 1 min in the past. |

## Settings

### GET settings/

```json
{
  "debt_enabled": true,
  "debt_hour": 10,
  "warning_template_id": 64942,
  "warning_pattern": "…",
  "warning_slots": ["student"],
  "last_day_template_id": 52393,
  "last_day_pattern": "…",
  "last_day_slots": ["student"],
  "updated_at": "…|null",
  "updated_by_name": "…|''",
  "env_enabled": true,
  "freeze_enabled": true,
  "freeze_day": 6
}
```

### PATCH settings/

The body may contain any of: `debt_enabled`, `debt_hour` (8–20), `warning_template_id` + `warning_slots`, `last_day_template_id` + `last_day_slots`.

- When a template id is sent, the server copies that `EskizTemplate.pattern` into the setting.
- The template must be usable, `slots` must have its slot count, and every slot must be `student` or `debt`.
- **Response:** the same shape as GET.
- **Refusals:** `code` is `hour`, `template`, `slots` or `body`.

## Debt warning

| Endpoint | Response |
|---|---|
| GET `debt/preview/?day=YYYY-MM-DD` | Debt preview (below). `day` defaults to the next warning day |
| POST `debt/send-now/` | 202 `{"queued": true}` |
| GET `debt/runs/` | `{"runs": [{"run_on": "2026-11-01", "total": 12, "by_status": {"DELIVERED": 11, "UNDELIVERED": 1}, "parts": 12, "cost": 2040}]}`, newest first, the last 60 days |

`debt/send-now/` is refused with 400 `code: "disabled"` when the warning is off, or `code: "not_a_warning_day"` on any other day.

### Debt preview

```json
{
  "day": "2026-11-01",
  "is_last_day": false,
  "blocked": "",
  "skipped": { "not_freezable": 22 },
  "count": 3,
  "sent_today": 1,
  "to_send": 2,
  "cost": 340,
  "warnings": [{ "lcup_student_id": 101, "name": "Karimova Malika", "phone": "998901234567", "debt": 150000, "text": "…", "parts": 1 }]
}
```

- `count`: everyone the plan would warn that day, sent or not. `warnings` lists them all. The overview's `debt.next_count` is this planned count too.
- `sent_today`: that day's `debt_warning` messages whose status is not FAILED. They are never sent again.
- `to_send`: the planned warnings whose dedupe key has no non-FAILED message that day, i.e. what a run would still send.
- `cost`: the `to_send` warnings' parts × `price_per_part`.
- "That day" is `day`; for today it is today's run.

## Templates

### Template row

```json
{
  "eskiz_id": 64942,
  "status": "service",
  "pattern": "…",
  "original": "…",
  "slots": [{ "kind": "w", "min": 1, "max": 4 }],
  "guessed_roles": ["student"],
  "parts": 1,
  "ascii": true,
  "usable": true,
  "synced_at": "…",
  "submitted_by_name": "",
  "submitted_at": null
}
```

### Endpoints

| Endpoint | Response |
|---|---|
| GET `templates/` | `{"templates": [Template], "synced_at": "…|null"}`. Usable templates come first, then the most used, then by `eskiz_id` descending |
| PATCH `templates/<eskiz_id>/` | `{"template": Template}`. Body `{"alias": "…"}`: trimmed, at most 80 characters, `""` clears it. Anything else is a 400 with `code: "alias"`; an unknown id is a 404 |
| POST `templates/sync/` | `{"added": 0, "updated": 32, "gone": 0, "total": 32}` |
| POST `templates/` | 201 `{"template": Template\|null, "sync": {…}}`, with `template` null if eskiz has not listed it yet |

A Template carries `alias` (the panel's own name, kept by every sync), `label` (the alias, else `#<eskiz_id>`), `used_count` (messages with this template in the last 90 days) and `last_used_at` (the newest of those, or null). The journal's `template.label` and its template filter use `label`.

`POST templates/` takes `{"text": "…"}`. It is refused with `code: "text"` when the text is empty or longer than 1000 characters, with `code: "eskiz"` when eskiz refuses (`detail` carries eskiz's words), and with `code: "body"` when the body is not an object.

## Test SMS

POST `test/` takes:

```json
{ "phone": "998880032508", "template_id": 64942, "slot_texts": [""] }
```

It renders the template with `SAMPLE_VALUES` (`student = "Test Testov,"`, `debt = 100000`) and the given `slot_texts`.

**Response:**

```json
{ "message": { "...": "Message" } }
```

`message` is a Message as defined under `GET messages/`.

**Refusals:** `code` is `phone`, `template`, `slots`, `not_configured`, `body` or `duplicate`.

- `duplicate`: the same phone and template were already sent a test this minute (Tashkent). The dedupe key is `test:<phone>:<template_id>:<YYYYmmddHHMM>`, so a double click sends one SMS. A test that never left (FAILED) may go again in the same minute.

## Audience pickers

| Endpoint | Response |
|---|---|
| GET `audience/options/` | `{"subjects": [{"value": "MATH", "label": "Math", "classes": 12}], "levels": […], "branches": [{"value": 3, "label": "Chilonzor", "classes": 8}], "days": […]}`: the values some active class has, and how many classes |
| POST `audience/preview/` | `{"count": 142, "over_limit": false, "limit": 300, "skipped": {…}, "recipients": [{"user_id": 5, "name": "…", "phone": "99890***4567", "groups": ["…"]}]}`. Who an audience is before any template is chosen: the body is a draft's `audience`, `audience_ids`, `audience_filter`, `excluded_user_ids`, refused like a draft. No words yet, so siblings on one phone both count |
| GET `audience/classrooms/` | `{"classrooms": [{"id": 61, "name": "Junior G21 \| Math", "students": 14, "with_phone": 12}]}` |
| GET `audience/students/?q=` | `{"students": [{"id": 5, "name": "Malika Karimova", "lcup_name": "Karimova Malika", "phone": "998901234567", "balance": -150000}]}` |

- `classrooms` lists active classes by name.
- `students` lists linked learners, at most 20, and searches name, username and lc-up name.

## Enums

| Enum | Values |
|---|---|
| `status` | `PENDING`, `SENT`, `DELIVERED`, `UNDELIVERED`, `REJECTED`, `FAILED`, `UNCERTAIN` |
| `kind` | `debt_warning`, `campaign`, `test` |
| campaign status | `SCHEDULED`, `SENDING`, `DONE`, `CANCELLED`, `FAILED` |
| `audience` | `student`, `group`, `debtors`, `filter` |
| slot role | `student`, `debt`, `text` |
| template status | `service`, `reklama`, `moderation`, `inproccess`, `rejected`, `gone` |
| campaign skip reason | `no_link`, `no_phone`, `stale_balance`, `not_debtor`, `bad_text`, `same_phone` |
