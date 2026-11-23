# Leaving lc-up — the runbook

From the first day (1 Dec 2026) the centre works only in this system: payments, seats, expenses and reports are kept
here and lc-up is no longer called. The code is `backend/billing/cutover.py` (`manage.py billing_cutover`) and
`deploy/cutover-env.sh`.

All of it runs on **the evening before the first day**, after the day's last lessons are marked, and is finished
**before midnight**: lc-up may charge the new month at midnight, and a balance read after that would charge the first
month twice (lc-up's month and our lessons).

Commands below run on the prod host:

```
cd /var/www/satapp/current/backend
M="sudo -u satapp env DJANGO_SETTINGS_MODULE=config.settings venv/bin/python manage.py"
```

## Before the evening

- Every cutover PR is deployed, with the flags as they are (nothing changes while lc-up is the master). Run the
  migrations first: `billing.0005`–`0008` and `access.0013`, all additive.
- The admins have entered personal prices (discounts, free places) in the Ledger tab; lc-up's API never gave them.
- `$M billing_copy_history` (dry run), then `--apply`: lc-up's payments from before the ledger opened. `prepare`
  copies them again at the end, so this is only to see the numbers early.
- The owner decided (23 Nov): a balance below zero is frozen **from the first lesson**. On a copy of prod, 197 of the
  221 students paying per lesson held 0 (they paid November), so each is frozen at their first December lesson unless
  they top up (at least 160,000) before it. Tell them before the evening.

## The evening

| # | Step | What to see |
|---|---|---|
| 1 | `$M billing_cutover check` | `left_lcup: false`, every flag as today |
| 2 | `$M billing_cutover prepare --day 2026-12-01` | The last full pull (about 5 min), then `differences` and `biggest`. Nothing is kept. |
| 3 | `$M billing_cutover prepare --day 2026-12-01 --apply --no-pull` | `adjustments` = `differences`; every account now holds lc-up's balance (rows dated the day before, "Cutover: lc-up's balance …"). Leave out `--no-pull` if step 2 was more than ~15 min ago. |
| 4 | `bash deploy/cutover-env.sh on` (as root) | `CUTOVER_ENV_OK on`, every probe 200 |
| 5 | `$M billing_cutover check` | `left_lcup: true` |
| 6 | `$M billing_cutover finish --day 2026-12-01` | Seats `switched` to per lesson; `owing_unfrozen` and `freeze_list`: who the first tick freezes now (those already below zero). `mass_until: 2026-12-07`. Nothing is kept. |
| 7 | `$M billing_cutover finish --day 2026-12-01 --apply` | `check` says `finished: true` and `mass_freeze_until: 2026-12-07`. |
| 8 | Smoke | /ops/finance (Debtors, Payments, Expenses, Reports), a student's page says "each lesson", the payment form is open, a join code is refused (`desk_only`) |

The beat's `billing.tasks.own_tick` (:07, :22, :37, :52) waits until step 7 is applied (`check` says
`finished: true`), so nobody is frozen between steps 4 and 7 before the list was seen. From midnight it writes each
lesson on its day and freezes whoever drops below zero. Until `mass_until` (the first week; `--mass-until` changes it)
it freezes however many at once, since nearly everyone starts at 0; after it, more than 40 freezes in one tick are held
again (`alerts`) and wait for `$M billing_own_tick --allow-mass`, as a guard against a wrong charge. lc-up's sync,
archive, attendance push and debt SMS have stopped.

Every step records a `BillingRun` of kind `cutover` with its counts and rows; `check` lists the last ten.

## Going back

Only if the owner decides to go back to lc-up:

1. `bash deploy/cutover-env.sh off` (as root): the flags go back to what they were before `on`.
2. `$M billing_cutover reverse --day <today> --since 2026-12-01`, then `--apply`:
   - the payments, refunds and adjustments entered here since the first day are listed and voided; the desk enters
     each one in lc-up;
   - per-lesson seats go back to the month, the current month being lc-up's.
3. After the next lc-up sync: `$M billing_cutover prepare --day <today> --apply` sets every balance to lc-up's again.

Expenses stay: they are the centre's own and were never in lc-up's API.

## The rehearsal

On the test copy, with a fresh copy of prod, and the same script pointed at it:

```
CUTOVER_APP=/var/www/satapp-staging CUTOVER_BACKEND=stg-backend CUTOVER_PORT=8030 CUTOVER_CELERY="" \
  CUTOVER_HOST=mastersat-test.65-109-100-104.sslip.io bash deploy/cutover-env.sh on
```

The test copy has no lc-up credentials, so its `prepare` runs with `--no-pull` on the data the copy was taken with.
