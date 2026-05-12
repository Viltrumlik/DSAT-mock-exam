# Semantic Pipeline Inventory — Point-in-Time Snapshot

> **Version:** 1.0  
> **Snapshot date:** 2026-05-12  
> **Purpose:** Auditable reference for the rendering pipeline as it stood when governance was established. Use this to diff against future states and detect structural drift.
>
> **Update this document** when the pipeline structure changes (new renderer, new sanitizer pass, new approved surface, phase migration). Do NOT update it for cosmetic changes (className tweaks, new questions added).

---

## Canonical Rendering Pipeline

```
Content Studio textarea
        ↓
  raw string (DB)
        ↓
  prepareRichText()           ← src/components/MathText.tsx
    1. stripDangerousTags()   ← strips everything outside 7-tag allowlist
    2. applyNewlines()        ← \n → <br>
    3. applyMarkdown()        ← **bold** → <b>, *italic* → <i>
        ↓
  dangerouslySetInnerHTML     ← inside MathText component only
        ↓
  renderMath({ root: el })    ← useEffect, per-element
    → window.renderMathInElement (KaTeX auto-render via CDN)
        ↓
  rendered DOM node
```

Pipeline order is load-bearing. Do not reorder steps without updating
`MathText.security.test.ts` and `MathText.semantic.test.ts`.

---

## MathText Surfaces (Content Studio academic content)

| Surface | Component | Field(s) rendered | `block` prop |
|---|---|---|---|
| Student exam prompt | `StudentAttemptRunnerContainer` | `question.prompt` | ✓ |
| Student exam prompt (alt layout) | `StudentAttemptRunnerContainer` | `question.prompt` | ✓ |
| Student exam choices | `QuestionInputs` (via `AnswerInput`) | `choice.text` | — |
| Author preview prompt | `SATQuestionPreview` in `BuilderSetEditorContainer` | `prompt` | ✓ |
| Author preview stimulus | `SATQuestionPreview` | `stimulusContext` | ✓ |
| Author preview choices | `SATQuestionPreview` | `c.text` per choice | — |
| Author preview explanation | `SATQuestionPreview` | `explanation` | ✓ |
| Author choice live preview | `ChoiceEditor.ChoiceRow` | `choice.text` | — |
| Review page prompt | `review/[attemptId]/page.tsx` | `question.prompt` | ✓ |
| Review page stimulus | `review/[attemptId]/page.tsx` | `question.stimulusContext` | ✓ |
| Review page choices | `review/[attemptId]/page.tsx` | choice value/text | — |
| Review page explanation | `review/[attemptId]/page.tsx` | `question.explanation` | ✓ |

---

## SafeHtml Surfaces (Legacy / runtime-mutated HTML)

| Surface | Component | Why SafeHtml | Architectural status |
|---|---|---|---|
| Exam passage / question text | `exam/[attemptId]/page.tsx` | Passage HTML; text-highlight `<mark>` mutations | **Permanent** — see SafeHtml.tsx Surface A |
| Exam question prompt | `exam/[attemptId]/page.tsx` | Highlight `<mark>` mutations on `questionPromptHighlights` | **Permanent** — see SafeHtml.tsx Surface A |
| Exam question text (alt) | `exam/[attemptId]/page.tsx` | Highlight `<mark>` mutations on `questionHighlights` | **Permanent** — see SafeHtml.tsx Surface A |
| Exam answer options | `exam/[attemptId]/page.tsx` | Highlight `<mark>` mutations on `optionHighlights` | **Permanent** — see SafeHtml.tsx Surface A |
| Admin panel content preview | `admin/page.tsx` | Legacy rich HTML from admin editor | **Legacy bridge** — see SafeHtml.tsx Surface B |
| Admin panel content (inline) | `admin/page.tsx` | Same as above | **Legacy bridge** — see SafeHtml.tsx Surface B |

---

## Fallback Render Sweeps

| Sweep | Location | Scope | Purpose | Removable when |
|---|---|---|---|---|
| Container KaTeX sweep | `BuilderSetEditorContainer.tsx` useEffect | `containerRef.current` (preview pane) | CDN race guard: re-renders math after KaTeX CDN loads | KaTeX migrated from CDN to npm bundle |
| Document-body KaTeX sweep (×2) | `exam/[attemptId]/page.tsx` useEffect | `document.body` | Renders LaTeX in SafeHtml content; called at 0ms + 60ms to cover React two-pass commit | SafeHtml removed from exam page |

---

## Sanitizer Entry Points

