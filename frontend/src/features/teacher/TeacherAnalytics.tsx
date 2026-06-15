"use client";

import Link from "next/link";
import {
  GraduationCap, Users, ShieldAlert, Eye, Sparkles, ArrowRight, Radar as RadarIcon, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, Avatar, EmptyState, Skeleton, Progress,
  Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell,
} from "@/components/ui";
import { ChartCard, LineChart, BarChart, DonutChart, type ChartSeries } from "@/components/ui/charts";
import { useTeacherAnalytics, type TeacherAnalyticsModel } from "./useTeacherAnalytics";

const trendSeries: ChartSeries[] = [{ key: "score", label: "Group mean" }];

export function TeacherAnalytics({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model } = useTeacherAnalytics(previewModel);

  if (status === "booting") return <div className="mx-auto max-w-6xl"><Skeleton className="mb-4 h-10 w-56" /><Skeleton className="h-40 w-full rounded-2xl" /></div>;
  if (status === "unauthenticated") return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Analytics</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account.</p></CardContent></Card></div>;
  if (status === "empty" || !model) return <div className="mx-auto max-w-2xl py-12"><EmptyState icon={GraduationCap} title="No classes yet" description="Analytics appear once you have classes with activity." /></div>;

  const m = model;
  const onTrack = Math.max(0, m.totalStudents - m.atRiskCount - m.watchCount);
  const segmentation = [
    { name: "On track", value: onTrack, color: "var(--chart-3)" },
    { name: "Watch", value: m.watchCount, color: "var(--chart-2)" },
    { name: "At risk", value: m.atRiskCount, color: "var(--chart-4)" },
  ];
  const atRisk = m.students.filter((s) => s.riskLevel === "at-risk");
  const effectiveness = [...m.assignments].sort((a, b) => a.completionPct - b.completionPct).slice(0, 8);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <div>
        <p className="ds-overline text-primary">Teacher</p>
        <h1 className="ds-h1 mt-1">Class analytics</h1>
        <p className="ds-small mt-1">Who&apos;s at risk, what&apos;s working, and where to intervene — across {m.classCount} {m.classCount === 1 ? "class" : "classes"}.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Users} label="Students" value={m.totalStudents} />
        <Kpi icon={ShieldAlert} label="At risk" value={m.atRiskCount} tone={m.atRiskCount > 0 ? "warning" : undefined} />
        <Kpi icon={Eye} label="Watch" value={m.watchCount} />
        <Kpi icon={GraduationCap} label="Classes" value={m.classCount} />
      </div>

      {/* Recommendations (lead) */}
      <Card>
        <CardContent>
          <div className="mb-4 flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Sparkles className="h-4 w-4" /></span><div><p className="ds-h4 leading-tight">Suggested interventions</p><p className="text-[12px] text-muted-foreground">From real class signals</p></div></div>
          {m.recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No interventions needed right now — classes look healthy.</p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {m.recommendations.map((r, i) => (
                <Link key={r.id} href={r.href} className={cn("ds-ring group flex items-center gap-3 rounded-xl p-4 transition-colors", i === 0 ? "border border-primary/20 bg-primary-soft hover:bg-primary/15" : "bg-surface-2 hover:bg-surface-3")}>
                  <div className="min-w-0 flex-1"><p className={cn("text-sm font-bold", i === 0 ? "text-primary" : "text-foreground")}>{r.title}</p><p className="text-[12px] text-muted-foreground">{r.detail}</p></div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-label-foreground transition-colors group-hover:text-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk analysis */}
      <section>
        <div className="mb-4"><h2 className="ds-h3">Risk analysis</h2><p className="ds-small">Student segmentation by real signals — averages, missing work, inactivity.</p></div>
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard title="How is the cohort split?" description="Student segmentation" legend={[{ key: "on", label: "On track", color: "var(--chart-3)" }, { key: "w", label: "Watch", color: "var(--chart-2)" }, { key: "r", label: "At risk", color: "var(--chart-4)" }]}>
            <DonutChart data={segmentation} height={220} centerValue={m.totalStudents} centerLabel="Students" />
          </ChartCard>
          <Card className="lg:col-span-2"><CardContent>
            <div className="mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" /><p className="ds-h4">At-risk students</p></div>
            {atRisk.length === 0 ? <EmptyState compact title="No one at risk" description="No students currently meet the at-risk thresholds." /> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {atRisk.slice(0, 8).map((s) => (
                  <Link key={`${s.classId}-${s.id}`} href="/teacher/students" className="ds-ring flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-surface-2">
                    <Avatar name={s.name} size={34} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{s.name}</p><p className="truncate text-[12px] text-muted-foreground">{s.riskReasons.slice(0, 2).join(" · ") || s.className}</p></div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent></Card>
        </div>
      </section>

      {/* Performance analysis */}
      <section>
        <div className="mb-4"><h2 className="ds-h3">Performance analysis</h2><p className="ds-small">Class comparisons and assignment effectiveness.</p></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="How do classes compare?" description="Completion rate by class">
            {m.classes.length === 0 ? <EmptyState compact title="No class data" /> : (
              <BarChart data={m.classes.map((c) => ({ label: c.name.slice(0, 12), completion: c.completion }))} xKey="label" series={[{ key: "completion", label: "Completion %" }]} height={220} />
            )}
          </ChartCard>
          <Card><CardContent className="p-0">
            <div className="px-5 pt-5"><p className="ds-h4">Assignment effectiveness</p><p className="mt-0.5 text-[12px] text-muted-foreground">Lowest completion first</p></div>
            {effectiveness.length === 0 ? <div className="p-5"><EmptyState compact title="No assignments yet" /></div> : (
              <Table containerClassName="border-0 mt-2">
                <TableHead><TableRow><TableHeaderCell>Assignment</TableHeaderCell><TableHeaderCell>Completion</TableHeaderCell><TableHeaderCell>Signal</TableHeaderCell></TableRow></TableHead>
                <TableBody>
                  {effectiveness.map((a) => (
                    <TableRow key={`${a.classId}-${a.id}`}>
                      <TableCell className="max-w-[160px] truncate font-semibold">{a.title}<span className="block text-[11px] font-normal text-label-foreground">{a.className}</span></TableCell>
                      <TableCell className="w-32"><div className="flex items-center gap-2"><Progress value={a.completionPct} size="sm" tone={a.completionPct < 50 ? "warning" : "primary"} /><span className="ds-num shrink-0 text-[12px] text-muted-foreground">{a.completionPct}%</span></div></TableCell>
                      <TableCell><Badge variant={a.effectiveness === "low-completion" ? "warning" : a.effectiveness === "challenging" ? "info" : "success"}>{a.effectiveness === "low-completion" ? "Low completion" : a.effectiveness === "challenging" ? "Challenging" : "Healthy"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent></Card>
        </div>
      </section>

      {/* SAT analysis */}
      <section>
        <div className="mb-4"><h2 className="ds-h3">SAT analysis</h2><p className="ds-small">Score progress over time. Strand-level data isn&apos;t available yet.</p></div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Are group means improving?" description="Practice group mean per assignment over time">
            <LineChart data={m.classAvgTrend} xKey="label" series={trendSeries} height={220} yDomain={[400, 1600]} emptyMessage={{ title: "No scored practice yet", description: "Group means appear as classes complete practice tests." }} />
          </ChartCard>
          <ChartCard title="Which SAT strands need reinforcement?" description="Class strand performance">
            <EmptyState icon={RadarIcon} title="Strand analysis needs per-skill data" description="Class-level SAT strand performance isn't exposed by current data — shown honestly rather than estimated." />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: "warning" }) {
  return (
    <Card><CardContent className="flex flex-col gap-2">
      <div className="flex items-center justify-between"><span className="ds-overline">{label}</span><span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", tone === "warning" ? "bg-warning-soft text-warning-foreground" : "bg-primary-soft text-primary")}><Icon className="h-4 w-4" /></span></div>
      <span className="ds-num text-[26px] font-extrabold leading-none text-foreground">{value}</span>
    </CardContent></Card>
  );
}
