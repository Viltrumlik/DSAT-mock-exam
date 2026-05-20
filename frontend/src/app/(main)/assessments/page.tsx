"use client";

/**
 * /assessments — Student assessment workspace
 *
 * Pedagogical framing: "What am I learning and improving?"
 * Data source: GET /api/classes/my-assignments/ (single endpoint, no N+1)
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classesApi, assessmentsAdminApi } from "@/lib/api";
import type { Assignment } from "@/lib/criticalApiContract";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ExternalLink,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  Timer,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import AuthGuard from "@/components/AuthGuard";
import { useMe } from "@/hooks/useMe";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  deriveAssignmentLifecycleState,
  formatAssignmentDue,
  formatAssignmentDueFull,
} from "@/lib/assignmentLifecycle";

// ─── Types ────────────────────────────────────────────────────────────────────

type AssessmentSet = {
  id: number; subject: string; category: string; title: string; description: string;
};

type AssessmentHomework = {
  homework_id: number; set?: AssessmentSet | null;
};

type AssignmentWithStatus = Assignment & {
  assessment_homework?: AssessmentHomework | null;
  workflow_status?: string | null;
  attempt_id?: number | null;
};

type AssessmentEntry = {
  assignment: AssignmentWithStatus;
  classroomId: number;
  classroomName: string;
  subject?: string;
  resumeHref?: string;
};

// ─── Student-facing assessment state ─────────────────────────────────────────

type AssessmentStudentState =
  | "IN_PROGRESS" | "SUBMITTED" | "COMPLETED" | "OVERDUE" | "DUE_SOON" | "NOT_STARTED";

function deriveStudentState(entry: AssessmentEntry): AssessmentStudentState {
  const ws = entry.assignment.workflow_status;
  if (ws === "graded" || ws === "completed") return "COMPLETED";
  if (ws === "submitted") return "SUBMITTED";
  if (ws === "in_progress") return "IN_PROGRESS";
  const temporal = deriveAssignmentLifecycleState(entry.assignment);
  if (temporal === "OVERDUE") return "OVERDUE";
  if (temporal === "DUE_SOON") return "DUE_SOON";
  return "NOT_STARTED";
}

const STUDENT_STATE_DISPLAY: Record<
  AssessmentStudentState,
  { label: string; badgeClasses: string; rowClasses: string; description: string; priority: number }
> = {
  IN_PROGRESS: {
    label: "In progress", badgeClasses: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
    rowClasses: "bg-amber-50/40 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40", description: "Resume where you left off.", priority: 0,
  },
  OVERDUE: {
    label: "Overdue", badgeClasses: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
    rowClasses: "bg-red-50/30 border-red-200 dark:bg-red-950/20 dark:border-red-800/40", description: "Past the due date.", priority: 1,
  },
  DUE_SOON: {
    label: "Due soon", badgeClasses: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-400",
    rowClasses: "bg-orange-50/20 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800/40", description: "Due within 48 hours.", priority: 2,
  },
  NOT_STARTED: {
    label: "Not started", badgeClasses: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
    rowClasses: "border-border", description: "Not started yet.", priority: 3,
  },
  SUBMITTED: {
    label: "Submitted", badgeClasses: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
    rowClasses: "border-border", description: "Grading in progress.", priority: 4,
  },
  COMPLETED: {
    label: "Completed", badgeClasses: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400",
    rowClasses: "border-border", description: "Graded and reviewed.", priority: 5,
  },
};

function sortEntries(entries: AssessmentEntry[]): AssessmentEntry[] {
  return [...entries].sort((a, b) => {
    const pa = STUDENT_STATE_DISPLAY[deriveStudentState(a)].priority;
    const pb = STUDENT_STATE_DISPLAY[deriveStudentState(b)].priority;
    if (pa !== pb) return pa - pb;
    const da = a.assignment.due_at ? new Date(a.assignment.due_at).getTime() : Infinity;
    const db = b.assignment.due_at ? new Date(b.assignment.due_at).getTime() : Infinity;
    return da - db;
  });
}

type FilterValue = "all" | "pending" | "in_progress" | "completed";

// ─── Continue Learning ──────────────────────────────────────────────────────

function ContinueLearningSection({ entries }: { entries: AssessmentEntry[] }) {
  const inProgress = entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS");
  if (inProgress.length === 0) return null;

  return (
    <section aria-label="Continue learning">
      <div className="flex items-center gap-2 mb-3">
        <PlayCircle className="h-4 w-4 text-primary shrink-0" />
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Continue Learning</h2>
        <span className="rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-black text-amber-800 dark:text-amber-400 tabular-nums">
          {inProgress.length} in progress
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {inProgress.map((entry) => {
          const href = entry.resumeHref ?? `/assessments/${entry.assignment.id}`;
          const set = entry.assignment.assessment_homework?.set;
          const title = entry.assignment.title ?? set?.title ?? "Assignment";
          const subject = set?.subject ?? entry.subject;
          const subjectLabel = subject === "MATH" ? "Math" : subject === "READING_WRITING" || subject === "ENGLISH" ? "Reading & Writing" : subject ?? null;
          const dueRelative = formatAssignmentDue(entry.assignment.due_at);
          const isOverdue = deriveAssignmentLifecycleState(entry.assignment) === "OVERDUE";

          return (
            <Link key={`resume-${entry.classroomId}-${entry.assignment.id}`} href={href}
              className="group flex flex-col gap-3 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-950/20 p-4 transition-all hover:border-primary/30 hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-foreground truncate text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.classroomName}</p>
                </div>
                {subjectLabel && (
                  <span className={cn("rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0",
                    subjectLabel === "Math" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400")}>
                    {subjectLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className={cn("text-xs font-bold", isOverdue ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>{dueRelative}</p>
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground group-hover:bg-primary/90 transition-colors">
                  <PlayCircle className="h-3.5 w-3.5" /> Resume
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StateChip({ state }: { state: AssessmentStudentState }) {
  const spec = STUDENT_STATE_DISPLAY[state];
  return (
    <span title={spec.description} className={cn("inline-flex items-center rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide shrink-0", spec.badgeClasses)}>
      {spec.label}
    </span>
  );
}

function ActionButton({ entry, state }: { entry: AssessmentEntry; state: AssessmentStudentState }) {
  const aid = entry.assignment.id;

  if (state === "COMPLETED" || state === "SUBMITTED") {
    return (
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        <Link href={`/assessments/result/${aid}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors">
          <CheckCircle2 className="h-3.5 w-3.5" /> {state === "SUBMITTED" ? "View" : "Review"}
        </Link>
        {state === "COMPLETED" && (
          <Link href={`/assessments/${aid}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-surface-2 transition-colors">
            <RefreshCw className="h-3 w-3" /> Retry
          </Link>
        )}
      </div>
    );
  }

  const href = state === "IN_PROGRESS" && entry.resumeHref ? entry.resumeHref : `/assessments/${aid}`;
  const config = {
    IN_PROGRESS: { label: "Resume", icon: PlayCircle, primary: true },
    NOT_STARTED: { label: "Start", icon: PlayCircle, primary: true },
    OVERDUE: { label: "Submit now", icon: AlertTriangle, primary: true },
    DUE_SOON: { label: "Start", icon: Timer, primary: true },
    SUBMITTED: { label: "View", icon: ArrowRight, primary: false },
    COMPLETED: { label: "Review", icon: CheckCircle2, primary: false },
  }[state];

  const Icon = config.icon;
  return (
    <Link href={href}
      className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors shrink-0",
        config.primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-border bg-card text-foreground hover:bg-surface-2")}>
      <Icon className="h-3.5 w-3.5" /> {config.label}
    </Link>
  );
}

function AssessmentRow({ entry }: { entry: AssessmentEntry }) {
  const state = deriveStudentState(entry);
  const spec = STUDENT_STATE_DISPLAY[state];
  const set = entry.assignment.assessment_homework?.set;
  const title = entry.assignment.title ?? set?.title ?? "Assignment";
  const category = set?.category;
  const subject = set?.subject ?? entry.subject;
  const dueFull = formatAssignmentDueFull(entry.assignment.due_at);
  const dueRelative = formatAssignmentDue(entry.assignment.due_at);
  const subjectLabel = subject === "MATH" ? "Math" : subject === "READING_WRITING" || subject === "ENGLISH" ? "Reading & Writing" : subject ?? null;

  return (
    <div className={cn("flex items-start gap-4 rounded-2xl border p-4 transition-colors", spec.rowClasses)}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-extrabold text-foreground text-sm leading-snug">{title}</p>
          <StateChip state={state} />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="font-semibold text-foreground/80">{entry.classroomName}</span>
          </span>
          {subjectLabel && (
            <span className={cn("rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
              subjectLabel === "Math" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400")}>
              {subjectLabel}
            </span>
          )}
          {category && <span className="rounded-lg bg-surface-2 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{category}</span>}
        </div>
        {entry.assignment.due_at && (
          <p className={cn("text-xs font-semibold",
            state === "OVERDUE" ? "text-red-700 dark:text-red-400 font-bold" :
            state === "DUE_SOON" ? "text-orange-700 dark:text-orange-400 font-bold" :
            "text-muted-foreground")}>
            {dueFull}
            {(state === "OVERDUE" || state === "DUE_SOON") && <span className="ml-1.5 font-black tabular-nums"> · {dueRelative}</span>}
          </p>
        )}
      </div>
      <ActionButton entry={entry} state={state} />
    </div>
  );
}

// ─── Admin section ──────────────────────────────────────────────────────────

type AdminSetRow = { id: number; title: string; subject: string; category: string; description: string; is_active: boolean; question_count?: number };

function AdminAssessmentSection() {
  const [sets, setSets] = useState<AdminSetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    assessmentsAdminApi
      .adminListSets({ limit: 50 })
      .then((data: { results?: AdminSetRow[] }) => {
        setSets(Array.isArray(data.results) ? data.results : Array.isArray(data) ? data as unknown as AdminSetRow[] : []);
      })
      .catch(() => setSets([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-2xl border border-primary/20 bg-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-foreground">Assessment Management</h2>
          <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Admin</span>
        </div>
        <Link href="/ops/assessments" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
          Full builder <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      {loading ? (
        <div className="h-20 rounded-xl bg-surface-2 animate-pulse" />
      ) : sets.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assessment sets" description="Create your first assessment set to get started."
          action={<Link href="/ops/assessments" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"><Plus className="h-3.5 w-3.5" /> Create set</Link>} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sets.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/50 p-4 transition-colors hover:border-primary/20">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-foreground text-sm truncate">{s.title}</p>
                  {!s.is_active && <span className="rounded-lg bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[9px] font-bold text-amber-800 dark:text-amber-400 uppercase">Draft</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={cn("rounded-lg px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                    s.subject === "math" || s.subject === "MATH" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400")}>
                    {s.subject === "math" || s.subject === "MATH" ? "Math" : "R&W"}
                  </span>
                  {s.category && <span className="rounded-lg bg-surface-2 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground">{s.category}</span>}
                  {s.question_count != null && <span className="text-muted-foreground font-semibold">{s.question_count}q</span>}
                </div>
              </div>
              <Link href={`/ops/assessments/${s.id}`}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
                Edit <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

function AssessmentWorkspace() {
  const { me } = useMe();
  const roleRaw = String(me?.role ?? "").trim().toLowerCase();
  const perms = Array.isArray((me as Record<string, unknown> | undefined)?.permissions)
    ? ((me as Record<string, unknown>).permissions as string[]) : [];
  const isStaff = perms.includes("*") || perms.includes("manage_users") || perms.includes("assign_access") || perms.includes("manage_tests") || roleRaw === "admin" || roleRaw === "teacher";

  const [entries, setEntries] = useState<AssessmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");

  const load = async () => {
    setLoading(true); setError(null); setEntries([]);
    try {
      const { items } = await classesApi.myAssignments();
      const collected: AssessmentEntry[] = [];
      for (const a of items) {
        const rich = a as AssignmentWithStatus & { classroom_id?: number; classroom_name?: string };
        if (!rich.assessment_homework) continue;
        const classroomId = rich.classroom_id ?? 0;
        const classroomName = rich.classroom_name ?? `Class #${classroomId}`;
        const resumeHref = rich.workflow_status === "in_progress" && rich.attempt_id ? `/assessments/attempt/${rich.attempt_id}` : undefined;
        collected.push({ assignment: rich, classroomId, classroomName, subject: rich.assessment_homework?.set?.subject, resumeHref });
      }
      setEntries(sortEntries(collected));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not load your assessments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "pending") return entries.filter((e) => { const s = deriveStudentState(e); return s === "IN_PROGRESS" || s === "NOT_STARTED" || s === "OVERDUE" || s === "DUE_SOON"; });
    if (filter === "in_progress") return entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS");
    if (filter === "completed") return entries.filter((e) => { const s = deriveStudentState(e); return s === "COMPLETED" || s === "SUBMITTED"; });
    return entries;
  }, [entries, filter]);

  const counts = useMemo(() => ({
    pending: entries.filter((e) => { const s = deriveStudentState(e); return s === "IN_PROGRESS" || s === "NOT_STARTED" || s === "OVERDUE" || s === "DUE_SOON"; }).length,
    in_progress: entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS").length,
    completed: entries.filter((e) => { const s = deriveStudentState(e); return s === "COMPLETED" || s === "SUBMITTED"; }).length,
    overdue: entries.filter((e) => deriveStudentState(e) === "OVERDUE").length,
    dueSoon: entries.filter((e) => deriveStudentState(e) === "DUE_SOON").length,
  }), [entries]);

  const completionPct = entries.length > 0 ? Math.round((counts.completed / entries.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 lg:px-6">

      {/* Header */}
      <PageHeader
        eyebrow="Learning"
        title="My Assessments"
        description="Homework and assessments assigned by your teachers."
        actions={!loading ? (
          <button type="button" onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        ) : undefined}
      />

      {/* Stats Row */}
      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={entries.length} icon={ClipboardCheck}
            accent="text-primary bg-primary/10" />
          <StatCard label="Pending" value={counts.pending} icon={Clock}
            accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40" />
          <StatCard label="Completed" value={counts.completed} icon={Trophy}
            accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40" />
          <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
            <ProgressRing value={completionPct} size={48} strokeWidth={5}
              color={completionPct >= 80 ? "text-emerald-500" : "text-primary"} />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Done</p>
              <p className="text-xl font-black tabular-nums text-foreground">{completionPct}%</p>
            </div>
          </div>
        </div>
      )}

      {/* Admin section */}
      {isStaff && <AdminAssessmentSection />}

      {/* Continue Learning */}
      {!loading && <ContinueLearningSection entries={entries} />}

      {/* Attention banner */}
      {!loading && (counts.overdue > 0 || counts.dueSoon > 0) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Work needs attention</p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {counts.overdue > 0 && <span className="font-bold text-red-800 dark:text-red-400">{counts.overdue} overdue</span>}
              {counts.overdue > 0 && counts.dueSoon > 0 && <span> · </span>}
              {counts.dueSoon > 0 && <span className="font-bold text-orange-800 dark:text-orange-400">{counts.dueSoon} due within 48h</span>}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {([
            { value: "all" as FilterValue, label: `All (${entries.length})` },
            { value: "pending" as FilterValue, label: `Pending (${counts.pending})` },
            { value: "in_progress" as FilterValue, label: `In progress (${counts.in_progress})` },
            { value: "completed" as FilterValue, label: `Completed (${counts.completed})` },
          ]).map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              className={cn("rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors",
                filter === f.value ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4 text-sm font-semibold text-red-700 dark:text-red-400">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" /> Loading assessments...
          </div>
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl ds-skeleton" />)}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && entries.length === 0 && (
        <EmptyState icon={ClipboardList} title="No assessments yet"
          description="Your teacher will assign assessments to your classroom. Check back after your next lesson."
          action={<Link href="/classes" className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors">View your classes</Link>} />
      )}

      {!loading && !error && entries.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-semibold text-muted-foreground">No {filter === "pending" ? "pending" : filter === "in_progress" ? "in-progress" : "completed"} assessments.</p>
          <button type="button" onClick={() => setFilter("all")} className="mt-2 text-xs font-bold text-primary hover:underline">Show all</button>
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2.5">
          {filtered.map((entry) => <AssessmentRow key={`${entry.classroomId}-${entry.assignment.id}`} entry={entry} />)}
        </div>
      )}

      {/* Domain separator */}
      {!loading && (
        <div className="rounded-2xl border border-border bg-card px-5 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Assessments</span> are classroom homework — not SAT simulation.
          </p>
          <Link href="/mock-exam" className="shrink-0 text-xs font-bold text-primary hover:underline">Go to mock exams</Link>
        </div>
      )}
    </div>
  );
}

export default function AssessmentsPage() {
  return <AuthGuard><AssessmentWorkspace /></AuthGuard>;
}
