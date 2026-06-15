# Proposal — Assessment Runner Modernization

> **Status: proposal only. Not implemented.** No code in this document ships.
> Scope: the protected execution engine `features/assessments/containers/StudentAttemptRunnerContainer.tsx`
> (~2,215 lines) behind `/assessments/attempt/[attemptId]`. The SAT exam runner
> (`features/testing-simulation`, `/exam`, `/mock`) is a **separate** engine — same
> principles apply but it is out of scope here.

## 0. Why this is treated separately
Every other student/teacher surface was a presentation reskin over stable data
hooks. The attempt runner is different: it is a **live, stateful execution engine**
that holds unsaved student work in memory. A careless UI rewrite can:
- drop answers mid-attempt (state shape change),
- double-submit or lose a submission (mutation/idempotency regressions),
- corrupt the autosave/version-conflict protocol,
- break highlight persistence.

These are data-loss / integrity failures, not cosmetic bugs. Hence: extract and
migrate deliberately, behind tests and a flag — never a big-bang rewrite.

## 1. Risk analysis
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Lost in-progress answers during refactor | Med | **Critical** | Keep state machine byte-for-byte; extract presentation only; snapshot tests on reducer |
| Autosave protocol regression (debounce, retry, expected_version) | Med | **Critical** | Do not touch the save/sync layer in phase 1; characterization tests first |
| Double-submit / idempotency break | Low | **Critical** | Preserve submit mutation + Idempotency-Key usage untouched; e2e submit test |
| Version-conflict handling (stale write) breaks | Med | High | Isolate conflict UI but keep the detection logic; conflict simulation test |
| Highlight storage (localStorage) divergence with review | Low | Med | Shared `attemptHighlightStorage` already used by review — reuse, don't fork |
| Timer / pause semantics drift | Low | High | Keep timing logic in the engine; UI reads only |
| Math/HTML rendering regressions (KaTeX/SafeHtml) | Med | Med | Reuse `AssessmentText`/`SafeHtml` exactly (already battle-tested in review) |
| Mobile keyboard / scroll / focus regressions on inputs | Med | Med | Manual device matrix + a11y pass |
| Bundle size / re-render storms after componentization | Low | Med | Memoize leaf components; profile before/after |

**Risk verdict:** the *engine* (state, save, submit, timing, conflict) is the
high-risk core and must stay intact. The *presentation* (question chrome, choice
rows, nav, headers, palettes) is low-risk and is the only thing we migrate first.

## 2. Extraction strategy (separate logic from presentation — no behavior change)
The 2,215-line container today mixes engine + view. Refactor in place, no UI change:

1. **Characterize first.** Before moving anything, add tests that pin current
   behavior (see §4). Nothing proceeds until these are green on `main`.
2. **Extract the engine into a headless hook** `useAttemptEngine(attemptId)`:
   - owns: load bundle, answer state, dirty tracking, autosave (debounce + retry +
     `expected_version`), submit (+ idempotency), version-conflict state, timer,
     navigation index, flag/skip state.
   - returns a **plain view-model + action callbacks** (no JSX).
   - This is a pure cut/paste of existing logic into a hook — identical behavior.
3. **Extract pure helpers** (answer normalization, choice mapping, outcome,
   formatting) into a sibling `attemptModel.ts`, shared with review where overlap
   exists.
4. The container becomes a thin view that consumes `useAttemptEngine` — still the
   old markup at this point. Commit. Ship. Verify nothing changed (tests + manual).

Result: a clean seam between **engine (protected)** and **view (replaceable)** with
zero behavior change — the precondition for a safe UI migration.

## 3. UI migration strategy (presentation → design system)
Only after §2 ships and is stable:

1. **New view component** `StudentAttemptRunnerView` built on the design system
   (AppShell-free focus layout, `Card`/`Button`/`Badge`/`ProgressRing`, `AssessmentText`,
   the choice-row pattern already shipped in the rebuilt review page). It consumes the
   **same** `useAttemptEngine` view-model — no new logic.
2. **Reuse, don't reinvent:** the rebuilt `/assessments/review` page already
   establishes the question card, choice states (success/danger), passage/highlight
   rendering, and KaTeX handling. The runner view mirrors these for visual unity.
3. **Feature-flag the swap:** render old vs new view behind a flag
   (`NEXT_PUBLIC_NEW_ATTEMPT_RUNNER` or a per-user rollout). Default off.
4. **Parallel-run / canary:** enable for staff + a small student cohort; watch
   submit-success rate, autosave error rate, and support reports before widening.
5. **Remove the legacy view** only after the new one is proven at 100% for a full
   assignment cycle. Keep the engine untouched throughout.

Migration order within the view (smallest blast radius first): header/timer chrome
→ question palette/navigator → passage & stem → choice rows → grid-in/short-answer
inputs → flag/submit affordances → conflict/expiry dialogs.

## 4. Testing plan
**Gate (before any extraction):** characterization tests on current behavior.
- **Unit (engine/helpers):** answer set/replace, dirty tracking, autosave payload
  shape (`answers`, `flagged`, `expected_version`), submit payload + idempotency key,
  version-conflict branch, timer countdown, navigation/skip, highlight read/write.
- **Reducer snapshot tests:** feed scripted action sequences, assert the exact
  view-model — these must stay identical across §2 and §3.
- **Integration (MSW-mocked API):** load → answer several → autosave fires →
  reload restores → submit → success; plus stale-version → conflict path; plus
  network-drop → retry. Assert no answer loss.
- **E2E (Playwright, staging):** full attempt for MCQ + grid-in on desktop and
  mobile; refresh mid-attempt; multi-tab; submit-recovery (mirrors the testing-sim
  P0 suite). Run against **old and new** views behind the flag; results must match.
- **Visual regression:** snapshot the new view (light/dark, 320/768/1440).
- **A11y:** keyboard-only full attempt, focus management on navigation, ARIA on
  choices/timer/dialogs, reduced-motion.
- **Performance:** render count + interaction latency before/after; no regression.

**Rollback:** flag off instantly reverts to the legacy view (engine unchanged), so
a bad canary has zero data risk.

## 5. Sequencing & exit criteria
1. Land characterization tests on the current runner (no code change). ✅ gate
2. Extract `useAttemptEngine` + `attemptModel.ts`, keep old markup, ship. (behavior-identical)
3. Build `StudentAttemptRunnerView` on the design system behind a flag.
4. Canary → cohort → 100%; monitor submit/autosave metrics.
5. Delete legacy view. Done when: submit-success & autosave-error rates unchanged,
   E2E parity green, a full assignment cycle clean at 100%.

The same playbook (characterize → extract engine → flagged view swap → canary)
applies later to the SAT `testing-simulation` runner, independently.
