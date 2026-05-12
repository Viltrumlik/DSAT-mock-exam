# Semantic Pipeline Changelog

> **Purpose:** Track architecturally meaningful changes to the semantic rendering pipeline.
> Do NOT log: routine bug fixes, className tweaks, new question content, API field renames.
> DO log: renderer responsibility changes, sanitizer changes, pipeline-order changes, SafeHtml
> positioning changes, new surfaces added/removed, governance doctrine changes.

---

## Change Classification

Each entry is tagged with its change class. Use the class to understand impact scope:

| Tag | Class | Scope | Example |
|---|---|---|---|
| `[INFRASTRUCTURE]` | Pipeline or sanitizer | Affects all surfaces — highest impact | New pipeline step, allowlist change, KaTeX migration |
| `[SURFACE]` | Specific rendering surface | Affects one or more surfaces — medium impact | Review page migration, new student surface added |
| `[GOVERNANCE]` | Doctrine or documentation | No runtime effect — low impact | New doc, scope freeze, audit rule added |

When in doubt: if it changes what renders in a browser, it is `[INFRASTRUCTURE]` or `[SURFACE]`.
If it only changes what is written in a doc or comment, it is `[GOVERNANCE]`.

---

> **Format per entry:**
> ```
> ## YYYY-MM-DD — [CLASS] Title
> **Impact:** which surfaces / pipeline steps are affected
> **Change:** what changed
> **Reason:** why
> **Regression protection:** test class (if applicable)
> **Docs updated:** which governance docs reflect this change
> ```

---

## 2026-05 — [GOVERNANCE] Semantic governance established (foundational)

**Impact:** All rendering surfaces  
**Change:** Semantic rendering governance framework established across the codebase.
Includes: `MathText` declared canonical SAT-academic renderer; `SafeHtml` given explicit
architectural positioning (exam surface: Permanent, admin surface: Legacy Bridge);
`RENDERING_BOUNDARIES.md`, `SEMANTIC_PIPELINE_INVENTORY.md`, `RENDERER_OWNERSHIP_INDEX.md`
created as governing documents; `audit-rendering.sh` created as CI-adjacent drift detector;
`MathText.security.test.ts` (63 tests) and `MathText.semantic.test.ts` (53 tests) established
as contract regression tests.  
**Reason:** Platform crossed maturity threshold where "rendering works" is insufficient;
semantic predictability over years of evolution requires institutional memory and governance.  
**Docs updated:** `RENDERING_BOUNDARIES.md`, `SEMANTIC_PIPELINE_INVENTORY.md`,
`RENDERER_OWNERSHIP_INDEX.md`, `MathText.tsx`, `SafeHtml.tsx`

---

## 2026-05 — [SURFACE] Review page migrated from SafeHtml to MathText

**Impact:** `review/[attemptId]/page.tsx` — all 4 rendered fields  
**Change:** All four `<SafeHtml>` usages replaced with `<MathText>`. Fields affected:
question text/stem, question prompt (stimulus), MC answer choices, explanation.
Redundant `renderMathInElement` retry loop on `document.body` removed.
`import SafeHtml` replaced with `import { MathText }`.  
**Reason:** Review page is an academic-content surface; content was authored in Content
Studio textarea; `SafeHtml` was incorrect here. Migration established parity with student
exam runner and author preview pane.  
**Docs updated:** `RENDERING_BOUNDARIES.md` surface inventory

---

## 2026-05 — [INFRASTRUCTURE] `applyNewlines()` added to `prepareRichText` pipeline

**Impact:** `MathText` component — all surfaces  
**Change:** New `applyNewlines()` step added between `stripDangerousTags()` and
`applyMarkdown()`. Converts bare `\n` characters to `<br>` elements. Pipeline order
is now: strip → newlines → markdown.  
**Reason:** Authors write multi-line content in textarea inputs. HTML collapses bare `\n`
as whitespace. Without conversion, multi-line stems and explanations lost their line
structure in the rendered output.  
**Docs updated:** `MathText.tsx` pipeline comment, `SEMANTIC_PIPELINE_INVENTORY.md`

---

## 2026-05 — [INFRASTRUCTURE] Bold/italic regex hardened with `[^*\n<]` exclusion

**Impact:** `applyMarkdown()` in `MathText.tsx`  
**Change:** Bold and italic regex char class changed from `[^*\n]` to `[^*\n<]`.
The `<` exclusion prevents cross-line bold matching after `applyNewlines` converts
`\n` → `<br>`. Without this, `**line1<br>line2**` would render as bold.  
**Reason:** `applyNewlines` runs before `applyMarkdown` (pipeline order). After
`\n` → `<br>`, the `[^*\n]` class no longer protected against cross-line matching
because `<br>` does not contain `\n`. Adding `<` closes the gap.  
**Regression protection:** `MathText.security.test.ts` "bold markers must not span
newlines" test class. Do not revert this change.  
**Docs updated:** `MathText.tsx` applyMarkdown comment

