#!/usr/bin/env bash
# audit-rendering.sh — Semantic rendering surface inventory for the DSAT frontend.
#
# ── PURPOSE ───────────────────────────────────────────────────────────────────
#
# Surface parallel semantic pipelines and renderer misuse before they become
# permanent. The canonical path is: textarea text → MathText (prepareRichText
# pipeline → KaTeX). Any code that duplicates part of this pipeline outside
# MathText or SafeHtml is a semantic fragmentation risk.
#
# ── SIGNAL QUALITY DOCTRINE ───────────────────────────────────────────────────
#
# This script prefers FALSE NEGATIVES over NOISY FALSE POSITIVES.
#
# A false negative (a real problem that the script misses) is less damaging
# than a false positive that trains developers to ignore the output. Each
# section should flag only what is clearly suspicious, not everything that
# matches a broad pattern. When in doubt, narrow the grep — do not widen it.
#
# Consequence: this script does not catch everything. It catches the patterns
# most likely to introduce semantic fragmentation. Manual review is still
# required for new rendering surfaces.
#
# ── KNOWN INTENTIONAL EXCEPTIONS ─────────────────────────────────────────────
#
# The following usages trigger pattern matches but are explicitly approved.
# Do not remove them from the exclusion lists without updating this manifest.
#
# Exception 1: exam/[attemptId]/page.tsx — SafeHtml + newline transforms
#   Reason: Text highlighting feature stores annotated HTML with <mark> in state.
#   MathText cannot be used here until highlight storage is redesigned.
#   Approved by: RENDERING_BOUNDARIES.md SafeHtml Surface A.
#   Grep exclusion: 'exam/\[attemptId\]' in §2, §6, §8.
#
# Exception 2: admin/page.tsx — SafeHtml + MathRenderer + MathJax + newline transforms
#   Reason: Legacy admin surface with its own rendering system. Not student-facing.
#   No migration planned. Stable but architecturally distinct from the Content Studio.
#   Approved by: RENDERING_BOUNDARIES.md SafeHtml Surface B.
#   Grep exclusion: 'admin/page' in §2, §5, §6, §8, §12.
#
# Exception 3: src/components/MathText.tsx — applyNewlines function
#   Reason: This IS the canonical newline→<br> implementation. It should not
#   flag itself as a duplicate.
#   Grep exclusion: 'MathText\.tsx' in §8.
#
# Exception 4: src/lib/mathRender.ts — renderMathInElement call
#   Reason: This is the single abstraction layer for KaTeX. It is the approved
#   location for calling window.renderMathInElement.
#   Grep exclusion: 'mathRender\.ts' in §11.
#
# Exception 5: register/page.tsx, login/page.tsx, TelegramLoginButton.tsx — .innerHTML = ""
#   Reason: Empty-string innerHTML assignments are DOM-clearing operations for third-party
#   widget mount points (Google Sign-In button, Telegram Login). Not HTML injection.
#   Grep exclusion: '= ""' filter in §13.
#
# Exception 6: src/components/MathText.tsx — DOMPurify doc comment references
#   Reason: MathText.tsx mentions DOMPurify as a future migration path in comments.
#   Not an actual DOMPurify import or usage.
#   Grep exclusion: 'MathText\.tsx' in §14.
#
# ── ADDING A NEW EXCLUSION ────────────────────────────────────────────────────
#
# Before adding a grep exclusion pattern:
#   1. Confirm the usage is intentional (not a mistake or shortcut)
#   2. Add an entry to the "Known Intentional Exceptions" manifest above
#   3. Document: reason, what doc approves it, which sections it affects
#   4. If you cannot write a one-sentence reason, the exclusion is wrong
#
# ── REPLACING AN EXISTING SECTION (15-SECTION CAP) ───────────────────────────
#
# The 15-section cap is hard. Adding a new section requires removing or merging
# an existing one. Before proposing a new section:
#
#   1. IDENTIFY THE REPLACEMENT: Which existing section is this new one worth
#      more than? No clear answer = the new section is not yet needed.
#
#   2. REAL PATTERN TEST: Has this drift pattern actually occurred in this
#      codebase? Purely theoretical risks belong in RENDERING_BOUNDARIES.md,
#      not in the audit script. Audit sections earn their place by catching
#      real problems, not by covering hypothetical ones.
#
#   3. ACTIONABILITY TEST: Can a developer fix the finding in under 5 minutes?
#      If the fix requires an architectural decision, the section is surfacing
#      a design conversation — document it in RENDERING_BOUNDARIES.md instead.
#
#   4. MERGE PREFERENCE: Can the new pattern be added as a grep line inside
#      an existing section? Two related checks in one section cost nothing;
#      a new section consumes a navigation slot and increases script maintenance.
#
#   5. REPLACEMENT EXECUTION: Delete the outgoing section entirely. Do not
#      comment it out or preserve it "just in case." Remove its exceptions
#      from the manifest above. Update any §N cross-references in this header
#      and in RENDERING_BOUNDARIES.md. Stale sections decay signal quality.
#
# ── LONG-TERM STABILITY DOCTRINE ─────────────────────────────────────────────
#
# This script works because it is simple. Protect that simplicity.
#
# Approved future evolution:
#   - New grep patterns added to existing sections (free — no cap impact)
#   - Exclusion pattern updates when components are renamed
#   - Section replacements under the 15-section cap (see protocol above)
#
# Prohibited future directions:
#   - AST or TypeScript parsing (adds build dependency; breaks on TSX syntax changes)
#   - Semantic analysis engines (cost far exceeds grep signal value)
#   - CI gate integration (audit findings are informational, not blockers)
#   - Auto-fix capabilities (automated renderer changes are high semantic risk)
#   - Scoring or grading systems (invites metric gaming; obscures real signals)
#
# This script must remain:
#   - Runnable in < 10 seconds with no build step
#   - Understandable by reading the grep patterns directly
#   - Independent of Node.js, TypeScript, or test runners
#   - Fixable: every finding should be resolvable by one developer in < 1 hour
#
# If a proposed addition violates any of the above, document it in
# RENDERING_BOUNDARIES.md instead. Not every drift risk needs an audit section.
#
# ── USAGE ─────────────────────────────────────────────────────────────────────
#
# Run from the frontend/ directory: bash scripts/audit-rendering.sh [src-path]
# Default scan root: src/
#
# Run before major frontend releases and after any rendering-related PR.
# All 7 signal checks (✓/⚠ lines) should be ✓ at merge time.
#
# Exit codes: 0 = scan complete (findings are informational, not errors)
#
# Update RENDERING_BOUNDARIES.md whenever this script surfaces new usages
# that do not appear in the inventory table.

