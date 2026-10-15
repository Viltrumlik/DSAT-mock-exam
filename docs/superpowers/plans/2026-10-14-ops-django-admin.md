# Ops console like Django admin + students/public split — plan (phase 1)

**Owner (2026-10-14, chat):**
- "login pagedagi uzun so'zlar kerak emas uning o'rniga email or username or number qilib qo'ying".
- "admin panelda public userlar bilan studentlarni ajrating … to'liq ajratilsin boshqa boshqa joylarga". Chosen: **Students / Public users / Staff**, three separate sections that replace `/ops/users`.
- "guruhi yo'q studentlar to'g'ridan to'g'ri public bo'lib qolsin". Chosen: **now** (415 accounts on 2026-10-14), then automatically from then on. The empty Mock page (0 published mocks) was accepted.
- "ya'qinda yaratgan pagelaringizda maximalism … minimalism qiling" → `/ops/finance`, `/ops/lcup`, the profile Payments panel.
- "admin panel ops ko'rinishini django adminga o'xshatish kerak sidebarni chapga yopishtirib ma'lumotlarni to'liq ekranga … filtrlarni yaxshilab".
- The design was approved: "ha, ma'qul, boshlang". Phase 2 (the remaining list pages) comes later.

## Rule: a seat decides
- An active STUDENT seat in an active classroom → role `student` (centre). No seat → `public_student`.
- This replaces "linked AND in a live lc-up group" (2026-10-13). Rosters already mirror lc-up, so for lc-up students the two agree.
- `users.audience.seat_plan()` returns `(to_public [(user, owes)], to_centre [user])`, and both of these use it:
  - `split_public_students` (`--dry-run | --apply | --revert`), for the initial 415;
  - `lcup.audience.apply`, every sync, now AFTER rosters. It is gated by `PUBLIC_SPLIT_ENABLED` and holds on errors or on more than 20 leavers.
- A leaver who owes lc-up is frozen for the debt (as before). Frozen accounts stay frozen.
- The sync order becomes: rosters → audience → debt_freeze.

## People API (new; `/users/admin/list/` is untouched because two callers need a bare list)
`GET /api/users/admin/people/?section=students|public|staff&q=&o=&page=&page_size=&<filters>` returns `{count, page, page_size, results, facets}`.
- **students:** filters `status` (active / frozen_debt / frozen_admin), `group`, `teacher`, `lcup` (linked / unlinked). Rows show groups, the lc-up link and balance, status and dates.
- **public:** filters `status`, `joined` (7d / 30d / older), `verified`.
- **staff:** filters `role`, `subject`, `status`.
- Search covers username, first and last name, email and phone. Ordering is by name, joined or debt.
- Scoping is the same as the list (`manageable_users_queryset`), with the same permission.

## Frontend
- **Shell `(ops)/layout.tsx`:**
  - a fixed left sidebar, grouped (People / Teaching / Centre / Content / System), collapsible to icons and a drawer on a phone;
  - a top bar with the breadcrumb, the user and Logout;
  - full-width content.
- **`features/ops/changelist/`:** a Django-style list: title and count, search, Action ▾ for bulk actions, a dense sortable table, a right-hand filter panel with counts, and server pagination. The state lives in the URL.
- **Pages:** `/ops/students`, `/ops/public`, `/ops/staff`. `/ops/users` redirects to `/ops/students`, and the dashboard links follow. The row editor and bulk confirm move out of the users page into components.
- **Login:** the label "Email, username or phone number"; the lc-up hint line goes.
- **Minimal:** `/ops/finance` and `/ops/lcup` become dense tables with no tiles or tints. The profile Payments panel becomes plain rows.

## Rollout (each step needs the owner's yes)
1. A full blue-green release (no migration).
2. `split_public_students --dry-run`, then `--apply`.
3. `PUBLIC_SPLIT_ENABLED=True`, reload, and watch a sync.
