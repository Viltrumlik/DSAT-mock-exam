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
 *   1. Pre-publish validation checklist — all checks must pass before publish
 *      is enabled. Each failing check blocks the action with a clear reason.
 *   2. Publish impact summary — what this set contains and what changes.
 *   3. Immutability acknowledgement — user must explicitly confirm they
 *      understand the content will be locked.
 *   4. Publish action — single, final, serious-looking button.
 *
 * GOVERNANCE INVARIANTS ENFORCED:
 *   - INV-001: A set with zero questions cannot be published.
 *   - INV-002: A set with no active questions cannot be published.
 *   - INV-003: A set without a title cannot be published.
 *   - INV-004: A set without a category cannot be published.
 *   - INV-005: Publishing is the point of no return for content — user is
 *              explicitly notified and must confirm.
 *
 * PRE-SNAPSHOT IMPLEMENTATION NOTE:
 *   In this release, "publish" sets `is_active: true` on the backend.
 *   The full snapshot/versioning API (Sprint 5) will replace this with a
 *   dedicated `/publish/` endpoint that creates an immutable AssessmentSetVersion.
 *   The UX and governance flow here is designed for that model — the backend
 *   integration point is isolated to the `publishSet()` function below.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
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
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Validation ───────────────────────────────────────────────────────────────

type ValidationCheck = {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  blocker: boolean; // true = blocks publish; false = advisory warning
};

function runValidation(set: AssessmentSet): ValidationCheck[] {
  const questions = set.questions ?? [];
  const activeQuestions = questions.filter((q) => q.is_active);

  return [
    {
      id: "has_questions",
      label: "Has at least one question",
      description:
        questions.length === 0
          ? "Add questions before publishing."
          : `${questions.length} question${questions.length === 1 ? "" : "s"} found.`,
      passed: questions.length > 0,
      blocker: true,
    },
    {
      id: "has_active_questions",
      label: "All included questions are active",
      description:
        activeQuestions.length === 0
          ? "No active questions. At least one question must be active."
          : activeQuestions.length < questions.length
          ? `${questions.length - activeQuestions.length} question${
              questions.length - activeQuestions.length === 1 ? " is" : "s are"
            } inactive and will NOT be included in the published snapshot.`
          : `All ${activeQuestions.length} question${activeQuestions.length === 1 ? "" : "s"} are active.`,
      passed: activeQuestions.length > 0,
      blocker: true,
    },
    {
      id: "has_title",
      label: "Set has a title",
      description: set.title?.trim()
        ? `Title: "${set.title.trim()}"`
        : "A title is required before publishing.",
      passed: Boolean(set.title?.trim()),
      blocker: true,
    },
    {
      id: "has_category",
      label: "Set has a category",
      description: set.category?.trim()
        ? `Category: "${set.category.trim()}"`
        : "A category is required so this set can be found in the question bank taxonomy.",
      passed: Boolean(set.category?.trim()),
      blocker: true,
    },
    {
      id: "has_description",
      label: "Set has a description (recommended)",
      description: set.description?.trim()
        ? "Description present."
        : "A description helps teachers understand the purpose of this set. Not required to publish.",
      passed: Boolean(set.description?.trim()),
      blocker: false, // advisory only
    },
  ];
}

// ─── Publish action ───────────────────────────────────────────────────────────

/**
 * publishSet — the single integration point for the publish action.
 *
 * PRE-SNAPSHOT (current): sets is_active: true.
 * POST-SNAPSHOT (Sprint 5): will call POST /assessments/admin/sets/{id}/publish/
 * returning an AssessmentSetVersion. Update ONLY this function.
 */
async function publishSet(setId: number): Promise<void> {
  await assessmentsAdminApi.updateSet(setId, { is_active: true });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PublishPage() {
  const params = useParams();
  const router = useRouter();
  const setId = Number(params.id);

  const [set, setSet] = useState<AssessmentSet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [acknowledged, setAcknowledged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

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
    return () => { cancelled = true; };
  }, [setId]);

  const checks = set ? runValidation(set) : [];
  const blockers = checks.filter((c) => c.blocker && !c.passed);
  const advisories = checks.filter((c) => !c.blocker && !c.passed);
  const canPublish = !loading && !loadError && blockers.length === 0 && acknowledged && !publishing;

  async function handlePublish() {
    if (!canPublish || !set) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishSet(setId);
      setPublished(true);
      // Redirect back to set editor after short delay
      setTimeout(() => router.push(`/builder/sets/${setId}`), 2000);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Publish failed. Please try again.";
      setPublishError(msg);
    } finally {
      setPublishing(false);
    }
  }

  // ── Post-publish success screen ──
  if (published) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6 text-center px-4">
        <div className="rounded-full bg-emerald-100 p-5">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Published</h1>
          <p className="mt-2 text-muted-foreground max-w-sm">
            <strong className="text-foreground">{set?.title}</strong> is now live. It is immutable —
            any future changes require creating a new revision.
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
        <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
          Questions console
        </p>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Publish assessment</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Review all checks before publishing. This action is permanent.
        </p>
      </div>

      {/* Loading */}
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
                This assessment set is already live. To make changes, edit the set and a new
                revision will be tracked. Historical assignments are unaffected.
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
                  {set.title || <span className="text-muted-foreground italic">Untitled</span>}
                </p>
                {set.category && (
                  <p className="text-sm text-muted-foreground mt-0.5">{set.category}</p>
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
                  {(set.questions ?? []).reduce((s, q) => s + (q.points ?? 0), 0)}
                </p>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">
                  Pts
                </p>
              </div>
            </div>
          </div>

          {/* Validation checklist */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="border-b border-border px-5 py-3 flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <p className="font-bold text-foreground text-sm">Pre-publish checklist</p>
              {blockers.length === 0 ? (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  All checks passed
                </span>
              ) : (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-red-700">
                  <XCircle className="h-3.5 w-3.5" />
                  {blockers.length} check{blockers.length === 1 ? "" : "s"} failing
                </span>
              )}
            </div>

            <div className="divide-y divide-border">
              {checks.map((check) => (
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
                  <div className="min-w-0">
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
                      {check.description}
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
          </div>

          {/* Advisory warnings */}
          {advisories.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">Optional improvements</p>
                <ul className="mt-1 space-y-1">
                  {advisories.map((a) => (
                    <li key={a.id} className="text-sm text-amber-800">
                      · {a.label}: {a.description}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Immutability warning */}
          {blockers.length === 0 && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 space-y-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-extrabold text-amber-900 text-base">
                    Publishing is permanent
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    Once published, this assessment set is{" "}
                    <strong>immutable</strong>. The content will be locked to preserve the
                    integrity of any assignments based on it:
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">
                    <li className="flex items-start gap-1.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700" aria-hidden />
                      Questions cannot be edited — editing creates a new revision.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700" aria-hidden />
                      Students who take assignments based on this set will always see this
                      exact version, even if you publish a newer one later.
                    </li>
                    <li className="flex items-start gap-1.5">
                      <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-700" aria-hidden />
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
                  I understand this action is irreversible and the content will be locked.
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
