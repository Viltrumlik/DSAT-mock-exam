# Renderer Decision Records

> Lightweight ADR-style records for architecturally load-bearing renderer decisions.
> These decisions are settled. Re-opening them requires an explicit governance discussion,
> not a PR comment.
>
> Format: Context → Decision → Alternatives Considered → Why Not → Consequence

---

## RDR-001: MathText exists as a dedicated SAT-academic content renderer

**Date:** 2026-05  
**Status:** Active

**Context:**  
SAT academic content (question stems, answer choices, explanations) is authored in textarea
inputs and contains a predictable subset of formatting: KaTeX LaTeX math, bold, italic,
superscript, subscript. This content needed a renderer with a tested, deterministic, and
security-audited pipeline.

**Decision:**  
Create `MathText` as a dedicated React component for SAT-academic content only. Its
sanitizer is a narrow, tested 7-tag allowlist. Its pipeline is: strip → newlines → markdown
→ KaTeX. It does not grow to support general publishing features.

**Alternatives Considered:**
- Use `dangerouslySetInnerHTML` directly at each call site (DOMPurify applied locally)
- Use a general markdown renderer (react-markdown, remark)
- Use `SafeHtml` for all content

**Why Not:**
- Direct `dangerouslySetInnerHTML` at call sites: untestable as a unit; security guarantees
  scattered; no single regression-test target
- General markdown renderer: processes headings, tables, lists, code blocks — semantics we
  explicitly reject for SAT content; adds ~30 KB to bundle; would be a CMS renderer
- `SafeHtml` for all content: DOMPurify default allowlist is too broad for academic content;
  would allow `<a>`, `<table>`, `<h2>` in answer choices; no textarea-authored-content-specific
  semantic contract

**Consequence:**  
All new SAT-academic content surfaces use `MathText`. The component is the single security
and semantic boundary. Its tests are the regression baseline. Do not add general formatting
to it.

---

## RDR-002: SafeHtml is retained as permanent specialized infrastructure

**Date:** 2026-05  
**Status:** Active

**Context:**  
The legacy exam runner's text-highlighting feature stores annotated HTML with `<mark>` spans
in component state. `MathText`'s allowlist strips `<mark>` unconditionally. The admin panel
uses a separate MathJax-based rendering system.

**Decision:**  
Retain `SafeHtml` for exactly two surface classes: (A) the exam runner (permanent — until
highlight storage is redesigned to use character offsets) and (B) the admin panel (legacy
bridge — no migration planned). No new surfaces are added to `SafeHtml`.

**Alternatives Considered:**
- Add `<mark>` to `MathText`'s allowlist
- Remove text-highlighting from the exam runner
- Replace `SafeHtml` with a third renderer that handles both

**Why Not:**
- Add `<mark>` to `MathText`: runtime-injected `<mark>` is programmatic annotation, not
  authored content; mixing programmatic HTML mutation with the Content Studio semantic model
  is a category error; it also creates a precedent for allowlist expansion
- Remove text-highlighting: it is a core exam feature; removing it is out of scope
- Third renderer: introduces renderer sprawl; the problem is the highlight storage model,
  not the renderer; fix the storage first, not the renderer layer

**Consequence:**  
`SafeHtml` surface count is frozen at 4. It can only decrease. See `SafeHtml.tsx` scope
freeze for the explicit forbidden list.

---

## RDR-003: Renderer unification was explicitly rejected

**Date:** 2026-05  
**Status:** Active

**Context:**  
During governance establishment, the option to unify `MathText` and `SafeHtml` into a single
renderer was considered.

**Decision:**  
Rejected. The two renderers serve structurally different content classes and must remain
separate.

**Alternatives Considered:**
- Single renderer with a "mode" parameter: `<ContentRenderer mode="academic" | "legacy" text={...} />`
- Single renderer that detects content type automatically
- Migrate everything to DOMPurify + KaTeX (abandon the 7-tag allowlist)

**Why Not:**
- Mode parameter: a component that behaves differently based on a mode string is two
  components pretending to be one; the semantic contracts are different; the test suites
  are different; merging them increases complexity without reducing surface count
- Auto-detection: content type cannot be reliably inferred from content alone; a question
  stem with `<mark>` could be authored content (wrong) or highlighted (right); decision
  must be made at the call site, not the renderer
- DOMPurify for everything: the 7-tag allowlist is more secure for academic content than
  DOMPurify defaults; abandoning it weakens the security model for the surfaces that benefit
  most from strict sanitization (student-facing content)

**Consequence:**  
`MathText` and `SafeHtml` remain separate with distinct contracts. Any future renderer must
be a new RDR record, not a modification to either existing renderer.

---

## RDR-004: Governance remains lightweight and developer-owned

**Date:** 2026-05  
**Status:** Active

**Context:**  
After establishing semantic governance, there was a risk that it would grow into mandatory
CI gates, approval workflows, and large checklists.

**Decision:**  
Governance is documentation + audit script, not process. No mandatory approvals. No CI
blocking. The developer making a rendering change is responsible for updating the docs.

**Alternatives Considered:**
- CI job that runs `audit-rendering.sh` and fails the build on `⚠` signals
- Required sign-off from a "semantic owner" role on rendering-related PRs
- Automated doc-staleness detection

**Why Not:**
- CI blocking on audit script: false positives in the audit script would block unrelated
  PRs; developers would add exclusions under time pressure rather than fixing the signal;
  the quality of the governance degrades through accumulated exceptions
- Sign-off requirement: creates a bottleneck; the "semantic owner" becomes a single point
  of failure; governance by ownership is fragile when contributors change
- Automated staleness: detects the wrong thing (doc age) rather than the right thing
  (semantic drift); generates noise without improving semantic correctness

**Consequence:**  
Governance is enforced by discipline and culture, not tooling. This is intentional.
The audit script is a developer tool, not a gate. If the script is not being run, the
problem is culture — not a missing CI rule.

---

## RDR-005: SAT-specific scope is a hard constraint, not a preference

**Date:** 2026-05  
**Status:** Active

**Context:**  
As the platform grows, there will be ongoing pressure to add general publishing formatting
features to `MathText`: blockquotes, footnotes, tables for data, callout boxes, styled
headings.

**Decision:**  
`MathText` supports only the formatting that appears in SAT academic content. Additions
require evidence that the formatting is actually used in SAT questions, not just potentially
useful for educational content in general.

**Alternatives Considered:**
- Accept general educational formatting (footnotes, tables, callouts) with evidence of use
- Accept formatting that is "SAT-adjacent" (used in test prep books, not SAT itself)
- Grow `MathText` toward a full academic content renderer (LaTeX-aware full Markdown)

**Why Not:**
- General educational formatting: moves MathText from a semantic boundary to a CMS;
  the value of the narrow allowlist is precisely that it is narrow; every addition makes
  the security model harder to test and reason about
- SAT-adjacent formatting: the scope boundary is SAT content, not "content that could
  appear near SAT questions"; allowing "adjacent" is a permanent invitation to expand
- Full academic renderer: react-markdown + rehype already exists; building toward it
  in MathText would be reinventing it worse, with a custom security model

**Consequence:**  
`MathText` will never support `<blockquote>`, `<table>`, `<h1>`–`<h6>`, `<ul>/<li>`,
`<a>`, or `<img>`. These tags belong in SafeHtml (if HTML passthrough is needed) or in
a separate component purpose-built for that content class. The 7-tag allowlist is frozen.
