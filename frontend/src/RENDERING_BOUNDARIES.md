# Rendering Boundaries — Decision Document

> **Version:** 3.0  
> **Scope:** All content-rendering surfaces in the DSAT frontend  
> **Read this before:** building any new surface that displays authored or student-generated text  
> **Navigation:** `RENDERER_OWNERSHIP_INDEX.md` → renderer specs | `SEMANTIC_PIPELINE_INVENTORY.md` → surface list | `SEMANTIC_CHANGELOG.md` → change history

---

## Governance Philosophy

This platform protects **semantic educational trust**: the guarantee that what an author writes in the Content Studio is what a student sees in the exam, and what a reviewer sees in the review page — rendered identically, with no silent divergence.

The rendering system is **governed infrastructure**, not frontend convenience logic. Optimise for:
- **Predictability** — same input always produces the same output across all surfaces
- **Semantic correctness** — the right renderer for the right content class
- **Bounded complexity** — fewer renderers, fewer pipelines, fewer ways to be wrong
- **Long-term maintainability** — a future developer should never be surprised by rendering behavior

**Do not evolve `MathText` or `SafeHtml` into a general-purpose CMS rendering system.** This platform supports SAT-safe academic semantics only.

---

## Semantic Governance Watchlist

Monitor continuously for these drift signals:

| Signal | Why it matters | Detection |
|---|---|---|
| New renderer component created | Renderer sprawl — splits semantic ownership | audit script §12 |
| `MathText` used for `<mark>`/`<a>`/`<table>` content | Silent content stripping | audit script §3 |
| `SafeHtml` used for new student-facing surfaces | Bypasses KaTeX rendering path | audit script §2 |
| `ALLOWED_INLINE_TAGS` grows beyond 7 tags | Sanitizer creep — allowlist should be frozen | `MathText.tsx` code review |
| `.replace(/\n/g, "<br>")` added outside `prepareRichText` | Parallel newline pipeline | audit script §8 |
| Bold/italic regex added outside `applyMarkdown` | Parallel markdown pipeline | audit script §9 |
| `dangerouslySetInnerHTML` used outside approved renderers | Untracked render path, security gap | audit script §10 |
| Container `renderMath` sweep treated as primary rendering | Fallback normalization | `BuilderSetEditorContainer.tsx` comment |
| Review page diverges from student exam rendering | Author intent ≠ student view | `PREVIEW_FIDELITY.md` |
| Governance doc not updated in same PR as rendering change | Documentation drift | PR review checklist below |

---

## Governance Minimalism Protection

**The principle:** If governance creates hesitation instead of clarity, it has become too large.

This governance exists **only** to preserve:
1. Educational trust (author intent = student experience = review experience)
2. Semantic fragmentation prevention (one pipeline per content class)
3. Renderer sprawl resistance (MathText for academic content, SafeHtml for legacy HTML)
4. SAT-academic-content specificity (not a CMS)

**It does NOT exist to create:**
- Mandatory approval processes for routine changes
- CI gates that block deploys for formatting commits
- Giant checklists that no one reads
- Abstraction layers that hide simple rendering behavior

The test: if a developer must ask "do I need governance approval for this?", the answer is almost certainly **no**. Governance here means: run the audit script, update the doc in the same PR. That's it.

**Warning signs that governance has grown too large:**
- A developer avoids making a clearly correct change because "the process is unclear"
- A PR adds a new rendering comment without touching any rendering code
- The audit script has more than 15 sections
- Any checklist item asks for a review from a specific person or team
- A doc update takes longer than 5 minutes for a routine surface change

If any of these occur, governance should be trimmed, not expanded.

---

## Governance Anti-Patterns

**"Semantic governance is infrastructure hygiene, not organizational identity."**

Governance here means:
- A developer uses the correct renderer for the content class
- A rendering change does not silently break student content
- A future developer can understand why a decision was made without asking anyone

Governance here does **not** mean:
- Approval authority over rendering changes
- Architecture review gates before merging
- Centralized ownership of "what the rendering system can do"
- Accumulating governance artifacts to demonstrate institutional seriousness

**Warning signs that governance has become prestige:**

| Signal | Manifestation | Correct response |
|---|---|---|
| Permission-seeking | "I need to check with someone before touching MathText" | Remove the gating; clarify in the relevant doc section |
| Authority citation | "The architecture doc says we can't do this" | Check the doc; if wrong, update it; if right, the doc is the authority, not a person |
| Governance self-maintenance | More PRs updating docs than updating rendering code | Trim; the governance has become self-sustaining |
| Symmetry-driven additions | A checklist item added because it "rounds out" the checklist | Delete it; every item must catch a real problem |
| Steward veto power | Any named individual holds merge authority over rendering PRs | Remove named individuals; make process self-serve via the audit script |

The correct governance model: run `audit-rendering.sh`, update the relevant doc in the same PR, merge. No approvals. No gatekeeping.

---

## Governance Lightness Principle

**"Governance should minimize cognitive burden, not maximize procedural certainty."**

The moment governance becomes harder than the problem it prevents, contributors route around it. Avoidance is always the first failure mode — not deliberate violation.

