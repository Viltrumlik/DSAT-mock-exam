"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, TrendingDown, AlertTriangle, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent, Badge, EmptyState, Skeleton, Progress, SegmentedControl, type Segment } from "@/components/ui";
import { useTeacherAnalytics, type AssignmentRecord, type TeacherAnalyticsModel } from "./useTeacherAnalytics";

type Filter = "all" | "attention" | "healthy";

const effBadge: Record<AssignmentRecord["effectiveness"], { label: string; variant: "warning" | "info" | "success" }> = {
  "low-completion": { label: "Low completion", variant: "warning" },
  challenging: { label: "Challenging", variant: "info" },
  healthy: { label: "Healthy", variant: "success" },
};

export function TeacherHomework({ previewModel }: { previewModel?: TeacherAnalyticsModel }) {
  const { status, model } = useTeacherAnalytics(previewModel);
  const [classId, setClassId] = useState<number | "all">("all");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (!model) return [];
    return model.assignments.filter((a) =>
      (classId === "all" || a.classId === classId) &&
      (filter === "all" || (filter === "attention" ? a.effectiveness !== "healthy" : a.effectiveness === "healthy")),
    );
  }, [model, classId, filter]);

  if (status === "booting") return <div className="mx-auto max-w-6xl"><Skeleton className="mb-4 h-10 w-48" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div></div>;
  if (status === "unauthenticated") return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Homework</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account.</p></CardContent></Card></div>;
  if (status === "empty" || !model) return <div className="mx-auto max-w-2xl py-12"><EmptyState icon={ClipboardList} title="No assignments yet" description="Assignment health appears here once you assign work." /></div>;

  const lowCompletion = model.assignments.filter((a) => a.effectiveness === "low-completion").length;
  const challenging = model.assignments.filter((a) => a.effectiveness === "challenging").length;
  const opts: Segment<Filter>[] = [{ value: "all", label: "All" }, { value: "attention", label: "Needs attention" }, { value: "healthy", label: "Healthy" }];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <p className="ds-overline text-primary">Teacher</p>
        <h1 className="ds-h1 mt-1">Homework</h1>
        <p className="ds-small mt-1">{model.assignments.length} assignments across {model.classCount} {model.classCount === 1 ? "class" : "classes"}.</p>
      </div>

      {/* Insights */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Insight icon={TrendingDown} label="Low completion" value={lowCompletion} hint="Below 50% turned in" tone={lowCompletion > 0 ? "warning" : undefined} />
        <Insight icon={AlertTriangle} label="Challenging" value={challenging} hint="Group mean below class average" tone={challenging > 0 ? "info" : undefined} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {model.classes.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip active={classId === "all"} onClick={() => setClassId("all")}>All classes</Chip>
            {model.classes.map((c) => <Chip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>{c.name}</Chip>)}
          </div>
        ) : null}
        <SegmentedControl options={opts} value={filter} onChange={setFilter} size="sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No assignments match" description="Try a different filter." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const eb = effBadge[a.effectiveness];
            return (
              <Link key={`${a.classId}-${a.id}`} href="/teacher/grading" className="ds-ring block rounded-2xl">
              <Card variant="interactive">
                <CardContent className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate text-sm font-bold text-foreground">{a.title}</p><p className="truncate text-[12px] text-muted-foreground">{a.className}</p></div>
                    <Badge variant={eb.variant}>{eb.label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.isAssessment ? <Badge variant="neutral">Assessment</Badge> : null}
                    {a.isOverdue ? <Badge variant="warning">Past due</Badge> : null}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[12px]"><span className="text-muted-foreground">Completion</span><span className="ds-num font-bold text-foreground">{a.completionPct}%</span></div>
                    <Progress value={a.completionPct} size="sm" tone={a.completionPct < 50 ? "warning" : "primary"} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
                    <Mini label="Submitted" value={`${a.submitted}/${a.total}`} />
                    <Mini label="Avg score" value={a.groupMean != null ? String(a.groupMean) : "—"} />
                  </div>
                </CardContent>
              </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Insight({ icon: Icon, label, value, hint, tone }: { icon: React.ElementType; label: string; value: number; hint: string; tone?: "warning" | "info" }) {
  return (
    <Card><CardContent className="flex items-center gap-4">
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", tone === "warning" ? "bg-warning-soft text-warning-foreground" : tone === "info" ? "bg-info-soft text-info-foreground" : "bg-success-soft text-success-foreground")}><Icon className="h-5 w-5" /></span>
      <div><p className="ds-num text-2xl font-extrabold leading-none text-foreground">{value}</p><p className="mt-1 text-sm font-semibold text-foreground">{label}</p><p className="text-[12px] text-muted-foreground">{hint}</p></div>
    </CardContent></Card>
  );
}
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("ds-ring rounded-lg border px-3 py-1.5 text-[13px] font-semibold transition-colors", active ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2")}>{children}</button>;
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase tracking-wide text-label-foreground">{label}</p><p className="ds-num mt-0.5 text-sm font-bold text-foreground">{value}</p></div>;
}
