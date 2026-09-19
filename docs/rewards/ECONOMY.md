# Coin economy — prices, launch, and the ops economy card

**Status:** designed with the learning center on 2026-09-14. Only §6 is code, and it is not
built yet.

Read with `PLAN.md` (the ledger, coins, strikes) and `OVERHAUL.md` (how points are earned).
Nothing here changes how anything is earned. This document decides what coins and strikes are
**worth**, and how the shop turns them into gifts without the cost running away.

---

## 0. The problem

The mechanics all shipped: the point ledger, conversion at 10 points a coin, the wallet, the
shop with stock, orders and refunds, and the strike shelf. The economics never did. On
2026-09-14 production had **0 shop items and 0 orders — and 1,354 coins sitting in 147
wallets**. 59% of every point ever earned had already been converted into a currency with
nothing to buy.

The shop sells physical gifts, so every coin that is spent costs the learning center real
money. Opening the shop without deciding what a coin is worth would leave that cost to whoever
happens to type prices into the console.

## 1. What the decisions were taken on

Measured on production on 2026-09-14 — read-only, aggregates only. The ledger begins
2026-08-08 and the first attendance register is 2026-07-29, so these are month-one figures.
Re-measure before retuning anything.

| | |
|---|---|
| Active student accounts | 481 |
| Earned anything in the last 28 days | 231 |
| **Regulars** — earned in at least 3 of the last 4 weeks | 93 |
| Regulars' points per 28 days, surveys excluded | p10 45 · **p50 90 (≈ 9 coins)** · p90 190 · max 326 |
| All earners' points per 28 days, surveys excluded | p50 37 · p90 137 |
| All points per 28 days, surveys excluded | ≈ 13,500 — ≈ 1,350 coins if every point were converted |
| Where the last 28 days' points came from | homework 44% · attendance 28% · surveys 15% · midterms 8% · support 3% · classwork 1% |
| Coins in wallets | 1,354 across 147 students — median 6, p75 13, p90 22, max 43. **None ever spent** |
| Unconverted points, current season | ≈ 9,300 (≈ 900 coins) |
| Current strike streak | p50 **0** · p90 5 · max 13 |
| Registered lessons a week, per classroom | median 1.75 (p25 1.25, p75 2.5) |

**The strike shelf, simulated.** Every student's real attendance history replayed under the
streak rule in `strikes.py`, with every student buying the cheapest strike gift the moment
they can afford it:

| Cheapest strike gift | Students buying in 28 days | Gifts in 28 days | Cost at 5,000 so'm a strike |
|---|---|---|---|
| 1 strike | 195 | 832 | 4,160,000 so'm |
| 3 strikes | 103 | 179 | 2,685,000 so'm |
| 5 strikes | 61 | 75 | 1,875,000 so'm |
| 6 strikes | 41 | 44 | 1,320,000 so'm |
| 10 strikes | 13 | 13 | 650,000 so'm |
| 15 strikes | 1 | 1 | 75,000 so'm |
| 20 or 30 strikes | 0 — and 0 in the whole history | 0 | 0 |

What sets the strike shelf's cost is its **cheapest gift**, not the strike's value: students
buy the first thing they can reach.

## 2. Settled decisions — do not re-ask

Taken by the learning center on 2026-09-14, most of them after being shown the consequence in
so'm.

1. **Gifts are physical only.** No privileges, tuition discounts or digital rewards.
2. **Cost control comes first** — ranked above "something every month", "a big goal" and
   "coins should not pile up".
3. **A unit of currency has a fixed so'm value, and a price is derived from it, never chosen.**
   Rejected: controlling cost only through monthly stock (a coin's worth stays unknown, and
   students meet "Sold out"), and only through the conversion rate (students feel it, and
   prices stay arbitrary).
4. **1 coin = 1,000 so'm.**

   ```
   price in coins = ceil(purchase cost in so'm / 1,000)
   ```

   The most cautious of the three values offered (1,000 / 1,500 / 2,000). Worst case
   ≈ 1.35M so'm a month (≈ 1.6M in a month with a survey), if every coin minted that month is
   spent.
5. **1 strike = 5,000 so'm.**

   ```
   price in strikes = ceil(purchase cost in so'm / 5,000)
   ```

   The recommendation was 500 — one lesson's worth of points. 5,000 was confirmed after the
   consequence was written out: one attended lesson in a streak is nominally worth 5,500 so'm
   (5 points + 1 strike), against 1,500 for a perfect homework.
