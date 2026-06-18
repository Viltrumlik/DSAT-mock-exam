"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  ClipboardList,
  CheckCircle2,
  Trophy,
  GraduationCap,
  Users,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Sparkles,
  CalendarClock,
  CalendarCheck,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { Card, CardHeader } from "../ui/Surface";
import { StatCard, Button, EmptyState, LoadingState, Pill } from "../ui";
import type { PillTone } from "../ui";
import { capabilitiesFor } from "../capabilities";
import { useStudentWorkspace, useInterventions, useClassMembers } from "../hooks";
import { useRankings } from "../rankingsHooks";
import { useMyAttendance } from "../attendanceHooks";
import { SubmissionStatusPill } from "./statusPill";
import type { ClassroomWithRole, WorkspaceAssignment, InterventionRow } from "../types";
import type { RankingRow } from "../rankingsApi";
import type { ClassroomTabId } from "../shell/tabs";

function personName(u?: { first_name?: string; last_name?: string; email?: string }): string {
  if (!u) return "Student";
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || u.email || "Student";
}

function dueLabel(due?: string | null): string {
  if (!due) return "No deadline";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "No deadline";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function assignmentHref(classId: number, a: WorkspaceAssignment): string {
  // Always land on the in-class assignment detail page so the student sees the instructions
  // and all attached activities (an assignment may bundle several — past paper, assessment,
  // practice test). The detail page deep-links into each activity.
  return `/classes/${classId}/assignments/${a.id}`;
}

/** Role-aware classroom dashboard. Student → personal focus; staff → class health. */
export function ClassroomOverview({
  classroom,
  onNavigate,
}: {
  classroom: ClassroomWithRole;
  onNavigate: (tab: ClassroomTabId) => void;
}) {
  const caps = capabilitiesFor(classroom.my_role);
  return caps.isStaff ? (
    <TeacherOverview classroom={classroom} onNavigate={onNavigate} />
  ) : (
    <StudentOverview classroom={classroom} onNavigate={onNavigate} />
  );
}

// Done = submitted or graded; everything else (incl. no submission, returned) needs action.
function needsAction(status?: string | null): boolean {
  return status !== "SUBMITTED" && status !== "REVIEWED";
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketByDue(items: WorkspaceAssignment[]) {
  const today = startOfTodayMs();
  const tomorrow = today + 86_400_000;
  const dueToday: WorkspaceAssignment[] = [];
  const overdue: WorkspaceAssignment[] = [];
  const upcoming: WorkspaceAssignment[] = [];
  for (const a of items) {
    const t = a.due_at ? new Date(a.due_at).getTime() : NaN;
    if (Number.isNaN(t)) upcoming.push(a);
    else if (t < today) overdue.push(a);
    else if (t < tomorrow) dueToday.push(a);
    else upcoming.push(a);
  }
  const byDue = (x: WorkspaceAssignment, y: WorkspaceAssignment) =>
    new Date(x.due_at ?? 0).getTime() - new Date(y.due_at ?? 0).getTime();
  return { dueToday: dueToday.sort(byDue), overdue: overdue.sort(byDue), upcoming: upcoming.sort(byDue) };
}

/**
 * Student overview — answers "What should I do next?" first. Action lists in priority
 * order (due today → catch up → up next), then compact SAT/Academic standing, attendance,
 * and a single quiet link to deeper analytics. No charts here (see growth-oriented-language).
 */
function StudentOverview({ classroom, onNavigate }: { classroom: ClassroomWithRole; onNavigate: (t: ClassroomTabId) => void }) {
  const classId = Number(classroom.id);
  const { data, isLoading } = useStudentWorkspace(classId);
  const sat = useRankings(classId, "SAT");
  const academic = useRankings(classId, "ACADEMIC");
  const attendance = useMyAttendance(classId);

  if (isLoading) return <LoadingState label="Loading your work…" />;

  const action = (data?.your_assignments ?? []).filter((a) => needsAction(a.workflow_status));
  const { dueToday, overdue, upcoming } = bucketByDue(action);
  const nothingToDo = dueToday.length + overdue.length + upcoming.length === 0;

  return (
    <div className="space-y-6">
      {nothingToDo ? (
        <Card>
          <EmptyState icon={Sparkles} title="You're all caught up" description="Nothing to do right now. New work will show up here." />
        </Card>
      ) : (
        <div className="space-y-4">
          {dueToday.length > 0 && <WorkSection classId={classId} title="Due today" tone="info" items={dueToday} when="today" />}
          {overdue.length > 0 && (
            <WorkSection classId={classId} title="Catch up" tone="warning" items={overdue} when="past" description="Past due — best to finish these next" />
          )}
          {upcoming.length > 0 && (
            <WorkSection classId={classId} title="Up next" tone="neutral" items={upcoming} when="future"
              action={<Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => onNavigate("assignments")}>All work</Button>} />
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <StandingCard title="SAT standing" icon={Trophy} my={sat.data?.my ?? null} loading={sat.isLoading} onOpen={() => onNavigate("rankings")} />
        <StandingCard title="Academic standing" icon={GraduationCap} my={academic.data?.my ?? null} loading={academic.isLoading} onOpen={() => onNavigate("rankings")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LinkTile icon={CalendarCheck} accent="bg-emerald-500/10 text-emerald-600" label="Attendance"
          value={attendance.data?.attendance_score != null ? `${attendance.data.attendance_score}%` : "—"} onClick={() => onNavigate("attendance")} />
        <LinkTile icon={BarChart3} accent="bg-primary/10 text-primary" label="Progress"
          value="See your full progress" onClick={() => onNavigate("analytics")} />
      </div>
    </div>
  );
}

const TONE_DOT: Record<string, string> = { info: "bg-sky-500", warning: "bg-amber-500", neutral: "bg-slate-400" };

function whenLabel(a: WorkspaceAssignment, when: "today" | "past" | "future"): string {
  if (when === "today") return "Due today";
  if (when === "past") return `Was due ${dueLabel(a.due_at)}`;
  return a.due_at ? `Due ${dueLabel(a.due_at)}` : "No deadline";
}

function WorkSection({ classId, title, tone, items, when, description, action }: {
  classId: number;
  title: string;
  tone: "info" | "warning" | "neutral";
  items: WorkspaceAssignment[];
  when: "today" | "past" | "future";
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", TONE_DOT[tone])} />
            {title}
            <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
          </span>
        }
        description={description}
        actions={action}
      />
      <div className="mt-4 space-y-2">
        {items.slice(0, 8).map((a) => (
          <Link key={a.id} href={assignmentHref(classId, a)}
            className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-surface-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{a.title}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" /> {whenLabel(a, when)}
              </p>
            </div>
            <SubmissionStatusPill status={a.workflow_status} />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function StandingCard({ title, icon: Icon, my, loading, onOpen }: {
  title: string; icon: React.ElementType; my: RankingRow | null; loading: boolean; onOpen: () => void;
}) {
  const trendMap: Record<string, { tone: PillTone; Icon: React.ElementType; label: string }> = {
    IMPROVING: { tone: "success", Icon: TrendingUp, label: "Improving" },
    DECLINING: { tone: "warning", Icon: TrendingDown, label: "Declining" },
    STABLE: { tone: "neutral", Icon: Minus, label: "Steady" },
  };
  const tr = my?.trend ? trendMap[my.trend] : null;
  return (
    <button onClick={onOpen} className="group rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:bg-surface-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" /> {title}</span>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : my ? (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold text-foreground">#{my.rank}</p>
            {my.score != null && (
              <p className="text-xs text-muted-foreground">
                {Math.round(my.score)} pts{my.percentile != null ? ` · Top ${Math.max(1, Math.round(100 - my.percentile))}%` : ""}
              </p>
            )}
          </div>
          {tr && <Pill tone={tr.tone}><tr.Icon className="h-3 w-3" /> {tr.label}</Pill>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Not ranked yet — complete work to join.</p>
      )}
    </button>
  );
}

function LinkTile({ icon: Icon, accent, label, value, onClick }: {
  icon: React.ElementType; accent: string; label: string; value: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", accent)}><Icon className="h-5 w-5" /></div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-base font-semibold text-foreground">{value}</p>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}

function TeacherOverview({ classroom, onNavigate }: { classroom: ClassroomWithRole; onNavigate: (t: ClassroomTabId) => void }) {
  const classId = Number(classroom.id);
  const iv = useInterventions(classId);
  const members = useClassMembers(classId);

  const memberList = Array.isArray(members.data) ? members.data : members.data?.members ?? [];
  const studentCount = memberList.filter((m) => String(m.role).toUpperCase() === "STUDENT").length;
  const completion = iv.data?.completion_rate;
  const attention: InterventionRow[] = [
    ...(iv.data?.overdue ?? []),
    ...(iv.data?.inactive ?? []),
    ...(iv.data?.low_scores ?? []),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Students" value={studentCount || (members.isLoading ? "—" : 0)} icon={Users} />
        <StatCard
          label="Completion"
          value={completion != null ? `${Math.round(Number(completion) * (Number(completion) <= 1 ? 100 : 1))}%` : "—"}
          icon={CheckCircle2}
          accent="text-emerald-600 bg-emerald-500/10"
        />
        <StatCard label="Needs attention" value={iv.isLoading ? "—" : attention.length} icon={AlertCircle} accent="text-amber-600 bg-amber-500/10" />
        <StatCard label="Rankings" value="View" icon={Trophy} accent="text-amber-600 bg-amber-500/10" onClick={() => onNavigate("rankings")} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={ClipboardList} onClick={() => onNavigate("assignments")}>New assignment</Button>
        <Button size="sm" variant="secondary" icon={CalendarClock} onClick={() => onNavigate("attendance")}>Take attendance</Button>
        <Button size="sm" variant="secondary" icon={Users} onClick={() => onNavigate("people")}>Manage people</Button>
      </div>

      <Card>
        <CardHeader title="Needs attention" description="Students who could use a nudge" />
        <div className="mt-4 space-y-2">
          {iv.isLoading ? (
            <LoadingState label="Checking in on students…" />
          ) : attention.length === 0 ? (
            <EmptyState icon={Sparkles} title="Everyone's on track" description="No students need attention right now." />
          ) : (
            attention.slice(0, 8).map((row, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{personName(row.user)}</p>
                  {(row.detail || row.assignment?.title) && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.detail ?? row.assignment?.title}</p>
                  )}
                </div>
                {row.value != null && <Pill tone="warning">{String(row.value)}</Pill>}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
