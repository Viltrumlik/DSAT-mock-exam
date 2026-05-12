# Semantic Failure Archive

> Institutional record of real semantic rendering failures encountered during development.
> Each entry converts a painful debugging session into permanent institutional knowledge.
>
> Purpose: prevent re-introduction of the same failure under a different rationale.
> Format: Symptom → Root cause → Fix → Prevention rule → Audit coverage → Test linkage

---

## Archive Maintenance Rules

### What belongs here

An entry belongs here when ALL of these are true:
1. **It happened** — a real failure, not a theoretical risk
2. **It is repeatable** — the same root cause could recur under different circumstances
3. **It has a semantic root cause** — the renderer, sanitizer, or pipeline was involved
4. **The lesson is non-obvious** — a developer without context would make the same mistake

### What does NOT belong here

- One-off bugs with obvious causes (typos, missing `await`, wrong prop name)
- Performance regressions without a semantic component
- API failures, network issues, or backend data problems
- Styling bugs (wrong color, spacing, layout) that don't affect content rendering
- Framework-specific issues unrelated to the rendering pipeline
- Hypothetical failures that haven't been observed

### Failure severity guidance

| Severity | Description | Examples |
|---|---|---|
| **High** | Causes wrong or missing content for students | Raw LaTeX visible; wrong answer shown; explanation stripped |
| **Medium** | Causes developer confusion, potential for re-introduction | Stale MathJax class; misused renderer at call site |
| **Low** | Cosmetic or operational only; content is still correct | Styling drift between surfaces; unnecessary double render |

Prioritize High-severity entries. Low-severity entries should only be added if the failure
class has been re-introduced at least once and there is no audit detection for it.

### Linkage expectations

Every entry should have at least ONE of:
- A regression test reference (`MathText.security.test.ts`, `MathText.semantic.test.ts`, etc.)
- An audit script section reference (`audit-rendering.sh §N`)
- A governance doc reference (`RENDERING_BOUNDARIES.md`, `RENDERER_DECISIONS.md`, etc.)

An entry with no linkage is a documentation artifact only — acceptable, but less resilient.

### Archive pruning philosophy

**Do NOT prune entries that have regression tests.** The test exists because the failure
was real; the entry explains why the test exists.

**Do prune entries when:**
- The surface that caused the failure no longer exists
- The fix became structurally impossible to regress (e.g., the relevant code was deleted)
- The entry duplicates another entry at a different abstraction level

When pruning: add a one-line note explaining why the entry was removed, rather than
deleting silently. Or leave it and mark it `(Resolved — no longer applicable)`.

**Preferred over pruning:** add a note that the entry is historical and the failure is
now prevented by a structural guarantee.

---

## Failure 1: Raw LaTeX leakage (student sees `\( x^2 \)`)

**Symptom:** Students see raw LaTeX delimiters (`\( x^2 \)`, `\[ ... \]`) instead of
rendered math expressions. Appears as literal text in the middle of a question or choice.

**Root cause (multiple):**
- Content rendered with `{question.prompt}` (bare JSX text node) instead of `<MathText>`
- `MathText` rendered but KaTeX CDN not yet loaded (race condition on slow networks)
- `useEffect` for `renderMath` fires before `renderMathInElement` is available on `window`

**Fix:**
- Replace bare text node with `<MathText text={...} block />` where needed
- For CDN race: the container-level `renderMath` fallback in `BuilderSetEditorContainer`
  re-runs on each content change, so the first keystroke after CDN load re-renders
- For student exam race: the double `renderMath` call (0ms + 60ms) in the exam page
  covers React's two-pass commit

**Prevention rule:** Never render academic content as a bare JSX text node. If you see
`{question.prompt}` or `{choice.text}` in a student-facing or author-facing JSX surface,
it is a bug. The only approved exceptions are index/list views with `line-clamp` truncation.

**Audit coverage:** `audit-rendering.sh` §7 (raw prompt/choice text detection)

**Regression test:** `MathText.semantic.test.ts` — "SAT-realistic content patterns" category

---

## Failure 2: Choice duplicate detection corrupted by `.toLowerCase()`

**Symptom:** When two answer choices look different to students (`\( A \)` vs `\( a \)`)
but the builder correctly flags them as duplicates — or vice versa: identical choices
are not detected as duplicates because their LaTeX is different case.

