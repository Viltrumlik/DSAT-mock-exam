"use client";

import Link from "next/link";
import {
  Users, UserCheck, Gauge, ClipboardCheck, GraduationCap, ArrowRight,
  ClipboardPen, Table2, LineChart as LineIcon, AlertTriangle, CalendarClock, Radar as RadarIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, Button, Avatar, Progress, EmptyState, Skeleton,
  Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell,
} from "@/components/ui";
import { ChartCard, LineChart, BarChart, type ChartSeries } from "@/components/ui/charts";
import { useTeacherDashboard, type TeacherDashboardModel } from "./useTeacherDashboard";

const trendSeries: ChartSeries[] = [{ key: "score", label: "Group mean" }];

export function TeacherDashboard({ previewModel }: { previewModel?: TeacherDashboardModel }) {
  const { status, model } = useTeacherDashboard(previewModel);

  if (status === "booting") return <TeacherSkeleton />;
  if (status === "unauthenticated") {
    return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Teacher</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account to continue.</p></CardContent></Card></div>;
  }
  if (status === "empty" || !model) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState icon={GraduationCap} title="No classes yet" description="When you're assigned classes, their health, submissions, and student insights appear here." />
      </div>
    );
  }

  const m = model;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ds-overline text-primary">Teacher</p>
          <h1 className="ds-h1 mt-1">Class overview</h1>
          <p className="ds-small mt-1">{m.classCount} {m.classCount === 1 ? "class" : "classes"} · who needs support and what to grade next.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/teacher/grading"><Button leftIcon={<ClipboardPen />}>Grade</Button></Link>
          <Link href="/teacher/gradebook"><Button variant="secondary" leftIcon={<Table2 />}>Gradebook</Button></Link>
        </div>
      </div>

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Kpi icon={Users} label="Students" value={m.totalStudents} />
        <Kpi icon={UserCheck} label="Active this week" value={m.activeStudents} hint={`${m.totalStudents - m.activeStudents} inactive`} />
        <Kpi icon={Gauge} label="Avg score" value={m.avgScore != null ? `${m.avgScore}%` : "—"} />
        <Kpi icon={ClipboardCheck} label="Submission rate" value={m.submissionRate != null ? `${m.submissionRate}%` : "—"} />
        <Kpi icon={GraduationCap} label="Classes" value={m.classCount} />
      </div>

      {/* Action zone: needs attention + quick actions */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            <div className="mb-4 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /><p className="ds-h4">Students needing support</p></div>
            {m.needsAttention.length === 0 ? (
              <EmptyState compact icon={UserCheck} title="Everyone's on track" description="No low averages or missing work right now." />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {m.needsAttention.map((s) => (
                  <Link key={s.id} href="/teacher/students" className="ds-ring flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2">
                    <Avatar name={s.name} size={34} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{s.name}</p><p className="truncate text-[12px] text-muted-foreground">{s.reason}</p></div>
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", s.tone === "danger" ? "bg-warning" : "bg-info")} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="ds-h4 mb-1">Quick actions</p>
            <QuickAction icon={ClipboardPen} label="Grade submissions" href="/teacher/grading" />
            <QuickAction icon={Table2} label="Open gradebook" href="/teacher/gradebook" />
            <QuickAction icon={Users} label="Students" href="/teacher/students" />
            <QuickAction icon={LineIcon} label="Class analytics" href="/teacher/analytics" />
          </CardContent>
        </Card>
      </div>

      {/* Missing + upcoming */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent>
          <p className="ds-h4 mb-3">Lagging submissions</p>
          {m.missing.length === 0 ? <EmptyState compact title="Submissions look healthy" description="No assignments below 70% completion." /> : (
            <ul className="flex flex-col gap-1.5">
              {m.missing.map((a) => (
                <li key={a.id}>
                  <Link href="/teacher/homework" className="ds-ring -mx-1 block rounded-lg px-1 py-1 transition-colors hover:bg-surface-2">
                    <div className="mb-1 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-sm font-semibold text-foreground">{a.title}</span><span className="ds-num shrink-0 text-[12px] font-bold text-muted-foreground">{a.completion}%</span></div>
                    <Progress value={a.completion} tone={a.completion < 40 ? "warning" : "primary"} size="sm" />
                    <p className="mt-0.5 text-[11px] text-label-foreground">{a.className}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
        <Card><CardContent>
          <div className="mb-3 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><p className="ds-h4">Upcoming deadlines</p></div>
          {m.upcoming.length === 0 ? <EmptyState compact title="Nothing due soon" description="Upcoming assignment deadlines appear here." /> : (
            <ul className="flex flex-col gap-2">
              {m.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{u.title}</p><p className="text-[11px] text-label-foreground">{u.className}</p></div><Badge variant={u.soon ? "warning" : "neutral"}>{u.dueLabel}</Badge></li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Are class scores trending up?" description="Group mean per practice assignment">
          <LineChart data={m.classAvgTrend} xKey="label" series={trendSeries} height={220} yDomain={[400, 1600]} emptyMessage={{ title: "No scored assignments yet", description: "Group means appear as classes complete practice tests." }} />
        </ChartCard>
        <ChartCard title="Which assignments need a push?" description="Completion by assignment">
          {m.completionByAssignment.length === 0 ? <EmptyState compact title="No assignments yet" description="Completion appears once work is assigned." /> : (
            <BarChart data={m.completionByAssignment} xKey="label" series={[{ key: "completion", label: "Completion %" }]} height={220} />
          )}
        </ChartCard>
      </div>

      {/* SAT strand — honest gap */}
      <ChartCard title="Which SAT strands need reinforcement?" description="Class strand performance">
        <EmptyState icon={RadarIcon} title="Strand analysis needs per-skill data" description="Class-level SAT strand performance isn't available from current data. It unlocks when assessment results expose per-strand detail — no estimates shown here." />
      </ChartCard>

      {/* Class health */}
      <section>
        <div className="mb-4"><h2 className="ds-h3">Class health</h2><p className="ds-small">Sorted by lowest average first.</p></div>
        <Card><CardContent className="p-0">
          <Table containerClassName="border-0">
            <TableHead><TableRow><TableHeaderCell>Class</TableHeaderCell><TableHeaderCell>Students</TableHeaderCell><TableHeaderCell>Avg score</TableHeaderCell><TableHeaderCell>Completion</TableHeaderCell><TableHeaderCell></TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {m.classes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="ds-num">{c.students}</TableCell>
                  <TableCell><Badge variant={c.avgScore == null ? "neutral" : c.avgScore < 60 ? "warning" : "success"}>{c.avgScore != null ? `${c.avgScore}%` : "—"}</Badge></TableCell>
                  <TableCell className="w-40"><div className="flex items-center gap-2"><Progress value={c.completion} size="sm" /><span className="ds-num shrink-0 text-[12px] text-muted-foreground">{c.completion}%</span></div></TableCell>
                  <TableCell className="text-right"><Link href="/teacher/gradebook" className="ds-ring inline-flex items-center gap-1 rounded-lg text-[13px] font-semibold text-primary">Open <ArrowRight className="h-3.5 w-3.5" /></Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card><CardContent className="flex flex-col gap-2">
      <div className="flex items-center justify-between"><span className="ds-overline">{label}</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary"><Icon className="h-4 w-4" /></span></div>
      <span className="ds-num text-[26px] font-extrabold leading-none text-foreground">{value}</span>
      {hint ? <span className="text-[12px] text-muted-foreground">{hint}</span> : null}
    </CardContent></Card>
  );
}
function QuickAction({ icon: Icon, label, href }: { icon: React.ElementType; label: string; href: string }) {
  return (
    <Link href={href} className="ds-ring group flex items-center gap-3 rounded-xl bg-surface-2 p-3 transition-colors hover:bg-surface-3">
      <Icon className="h-5 w-5 shrink-0 text-primary" />
      <span className="flex-1 text-sm font-semibold text-foreground">{label}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-label-foreground transition-colors group-hover:text-foreground" />
    </Link>
  );
}
function TeacherSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">{[0,1,2,3,4].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-56 rounded-2xl lg:col-span-2" /><Skeleton className="h-56 rounded-2xl" /></div>
    </div>
  );
}