| Sanitizer | Location | Input | Algorithm | Output |
|---|---|---|---|---|
| `stripDangerousTags` | `MathText.tsx` | Raw textarea string | Regex pass-1 (DANGEROUS_CONTENT_TAGS full-element removal) + pass-2 (7-tag allowlist, all attributes stripped) | HTML string safe for `dangerouslySetInnerHTML` |
| DOMPurify.sanitize | `SafeHtml.tsx` | Arbitrary HTML string | DOMPurify default settings (~80 allowed elements) | HTML string safe for `dangerouslySetInnerHTML` |

No other sanitizers exist in the rendering pipeline. Any new sanitizer must be documented here.

---

## Legacy Renderers

| Component | Location | Renderer stack | Status |
|---|---|---|---|
| `MathRenderer` | `admin/page.tsx` (local component) | KaTeX auto-render + MathJax 3 typesetPromise | Retained — legacy admin surface only |

---

## Approved Newline Transforms (`.replace(/\n/g, "<br/>")`)

These transforms are correct and intentional because they feed SafeHtml, which
does not run `prepareRichText`. They are NOT duplicating `applyNewlines`.

| Location | Field | Passes to |
|---|---|---|
| `exam/[attemptId]/page.tsx` line ~164 | `currentQuestion.question_text` | `SafeHtml html=` |
| `exam/[attemptId]/page.tsx` line ~290 | `currentQuestion.question_prompt` | `SafeHtml html=` |
| `exam/[attemptId]/page.tsx` line ~300 | `currentQuestion.question_text` (alt) | `SafeHtml html=` |
| `exam/[attemptId]/page.tsx` line ~368 | `optionEntryText(val)` | `SafeHtml html=` |
| `admin/page.tsx` line ~125 | `processedHtml` | `SafeHtml html=` |

---

## Raw Text Renders (Intentional — Index/List Contexts)

These are bare JSX `{text}` expressions deliberately not using MathText.
All are list/index views. See RENDERING_BOUNDARIES.md for the acceptance rule.

| Surface | Component | Why intentional |
|---|---|---|
| Question bank card | `QuestionCard` in `bank/page.tsx` | Truncated `line-clamp-2` index thumbnail — math rendering cost not justified |
| Builder question sidebar | `BuilderSetEditorContainer` question list | Author-facing list; authors recognize raw LaTeX; preview pane provides full render |
| Module questions panel | `ModuleQuestionsPanel` line items | Admin list view; truncated and functional |
| Assign assessment list | `AssignAssessmentContainer` question list | Admin selection view; `line-clamp-2` |
| Admin question list | `admin/page.tsx` question list | Admin index; `line-clamp-3` |

---

## Test Coverage

| Test file | What it covers | Test count |
|---|---|---|
| `MathText.security.test.ts` | `prepareRichText` security guarantees: XSS, event handlers, attribute injection, dangerous URLs, encoding attacks | 63 tests |
| `MathText.semantic.test.ts` | `prepareRichText` semantic contracts: pipeline order, math+emphasis, newlines, large inputs, SAT-realistic patterns | 53 tests |
| `studioSession.test.ts` | Studio session: expiry, merge, malformed data, helper branches, storage unavailability | 35 tests |

**Total: 151 tests, all passing.**

---

## Audit Tooling

| Tool | Location | Purpose | Run when |
|---|---|---|---|
| `audit-rendering.sh` | `scripts/audit-rendering.sh` | 13-section scan for renderer misuse, parallel pipelines, stale artifacts | Before major releases; after rendering-related PRs |

---

## Diff Discipline — When and How to Update

This document is a **point-in-time snapshot**. Its value comes from being accurate at
specific moments in time, not from being continuously updated for every small change.

**Bump the version and date when:**

| Trigger | Table(s) to update |
|---|---|
| New MathText surface added | MathText Surfaces |
| New SafeHtml surface added | SafeHtml Surfaces (with architectural status) |
| SafeHtml surface migrated to MathText | Remove from SafeHtml, add to MathText |
| New fallback sweep introduced | Fallback Sweeps (with removability condition) |
| Fallback sweep removed | Fallback Sweeps (remove row, note why) |
| New sanitizer step added to pipeline | Sanitizer Entry Points |
| Sanitizer step removed | Sanitizer Entry Points (remove row, note why) |
| New approved newline transform | Approved Newline Transforms |
| New intentional raw render | Raw Text Renders (with rationale) |
| Test count changes significantly | Test Coverage table |

**Do NOT update for:** className changes, new question content, API field renames,
non-rendering refactors, or cosmetic doc tweaks.

**When updating:** also add a `[SURFACE]` or `[INFRASTRUCTURE]` entry to
`SEMANTIC_CHANGELOG.md` so the change is traceable.

