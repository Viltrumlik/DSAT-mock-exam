# iOS — Today, Practice & results, Words and the states, built from the mockups

Owner, 2026-10-28 (after the Class design shipped in #322):

> menga jo'natgan mockuplaringizni 16gacha qiling 17dagi up next ko'p joy olyapti kamaytiring.
> shuningdek services shop va boshqalar ham bor edi … stories tepaga ko'chiring coin va xpni
> tepasiga. coin pointlar uchun bizning o'zimizning tangalarni ishlating va motion animation
> bering … bizda streak yo'q, Strike bor … Practice & results shunday mockup dek. wordsni ham.
> keyin statesni ham to'liq quring. qolgan narsalarga tegmay turing. … daily questionni men
> boshqa sessionda yarataman. siz uni o'zingizga integration qilasiz

**Build the real SwiftUI app, not more mockups.**
- **Source:** the HTML mockups in the primary checkout, `ios-redesign/mockups/pages/NN-*.html`.
  Renders are in `png/NN-*.png`, the kit is `kit/kit.css`, and the house rules are in `README.md`.
- **Look:** the one #322 started. A blue band header, white r20 cards, Archivo display headings
  (`appDisplayFont`), and the floating glass tab bar with the solid blue pill.

## In scope (owner's list)
| Group | Pages | App screens today |
|---|---|---|
| Sign-in & first open | 01 sign-in, 02 sign-in states, 03 first sign-in | `Screens/Account/*SignIn*`, sign-in flow |
| Today | 10, 12 XP window, 13 leaderboard sheet, 14 notifications, 15 event invite, 16 while-away, 17 Today with real work | `Screens/Today/*`, header windows, notifications, `EventInvitePrompt`, `AwayCheck` |
| Practice & results | 30–39 (runner, question map, hand-in, review, report a problem, results, midterms, midterm report, certificate, Live Quiz) | `Screens/Assessments/*`, `Screens/Midterms/*`, `Screens/LiveQuiz/*` |
| Words | 40–48 | `Screens/Vocabulary/*` |
| States | 90–94 (loading, empty, error/offline, account states, frozen/admin/update) | shared state views + where each screen uses them |

**Out of scope ("qolgan narsalarga tegmay turing"):**
- Class (done in #322), Rewards 50–55, Explore 60–69 and Me 70–79.
- Pages 04–07 (intro cards, first-open tip). They belong to the paused onboarding branch
  `claude/ios-onboarding-4021d7` and are restyled there when it lands.
- Page 11 (daily goal: study minutes) and page 18 (challenge answered). Both need the server; see
  below.

## Today — the owner's changes on top of mockups 10 and 17
1. **Order, top to bottom:**
   1. The logo band: wordmark, bell, avatar.
   2. **The Stories row, moved up above the stat cards** (in the band).
   3. The four stat cards.
   4. The Daily Challenge slot.
   5. This week.
   6. **Up next, compact.**
   7. Your result is in, the SAT countdown and the notifications nudge (as in 17).
   8. **Services.**
   9. **The Shop rail.**
2. **Stat cards:** Coins · XP · **Strike** · Leaderboard rank.
   - **Strike = `current_streak`**, the lessons attended in a row.
     - The server re-derives it from the register and breaks it to 0 on a missed lesson
       (`rewards/strikes.py`). The Strikes leaderboard ranks the same number.
     - Label it "Strike", never "streak" or "days".
     - Tapping it opens the existing Strikes window (#317). The spendable balance stays inside
       that window.
   - **Our own coins:**
     - Use the app's own image assets, not drawn symbols: `RewardCoin` for coins, and
       `RewardPoint` for points or XP wherever the mockup shows a reward medallion.
     - They move: a slow float/tilt, the mockup's periodic glint, and a count-up on a real change.
     - Under Reduce Motion: still images, no count-up, no glint, and the view tree does not
       restructure.
3. **Up next is compact** (in 17 it took too much room):
   - One-line rows: icon · title · due chip · chevron.
   - At most 3 rows, then "See all".
   - No two-line subtitles. No per-row XP pill, except a short "up to +15 XP" chip where the
     homework still pays.
4. **Services and the Shop rail** open what the app already has. Nothing new on the server.
   - Services: Support Teacher → support booking, SAT Registration → the SAT checklist, SAT FAQ →
     the existing FAQ / Explore page.
   - Shop rail: real items from `/rewards/shop/`. A tap opens the shop item or the Shop.
5. **Daily Challenge:** the owner builds it in another session.
   - Leave one slot under the stat cards that renders nothing until that feature exists.
   - Integrate it when it lands. Its API and card come from that session.

## Rules carried over
- Restyle only. Every screen keeps its data, routes and behaviour (`ui-change-not-redesign`).
- No decorative progress bars or rings. Use growth-oriented wording.
- The runner never shows right/wrong while answering.
- XP only where it's real: homework ≤ 15; tests and vocabulary pay 0.
- An error state is not an empty state. Check `!Task.isCancelled` before state writes.
- Value routes only. Focus changes animate in ≤ 250 ms. Reduce Motion never restructures the tree.
- Pin DEBUG simulators to the local backend before launch.

## Order of work
1. **Foundation + Today** (01–03, 10, 12–17, plus the owner's changes). Build the shared pieces
   first: band header, stat card, animated coin medallion, compact row, section header, state views.
2. **Practice & results** (30–39).
3. **Words** (40–48).
4. **States** (90–94), applied everywhere in scope.
5. Simulator check (light/dark, Reduce Motion, small phone), screenshots, one PR.