**Signs governance is too heavy:**
- Contributors stop reading docs before making rendering changes
- `audit-rendering.sh` stops being run before PRs ("I'll check it later")
- Release checks are skipped ("we've been fine without them")
- Governance questions get routed socially ("ask someone") rather than operationally ("check doc X")
- Contributors avoid touching renderer logic because "the process is unclear"
- Doc updates get deferred to a cleanup sprint that never happens

When any of these appear: trim, simplify, or consolidate before adding anything. The goal is governance that feels lighter than debugging a semantic regression.

---

## Governance Trust Preservation

**"When governance becomes obviously wrong, simplify or delete it immediately."**

Stale governance harms trust more than missing governance. A developer who makes a wrong decision based on an inaccurate doc will trust all governance docs less afterward — not just the one that misled them. Trust is the infrastructure that governance depends on.

**Signs governance is losing trust:**
- "I know the doc says X but in practice we do Y" → the doc is wrong; update it now
- "Check with [person] before changing that" → a human has replaced the doc; fix the doc
- "The audit has been showing that warning for weeks" → signal has decayed; fix or remove the section
- "We'll update the docs after the deadline" → docs that stay broken become permanent

**Recovery rule:** fix broken governance in the same PR that discovers it. A dedicated cleanup PR that "will happen later" is governance debt that compounds.

---

## Review-Surface Convergence Audit (2026-05-12)

Point-in-time finding for the review page (`review/[attemptId]/page.tsx`). Re-run this
audit after any review-page redesign.

**Renderer: ✅ All 4 content fields use `MathText` correctly**

| Field | Component | `block` | className (key tokens) | Status |
|---|---|---|---|---|
| Question text/stem | `<MathText>` | ✓ | `leading-normal text-foreground` | ✅ MathText, correct renderer |
| Question prompt/stimulus | `<MathText>` | ✓ | `leading-relaxed font-[Georgia] text-base` | ✅ MathText, correct renderer |
| MC answer choices | `<MathText>` | — | `text-sm leading-relaxed` | ✅ MathText, correct renderer |
| Explanation | `<MathText>` | ✓ | `leading-relaxed text-sm font-[Georgia]` | ✅ MathText, correct renderer |

**Known styling divergences from student runner (intentional — not renderer bugs):**

| Field | Student runner | Review page | Assessment |
|---|---|---|---|
| Question text line-height | `leading-relaxed` | `leading-normal` | Minor drift, intentional (modal context) |
| Question text weight | `font-semibold text-base` | inherits container | Minor drift, intentional |
| Explanation font | not shown during exam | `font-[Georgia]` | Surface-specific — acceptable |

**No `SafeHtml` usages remain on the review page.** The migration is complete.  
**No raw text renders on the review page.** All 4 content fields use `MathText`.  
**No `mathjax-process` CSS class on the review page.** Stale artifact removed.

---

## Review Surface Convergence Watchlist

The review page (`review/[attemptId]/page.tsx`) is the most likely semantic divergence point because it is rebuilt separately from the student exam runner. Monitor it specifically.

**Check after any review-page PR:**

| Signal | What to check | Detection |
|---|---|---|
| Wrapper element changed | Does `MathText` still have `block` prop where needed? | Visual comparison |
| Spacing/typography drift | Does `leading-relaxed` / font class match student exam? | `PREVIEW_FIDELITY.md` |
| Newline rendering | Are line breaks in multi-line stems rendering correctly? | Test with `\n` in stem |
| Explanation renderer | Is explanation still using `MathText` (not raw text or SafeHtml)? | Code audit |
| Choice renderer | Are all 4 choice slots using `MathText` for text values? | Code audit |
| Correctness indicators | Are correct/incorrect markers semantically correct (not just cosmetically)? | Functional test |
| Partial MathText adoption | Is some content in a modal/drawer using a different renderer? | `audit-rendering.sh §1` |

**Parity check:** open the same question in the student exam view and the review page simultaneously and verify math, bold, italic, and line breaks render identically.

---

## Semantic Stewardship Review Rhythm

**Before any rendering-related PR merges:**
```bash
bash scripts/audit-rendering.sh
# All 7 signal checks must be ✓
```
If any is ⚠, resolve it or add it to the script's exception manifest (with a written reason).

**Before major frontend releases (~3 months, or after a major redesign):**

| Check | Tool | Pass condition |
|---|---|---|
| Parallel pipeline detection | `audit-rendering.sh` | All 7 signal checks ✓ |
| Surface inventory current | `SEMANTIC_PIPELINE_INVENTORY.md` | Version/date matches last pipeline change |
| Review-surface parity | Manual — open question in both views | Math, bold, newlines render identically |
| Changelog sync | `SEMANTIC_CHANGELOG.md` | All architectural changes since last release are logged |
| Governance footprint | Count docs in `src/*.md` | Not grown beyond 6 governance docs |

This is a 15-minute check, not a ceremony. If nothing has changed, nothing needs updating.

---

## Governance Sustainability Review Rhythm

**Quarterly at most.** If nothing has changed since the last review, skip it entirely.

This is not a ceremony. It produces at most one small PR. If no PR is needed, the review was successful.

Review only these five things:

1. **Footprint** — has any threshold in `SEMANTIC_GOVERNANCE_INDEX.md` been crossed?
2. **Staleness** — does the Quick Freshness Scan (`SEMANTIC_PIPELINE_INVENTORY.md`) show divergence?
3. **Audit usefulness** — did any audit section catch a real problem last quarter? If not, name it as a replacement candidate.
4. **Release rhythm** — was the 5-step release checklist actually run before the last major deploy?
5. **Burden** — are developers running the audit and updating docs, or routing around them?

**Time budget: 15 minutes.** If it takes longer, governance has grown too large — trim before the next review.

---

## Semantic Resilience Release Rhythm

**Five steps. No expansion without replacement.**

If a new check is proposed, one of the five below must be removed or merged with it.
The value of this checklist comes from its brevity — a long checklist is not run.

**Purpose:** Before any major frontend release (feature-complete milestone, SAT
launch window, or any deploy that touches rendering surfaces), run this checklist
to confirm semantic correctness was not silently broken during development.

This is a ~20-minute solo verification pass, not a team ceremony. It runs after
all feature PRs are merged and before the release branch is locked.

### Step 1 — Automated signal scan (5 min)

```bash
bash scripts/audit-rendering.sh
```

All sections must report ✓ (green). Any ⚠ must either be resolved or explicitly
added to the script's KNOWN INTENTIONAL EXCEPTIONS MANIFEST with a written
justification before the release proceeds.

### Step 2 — Governance link audit (3 min)

Check that all cross-references in governance docs still resolve:

| Reference to check | Where | What can break it |
|---|---|---|
| Component names in `SEMANTIC_PIPELINE_INVENTORY.md` surface tables | Inventory tables | Component renamed or moved |
| Section headings cited in `SEMANTIC_FAILURE_ARCHIVE.md` | "Audit coverage" fields | Audit script section renamed |
| File references in `SEMANTIC_GOVERNANCE_INDEX.md` | Question → Document map | Doc renamed or deleted |
| Phase 2/3 convergence roadmap prerequisites | `RENDERING_BOUNDARIES.md` Convergence Roadmap | Surface migrated without updating roadmap status |

Quick method: `grep -r "SEMANTIC_\|RENDERER_\|RENDERING_\|audit-rendering" src/ scripts/` and
visually confirm the referenced filenames still exist.

### Step 3 — Semantic inventory freshness review (3 min)

Open `SEMANTIC_PIPELINE_INVENTORY.md` and verify:

- [ ] Version date matches the last pipeline structural change
- [ ] All component names in the MathText surfaces table exist in the codebase
- [ ] All component names in the SafeHtml surfaces table exist in the codebase
- [ ] No surface rows reference components that have been renamed or deleted
- [ ] Test count in the "Test Coverage" table is current (`npx vitest run --reporter=verbose 2>&1 | tail -5`)

If the inventory is stale: bump the version, update the date, apply the
Institutional Memory Staleness Watchlist (see `SEMANTIC_PIPELINE_INVENTORY.md`).

### Step 4 — Parity reference verification (5 min)

Open a question with LaTeX, bold, and multi-line content. Load it in:
- Student exam runner (`/exam/[attemptId]`)
- Review page (`/review/[attemptId]`)
- Author preview (Content Studio builder)

Verify against the parity references at the bottom of this document:

| Parity reference | Pass condition |
|---|---|
| Reference 1: LaTeX math | KaTeX renders on all three surfaces; no raw `\(` delimiters visible |
| Reference 2: Multi-line passage | Line breaks appear at `\n` positions; no double `<br>` |
| Reference 3: Bold and italic | `**` and `*` render as `<b>/<i>`; no literal asterisks |
| Reference 4: Superscript/subscript | `<sup>/<sub>` preserved; not stripped to flat text |
| Reference 5: Explanation | Renders with correct typography on review page; author preview matches |

### Step 5 — Failure archive sync review (3 min)

Skim `SEMANTIC_FAILURE_ARCHIVE.md`. For each entry:

- [ ] Does its "Audit coverage" reference still point to a live audit-script section?
- [ ] Does its "Regression test" reference still point to a live test?
- [ ] Does the failure class still apply to surfaces that exist?

If a failure references a surface that has been removed: mark it
`(Resolved — surface no longer exists)`. Do not delete silently.

### Release gate

All 5 steps complete with no unresolved findings → release may proceed.

A finding is "resolved" when: the issue is fixed, OR it is explicitly acknowledged
as a known acceptable deviation with a written reason in the relevant doc section.
"I ran the checklist and it's fine" is not a written reason.

**This checklist does not block releases for documentation-only gaps.** Its purpose
is detecting silent semantic regressions (wrong renderer, broken pipeline, stale
surface inventory), not ensuring perfect documentation. Prioritize Steps 1 and 4
if time is short.

---

## Governance Footprint Watchlist

Governance is healthy now because it is small. Track its size to prevent slow inflation.

**Current footprint (2026-05-12):**

