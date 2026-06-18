"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, Field, Select, LoadingState } from "../ui";
import { useUnifiedResults } from "../hooks";
import type { ClassroomWithRole } from "../types";

const TYPE_OPTIONS = [
  { v: "all", label: "All" },
  { v: "assessment", label: "Assessment" },
  { v: "midterm", label: "Midterm" },
  { v: "past paper", label: "Past Paper" },
];

function SummaryCard({ label, value, suffix = "" }: { label: string; value: number | null; suffix?: string }) {
  if (value === null || value === undefined) return null; // hide metrics that can't be computed
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-foreground">{value}{suffix}</p>
    </div>
  );
}

/** Unified classroom results across Assessments, Midterms, Past Papers. Real backend data only. */
export function Results({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const [type, setType] = useState("all");
  const [student, setStudent] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filters = useMemo(() => ({
    type: type === "all" ? undefined : type,
    student: student === "all" ? undefined : Number(student),
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }), [type, student, dateFrom, dateTo]);

  const { data, isLoading } = useUnifiedResults(id, filters);
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  // Student filter options derived from returned rows (real participants).
  const students = useMemo(() => {
    const m = new Map<number, string>();
    rows.forEach((r) => m.set(r.student_id, r.student));
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div className="space-y-5">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="Average score" value={summary.average_score} />
          <SummaryCard label="Completion rate" value={summary.completion_rate} suffix="%" />
          <SummaryCard label="Total attempts" value={summary.total_attempts} />
          <SummaryCard label="Pending work" value={summary.pending_work} />
        </div>
      )}

      <Card>
        <CardHeader title="Results" description="Assessments, midterms, and past papers in one view." />
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Content type" htmlFor="r-type">
            <Select id="r-type" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Student" htmlFor="r-student">
            <Select id="r-student" value={student} onChange={(e) => setStudent(e.target.value)}>
              <option value="all">All students</option>
              {students.map(([sid, name]) => <option key={sid} value={String(sid)}>{name}</option>)}
            </Select>
          </Field>
          <Field label="From" htmlFor="r-from">
            <input id="r-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
          </Field>
          <Field label="To" htmlFor="r-to">
            <input id="r-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
          </Field>
        </div>

        {isLoading ? (
          <LoadingState label="Loading results…" />
        ) : rows.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground">No results yet for this filter.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2">Student</th><th>Content</th><th>Type</th><th>Score</th><th>Status</th><th>Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2 font-medium text-foreground">{r.student}</td>
                    <td className="text-foreground">{r.content_name}</td>
                    <td className="text-muted-foreground">{r.type}</td>
                    <td className="text-foreground">{r.score ?? "—"}</td>
                    <td className="text-muted-foreground">{String(r.status).replace("_", " ")}</td>
                    <td className="text-muted-foreground">{r.submission_date ? r.submission_date.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
