"use client";

import { useState } from "react";
import { Check, Timer, ChevronRight } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Card, CardHeader, Button, Field, Input, LoadingState, ConfirmDialog } from "../ui";
import { useAssignmentOptions, useAssignMidterm, useMidtermResults } from "../hooks";
import { MidtermPanel } from "./MidtermPanel";
import type { ClassroomWithRole } from "../types";

const localToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** List of midterms already assigned to this class — each opens its control panel. */
function AssignedMidterms({ classId, onOpen }: { classId: number; onOpen: (id: number, title: string) => void }) {
  const { data, isLoading } = useMidtermResults(classId);
  const midterms = data?.midterms ?? [];
  if (isLoading) return <LoadingState label="Loading midterms…" />;
  if (midterms.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Given midterms" description="Open a midterm to see who took it, manage its schedule, and issue certificates." />
      <ul className="mt-3 divide-y divide-border">
        {midterms.map((m) => (
          <li key={m.midterm_id}>
            <button
              onClick={() => onOpen(m.midterm_id, m.title)}
              className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2 rounded-lg px-2"
            >
              <Timer className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{m.title}</p>
                <p className="text-xs text-muted-foreground">{m.subject} · {m.completed}/{m.assigned} completed</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </Card>
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
 * Browse existing interactive midterms and assign one to the whole class (optionally
 * scheduled with a start countdown + deadline). Assigned midterms drill into a per-midterm
 * control panel (roster + stats + schedule + certificates).
 */
export function Midterms({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const classSubject = String((classroom as Record<string, unknown>).subject ?? "");
  const { data, isLoading } = useAssignmentOptions(id);
  const assign = useAssignMidterm(id);
  const [assignedId, setAssignedId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<MidtermOption | null>(null);
  const [startsInput, setStartsInput] = useState("");
  const [deadlineInput, setDeadlineInput] = useState("");
  const [open, setOpen] = useState<{ id: number; title: string } | null>(null);

  const wanted = MIDTERM_SUBJECT[classSubject];
  const all = ((data?.midterms ?? []) as MidtermOption[]);
  const midterms = wanted ? all.filter((m) => m.subject === wanted) : all;

  function startAssign(m: MidtermOption) {
    setStartsInput("");
    setDeadlineInput("");
    setPending(m);
  }

  async function doAssign() {
    if (!pending) return;
    const midtermId = pending.id;
    const title = pending.title || `Midterm #${midtermId}`;
    setErr(null);
    try {
      await assign.mutateAsync({ mockExamId: midtermId, startsAt: localToIso(startsInput), deadline: localToIso(deadlineInput) });
      setPending(null);
      setAssignedId(midtermId);
      pushGlobalToast({ tone: "success", message: `“${title}” assigned to the class.` });
      setTimeout(() => setAssignedId((cur) => (cur === midtermId ? null : cur)), 2500);
    } catch (e) {
      const msg = normalizeApiError(e).message;
      setErr(msg);
      setPending(null);
      pushGlobalToast({ tone: "error", message: msg });
    }
  }

  if (open) {
    return <MidtermPanel classId={id} midtermId={open.id} title={open.title} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Assign a midterm"
          description="Assign an existing interactive midterm to every student in this class. Optionally schedule when it opens."
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
                  <Button loading={assign.isPending && pending?.id === m.id} onClick={() => startAssign(m)}>Assign to class</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <AssignedMidterms classId={id} onOpen={(mid, title) => setOpen({ id: mid, title })} />

      <ConfirmDialog
        open={pending !== null}
        title="Assign midterm to the class?"
        description={pending ? `Every student in this class will be given “${pending.title || `Midterm #${pending.id}`}”. Set an optional start time and deadline below (you can also change these later in the midterm’s panel).` : ""}
        confirmLabel="Assign to class"
        loading={assign.isPending}
        onConfirm={doAssign}
        onCancel={() => setPending(null)}
      >
        <div className="mt-4 space-y-3">
          <Field label="Opens at (optional)" hint="Leave empty to open immediately.">
            <Input type="datetime-local" value={startsInput} onChange={(e) => setStartsInput(e.target.value)} />
          </Field>
          <Field label="Deadline (optional)">
            <Input type="datetime-local" value={deadlineInput} onChange={(e) => setDeadlineInput(e.target.value)} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
