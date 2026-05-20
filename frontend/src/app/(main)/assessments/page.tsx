"use client";

/**
 * /assessments — Student assessment workspace
 *
 * Pedagogical framing: "What am I learning and improving?"
 * NOT simulation framing: "How do I perform under SAT conditions?"
 *
 * Layout (top → bottom):
 *   1. "Continue Learning" — pinned in-progress assignments with direct resume links
 *   2. Attention banner (overdue/due-soon counts)
 *   3. Filter tabs (all / pending / in-progress / completed)
 *   4. Assignment list
 *   5. Domain separator
 *
 * Domain: Learning system (Assessment / Homework)
 * NOT: Simulation system (Pastpapers / Mock Exams)
 *
 * Data source: GET /api/classes/my-assignments/ (single endpoint, no N+1)
 * Fields used: workflow_status, assessment_homework, classroom_id, classroom_name,
 *              attempt_id (present when workflow_status == "in_progress")
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
  ClipboardList,
  ExternalLink,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/cn";
import AuthGuard from "@/components/AuthGuard";
import { useMe } from "@/hooks/useMe";
import {
  deriveAssignmentLifecycleState,
  formatAssignmentDue,
  formatAssignmentDueFull,
} from "@/lib/assignmentLifecycle";

// ─── Types ────────────────────────────────────────────────────────────────────

type AssessmentSet = {
  id: number;
  subject: string;
  category: string;
  title: string;
  description: string;
};

type AssessmentHomework = {
  homework_id: number;
  set?: AssessmentSet | null;
};

type AssignmentWithStatus = Assignment & {
  assessment_homework?: AssessmentHomework | null;
  workflow_status?: string | null;
  /** Present when workflow_status == "in_progress". Enables direct resume link. */
  attempt_id?: number | null;
};

type AssessmentEntry = {
  assignment: AssignmentWithStatus;
  classroomId: number;
  classroomName: string;
  subject?: string;
  /** Direct runner link when the assignment is in-progress. */
  resumeHref?: string;
};

// ─── Student-facing assessment state ─────────────────────────────────────────

/**
 * Combined lifecycle + attempt state for student-facing display.
 * Pedagogically meaningful, not database-oriented.
 */
type AssessmentStudentState =
  | "IN_PROGRESS"  // Attempt started but not submitted
  | "SUBMITTED"    // Submitted; grading in progress
  | "COMPLETED"    // Graded and results available
  | "OVERDUE"      // Past deadline, not started
  | "DUE_SOON"     // Due within 48h
  | "NOT_STARTED"; // Active, no attempt yet

function deriveStudentState(entry: AssessmentEntry): AssessmentStudentState {
  const ws = entry.assignment.workflow_status;
  // Attempt states take precedence over temporal states
  if (ws === "graded" || ws === "completed") return "COMPLETED";
  if (ws === "submitted") return "SUBMITTED";
  if (ws === "in_progress") return "IN_PROGRESS";
  // No attempt — derive from temporal lifecycle
  const temporal = deriveAssignmentLifecycleState(entry.assignment);
  if (temporal === "OVERDUE") return "OVERDUE";
  if (temporal === "DUE_SOON") return "DUE_SOON";
  return "NOT_STARTED";
}

// ─── State display config ─────────────────────────────────────────────────────

const STUDENT_STATE_DISPLAY: Record<
  AssessmentStudentState,
  {
    label: string;
    badgeClasses: string;
    rowClasses: string;
    description: string;
    priority: number;
  }
