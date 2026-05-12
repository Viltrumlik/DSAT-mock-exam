# Semantic Governance Index

> Navigation reference for the **semantic rendering governance** ecosystem.  
> **Goal:** answer "which document explains X?" in 30 seconds.  
> This file contains tables only. For content, follow the links.
>
> **Scope note:** This index covers rendering pipeline governance only (MathText, SafeHtml,
> audit tooling, semantic trust). For product domain architecture (Assessment System vs.
> Pastpaper System, educational identity, domain vocabulary), see `DOMAIN_ARCHITECTURE.md`.

---

## START HERE

Six entry points. Find yours and follow the path directly.

| I am… | Go directly to… |
|---|---|
| New contributor choosing a renderer | `RENDERER_OWNERSHIP_INDEX.md` → Quick Decision Chart (3 min) |
| Debugging a rendering bug | `SEMANTIC_FAILURE_ARCHIVE.md` → search by symptom |
| Confused about SafeHtml vs MathText | `RENDERER_OWNERSHIP_INDEX.md` → SafeHtml Role Clarification |
| Seeing a ⚠ in `audit-rendering.sh` | Check `audit-rendering.sh` Known Intentional Exceptions — it may already be documented |
| Preparing for a major release | `RENDERING_BOUNDARIES.md` → Semantic Resilience Release Rhythm (5 steps, 20 min) |
| Reviewing a rendering-related PR | `RENDERING_BOUNDARIES.md` → Semantic Stewardship PR Review Checklist |

---

## Quick Question → Document Map

| Question | Document | Where exactly |
|---|---|---|
| Which renderer should I use for this surface? | `RENDERER_OWNERSHIP_INDEX.md` | Quick Decision Chart |
| Is this surface in the official inventory? | `SEMANTIC_PIPELINE_INVENTORY.md` | MathText / SafeHtml surfaces tables |
| What are the PR review rules? | `RENDERING_BOUNDARIES.md` | Semantic Stewardship — PR Review Checklist |
| Why does MathText exist / why was X rejected? | `RENDERER_DECISIONS.md` | RDR-001 through RDR-005 |
| When did the rendering pipeline change? | `SEMANTIC_CHANGELOG.md` | Chronological entries with `[INFRASTRUCTURE]`/`[SURFACE]`/`[GOVERNANCE]` tags |
| Why is this content rendering wrong? | `SEMANTIC_FAILURE_ARCHIVE.md` | Failure 1 through 8 by symptom |
| What are the renderer ownership details? | `RENDERER_OWNERSHIP_INDEX.md` | MathText / SafeHtml / MathRenderer sections |
| Is this renderer use correct or incorrect? | `RENDERER_OWNERSHIP_INDEX.md` | "Approved Surfaces" / "Forbidden Surfaces" tables |
| How do I run the semantic audit? | `scripts/audit-rendering.sh` | `--help` or top comment |
| What's the SafeHtml convergence roadmap? | `RENDERING_BOUNDARIES.md` | Convergence Roadmap (Phase 1/2/3) |
| What are the governance minimalism rules? | `RENDERING_BOUNDARIES.md` | Governance Minimalism Protection |
| What are the governance footprint stability rules? | `RENDERING_BOUNDARIES.md` | Governance Footprint Stability Rules |
| What is the governance footprint right now? | `RENDERING_BOUNDARIES.md` | Governance Footprint Watchlist |
| What do I verify before a major release? | `RENDERING_BOUNDARIES.md` | Semantic Resilience Release Rhythm |
| How do I detect stale governance docs? | `SEMANTIC_PIPELINE_INVENTORY.md` | Institutional Memory Staleness Watchlist |
| Should this be a `[INFRASTRUCTURE]`, `[SURFACE]`, or `[GOVERNANCE]` changelog entry? | `SEMANTIC_CHANGELOG.md` | Change Classification table |
| Is this rendering failure known and documented? | `SEMANTIC_FAILURE_ARCHIVE.md` | Search by symptom |
| What are the parity references for the review page? | `RENDERING_BOUNDARIES.md` | Review-Surface Parity References |
| How do I update the surface inventory? | `SEMANTIC_PIPELINE_INVENTORY.md` | Diff Discipline section |

---

## Document Roles at a Glance

| Document | ~Read time | Read first if… | Criticality | Update trigger |
|---|---|---|---|---|
| `RENDERING_BOUNDARIES.md` | 15 min full / 2 min checklist | You are reviewing a PR that touches any rendering surface | **High** — primary governance and PR gate | Per rendering-related PR |
| `RENDERER_OWNERSHIP_INDEX.md` | 3 min | You need to choose between `MathText` and `SafeHtml` for a surface | **High** — consulted on every new surface | When surfaces are added or removed |
| `SEMANTIC_PIPELINE_INVENTORY.md` | 5 min | You need a current snapshot of all surfaces, sanitizers, or fallbacks | **Medium** — structural reference | Per structural pipeline change |
| `SEMANTIC_CHANGELOG.md` | 2 min (scan) | You want to know what changed in the rendering pipeline and when | **Medium** — investigative; skip if the code is clear | Per architectural change |
| `RENDERER_DECISIONS.md` | 8 min | Someone is proposing to change `ALLOWED_INLINE_TAGS`, unify renderers, or revisit a settled architectural question | **Low** — stable by design; rarely consulted | Only on major re-litigation |
| `SEMANTIC_FAILURE_ARCHIVE.md` | 3 min (scan by symptom) | A rendering bug looks familiar or has appeared before | **Medium** — first stop when debugging rendering behavior | When a new repeatable failure is found |
| `SEMANTIC_GOVERNANCE_INDEX.md` | 1 min | You don't know which doc to start with | **High** — entry point only; no governance prose here | When a doc is added, removed, or renamed |

