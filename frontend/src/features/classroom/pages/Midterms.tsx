"use client";

import { useState } from "react";
import { Check, Timer } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, LoadingState } from "../ui";
import { useAssignmentOptions, useAssignMidterm, useMidtermResults } from "../hooks";
import type { ClassroomWithRole } from "../types";

function MidtermResultsSection({ classId }: { classId: number }) {
  const { data, isLoading } = useMidtermResults(classId);
  const midterms = data?.midterms ?? [];
  if (isLoading) return <LoadingState label="Loading midterm results…" />;
  if (midterms.length === 0) return null;
  return (
    <div className="space-y-4">
      {midterms.map((m) => (
        <Card key={m.midterm_id}>
          <CardHeader title={m.title} description={`${m.subject} · ${m.assigned} assigned · ${m.started} started · ${m.completed} completed`} />
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-surface-2 p-2"><p className="text-xs text-muted-foreground">Average</p><p className="text-base font-bold text-foreground">{m.average ?? "—"}</p></div>
            <div className="rounded-lg bg-surface-2 p-2"><p className="text-xs text-muted-foreground">Highest</p><p className="text-base font-bold text-foreground">{m.highest ?? "—"}</p></div>
            <div className="rounded-lg bg-surface-2 p-2"><p className="text-xs text-muted-foreground">Lowest</p><p className="text-base font-bold text-foreground">{m.lowest ?? "—"}</p></div>
          </div>
          <table className="mt-4 w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5">Student</th><th>State</th><th>Score</th><th>Attempts</th><th>Date</th></tr></thead>
            <tbody>
              {m.students.map((s) => (
                <tr key={s.student_id} className="border-t border-border">
                  <td className="py-1.5 font-medium text-foreground">{s.student}</td>
                  <td className="text-muted-foreground">{s.state.replace("_", " ")}</td>
                  <td className="text-foreground">{s.score ?? "—"}</td>
                  <td className="text-muted-foreground">{s.attempt_count}</td>
                  <td className="text-muted-foreground">{s.attempt_date ? s.attempt_date.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

interface MidtermOption {
  id: number;
  title: string;
  subject: string;
  module_count: number;
}

// Classroom subject (ENGLISH/MATH) → midterm subject (READING_WRITING/MATH).
const MIDTERM_SUBJECT: Record<string, string> = { MATH: "MATH", ENGLISH: "READING_WRITING" };

/**
 * Browse existing interactive midterms and assign one to the whole class.
 * Assignment routes through the access engine — students get access immediately.
 * Results live in the Grading tab (existing infrastructure); no new results system.
 */
export function Midterms({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const classSubject = String((classroom as Record<string, unknown>).subject ?? "");
  const { data, isLoading } = useAssignmentOptions(id);
  const assign = useAssignMidterm(id);
  const [assignedId, setAssignedId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const wanted = MIDTERM_SUBJECT[classSubject];
  const all = ((data?.midterms ?? []) as MidtermOption[]);
  const midterms = wanted ? all.filter((m) => m.subject === wanted) : all;

  async function doAssign(midtermId: number) {
    setErr(null);
    try {
      await assign.mutateAsync(midtermId);
      setAssignedId(midtermId);
      setTimeout(() => setAssignedId((cur) => (cur === midtermId ? null : cur)), 2500);
    } catch (e) {
      setErr(normalizeApiError(e).message);
    }
  }

  return (
    <div className="space-y-5">
    <Card>
      <CardHeader
        title="Assign a midterm"
        description="Assign an existing interactive midterm to every student in this class. Results appear below."
      />
      {err && <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{err}</p>}
      {isLoading ? (
        <LoadingState label="Loading midterms…" />
      ) : midterms.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No published midterms available for this subject. Midterms are authored in the admin/questions console.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {midterms.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <Timer className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{m.title || `Midterm #${m.id}`}</p>
                <p className="text-xs text-muted-foreground">{m.module_count} module(s)</p>
              </div>
              {assignedId === m.id ? (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                  <Check className="h-4 w-4" /> Assigned
                </span>
              ) : (
                <Button loading={assign.isPending} onClick={() => doAssign(m.id)}>Assign to class</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
    <MidtermResultsSection classId={id} />
    </div>
  );
}
