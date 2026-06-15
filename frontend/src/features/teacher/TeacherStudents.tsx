"use client";

import { useMemo, useState } from "react";
import { Users, ShieldAlert, Clock, ClipboardCheck, Gauge, Activity } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, Avatar, EmptyState, Skeleton, Drawer, Progress, SegmentedControl, type Segment,
} from "@/components/ui";
import { useTeacherAnalytics, type StudentRecord, type RiskLevel, type TeacherAnalyticsModel } from "./useTeacherAnalytics";

const riskBadge: Record<RiskLevel, { label: string; variant: "warning" | "info" | "success" }> = {
  "at-risk": { label: "At risk", variant: "warning" },
  watch: { label: "Watch", variant: "info" },
  "on-track": { label: "On track", variant: "success" },
};
function isActive(s: StudentRecord) { return s.inactiveDays == null || s.inactiveDays < 7; }

export function TeacherStudents({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model } = useTeacherAnalytics(previewModel);
  const [classId, setClassId] = useState<number | "all">("all");
  const [risk, setRisk] = useState<RiskLevel | "all">("all");
  const [activity, setActivity] = useState<"all" | "active" | "inactive">("all");
  const [detail, setDetail] = useState<StudentRecord | null>(null);

  const filtered = useMemo(() => {
    if (!model) return [];
    return model.students.filter((s) =>
      (classId === "all" || s.classId === classId) &&
      (risk === "all" || s.riskLevel === risk) &&
      (activity === "all" || (activity === "active" ? isActive(s) : !isActive(s))),
    );
  }, [model, classId, risk, activity]);

  if (status === "booting") return <div className="mx-auto max-w-6xl"><Skeleton className="mb-4 h-10 w-48" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0,1,2,3,4,5].map((i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div></div>;
  if (status === "unauthenticated") return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Students</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account.</p></CardContent></Card></div>;
  if (status === "empty" || !model) return <div className="mx-auto max-w-2xl py-12"><EmptyState icon={Users} title="No students yet" description="Students appear here once you have classes with members." /></div>;

  const riskOpts: Segment<RiskLevel | "all">[] = [{ value: "all", label: "All" }, { value: "at-risk", label: "At risk" }, { value: "watch", label: "Watch" }, { value: "on-track", label: "On track" }];
  const actOpts: Segment<"all" | "active" | "inactive">[] = [{ value: "all", label: "Any" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <p className="ds-overline text-primary">Teacher</p>
        <h1 className="ds-h1 mt-1">Students</h1>
        <p className="ds-small mt-1">{model.students.length} students · {model.atRiskCount} at risk. Tap a card for the full picture.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {model.classes.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={classId === "all"} onClick={() => setClassId("all")}>All classes</FilterChip>
            {model.classes.map((c) => <FilterChip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>{c.name}</FilterChip>)}
          </div>
        ) : null}
        <SegmentedControl options={riskOpts} value={risk} onChange={setRisk} size="sm" />
        <SegmentedControl options={actOpts} value={activity} onChange={setActivity} size="sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No students match" description="Try widening the filters." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => {
            const rb = riskBadge[s.riskLevel];
            return (
              <button key={`${s.classId}-${s.id}`} type="button" onClick={() => setDetail(s)} className="ds-ring flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-pop">
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} size={40} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-foreground">{s.name}</p><p className="truncate text-[12px] text-muted-foreground">{s.className}</p></div>
                  <Badge variant={rb.variant} dot={s.riskLevel !== "on-track"}>{rb.label}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Grade avg" value={s.reviewAvg != null ? `${s.reviewAvg}%` : "—"} />
                  <Mini label="Completion" value={s.completionPct != null ? `${s.completionPct}%` : "—"} />
                  <Mini label="Status" value={isActive(s) ? "Active" : `${s.inactiveDays}d idle`} tone={isActive(s) ? "success" : "warning"} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail drawer */}
      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? "Student"} width={440}>
        {detail ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Avatar name={detail.name} size={52} />
              <div className="min-w-0 flex-1"><p className="ds-h4 truncate">{detail.name}</p><p className="text-[13px] text-muted-foreground">{detail.className}</p></div>
              <Badge variant={riskBadge[detail.riskLevel].variant} dot={detail.riskLevel !== "on-track"}>{riskBadge[detail.riskLevel].label}</Badge>
            </div>

            {detail.riskReasons.length > 0 ? (
              <div className="rounded-xl bg-warning-soft p-3"><p className="ds-overline mb-1 text-warning-foreground">Why flagged</p><p className="text-sm text-warning-foreground">{detail.riskReasons.join(" · ")}</p></div>
            ) : null}

            <div>
              <p className="ds-overline mb-2">Progress</p>
              <div className="flex flex-col gap-3">
                <DrawerStat icon={Gauge} label="Average grade" value={detail.reviewAvg != null ? `${detail.reviewAvg}%` : "No grades yet"} />
                <DrawerStat icon={ClipboardCheck} label="Assignment completion" value={detail.completionPct != null ? `${detail.completionPct}%` : "—"} bar={detail.completionPct ?? undefined} />
                <DrawerStat icon={Activity} label="Practice average" value={detail.practiceAverage != null ? String(detail.practiceAverage) : "No practice yet"} />
                <DrawerStat icon={Clock} label="Activity" value={isActive(detail) ? "Active this week" : `Inactive ${detail.inactiveDays}d`} />
                <DrawerStat icon={ShieldAlert} label="Missing work" value={detail.overdueCount > 0 ? `${detail.overdueCount} assignments` : "None"} />
              </div>
            </div>

            <div>
              <p className="ds-overline mb-2">Weak areas</p>
              <p className="text-sm text-muted-foreground">Per-strand weak areas need per-skill data, which isn&apos;t available yet — shown honestly rather than estimated.</p>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("ds-ring rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors", active ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2")}>{children}</button>;
}
function Mini({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return <div className="rounded-lg bg-surface-2 p-2"><p className="text-[10px] font-bold uppercase tracking-wide text-label-foreground">{label}</p><p className={cn("ds-num mt-0.5 text-sm font-bold", tone === "success" ? "text-success-foreground" : tone === "warning" ? "text-warning-foreground" : "text-foreground")}>{value}</p></div>;
}
function DrawerStat({ icon: Icon, label, value, bar }: { icon: React.ElementType; label: string; value: string; bar?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold text-foreground">{value}</p>
        {bar != null ? <Progress value={bar} size="sm" className="mt-1" /> : null}
      </div>
    </div>
  );
}
