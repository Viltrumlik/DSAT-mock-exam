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
import {
  Card, CardContent, Badge, Button, Stat, ProgressRing, EmptyState, Alert, Skeleton,
  type BadgeVariant,
} from "@/components/ui";
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

// ─── Student-facing assessment state (logic preserved) ───────────────────────

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

// Growth-oriented labels + positive/neutral tones (no "Overdue"/red).
const STUDENT_STATE_DISPLAY: Record<
  AssessmentStudentState,
  { label: string; variant: BadgeVariant; description: string; priority: number }
> = {
  IN_PROGRESS: { label: "In progress", variant: "warning", description: "Resume where you left off.", priority: 0 },
  OVERDUE: { label: "Needs attention", variant: "warning", description: "Past the due date.", priority: 1 },
  DUE_SOON: { label: "Due soon", variant: "info", description: "Due within 48 hours.", priority: 2 },
  NOT_STARTED: { label: "Not started", variant: "neutral", description: "Not started yet.", priority: 3 },
  SUBMITTED: { label: "Submitted", variant: "info", description: "Grading in progress.", priority: 4 },
  COMPLETED: { label: "Completed", variant: "success", description: "Graded and reviewed.", priority: 5 },
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

function subjectMeta(subject?: string): { label: string; variant: BadgeVariant } | null {
  if (subject === "MATH") return { label: "Math", variant: "success" };
  if (subject === "READING_WRITING" || subject === "ENGLISH") return { label: "Reading & Writing", variant: "info" };
  return subject ? { label: subject, variant: "neutral" } : null;
}

// ─── Continue Learning ──────────────────────────────────────────────────────

function ContinueLearningSection({ entries }: { entries: AssessmentEntry[] }) {
  const inProgress = entries.filter((e) => deriveStudentState(e) === "IN_PROGRESS");
  if (inProgress.length === 0) return null;

  return (
    <section aria-label="Continue learning">
      <div className="mb-3 flex items-center gap-2">
        <PlayCircle className="h-4 w-4 shrink-0 text-primary" />
        <h2 className="ds-h4">Continue learning</h2>
        <Badge variant="warning">{inProgress.length} in progress</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {inProgress.map((entry) => {
          const href = entry.resumeHref ?? `/assessments/${entry.assignment.id}`;
          const set = entry.assignment.assessment_homework?.set;
          const title = entry.assignment.title ?? set?.title ?? "Assignment";
          const subj = subjectMeta(set?.subject ?? entry.subject);
          const dueRelative = formatAssignmentDue(entry.assignment.due_at);

          return (
            <Link key={`resume-${entry.classroomId}-${entry.assignment.id}`} href={href} className="ds-ring block rounded-2xl">
              <Card variant="interactive" className="h-full">
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">{title}</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">{entry.classroomName}</p>
                    </div>
                    {subj ? <Badge variant={subj.variant}>{subj.label}</Badge> : null}
                  </div>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <p className="text-[12px] font-bold text-muted-foreground">{dueRelative}</p>
                    <Badge variant="primary"><PlayCircle className="h-3.5 w-3.5" /> Resume</Badge>
                  </div>
                </CardContent>
              </Card>
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
  return <span title={spec.description}><Badge variant={spec.variant}>{spec.label}</Badge></span>;
}

function ActionButton({ entry, state }: { entry: AssessmentEntry; state: AssessmentStudentState }) {
  const aid = entry.assignment.id;

  if (state === "COMPLETED" || state === "SUBMITTED") {
    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Link href={`/assessments/result/${aid}`}><Button variant="secondary" size="sm" leftIcon={<CheckCircle2 />}>{state === "SUBMITTED" ? "View" : "Review"}</Button></Link>
        {state === "COMPLETED" ? (
          <Link href={`/assessments/${aid}`}><Button variant="ghost" size="sm" leftIcon={<RefreshCw />}>Retry</Button></Link>
        ) : null}
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
    <Link href={href} className="shrink-0">
      <Button variant={config.primary ? "primary" : "secondary"} size="sm" leftIcon={<Icon />}>{config.label}</Button>
    </Link>
  );
}

function AssessmentRow({ entry }: { entry: AssessmentEntry }) {
  const state = deriveStudentState(entry);
  const set = entry.assignment.assessment_homework?.set;
  const title = entry.assignment.title ?? set?.title ?? "Assignment";
  const category = set?.category;
  const subj = subjectMeta(set?.subject ?? entry.subject);
  const dueFull = formatAssignmentDueFull(entry.assignment.due_at);
  const dueRelative = formatAssignmentDue(entry.assignment.due_at);
  const attention = state === "OVERDUE" || state === "DUE_SOON";

  return (
    <Card>
      <CardContent className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold leading-snug text-foreground">{title}</p>
            <StateChip state={state} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><BookOpen className="h-3 w-3 shrink-0" /><span className="font-semibold text-foreground/80">{entry.classroomName}</span></span>
            {subj ? <Badge variant={subj.variant}>{subj.label}</Badge> : null}
            {category ? <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{category}</span> : null}
          </div>
          {entry.assignment.due_at ? (
            <p className={cn("text-[12px] font-semibold", attention ? "text-warning-foreground" : "text-muted-foreground")}>
              {dueFull}
              {attention ? <span className="ml-1.5 font-bold"> · {dueRelative}</span> : null}
            </p>
          ) : null}
        </div>
        <ActionButton entry={entry} state={state} />
      </CardContent>
    </Card>
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
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 shrink-0 text-primary" />
            <h2 className="ds-h4">Assessment management</h2>
            <Badge variant="primary">Admin</Badge>
          </div>
          <Link href="/ops/assessments" className="ds-ring inline-flex items-center gap-1 rounded-lg text-xs font-bold text-primary hover:underline">
            Full builder <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-20 rounded-xl" />
        ) : sets.length === 0 ? (
          <EmptyState compact icon={ClipboardList} title="No assessment sets" description="Create your first assessment set to get started."
            action={<Link href="/ops/assessments"><Button size="sm" leftIcon={<Plus />}>Create set</Button></Link>} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {sets.map((s) => {
              const subj = subjectMeta(s.subject === "math" ? "MATH" : s.subject === "english" ? "ENGLISH" : s.subject?.toUpperCase());
              return (
                <div key={s.id} className="flex items-start gap-3 rounded-xl border border-border bg-surface-1 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-bold text-foreground">{s.title}</p>
                      {!s.is_active ? <Badge variant="warning">Draft</Badge> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {subj ? <Badge variant={subj.variant}>{subj.label === "Reading & Writing" ? "R&W" : subj.label}</Badge> : null}
                      {s.category ? <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{s.category}</span> : null}
                      {s.question_count != null ? <span className="font-semibold text-muted-foreground">{s.question_count}q</span> : null}
                    </div>
                  </div>
                  <Link href={`/ops/assessments/${s.id}`} className="shrink-0">
                    <Button variant="ghost" size="sm" rightIcon={<ExternalLink className="h-3 w-3" />}>Edit</Button>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Learn</p>
          <h1 className="ds-h1 mt-1">My assessments</h1>
          <p className="ds-small mt-1">Homework and assessments assigned by your teachers.</p>
        </div>
        {!loading ? <Button variant="secondary" leftIcon={<RefreshCw />} onClick={() => void load()}>Refresh</Button> : null}
      </div>

      {!loading && entries.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Total" value={entries.length} icon={ClipboardCheck} />
          <Stat label="Pending" value={counts.pending} icon={Clock} />
          <Stat label="Completed" value={counts.completed} icon={Trophy} />
          <Card><CardContent className="flex items-center gap-4">
            <ProgressRing value={completionPct} size={48} strokeWidth={5} color={completionPct >= 80 ? "text-success" : "text-primary"} />
            <div><p className="ds-overline">Done</p><p className="ds-num text-xl font-extrabold text-foreground">{completionPct}%</p></div>
          </CardContent></Card>
        </div>
      ) : null}

      {isStaff ? <AdminAssessmentSection /> : null}

      {!loading ? <ContinueLearningSection entries={entries} /> : null}

      {!loading && (counts.overdue > 0 || counts.dueSoon > 0) ? (
        <Alert tone="warning" title="Work needs attention">
          {counts.overdue > 0 ? <span className="font-bold">{counts.overdue} past due</span> : null}
          {counts.overdue > 0 && counts.dueSoon > 0 ? <span> · </span> : null}
          {counts.dueSoon > 0 ? <span className="font-bold">{counts.dueSoon} due within 48h</span> : null}
        </Alert>
      ) : null}

      {!loading && entries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {([
            { value: "all" as FilterValue, label: `All (${entries.length})` },
            { value: "pending" as FilterValue, label: `Pending (${counts.pending})` },
            { value: "in_progress" as FilterValue, label: `In progress (${counts.in_progress})` },
            { value: "completed" as FilterValue, label: `Completed (${counts.completed})` },
          ]).map((f) => (
            <button key={f.value} type="button" onClick={() => setFilter(f.value)}
              className={cn("ds-ring rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                filter === f.value ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground")}>
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <Alert tone="danger" title={error}>Please refresh to try again.</Alert> : null}

      {loading ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assessments yet"
          description="Your teacher will assign assessments to your classroom. Check back after your next lesson."
          action={<Link href="/classes"><Button variant="secondary">View your classes</Button></Link>} />
      ) : null}

      {!loading && !error && entries.length > 0 && filtered.length === 0 ? (
        <EmptyState compact title="Nothing here right now" description="No assessments match this filter." action={<Button variant="ghost" size="sm" onClick={() => setFilter("all")}>Show all</Button>} />
      ) : null}

      {!loading && filtered.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {filtered.map((entry) => <AssessmentRow key={`${entry.classroomId}-${entry.assignment.id}`} entry={entry} />)}
        </div>
      ) : null}

      {!loading ? (
        <Card variant="soft"><CardContent className="flex items-center justify-between gap-3 py-3">
          <p className="text-[12px] text-muted-foreground"><span className="font-semibold text-foreground">Assessments</span> are classroom homework — not SAT simulation.</p>
          <Link href="/mock-exam" className="ds-ring shrink-0 rounded-lg text-[12px] font-bold text-primary hover:underline">Go to mock exams</Link>
        </CardContent></Card>
      ) : null}
    </div>
  );
}

export default function AssessmentsPage() {
  return <AuthGuard><AssessmentWorkspace /></AuthGuard>;
}