**Root cause:** `validateChoices` in `ChoiceEditor.tsx` was calling `.toLowerCase()` on
choice text before duplicate comparison. LaTeX is case-sensitive: `\( A \)` and `\( a \)` are
mathematically distinct. Lowercasing them produces false positives.

**Fix:** Removed `.toLowerCase()` from duplicate comparison. Choice text is compared as-is.

**Prevention rule:** Never normalize LaTeX content to lowercase for comparison. LaTeX is
case-sensitive by specification. `\Alpha` ≠ `\alpha`. Comparison helpers must treat
LaTeX content as opaque case-sensitive strings.

**Audit coverage:** No automated detection — code review only

**Regression test:** None currently. Consider adding a `ChoiceEditor` test for `validateChoices`
with case-sensitive LaTeX pairs.

---

## Failure 3: Newline semantic loss (`\n` rendered as whitespace)

**Symptom:** Multi-line question stems and explanations authored with line breaks in the
Content Studio textarea appear as a single collapsed line in the rendered output. Line
structure intended by the author is lost.

**Root cause:** HTML collapses bare `\n` characters as whitespace. Before `applyNewlines()`
was added to `prepareRichText`, newlines in authored content were silently discarded.

**Fix:** Added `applyNewlines()` as step 2 in `prepareRichText`: converts `\n` → `<br>`.
Pipeline order is now: strip → newlines → markdown. Order is load-bearing.

**Prevention rule:** Do NOT remove `applyNewlines()` from `prepareRichText`. Do NOT reorder
it after `applyMarkdown()` — bold/italic matching must not cross line boundaries. If you
add a new pipeline step between `stripDangerousTags` and `applyMarkdown`, verify it does
not consume `<br>` elements unexpectedly.

**Audit coverage:** `audit-rendering.sh` §8 detects `.replace(/\n/g, "<br>")` outside
approved surfaces — a symptom of this failure being "fixed" at the call site instead of
the pipeline.

**Regression test:** `MathText.semantic.test.ts` — "newline semantics" category (CRLF,
mixed newlines, 1000 consecutive newlines).

---

## Failure 4: Cross-line bold injection

**Symptom:** Content such as `**Choose the best answer.**\nBe careful.` renders the entire
second line as bold — i.e., the `<b>` tag spans across the line break and wraps content the
author did not intend to bold.

**Root cause:** After `applyNewlines()` converts `\n` → `<br>`, the bold regex
`/\*\*([^*\n]+?)\*\*/g` (using `[^*\n]`) would match `**text<br>more text**` because `<br>`
contains neither `*` nor `\n`. The exclusion class was designed for literal newlines but
did not account for `<br>` elements produced by the preceding pipeline step.

**Fix:** Updated the bold and italic regex char class from `[^*\n]` to `[^*\n<]`. The `<`
exclusion prevents matching across any HTML tag, including `<br>`. This means: bold content
cannot contain any HTML tags (correct — authors write `**word**`, not `**<b>word</b>**`).

**Prevention rule:** Do NOT revert `[^*\n<]` to `[^*\n]`. The `<` exclusion is load-bearing.
If the regex is ever rewritten, it must preserve the property: bold and italic matches cannot
span across `<` characters. See `SEMANTIC_CHANGELOG.md` entry for the full context.

**Audit coverage:** No automated detection — `MathText.security.test.ts` is the regression guard.

**Regression test:** `MathText.security.test.ts` — "J. Edge cases" → "bold markers must not
span newlines (cross-line bold is forbidden)".

---

## Failure 5: Stale `mathjax-process` CSS class on non-MathJax surfaces

**Symptom:** A div has `className="... mathjax-process ..."` but is not inside a MathJax-
driven surface. The class is semantically meaningless (MathJax is not loaded on this page)
but misleads future developers into thinking the surface uses MathJax rendering.

**Root cause:** After migrating `review/[attemptId]/page.tsx` from `SafeHtml` to `MathText`,
the `mathjax-process` CSS class was left on the choice wrapper div. It was a functional
artifact from the SafeHtml era — `SafeHtml.tsx` called `MathJax.typesetPromise` on elements
with this class to trigger MathJax rendering. After migration, `MathText` handles rendering
via its own `useEffect`, making the class both stale and misleading.

**Fix:** Removed `mathjax-process` from `review/[attemptId]/page.tsx` line ~117.

**Prevention rule:** When migrating a surface from `SafeHtml` to `MathText`, check for and
remove `mathjax-process` CSS classes. Run `audit-rendering.sh` §6 after any SafeHtml→MathText
migration to confirm no stale classes remain.