> = {
  IN_PROGRESS: {
    label: "In progress",
    badgeClasses: "bg-amber-100 text-amber-800",
    rowClasses: "bg-amber-50/40 border-amber-200",
    description: "You've started this. Resume where you left off.",
    priority: 0,
  },
  OVERDUE: {
    label: "Overdue",
    badgeClasses: "bg-red-100 text-red-800",
    rowClasses: "bg-red-50/30 border-red-200",
    description: "Past the due date. Submit as soon as possible.",
    priority: 1,
  },
  DUE_SOON: {
    label: "Due soon",
    badgeClasses: "bg-orange-100 text-orange-800",
    rowClasses: "bg-orange-50/20 border-orange-200",
    description: "Due within 48 hours.",
    priority: 2,
  },
  NOT_STARTED: {
    label: "Not started",
    badgeClasses: "bg-sky-100 text-sky-700",
    rowClasses: "border-border",
    description: "Not started yet.",
    priority: 3,
  },
  SUBMITTED: {
    label: "Submitted",
    badgeClasses: "bg-blue-100 text-blue-800",
    rowClasses: "border-border",
    description: "Submitted — grading in progress.",
    priority: 4,
  },
  COMPLETED: {
    label: "Completed",
    badgeClasses: "bg-emerald-100 text-emerald-800",
    rowClasses: "border-border",
    description: "Graded and reviewed.",
    priority: 5,
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

// ─── Filter config ────────────────────────────────────────────────────────────

type FilterValue = "all" | "pending" | "in_progress" | "completed";

// ─── Continue Learning section ────────────────────────────────────────────────

/**
 * Pinned at the top of the workspace. Shows only in-progress assignments.
 * Designed to feel like "resume your work" — not a progress dashboard.
 *
 * Direct resume link: when attempt_id is known, goes straight to the runner.
 * No interstitial. One click to pick up where you left off.
 */
function ContinueLearningSection({ entries }: { entries: AssessmentEntry[] }) {
  const inProgress = entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS");
  if (inProgress.length === 0) return null;

  return (
    <section aria-label="Continue learning">
      <div className="flex items-center gap-2 mb-2">
        <PlayCircle className="h-3.5 w-3.5 text-primary shrink-0" />
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-foreground">
          Continue learning
        </h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800 tabular-nums">
          {inProgress.length} in progress
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {inProgress.map((entry) => {
          const href = entry.resumeHref ?? `/assessments/${entry.assignment.id}`;
          const set = entry.assignment.assessment_homework?.set;
          const title = entry.assignment.title ?? set?.title ?? "Assignment";
          const subject = set?.subject ?? entry.subject;
          const subjectLabel =
            subject === "MATH" ? "Math" :
            subject === "READING_WRITING" || subject === "ENGLISH" ? "Reading & Writing" :
            subject ?? null;
          const dueRelative = formatAssignmentDue(entry.assignment.due_at);
          const isOverdue = deriveAssignmentLifecycleState(entry.assignment) === "OVERDUE";

          return (
            <Link
              key={`resume-${entry.classroomId}-${entry.assignment.id}`}
              href={href}
              className="group flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-extrabold text-foreground truncate text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{entry.classroomName}</p>
                </div>
                {subjectLabel && (
                  <span className={cn(
                    "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide shrink-0",
                    subjectLabel === "Math" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700",
                  )}>
                    {subjectLabel}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className={cn(
                  "text-xs font-bold",
                  isOverdue ? "text-red-700" : "text-amber-700",
                )}>
                  {dueRelative}
                </p>
                <span className="inline-flex items-center gap-1 rounded-xl bg-primary px-3 py-1.5 text-xs font-extrabold text-primary-foreground group-hover:bg-primary/90 transition-colors">
                  <PlayCircle className="h-3.5 w-3.5" />
                  Resume
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StateChip({ state }: { state: AssessmentStudentState }) {
  const spec = STUDENT_STATE_DISPLAY[state];
  return (
    <span
      title={spec.description}
      className={cn(
        "inline-flex items-center rounded-lg px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide shrink-0",
        spec.badgeClasses,
      )}
    >
      {spec.label}
    </span>
  );
}

function ActionButton({ entry, state }: { entry: AssessmentEntry; state: AssessmentStudentState }) {
  const aid = entry.assignment.id;

  // COMPLETED: primary action = review results; secondary = try again
  if (state === "COMPLETED" || state === "SUBMITTED") {
    return (
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
        <Link
          href={`/assessments/result/${aid}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {state === "SUBMITTED" ? "View" : "Review"}
        </Link>
        {state === "COMPLETED" && (
          <Link
            href={`/assessments/${aid}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </Link>
        )}
      </div>
    );
  }

  // For in-progress assignments, deep-link directly to the runner when attempt_id
  // is known (skips the start-page interstitial — one-click resume).
  const href =
    state === "IN_PROGRESS" && entry.resumeHref
      ? entry.resumeHref
      : `/assessments/${aid}`;
  const config = {
    IN_PROGRESS: { label: "Resume",      icon: PlayCircle,    primary: true },
    NOT_STARTED: { label: "Start",       icon: PlayCircle,    primary: true },
    OVERDUE:     { label: "Submit now",  icon: AlertTriangle, primary: true },
    DUE_SOON:    { label: "Start",       icon: Timer,         primary: true },
    SUBMITTED:   { label: "View",        icon: ArrowRight,    primary: false },
    COMPLETED:   { label: "Review",      icon: CheckCircle2,  primary: false },
  }[state];

  const Icon = config.icon;
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors shrink-0",
        config.primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border bg-card text-foreground hover:bg-surface-2",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
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

  const subjectLabel =
    subject === "MATH" ? "Math" :
    subject === "READING_WRITING" || subject === "ENGLISH" ? "Reading & Writing" :
    subject ?? null;

  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-2xl border p-4 transition-colors",
        spec.rowClasses,
      )}
    >
      {/* Left: content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Title + state chip */}
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-extrabold text-foreground text-sm leading-snug">{title}</p>
          <StateChip state={state} />
        </div>

        {/* Classroom context — always visible */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="font-semibold text-foreground/80">{entry.classroomName}</span>
          </span>
          {subjectLabel && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
                subjectLabel === "Math" ? "bg-purple-100 text-purple-700" : "bg-teal-100 text-teal-700",
              )}
            >
              {subjectLabel}
            </span>
          )}
          {category && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
              {category}
            </span>
          )}
        </div>

        {/* Due date */}
        {entry.assignment.due_at && (
          <p
            className={cn(
              "text-xs font-semibold",
              state === "OVERDUE" ? "text-red-700 font-bold" :
              state === "DUE_SOON" ? "text-orange-700 font-bold" :
              "text-muted-foreground",
            )}
          >
            {dueFull}
            {(state === "OVERDUE" || state === "DUE_SOON") && (
              <span className="ml-1.5 font-black tabular-nums">· {dueRelative}</span>
            )}
          </p>
        )}
      </div>

      {/* Right: action */}
      <ActionButton entry={entry} state={state} />
    </div>
  );
}

// ─── Admin assessment management section ─────────────────────────────────────

type AdminSetRow = {
  id: number;
  title: string;
  subject: string;
  category: string;
  description: string;
  is_active: boolean;
  question_count?: number;
};

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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-primary shrink-0" />
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-foreground">
            Assessment Management
          </h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-black text-primary tabular-nums">
            Admin
          </span>
        </div>
        <Link
          href="/ops/assessments"
          className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
        >
          Full builder
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div className="h-20 rounded-2xl border border-border bg-card animate-pulse" />
      ) : sets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">No assessment sets created yet.</p>
          <Link
            href="/ops/assessments"
            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            <Plus className="h-3 w-3" />
            Create assessment set
          </Link>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {sets.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/20"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-extrabold text-foreground text-sm truncate">{s.title}</p>
                  {!s.is_active && (
                    <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-800 uppercase">
                      Draft
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide",
                      s.subject === "math" || s.subject === "MATH"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-teal-100 text-teal-700",
                    )}
                  >
                    {s.subject === "math" || s.subject === "MATH" ? "Math" : "R&W"}
                  </span>
                  {s.category && (
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                      {s.category}
                    </span>
                  )}
                  {s.question_count != null && (
                    <span className="text-muted-foreground font-semibold">
                      {s.question_count} questions
                    </span>
                  )}
                </div>
              </div>
              <Link
                href={`/ops/assessments/${s.id}`}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-border bg-card px-2.5 py-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
              >
                Edit
                <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function AssessmentWorkspace() {
  const { me } = useMe();
  const roleRaw = String(me?.role ?? "").trim().toLowerCase();
  const perms = Array.isArray((me as Record<string, unknown> | undefined)?.permissions)
    ? ((me as Record<string, unknown>).permissions as string[])
    : [];
  const isStaff =
    perms.includes("*") ||
    perms.includes("manage_users") ||
    perms.includes("assign_access") ||
    perms.includes("manage_tests") ||
    roleRaw === "admin" ||
    roleRaw === "teacher";

  const [entries, setEntries] = useState<AssessmentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("all");

  const load = async () => {
    setLoading(true);
    setError(null);
    setEntries([]);
    try {

      // Single endpoint: all assignments across all enrolled classrooms
      const { items } = await classesApi.myAssignments();

      const collected: AssessmentEntry[] = [];
      for (const a of items) {
        const rich = a as AssignmentWithStatus & { classroom_id?: number; classroom_name?: string };
        // Only show assessment-type assignments (have `assessment_homework`)
        if (!rich.assessment_homework) continue;
        const classroomId = rich.classroom_id ?? 0;
        const classroomName = rich.classroom_name ?? `Class #${classroomId}`;
        // Direct resume link: if in-progress and attempt_id is known,
        // skip the start-page interstitial and go straight to the runner.
        const resumeHref =
          rich.workflow_status === "in_progress" && rich.attempt_id
            ? `/assessments/attempt/${rich.attempt_id}`
            : undefined;
        collected.push({
          assignment: rich,
          classroomId,
          classroomName,
          subject: rich.assessment_homework?.set?.subject,
          resumeHref,
        });
      }

      setEntries(sortEntries(collected));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof msg === "string" ? msg : "Could not load your assessments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "pending") {
      return entries.filter((e) => {
        const s = deriveStudentState(e);
        return s === "IN_PROGRESS" || s === "NOT_STARTED" || s === "OVERDUE" || s === "DUE_SOON";
      });
    }
    if (filter === "in_progress") {
      return entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS");
    }
    if (filter === "completed") {
      return entries.filter((e) => {
        const s = deriveStudentState(e);
        return s === "COMPLETED" || s === "SUBMITTED";
      });
    }
    return entries;
  }, [entries, filter]);

  const counts = useMemo(() => ({
    pending: entries.filter((e) => {
      const s = deriveStudentState(e);
      return s === "IN_PROGRESS" || s === "NOT_STARTED" || s === "OVERDUE" || s === "DUE_SOON";
    }).length,
    in_progress: entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS").length,
    completed: entries.filter((e) => {
      const s = deriveStudentState(e);
      return s === "COMPLETED" || s === "SUBMITTED";
    }).length,
    overdue: entries.filter((e) => deriveStudentState(e) === "OVERDUE").length,
    dueSoon: entries.filter((e) => deriveStudentState(e) === "DUE_SOON").length,
  }), [entries]);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">
            Learning
          </p>
          <h1 className="text-xl font-extrabold text-foreground tracking-tight">
            My assessments
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Homework and assessments assigned by your teachers.
          </p>
        </div>
        {!loading && (
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        )}
      </div>

      {/* Admin: assessment set management */}
      {isStaff && <AdminAssessmentSection />}

      {/* Continue Learning — pinned in-progress section */}
      {!loading && <ContinueLearningSection entries={entries} />}

      {/* Attention banner */}
      {!loading && (counts.overdue > 0 || counts.dueSoon > 0) && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-amber-900">
              Work needs attention
            </p>
            <p className="text-xs text-amber-700">
              {counts.overdue > 0 && (
                <span className="font-bold text-red-800">
                  {counts.overdue} overdue
                </span>
              )}
              {counts.overdue > 0 && counts.dueSoon > 0 && <span> · </span>}
              {counts.dueSoon > 0 && (
                <span className="font-bold text-orange-800">
                  {counts.dueSoon} due within 48 hours
                </span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { value: "all",          label: `All (${entries.length})` },
              { value: "pending",      label: `Pending (${counts.pending})` },
              { value: "in_progress",  label: `In progress (${counts.in_progress})` },
              { value: "completed",    label: `Completed (${counts.completed})` },
            ] as { value: FilterValue; label: string }[]
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors",
                filter === f.value
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Loading your assessments…
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty states */}
      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <ClipboardList className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="font-extrabold text-foreground">No assessments yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Your teacher will assign assessments to your classroom. Check back after your next lesson.
          </p>
          <Link
            href="/classes"
            className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
          >
            View your classes →
          </Link>
        </div>
      )}

      {!loading && !error && entries.length > 0 && filtered.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="font-semibold text-muted-foreground">
            No {filter === "pending" ? "pending" : filter === "in_progress" ? "in-progress" : "completed"} assessments.
          </p>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="mt-2 text-xs font-bold text-primary hover:underline"
          >
            Show all →
          </button>
        </div>
      )}

      {/* Assignment list */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2.5">
          {filtered.map((entry) => (
            <AssessmentRow
              key={`${entry.classroomId}-${entry.assignment.id}`}
              entry={entry}
            />
          ))}
        </div>
      )}

      {/* Domain separator — clear pedagogical boundary */}
      {!loading && (
        <div className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Assessments</span> are classroom homework —
            not SAT simulation.
          </p>
          <Link
            href="/mock-exam"
            className="shrink-0 text-xs font-bold text-primary hover:underline"
          >
            Go to mock exams →
          </Link>
        </div>
      )}
    </div>
  );
}

export default function AssessmentsPage() {
  return (
    <AuthGuard>
      <AssessmentWorkspace />
    </AuthGuard>
  );
}
