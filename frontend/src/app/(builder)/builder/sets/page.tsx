"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useAssessmentSetsList, useDeleteAssessmentSet } from "@/features/assessments/hooks";
import { getRole, getSubject } from "@/lib/permissions";
import { Plus, Search, RefreshCw, SendHorizonal, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { StateTag, SetLineage } from "@/components/governance";
import { ConfirmDialog } from "@/features/classroom/ui";
import { levelLabel, LEVEL_LABELS, type LevelKey } from "@/lib/levels";

const SUBJECT_COLORS: Record<string, string> = {
  math: "bg-purple-100 text-purple-800",
  english: "bg-teal-100 text-teal-800",
};

export default function BuilderSetsPage() {
  // Backend already enforces teacher subject scoping.
  // For global staff (admin/test_admin/super_admin), default to "all subjects".
  const role = getRole();
  const scopedSubject = role === "teacher" ? getSubject() : null;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [levelFilter, setLevelFilter] = useState<"all" | LevelKey>("all");
  const [subjectFilter, setSubjectFilter] = useState<"all" | "english" | "math">("all");
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

  const sets = data?.results ?? (Array.isArray(data) ? data : []);

  const filtered = useMemo(() => {
    let result = sets;
    const term = search.trim().toLowerCase();
    if (term.length >= 1) {
      result = result.filter(
        (s) => `${s.title} ${s.category} ${s.description}`.toLowerCase().includes(term),
      );
    }
    if (statusFilter === "active") result = result.filter((s) => s.is_active);
    if (statusFilter === "inactive") result = result.filter((s) => !s.is_active);
    if (levelFilter !== "all") result = result.filter((s) => s.level === levelFilter);
    if (subjectFilter !== "all") result = result.filter((s) => s.subject === subjectFilter);
    return result;
  }, [sets, search, statusFilter, levelFilter, subjectFilter]);

  const activeCount = sets.filter((s) => s.is_active).length;
  const draftCount = sets.filter((s) => !s.is_active).length;

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
          <Link
            href="/builder/sets/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New set
          </Link>
        </div>
      </div>

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

      {/* Search + filter */}
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Draft / inactive</option>
        </select>
        {/* Filter 1: level */}
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
        >
          <option value="all">All levels</option>
          {(["foundation", "junior", "middle", "senior"] as LevelKey[]).map((lv) => (
            <option key={lv} value={lv}>
              {LEVEL_LABELS[lv]}
            </option>
          ))}
        </select>
        {/* Filter 2: subject — only for global staff (a scoped teacher already sees one subject) */}
        {!scopedSubject && (
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value as typeof subjectFilter)}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold"
          >
            <option value="all">All subjects</option>
            <option value="english">English</option>
            <option value="math">Math</option>
          </select>
        )}
      </div>

      {/* Error */}
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {String((error as { message?: string })?.message || error)}
        </div>
      ) : null}

      {/* Sets grid */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 font-bold text-foreground">
          {isLoading ? "Loading…" : `${filtered.length} set${filtered.length === 1 ? "" : "s"}`}
        </div>

        {isLoading ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <p className="font-semibold">
              {sets.length === 0 ? "No assessment sets yet." : "No sets match your filters."}
            </p>
            {sets.length === 0 && (
              <Link
                href="/builder/sets/new"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create first set
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((s) => {
              const questionCount = (s.questions ?? []).length;
              const activeQs = (s.questions ?? []).filter((q: { is_active?: boolean }) => q.is_active).length;
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
