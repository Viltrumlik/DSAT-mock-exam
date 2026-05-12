# SAT Question Preview — Fidelity Watchlist

> **Version:** 2.0  
> **Scope:** Author preview in `BuilderSetEditorContainer` vs. student-facing question render  
> **Risk level:** Low-medium — semantic rendering is now converged; layout divergence remains latent

---

## The Problem

The author preview (`SATQuestionPreview` in `BuilderSetEditorContainer.tsx`) and the student-facing question render are independent implementations. Any change to the student render that is not mirrored in the preview creates **silent fidelity drift** — authors make authoring decisions based on what they see in the preview, not what students will actually experience.

A mathematically wrong preview is worse than no preview.

This document tracks the current state of each rendering property and provides a clear convergence roadmap.

---

## Audit Checklist

Mark each property as:
- ✅ **Converged** — both surfaces use the same implementation or identical visual output  
- ⚠️ **Known drift** — documented and managed difference  
- ❌ **Unverified** — not yet compared

---

### Semantic Rendering (highest priority — content correctness)

> These properties determine whether authors see what students see, not just whether the layout looks similar.

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Math rendering engine | KaTeX via `renderMath()` on container | `MathText` → `renderMath()` per-element | ✅ Same library, same delimiters |
| Math in question stem | `MathText` (converged v2.0) | `MathText` | ✅ Converged |
| Math in answer choices | `MathText` (converged v2.0) | `MathText` via `MultipleChoiceInput` | ✅ Converged |
| Math in explanation | `MathText` (converged v2.0) | Shown post-submission (intentional) | ✅ Converged — see intentional differences |
| Math in stimulus/passage | `MathText` (converged v2.0) | N/A (stimulus not in student runner) | ✅ Converged |
| **bold** `**text**` rendering | `MathText` (converged v2.0) | `MathText` | ✅ Converged |
| *italic* `*text*` rendering | `MathText` (converged v2.0) | `MathText` | ✅ Converged |
| `<sup>` / `<sub>` passthrough | `MathText` allowlist | `MathText` allowlist | ✅ Converged |
| Event handler stripping | `prepareRichText` sanitizer | `prepareRichText` sanitizer | ✅ Same function |
| Duplicate detection (choices) | Case-preserving (LaTeX-safe) | N/A (student can't edit) | ✅ Fixed — no case folding |

---

### Typography

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Question stem font-size | `text-sm` (14px) | `text-base` (16px) | ⚠️ Known drift — preview is compact |
| Question stem font-weight | `font-medium` | `font-semibold` | ⚠️ Known drift — preview uses lighter weight |
| Question stem line-height | `leading-relaxed` | `leading-relaxed` | ✅ Converged |
| Stimulus/passage font-size | `text-sm` | N/A | ❌ Unverified |
| Stimulus font-style | `italic` | N/A | ❌ Unverified |
| Explanation font-size | `text-sm` | N/A (post-submit) | ⚠️ Intentional difference |

---

### Spacing

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Padding around question content | `p-5` | `p-5` | ✅ Converged |
| Gap between stem and choices | `space-y-4` | `mt-5` | ⚠️ Visually similar, not identical |
| Gap between choice rows | `space-y-2` | `gap-3` | ⚠️ Known drift — student has slightly more gap |
| Stimulus top margin | Part of `space-y-4` | N/A | ❌ Unverified |

---

### Math Rendering

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Math library | KaTeX 0.16.9 via CDN | KaTeX 0.16.9 via CDN | ✅ Same version |
| Math trigger | `MathText` `useEffect` per element | `MathText` `useEffect` per element | ✅ Same mechanism |
| Inline math delimiter `\( \)` | Supported | Supported | ✅ Converged |
| Display math delimiter `\[ \]` | Supported | Supported | ✅ Converged |
| Dollar delimiter `$` / `$$` | Supported | Supported | ✅ Converged |
| Math font size relative to text | Inherits container | Inherits container | ✅ Converged |
| `throwOnError` | `false` (KaTeX option) | `false` (KaTeX option) | ✅ Converged |

---

### Answer Choice Layout

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Choice container shape | `rounded-xl border px-3 py-2.5` | `rounded-2xl border-2 p-4` | ⚠️ Known drift — student has more padding, rounder corners |
| Letter bubble shape | `h-6 w-6 rounded-full border` | `h-4 w-4 rounded-full border-2` | ⚠️ Known drift — different sizes |
| Letter bubble font | `text-xs font-bold` | `text-xs font-extrabold uppercase` | ⚠️ Known drift — minor |
| Correct answer highlight | Emerald (preview-only, not shown to students) | N/A (hidden) | ✅ Intentional difference |
| Horizontal alignment of letter + text | `flex items-start gap-3` | `flex items-start gap-3` | ✅ Converged |
| Choice text rendering | `MathText` | `MathText` | ✅ Converged |
| Min tap target height | N/A (desktop preview) | `min-h-[52px]` | ⚠️ Intentional — preview is desktop-only |

---

### Stimulus / Passage Rendering

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Stimulus container background | `bg-surface-2/30` | N/A (student runner has no stimulus block) | ❌ Unverified — student runner does not implement stimulus |
| Stimulus label ("Passage context") | Shown in preview | N/A | ❌ Unverified |
| Stimulus text rendering | `MathText` | N/A | ❌ Not implemented in student runner |

> **Gap:** The student runner (`StudentAttemptRunnerContainer`) has no stimulus/passage block. If SAT Reading questions with passage context are added, the stimulus render is a P0 fidelity gap at that time.

---

### Mobile / Responsive Behavior

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Mobile viewport toggle | Implemented (Monitor/Smartphone icons) | N/A (student always uses device native) | ⚠️ Preview simulates with max-width: the simulation may not match real device rendering |
| Touch target sizes | Not implemented | `min-h-[52px]` on choices | ⚠️ Known drift — student optimized for touch |
| Choice tap target height | `py-2.5` in preview | `p-4 min-h-[52px]` in student | ⚠️ Student has larger tap targets |

---

### Explanation Rendering

| Property | Author Preview | Student Render | Status |
|---|---|---|---|
| Explanation visibility | Shown in preview with separator | Shown only post-submission | ✅ Intentional difference |
| Explanation text rendering | `MathText` | N/A (post-submit surface) | ✅ Converged — same `MathText` will apply |
| Math in explanations | `MathText` | Post-submit path (review page) | ⚠️ Review page uses `SafeHtml` + DOMPurify — see below |

---

### Review Page — Known Pipeline Divergence

The review page (`/review/[attemptId]/page.tsx`) uses `SafeHtml` (DOMPurify + MathJax/KaTeX retry) — a **different rendering pipeline** from `MathText`. This is the most significant remaining fidelity gap.

| Aspect | MathText pipeline | SafeHtml pipeline |
|---|---|---|
| Sanitizer | Custom regex allowlist (`prepareRichText`) | DOMPurify |
| Math library | KaTeX via `renderMathInElement` | KaTeX + MathJax fallback |
| Markdown (bold/italic) | Converted via `prepareRichText` | Not converted — shows raw `**text**` |
| HTML tags | Allowlist-stripped then restored | DOMPurify-sanitized (broader allowlist) |

**Impact:** If a student reviews their attempt after submission, `**bold**` markdown in an explanation appears as raw `**bold**` text on the review page, not as bold text. The mathematical rendering is compatible (both use KaTeX for standard SAT notation).

**Resolution path:** Replace `SafeHtml` usages in the review page with `MathText` for choice text and explanation text. This is a Phase 2 task.

---

## Known Intentional Differences

These differences are **deliberate** and should NOT be converged:

| Property | Author Preview | Student Render | Rationale |
|---|---|---|---|
| Correct answer highlighting | Emerald highlight + ✓ icon | No highlight shown during exam | Authors need to verify correct answer mapping |
| Explanation visibility | Always shown | Shown only post-submission | Authors need to review the explanation during authoring |
| "Student preview" header bar | Shown | Not shown | Preview affordance for the author |
| Stimulus context textarea | Editable in right panel | Not editable (not implemented) | Author input surface, not student UI |
| Font sizes | Compact (author is on desktop) | Full-size (student on any device) | Preview is a small right-panel column |
| Choice container padding | Compact `py-2.5` | Full `p-4 min-h-[52px]` | Touch target optimization for students |

---

## Convergence Roadmap

### Phase 1 — Semantic rendering audit ✅ Complete (v2.0)
- ✅ `MathText` shared primitive created
- ✅ Math, bold, italic converged across author preview and student runner
- ✅ Sanitizer hardened and regression-tested
- ✅ Stimulus, prompt, choices, explanation all use `MathText` in preview
- ✅ Student runner uses `MathText` for prompt and choices

### Phase 2 — Review page convergence
Replace `SafeHtml` usages in `/review/[attemptId]/page.tsx` with `MathText` for:
- Question stem / prompt
- Answer choice text
- Explanation text

This eliminates the "markdown shows as raw text on review page" divergence.

**Prerequisite:** Verify that removing DOMPurify's broader HTML allowlist from the review page does not break any existing authored content with HTML tags that MathText's stricter allowlist would strip.

### Phase 3 — Layout convergence (optional)
Align choice container padding, letter bubble size, and font weights between preview and student runner. This is cosmetic — semantic correctness is already achieved.

**Do not begin Phase 3 until Phase 2 is complete.**

---

## How to Keep This Document Current

When any of the following changes, update this document:
1. The student-facing question render component is modified
2. The `SATQuestionPreview` component is modified
3. The KaTeX library version changes
4. New question types are added (boolean, short_text, numeric handling)
5. The stimulus/passage display logic changes
6. `MathText` formatting support changes
7. The review page rendering changes
8. `SafeHtml` is replaced or modified

The person who makes the change is responsible for verifying and updating the relevant row.

---

## File Locations

| Surface | File |
|---|---|
| Author preview | `src/features/assessments/builder/BuilderSetEditorContainer.tsx` — `SATQuestionPreview` function |
| Student runner | `src/features/assessments/containers/StudentAttemptRunnerContainer.tsx` |
| Student MC choices | `src/features/assessments/components/QuestionInputs.tsx` — `MultipleChoiceInput` |
| Review page | `src/app/review/[attemptId]/page.tsx` — uses `SafeHtml` |
| Shared rendering primitive | `src/components/MathText.tsx` |
| Shared rendering governance | `src/components/MATH_TEXT_BOUNDARIES.md` |
| Math rendering utility | `src/lib/mathRender.ts` |
| KaTeX CDN scripts | `src/app/layout.tsx` |
| Security regression tests | `src/components/__tests__/MathText.security.test.ts` |
