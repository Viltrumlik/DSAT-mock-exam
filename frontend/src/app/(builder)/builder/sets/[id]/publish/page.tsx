"use client";

/**
 * Publish Surface — /builder/sets/[id]/publish
 *
 * DESIGN INTENT:
 *   Publishing is an irreversible governance event. This page is intentionally
 *   distinct from the editor — it is not an "edit and save" flow. It is a
 *   deliberate, one-way transition from DRAFT → PUBLISHED.
 *
 * WHAT THIS PAGE DOES:
 *   1. Pre-publish validation checklist — calls GET /validate-publish/ to run the
 *      full server-side validation pipeline (title, category, MC structure, correct
 *      answers, duplicate orders, points, etc.). All blocking checks must pass
 *      before the publish button is enabled.
 *   2. Publish impact summary — what this set contains and what changes.
 *   3. Immutability acknowledgement — user must explicitly confirm they understand
 *      the content will be locked.
 *   4. Publish action — calls POST /publish/ to create an immutable
 *      AssessmentSetVersion snapshot.
 *
 * VALIDATION ARCHITECTURE:
 *   Server-side via AdminValidatePublishView (dry-run, no side effects).
 *   The same validator runs inside the publish transaction — what passes here
 *   will pass at publish time. On API failure the page degrades gracefully:
 *   the publish button stays disabled and an error is shown with a Retry option.
 *
 * GOVERNANCE INVARIANTS ENFORCED (mirroring backend):
 *   - INV-001: A set with zero active questions cannot be published.
 *   - INV-002: A set without a title cannot be published.
 *   - INV-003: A set without a category cannot be published.
 *   - INV-004: Any blocking validation finding prevents publish.
 *   - INV-005: Publishing is the point of no return — user must acknowledge
 *              immutability before the action is available.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import type { PublishValidationReport, ValidationFinding } from "@/features/assessmentsAdmin/api";
import { StateTag, VersionChip } from "@/components/governance";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock,
  ChevronLeft,
  Send,
  ShieldAlert,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Publish action ───────────────────────────────────────────────────────────

/**
 * publishSet — the single integration point for the publish action.
 *
 * Calls POST /assessments/admin/sets/{id}/publish/ which:
 *   1. Validates preconditions inside the atomic transaction
 *   2. Builds an immutable AssessmentSetVersion snapshot
 *   3. Returns HTTP 201 (new version) or 200 (identical content, idempotent)
 *
 * Throws on 400 (validation failure) or other non-2xx errors.
 */
