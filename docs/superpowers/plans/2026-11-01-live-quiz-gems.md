# Live Quiz Gems + Avatar Shop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Live Quiz–only currency (Gems) earned by playing, spent in an in-game shop on avatar
characters and their skins, with the equipped avatar shown to the class in the lobby, standings,
podium and the host's dashboard.

**Architecture:** Lives inside the `livequiz` Django app. A wallet + immutable transaction ledger (the
same shape as `rewards.StudentWallet` / `CoinTransaction`), ownership rows, and one "look" row per
student. Gems are awarded inside `services.finish_game`, once per game, capped per Tashkent day. The
catalog (12 characters × 4 looks) is defined in code: the server owns keys, prices and ownership; the
frontend draws each character as inline SVG from its key.

**Tech Stack:** Django 6 + DRF + Channels (backend), Next.js 16 / React 19 / TanStack Query / Tailwind
(frontend), vitest, Django test runner (SQLite, `config.settings_test_nomigrations`).

**Spec:** the design approved in chat on 2026-11-01 (owner: "Ha, boshlang"), restated under Global
Constraints. Builds on PR #337 (`feat/live-quiz-wayground`); this branch is stacked on it and its PR
targets `main` ("merge after #337").

## Global Constraints

- Currency name: **Gems**. Not convertible to coins or money, not transferable, staff never earn.
- Earn, once per FINISHED game (never a TERMINATED one): **10 per correct answer**, **+10 for playing to
  the end**, podium **+50 / +30 / +20** for rank 1 / 2 / 3 (ties share the rank) **only when the game had
  ≥ 3 players**. Removed (KICKED) players earn nothing.
- **Daily cap 300** gems earned per student per Tashkent day (`timezone.localdate()`); an award is cut to
  what is left under the cap, never negative.
- "Played to the end": student-paced → `finished_at` set; teacher-paced → still JOINED at the finish and
  answered ≥ 1 question.
- Catalog: 12 original characters; each has a default look + 3 skins (rare / epic / legendary).
  Character prices by tier: common **100**, rare **250**, epic **500**. Skin prices: rare **150**, epic
  **300**, legendary **600**. 3 starter characters (common tier): a student who owns no character may
  claim **one** starter free.
- A skin can be bought only after owning its character. Owning a character includes its default look.
- Avatar shown in: student lobby, projected lobby, in-game + final standings, podium, host dashboard.
- Wire changes are additive only (the iOS app must keep working unchanged).
- UI copy in English, growth-oriented; artwork is our own SVG (no third-party character art).

## File Structure

Backend (`backend/livequiz/`):
- `avatars.py` — the catalog: character keys, names, tiers, prices, starters; item-key parsing.
- `gems.py` — earning (pure `earnings_for`), awarding a game, balance, buy / claim / equip, look lookup.
- `models.py` — `GemWallet`, `GemTransaction`, `OwnedAvatarItem`, `AvatarLook`.
- `migrations/0003_gems_and_avatars.py` — generated.
- `services.py` — `finish_game` calls `gems.award_for_game`; `participants_of` selects the look;
  `results_report` adds each row's `gems`.
- `events.py` — `participant_row` gains `avatar`; `EV_GEMS_AWARDED` payload builder.
- `constants.py` — `EV_GEMS_AWARDED`.
- `consumers.py` — after a finish, each student is sent their own `gems_awarded`.
- `views.py`, `urls.py` — `shop/`, `shop/buy/`, `shop/claim/`, `shop/equip/`.
- `admin.py` — read-only ledger + wallet admin.
- `tests_gems.py` — all of the above.

Frontend (`frontend/src/features/liveQuiz/`):
- `avatars.tsx` — `<LiveAvatar character skin size />` (SVG art by key) + `GemIcon`.
- `api.ts` — shop types + `liveQuizApi.shop/buy/claim/equip`; `LiveParticipant.avatar`.
- `GemShop.tsx` + `app/(main)/live/shop/page.tsx` — the shop.
- `useLiveQuiz.ts` — `gems_awarded` → `room.gems`.
- `game.tsx` (PlayerLobby, FinalStandings, Podium), `HostGame.tsx` (lobby chips), `HostDashboard.tsx`
  (rows), `PlayerSummary.tsx` (+N gems, shop link), `JoinLiveQuiz.tsx` (balance + shop link).
- `__tests__/gems.test.tsx` — every catalog key renders; reducer; shop page buy flow.

---

### Task 1: Catalog + ledger models + earning rules

**Files:**
- Create: `backend/livequiz/avatars.py`, `backend/livequiz/gems.py`, `backend/livequiz/tests_gems.py`
- Modify: `backend/livequiz/models.py`, generate `migrations/0003_gems_and_avatars.py`

**Interfaces — Produces:**
- `avatars.CHARACTERS: dict[str, dict]` — `{key: {"name", "tier", "price", "starter"}}`
- `avatars.SKIN_TIERS = ("rare", "epic", "legendary")`, `avatars.SKIN_PRICES = {"rare":150,"epic":300,"legendary":600}`
- `avatars.character_key(k) -> "char:<k>"`, `avatars.skin_key(k, tier) -> "skin:<k>:<tier>"`,
  `avatars.parse(item_key) -> ("character", k, None) | ("skin", k, tier) | None`, `avatars.price_of(item_key) -> int | None`
- `gems.DAILY_CAP = 300`; `gems.earnings_for(*, correct, played_to_end, rank, player_count) -> dict`
  returning `{"correct": int, "finish": int, "podium": int, "total": int}`
