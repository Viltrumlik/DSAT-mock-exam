# lc-up Part 3: finance — plan

**Goal:**
- Students see their own balance and payments.
- Admins get a separate finance page.
- A student who hasn't paid by the 6th of the month is frozen, and paying lifts the freeze.

**Owner (2026-10-14, chat, one question at a time):**
- Scope: "oylik to'lov to'lmagan o'quvchilarning akkaunti muzlatiladi", "O'quvchi o'z balansini ko'rsin", "Admin uchun moliya sahifasi".
- The rule: "har oyning 6-sanasigacha qarz to'lanmasa muzlatilsin 6-kuni".
- Start date: "Darhol (yoqilgan kuni)", i.e. the day the switch is turned on. The owner sees the list first.
- Teachers: "Faqat 'muzlatilgan' belgisi". They see the badge and never an amount (this keeps the 2026-10-12 decision: balances are seen by admins and by the student only).
- After the design: "admin sahifasini lcup ichiga yozmang alohida sahifa qiling. o'quvchi sahifasi inglizcha bo'lsin". So the admin page is a separate `/ops/finance`, and the student side is in English.

## Prod facts (2026-10-14, read-only)
- lc-up returns:
  - payments: `amount`, `date`, `month` "YYYY-MM", `type` (payment/refund), `method{id,name}` (Naqd pul / Plastik karta / Bank hisobi), `group_id`, `student_id`;
  - each student's `balance`;
  - each group's `cost`.
- About 450 payments a month. Every live group costs 500,000 UZS.
- 213 linked students are in live paired groups: 180 owe nothing, 11 owe less than half a month, 15 owe half to one month, and 7 owe one to two months.
- If switched on now, about 33 students would be frozen.

## Backend (`backend/lcup`)

### Models (`lcup.0006`)
- `LcupPayment` (unique `lcup_payment_id`).
- `LcupStudentLink.debt_freeze_exempt_at` and `debt_freeze_exempt_by`.
- `LcupState.payments_backfilled_at`.

### `finance.py`
- `sync_payments` (a new `payments` stage after `students`):
  - the first run reads from the earliest course start, in windows of 90 days or less;
  - after that, each run reads the last 7 days;
  - a payment held for those days that lc-up no longer lists is deleted.
- `apply_freeze` (a new `debt_freeze` stage after `audience`):
  - from `LCUP_DEBT_FREEZE_DAY` (6), a linked learner whose balance is below zero is frozen through `users.audience.freeze_for_debt` (`RoleChange`, reason `lcup_debt_unpaid`);
  - any day, a balance of zero or more, or an exemption, lifts the freeze.
  - It is never applied to: an unknown balance, an admin's own freeze, staff, or students archived in lc-up.
  - A run that hit errors freezes nobody. More than 60 freezes in one run wait for a person.
  - With `LCUP_DEBT_FREEZE_ENABLED` off, it lets go every centre student it froze.
- Reads: `student_finance`, `summary`, `debtors`, `payments_in`, `freeze_report`, `set_exempt`.

### `lcup/audience.py`
A centre student frozen for debt is no longer "joining". Otherwise, with the public split on, `make_centre` would lift the freeze every run and the freeze would bounce.

### Endpoints
- `GET /api/lcup/me/finance/`: `IsAuthenticated`, so a frozen learner can still read it. It is also allowed for public learners in `host_guard`.
- Global admin only:
  - `GET /api/lcup/finance/summary|debtors|payments/`;
  - `POST /api/lcup/finance/exempt/<link>/`.

### Teacher badge
`frozen_for_debt` is added to the people and members rows (roster managers only) and to the attendance register rows.

### Command
`lcup_finance_report` shows who would be frozen right now. It changes nothing.

## Frontend
- `features/finance/financeApi.ts` and `financeHooks.ts`, with `formatUzs`.
- The profile Overview `PaymentsPanel` replaces "coming soon" with: debt or credit, the monthly price, and recent payments (English).
- `FrozenOverlay` has a debt variant: "You owe X UZS", and the account unlocks by itself within 15 minutes of the payment.
- A "Frozen — unpaid" badge on People and in the attendance register.
- `/ops/finance` (a separate nav entry, also in `ADMIN_OPS_SECTIONS`), with three tabs:
  - Overview: tiles and a table by group;
  - Debtors: filters, plus exempt / remove exemption;
  - Payments: by month.

## Rollout (each step needs the owner's yes)
1. Migrate first (`lcup.0006`), then a full blue-green release. The freeze stays OFF. Payments backfill on the first sync, and the balance page and admin page work.
2. Show the owner `lcup_finance_report`.
3. Set `LCUP_DEBT_FREEZE_ENABLED=True` (env), reload gunicorn TTIN/TTOU, and restart celery. Watch the next sync's `debt_frozen`.