set -euo pipefail

ROOT="${1:-src}"
BOLD="\033[1m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
GREEN="\033[32m"
RESET="\033[0m"

divider() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

header() {
  echo ""
  divider
  printf "${BOLD}${CYAN}%s${RESET}\n" "$1"
  divider
}

count_grep() {
  # Returns count of files matching a pattern (0 if none).
  grep -rl "$1" "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null | wc -l | tr -d ' '
}

list_grep() {
  # Lists files + first matching line for each file.
  grep -rn "$1" "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null || true
}

echo ""
printf "${BOLD}DSAT Rendering Surface Audit${RESET} — $(date '+%Y-%m-%d %H:%M:%S')\n"
printf "Scanning: %s/\n" "$(pwd)/$ROOT"

# ── 1. MathText usages ───────────────────────────────────────────────────────

header "1. MathText usages (canonical SAT academic content renderer)"

echo ""
printf "${GREEN}Import sites:${RESET}\n"
list_grep 'from.*MathText'

echo ""
printf "${GREEN}JSX usages (<MathText):${RESET}\n"
list_grep '<MathText'

# ── 2. SafeHtml usages ──────────────────────────────────────────────────────

header "2. SafeHtml usages (intentionally retained — see SafeHtml.tsx header)"

echo ""
printf "${YELLOW}Import sites:${RESET}\n"
list_grep 'from.*SafeHtml'

echo ""
printf "${YELLOW}JSX usages (<SafeHtml):${RESET}\n"
list_grep '<SafeHtml'

