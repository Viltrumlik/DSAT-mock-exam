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
    "next_count": 0
  },
  "today": { "total": 2, "by_status": { "DELIVERED": 2 } },
  "last7": { "total": 2, "by_status": { "DELIVERED": 2 } }
}
```

- `balance` is null when eskiz could not be asked. It is cached for 5 min. One request at a time asks eskiz (cache lock `sms:balance-lock`, 30 s); another request meanwhile answers from the cache, or null.
- `last_error` is the newest non-empty `SmsMessage.error`, or `""`.
- `debt.enabled` = `env_enabled` AND `db_enabled` AND `freeze_enabled`.

## GET messages/

A changelist, the same shape as `users/views_people`.

- **Query:** `q`, `kind`, `status`, `when` (`today|7d|30d`), `page`, `page_size` (25/50/100).
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
    "created_by_name": "Admin Name|''"
  }
  ```

  `user` is null when the message has no user.
- **Filters:** `kind` (Debt warning / Campaign / Test), `status` (every status), `when` (Today / Last 7 days / Last 30 days).

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

`audience_label` comes from the server. Examples: `"Debtors"`, `"Group: <classroom name>"`, `"3 students"`, `"Student: <name>"`.

`result.delivered` and `result.undelivered` are counted live from the campaign's messages. The other counts are filled at send time.

How a campaign's `status` moves:

- `SCHEDULED` → `SENDING` when its time comes (claimed once).
- `SENDING` → `DONE` when every recipient was tried.
- `SENDING` → `FAILED` when it is over the limit at send time, when the recipients cannot be worked out, or when **5 sends in a row** came back FAILED or UNCERTAIN (or raised). Then `error` is `"eskiz kept failing — stopped after <N> sent; press Retry to continue"` and the remaining recipients have no message yet.
- A `SENDING` campaign whose `started_at` (a heartbeat, bumped every 20 recipients) is older than **15 min** lost its worker: the minute beat claims it again and finishes it, skipping every recipient whose SMS already exists.
- `DONE` / `FAILED` → `SENDING` on Retry (below).

`result.skipped` and the preview's `skipped` always carry `no_link`, `no_phone`, `stale_balance`, `not_debtor` and `bad_text`; `same_phone` appears when a sibling on the same phone gets the same words (one SMS between them).

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
  - `group`: one classroom id;
  - `debtors`: an empty list.
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
| GET `templates/` | `{"templates": [Template], "synced_at": "…|null"}`. Usable templates come first, then by `eskiz_id` descending |
| POST `templates/sync/` | `{"added": 0, "updated": 32, "gone": 0, "total": 32}` |
| POST `templates/` | 201 `{"template": Template\|null, "sync": {…}}`, with `template` null if eskiz has not listed it yet |

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
| `audience` | `student`, `group`, `debtors` |
| slot role | `student`, `debt`, `text` |
| template status | `service`, `reklama`, `moderation`, `inproccess`, `rejected`, `gone` |
| campaign skip reason | `no_link`, `no_phone`, `stale_balance`, `not_debtor`, `bad_text`, `same_phone` |