- models: `GemWallet(user 1:1, balance)`, `GemTransaction(wallet, kind EARN|SPEND|ADJUST, amount, balance_after, session?, item_key, day, created_at)` with unique `(wallet, session)` where `kind=EARN`; `OwnedAvatarItem(user, item_key)` unique; `AvatarLook(user 1:1, character, skin)`.

- [x] Write failing tests: earnings (3 right + finished + 1st of 5 = 30+10+50 = 90; podium 0 with 2
  players; tie at rank 2 both +30; not played to end → no +10); catalog (12 characters, 3 starters, every
  character has 3 skins, `parse` round-trips, unknown key → None).
- [x] Run → fail (module missing). Implement `avatars.py`, pure `earnings_for`, models; `makemigrations`.
- [x] Run → pass. Commit `feat(live-quiz): gems ledger, avatar catalog and earning rules`.

### Task 2: Awarding a finished game

**Files:** Modify `gems.py`, `services.py` (`finish_game`), `tests_gems.py`.

**Interfaces — Produces:** `gems.award_for_game(session) -> dict[int, dict]` (participant_id →
`{"earned", "balance", "capped"}`), idempotent; `gems.balance(user) -> int`; `gems.earned_in(session) -> dict[user_id, int]`.

- [x] Failing tests: finish awards correct×10 + 10 (+ podium when ≥3 players); calling twice awards once
  (unique constraint); a TERMINATED game awards nothing; a KICKED player nothing; daily cap cuts the
  third game of the day (two 140-gem games then a third → only 20); staff/host never in it.
- [x] Implement: inside `finish_game` after `_write_ranks`, `gems.award_for_game(session)`; wallet row
  `select_for_update`, `get_or_create`; EARN row with `day=timezone.localdate()`; skip amount 0 rows.
- [x] Pass. Commit `feat(live-quiz): a finished game pays gems, capped per day`.

### Task 3: Shop moves + REST

**Files:** Modify `gems.py`, `views.py`, `urls.py`, `admin.py`, `tests_gems.py`.

**Interfaces — Produces:** `gems.buy(user, item_key)`, `gems.claim_starter(user, character)`,
`gems.equip(user, character, skin|None)`, `gems.shop_state(user) -> dict`; REST
`GET /api/livequiz/shop/`, `POST shop/buy/ {item}`, `POST shop/claim/ {character}`, `POST shop/equip/ {character, skin}`.
Errors: `Conflict` codes `not_enough_gems`, `already_owned`, `needs_character`, `not_owned`,
`starter_used`, `NotFound` `no_such_item`.

- [x] Failing tests: buy deducts and records SPEND with balance_after; cannot afford → 409 and balance
  unchanged; buy twice → `already_owned`; skin before character → `needs_character`; claim starter once,
  second claim → `starter_used`, non-starter claim refused; equip requires ownership; first claimed or
  bought character is auto-equipped; `GET shop/` shape (balance, today_earned, daily_cap, items with
  owned flags, look, can_claim_starter).
- [x] Implement with the wallet row locked for every spend. Pass. Commit `feat(live-quiz): the gem shop — buy, claim, equip`.

### Task 4: Avatars on the wire + gems_awarded frame

**Files:** Modify `events.py`, `services.py` (`participants_of`, `results_report`), `constants.py`,
`consumers.py`, `tests_gems.py`.

**Interfaces — Produces:** `participant_row(...)["avatar"] = {"character": str, "skin": str|None} | None`;
frame `gems_awarded {earned, balance, capped}` sent to each student's personal group after
`game_finished`; report rows gain `gems`.

- [x] Failing tests: participant_row carries the equipped look; socket test — after `end_game` the
  student receives `gems_awarded` with the right `earned`; report row `gems`.
- [x] Implement. Run the whole `livequiz` suite. Commit `feat(live-quiz): avatars travel with players; students hear what they earned`.

### Task 5: Frontend — art, shop, avatars in the game

**Files:** Create `avatars.tsx`, `GemShop.tsx`, `app/(main)/live/shop/page.tsx`, `__tests__/gems.test.tsx`;
modify `api.ts`, `useLiveQuiz.ts`, `game.tsx`, `HostGame.tsx`, `HostDashboard.tsx`, `PlayerSummary.tsx`, `JoinLiveQuiz.tsx`.

- [x] Failing tests: every catalog key × look renders an `<svg>` with its accessible name; reducer
  `gems_awarded` → `room.gems`; GemShop shows balance and calls `buy` then refetches.
- [x] Implement art (one creature renderer, per-species features, palettes per look; epic = galaxy
  gradient, legendary = gold gradient + shine), the shop (Characters / Skins tabs, preview, buy/equip,
  claim-a-starter banner), and avatars in lobby/standings/podium/dashboard.
- [x] tsc (after `rm -rf .next/dev/types`), eslint, vitest. Commit `feat(live-quiz): the avatar shop and avatars in the game`.

### Task 6: Verify end to end, PR

- [x] Real-wire + browser run (harness in memory `local-livequiz-probe-harness`): play a game, see gems
  on the summary, buy a character and a skin, equip, start another game and see the avatar in the
  lobby, standings, podium and dashboard.
- [x] Push `HEAD:refs/heads/feat/live-quiz-gems`; PR to `main`, title "… (merge after #337)".

## Verified (2026-11-01)

- Backend: `livequiz` 169 tests OK on SQLite; gems + student-paced + services 95 OK on Postgres 18.
- Migrations 0002 + 0003 applied forward, back to 0001 and forward again on Postgres 18; the
  one-payout-per-game rule is a partial unique index.
- Frontend: tsc / eslint clean; Live Quiz vitest 33 green.
- Real browsers on a local uvicorn: free starter, buy + wear a Golden skin, a 3-player game with
  avatars in lobby / dashboard / podium, "+80 gems" on the end screen; 0 server tracebacks.