**Audit coverage:** `audit-rendering.sh` §6 detects `mathjax-process` outside approved surfaces.

**Regression test:** None — detected and fixed during audit.

---

## Failure 6: Preview/student divergence via mixed renderer

**Symptom:** Content renders correctly in the author preview pane (Content Studio) but
differently in the student exam or review page — e.g., LaTeX renders in preview but appears
as raw text in the student view, or bold renders in preview but not in review.

**Root cause:** The author preview, student exam, and review page were using different
renderers. Before governance was established, `SATQuestionPreview` used bare `{text}` JSX
expressions (raw text nodes) while the student exam used `SafeHtml` and the review page
used a mix.

**Fix:** All academic-content surfaces standardized on `MathText`. Pipeline is identical
across: author preview, student exam runner, review page. Author intent = student view.

**Prevention rule:** When adding a new rendering surface for academic content, always ask:
"does this use the same renderer as the surface the author used when writing this content?"
If the answer is no, it is a semantic divergence. Review `RENDERING_BOUNDARIES.md` parity
references before finalizing any new surface.

**Audit coverage:** `audit-rendering.sh` §1 inventories all `<MathText>` usages. A surface
that should use MathText but doesn't will appear missing from the expected list.

**Regression test:** `MathText.semantic.test.ts` — "SAT-realistic content patterns" verifies
that the same input produces consistent output.

---

## Failure 7: KaTeX CDN race (math not rendering on first page load)

**Symptom:** On slow networks, a freshly loaded page shows raw LaTeX delimiters in the
author preview pane. The math renders correctly after the first keystroke, but the initial
state appears broken.

**Root cause:** KaTeX is loaded via a CDN `<Script>` tag (not bundled). React's initial
render and useEffect batch completes before the CDN script finishes loading, making
`window.renderMathInElement` undefined. `MathText`'s useEffect calls `renderMath()`, which
checks `typeof window.renderMathInElement === 'function'` and returns early if unavailable.

**Fix (mitigation, not cure):** The container-level `renderMath` fallback in
`BuilderSetEditorContainer` re-runs on every content keystroke. After the CDN loads,
the first keystroke triggers a full re-pass and math renders. The initial state flash is
a known cosmetic issue on slow networks, not a data corruption.

**Permanent fix (not yet implemented):** Migrate KaTeX from CDN script to npm bundle
(`katex` + `katex/contrib/auto-render`). This eliminates the race condition. The container
fallback can then be removed. See `RENDERING_BOUNDARIES.md` convergence roadmap.

**Prevention rule:** Do NOT remove the container-level fallback in `BuilderSetEditorContainer`
until KaTeX is migrated to a bundled import. Removing it restores the first-load raw LaTeX
flash on slow networks.

**Audit coverage:** No automated detection. The fallback ownership declaration in
`BuilderSetEditorContainer.tsx` documents its purpose.

**Regression test:** None — manual testing on throttled network required.

---

## Failure 8: Double newline conversion (call site + pipeline)

**Symptom:** Multi-line text renders with double `<br>` elements — blank lines between
every authored line. A passage that should look like normal paragraphs looks like a
double-spaced list.

**Root cause:** A developer adds `.replace(/\n/g, "<br/>")` to a field before passing it
to `<MathText>`. Since `prepareRichText` already runs `applyNewlines()` internally,
the conversion runs twice: once at the call site (producing `<br/>`) and once in the
pipeline (treating `<br/>` as plain text and adding another `<br>` after the tag's `\n`
if any).

**Fix:** Remove the `.replace(/\n/g, "<br/>")` call from the `<MathText>` call site.
`MathText` handles newline conversion internally. Call sites should pass the raw authored
text unchanged.

**Prevention rule:** Never call `.replace(/\n/g, ...)` on text before passing it to
`<MathText>`. The pipeline handles it. The `.replace()` pattern is only correct when
passing text to `<SafeHtml>` (which does not run `prepareRichText`). When migrating a
`<SafeHtml>` usage to `<MathText>`, always remove the `.replace()` call.

**Audit coverage:** `audit-rendering.sh` §8 detects `.replace(/\n/g, "<br")` outside
approved SafeHtml surfaces.

**Regression test:** `MathText.semantic.test.ts` — "newline semantics" → "textarea
line-break: CRLF normalized to single <br>".
