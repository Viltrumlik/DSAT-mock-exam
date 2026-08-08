"use client";

import { Trophy, GraduationCap, CheckCircle2, Users, TrendingUp, TrendingDown, Minus, CalendarCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardHeader, StatCard, Pill, EmptyState, LoadingState, ErrorState } from "../ui";
import { capabilitiesFor } from "../capabilities";
import type { ClassroomWithRole } from "../types";
import { useClassAnalytics, useMyAnalytics } from "../analyticsHooks";
import type { SeriesPoint } from "../analyticsApi";

// ── tiny inline charts (no chart lib) ─────────────────────────────────────────
function VBars({ values, labels, height = 110, color = "bg-primary/60" }: { values: number[]; labels?: string[]; height?: number; color?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={labels?.[i]}>
          <div className={cn("w-full rounded-t", color)} style={{ height: `${(v / max) * 100}%`, minHeight: 2 }} />
          {labels && <span className="w-full truncate text-center text-[9px] text-muted-foreground">{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}

function HBar({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  const tone = value >= 75 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><span className="text-foreground">{label}</span><span className="font-semibold text-foreground">{value}{suffix}</span></div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2"><div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, value)}%` }} /></div>
    </div>
  );
}

export function Analytics({ classroom }: { classroom: ClassroomWithRole }) {
  const caps = capabilitiesFor(classroom.my_role);
  return caps.isStaff ? <ClassView classroom={classroom} /> : <StudentView classroom={classroom} />;
}

// ── Student: personal progress in 10s ─────────────────────────────────────────
function StudentView({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const { data, isLoading, isError, refetch } = useMyAnalytics(classId);
  if (isLoading) return <LoadingState label="Loading your progress…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const satVals = data.sat_score_trend.map((p: SeriesPoint) => p.score);
  const acadVals = data.academic_score_trend.map((p: SeriesPoint) => p.score);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Latest SAT" value={data.latest_sat_score != null ? Math.round(data.latest_sat_score) : "—"} icon={Trophy} accent="text-amber-600 bg-amber-500/10" />
        <StatCard label="Best SAT" value={data.best_sat_score != null ? Math.round(data.best_sat_score) : "—"} icon={Sparkles} />
        <StatCard label="Attendance" value={data.attendance_rate != null ? `${data.attendance_rate}%` : "—"} icon={CalendarCheck} accent="text-emerald-600 bg-emerald-500/10" />
        <StatCard label="Completion" value={data.completion_rate != null ? `${data.completion_rate}%` : "—"} icon={CheckCircle2} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="SAT score trend" description="Your SAT ranking score over time" />
          {satVals.length ? <div className="mt-4"><VBars values={satVals} labels={data.sat_score_trend.map((p) => p.period_key.slice(5))} /></div>
            : <EmptyState icon={Trophy} title="No SAT history yet" description="Complete SAT practice to start your trend." />}
        </Card>
        <Card>
          <CardHeader title="Academic score trend" description="Your academic ranking score over time" />
          {acadVals.length ? <div className="mt-4"><VBars values={acadVals} labels={data.academic_score_trend.map((p) => p.period_key.slice(5))} color="bg-violet-500/60" /></div>
            : <EmptyState icon={GraduationCap} title="No academic history yet" description="Turning up and finishing your homework will build your trend." />}
        </Card>
      </div>

      <Card>
        <CardHeader title="Assignment completion" description="Your work in this class" />
        <div className="mt-4 space-y-2">
          {data.assignment_completion_history.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No assignments yet" />
          ) : data.assignment_completion_history.map((h) => (
            <div key={h.assignment_id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2.5">
              <span className="min-w-0 truncate text-sm text-foreground">{h.title}</span>
              <div className="flex items-center gap-2">
                {h.grade != null && <Pill tone="success">{Math.round(h.grade)}{h.max_score ? `/${Math.round(h.max_score)}` : ""}</Pill>}
                <Pill tone={h.completed ? "success" : "neutral"}>{h.completed ? "Done" : "To do"}</Pill>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Teacher: class health in 10s ──────────────────────────────────────────────
function ClassView({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const { data, isLoading, isError, refetch } = useClassAnalytics(classId);
  if (isLoading) return <LoadingState label="Loading class analytics…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const dist = data.sat_score_distribution;
  const topics = data.topics;
  const imp = data.improvement_trends.sat.trend_counts;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Avg SAT" value={data.avg_sat_score != null ? Math.round(data.avg_sat_score) : "—"} icon={Trophy} accent="text-amber-600 bg-amber-500/10" />
        <StatCard label="Avg Academic" value={data.avg_academic_score != null ? Math.round(data.avg_academic_score) : "—"} icon={GraduationCap} accent="text-violet-600 bg-violet-500/10" />
        <StatCard label="Submission rate" value={data.submission_rate != null ? `${data.submission_rate}%` : "—"} icon={CheckCircle2} accent="text-emerald-600 bg-emerald-500/10" />
        <StatCard label="Students" value={data.students} icon={Users} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="SAT score distribution" description="Where students sit by score band" />
          {dist.length ? <div className="mt-4"><VBars values={dist.map((d) => d.count)} labels={dist.map((d) => d.range)} /></div>
            : <EmptyState icon={Trophy} title="No SAT scores yet" />}
        </Card>
        <Card>
          <CardHeader title="Strengths by section" description="Accuracy from completed SAT questions" />
          {topics.length ? (
            <div className="mt-4 space-y-3">
              {topics.map((t, i) => (
                <div key={t.topic}>
                  <HBar label={t.topic} value={t.accuracy} />
                  {i === 0 && <span className="text-[10px] text-emerald-600">Strongest</span>}
                  {i === topics.length - 1 && topics.length > 1 && <span className="text-[10px] text-amber-600">Needs focus</span>}
                </div>
              ))}
            </div>
          ) : <EmptyState icon={Sparkles} title="No question data yet" description="Section accuracy appears once students complete SAT tests." />}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Improvement trends" description="SAT direction since the previous snapshot" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill tone="success"><TrendingUp className="h-3 w-3" /> {imp.IMPROVING ?? 0} improving</Pill>
            <Pill tone="neutral"><Minus className="h-3 w-3" /> {imp.STABLE ?? 0} steady</Pill>
            <Pill tone="warning"><TrendingDown className="h-3 w-3" /> {imp.DECLINING ?? 0} declining</Pill>
            {data.improvement_trends.sat.avg_delta != null && (
              <span className="text-xs text-muted-foreground">Class avg {data.improvement_trends.sat.avg_delta >= 0 ? "+" : ""}{data.improvement_trends.sat.avg_delta} vs last</span>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Attendance trend" description="Present-rate per finalized session" />
          {data.attendance.sessions.length ? (
            <div className="mt-4"><VBars values={data.attendance.sessions.map((s) => s.present_rate ?? 0)} labels={data.attendance.sessions.map((s) => s.date.slice(5))} color="bg-emerald-500/60" /></div>
          ) : <EmptyState icon={CalendarCheck} title="No finalized sessions yet" />}
        </Card>
      </div>

      <Card>
        <CardHeader title="Assignment completion" description="Submitted vs class size" />
        <div className="mt-4 space-y-2">
          {data.assignment_completion_rates.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No assignments yet" />
          ) : data.assignment_completion_rates.slice(0, 8).map((r) => (
            <div key={r.assignment_id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{r.title}</span>
              <span className="text-xs text-muted-foreground">{r.completed}/{r.students}</span>
              <Pill tone={r.rate == null ? "neutral" : r.rate >= 75 ? "success" : r.rate >= 50 ? "warning" : "danger"}>{r.rate != null ? `${r.rate}%` : "—"}</Pill>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