**Version format:** increment patch version (`1.0` → `1.1`) for table row additions;
increment minor version (`1.x` → `2.0`) for structural pipeline changes (new step,
renderer removed, sanitizer architecture change).

---

## Institutional Memory Staleness Watchlist

Governance docs decay silently. This section tracks the most common ways institutional
memory goes stale and what to do when it does.

| Staleness class | Symptoms | How to detect | Recovery |
|---|---|---|---|
| Stale inventory surface row | A row in the MathText or SafeHtml surfaces table names a component that was renamed or removed | `grep -r` for the component name in `src/` | Remove or update the row; add a `[SURFACE]` entry in `SEMANTIC_CHANGELOG.md` |
| Outdated changelog entry | `SEMANTIC_CHANGELOG.md` describes an infrastructure change that was later reverted | Version mismatch between changelog entry and live code | Append a reversal entry with the same tag; do NOT edit prior entries |
| Broken governance cross-reference | A doc links to a section (`§`, heading, or filename) that was renamed or deleted | Manual check when renaming docs or sections | Update all in-bound references in the same PR as the rename |
| Removed surface still documented | Audit script §1 or §2 finds no live usages for a surface listed in the inventory | `audit-rendering.sh` §1/§2 + grep | Remove the row; add a `[SURFACE]` changelog entry with removal date |
| Parity reference no longer valid | A parity reference in `RENDERING_BOUNDARIES.md` cites a component, className, or field name that has changed | Check after any review-page or student-runner redesign | Update the reference; re-verify the parity claim manually before merging |
| Stale failure-archive entry | `SEMANTIC_FAILURE_ARCHIVE.md` documents a failure for a surface that has since been removed | Check after completing a Phase migration | Mark `(Resolved — surface no longer exists)` rather than deleting silently |
| Stale test description | A test describes behavior the code no longer intends to provide (test still passes but the description is misleading) | Test suite audit after semantic pipeline changes | Update the description; never change a test expectation without understanding the semantic effect |
| Stale fallback sweep row | A fallback sweep row documents a `renderMath` call that was removed | Diff fallback sweeps table against live `exam/` and `BuilderSetEditorContainer.tsx` | Remove the row; note the removal trigger in changelog |

**When to run this watchlist:**

- After removing any rendering surface from the codebase
- After renaming a component that appears in governance tables
- After completing a Phase 2 or Phase 3 migration from the convergence roadmap
- Before incrementing the inventory version number

**Perspective:** Staleness causes confusion, not correctness failures. Address it during
the nearest related PR. A dedicated "governance cleanup sprint" is a sign the watchlist
should have been applied incrementally — not that it needs to be applied all at once.

---

## Quick Freshness Scan

Run these checks (under 2 minutes) to detect stale governance state before a release
or after a major surface change. Each check is a single command with a clear pass condition.

```bash
# 1. Inventory age — is the snapshot date current?
head -5 src/SEMANTIC_PIPELINE_INVENTORY.md
# Pass: "Snapshot date" matches the date of the last structural pipeline change.

# 2. Component name validity — do governance-table component names still exist in code?
grep -h "StudentAttemptRunnerContainer\|BuilderSetEditorContainer\|QuestionInputs\|ChoiceEditor" src/*.md \
  | grep -v "^\s*#\|^\s*>" | head -20
# Pass: all component names mentioned also appear in src/ via:
# grep -r "StudentAttemptRunnerContainer" src/features/ --include="*.tsx" -l

# 3. Audit-referenced tests — do the test files still exist?
ls src/components/__tests__/MathText.security.test.ts \
   src/components/__tests__/MathText.semantic.test.ts \
   src/lib/__tests__/studioSession.test.ts 2>&1
# Pass: all three files exist with no "No such file" errors.

# 4. Orphaned governance docs — any *.md file in src/ not listed in SEMANTIC_GOVERNANCE_INDEX.md?
comm -23 \
  <(ls src/*.md | xargs -I{} basename {} | sort) \
  <(grep -o '[A-Z_]*\.md' src/SEMANTIC_GOVERNANCE_INDEX.md | sort -u)
# Pass: empty output (no orphan docs).

# 5. Changelog freshness — does SEMANTIC_CHANGELOG.md have an entry since the last version bump?
grep -m1 "^##" src/SEMANTIC_CHANGELOG.md
# Pass: the most recent entry date is ≤ 6 months ago, or no structural change has occurred.
```

**Freshness ≠ perfection.** The goal is detecting material divergence — a renamed
component, a deleted surface, a broken test reference. Minor wording drift is not a
freshness failure.