# ── 3. dangerouslySetInnerHTML ───────────────────────────────────────────────

header "3. dangerouslySetInnerHTML usages (all must be accounted for)"

printf "${YELLOW}Sites:${RESET}\n"
list_grep 'dangerouslySetInnerHTML'

echo ""
DANGEROUS_COUNT=$(count_grep 'dangerouslySetInnerHTML')
MATHTEXT_DANGEROUS=$(grep -rn 'dangerouslySetInnerHTML' "$ROOT/components/MathText.tsx" 2>/dev/null | wc -l | tr -d ' ')
SAFEHTML_DANGEROUS=$(grep -rn 'dangerouslySetInnerHTML' "$ROOT/components/SafeHtml.tsx" 2>/dev/null | wc -l | tr -d ' ')
UNACCOUNTED=$((DANGEROUS_COUNT - 2))  # MathText.tsx + SafeHtml.tsx are expected

if [ "$UNACCOUNTED" -gt 0 ]; then
  printf "${RED}⚠  %d file(s) use dangerouslySetInnerHTML outside of MathText and SafeHtml.${RESET}\n" "$UNACCOUNTED"
  printf "   Each must be documented in RENDERING_BOUNDARIES.md or migrated.\n"
else
  printf "${GREEN}✓  All dangerouslySetInnerHTML usages are inside the approved renderers.${RESET}\n"
fi

# ── 4. renderMath / KaTeX calls ─────────────────────────────────────────────

header "4. renderMath / KaTeX calls (should be inside MathText or documented safety nets)"

printf "${CYAN}renderMath calls:${RESET}\n"
list_grep 'renderMath'

echo ""
printf "${CYAN}renderMathInElement calls (direct KaTeX):${RESET}\n"
list_grep 'renderMathInElement'

echo ""
printf "${CYAN}Auto-render KaTeX imports:${RESET}\n"
list_grep 'auto-render'

# ── 5. MathJax usages ───────────────────────────────────────────────────────

header "5. MathJax usages (expected only in SafeHtml.tsx, exam page, admin page)"

printf "${YELLOW}MathJax references:${RESET}\n"
list_grep 'MathJax'

# ── 6. Stale mathjax-process class ──────────────────────────────────────────

header "6. 'mathjax-process' CSS class usages"
printf "(Expected in exam/[attemptId]/page.tsx and admin/page.tsx — SafeHtml surfaces)\n"
printf "(Any occurrence in a MathText surface is stale and must be removed)\n\n"

