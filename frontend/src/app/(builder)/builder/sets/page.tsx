"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useAssessmentSetsList, useDeleteAssessmentSet, useSetReviewStatus } from "@/features/assessments/hooks";
import { getRole, getSubject } from "@/lib/permissions";
import { Plus, Search, RefreshCw, Trash2, ChevronRight, BookOpen, Sigma, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag, SetLineage } from "@/components/governance";
import { ConfirmDialog } from "@/features/classroom/ui";
import { levelLabel, levelsForSubject, setHasLevel, setLevelsLabel, type LevelKey } from "@/lib/levels";
import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/features/assessments/types";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import type { Subject } from "@/features/assessments/types";
import { useToast } from "@/components/ToastProvider";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_FIELD_LABEL,
  STUDIO_INPUT,
  STUDIO_LINK,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
  STUDIO_SELECT,
} from "@/components/studio/primitives";

type SubjectKey = "english" | "math";
const SUBJECTS: { code: SubjectKey; label: string }[] = [
  { code: "english", label: "English" },
  { code: "math", label: "Math" },
];
// Sentinel for the "Unassigned" bucket (legacy sets with a blank level).
const UNASSIGNED_LEVEL = "__unassigned__";

// Plain text, as the /ops lists draw a state: only the one that asks for attention is dark.
const REVIEW_STATUS_STYLES: Record<ReviewStatus, string> = {
  draft: "text-muted-foreground",
  needs_review: "font-medium text-foreground",
  approved: "text-muted-foreground",
};

const REVIEW_STATUS_ORDER: ReviewStatus[] = ["draft", "needs_review", "approved"];

