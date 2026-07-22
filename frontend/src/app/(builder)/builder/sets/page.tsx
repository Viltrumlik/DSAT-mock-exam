"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useAssessmentSetsList, useDeleteAssessmentSet, useSetReviewStatus } from "@/features/assessments/hooks";
import { getRole, getSubject } from "@/lib/permissions";
import { Plus, Search, RefreshCw, SendHorizonal, Trash2, ChevronRight, BookOpen, Sigma, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag, SetLineage } from "@/components/governance";
import { ConfirmDialog } from "@/features/classroom/ui";
import { levelLabel, levelsForSubject, type LevelKey } from "@/lib/levels";
import { REVIEW_STATUS_LABELS, type ReviewStatus } from "@/features/assessments/types";
import { assessmentsAdminApi } from "@/features/assessmentsAdmin/api";
import { allowedSourcesForSubject, sourceLabel } from "@/lib/assessmentSources";
import type { Subject } from "@/features/assessments/types";
import { useToast } from "@/components/ToastProvider";

type SubjectKey = "english" | "math";
const SUBJECTS: { code: SubjectKey; label: string }[] = [
  { code: "english", label: "English" },
  { code: "math", label: "Math" },
];
// Sentinel for the "Unassigned" bucket (legacy sets with a blank level).
const UNASSIGNED_LEVEL = "__unassigned__";

const SUBJECT_COLORS: Record<string, string> = {
  math: "bg-purple-100 text-purple-800",
  english: "bg-teal-100 text-teal-800",
};

const REVIEW_STATUS_STYLES: Record<ReviewStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
};

const REVIEW_STATUS_ORDER: ReviewStatus[] = ["draft", "needs_review", "approved"];

