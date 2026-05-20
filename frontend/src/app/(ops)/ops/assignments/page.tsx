"use client";

/**
 * /ops/assignments — Assignment lifecycle management
 *
 * Shows all assignments for a selected classroom, grouped by lifecycle state.
 * Lifecycle states are derived client-side from `due_at` and `submissions_count`.
 *
 * States surfaced (in urgency order):
 *   OVERDUE    → past deadline, zero submissions → intervention needed
 *   DUE_SOON   → due within 48h → heads-up for teacher
 *   ACTIVE     → open, >48h to due
 *   COMPLETED  → past deadline, has submissions → ready for review
 *   NO_DEADLINE → open indefinitely
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import type { Classroom, Assignment, NormalizedList } from "@/lib/criticalApiContract";
import CreateAssignmentModal from "@/components/CreateAssignmentModal";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  RefreshCw,
  School,
  Search,
  Timer,
  Zap,
  Infinity as InfinityIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { AssignmentLineage, StateTag } from "@/components/governance";
import {
  type AssignmentLifecycleState,
  deriveAssignmentLifecycleState,
  summarizeAssignmentLifecycle,
  sortByLifecyclePriority,
  LIFECYCLE_DISPLAY,
  formatAssignmentDue,
  formatAssignmentDueFull,
} from "@/lib/assignmentLifecycle";

// ─── Types ────────────────────────────────────────────────────────────────────

type ClassroomWithRole = Classroom & { my_role?: string; subject?: string; members_count?: number };

type AssignmentRow = Assignment & {
  classroomId: number;
  classroomName: string;
  subject?: string;
  lifecycleState: AssignmentLifecycleState;
  /** Total members in the classroom (includes teacher — used as denominator for progress). */
  classroomMemberCount?: number;
};

// ─── Submission progress component ───────────────────────────────────────────

function SubmissionProgress({
  submitted,
  total,
  isOverdue,
}: {
  submitted: number;
  total: number | null;
  isOverdue: boolean;
}) {
  // When total is unknown, fall back to raw count
  if (!total || total <= 0) {
    return (
      <span className={cn("font-semibold tabular-nums", isOverdue && submitted === 0 ? "text-red-600" : "text-foreground")}>
        {submitted} submission{submitted !== 1 ? "s" : ""}
      </span>
    );
  }

  // Treat members_count - 1 as student count (subtract teacher)
  const studentCount = Math.max(1, total - 1);
  const pct = Math.min(100, Math.round((submitted / studentCount) * 100));

  const barColor =
    isOverdue && submitted === 0
      ? "bg-red-400"
      : pct >= 80
        ? "bg-emerald-400"
        : pct >= 50
          ? "bg-amber-400"
          : "bg-border";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 min-w-[60px] max-w-[80px] h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={cn("text-xs font-bold tabular-nums shrink-0", isOverdue && submitted === 0 ? "text-red-600" : "text-muted-foreground")}>
        {submitted}/{studentCount}
      </span>
    </div>
  );
}

// ─── Lifecycle filter config ──────────────────────────────────────────────────

type LifecycleFilter = AssignmentLifecycleState | "ALL";

