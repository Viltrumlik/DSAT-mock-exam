# Renderer Ownership Index

> **Purpose:** Single-entry navigation to renderer-specific governance.  
> Read this first when you need to answer: "which renderer should I use?" or  
> "which file/doc is authoritative for renderer X?"
>
> For full surface inventory: see `SEMANTIC_PIPELINE_INVENTORY.md`  
> For decision rules + PR checklist: see `RENDERING_BOUNDARIES.md`  
> For change history: see `SEMANTIC_CHANGELOG.md`  
> For why decisions were made: see `RENDERER_DECISIONS.md`  
> For debugging semantic failures: see `SEMANTIC_FAILURE_ARCHIVE.md`

---

## Renderer 1: `MathText`

**File:** `src/components/MathText.tsx`  
**Architectural status:** Canonical SAT academic content renderer — permanent, expanding  
**Test coverage:** `__tests__/MathText.security.test.ts` (63), `__tests__/MathText.semantic.test.ts` (53)

### Purpose

Renders plain text that may contain KaTeX LaTeX math, bold, italic, superscript,
and subscript. Designed specifically for SAT academic content authored in the
Content Studio textarea model.

Rendering pipeline: `stripDangerousTags` → `applyNewlines` → `applyMarkdown`
→ `dangerouslySetInnerHTML` → KaTeX `renderMathInElement` via `useEffect`.

### Approved Surfaces

All surfaces where content was authored in the Content Studio textarea:

| Surface | Field |
|---|---|
| Student exam prompt | `question.prompt` |
| Student exam choices | `choice.text` |
| Author preview (all fields) | prompt, choices, explanation, stimulusContext |
| Author choice live preview | `choice.text` |
| Review page (all fields) | text, question_prompt, choice text, explanation |

### Forbidden Surfaces

| Forbidden use | Why |
|---|---|
| Content with runtime `<mark>` highlights | `<mark>` is stripped by allowlist — content silently destroyed |
| Legacy admin panel content | Admin uses MathJax; MathText uses KaTeX — not interchangeable |
| Content with `<a>` links that must survive | `<a>` is not allowlisted — links silently removed |
| Content with `<p>`, `<div>`, `<table>` | Block elements stripped — layout destroyed |
| Content from third-party HTML sources | DOMPurify-level sanitization needed; MathText allowlist is too narrow |

### Ownership Rationale

`MathText` is the only approved renderer for SAT academic content because:
1. Its sanitizer is regression-tested with 63 security tests — no other renderer has this guarantee
2. Its pipeline is deterministic: same input always produces the same rendered output
3. KaTeX rendering is scoped per-element (not document-body) — no rendering cross-contamination
4. The 7-tag allowlist is deliberately minimal — every tag has a documented SAT use case

### Convergence Expectations

All new student-facing and author-facing surfaces must use `MathText`.
No plan to replace or supplement `MathText` for these surfaces.
If a new SAT-content field needs `<table>` or `<mark>`, reconsider the content model first.

### Known Risks

- **KaTeX CDN race**: `renderMathInElement` may not be available on first render.
  Mitigated by container-level fallback in `BuilderSetEditorContainer`.
  Long-term fix: migrate KaTeX from CDN script to npm bundle.
- **Allowlist creep**: Tags added without governance review weaken the security model.
  Mitigated by: freeze notice in `MathText.tsx`, DOMPurify migration threshold.

---

## Renderer 2: `SafeHtml`

**File:** `src/components/SafeHtml.tsx`  
**Architectural status:** Permanent specialized renderer (exam) + Legacy bridge (admin)  
**Test coverage:** None — DOMPurify is the tested library; surface behavior tested manually

### Purpose

Renders arbitrary HTML with DOMPurify sanitization. Supports the full DOMPurify
default allowlist (~80 elements), including `<mark>`, `<a>`, `<p>`, `<table>`.
Triggers MathJax `typesetPromise` in a `requestAnimationFrame` after render.

### Approved Surfaces

| Surface | File | Why SafeHtml is correct |
|---|---|---|
| Exam passage / question text | `exam/[attemptId]/page.tsx` | Text-highlight feature injects `<mark>` spans into HTML in state |
| Exam question prompt | `exam/[attemptId]/page.tsx` | Same — `questionPromptHighlights` mutations |
| Exam answer options | `exam/[attemptId]/page.tsx` | Same — `optionHighlights` mutations |
| Admin panel content preview | `admin/page.tsx` | Legacy rich-text HTML; no migration planned |

### Forbidden Surfaces

| Forbidden use | Why |
|---|---|
| Any new student-facing content surface | New surfaces use `MathText` |
| Any new author-facing content surface | New surfaces use `MathText` |
| SAT question stems, choices, explanations | These are MathText surfaces — use `MathText` |
| Convenience rendering bypass ("it's easier") | `SafeHtml` is not a fallback escape hatch |
| Content authored in Content Studio textarea | `MathText` pipeline is the correct path |

### Role Clarification

**`SafeHtml` is not semantic rendering infrastructure.**

`MathText` is the canonical educational renderer. It guarantees that what an author
writes in the Content Studio is what a student sees — identical rendering across
preview, exam, and review surfaces. This is the semantic trust the platform is built on.

`SafeHtml` exists because two legacy surfaces have a structural constraint that makes
`MathText` impossible to use today: **runtime HTML mutation**. The exam page injects
`<mark>` spans directly into the HTML string in component state. `MathText`'s pipeline
is idempotent — it re-runs `prepareRichText` on every render, stripping any `<mark>`
tags injected since the last pass. The mutation is irrecoverably lost. This is not a
policy decision — it is a structural mismatch.