| Artifact | Location | Purpose | Last updated |
|---|---|---|---|
| `RENDERING_BOUNDARIES.md` | `src/` | Decision rules, surface inventory, PR checklist | 2026-05 |
| `SEMANTIC_PIPELINE_INVENTORY.md` | `src/` | Point-in-time surface snapshot | 2026-05 |
| `SEMANTIC_CHANGELOG.md` | `src/` | Architectural change history | 2026-05 |
| `RENDERER_OWNERSHIP_INDEX.md` | `src/` | Per-renderer ownership specs | 2026-05 |
| `RENDERER_DECISIONS.md` | `src/` | ADR-style architectural decision records | 2026-05 |
| `SEMANTIC_FAILURE_ARCHIVE.md` | `src/` | Institutional failure class memory | 2026-05 |
| `audit-rendering.sh` | `scripts/` | 15-section drift detection script | 2026-05 |
| `MathText.security.test.ts` | `__tests__/` | 63 sanitizer regression tests | 2026-05 |
| `MathText.semantic.test.ts` | `__tests__/` | 53 pipeline semantic tests | 2026-05 |

**Warning thresholds:**

| Signal | Warning threshold | Action if exceeded |
|---|---|---|
| Governance docs in `src/*.md` | > 6 | Consolidate; two docs may be doing the same job |
| Audit script sections | > 15 | Trim low-signal sections; quality > coverage |
| PR review checklist items | > 8 | Remove items that don't catch real problems |
| Average doc update time | > 10 min | The doc is too large; split or trim |
| Tests not run in > 6 months | Any | Delete or update; stale tests erode confidence |

**Current status: within bounds.** Re-evaluate if any threshold is crossed.

---

## Governance Footprint Stability Rules

These rules prevent slow governance inflation. Apply them any time a new governance
artifact — doc, section, audit check, or checklist item — is proposed.

**Rule 1 — No new governance doc without consolidation review.**  
Before creating a new `src/*.md` file, verify its content cannot fit as a section
in an existing doc. A new file is justified only when its content is structurally
distinct (e.g., a failure archive is not the same as a decision record). "It's
cleaner as its own file" is not a structural reason.

**Rule 2 — Prefer extending existing docs over creating new ones.**  
A new section in `RENDERING_BOUNDARIES.md` costs one heading. A new file costs a
new entry in `SEMANTIC_GOVERNANCE_INDEX.md`, a new row in the Governance Footprint
Watchlist, a navigation burden on every future reader, and a maintenance obligation.
The second cost is always higher.

**Rule 3 — Delete obsolete doctrine aggressively.**  
A section that no longer reflects how the code works is worse than no section — it
actively misleads future developers. When a surface is removed or a decision is
reversed, remove the corresponding governance prose in the same PR. Do not append
a correction alongside stale content; remove the stale content.

**Rule 4 — High signal over exhaustive coverage.**  
A decision rule that covers 90% of cases in 3 sentences is more valuable than a
table with 40 rows. When a section grows to where skimming it is difficult, trim
it. Governance that is not read provides no protection.

**Rule 5 — Governance should reduce confusion, not increase it.**  
The test: after reading the relevant section, does a developer feel confident about
what to do? If reading a governance section produces more questions than it answers,
it must be rewritten or removed. Governance that creates hesitation has failed its
purpose (see Governance Minimalism Protection above).

**Applying these rules in practice:**

| Proposal | Likely answer | Rationale |
|---|---|---|
| Add a section to an existing doc | ✓ Proceed | Low cost; no footprint increase |
| Create a new governance doc | Review first | Does it consolidate, or expand? |
| Add a row to an audit section | ✓ Proceed (if under 15-section cap) | Low cost; detection value clear |
| Add a new audit section | Replace first | Cap is 15; add only by replacing low-value section |
| Add a PR checklist item | Replace first | Cap is 8; add only by removing an item that hasn't caught a real problem |
| Preserve a stale doc section "just in case" | ✗ Delete it | Stale docs erode trust in current docs |

---

## Governance Sunset Rules

Governance artifacts are not permanent by default. Each has conditions under which
it should be consolidated, simplified, or removed. Governance that outlives its
purpose becomes noise that degrades the signal quality of what remains.

| Artifact | Becomes a consolidation candidate when | Path |
|---|---|---|
| `RENDERER_OWNERSHIP_INDEX.md` | Only one renderer exists in the codebase | Merge renderer-specs section into `RENDERING_BOUNDARIES.md`; delete the file |
| `RENDERER_DECISIONS.md` | No architectural question has been re-litigated in 2+ years | Mark `(Stable — archive only)`; maintenance cost is near zero; retain indefinitely |
| `SEMANTIC_FAILURE_ARCHIVE.md` | 5+ entries are marked `(Resolved)` and all remaining entries have regression test coverage | Prune resolved entries; if the archive shrinks to ≤3 active entries, merge into `RENDERING_BOUNDARIES.md` |
| `SEMANTIC_PIPELINE_INVENTORY.md` | The snapshot date is > 1 year out of date AND no structural changes have triggered an update | Re-snapshot or merge inventory tables into `RENDERING_BOUNDARIES.md` Complete Surface Inventory |
| `SEMANTIC_CHANGELOG.md` | No architectural change for 12+ months | No action — append-only is maintenance-free; retain indefinitely |
| An audit script section | The section produces zero non-exception findings across 10+ consecutive runs | Candidate for removal or merge under the 15-section replacement protocol |
| A release rhythm checklist step | The step passes trivially in 5+ consecutive releases | Remove or merge with an adjacent step |

**What "sunset" means in practice:**

