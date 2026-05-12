"use client";

/**
 * PublishSlideOver — inline governance panel for publishing assessment sets.
 *
 * Opened from BuilderSetEditorContainer without a route transition.
 * The full /builder/sets/[id]/publish page remains for queue-originated publishing.
 *
 * UX contract: publishing is a deliberate, one-way state transition.
 * The panel communicates governance weight — not casual saving.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  ListChecks,
  Lock,
  Loader2,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import type { PublishValidationReport, ValidationFinding } from "@/features/assessmentsAdmin/api";
import type { AssessmentSet } from "@/features/assessments/types";
import { StateTag } from "@/components/governance";

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckRow = {
  id: string;
  label: string;
  detail: string;
  passed: boolean;
  blocker: boolean;
  questionId?: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const titleFinding = findingsByCode.get("missing_title");
  rows.push({
    id: "has_title",
    label: "Set has a title",
    detail: titleFinding ? titleFinding.message : `"${set.title?.trim()}"`,
    passed: !titleFinding,
    blocker: true,
  });

  const categoryFinding = findingsByCode.get("missing_category");
  rows.push({
    id: "has_category",
    label: "Set has a category",
    detail: categoryFinding ? categoryFinding.message : `Category: "${set.category?.trim()}"`,
    passed: !categoryFinding,
    blocker: true,
  });

  const noQsFinding = findingsByCode.get("no_active_questions");
  const activeCount = (set.questions ?? []).filter((q) => q.is_active).length;
  const totalCount = (set.questions ?? []).length;
  rows.push({
    id: "has_active_questions",
    label: "Has active questions",
    detail: noQsFinding
      ? noQsFinding.message
      : activeCount < totalCount
        ? `${activeCount} active of ${totalCount} total — ${totalCount - activeCount} inactive will NOT be snapshotted.`
        : `${activeCount} question${activeCount === 1 ? "" : "s"} — all will be snapshotted.`,
    passed: !noQsFinding,
    blocker: true,
  });

  const handledCodes = new Set(["missing_title", "missing_category", "no_active_questions"]);

  for (const f of blockingFindings) {
    if (handledCodes.has(f.code)) continue;
    rows.push({
      id: `blocking_${f.code}_${f.question_id ?? ""}`,
      label: f.question_id ? `Q#${f.question_id}: structural issue` : "Content issue",
      detail: f.message,
      passed: false,
      blocker: true,
      questionId: f.question_id,
    });
  }

  for (const f of warningFindings) {
    rows.push({
      id: `warning_${f.code}_${f.question_id ?? ""}`,
      label: f.question_id ? `Q#${f.question_id}: advisory` : "Recommendation",
      detail: f.message,
      passed: false,
      blocker: false,
      questionId: f.question_id,
    });
  }

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
    rows.push({
      id: "snapshot_ready",
      label: "Ready to create immutable snapshot",
      detail: `${activeCount} question${activeCount === 1 ? "" : "s"} will be locked permanently.`,
      passed: true,
      blocker: false,
    });
  }

  return rows;
}

async function publishSet(setId: number): Promise<void> {
  const { default: api } = await import("@/lib/api");
  const res = await api.post(`/assessments/admin/sets/${setId}/publish/`);
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(res.data?.detail ?? "Publish failed.");
  }
}

// ─── CheckRow component ───────────────────────────────────────────────────────

function CheckRowItem({
  row,
  onJump,
}: {
  row: CheckRow;
  onJump?: (questionId: number) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        row.passed
          ? "border-emerald-200 bg-emerald-50/50"
          : row.blocker
            ? "border-red-200 bg-red-50/50"
            : "border-amber-200 bg-amber-50/50",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {row.passed ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : row.blocker ? (
          <XCircle className="h-4 w-4 text-red-600" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-semibold",
            row.passed
              ? "text-emerald-900"
              : row.blocker
                ? "text-red-900"
                : "text-amber-900",
          )}
        >
          {row.label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-xs leading-relaxed",
            row.passed
              ? "text-emerald-800/70"
              : row.blocker
                ? "text-red-800/70"
                : "text-amber-800/70",
          )}
        >
          {row.detail}
        </p>
        {row.questionId && onJump && !row.passed && (
          <button
            type="button"
            onClick={() => onJump(row.questionId!)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold text-red-700 hover:text-red-900 hover:underline"
          >
            Jump to question
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── PublishSlideOver ─────────────────────────────────────────────────────────

export function PublishSlideOver({
  isOpen,
  onClose,
  setId,
  set,
  onPublishSuccess,
  onJumpToQuestion,
}: {
  isOpen: boolean;
  onClose: () => void;
  setId: number;
  set: AssessmentSet | null;
  onPublishSuccess: () => void;
  onJumpToQuestion: (questionId: number) => void;
}) {
  const [validating, setValidating] = useState(false);
  const [report, setReport] = useState<PublishValidationReport | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // Keyboard dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !publishing) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose, publishing]);

  // Run validation whenever opened
  const runValidation = useCallback(async () => {
    if (!setId) return;
    setValidating(true);
    setValidationError(null);
    setReport(null);
    setAcknowledged(false);
    setPublishError(null);
    setPublished(false);
    try {
      const r = await assessmentsAdminApi.validatePublish(setId);
      setReport(r);
    } catch {
      setValidationError("Could not run pre-publish checks. Check your connection and retry.");
    } finally {
      setValidating(false);
    }
  }, [setId]);

  useEffect(() => {
    if (isOpen) void runValidation();
  }, [isOpen, runValidation]);

  const handlePublish = async () => {
    if (!report?.is_publishable || !acknowledged || publishing) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await publishSet(setId);
      setPublished(true);
      setTimeout(() => {
        onPublishSuccess();
        onClose();
      }, 1400);
    } catch (e) {
      setPublishError(
        e instanceof Error ? e.message : "Publish failed. Try again.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleJump = (questionId: number) => {
    onJumpToQuestion(questionId);
    onClose();
  };

  const checkRows = set && report ? buildCheckRows(set, report) : [];
  const blockingCount = checkRows.filter((r) => !r.passed && r.blocker).length;
  const isPublishable = report?.is_publishable ?? false;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => !publishing && onClose()}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-full flex-col border-l border-border bg-card shadow-xl",
          "transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-label="Publish assessment"
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600">
              <Send className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-foreground">Publish assessment</p>
              {set && (
                <p className="text-xs text-muted-foreground truncate max-w-[240px]">
                  {set.title || "Untitled set"}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            disabled={publishing}
            onClick={onClose}
            className="rounded-xl border border-border p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-40 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Immutability warning — always shown, always first */}
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
            <Lock className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-amber-900">
                Publishing is permanent.
              </p>
              <p className="text-xs leading-relaxed text-amber-800/80">
                Once published, this assessment is <strong>locked into an immutable snapshot</strong>.
                Future edits create new revisions — existing student attempts are never
                affected. This is not a save action. It is a governance state transition.
              </p>
            </div>
          </div>

          {/* Validation checklist */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Pre-publish checks
              </p>
              {!validating && (
                <button
                  type="button"
                  onClick={() => void runValidation()}
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-surface-2 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" />
                  Re-run
                </button>
              )}
            </div>

            {validating && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/40 px-4 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                Running validation checks…
              </div>
            )}

            {validationError && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Validation unavailable</p>
                  <p className="mt-0.5 text-xs">{validationError}</p>
                </div>
              </div>
            )}

            {!validating && checkRows.length > 0 && (
              <div className="space-y-2">
                {checkRows.map((row) => (
                  <CheckRowItem key={row.id} row={row} onJump={handleJump} />
                ))}
              </div>
            )}
          </div>

          {/* Blocking issues summary */}
          {!validating && blockingCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <XCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">
                <strong className="font-bold">
                  {blockingCount} blocking issue{blockingCount !== 1 ? "s" : ""} must be fixed
                </strong>{" "}
                before this set can be published. Fix them in the editor, then re-run checks.
              </p>
            </div>
          )}

          {/* Assignment / student impact */}
          {!validating && isPublishable && set && (
            <div className="rounded-2xl border border-border bg-surface-2/30 px-4 py-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                What changes when you publish
              </p>
              <ul className="space-y-2 text-sm text-foreground/80">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  This set becomes <strong className="text-foreground">assignable to classrooms</strong> immediately.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  Content is <strong className="text-foreground">locked into an immutable snapshot</strong> — question text, choices, and correct answers cannot be modified without creating a new revision.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  Students who have already submitted attempts <strong className="text-foreground">are not affected</strong> by future revisions.
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  The set status will change from <StateTag state="DRAFT" size="xs" className="mx-0.5 inline-flex" /> to <StateTag state="PUBLISHED" size="xs" className="mx-0.5 inline-flex" />.
                </li>
              </ul>
            </div>
          )}

          {/* Published success state */}
          {published && (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-extrabold text-emerald-900">Published successfully.</p>
                <p className="mt-0.5 text-xs text-emerald-800/70">
                  An immutable snapshot has been created. Closing editor…
                </p>
              </div>
            </div>
          )}

          {/* Publish error */}
          {publishError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Publish failed</p>
                <p className="mt-0.5 text-xs">{publishError}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer — acknowledgement + action */}
        {!published && (
          <div className="shrink-0 space-y-4 border-t border-border bg-card px-6 py-5">
            {/* Acknowledgement */}
            {isPublishable && !validating && (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  disabled={publishing}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
                />
                <span className="text-xs leading-relaxed text-muted-foreground">
                  I understand this will create an <strong className="text-foreground">immutable snapshot</strong>.
                  Content will be permanently locked and students may be assigned to this
                  exact version.
                </span>
              </label>
            )}

            {/* Primary action */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={publishing}
                onClick={onClose}
                className="flex-1 rounded-xl border border-border bg-card py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-40 transition-colors"
              >
                Back to editor
              </button>
              <button
                type="button"
                disabled={
                  !isPublishable ||
                  !acknowledged ||
                  publishing ||
                  validating ||
                  !!validationError
                }
                onClick={() => void handlePublish()}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-extrabold transition-colors",
                  isPublishable && acknowledged && !publishing
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "bg-surface-2 text-muted-foreground cursor-not-allowed",
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
                    Publish
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