export default function BuilderSetsPage() {
  // Backend already enforces teacher subject scoping.
  // For global staff (admin/test_admin/super_admin), default to "all subjects".
  const role = getRole();
  const scopedSubject = (role === "teacher" ? getSubject() : null) as SubjectKey | null;
  const canApprove = role === "admin" || role === "super_admin" || role === "test_auditor";
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all");
  // Drill-down: subject (English/Math) → level → the sets in that bucket. A scoped teacher
  // has one subject, so step 1 is pre-selected and skipped. New sets inherit this context.
  const [selectedSubject, setSelectedSubject] = useState<SubjectKey | null>(scopedSubject);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const setStatus = useSetReviewStatus();
  const toast = useToast();
  const router = useRouter();

  // Create a new set directly from a CSV of questions (subject+level from the bucket).
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvTitle, setCsvTitle] = useState("");
  const [csvSource, setCsvSource] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const changeStatus = (id: number, status: ReviewStatus) => {
    setStatus.mutate(
      { id, status },
      {
        onSuccess: () =>
          toast.push({ message: `Status set to “${REVIEW_STATUS_LABELS[status]}”.`, tone: "success" }),
        onError: (e: unknown) => {
          // Surface the specific approval blockers (e.g. "must have a category") rather
          // than a bare "400". The backend puts the reasons in detail; findings[] carries
          // the per-issue breakdown when detail is generic.
          const resp = (e as { response?: { data?: { detail?: string; findings?: { message?: string }[] } } })?.response?.data;
          const findingMsgs = (resp?.findings ?? []).map((f) => f?.message).filter(Boolean).join("; ");
          const msg =
            resp?.detail ||
            (findingMsgs ? `Cannot approve — fix these first: ${findingMsgs}` : null) ||
            (e as { message?: string })?.message ||
            "Could not change status.";
          toast.push({ message: msg, tone: "error" });
        },
      },
    );
  };
  const [pendingDelete, setPendingDelete] = useState<{ id: number; title: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Set becomes true after a 409 (the set is published/assigned) — reveals the
  // force-delete action, which removes it along with student attempts & grades.
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const deleteSet = useDeleteAssessmentSet();

  const { data, isLoading, error, refetch } = useAssessmentSetsList(
    scopedSubject ? { subject: scopedSubject } : undefined,
  );

  const runDelete = (force: boolean) => {
    if (!pendingDelete) return;
    setDeleteError(null);
    deleteSet.mutate(
      { setId: pendingDelete.id, force },
      {
        onSuccess: () => {
          setPendingDelete(null);
          setDeleteBlocked(false);
        },
        onError: (e) => {
          const err = e as { message?: string; status?: number };
          setDeleteError(err?.message || "Could not delete this set.");
          if (err?.status === 409) setDeleteBlocked(true);
        },
      },
    );
  };

  const closeDelete = () => {
    setPendingDelete(null);
    setDeleteError(null);
    setDeleteBlocked(false);
  };

  const submitCsvImport = async () => {
    const file = csvFileRef.current?.files?.[0];
    if (!selectedSubject || !csvTitle.trim() || !csvSource || !file) return;
    setCsvBusy(true);
    try {
      const res = await assessmentsAdminApi.importSetCsv(
        {
          subject: selectedSubject as Subject,
          source: csvSource,
          level: selectedLevel && selectedLevel !== UNASSIGNED_LEVEL ? selectedLevel : undefined,
          title: csvTitle.trim(),
        },
        file,
      );
      toast.push({ tone: "success", message: `Created “${csvTitle.trim()}” with ${res.created_count} question${res.created_count === 1 ? "" : "s"}.` });
      router.push(`/builder/sets/${res.id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string; errors?: { row: number }[] } } };
      const data = err?.response?.data;
      const msg = data?.errors?.length
        ? `${data.detail ?? "Some rows are invalid."} (row ${data.errors[0].row})`
        : data?.detail || "Could not import the CSV.";
      toast.push({ tone: "error", message: msg });
    } finally {
      setCsvBusy(false);
    }
  };

  const sets = useMemo(() => data?.results ?? (Array.isArray(data) ? data : []), [data]);

  // Drill-down slices + counts.
  const countForSubject = (code: SubjectKey) => sets.filter((s) => s.subject === code).length;
  const subjectSets = useMemo(
    () => (selectedSubject ? sets.filter((s) => s.subject === selectedSubject) : []),
    [sets, selectedSubject],
  );
  // A set with an optional second level (2026-10-11, the school's request) sits in BOTH
  // level buckets — the same "either level" rule the server applies to classrooms and
  // journals — so a Junior+Middle set is counted, and listed, under Junior and Middle.
  // "Unassigned" stays primary-only: a set with no primary has no second level either.
  const countForLevel = (lv: string) =>
    subjectSets.filter((s) => (lv === UNASSIGNED_LEVEL ? !s.level : setHasLevel(s, lv))).length;
  const hasUnassigned = subjectSets.some((s) => !s.level);

  const filtered = useMemo(() => {
    let result = subjectSets;
    if (selectedLevel === UNASSIGNED_LEVEL) result = result.filter((s) => !s.level);
    else if (selectedLevel) result = result.filter((s) => setHasLevel(s, selectedLevel));
    const term = search.trim().toLowerCase();
    if (term.length >= 1) {
      result = result.filter(
        (s) => `${s.title} ${s.category} ${s.description}`.toLowerCase().includes(term),
      );
    }
    if (statusFilter === "active") result = result.filter((s) => s.is_active);
    if (statusFilter === "inactive") result = result.filter((s) => !s.is_active);
    if (reviewFilter !== "all")
      result = result.filter((s) => (s.review_status ?? "draft") === reviewFilter);
    return result;
  }, [subjectSets, selectedLevel, search, statusFilter, reviewFilter]);

  const activeCount = sets.filter((s) => s.is_active).length;
  const draftCount = sets.filter((s) => !s.is_active).length;
  const canCreate = Boolean(selectedSubject && selectedLevel);
  const selectedLevelLabel =
    selectedLevel === UNASSIGNED_LEVEL ? "Unassigned" : selectedLevel ? levelLabel(selectedLevel) : "";
  // New-set link carries the current bucket so the create form can prefill + lock it.
  const newSetHref =
    selectedSubject && selectedLevel
      ? `/builder/sets/new?subject=${selectedSubject}${selectedLevel !== UNASSIGNED_LEVEL ? `&level=${selectedLevel}` : ""}`
      : "/builder/sets/new";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={STUDIO_PAGE_TITLE}>Assessments</h1>
          <p className={STUDIO_PAGE_DESC}>
            Assessment sets group reusable questions into a deliverable unit. Approve a set to make
            it assignable to classrooms.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className={STUDIO_BTN_SECONDARY}
          >
            <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
            Refresh
          </button>
          <Link
            href="/builder/bank"
            className={STUDIO_BTN_SECONDARY}
          >
            Question Bank
          </Link>
          {canCreate && (
            <button
              type="button"
              onClick={() => { setCsvTitle(""); setCsvSource(""); if (csvFileRef.current) csvFileRef.current.value = ""; setCsvOpen(true); }}
              className={STUDIO_BTN_SECONDARY}
            >
              <Upload className="h-3.5 w-3.5 text-muted-foreground" />
              Import CSV
            </button>
          )}
          {canCreate && (
            <Link
              href={newSetHref}
              className={STUDIO_BTN_PRIMARY}
            >
              <Plus className="h-3.5 w-3.5" />
              New set
            </Link>
          )}
        </div>
      </div>

      {/* Breadcrumb — subject → level drill-down */}
      <nav className="flex flex-wrap items-center gap-1 text-[13px] font-medium">
        {scopedSubject ? (
          <button
            type="button"
            onClick={() => setSelectedLevel(null)}
            className={cn(
              "rounded-md px-1.5 py-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selectedLevel ? "text-primary hover:underline dark:text-primary-hover" : "text-foreground",
            )}
          >
            {SUBJECTS.find((s) => s.code === scopedSubject)?.label ?? scopedSubject}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setSelectedSubject(null); setSelectedLevel(null); }}
            className={cn(
              "rounded-md px-1.5 py-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selectedSubject ? "text-primary hover:underline dark:text-primary-hover" : "text-foreground",
            )}
          >
            All subjects
          </button>
        )}
        {selectedSubject && !scopedSubject && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setSelectedLevel(null)}
              className={cn(
                "rounded-md px-1.5 py-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selectedLevel ? "text-primary hover:underline dark:text-primary-hover" : "text-foreground",
              )}
            >
              {SUBJECTS.find((s) => s.code === selectedSubject)?.label ?? selectedSubject}
            </button>
          </>
        )}
        {selectedSubject && selectedLevel && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="px-1.5 py-0.5 text-foreground">{selectedLevelLabel}</span>
          </>
        )}
      </nav>

      {/* Stats — one hairline box, a figure per cell (as the /ops dashboard's Learners box) */}
      {!isLoading && sets.length > 0 && (
        <div className="grid grid-cols-3 gap-px overflow-hidden border border-border bg-border">
          <div className="bg-card px-3 py-2">
            <p className="text-xl font-semibold tabular-nums text-foreground">{sets.length}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Total</p>
          </div>
          <div className="bg-card px-3 py-2">
            <p className="text-xl font-semibold tabular-nums text-primary dark:text-primary-hover">{activeCount}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Active</p>
          </div>
          <div className="bg-card px-3 py-2">
            <p className="text-xl font-semibold tabular-nums text-muted-foreground">{draftCount}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Draft</p>
          </div>
        </div>
      )}


      {/* Search + filter — only in the set list (subject & level are the drill-down) */}
      {canCreate && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sets…"
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <select
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
            className={STUDIO_SELECT}
            title="Review status"
          >
            <option value="all">All review statuses</option>
            {REVIEW_STATUS_ORDER.map((rs) => (
              <option key={rs} value={rs}>
                {REVIEW_STATUS_LABELS[rs]}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className={STUDIO_SELECT}
            title="Visibility"
          >
            <option value="all">All visibility</option>
            <option value="active">Active only</option>
            <option value="inactive">Archived only</option>
          </select>
        </div>
      )}

      {/* Error */}
      {error ? (
        <div className={STUDIO_ERROR_BANNER}>
          {String((error as { message?: string })?.message || error)}
        </div>
      ) : null}

      {/* Content — drill-down: subject → level → sets */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : selectedSubject === null ? (
        /* Step 1 — choose a subject */
        <div className={cn(STUDIO_CARD, "divide-y divide-border")}>
          {SUBJECTS.map((s) => {
            const n = countForSubject(s.code);
            const Icon = s.code === "math" ? Sigma : BookOpen;
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => { setSelectedSubject(s.code); setSelectedLevel(null); }}
                className="group flex h-10 w-full items-center justify-between px-3 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="flex items-center gap-2.5">
                  <div className="flex shrink-0 items-center justify-center text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <p className="font-medium text-primary group-hover:underline dark:text-primary-hover">{s.label}</p>
                    <p className="text-[12px] tabular-nums text-muted-foreground">{n} set{n !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      ) : selectedLevel === null ? (
        /* Step 2 — choose a level */
        <div className={cn(STUDIO_CARD, "divide-y divide-border")}>
          {levelsForSubject(selectedSubject).map((code: LevelKey) => {
            const n = countForLevel(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => setSelectedLevel(code)}
                className="group flex h-9 w-full items-center justify-between px-3 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <div className="flex items-baseline gap-2">
                  <p className="font-medium text-primary group-hover:underline dark:text-primary-hover">{levelLabel(code)}</p>
                  <p className="text-[12px] tabular-nums text-muted-foreground">{n} set{n !== 1 ? "s" : ""}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            );
          })}
          {hasUnassigned && (
            <button
              type="button"
              onClick={() => setSelectedLevel(UNASSIGNED_LEVEL)}
              className="group flex h-9 w-full items-center justify-between bg-surface-2/40 px-3 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <div className="flex items-baseline gap-2">
                <p className="font-medium text-primary group-hover:underline dark:text-primary-hover">Unassigned</p>
                <p className="text-[12px] tabular-nums text-muted-foreground">{countForLevel(UNASSIGNED_LEVEL)} without a level</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>
      ) : (
      /* Step 3 — sets in this subject+level */
      <div className={STUDIO_CARD}>
        <div className={STUDIO_BOX_CAPTION}>
          {`${filtered.length} set${filtered.length === 1 ? "" : "s"}`}
        </div>

        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            <p className="font-medium">
              {subjectSets.length === 0 || countForLevel(selectedLevel === UNASSIGNED_LEVEL ? UNASSIGNED_LEVEL : selectedLevel ?? "") === 0
                ? `No sets in ${SUBJECTS.find((s) => s.code === selectedSubject)?.label} · ${selectedLevelLabel} yet.`
                : "No sets match your filters."}
            </p>
            <Link
              href={newSetHref}
              className={cn(STUDIO_BTN_PRIMARY, "mt-3")}
            >
              <Plus className="h-3.5 w-3.5" />
              New set
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((s) => {
              const questionCount = (s.questions ?? []).length;
              const activeQs = (s.questions ?? []).filter((q: { is_active?: boolean }) => q.is_active).length;
              const reviewStatus = (s.review_status ?? "draft") as ReviewStatus;
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-[13px] hover:bg-surface-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <p className="truncate font-semibold text-foreground">
                        #{s.id} · {s.title}
                      </p>
                      {s.subject && (
                        <span className="text-[12px] capitalize text-muted-foreground">
                          {s.subject}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-[12px]",
                          REVIEW_STATUS_STYLES[reviewStatus],
                        )}
                        title="Review status"
                      >
                        {REVIEW_STATUS_LABELS[reviewStatus]}
                      </span>
                      <StateTag state={s.is_active ? "PUBLISHED" : "DRAFT"} size="xs" />
                      {s.level && (
                        <span className="text-[12px] text-muted-foreground">
                          {setLevelsLabel(s.level, s.secondary_level)}
                        </span>
                      )}
                    </div>
                    {s.category && (
                      <p className="mb-0.5 text-[12px] text-muted-foreground">{s.category}</p>
                    )}
                    {role === "super_admin" && (s.created_by_name || s.created_by_email) && (
                      <p className="mb-0.5 text-[12px] text-muted-foreground">
                        Created by{" "}
                        <span className="font-medium text-foreground">
                          {s.created_by_name || s.created_by_email}
                        </span>
                        {s.created_by_name && s.created_by_email ? ` · ${s.created_by_email}` : ""}
                      </p>
                    )}
                    <SetLineage
                      setId={s.id}
                      isPublished={s.is_active}
                      questionCount={questionCount}
                      activeQuestionCount={activeQs}
                      updatedAt={s.updated_at}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={reviewStatus}
                      disabled={setStatus.isPending}
                      onChange={(e) => changeStatus(s.id, e.target.value as ReviewStatus)}
                      onClick={(e) => e.stopPropagation()}
                      title={canApprove ? "Change review status" : "Only an admin can approve"}
                      className={cn(STUDIO_SELECT, "disabled:opacity-50")}
                    >
                      {REVIEW_STATUS_ORDER.map((rs) => (
                        <option key={rs} value={rs} disabled={rs === "approved" && !canApprove}>
                          {REVIEW_STATUS_LABELS[rs]}
                        </option>
                      ))}
                    </select>
                    <Link
                      href={`/builder/sets/${s.id}`}
                      className={STUDIO_LINK}
                    >
                      Open editor →
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setPendingDelete({ id: s.id, title: s.title });
                      }}
                      title="Delete set"
                      aria-label={`Delete set ${s.title}`}
                      className="inline-flex items-center rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:hover:border-red-900/60 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {csvOpen && selectedSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !csvBusy && setCsvOpen(false)}>
          <div className="w-full max-w-md border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2">
              <div>
                <h2 className="text-[13px] font-semibold text-foreground">Import set from CSV</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {SUBJECTS.find((s) => s.code === selectedSubject)?.label}
                  {selectedLevelLabel ? ` · ${selectedLevelLabel}` : ""} — one question per row.
                </p>
              </div>
              <button onClick={() => !csvBusy && setCsvOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 px-3 py-3">
              <div>
                <label className={STUDIO_FIELD_LABEL}>Title</label>
                <input autoFocus value={csvTitle} onChange={(e) => setCsvTitle(e.target.value)} placeholder="e.g. Algebra — Unit 1" className={STUDIO_INPUT} />
              </div>
              <div>
                <label className={STUDIO_FIELD_LABEL}>Source</label>
                <select value={csvSource} onChange={(e) => setCsvSource(e.target.value)} className={STUDIO_INPUT}>
                  <option value="">Select a source…</option>
                  {allowedSourcesForSubject(selectedSubject as Subject).map((s) => (
                    <option key={s} value={s}>{sourceLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={STUDIO_FIELD_LABEL}>CSV file</label>
                <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="w-full rounded-md text-[13px] text-foreground file:mr-3 file:rounded-md file:border file:border-solid file:border-border file:bg-card file:px-2.5 file:py-1 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
                <p className="mt-1 text-[12px] text-muted-foreground">Columns: question_type, prompt, option_a–d, correct_answer, points, explanation.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
              <button onClick={() => setCsvOpen(false)} disabled={csvBusy} className={STUDIO_BTN_SECONDARY}>Cancel</button>
              <button onClick={() => void submitCsvImport()} disabled={csvBusy || !csvTitle.trim() || !csvSource} className={STUDIO_BTN_PRIMARY}>{csvBusy ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete assessment set?"
        description={
          pendingDelete
            ? `“#${pendingDelete.id} · ${pendingDelete.title}” and its draft questions will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete set"
        loading={deleteSet.isPending}
        onConfirm={() => runDelete(false)}
        onCancel={closeDelete}
      >
        {deleteError ? (
          <div className="space-y-3">
            <div className={STUDIO_ERROR_BANNER}>
              {deleteError}
            </div>
            {deleteBlocked ? (
              <div className="border border-red-300 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/40">
                <p className="text-[13px] font-semibold text-red-800 dark:text-red-200">Force delete?</p>
                <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">
                  This permanently deletes the set together with every student attempt, grade, and
                  result on it, and removes it from any classroom homework. This can’t be undone.
                </p>
                <button
                  type="button"
                  onClick={() => runDelete(true)}
                  disabled={deleteSet.isPending}
                  className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleteSet.isPending ? "Deleting…" : "Force delete (removes attempts & grades)"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