const LIFECYCLE_FILTERS: {
  value: LifecycleFilter;
  label: string;
  icon: React.ElementType;
  activeClasses: string;
}[] = [
  { value: "ALL",         label: "All",        icon: ClipboardCheck, activeClasses: "border-primary/40 bg-primary/10 text-primary" },
  { value: "OVERDUE",     label: "Overdue",    icon: AlertTriangle,  activeClasses: "border-red-300 bg-red-100 text-red-800" },
  { value: "DUE_SOON",    label: "Due soon",   icon: Timer,          activeClasses: "border-orange-300 bg-orange-100 text-orange-800" },
  { value: "ACTIVE",      label: "Active",     icon: Zap,            activeClasses: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  { value: "SCHEDULED",   label: "Scheduled",  icon: Calendar,       activeClasses: "border-violet-300 bg-violet-100 text-violet-800" },
  { value: "COMPLETED",   label: "Completed",  icon: CheckCircle2,   activeClasses: "border-teal-300 bg-teal-100 text-teal-800" },
  { value: "NO_DEADLINE", label: "No deadline",icon: InfinityIcon,   activeClasses: "border-sky-300 bg-sky-100 text-sky-800" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function LifecycleFilterButton({
  filter,
  current,
  count,
  onClick,
}: {
  filter: (typeof LIFECYCLE_FILTERS)[number];
  current: LifecycleFilter;
  count: number;
  onClick: (v: LifecycleFilter) => void;
}) {
  const active = current === filter.value;
  const Icon = filter.icon;
  return (
    <button
      type="button"
      onClick={() => onClick(filter.value)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors",
        active
          ? filter.activeClasses
          : "border-border bg-background text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {filter.label}
      {count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-black tabular-nums",
            active ? "bg-white/60" : "bg-surface-2",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function AssignmentStateChip({ state }: { state: AssignmentLifecycleState }) {
  const spec = LIFECYCLE_DISPLAY[state];
  return (
    <span
      title={spec.description}
      className={cn(
        "inline-flex items-center rounded-lg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
        spec.badgeClasses,
      )}
    >
      {spec.label}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OpsAssignmentsPage() {
  const [classrooms, setClassrooms] = useState<ClassroomWithRole[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<Record<string, unknown> | null>(null);

  const [search, setSearch] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("ALL");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<number, string>>({});

  // Load classrooms
  const loadClassrooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await classesApi.list();
      const managed = (list.items as ClassroomWithRole[]).filter((c) => c.my_role === "ADMIN");
      setClassrooms(managed);
      if (managed.length > 0 && !selectedClassroomId) {
        setSelectedClassroomId(managed[0].id);
      }
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not load classrooms.");
    } finally {
      setLoading(false);
    }
  }, [selectedClassroomId]);

  useEffect(() => {
    loadClassrooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAssignments = useCallback(
    async (classroomId: number) => {
      setLoadingAssignments(true);
      try {
        const list: NormalizedList<Assignment> = await classesApi.listAssignments(classroomId);
        const classroom = classrooms.find((c) => c.id === classroomId);
        const rows: AssignmentRow[] = list.items.map((a) => ({
          ...a,
          classroomId,
          classroomName: classroom?.name ?? `Class #${classroomId}`,
          subject: classroom?.subject,
          lifecycleState: deriveAssignmentLifecycleState(a),
          classroomMemberCount: (classroom as ClassroomWithRole)?.members_count,
        }));
        setAssignments(sortByLifecyclePriority(rows));
      } catch {
        setAssignments([]);
      } finally {
        setLoadingAssignments(false);
      }
    },
    [classrooms],
  );

  useEffect(() => {
    if (!selectedClassroomId) return;
    loadAssignments(selectedClassroomId);
  }, [selectedClassroomId, loadAssignments]);

  // Reset lifecycle filter when classroom changes
  useEffect(() => {
    setLifecycleFilter("ALL");
  }, [selectedClassroomId]);

  const summary = useMemo(() => summarizeAssignmentLifecycle(assignments), [assignments]);

  const filterCounts = useMemo(
    () => ({
      ALL: assignments.length,
      SCHEDULED: summary.scheduled,
      OVERDUE: summary.overdue,
      DUE_SOON: summary.dueSoon,
      ACTIVE: summary.active,
      COMPLETED: summary.completed,
      NO_DEADLINE: summary.noDeadline,
    }),
    [assignments, summary],
  );

  const filtered = useMemo(() => {
    let result = assignments;
    if (lifecycleFilter !== "ALL") {
      result = result.filter((a) => a.lifecycleState === lifecycleFilter);
    }
    if (search.trim().length >= 2) {
      const term = search.toLowerCase().trim();
      result = result.filter(
        (a) =>
          (a.title ?? "").toLowerCase().includes(term) ||
          a.classroomName.toLowerCase().includes(term),
      );
    }
    return result;
  }, [assignments, lifecycleFilter, search]);

  const handleDeleteConfirmed = async (a: AssignmentRow) => {
    setDeleteErrors((prev) => { const n = { ...prev }; delete n[a.id]; return n; });
    try {
      await classesApi.deleteAssignment(a.classroomId, a.id);
      setConfirmDeleteId(null);
      if (selectedClassroomId) await loadAssignments(selectedClassroomId);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setDeleteErrors((prev) => ({
        ...prev,
        [a.id]: typeof detail === "string" ? detail : "Could not delete assignment.",
      }));
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Admin console · Assignments
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">
            Assignment management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lifecycle view — assignments sorted by urgency. Snapshots are immutable.
          </p>
        </div>

        {selectedClassroomId && (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/teacher/homework/grading"
              className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-bold text-primary hover:bg-primary/15 transition-colors"
            >
              <ClipboardCheck className="h-4 w-4" />
              Grade homework
            </Link>
            <button
              type="button"
              onClick={() => { setEditingAssignment(null); setCreateOpen(true); }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Create assignment
            </button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Classroom selector + search */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Classroom picker */}
          <div className="flex flex-col gap-1 min-w-[180px] flex-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Classroom
            </span>
            {loading ? (
              <div className="h-9 w-full rounded-xl border border-border bg-surface-2 animate-pulse" />
            ) : (
              <select
                value={selectedClassroomId ?? ""}
                onChange={(e) => setSelectedClassroomId(Number(e.target.value))}
                className="rounded-xl border border-border bg-background px-3 py-2 text-sm font-semibold"
              >
                <option value="">Select a classroom</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.subject ? ` (${c.subject})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Search */}
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Search
            </span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Filter by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-border bg-background pl-8 pr-3 py-2 text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {selectedClassroomId && (
            <div className="flex items-center gap-1.5">
              <Link
                href={`/ops/classrooms/${selectedClassroomId}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
              >
                <School className="h-3.5 w-3.5" />
                Classroom
              </Link>
              <button
                type="button"
                onClick={() => loadAssignments(selectedClassroomId)}
                className="inline-flex items-center gap-1 rounded-xl border border-border bg-background px-3 py-2 text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Lifecycle status strip — only when assignments are loaded */}
      {!loadingAssignments && assignments.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Attention banner — only if problems exist */}
          {summary.needsAttention > 0 && (
            <div className="flex items-center gap-3 border-b border-border bg-amber-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm font-bold text-amber-900 flex-1">
                {summary.overdue > 0 && (
                  <span className="text-red-800">
                    {summary.overdue} overdue{summary.overdue === 1 ? "" : ""}
                  </span>
                )}
                {summary.overdue > 0 && summary.dueSoon > 0 && (
                  <span className="text-amber-600"> · </span>
                )}
                {summary.dueSoon > 0 && (
                  <span className="text-orange-800">
                    {summary.dueSoon} due soon
                  </span>
                )}
                <span className="font-semibold text-amber-700 ml-1.5">
                  — review and extend or close.
                </span>
              </p>
            </div>
          )}

          {/* Lifecycle filters */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
            {LIFECYCLE_FILTERS.map((f) => (
              <LifecycleFilterButton
                key={f.value}
                filter={f}
                current={lifecycleFilter}
                count={filterCounts[f.value]}
                onClick={setLifecycleFilter}
              />
            ))}
          </div>
        </div>
      )}

      {/* Assignments list */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-4 flex items-center justify-between gap-2">
          <p className="font-bold text-foreground">
            {loadingAssignments
              ? "Loading…"
              : `${filtered.length} assignment${filtered.length === 1 ? "" : "s"}`}
            {lifecycleFilter !== "ALL" && (
              <span className="ml-1.5 text-xs font-semibold text-muted-foreground">
                · {LIFECYCLE_DISPLAY[lifecycleFilter].label}
              </span>
            )}
          </p>
        </div>

        {!selectedClassroomId ? (
          <div className="p-8 text-center text-muted-foreground">
            <School className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">Select a classroom to view assignments.</p>
          </div>
        ) : loadingAssignments ? (
          <div className="flex justify-center p-10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <ClipboardCheck className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">
              {assignments.length === 0
                ? "No assignments in this classroom yet."
                : `No ${lifecycleFilter !== "ALL" ? LIFECYCLE_DISPLAY[lifecycleFilter].label.toLowerCase() : ""} assignments.`}
            </p>
            {assignments.length === 0 && (
              <button
                type="button"
                onClick={() => { setEditingAssignment(null); setCreateOpen(true); }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create first assignment
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((a) => {
              const hw = (a as Assignment & {
                assessment_homework?: {
                  homework_id: number;
                  set?: { id: number; subject: string; title: string; description: string; category: string } | null;
                } | null;
              }).assessment_homework ?? null;
              const pinnedSet = hw?.set ?? null;
              const dueLabel = formatAssignmentDue(a.due_at);
              const dueFull = formatAssignmentDueFull(a.due_at);

              return (
                <div
                  key={`${a.classroomId}-${a.id}`}
                  className={cn(
                    "px-5 py-4 space-y-2",
                    a.lifecycleState === "OVERDUE" && "bg-red-50/40",
                    a.lifecycleState === "DUE_SOON" && "bg-orange-50/30",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Title + lifecycle badge */}
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-extrabold text-foreground truncate">
                          {a.title ?? "Untitled assignment"}
                        </p>
                        <AssignmentStateChip state={a.lifecycleState} />
                      </div>

                      {/* Snapshot lineage */}
                      <AssignmentLineage
                        setTitle={pinnedSet?.title}
                        setId={pinnedSet?.id}
                        subject={pinnedSet?.subject ?? a.subject}
                        setIsPublished={pinnedSet != null}
                        className="mb-1.5"
                      />

                      {/* Timing + submissions */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span
                          title={dueFull}
                          className={cn(
                            "inline-flex items-center gap-1",
                            a.lifecycleState === "OVERDUE" && "font-bold text-red-700",
                            a.lifecycleState === "DUE_SOON" && "font-bold text-orange-700",
                          )}
                        >
                          <Calendar className="h-3 w-3 shrink-0" />
                          {dueFull}
                        </span>
                        <SubmissionProgress
                          submitted={a.submissions_count ?? 0}
                          total={a.classroomMemberCount ?? null}
                          isOverdue={a.lifecycleState === "OVERDUE"}
                        />
                        {a.lifecycleState === "OVERDUE" || a.lifecycleState === "DUE_SOON" ? (
                          <span
                            className={cn(
                              "font-black tabular-nums",
                              a.lifecycleState === "OVERDUE" ? "text-red-700" : "text-orange-700",
                            )}
                          >
                            {dueLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAssignment(a as unknown as Record<string, unknown>);
                          setCreateOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                      >
                        Edit
                      </button>
                      {confirmDeleteId === a.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDeleteConfirmed(a)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 transition-colors"
                          >
                            Yes, delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteErrors((prev) => { const n = { ...prev }; delete n[a.id]; return n; });
                            setConfirmDeleteId(a.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                      <Link
                        href={`/classes/${a.classroomId}/assignments/${a.id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
                      >
                        View
                      </Link>
                    </div>
                  </div>

                  {/* Inline delete confirmation */}
                  {confirmDeleteId === a.id && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                      <p className="text-sm font-semibold text-red-800">
                        Delete <span className="font-extrabold">"{a.title}"</span>? This cannot be undone.
                      </p>
                    </div>
                  )}
                  {deleteErrors[a.id] && (
                    <p className="text-sm font-semibold text-red-700">{deleteErrors[a.id]}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Snapshot governance note */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 flex items-start gap-3">
        <div className="rounded-xl bg-blue-100 p-1.5 shrink-0">
          <ClipboardCheck className="h-4 w-4 text-blue-700" />
        </div>
        <div>
          <p className="text-sm font-bold text-blue-900">Assignments are pinned to snapshots</p>
          <p className="text-sm text-blue-800 mt-0.5">
            Each assignment references a specific published assessment set. Editing content in the
            questions console does not affect existing assignments — students always see the version
            that was live when the assignment was created.
          </p>
        </div>
      </div>

      {/* Create/edit modal */}
      {selectedClassroomId ? (
        <CreateAssignmentModal
          open={createOpen}
          classId={selectedClassroomId}
          editingAssignment={editingAssignment}
          onClose={() => { setCreateOpen(false); setEditingAssignment(null); }}
          onSuccess={async () => {
            await loadAssignments(selectedClassroomId);
            setEditingAssignment(null);
          }}
        />
      ) : null}
    </div>
  );
}