async function publishSet(setId: number): Promise<void> {
  const { default: api } = await import("@/lib/api");
  const res = await api.post(`/assessments/admin/sets/${setId}/publish/`);
  if (res.status !== 200 && res.status !== 201) {
    const detail = res.data?.detail ?? "Publish failed.";
    throw new Error(detail);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

type CheckRow = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  blocker: boolean;
  questionId?: number;
};

/**
 * Convert a server PublishValidationReport into display rows.
 *
 * The server only returns *findings* (things that failed). We synthesise
 * "passed" rows for the most user-visible checks so the checklist always
 * shows a complete picture rather than just a list of failures.
 */
function buildCheckRows(
  set: AssessmentSet,
  report: PublishValidationReport,
): CheckRow[] {
  const findingsByCode = new Map<string, ValidationFinding>();
  for (const f of report.findings) {
    findingsByCode.set(f.code, f);
  }

  const blockingFindings = report.findings.filter((f) => f.severity === "blocking");
  const warningFindings = report.findings.filter((f) => f.severity === "warning");

  const rows: CheckRow[] = [];

  // ── Named checks — always shown, pass/fail based on server finding ──────────

  const titleFinding = findingsByCode.get("missing_title");
  rows.push({
    id: "has_title",
    label: "Set has a title",
    detail: titleFinding
      ? titleFinding.message
      : `Title: "${set.title?.trim()}"`,
    passed: !titleFinding,
    blocker: true,
  });

  const categoryFinding = findingsByCode.get("missing_category");
  rows.push({
    id: "has_category",
    label: "Set has a category",
    detail: categoryFinding
      ? categoryFinding.message
      : `Category: "${set.category?.trim()}"`,
    passed: !categoryFinding,
    blocker: true,
  });

  const noQsFinding = findingsByCode.get("no_active_questions");
  const activeCount = (set.questions ?? []).filter((q) => q.is_active).length;
  const totalCount = (set.questions ?? []).length;
  rows.push({
    id: "has_active_questions",
    label: "Has at least one active question",
    detail: noQsFinding
      ? noQsFinding.message
      : activeCount < totalCount
      ? `${activeCount} active of ${totalCount} total — ${totalCount - activeCount} inactive question${totalCount - activeCount === 1 ? "" : "s"} will NOT be in the snapshot.`
      : `${activeCount} active question${activeCount === 1 ? "" : "s"} — all will be snapshotted.`,
    passed: !noQsFinding,
    blocker: true,
  });

  // ── Question-structure blocking findings — shown as individual rows ─────────

  const handledCodes = new Set(["missing_title", "missing_category", "no_active_questions"]);

  for (const f of blockingFindings) {
    if (handledCodes.has(f.code)) continue;
    rows.push({
      id: `blocking_${f.code}_${f.question_id ?? ""}`,
      label: f.question_id
        ? `Question #${f.question_id}: structural issue`
        : "Content issue",
      detail: f.message,
      passed: false,
      blocker: true,
      questionId: f.question_id,
    });
  }

  // ── Warning findings (advisory, not blocking) ────────────────────────────────

  for (const f of warningFindings) {
    rows.push({
      id: `warning_${f.code}_${f.question_id ?? ""}`,
      label: f.question_id
        ? `Question #${f.question_id}: advisory`
        : "Recommendation",
      detail: f.message,
      passed: false,
      blocker: false,
      questionId: f.question_id,
    });
  }

  // ── Snapshot structure check ─────────────────────────────────────────────────

  const snapFinding = findingsByCode.get("snapshot_structure_invalid");
  if (snapFinding) {
    rows.push({
      id: "snapshot_structure",
      label: "Snapshot structure valid",
      detail: snapFinding.message,
      passed: false,
      blocker: true,
    });
  } else if (blockingFindings.length === 0) {
    // Only show this reassurance row when everything passes
    rows.push({
      id: "snapshot_ready",
      label: "Ready to snapshot",
      detail: `${activeCount} question${activeCount === 1 ? "" : "s"} will be locked into an immutable version.`,
      passed: true,
      blocker: false,
    });
  }

  return rows;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PublishPage() {
  const params = useParams();
  const router = useRouter();
  const setId = Number(params.id);

  const [set, setSet] = useState<AssessmentSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Validation state
  const [validating, setValidating] = useState(false);
  const [validationReport, setValidationReport] = useState<PublishValidationReport | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Publish state
  const [acknowledged, setAcknowledged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  // ── Load set ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!setId || isNaN(setId)) {
      setLoadError("Invalid set ID.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await assessmentsAdminApi.getSet(setId);
        if (!cancelled) setSet(data);
      } catch {
        if (!cancelled) setLoadError("Could not load assessment set.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setId]);

  // ── Validate (server-side, non-destructive) ────────────────────────────────
  const runValidation = useCallback(async () => {
    if (!setId || isNaN(setId)) return;
    setValidating(true);
    setValidationError(null);
    try {
      const report = await assessmentsAdminApi.validatePublish(setId);
      setValidationReport(report);
    } catch {
      setValidationError(
        "Validation check failed — could not reach the server. Fix connection issues and retry.",
      );
      setValidationReport(null);
    } finally {
      setValidating(false);
    }
  }, [setId]);

  // Auto-trigger validation once the set is loaded (and it's not already published)
  useEffect(() => {
    if (set && !set.is_active) {
      runValidation();
    }
  }, [set, runValidation]);

  // Reset acknowledged if the user re-runs validation (content may have changed)
  const handleRevalidate = () => {
    setAcknowledged(false);
    setPublishError(null);
    runValidation();
  };

  // ── Derived display state ──────────────────────────────────────────────────
  const checkRows: CheckRow[] =
    set && validationReport ? buildCheckRows(set, validationReport) : [];

  const blockerRows = checkRows.filter((c) => c.blocker && !c.passed);
  const advisoryRows = checkRows.filter((c) => !c.blocker && !c.passed);
  const isPublishable = validationReport?.is_publishable ?? false;

  const canPublish =
    !loading &&
    !loadError &&
    !validating &&
    !validationError &&
    isPublishable &&
    acknowledged &&
    !publishing;

  // ── Publish handler ────────────────────────────────────────────────────────
  async function handlePublish() {
    if (!canPublish || !set) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishSet(setId);
      setPublished(true);
      setTimeout(() => router.push(`/builder/sets/${setId}`), 2000);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Publish failed. Please try again.";
      setPublishError(msg);
    } finally {
      setPublishing(false);
    }
  }

  // ── Post-publish success screen ────────────────────────────────────────────
  if (published) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center px-4">
        <div className="rounded-full bg-emerald-100 p-5">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Published</h1>
          <p className="mt-2 text-muted-foreground max-w-sm">
            <strong className="text-foreground">{set?.title}</strong> is now
            live. It is immutable — any future changes require creating a new
            revision.
          </p>
        </div>
        <StateTag state="PUBLISHED" size="md" />
        <p className="text-sm text-muted-foreground">Redirecting to editor…</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href={`/builder/sets/${setId}`}
        className="inline-flex items-center gap-1.5 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to editor
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
          Publish assessment
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Review all checks before publishing. This action is permanent.
        </p>
      </div>

      {/* Loading set */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {/* Load error */}
      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {loadError}
        </div>
      )}

      {/* Already published */}
      {set?.is_active && !loading && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-emerald-900">Already published</p>
              <p className="mt-0.5 text-sm text-emerald-800">
                This assessment set is already live. To make changes, edit the
                set and a new revision will be tracked. Historical assignments
                are unaffected.
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <StateTag state="PUBLISHED" size="sm" />
            <VersionChip version={1} isCurrent />
          </div>
        </div>
      )}

      {set && !loading && !set.is_active && (
        <>
          {/* Set summary card */}
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-extrabold text-foreground text-lg leading-tight">
                  {set.title || (
                    <span className="text-muted-foreground italic">
                      Untitled
                    </span>
                  )}
                </p>
                {set.category && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {set.category}
                  </p>
                )}
              </div>
              <StateTag state="DRAFT" size="sm" />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-lg font-extrabold tabular-nums text-foreground">
                  {(set.questions ?? []).length}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                  Questions
                </p>
              </div>
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-lg font-extrabold tabular-nums text-emerald-700">
                  {(set.questions ?? []).filter((q) => q.is_active).length}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                  Active
                </p>
              </div>
              <div className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-lg font-extrabold tabular-nums text-foreground">
                  {(set.questions ?? []).reduce(
                    (s, q) => s + (q.points ?? 0),
                    0,
                  )}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                  Pts
                </p>
              </div>
            </div>
          </div>

          {/* Validation checklist */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            {/* Header row */}
            <div className="border-b border-border px-5 py-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <p className="font-bold text-foreground text-sm">
                Pre-publish checklist
              </p>

              {validating && (
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Validating…
                </span>
              )}

              {!validating && validationReport && blockerRows.length === 0 && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All checks passed
                </span>
              )}

              {!validating && validationReport && blockerRows.length > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-red-700">
                  <XCircle className="h-3.5 w-3.5" />
                  {blockerRows.length} check
                  {blockerRows.length === 1 ? "" : "s"} failing
                </span>
              )}

              {!validating && !validationError && validationReport && (
                <button
                  type="button"
                  onClick={handleRevalidate}
                  className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                  title="Re-run validation"
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-check
                </button>
              )}
            </div>

            {/* Validation error state */}
            {validationError && !validating && (
              <div className="px-5 py-5 flex items-start gap-3">
                <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-red-800">
                    Validation unavailable
                  </p>
                  <p className="text-xs text-red-700 mt-0.5">
                    {validationError}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRevalidate}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}

            {/* Validation loading skeleton */}
            {validating && checkRows.length === 0 && (
              <div className="divide-y divide-border">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="h-4 w-4 rounded-full bg-muted animate-pulse shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-40 rounded bg-muted animate-pulse" />
                      <div className="h-2.5 w-64 rounded bg-muted animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Check rows */}
            {!validating && checkRows.length > 0 && (
              <div className="divide-y divide-border">
                {checkRows.map((check) => (
                  <div
                    key={check.id}
                    className={cn(
                      "flex items-start gap-3 px-5 py-3.5",
                      !check.passed && check.blocker && "bg-red-50/60",
                      !check.passed && !check.blocker && "bg-amber-50/60",
                    )}
                  >
                    {check.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : check.blocker ? (
                      <XCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm font-bold",
                          check.passed
                            ? "text-foreground"
                            : check.blocker
                            ? "text-red-800"
                            : "text-amber-800",
                        )}
                      >
                        {check.label}
                      </p>
                      <p
                        className={cn(
                          "text-xs mt-0.5",
                          check.passed
                            ? "text-muted-foreground"
                            : check.blocker
                            ? "text-red-700"
                            : "text-amber-700",
                        )}
                      >
                        {check.detail}
                      </p>
                    </div>
                    {!check.passed && check.blocker && (
                      <Link
                        href={`/builder/sets/${setId}`}
                        className="ml-auto shrink-0 text-xs font-bold text-red-700 hover:underline whitespace-nowrap"
                      >
                        Fix in editor →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advisory warnings summary (if any) */}
          {!validating && advisoryRows.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">
                  Optional improvements ({advisoryRows.length})
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  These won't block publish but are worth addressing for
                  quality.
                </p>
              </div>
            </div>
          )}

          {/* Immutability acknowledgement — only shown when all blocking checks pass */}
          {!validating && isPublishable && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-amber-900 text-base">
                    Publishing is permanent
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    Once published, this assessment set is{" "}
                    <strong>immutable</strong>. The content will be locked to
                    preserve the integrity of any assignments based on it:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    <li className="flex items-start gap-1.5">
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700"
                        aria-hidden
                      />
                      Questions cannot be edited — editing creates a new
                      revision.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700"
                        aria-hidden
                      />
                      Students who take assignments based on this set will
                      always see this exact version, even if you publish a
                      newer one later.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Lock
                        className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700"
                        aria-hidden
                      />
                      Grading results are tied to this snapshot permanently.
                    </li>
                  </ul>
                </div>
              </div>

              {/* Acknowledgement checkbox */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 accent-amber-600"
                />
                <span className="text-sm font-bold text-amber-900 group-hover:text-amber-950 select-none">
                  I understand this action is irreversible and the content will
                  be locked.
                </span>
              </label>
            </div>
          )}

          {/* Publish error */}
          {publishError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {publishError}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center justify-between gap-4 pb-8">
            <Link
              href={`/builder/sets/${setId}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Cancel
            </Link>

            <button
              type="button"
              onClick={handlePublish}
              disabled={!canPublish}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-extrabold transition-all",
                canPublish
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md hover:shadow-lg active:scale-95"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Publishing…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Publish assessment
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
