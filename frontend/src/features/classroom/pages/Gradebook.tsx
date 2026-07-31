"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, GraduationCap, Sparkles, Bot, User2, ClipboardList } from "lucide-react";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/Avatar";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Card, CardHeader, Button, Pill, Field, Input, Textarea, EmptyState, LoadingState, ErrorState, StatCard } from "../ui";
import type { PillTone } from "../ui";
import type { ClassroomWithRole } from "../types";
import { useGradebookOverview, useGradebookAssignment, useGradeSubmission, useReturnSubmission } from "../gradebookHooks";
import type { GradebookStatus, RosterRow, GradebookCounts } from "../gradebookApi";

const STATUS_META: Record<GradebookStatus, { label: string; tone: PillTone; bar: string }> = {
  GRADED: { label: "Graded", tone: "success", bar: "bg-emerald-500" },
  SUBMITTED: { label: "Needs grading", tone: "warning", bar: "bg-amber-500" },
  NEEDS_REVISION: { label: "Needs revision", tone: "info", bar: "bg-sky-500" },
  MISSING: { label: "Missing", tone: "neutral", bar: "bg-slate-300 dark:bg-slate-600" },
};

function DistributionBar({ counts, autoGraded }: { counts: GradebookCounts; autoGraded: boolean }) {
  const total = Math.max(1, counts.total);
  // Auto assignments have no "needs grading"; their submitted count is folded into graded.
  const segs: { key: GradebookStatus; n: number }[] = [
    { key: "GRADED", n: counts.graded },
    { key: "SUBMITTED", n: autoGraded ? 0 : counts.needs_grading },
    { key: "NEEDS_REVISION", n: counts.needs_revision },
    { key: "MISSING", n: counts.missing },
  ];
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
      {segs.map((s) => s.n > 0 && (
        <div key={s.key} className={STATUS_META[s.key].bar} style={{ width: `${(s.n / total) * 100}%` }} title={`${STATUS_META[s.key].label}: ${s.n}`} />
      ))}
    </div>
  );
}

function SourceBadge({ autoGraded, label }: { autoGraded: boolean; label: string }) {
  return autoGraded
    ? <Pill tone="primary"><Bot className="h-3 w-3" /> Auto · {label}</Pill>
    : <Pill tone="neutral"><User2 className="h-3 w-3" /> Manual grading</Pill>;
}

export function Gradebook({ classroom }: { classroom: ClassroomWithRole }) {
  const classId = Number(classroom.id);
  const [openId, setOpenId] = useState<number | null>(null);
  return openId
    ? <RosterView classId={classId} assignmentId={openId} onBack={() => setOpenId(null)} />
    : <Overview classId={classId} onOpen={setOpenId} />;
}

