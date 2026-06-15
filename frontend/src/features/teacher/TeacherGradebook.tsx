"use client";

import { Gauge, Users, AlertTriangle, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Card, CardContent, Badge, EmptyState, Skeleton,
  Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell,
} from "@/components/ui";
import { ChartCard, BarChart } from "@/components/ui/charts";
import { useGradebook, type Cell, type ClassOption, type GradebookModel } from "./useGradebook";

function cellClass(c: Cell): string {
  if (c.status === "missing") return "bg-surface-2 text-label-foreground";
  if (c.status === "submitted") return "bg-info-soft text-info-foreground";
  const g = c.grade;
  if (g == null) return "bg-surface-2 text-muted-foreground";
  // Positive / neutral semantics only — no punishing red.
  if (g >= 80) return "bg-success-soft text-success-foreground"; // strong
  if (g >= 60) return "bg-info-soft text-info-foreground"; // on track
  return "bg-warning-soft text-warning-foreground"; // needs attention
}
function cellText(c: Cell): string {
  if (c.status === "missing") return "–";
  if (c.grade != null) return String(c.grade);
  return "•";
}

export function TeacherGradebook({ preview }: { preview?: { classes: ClassOption[]; model: GradebookModel } }) {
  const { status, classes, selectedClassId, setSelectedClassId, loading, model } = useGradebook(preview);

  if (status === "booting") return <div className="mx-auto max-w-6xl"><Skeleton className="mb-4 h-10 w-48" /><Skeleton className="h-96 w-full rounded-2xl" /></div>;
  if (status === "unauthenticated") return <div className="mx-auto max-w-md py-16"><Card><CardContent className="py-10 text-center"><p className="ds-h3">Gradebook</p><p className="mt-2 text-sm text-muted-foreground">Sign in with a teacher account.</p></CardContent></Card></div>;
  if (status === "empty") return <div className="mx-auto max-w-2xl py-12"><EmptyState icon={Users} title="No classes yet" description="Your gradebook appears once you have a class with assignments." /></div>;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <p className="ds-overline text-primary">Teacher</p>
        <h1 className="ds-h1 mt-1">Gradebook</h1>
        <p className="ds-small mt-1">Spot gaps and dips at a glance — color shows performance, not just numbers.</p>
      </div>

      {classes.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button key={c.id} type="button" onClick={() => setSelectedClassId(c.id)} className={cn("ds-ring rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition-colors", c.id === selectedClassId ? "border-primary/30 bg-primary-soft text-primary" : "border-border bg-card text-muted-foreground hover:bg-surface-2")}>{c.name}</button>
          ))}
        </div>
      ) : null}

      {/* Overview */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <Stat icon={Gauge} label="Class average" value={model?.classAverage != null ? `${model.classAverage}%` : "—"} />
        <Stat icon={Users} label="Students" value={model?.students.length ?? "—"} />
        <Stat icon={AlertTriangle} label="Missing work" value={model?.missingCount ?? "—"} tone={model && model.missingCount > 0 ? "warning" : undefined} />
        <ChartCard title="How is the class distributed?" className="sm:col-span-3 lg:col-span-1">
          {!model || model.distribution.every((d) => d.count === 0) ? (
            <div className="flex h-[120px] items-center justify-center text-[13px] text-muted-foreground">No graded work yet</div>
          ) : (
            <BarChart data={model.distribution} xKey="band" series={[{ key: "count", label: "Students" }]} height={120} />
          )}
        </ChartCard>
      </div>

      {/* Matrix */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5"><Skeleton className="h-64 w-full rounded-xl" /></div>
          ) : !model || model.students.length === 0 ? (
            <div className="p-5"><EmptyState compact title="No students yet" description="Students and their grades appear here once enrolled." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    <th className="sticky left-0 z-10 bg-surface-2 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-label-foreground">Student</th>
                    {model.assignments.map((a) => (
                      <th key={a.id} className="px-2 py-3 text-center text-[11px] font-bold text-label-foreground" title={a.title}><span className="block max-w-[64px] truncate">{a.title}</span></th>
                    ))}
                    <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-label-foreground">Avg</th>
                    <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-label-foreground">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {model.students.map((s) => (
                    <tr key={s.id}>
                      <td className="sticky left-0 z-10 bg-card px-4 py-2.5 font-semibold text-foreground">
                        <span className="flex items-center gap-2"><span className="truncate">{s.name}</span>{s.missing > 0 ? <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning-foreground">{s.missing}!</span> : null}</span>
                      </td>
                      {s.cells.map((c) => (
                        <td key={c.assignmentId} className="px-1.5 py-1.5 text-center">
                          <span className={cn("ds-num inline-flex h-8 w-9 items-center justify-center rounded-md text-[12px] font-bold", cellClass(c))}>{cellText(c)}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center"><Badge variant={s.average == null ? "neutral" : s.average < 60 ? "warning" : "success"}>{s.average != null ? `${s.average}%` : "—"}</Badge></td>
                      <td className="px-3 py-2.5 text-center">
                        {s.trendDelta == null ? <span className="text-label-foreground">—</span> : (
                          <span className={cn("ds-num inline-flex items-center gap-0.5 text-[13px] font-bold", s.trendDelta >= 0 ? "text-success-foreground" : "text-warning-foreground")}>
                            {s.trendDelta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}{Math.abs(s.trendDelta)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[12px] text-label-foreground">
        <span className="mr-3"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-success" />Strong 80+</span>
        <span className="mr-3"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-info" />On track 60–79</span>
        <span className="mr-3"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-warning" />Needs attention &lt;60</span>
        <span>· <strong>–</strong> missing · <strong>•</strong> awaiting grade</span>
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: React.ReactNode; tone?: "warning" }) {
  return (
    <Card><CardContent className="flex items-center gap-4">
      <span className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", tone === "warning" ? "bg-warning-soft text-warning-foreground" : "bg-primary-soft text-primary")}><Icon className="h-5 w-5" /></span>
      <div><p className="ds-num text-2xl font-extrabold leading-none text-foreground">{value}</p><p className="mt-1 text-[13px] text-muted-foreground">{label}</p></div>
    </CardContent></Card>
  );
}