6. **The cheapest strike gift is 30 strikes (150,000 so'm).** The strike shelf is a long-run
   discipline prize, not a weekly treat. Confirmed after being shown that at 1.75 registered
   lessons a week it takes about four months without a single absence — EXCUSED included,
   since it breaks a streak — and that no history on the platform reaches 20.
7. **Coin gifts sit on a four-tier ladder** (§3).
8. **The launch stocks ≈ 1.5M so'm** (§4).
9. **Five numbers are read every month, from an economy card on the ops shop page** (§5, §6).
10. **Build only the card.** Prices are typed by hand from the two formulas; no model changes.
    Rejected: a purchase-cost field on items, with prices computed and the strike floor
    enforced by the server. The risk this keeps is in §7.

## 3. The coin price ladder

A tier is how long a regular student (≈ 9 coins a month) takes to earn the gift. At 1 coin =
1,000 so'm, a price in coins reads as the cost in thousands of so'm.

| Tier | Price in coins | Regular student (~9 a month) | Top 10% of regulars (~19 a month) | For example |
|---|---|---|---|---|
| Small (*Kichik*) | 1–9 | within a month | within two weeks | stickers, pens, bookmarks |
| Medium (*O'rta*) | 10–30 | 1–3 months | two weeks to 1.5 months | notebooks, planners |
| Large (*Katta*) | 31–60 | 3–7 months | 1.5–3 months | MasterSAT T-shirt |
| Dream (*Orzu*) | 61–150 | 7 months or more | 3–8 months | hoodie, SAT book |

The examples illustrate; a gift's real cost decides its tier.

Three catalog rules:

1. **At least two gifts in every tier** — Small above all. The bottom 10% of regulars earn
   about 4 coins a month and need something at 5 or less.
2. **Stock Small heaviest at launch.** Wallets hold a median of 6 coins and three quarters
   hold 13 or fewer, so day-one demand lands almost entirely on Small and Medium. One to three
   of each Large and Dream gift is enough; in the first month they work as goals.
3. **Nothing above 150 coins.** 150 is eight months for the top 10% and well over a year for a
   regular. Past that, a gift is not a goal anybody can see.

Strike gifts follow §2.5–2.6 instead: 30 strikes and up, and **never out of stock**. A student
waiting for a restock can lose every strike to one missed lesson, which can never happen to a
coin.

## 4. Launch

Coins that could be spent on day one, worst case: 1,354 in wallets + ≈ 900 from unconverted
points ≈ **2,250 coins ≈ 2.25M so'm**.

1. **The first month's stock costs ≈ 1.5M so'm.** What is on the shelf is the most the month
   can cost; demand beyond it waits for the next restock.
2. **Announce a week ahead, outside the app** — the catalog and its prices in the Telegram
   groups. Listing items at stock 0 as a preview does not work: the storefront renders stock 0
   as "Sold out".
3. **Restock monthly, on a fixed day.** Stock cost ≈ the previous month's actual spend, and no
   more than 1.35M so'm.
4. **Orders flow as today:** purchase → PENDING → handed over at the desk → FULFILLED, with the
   "ready" notification.

## 5. Monthly check and levers

On restock day, read the card (§6):

| Number | What it tells you |
|---|---|
| Spent this month (so'm) | coin orders × 1,000 + strike orders × 5,000, cancelled orders excluded |
| Coins minted this month | money that can be spent in the months ahead |
| Coins in wallets | what the learning center owes students, at 1,000 so'm a coin |
| Unconverted points | coins still to come |
| Orders to hand over | gifts waiting at the desk |

| When | Do | What students notice |
|---|---|---|
| Spending ran over plan for a month | stock less next month | some gifts sell out sooner |
| Over plan for 2–3 months running | raise `points_per_coin` on the **current** season, 10 → 15, announced two weeks ahead | new coins come slower; coins already held keep their value, and the notice lets anyone convert at the old rate first |
| Coins pile up and nothing sells | add gifts in the tier where wallets cluster, or raise a coin's so'm value | more choice, or gifts cheaper in coins |
| Nobody reaches 30 strikes within ~4 months | lower the strike floor | the goal comes closer |

**Never:**

- **Lower the so'm value of a coin or a strike.** Every gift gets dearer and whatever students
  saved is worth less. Raising it is always safe.
- **Open a new season to change the rate.** `services.start_new_season` is the "reset
  everyone's points" operation: balances read from the current season, so every unconverted
  point stops counting (≈ 9,300 today). Edit `points_per_coin` on the current season in the
  Django admin instead.

**Surveys cost money now.** A survey's price is its own `Survey.points_award` (default 40). Its
cost is respondents × points × 100 so'm — 60 respondents at 40 points is 240,000 so'm.

## 6. Build: the ops economy card

The only code. No migration, and nothing a student sees changes.

### 6.1 Constants — `backend/shop/economy.py`

```python
UZS_PER_COIN = 1000
UZS_PER_STRIKE = 5000
MIN_STRIKE_PRICE = 30   # policy, printed on the card — not enforced (§2.10)
```

Changing a value is a deploy. Raising a coin's value (§5) should be rare enough for that.

### 6.2 `GET /api/shop/admin/economy/`

Staff only, through `_is_reward_staff` — the guard every other `/api/shop/admin/` view already
uses (superuser, super_admin, admin).

Shape (values illustrative):

```json
{
  "month": "2026-09",
  "uzs_per_coin": 1000,
  "uzs_per_strike": 5000,
  "min_strike_price": 30,
  "spent": { "coins": 120, "strikes": 30, "uzs": 270000 },
  "minted_coins": { "coins": 800, "uzs": 800000 },
  "wallet_coins": { "coins": 1354, "uzs": 1354000 },
  "unconverted_points": { "points": 9300, "coins": 900, "uzs": 900000 },
  "pending_orders": 4
}
```

- **month** — the calendar month containing now, in `Asia/Tashkent` (`TIME_ZONE`). Take the
  boundaries from `timezone.localtime()`, never from UTC dates: 00:30 on the 1st in Tashkent
  is 19:30 UTC on the last day of the previous month.
- **spent** — `ShopOrder` rows created this month with status PENDING or FULFILLED. `coins` and
  `strikes` sum each order's frozen `price` by `currency`;
  `uzs = coins × UZS_PER_COIN + strikes × UZS_PER_STRIKE`.
- **minted_coins** — `CoinTransaction` rows of kind EARN created this month, summed. EARN only:
  a cancelled coin order is refunded through `coins.adjust` as ADMIN_GRANT, and a refund is not
  new money.
- **wallet_coins** — the sum of `StudentWallet.coins_balance`.
- **unconverted_points** — per student, the sum of `PointAward.points` in the current season,
  floored at 0. `coins` converts **per student** — `Σ floor(balance / points_per_coin)` — not
  the pooled total, because only whole coins are ever minted.
- **pending_orders** — every PENDING order, whatever month it was placed in: it is the desk's
  queue.

`wallet_coins` and `unconverted_points` count **every account**, deactivated ones included. A
deactivated student cannot spend, so the figure is a ceiling — the same worst-case reading as
every other number in this document.

**The view must not write.** `rewards.services.current_season()` and `rewards.coins.wallet_for()`
both `get_or_create`. Read `RewardSeason.objects.filter(is_current=True).first()` and treat
"no season" as zero; never create a wallet to read one.

Cost: one aggregate query per number, plus one grouped query for the per-student fold — a few
hundred rows today.

### 6.3 The ops shop page

`frontend/src/app/(ops)/ops/shop/page.tsx` gains an **Economy** card above the items list, in
English like the rest of the console:

- **Spent this month** — so'm, with the coin and strike split
- **Coins minted this month** — count and so'm
- **Coins in wallets** — count and so'm
- **Unconverted points** — points, and the coins and so'm they would become
- **Orders to hand over** — count
- a footer: `1 coin = 1,000 so'm · 1 strike = 5,000 so'm · strike gifts from 30 strikes`

Wiring: `shopApi.adminEconomy()` and a `ShopEconomy` type in `shopApi.ts`; `useAdminEconomy()`
in `shopHooks.ts` under `["shop", "admin", "economy"]`. `useSettleOrder` invalidates it too —
cancelling an order moves both "spent" and "coins in wallets".

A failed load renders an error line, never a card of zeros. A zero here reads as "nothing was
spent", which is exactly the number somebody would act on.

### 6.4 Tests

Backend, `shop/tests_economy.py`:

- admin and super_admin get 200; a student and a teacher get 403;
- **spent** counts PENDING and FULFILLED, skips CANCELLED and last month's orders, and prices a
  strike at 5,000;
- the month boundary is Tashkent's: an order at 2026-10-01 00:30 Asia/Tashkent counts in
  October, not September (`created_at` is `auto_now_add`, so set it with `.update()`);
- **minted** counts EARN and ignores an ADMIN_GRANT refund;
- **unconverted points** floors a negative balance at 0 and converts per student — two students
  at 34 and 6 points make 3 coins, not 4;
- a GET with no season and no wallets creates neither.

Frontend, beside the ops page:

- the five numbers render, so'm grouped by thousands (`1,354,000 so'm`);
- a failed request shows the error, not zeros.

## 7. Risks kept on purpose

- **Nothing stops a mispriced strike gift.** §2.10 chose the card over enforcement, and §1 shows
  what a slip costs: a strike gift typed at 3 instead of 30 is ≈ 2.7M so'm a month. Whoever
  stocks the strike shelf checks every price against `ceil(cost / 5,000) ≥ 30`; the card's
  footer is there as the reminder.
- **Month-one numbers.** Earnings will move as more homework is assigned and more registers are
  kept. Re-measure before retuning.
- **A strike shelf nobody can reach yet.** For about four months no student can afford a strike
  gift. The storefront already tells each student how many more strikes a gift needs; revisit
  the floor when the first student gets there, or at four months if nobody has.

## 8. Out of scope

Server-side pricing and floor enforcement (§2.10) · per-student purchase limits · privileges,
discounts and digital rewards · a Telegram report · a catalog preview mode · any change to how
points or strikes are earned.