STALE=$(grep -rn 'mathjax-process' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
if [ -z "$STALE" ]; then
  printf "${GREEN}✓  No mathjax-process class usages found.${RESET}\n"
else
  # Split into expected (exam/admin) and unexpected
  UNEXPECTED=$(echo "$STALE" | grep -v 'exam/\[attemptId\]\|admin/page' || true)
  EXPECTED=$(echo "$STALE" | grep 'exam/\[attemptId\]\|admin/page' || true)

  if [ -n "$EXPECTED" ]; then
    printf "${YELLOW}Expected (SafeHtml surfaces — retain):${RESET}\n"
    echo "$EXPECTED"
    echo ""
  fi

  if [ -n "$UNEXPECTED" ]; then
    printf "${RED}⚠  Unexpected mathjax-process usages (outside SafeHtml surfaces — likely stale):${RESET}\n"
    echo "$UNEXPECTED"
  else
    printf "${GREEN}✓  All mathjax-process usages are in expected SafeHtml surfaces.${RESET}\n"
  fi
fi

# ── 7. Raw text renders in student/author surfaces ───────────────────────────

header "7. Raw text renders — audit any new {q.prompt} or {c.text} bare expressions"
printf "(Intentional raw renders in list/index contexts are documented in RENDERING_BOUNDARIES.md)\n\n"

printf "${YELLOW}Possible raw prompt renders:${RESET}\n"
grep -rn '{[^}]*\.prompt[^}]*}' "$ROOT" --include="*.tsx" 2>/dev/null \
  | grep -v 'MathText\|SafeHtml\|//\|test\|\.test\.' || printf "  (none found)\n"

echo ""
printf "${YELLOW}Possible raw choice text renders:${RESET}\n"
grep -rn '{[^}]*\.text[^}]*}' "$ROOT" --include="*.tsx" 2>/dev/null \
  | grep -v 'MathText\|SafeHtml\|//\|test\|\.test\.\|className\|placeholder\|title\|label\|toast\|router\|href\|src\|alt\|aria' \
  | grep -v 'set[A-Z]\|useState\|useRef\|import\|typeof\|JSON\|console\|return.*text.*=\|const.*text\|let.*text' \
  || printf "  (none found)\n"

# ── 8. Parallel newline transforms ──────────────────────────────────────────
#
# RISK: Duplicating applyNewlines from prepareRichText.
# MathText's pipeline already converts \n → <br> inside prepareRichText.
# Calling .replace(/\n/g, "<br") BEFORE passing text to <MathText> will
# double-convert newlines (producing redundant <br> elements).
# Expected: exam/[attemptId]/page.tsx and admin/page.tsx (SafeHtml surfaces,
#   where the conversion is correct and intentional).
# Unexpected: any file that passes the result to MathText.

header "8. Parallel newline transforms (.replace to <br>) — parallel pipeline risk"
printf "(Expected: SafeHtml surfaces only — exam page and admin page)\n"
printf "(Unexpected: any file calling this before MathText — duplicates prepareRichText)\n\n"

NL_ALL=$(grep -rn '\.replace.*\\n.*br\|replace.*newline.*br' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null || true)
if [ -z "$NL_ALL" ]; then
  printf "${GREEN}✓  No .replace(\\n → <br>) calls found.${RESET}\n"
else
  # MathText.tsx itself contains applyNewlines — that is the canonical definition, not a duplicate.
  NL_UNEXPECTED=$(echo "$NL_ALL" | grep -v 'exam/\[attemptId\]\|admin/page\|SafeHtml\|MathText\.tsx\|//\|\.test\.' || true)
  NL_EXPECTED=$(echo "$NL_ALL" | grep 'exam/\[attemptId\]\|admin/page' || true)

  if [ -n "$NL_EXPECTED" ]; then
    printf "${YELLOW}Expected (SafeHtml surfaces — retain):${RESET}\n"
    echo "$NL_EXPECTED"
    echo ""
  fi

  if [ -n "$NL_UNEXPECTED" ]; then
    printf "${RED}⚠  Unexpected newline→<br> transforms (outside SafeHtml surfaces):${RESET}\n"
    printf "   If any of these pass text to <MathText>, remove them — prepareRichText handles it.\n"
    echo "$NL_UNEXPECTED"
  else
    printf "${GREEN}✓  All newline transforms are in expected SafeHtml surfaces.${RESET}\n"
  fi
fi

# ── 9. Inline markdown transforms ───────────────────────────────────────────
#
# RISK: Duplicating applyMarkdown from prepareRichText.
# If a helper function applies **bold** or *italic* regex outside of MathText,
# there is a parallel markdown pipeline. Double-applying produces <b><b>text</b></b>.
# Expected: the two regex patterns inside MathText.tsx itself (applyMarkdown).
# Unexpected: any other .ts/.tsx file with bold/italic regex patterns.

header "9. Inline markdown transforms — duplicate applyMarkdown risk"
printf "(Expected: MathText.tsx applyMarkdown only — no other files should parse **bold**)\n\n"

# Look for lines that contain a regex literal with asterisk patterns used in replace() —
# i.e., the bold (**text**) or italic (*text*) patterns being transformed outside MathText.
# Pattern: .replace( followed by a regex containing \* or \*\* — the telltale sign of
# a markdown bold/italic transform. Excludes comments and test files.
MD_REGEX=$(grep -rn '\.replace(/[^/]*\\\*\|\.replace(/\*\*\|\.replace(/(?<' \
  "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v '//\|\.test\.\|MathText\.tsx' || true)

if [ -z "$MD_REGEX" ]; then
  printf "${GREEN}✓  No duplicate markdown transform patterns found.${RESET}\n"
else
  printf "${RED}⚠  Possible duplicate markdown transforms outside MathText:${RESET}\n"
  printf "   If these transform **bold** or *italic*, consolidate into MathText prepareRichText.\n"
  echo "$MD_REGEX"
fi

# ── 10. Ad-hoc dangerouslySetInnerHTML outside renderers ────────────────────
#
# RISK: Untracked raw HTML injection bypassing both MathText and SafeHtml.
# Every dangerouslySetInnerHTML in the codebase must route through one of the
# two approved renderers. Direct usage is a security and semantic gap.

header "10. Ad-hoc dangerouslySetInnerHTML outside approved renderers"
printf "(Approved: MathText.tsx, SafeHtml.tsx — all others require documentation)\n\n"

RAW_HTML=$(grep -rn 'dangerouslySetInnerHTML' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v 'MathText\.tsx\|SafeHtml\.tsx\|//\|\.test\.' || true)

if [ -z "$RAW_HTML" ]; then
  printf "${GREEN}✓  No ad-hoc dangerouslySetInnerHTML outside approved renderers.${RESET}\n"
else
  printf "${RED}⚠  Ad-hoc dangerouslySetInnerHTML found outside MathText/SafeHtml:${RESET}\n"
  printf "   Each must be migrated to MathText or SafeHtml, or documented in RENDERING_BOUNDARIES.md.\n"
  echo "$RAW_HTML"
fi

# ── 11. Direct renderMathInElement calls outside mathRender.ts ──────────────
#
# RISK: Bypassing the mathRender.ts abstraction layer (which centralizes KaTeX
# config) with direct window.renderMathInElement calls. Admin page is expected.

header "11. Direct renderMathInElement calls (outside mathRender.ts abstraction)"
printf "(Expected: mathRender.ts is the only file that should call renderMathInElement directly)\n"
printf "(Admin page has its own legacy KaTeX call — documented in RENDERING_BOUNDARIES.md)\n\n"

DIRECT_KATEX=$(grep -rn 'renderMathInElement\b' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v 'mathRender\.ts\|admin/page\|//\|\.test\.' || true)

if [ -z "$DIRECT_KATEX" ]; then
  printf "${GREEN}✓  No direct renderMathInElement calls outside mathRender.ts and admin page.${RESET}\n"
else
  printf "${RED}⚠  Direct renderMathInElement calls found — use renderMath() from mathRender.ts instead:${RESET}\n"
  echo "$DIRECT_KATEX"
fi

# ── 12. Custom KaTeX-like wrapper components ────────────────────────────────
#
# RISK: A developer creates a "MathDisplay", "LatexText", "KatexRenderer" etc.
# component that duplicates MathText's role. Renderer sprawl.

header "12. Custom KaTeX/math wrapper components — renderer sprawl risk"
printf "(Expected: MathText.tsx only for new surfaces)\n"
printf "(admin/page.tsx MathRenderer is a known legacy component — documented exception)\n\n"

CUSTOM_WRAPPERS=$(grep -rn 'KatexRender\|LatexText\|MathDisplay\|MathRender\|MathRenderer\|renderLatex\|TexRenderer\|KaTeXComponent' \
  "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v 'admin/page\|SafeHtml\.tsx\|\.test\.' || true)

if [ -z "$CUSTOM_WRAPPERS" ]; then
  printf "${GREEN}✓  No custom KaTeX wrapper components found outside approved surfaces.${RESET}\n"
else
  # admin/page.tsx exclusion is applied above; SafeHtml.tsx exclusion catches doc references
  CUSTOM_UNEXPECTED=$(echo "$CUSTOM_WRAPPERS" || true)
  CUSTOM_EXPECTED=""

  if [ -n "$CUSTOM_EXPECTED" ]; then
    printf "${YELLOW}Expected (admin legacy renderer — retain, do not migrate):${RESET}\n"
    echo "$CUSTOM_EXPECTED"
    echo ""
  fi

  if [ -n "$CUSTOM_UNEXPECTED" ]; then
    printf "${RED}⚠  Custom KaTeX-like wrapper components outside admin page — consolidate into MathText:${RESET}\n"
    echo "$CUSTOM_UNEXPECTED"
  else
    printf "${GREEN}✓  All custom math wrappers are in the expected legacy admin surface.${RESET}\n"
  fi
fi

# ── 13. Direct .innerHTML assignments — renderer bypass risk ─────────────────
#
# RISK: Direct .innerHTML assignment bypasses both MathText and SafeHtml,
# skipping DOMPurify sanitization and KaTeX rendering entirely.
# Expected: none outside approved renderers.
# (MathText and SafeHtml both use dangerouslySetInnerHTML, not .innerHTML directly.)

header "13. Direct .innerHTML assignments (renderer bypass — should be zero)"
printf "(dangerouslySetInnerHTML is the React-approved path; .innerHTML bypasses React)\n\n"

# Exception: `.innerHTML = ""` is a safe DOM-clearing pattern (Google/Telegram mount points).
# Only flag non-empty innerHTML assignments — those are genuine injection risks.
INNER_HTML=$(grep -rn '\.innerHTML\s*=' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v '= ""' \
  | grep -v '//\|\.test\.\|dangerouslySetInnerHTML\|MathText\.tsx\|SafeHtml\.tsx' || true)

if [ -z "$INNER_HTML" ]; then
  printf "${GREEN}✓  No non-empty direct .innerHTML assignments found.${RESET}\n"
else
  printf "${RED}⚠  Direct .innerHTML assignments with content — migrate to MathText or SafeHtml:${RESET}\n"
  printf "   Direct .innerHTML bypasses React's reconciler and skips DOMPurify sanitization.\n"
  echo "$INNER_HTML"
fi

# ── 14. Local DOMPurify calls outside SafeHtml.tsx ───────────────────────────
#
# RISK: A developer imports DOMPurify directly at a call site, creating a
# parallel sanitizer that is not governed by SafeHtml's ownership doctrine.
# Expected: DOMPurify used only inside SafeHtml.tsx.

header "14. Local DOMPurify calls outside SafeHtml.tsx (parallel sanitizer risk)"
printf "(DOMPurify should only be called inside SafeHtml.tsx)\n\n"

# MathText.tsx mentions DOMPurify in doc comments as a migration threshold reference — exclude.
LOCAL_PURIFY=$(grep -rn 'DOMPurify\|dompurify' "$ROOT" --include="*.tsx" --include="*.ts" 2>/dev/null \
  | grep -v 'SafeHtml\.tsx\|MathText\.tsx\|//\|\.test\.' || true)

if [ -z "$LOCAL_PURIFY" ]; then
  printf "${GREEN}✓  No local DOMPurify usage outside SafeHtml.tsx.${RESET}\n"
else
  printf "${RED}⚠  Local DOMPurify usage found outside SafeHtml.tsx:${RESET}\n"
  printf "   Consolidate into SafeHtml or document why a parallel sanitizer is necessary.\n"
  echo "$LOCAL_PURIFY"
fi

# ── 15. Summary ───────────────────────────────────────────────────────────────
#
# AUDIT SCRIPT CAPACITY NOTE: This script is at 15 sections — the stated maximum.
# Future additions must replace an existing section, not extend the count.
# Preference: merge low-signal sections before adding new ones.

header "15. Summary counts"

MATHTEXT_FILES=$(count_grep '<MathText')
SAFEHTML_FILES=$(count_grep '<SafeHtml')
RENDERMATCH_FILES=$(count_grep 'renderMath')
MATHJAX_FILES=$(count_grep 'MathJax')

printf "  MathText JSX usages:           %s file(s)\n" "$MATHTEXT_FILES"
printf "  SafeHtml JSX usages:           %s file(s)\n" "$SAFEHTML_FILES"
printf "  renderMath calls:              %s file(s)\n" "$RENDERMATCH_FILES"
printf "  MathJax references:            %s file(s)\n" "$MATHJAX_FILES"
printf "  dangerouslySetInnerHTML total: %s file(s)\n" "$DANGEROUS_COUNT"

echo ""
printf "Cross-reference with ${BOLD}src/RENDERING_BOUNDARIES.md${RESET} to verify all surfaces are inventoried.\n"
echo ""
divider
echo ""