- **Mark**: add `(Stable — no updates expected)` if the content is still accurate but unlikely to change. Zero maintenance cost.
- **Merge**: fold a section into a broader doc when it is short enough to be a section, not a file.
- **Delete**: when the failure mode, surface, or decision the artifact addressed can no longer occur.

**What "governance fossilization" looks like:** a doc that was accurate in 2026 receives no updates as the codebase evolves. The doc does not announce its staleness. Future developers read it, make decisions based on it, and discover the divergence only when something breaks. The Institutional Memory Staleness Watchlist in `SEMANTIC_PIPELINE_INVENTORY.md` is the primary defense.

---

## Governance Consolidation Triggers

Growth pressure should trigger consolidation, not expansion. When multiple signals appear together, consolidate before adding anything new.

| Signal | Example | Consolidation action |
|---|---|---|
| Two docs answer the same question | Both `RENDERING_BOUNDARIES.md` and `RENDERER_OWNERSHIP_INDEX.md` have a renderer comparison table | Move to one; replace the other with a one-line reference |
| Repeated doctrine | "Use MathText for Content Studio content" appears in 5 places | One canonical source; all others become references |
| Cross-link depth increasing | A developer must follow 3+ links to answer one question | Merge the linked sections into the primary doc |
| Update burden growing | A surface change requires editing 4+ docs | Identify which docs share an update trigger; merge them |
| Ownership ambiguity | "Is the renderer rule in BOUNDARIES or OWNERSHIP?" | Clarify in the secondary doc: one sentence pointing to the canonical source |

**Consolidation procedure:**
1. Identify the canonical doc for the content (the one consulted first in practice)
2. Move content there; replace the secondary content with `→ See [canonical doc] [section]`
3. If the secondary doc becomes a navigation shell with no prose of its own: delete it

---

## The Two Renderers

| Renderer | File | Purpose |
|---|---|---|
| `MathText` | `src/components/MathText.tsx` | SAT academic content — questions, choices, explanations, prompts |
| `SafeHtml` | `src/components/SafeHtml.tsx` | Generic HTML rendering with DOMPurify sanitization |

These are not interchangeable. Using the wrong one is a semantic correctness bug.

---

## Decision Rule — Use MathText When

All of the following are true:

1. The content was authored in a **textarea** in the Content Studio (question stem, answer choice, explanation, stimulus)
2. The content may contain **LaTeX math** (`\( \)`, `\[ \]`, `$`, `$$`)
3. The content may contain **SAT-safe formatting** (`**bold**`, `*italic*`, `<sup>`, `<sub>`)
4. The content should render **identically** to what the author saw in the preview pane
5. The content **does not** need arbitrary HTML passthrough

```tsx
// ✓ Question stem
<MathText text={question.prompt} block className="text-base font-semibold" />

// ✓ Answer choice
<MathText text={choice.text} className="text-sm" />

// ✓ Explanation after submission
<MathText text={question.explanation} block className="text-sm text-muted-foreground" />

// ✓ Passage / stimulus context
<MathText text={question.stimulusContext} block className="text-sm italic" />
```

---

## Decision Rule — Use SafeHtml When

The content requires **arbitrary HTML passthrough** that is:
- Not academic content authored in the Content Studio
- Already structured as rich HTML (e.g., content from a legacy admin panel, CMS, or third-party system)
- Required to preserve HTML elements that `MathText`'s strict allowlist would strip (e.g., `<p>`, `<div>`, `<a>`, `<table>`, `<mark>`)

```tsx
// ✓ Legacy exam page with text highlighting stored as HTML with <mark> spans
<SafeHtml html={questionHighlights[q.id] || q.text} className="..." />

// ✓ Admin panel with prose-formatted content
<SafeHtml html={richContent} className="prose prose-sm" />
```

---

## The Test: "Does this need arbitrary HTML?"

If you can answer **NO** to all of the following, use `MathText`:

- Does the content contain `<a>` links that must survive rendering?
- Does the content contain `<p>`, `<div>`, or block-level HTML?
- Does the content contain `<mark>` annotations added programmatically at runtime?
- Does the content contain any HTML tags outside the `MathText` allowlist?

If **YES** to any of the above, use `SafeHtml`.

---

## Complete Surface Inventory

### ✅ MathText surfaces (SAT academic content)

| Surface | Component | Content type |
|---|---|---|
| Student exam prompt | `StudentAttemptRunnerContainer` | Question stem |
| Student exam choices | `MultipleChoiceInput` (via `AnswerInput`) | MC answer choices |
| Author preview prompt | `SATQuestionPreview` in `BuilderSetEditorContainer` | Question stem preview |
| Author preview choices | `SATQuestionPreview` | Answer choice preview |
| Author preview explanation | `SATQuestionPreview` | Explanation preview |
| Author preview stimulus | `SATQuestionPreview` | Passage/stimulus preview |
| Author choice live preview | `ChoiceEditor.ChoiceRow` | Below-textarea preview |
| Review page question text | `review/[attemptId]/page.tsx` | Question stem |
| Review page question prompt | `review/[attemptId]/page.tsx` | Question context/stimulus |
| Review page choices | `review/[attemptId]/page.tsx` | MC answer choices |
| Review page explanation | `review/[attemptId]/page.tsx` | Post-submission explanation |