`SafeHtml` serves operational necessity, not educational trust. Any proposal to use
`SafeHtml` on a new surface is a signal that the surface's content model may need
redesign — not that `SafeHtml` should expand.

**Invalid expansion proposals:**

| Proposal | Why it is invalid |
|---|---|
| "The content has HTML tags, so use SafeHtml" | HTML passthrough is not a requirement; it signals a content model problem |
| "MathText's allowlist is too restrictive — SafeHtml is the permissive alternative" | They serve different content classes; SafeHtml is not MathText with fewer restrictions |
| "New rich-text announcement feature needs SafeHtml" | New surfaces use `MathText`; SafeHtml's approved count decreases, never increases |
| "SafeHtml is easier because it passes everything through" | Convenience is explicitly excluded as justification (see `SafeHtml.tsx` Scope Freeze) |
| "The content has `<a>` links, so MathText won't work" | Links are a content model question; the answer is not to use SafeHtml for a new surface |

### Ownership Rationale

**Exam page (Permanent):** The text-highlighting feature stores annotated HTML with
`<mark>` spans in component state. This is a runtime HTML mutation, not a content
authoring model. `MathText`'s allowlist strips `<mark>` unconditionally. `SafeHtml`
is the structurally correct renderer for this surface until the highlighting system
is redesigned to use character offsets.

**Admin page (Legacy Bridge):** Predates MathText. Uses MathJax (not KaTeX). Has a
separate editor toolbar. Not student-facing. No migration is planned or scoped.

### Convergence Expectations

**Exam surface:** Migration to `MathText` requires first redesigning highlight storage
(from HTML mutations → character offsets). Not on the current roadmap.
When ready: see `RENDERING_BOUNDARIES.md` Phase 2 for the migration approach.

**Admin surface:** No migration planned. Stable legacy surface.

**No new surfaces** should ever be added to `SafeHtml`. The approved surface count
is 4; that count should only decrease over time, never increase.

### Known Risks

- **Scope expansion**: `SafeHtml` could become the "easy" renderer for any HTML-adjacent
  content, leading to renderer sprawl. Prevented by: "Forbidden Surfaces" list above,
  the explicit scope freeze in `SafeHtml.tsx`, and audit script §2.
- **MathJax dependency**: Admin surface requires MathJax loaded as a global script.
  If MathJax CDN changes, admin math rendering breaks silently. Not a `SafeHtml` bug —
  it is an admin infrastructure concern.
- **DOMPurify version drift**: DOMPurify default allowlist may change across versions.
  Acceptable for current surfaces (they are already broad-HTML surfaces).

---

## Renderer 3: `MathRenderer` (local admin component)

**File:** `src/app/admin/page.tsx` (defined locally, not exported)  
**Architectural status:** Legacy admin-only component — no expansion, no migration planned  
**Test coverage:** None

### Purpose

Admin-panel math preview component. Applies KaTeX auto-render AND MathJax
`typesetPromise` to a DOM element (by `id`). Supports the admin panel's
pre-MathText authoring workflow.

### Approved Surfaces

Admin content preview panel only (`admin/page.tsx`).

### Forbidden Surfaces

Everywhere else. This component is not exported and must not be moved to shared code.

### Ownership Rationale

The admin panel predates the Content Studio and uses a hybrid KaTeX+MathJax rendering
system. `MathRenderer` is the glue between the admin editor's HTML output and its math
preview. It is not reusable because its design (calling both KaTeX and MathJax on the
same element) is specific to the admin's legacy content model.

### Convergence Expectations

No convergence planned. `MathRenderer` is invisible to students and does not affect
the canonical rendering pipeline.

### Known Risks

- **KaTeX + MathJax dual-call**: Calling both renderers on the same element can cause
  double-rendering if both are available. The admin panel's content model makes this
  acceptable (it was designed for this setup).
- **Direct `renderMathInElement` call**: Bypasses `mathRender.ts` abstraction. Acceptable
  here because the admin panel has its own KaTeX config (different delimiter set).
  Flagged as a known exception in `audit-rendering.sh`.

---

## Quick Decision Chart

```
Content was authored in Content Studio textarea?
  → YES: Use MathText
  → NO: Does it have runtime <mark> highlights?
       → YES: Use SafeHtml (exam surface pattern)
       → NO: Is it legacy admin HTML?
             → YES: Use SafeHtml (admin surface pattern)
             → NO: Stop — should not be rendered without explicit governance decision
```

---

## Document Relationships

```
RENDERER_OWNERSHIP_INDEX.md     ← you are here (navigation + renderer specs)
        ↓
RENDERING_BOUNDARIES.md         ← decision rules, PR checklist, parity references
        ↓
SEMANTIC_PIPELINE_INVENTORY.md  ← point-in-time snapshot (surfaces, sanitizers, fallbacks)
        ↓
SEMANTIC_CHANGELOG.md           ← history of architectural changes (classified by type)
        ↓
RENDERER_DECISIONS.md           ← why specific architectural decisions were made (ADRs)
        ↓
SEMANTIC_FAILURE_ARCHIVE.md     ← real failure classes with cause/fix/prevention
```

**Use case → document:**
- "Which renderer do I use?" → `RENDERER_OWNERSHIP_INDEX.md` (this file)
- "Is this surface in the inventory?" → `SEMANTIC_PIPELINE_INVENTORY.md`
- "What's the PR checklist?" → `RENDERING_BOUNDARIES.md`
- "When did X change?" → `SEMANTIC_CHANGELOG.md`
- "Why was X decided this way?" → `RENDERER_DECISIONS.md`
- "Why is this rendering wrong?" → `SEMANTIC_FAILURE_ARCHIVE.md`