function Overview({ classId, onOpen }: { classId: number; onOpen: (id: number) => void }) {
  const { data, isLoading, isError, refetch } = useGradebookOverview(classId);
  if (isLoading) return <LoadingState label="Loading gradebook…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  return (
    <Card>
      <CardHeader
        title="Gradebook"
        description={`${data.students} students`}
        actions={data.needs_grading_total > 0 ? <Pill tone="warning">{data.needs_grading_total} to grade</Pill> : <Pill tone="success">All caught up</Pill>}
      />
      <div className="mt-4 space-y-2">
        {data.assignments.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No assignments yet" />
        ) : data.assignments.map((a) => (
          <button key={a.id} onClick={() => onOpen(a.id)}
            className="w-full rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-surface-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm font-medium text-foreground">{a.title}</span>
                {a.status === "DRAFT" && <Pill tone="neutral">Draft</Pill>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <SourceBadge autoGraded={a.is_auto_graded} label={a.source_label} />
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div className="mt-2.5"><DistributionBar counts={a.counts} autoGraded={a.is_auto_graded} /></div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="text-emerald-600">{a.counts.graded} graded</span>
              {!a.is_auto_graded && a.counts.needs_grading > 0 && <span className="text-amber-600">{a.counts.needs_grading} to grade</span>}
              {a.counts.needs_revision > 0 && <span className="text-sky-600">{a.counts.needs_revision} revising</span>}
              {a.counts.missing > 0 && <span>{a.counts.missing} missing</span>}
              {a.is_auto_graded && a.performance?.average != null && (
                <span className="text-primary">Avg {a.performance.average} · High {a.performance.highest} · Low {a.performance.lowest}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

type Filter = "ALL" | GradebookStatus;

function RosterView({ classId, assignmentId, onBack }: { classId: number; assignmentId: number; onBack: () => void }) {
  const { data, isLoading, isError, refetch } = useGradebookAssignment(classId, assignmentId);
  const [filter, setFilter] = useState<Filter>("ALL");

  const rows = useMemo(() => {
    const all = data?.roster ?? [];
    return filter === "ALL" ? all : all.filter((r) => r.status === filter);
  }, [data, filter]);

  if (isLoading) return <LoadingState label="Loading roster…" />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} />;

  const a = data.assignment;
  const c = data.counts;
  const chips: { key: Filter; label: string; n: number }[] = [
    { key: "ALL", label: "All", n: c.total },
    ...(!a.is_auto_graded ? [{ key: "SUBMITTED" as Filter, label: "Needs grading", n: c.needs_grading }] : []),
    { key: "MISSING", label: "Missing", n: c.missing },
    { key: "NEEDS_REVISION", label: "Revising", n: c.needs_revision },
    { key: "GRADED", label: "Graded", n: c.graded },
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Gradebook
      </button>
      <Card>
        <CardHeader
          title={a.title}
          actions={<SourceBadge autoGraded={a.is_auto_graded} label={a.source_label} />}
        />
        {a.is_auto_graded && data.performance && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Completion" value={data.performance.completion_rate != null ? `${data.performance.completion_rate}%` : "—"} />
            <StatCard label="Average" value={data.performance.average ?? "—"} />
            <StatCard label="Highest" value={data.performance.highest ?? "—"} accent="text-emerald-600 bg-emerald-500/10" />
            <StatCard label="Lowest" value={data.performance.lowest ?? "—"} accent="text-amber-600 bg-amber-500/10" />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((ch) => (
            <button key={ch.key} onClick={() => setFilter(ch.key)}
              className={cn("rounded-full px-3 py-1 text-xs font-medium",
                filter === ch.key ? "bg-primary text-white" : "bg-surface-2 text-muted-foreground hover:text-foreground")}>
              {ch.label} {ch.n}
            </button>
          ))}
        </div>

        <div className="mt-4 divide-y divide-border">
          {rows.length === 0 ? (
            <EmptyState icon={Sparkles} title="Nothing here" description="No students in this view." />
          ) : rows.map((r) => (
            <RosterRowItem key={r.student_id} classId={classId} assignmentId={assignmentId} row={r} autoGraded={a.is_auto_graded} maxScore={a.max_score} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function RosterRowItem({ classId, assignmentId, row, autoGraded, maxScore }: {
  classId: number; assignmentId: number; row: RosterRow; autoGraded: boolean; maxScore: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(row.grade ?? "");
  const [feedback, setFeedback] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const grade = useGradeSubmission(classId, assignmentId);
  const ret = useReturnSubmission(classId, assignmentId);

  const meta = STATUS_META[row.status];
  // Manual grading only: a submitted/returned/graded manual row with a submission can be graded.
  const canGrade = !autoGraded && row.submission_id != null && row.status !== "MISSING";

  async function save() {
    setErr(null);
    try {
      await grade.mutateAsync({ submissionId: row.submission_id as number, grade: String(score), feedback });
      pushGlobalToast({ tone: "success", message: `Saved grade for ${row.name}.` });
      setOpen(false);
    } catch (e) { setErr(normalizeApiError(e).message); }
  }
  async function doReturn() {
    setErr(null);
    try {
      await ret.mutateAsync({ submissionId: row.submission_id as number, note: feedback });
      pushGlobalToast({ tone: "success", message: `Returned ${row.name}'s work for revision.` });
      setOpen(false);
    } catch (e) { setErr(normalizeApiError(e).message); }
  }

  return (
    <div className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Avatar src={row.profile_image_url} name={row.name} size={26} />
          <span className="min-w-0 truncate text-sm text-foreground">{row.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {row.status === "GRADED" && row.grade != null && (
            <span className="text-sm font-semibold text-foreground">
              {row.grade}{row.max_score ? `/${row.max_score}` : maxScore ? `/${maxScore}` : ""}
            </span>
          )}
          {row.status === "GRADED" && row.source === "AUTO" && <Pill tone="primary"><Bot className="h-3 w-3" /> Auto</Pill>}
          {row.status === "GRADED" && row.source === "TEACHER" && <Pill tone="neutral"><User2 className="h-3 w-3" /> Teacher</Pill>}
          {row.status !== "GRADED" && <Pill tone={meta.tone}>{meta.label}</Pill>}
          {canGrade && (
            <Button size="sm" variant={row.status === "SUBMITTED" ? "primary" : "secondary"} icon={GraduationCap} onClick={() => setOpen((v) => !v)}>
              {row.status === "GRADED" ? "Re-grade" : "Grade"}
            </Button>
          )}
        </div>
      </div>

      {open && canGrade && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
          {err && <p className="text-xs text-rose-500">{err}</p>}
          <div className="flex items-end gap-3">
            <Field label="Score" className="w-32">
              <Input type="number" value={score} onChange={(e) => setScore(e.target.value)} placeholder={maxScore ? `/ ${maxScore}` : "Score"} />
            </Field>
          </div>
          <Field label="Feedback (optional)">
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Notes for the student…" className="min-h-[5rem]" />
          </Field>
          <div className="flex gap-2">
            <Button size="sm" loading={grade.isPending} onClick={save} disabled={String(score).trim() === ""}>Save grade</Button>
            <Button size="sm" variant="secondary" loading={ret.isPending} onClick={doReturn}>Return for revision</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