### ⛔ SafeHtml surfaces (retain — do not migrate)

| Surface | Component | Why SafeHtml is correct here |
|---|---|---|
| Legacy exam runner — question text | `exam/[attemptId]/page.tsx` | Text highlighting feature stores annotated HTML with `<mark>` in state; MathText's strict allowlist strips `<mark>` |
| Legacy exam runner — choices | `exam/[attemptId]/page.tsx` | Same — option highlights use `<mark>` |
| Legacy admin panel | `admin/page.tsx` | Legacy surface with `prose` classes, MathJax hybrid, rich editor toolbar; separate rendering system |
| `MathPreview` in admin editor | `admin/page.tsx` | Part of the legacy rich editor component |

### ❌ Raw text rendering — do not add new instances

If you see `{q.prompt}` or `{c.text}` as a bare JSX expression in a student-facing or preview surface, it is a bug. Add to the list of surfaces to audit.

**Currently known raw renders (intentional — list/index contexts):**

| Surface | Component | Why it's intentional |
|---|---|---|
| Question bank list card | `QuestionCard` in `bank/page.tsx` | Truncated index view with `line-clamp-2`; math rendering in a list thumbnail is not worth the cost |
| Builder question sidebar | `BuilderSetEditorContainer` question list | Author-facing list sidebar; authors recognize raw LaTeX; full rendering is in the preview pane |
| Module questions panel list | `ModuleQuestionsPanel` line items | Admin list view; question text is truncated and functional, not pedagogical |

**Rule for index/list views:** Raw text render is acceptable in a list view IF: (a) the surface is author/admin-facing only, (b) the text is truncated with `line-clamp`, and (c) there is a full `MathText` render available by opening the item.

---

## SafeHtml: What DOMPurify Allows That MathText Does Not

`SafeHtml` uses DOMPurify with default settings, which allows a broad set of HTML elements including: `<a>`, `<p>`, `<div>`, `<span>`, `<table>`, `<tr>`, `<td>`, `<ul>`, `<li>`, `<h1>`–`<h6>`, `<mark>`, and many others.

`MathText` allows only 7 tags: `<b>`, `<i>`, `<em>`, `<strong>`, `<sup>`, `<sub>`, `<br>`.

This is not a deficiency in `MathText` — it is a deliberate, security-enforced boundary. SAT academic content does not need `<table>` or `<h2>`. If authored content needs those tags, it is either legacy data or a misuse of the content model.

---

## Convergence Roadmap

### Phase 1 — Complete ✅
- `MathText` established as the canonical renderer for SAT academic content
- Student runner, author preview, review page all use `MathText`
- Security and semantic regression tests in place

### Phase 2 — Not yet started
**Goal:** Migrate the legacy exam runner (`exam/[attemptId]/page.tsx`) away from `SafeHtml` for content that does not need text highlighting.

**Prerequisite:** The text highlighting feature in the legacy exam runner stores annotated HTML in component state. To use `MathText`, the highlighting system must be redesigned to store selection offsets rather than HTML mutations. This is a non-trivial change.

**Approach when ready:**
1. Redesign highlight storage to use character offsets instead of HTML mutations
2. Render base text with `MathText`
3. Apply highlights as an overlay using a separate mechanism (CSS highlight API, or absolutely-positioned overlay elements)

**Do not attempt Phase 2 without redesigning the highlighting system first.**

### Phase 3 — Not planned
The legacy admin panel (`admin/page.tsx`) is a separate surface with its own rendering system. Migration is lower priority because it is not student-facing.

---

## How to Keep This Document Current

Update **in the same PR** when any of the following change:

| Change | Required doc update |
|---|---|
| New content-rendering surface added | Add row to the surface inventory table |
| `SafeHtml` surface migrated to `MathText` | Update its row, update Phase status |
| `MathText` ALLOWED_INLINE_TAGS modified | Update the "7 tags" count; update tag comparison table |
| New tag added to `MathText` allowlist | Add rationale comment in `MathText.tsx`; update `MATH_TEXT_BOUNDARIES.md` |
| `prepareRichText` pipeline step added/removed | Update pipeline description in this doc and in `MathText.tsx` header |
| New container-level `renderMath` call introduced | Document it as a named fallback with the 5-section pattern in `BuilderSetEditorContainer.tsx` |
| KaTeX migrated from CDN to npm bundle | Update Phase 2 fallback-removal prerequisites |
| Legacy exam highlighting redesigned | Update Phase 2 status |
| New raw text render added intentionally | Add to the "intentional" list with rationale |

The developer making the change is responsible for the doc update. **No exceptions.** A PR that changes rendering behavior without updating this document has not met its definition of done.

---

## Semantic Stewardship — PR Review Checklist

Before merging any PR that touches a rendering surface, confirm:

1. **Is this SAT-specific?** — If the change adds formatting that is not used in SAT content (e.g. footnotes, pull-quotes, callout boxes), it belongs in a CMS, not in MathText.
2. **Are we duplicating semantic logic?** — Check `audit-rendering.sh` sections 8–12 for parallel pipelines. A new `.replace(/\n/g, "<br>")` or a new bold-parsing regex outside `MathText.tsx` is a red flag.
3. **Are we expanding formatting scope?** — A tag added to `ALLOWED_INLINE_TAGS` is a non-reversible change. Discuss before merging.
4. **Is renderer role unambiguous?** — The new surface uses either `MathText` or `SafeHtml`. Not a third option.
5. **Are we increasing sanitizer complexity?** — If `stripDangerousTags` is approaching 25 lines of logic, the threshold for migrating to DOMPurify has been reached. Do not extend beyond that.
6. **Does the change preserve author intent continuity?** — Author preview semantics must equal student experience semantics. If a formatting feature renders in the preview but not in the exam, it is a trust failure.
7. **Is any fallback rendering being normalized?** — If you're relying on the container-level `renderMath` sweep in `BuilderSetEditorContainer` as the primary reason a new element renders correctly, the new element needs its own `<MathText>` instance instead.

Run `bash scripts/audit-rendering.sh` and confirm all 7 signal checks pass (✓) before marking a rendering-related PR as ready for review.

---

## When Semantic Review Is Required

Semantic review means: run `audit-rendering.sh` and update the relevant doc in the same PR.

**Required** — the PR touches the semantic pipeline:
- Renderer ownership changes (a surface switches between `MathText` and `SafeHtml`)
- `prepareRichText` pipeline changes (step added, removed, or reordered)
- `ALLOWED_INLINE_TAGS` modified
- New `dangerouslySetInnerHTML` usage outside approved renderers
- New fallback `renderMath` sweep introduced
- Audit script section added, removed, or modified
- Review-surface semantics change (renderer, field mapping, `block` prop)

**Not required** — the PR does not touch the semantic pipeline:
- Spacing, padding, margin, or layout changes
- Typography polish (font size, line-height, color tokens)
- Comment wording improvements
- Non-semantic UI changes (icons, animations, transitions)
- Governance doc wording updates that do not change policy
- Operational text (labels, button copy, error messages)

**The test:** "Does this change affect which renderer runs, which content it receives, or how output is sanitized?" If no: no semantic review needed. Skip the checklist, merge normally.

---

## Semantic Cleanup Safety Rules

"Cleanup" and "simplification" PRs that touch rendering code carry elevated semantic risk
because they remove behavior that appears dead but is structurally load-bearing.

**A PR requires explicit semantic verification if it:**

| Action | Why it's risky | Verification required |
|---|---|---|
| Removes a `renderMath` or `renderMathInElement` call | May be a CDN-race fallback; removal restores raw LaTeX on slow networks | Check `SEMANTIC_FAILURE_ARCHIVE.md` Failure 7; test on throttled network |
| Removes a `useEffect` from `MathText` | KaTeX rendering breaks entirely | Run `MathText.semantic.test.ts`; visual verify math renders |
| Reorders steps in `prepareRichText` | Pipeline order is load-bearing; breaks newline semantics or bold safety | Run both `MathText.*.test.ts` suites; check failure archive Failures 3 and 4 |
| Simplifies `stripDangerousTags` | Security regression possible | Run `MathText.security.test.ts` (all 63 tests must pass) |
| Removes governance comments from `MathText.tsx` or `SafeHtml.tsx` | Comments explain non-obvious load-bearing decisions | Re-read the comment; if removing, ensure the information exists in a doc |
| Removes a governance doc section | Information may be referenced by other docs | Grep for references before deleting |
| Removes `audit-rendering.sh` signal checks | Reduces drift visibility | Only remove if the pattern being detected no longer exists in the codebase |
| Deletes or merges renderer components | Renderer unification was rejected (see `RENDERER_DECISIONS.md` RDR-003) | New RDR required before proceeding |

**What "explicit semantic verification" means:**
Run the relevant test suite. Visually verify in a browser. Add a comment in the PR description: "I verified that [specific behavior] is preserved by [specific test/check]."

This is intentional semantic review, not formal approval. It takes 5 minutes, not 5 days.

---

## Semantic Diff Review Habit

For any PR that touches a rendering surface, spend 3 minutes on this checklist:

**Inventory impact:**
- [ ] Does `SEMANTIC_PIPELINE_INVENTORY.md` need a row added, removed, or updated?
- [ ] Does `SEMANTIC_CHANGELOG.md` need a new entry (architectural change, not a tweak)?

**Renderer ownership impact:**
- [ ] Is the renderer choice documented and unambiguous? (MathText / SafeHtml / none of the above → stop)
- [ ] Does `RENDERER_OWNERSHIP_INDEX.md` need to be updated?

**Parity check (for review-page and student-runner changes):**
- [ ] Open the same question in both student exam view and review page.
- [ ] Verify: math expressions, bold, italic, newlines, and superscripts render identically.
- [ ] If they differ: is the difference intentional and documented in `PREVIEW_FIDELITY.md`?

**Audit gate:**
```bash
bash scripts/audit-rendering.sh
# All 7 signal checks must be ✓
```

This checklist should take 3–5 minutes. If it is taking longer, the change is likely
too large in scope or is touching rendering concerns that need separate discussion.

---

## Review-Surface Parity References

These are concrete semantic anchors — not visual tests. Use them to verify that a
redesign or refactor has not changed how content renders on review surfaces vs.
the student exam runner.