---

## Dependency Map

Which docs reference which. Use when renaming or removing a doc to find all in-bound links.

| Document | References outward to… | Commonly read alongside… |
|---|---|---|
| `RENDERING_BOUNDARIES.md` | `RENDERER_OWNERSHIP_INDEX.md`, `SEMANTIC_PIPELINE_INVENTORY.md`, `SEMANTIC_CHANGELOG.md`, `SEMANTIC_FAILURE_ARCHIVE.md`, `RENDERER_DECISIONS.md` | `RENDERER_OWNERSHIP_INDEX.md` (renderer choice), `audit-rendering.sh` (audit gate) |
| `RENDERER_OWNERSHIP_INDEX.md` | `RENDERING_BOUNDARIES.md`, `RENDERER_DECISIONS.md` | `RENDERING_BOUNDARIES.md` (decision context) |
| `SEMANTIC_PIPELINE_INVENTORY.md` | `SEMANTIC_CHANGELOG.md`, `RENDERING_BOUNDARIES.md` | `SEMANTIC_CHANGELOG.md` (change history for snapshot) |
| `SEMANTIC_FAILURE_ARCHIVE.md` | `audit-rendering.sh` (§N references), `MathText.security.test.ts`, `MathText.semantic.test.ts` | `RENDERING_BOUNDARIES.md` (cleanup safety rules) |
| `RENDERER_DECISIONS.md` | `RENDERING_BOUNDARIES.md` | `RENDERER_OWNERSHIP_INDEX.md` (what the decisions produce) |
| `SEMANTIC_CHANGELOG.md` | — (append-only; no cross-references) | `SEMANTIC_PIPELINE_INVENTORY.md` (snapshot sync) |
| `SEMANTIC_GOVERNANCE_INDEX.md` | All of the above | — (navigation only) |

---

## Governance Footprint Status

Track these metrics. If any threshold is crossed, apply the Governance Footprint Stability
Rules in `RENDERING_BOUNDARIES.md` before adding further artifacts.

| Metric | Current (2026-05-12) | Warning threshold | Status |
|---|---|---|---|
| Governance prose docs (`src/*.md` excluding this file) | 6 | > 6 | ✅ At threshold |
| Navigation-only docs (`SEMANTIC_GOVERNANCE_INDEX.md`) | 1 | > 1 | ✅ OK |
| Audit script sections | 15 | > 15 | ✅ At cap |
| PR review checklist items | 7 | > 8 | ✅ OK |
| Release rhythm steps | 5 | > 5 | ✅ At cap |
| Governance cross-links (docs referencing other docs) | ~18 | > 30 | ✅ OK |
| Avg doc update time for a routine surface change | < 5 min | > 10 min | ✅ OK |

**Note:** `SEMANTIC_GOVERNANCE_INDEX.md` is a navigation-only file (tables, no governance prose). It does not count toward the 6-doc prose threshold.

**How to measure:**
```bash
# Prose doc count (src/ only):
ls src/RENDERING_BOUNDARIES.md src/RENDERER_OWNERSHIP_INDEX.md src/SEMANTIC_PIPELINE_INVENTORY.md \
   src/SEMANTIC_CHANGELOG.md src/RENDERER_DECISIONS.md src/SEMANTIC_FAILURE_ARCHIVE.md | wc -l

# Audit section count:
grep -c "^# ──" scripts/audit-rendering.sh

# Cross-link count (approximate):
grep -oh '[A-Z_]*\.md' src/*.md | wc -l
```

---

## Metric Anti-Gaming Rules

The metrics above are **warning indicators, not success targets.**

Metrics exist to detect when governance has grown beyond utility — not to define what healthy governance looks like.

**Explicitly forbidden:**
- Adding a governance artifact to "fill" a slot and stay within a threshold
- Preserving an obsolete doc to maintain the 6-doc ratio
- Reducing audit quality to stay under the 15-section cap
- Adding checklist items or release steps to reach a "round number"

**The correct relationship with metrics:** a threshold crossed → investigate whether governance has grown beyond utility. A threshold satisfied → not a success condition; the goal is educational trust, not metric health.

If the only reason a governance artifact exists is to preserve a count, delete it.

---

## Governance Ecosystem Entry Points

New contributor path:
1. Read `RENDERER_OWNERSHIP_INDEX.md` Quick Decision Chart (2 min)
2. Run `bash scripts/audit-rendering.sh` — verify all ✓ (1 min)
3. Read `RENDERING_BOUNDARIES.md` PR Review Checklist before merging (3 min)

Debugging a rendering bug:
1. Check `SEMANTIC_FAILURE_ARCHIVE.md` — symptom match? Follow the fix.
2. If not listed: diagnose, fix, then add a new entry if repeatable.

Answering "why does this architecture exist?":
1. `RENDERER_DECISIONS.md` — covers the 5 most-relitigated decisions.
2. `SEMANTIC_CHANGELOG.md` — covers when and why changes were made.

Pre-release semantic verification:
1. Run `RENDERING_BOUNDARIES.md` → Semantic Resilience Release Rhythm (5 steps, ~20 min).
2. Apply `SEMANTIC_PIPELINE_INVENTORY.md` → Institutional Memory Staleness Watchlist if surfaces have changed.
