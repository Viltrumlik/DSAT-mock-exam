"use client";

import { useState } from "react";
import { Check, Timer } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, LoadingState } from "../ui";
import { useAssignmentOptions, useAssignMidterm } from "../hooks";
import type { ClassroomWithRole } from "../types";

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
    <Card>
      <CardHeader
        title="Assign a midterm"
        description="Assign an existing interactive midterm to every student in this class. Results appear in the Grading tab."
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
  );
}