### Reference 1: LaTeX math expression

**Input:** `The value is \( x^2 + 2x + 1 = (x+1)^2 \).`  
**Expected renderer:** `MathText` with `block` prop  
**Expected DOM output (simplified):**  Text node + KaTeX `.katex` span + text node  
**Both surfaces must produce:** Identical KaTeX-rendered expression with equivalent visual size  
**Student runner className:** `text-base font-semibold text-foreground leading-relaxed`  
**Review page className:** `text-foreground leading-normal` _(known divergence: `leading-normal` vs `leading-relaxed` — see Note 1)_

### Reference 2: Multi-line passage stem

**Input:** `Read the passage.\nThe author argues...`  
**Expected renderer:** `MathText` with `block` prop  
**Expected DOM output:** `Read the passage.<br>The author argues...`  
**Both surfaces must produce:** Line break at the `\n` position — not collapsed whitespace  
**Failure mode:** Raw `\n` appearing as a space, or double `<br>` if `.replace(/\n/g, "<br>")` was also applied  

### Reference 3: Bold and italic emphasis

**Input:** `Choose the **best** answer. *Consider* the context.`  
**Expected renderer:** `MathText`  
**Expected DOM output:** `Choose the <b>best</b> answer. <i>Consider</i> the context.`  
**Both surfaces must produce:** Bold and italic rendered; not raw `**` asterisks  
**Failure mode:** Asterisks visible as literal characters (`**best**`)  

### Reference 4: Superscript and subscript

**Input (authored HTML):** `CO<sub>2</sub> and H<sup>2</sup>O`  
**Expected renderer:** `MathText`  
**Expected DOM output:** `CO<sub>2</sub> and H<sup>2</sup>O` (tags preserved, no attributes)  
**Both surfaces must produce:** Correct subscript/superscript positioning  
**Failure mode:** Tags stripped, producing `CO2 and H2O` as flat text  

### Reference 5: Explanation after submission

**Input:** Multi-sentence explanation with LaTeX: `The correct answer is **C**. Recall that \( f'(x) = 2x \) when \( f(x) = x^2 \).`  
**Expected renderer:** `MathText` with `block` prop  
**Expected:** Bold "C", KaTeX-rendered derivatives, correct line flow  
**Student runner:** Not shown (no post-submission explanation in active exam)  
**Review page className:** `text-foreground font-[Georgia] leading-relaxed text-sm`  
**Author preview className:** Equivalent — verify after author preview changes  

### Note 1: Known styling divergence (review page vs. student runner)

| Property | Student runner | Review page | Status |
|---|---|---|---|
| `font-size` | `text-base` (16px) | inherits container | Known minor drift |
| `font-weight` | `font-semibold` | not set | Known minor drift |
| `line-height` | `leading-relaxed` | `leading-normal` | Known minor drift |

These are **styling divergences, not renderer divergences**. The renderer (`MathText`, `block`) is identical on both surfaces. The content fields map to the same data. The visual differences are intentional: the review page presents content in a modal with a different typographic hierarchy than the full-screen exam runner.

If a future redesign changes these values, update this table.

---

### Reference 6: Correctness state rendering (review page only)

**Context:** The review page shows correct/incorrect indicators alongside answer choices.
This is purely a UI concern — the renderer (`MathText`) is unaffected by correctness state.

**Expected behavior:**
- Correct choice: green border + `CheckCircle2` icon — `MathText` text unchanged
- Student's wrong choice: red border + `XCircle` icon — `MathText` text unchanged
- Unselected choices: neutral border — `MathText` text unchanged

**Failure mode to watch for:** A redesign changes `MathText` className based on
correctness state (e.g., `text-emerald-900` on the correct choice). Text color changes
are acceptable; renderer changes are not. Verify `<MathText>` is the same component
with the same `text` prop regardless of correctness.

### Reference 7: Long passage / multi-paragraph stem

**Input example:** 400+ word reading passage with 5+ paragraphs, LaTeX in 2-3 places.

**Expected behavior:**
- All paragraphs render with correct line breaks (each `\n` → one `<br>`, not two)
- LaTeX renders correctly even when it appears after a `<br>` element
- No layout overflow on standard viewport widths (1280px desktop)
- Text is selectable and copy-pasteable

**Failure mode to watch for:** `applyNewlines` producing double `<br>` (see
`SEMANTIC_FAILURE_ARCHIVE.md` Failure 8). Test with a stem that has `\n\n` (paragraph
break) — should render as two `<br>` elements, not collapsed.

### Reference 8: Mobile rendering notes (informal baselines)

These are not formal test assertions — they are operational awareness notes.

**Viewport:** 375px width (iPhone SE equivalent), standard DPR  
**Expected:** Question stems wrap at word boundaries; no horizontal overflow; KaTeX
expressions scale correctly (KaTeX uses `em` units tied to font-size)  
**Known behavior:** Very long unbroken LaTeX expressions (e.g., a 40-character equation
without spaces) may overflow on narrow viewports — this is a KaTeX rendering characteristic,
not a MathText bug  
**Watch for after redesigns:** `overflow-x: hidden` on a parent container can hide overflow
rather than wrapping it — visually clean but loses content on mobile