export default function BuilderSetsPage() {
  // Backend already enforces teacher subject scoping.
  // For global staff (admin/test_admin/super_admin), default to "all subjects".
  const role = getRole();
  const scopedSubject = (role === "teacher" ? getSubject() : null) as SubjectKey | null;
  const canApprove = role === "admin" || role === "super_admin";
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
        onError: (e: unknown) =>
          toast.push({
            message: (e as { message?: string })?.message || "Could not change status.",
            tone: "error",
          }),
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
  const countForLevel = (lv: string) =>
    subjectSets.filter((s) => (lv === UNASSIGNED_LEVEL ? !s.level : s.level === lv)).length;
  const hasUnassigned = subjectSets.some((s) => !s.level);

  const filtered = useMemo(() => {
    let result = subjectSets;
    if (selectedLevel === UNASSIGNED_LEVEL) result = result.filter((s) => !s.level);
    else if (selectedLevel) result = result.filter((s) => s.level === selectedLevel);
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Assessments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assessment sets group reusable questions into a deliverable unit. Publishing creates an
            immutable snapshot that can be assigned to classrooms.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <Link
            href="/builder/bank"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            Question Bank
          </Link>
          {canCreate && (
            <button
              type="button"
              onClick={() => { setCsvTitle(""); setCsvSource(""); if (csvFileRef.current) csvFileRef.current.value = ""; setCsvOpen(true); }}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </button>
          )}
          {canCreate && (
            <Link
              href={newSetHref}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New set
            </Link>
          )}
        </div>
      </div>

      {/* Breadcrumb — subject → level drill-down */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
        {scopedSubject ? (
          <button
            type="button"
            onClick={() => setSelectedLevel(null)}
            className={cn("rounded-lg px-2 py-1 hover:bg-surface-2", selectedLevel ? "text-primary" : "text-foreground")}
          >
            {SUBJECTS.find((s) => s.code === scopedSubject)?.label ?? scopedSubject}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setSelectedSubject(null); setSelectedLevel(null); }}
            className={cn("rounded-lg px-2 py-1 hover:bg-surface-2", selectedSubject ? "text-primary" : "text-foreground")}
          >
            All subjects
          </button>
        )}
        {selectedSubject && !scopedSubject && (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setSelectedLevel(null)}
              className={cn("rounded-lg px-2 py-1 hover:bg-surface-2", selectedLevel ? "text-primary" : "text-foreground")}
            >
              {SUBJECTS.find((s) => s.code === selectedSubject)?.label ?? selectedSubject}
            </button>
          </>
        )}
        {selectedSubject && selectedLevel && (
          <>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <span className="rounded-lg px-2 py-1 text-foreground">{selectedLevelLabel}</span>
          </>
        )}
      </nav>

      {/* Stats */}
      {!isLoading && sets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-foreground">{sets.length}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Total</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-primary">{activeCount}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Active</p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-muted-foreground">{draftCount}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-0.5">Draft</p>
          </div>
        </div>
      )}

      {/* Publish queue callout when drafts exist */}
      {!isLoading && draftCount > 0 && (
        <Link
          href="/builder/publish-queue"
          className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 hover:border-amber-300 hover:bg-amber-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <SendHorizonal className="h-4 w-4 text-amber-700" />
            <p className="text-sm font-bold text-amber-900">
              {draftCount} draft set{draftCount === 1 ? "" : "s"} in the Publish Queue
            </p>
          </div>
          <span className="text-xs font-bold text-amber-700">Review →</span>
        </Link>
      )}

      {/* Search + filter — only in the set list (subject & level are the drill-down) */}
      {canCreate && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search sets…"
              className="w-full rounded-xl border border-border bg-card pl-9 pr-4 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={reviewFilter}
            onChange={(e) => setReviewFilter(e.target.value as typeof reviewFilter)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
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
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
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
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {String((error as { message?: string })?.message || error)}
        </div>
      ) : null}

      {/* Content — drill-down: subject → level → sets */}
      {isLoading ? (
        <div className="flex justify-center p-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : selectedSubject === null ? (
        /* Step 1 — choose a subject */
        <div className="grid gap-4 sm:grid-cols-2">
          {SUBJECTS.map((s) => {
            const n = countForSubject(s.code);
            const Icon = s.code === "math" ? Sigma : BookOpen;
            return (
              <button
                key={s.code}
                type="button"
                onClick={() => { setSelectedSubject(s.code); setSelectedLevel(null); }}
                className="group flex items-center justify-between rounded-2xl border border-border bg-card p-6 text-left transition-colors hover:border-primary hover:bg-surface-2"
              >
                <div className="flex items-center gap-4">
                  <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", s.code === "math" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700")}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-extrabold text-foreground">{s.label}</p>
                    <p className="text-sm text-muted-foreground">{n} set{n !== 1 ? "s" : ""}</p>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      ) : selectedLevel === null ? (
        /* Step 2 — choose a level */
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {levelsForSubject(selectedSubject).map((code: LevelKey) => {
            const n = countForLevel(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => setSelectedLevel(code)}
                className="group flex items-center justify-between rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-surface-2"
              >
                <div>
                  <p className="text-base font-extrabold text-foreground">{levelLabel(code)}</p>
                  <p className="text-sm text-muted-foreground">{n} set{n !== 1 ? "s" : ""}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
          {hasUnassigned && (
            <button
              type="button"
              onClick={() => setSelectedLevel(UNASSIGNED_LEVEL)}
              className="group flex items-center justify-between rounded-2xl border border-dashed border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-surface-2"
            >
              <div>
                <p className="text-base font-extrabold text-foreground">Unassigned</p>
                <p className="text-sm text-muted-foreground">{countForLevel(UNASSIGNED_LEVEL)} without a level</p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
      ) : (
      /* Step 3 — sets in this subject+level */
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 font-bold text-foreground">
          {`${filtered.length} set${filtered.length === 1 ? "" : "s"}`}
        </div>

        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="font-semibold">
              {subjectSets.length === 0 || countForLevel(selectedLevel === UNASSIGNED_LEVEL ? UNASSIGNED_LEVEL : selectedLevel ?? "") === 0
                ? `No sets in ${SUBJECTS.find((s) => s.code === selectedSubject)?.label} · ${selectedLevelLabel} yet.`
                : "No sets match your filters."}
            </p>
            <Link
              href={newSetHref}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New set
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((s) => {
              const questionCount = (s.questions ?? []).length;
              const activeQs = (s.questions ?? []).filter((q: { is_active?: boolean }) => q.is_active).length;
              const reviewStatus = (s.review_status ?? "draft") as ReviewStatus;
              const isDraft = !s.is_active;
              const isPublishReady =
                isDraft &&
                questionCount > 0 &&
                activeQs > 0 &&
                Boolean(s.title?.trim()) &&
                Boolean(s.category?.trim());
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-surface-2/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-extrabold text-foreground truncate">
                        #{s.id} · {s.title}
                      </p>
                      {s.subject && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
                            SUBJECT_COLORS[s.subject] ?? "bg-slate-100 text-slate-700",
                          )}
                        >
                          {s.subject}
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide",
                          REVIEW_STATUS_STYLES[reviewStatus],
                        )}
                        title="Review status"
                      >
                        {REVIEW_STATUS_LABELS[reviewStatus]}
                      </span>
                      <StateTag state={s.is_active ? "PUBLISHED" : "DRAFT"} size="xs" />
                      {s.level && (
                        <span className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-700">
                          {levelLabel(s.level)}
                        </span>
                      )}
                    </div>
                    {s.category && (
                      <p className="text-xs text-muted-foreground mb-0.5">{s.category}</p>
                    )}
                    {role === "super_admin" && (s.created_by_name || s.created_by_email) && (
                      <p className="text-[11px] text-muted-foreground/80 mb-0.5">
                        Created by{" "}
                        <span className="font-semibold text-foreground/70">
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
                      className="rounded-lg border border-border bg-card px-2 py-1 text-xs font-bold text-foreground disabled:opacity-50"
                    >
                      {REVIEW_STATUS_ORDER.map((rs) => (
                        <option key={rs} value={rs} disabled={rs === "approved" && !canApprove}>
                          {REVIEW_STATUS_LABELS[rs]}
                        </option>
                      ))}
                    </select>
                    {isPublishReady && (
                      <Link
                        href={`/builder/sets/${s.id}/publish`}
                        className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-emerald-700 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Publish
                      </Link>
                    )}
                    <Link
                      href={`/builder/sets/${s.id}`}
                      className="text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
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
                      className="inline-flex items-center rounded-xl border border-border p-1.5 text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors"
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
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Import set from CSV</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {SUBJECTS.find((s) => s.code === selectedSubject)?.label}
                  {selectedLevelLabel ? ` · ${selectedLevelLabel}` : ""} — one question per row.
                </p>
              </div>
              <button onClick={() => !csvBusy && setCsvOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Title</label>
                <input autoFocus value={csvTitle} onChange={(e) => setCsvTitle(e.target.value)} placeholder="e.g. Algebra — Unit 1" className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">Source</label>
                <select value={csvSource} onChange={(e) => setCsvSource(e.target.value)} className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold">
                  <option value="">Select a source…</option>
                  {allowedSourcesForSubject(selectedSubject as Subject).map((s) => (
                    <option key={s} value={s}>{sourceLabel(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-muted-foreground">CSV file</label>
                <input ref={csvFileRef} type="file" accept=".csv,text/csv" className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary" />
                <p className="mt-1 text-[11px] text-muted-foreground">Columns: question_type, prompt, option_a–d, correct_answer, points, explanation.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setCsvOpen(false)} disabled={csvBusy} className="rounded-xl px-3 py-2 text-sm font-bold text-muted-foreground hover:bg-surface-2 disabled:opacity-50">Cancel</button>
              <button onClick={() => void submitCsvImport()} disabled={csvBusy || !csvTitle.trim() || !csvSource} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">{csvBusy ? "Importing…" : "Import"}</button>
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
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {deleteError}
            </div>
            {deleteBlocked ? (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3">
                <p className="text-sm font-bold text-red-800">Force delete?</p>
                <p className="mt-1 text-xs text-red-700">
                  This permanently deletes the set together with every student attempt, grade, and
                  result on it, and removes it from any classroom homework. This can’t be undone.
                </p>
                <button
                  type="button"
                  onClick={() => runDelete(true)}
                  disabled={deleteSet.isPending}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
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