---

## 2026-05 — [GOVERNANCE] `SafeHtml` given explicit architectural positioning

**Impact:** `SafeHtml.tsx` ownership doctrine  
**Change:** Added "Long-term Architectural Positioning" section to `SafeHtml.tsx`.
Decision: exam surface is **Permanent Specialized Renderer** (Option A); admin surface
is **Legacy Bridge, no migration planned** (Option B).  
**Reason:** Undefined coexistence between `MathText` and `SafeHtml` was an
architectural ambiguity debt. Making the decision explicit prevents premature migration
attempts on the exam surface and removes any expectation that SafeHtml is temporary.  
**Docs updated:** `SafeHtml.tsx`, `RENDERING_BOUNDARIES.md`, `RENDERER_OWNERSHIP_INDEX.md`

---

## 2026-05 — [GOVERNANCE] Container-level `renderMath` formally declared a fallback

**Impact:** `BuilderSetEditorContainer.tsx` — author preview pane only  
**Change:** The existing container-level `renderMath({ root: containerRef.current })` call
was given a formal 5-section ownership declaration: why it exists (KaTeX CDN race condition),
failure mode protected (raw LaTeX flash on slow networks), surfaces it covers (SATQuestionPreview
only), removability condition (when KaTeX migrates from CDN to npm bundle), and explicit
"not primary ownership" statement.  
**Reason:** An undocumented fallback sweep is invisible to future developers and risks
being either removed (breaking slow-network preview) or expanded to cover new surfaces
that should have their own `<MathText>` instances.  
**Docs updated:** `BuilderSetEditorContainer.tsx` comment, `SEMANTIC_PIPELINE_INVENTORY.md`

---

## 2026-05 — [GOVERNANCE] `ALLOWED_INLINE_TAGS` frozen with allowlist notice

**Impact:** `MathText.tsx` — `stripDangerousTags()` sanitizer  
**Change:** Added "ALLOWLIST FREEZE NOTICE" to the `ALLOWED_INLINE_TAGS` constant.
Documents: 5-step requirements for adding a tag (including mandatory security review,
new test class, doc updates, and DOMPurify migration threshold); attack class history
for 6 analyzed attack vectors; migration threshold (>10 tags → migrate to DOMPurify).  
**Reason:** The allowlist is intentionally frozen at 7 tags. Without a freeze notice,
incremental tag additions ("just add `<p>`, it seems harmless") will accumulate until
the regex-based sanitizer is no longer tenable and a security regression has occurred.  
**Docs updated:** `MathText.tsx` ALLOWED_INLINE_TAGS comment

---

## 2026-05 — [GOVERNANCE] `studioSession.test.ts` 48h-boundary test hardened

**Impact:** `studioSession.ts` expiry logic — test only, no runtime change  
**Change:** The "exactly 48h boundary" expiry test was racy: `Date.now() - MAX_AGE_MS`
computed and stored as `boundaryTs`, but a few milliseconds pass before
`readStudioSession()` re-evaluates age, making `age` marginally > `MAX_AGE_MS`.
Test now uses `Date.now() - MAX_AGE_MS + 500` (500ms under boundary) with a comment
explaining the race. The semantic contract being tested (strict `>` boundary) is unchanged.  
**Reason:** Flaky test fails intermittently based on system load. Not a rendering
pipeline change, but logged because session state affects the author "continue working"
surface.  
**Docs updated:** `studioSession.test.ts` comment

---

## Template for future entries

```
## YYYY-MM-DD — [INFRASTRUCTURE | SURFACE | GOVERNANCE] Title

**Impact:** [which surfaces / components / pipeline steps]
**Change:** [what was added, removed, or modified]
**Reason:** [why the change was made]
**Regression protection:** [which tests cover this, if applicable]
**Docs updated:** [which governance docs were updated in the same PR]
```

**Classification guide:**
- `[INFRASTRUCTURE]` — changes to `MathText.tsx` pipeline, `SafeHtml.tsx` sanitizer, `mathRender.ts`, allowlist, fallback sweep scope
- `[SURFACE]` — new surface added, surface migrated between renderers, surface removed
- `[GOVERNANCE]` — doc additions, scope freezes, audit rule changes, decision records, test additions without pipeline changes

**Entry required when:**
- `ALLOWED_INLINE_TAGS` is modified
- `prepareRichText` pipeline steps are added, removed, or reordered
- A surface moves from `SafeHtml` → `MathText` or vice versa
- A new `dangerouslySetInnerHTML` usage is added anywhere
- A new fallback `renderMath` sweep is added
- SafeHtml's architectural positioning is revised
- A new renderer component is introduced
- The audit script gains or loses a detection category

**Entry NOT required for:**
- Routine bug fixes in rendering output
- className / styling changes
- New question content or API changes
- Test additions that don't reflect pipeline changes
