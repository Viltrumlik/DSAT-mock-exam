/**
 * Studio Primitives — canonical class token strings for the SAT Content Studio.
 *
 * RULE: Every authoring surface MUST import these tokens rather than declaring
 * local variants. Drift between surfaces begins the moment a second definition
 * appears. If you need a different visual treatment, justify it here.
 *
 * Adding a variant: extend the export list with a clearly named constant.
 * Do NOT create parallel local definitions in consuming files.
 *
 * 2026-10-15: the builder took the /ops console's Django-admin dialect (owner: "question builderni
 * opsga styledan ko'chirib builderni ham o'zgartiring") — 13px type, hairline borders, square boxes,
 * `rounded-md` 32px controls, semibold at most. These tokens carry it to every builder surface,
 * editors included; the page/box/table tokens at the end are the /ops pages' own classes.
 */

// ─── Form field label ────────────────────────────────────────────────────────
/**
 * Canonical uppercase section label used above form inputs in all editor panels.
 * Apply via: <label className={STUDIO_FIELD_LABEL}>Field name</label>
 */
export const STUDIO_FIELD_LABEL =
  "mb-1 block text-[12px] font-semibold text-muted-foreground";

// ─── Form input ───────────────────────────────────────────────────────────────
/**
 * Canonical text input / textarea / select class string for studio edit forms.
 * Apply via: <input className={STUDIO_INPUT} />
 *
 * Note: BuilderSetEditorContainer uses a distinct variant (bg-background, py-2.5,
 * shadow-sm) intentionally — the center panel editor has a different visual depth.
 * Do not merge those without an explicit design decision.
 */
export const STUDIO_INPUT =
  "w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

// ─── Section rhythm ───────────────────────────────────────────────────────────
/**
 * Standard vertical spacing between top-level sections on studio pages.
 */
export const STUDIO_SECTION_GAP = "space-y-5";

/**
 * Standard card container — a hairline box on the card background, square like an /ops "module".
 */
export const STUDIO_CARD =
  "overflow-hidden border border-border bg-card";

// ─── Action hierarchy ─────────────────────────────────────────────────────────
/**
 * Primary CTA button — use for the single most important action per surface.
 */
export const STUDIO_BTN_PRIMARY =
  "inline-flex min-h-8 items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 transition-colors";

/**
 * Secondary / ghost button — for auxiliary actions alongside a primary CTA.
 */
export const STUDIO_BTN_SECONDARY =
  "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[13px] font-medium text-foreground hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 transition-colors";

/**
 * Destructive action button — delete, archive. Requires confirm step before use.
 */
export const STUDIO_BTN_DESTRUCTIVE =
  "inline-flex min-h-7 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-[12px] font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50 transition-colors dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";

// ─── Error banner ─────────────────────────────────────────────────────────────
/**
 * Inline error strip — shown below actions that fail (not full-page errors).
 */
export const STUDIO_ERROR_BANNER =
  "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";

// ─── The /ops page dialect (2026-10-15) ───────────────────────────────────────
/** Page title — as /ops: one size above body, semibold. Pair with STUDIO_PAGE_DESC under it. */
export const STUDIO_PAGE_TITLE = "text-lg font-semibold text-foreground";

/** The muted line under a page title. */
export const STUDIO_PAGE_DESC = "mt-0.5 text-[13px] text-muted-foreground";

/** A box's caption bar — the small uppercase title of an /ops "module" (put inside STUDIO_CARD). */
export const STUDIO_BOX_CAPTION =
  "border-b border-border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";

/** A dense list table, as the /ops changelist draws it. Put it in a STUDIO_CARD with `overflow-x-auto`. */
export const STUDIO_TABLE = "w-full border-separate border-spacing-0 text-[13px]";

/** Its header cell. */
export const STUDIO_TH =
  "h-8 whitespace-nowrap border-b border-border bg-card px-2 text-left text-[12px] font-semibold text-muted-foreground";

/** Its body cell: 34px rows on a hairline. Rows take `hover:bg-surface-2` and `[&:last-child>td]:border-b-0`. */
export const STUDIO_TD = "h-[34px] border-b border-border px-2 text-foreground";

/** A compact select / filter control in a toolbar row. */
export const STUDIO_SELECT =
  "h-8 rounded-md border border-border bg-card px-2 text-[13px] text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/** A text link styled as the /ops lists do (blue, underline on hover). */
export const STUDIO_LINK =
  "rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover";
