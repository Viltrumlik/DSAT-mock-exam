"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Timer, ChevronRight } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { midtermApi } from "@/lib/midtermApi";
import { nextNDays, timeSlots, combineLocalDateTimeIso } from "@/lib/scheduleOptions";
import { Card, CardHeader, Button, Field, LoadingState, ConfirmDialog } from "../ui";
import { MidtermPanel } from "./MidtermPanel";
import type { ClassroomWithRole } from "../types";

const scheduleSelectCls =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50";

/** Curated date (next 7 days) + time (08:00–18:00, 15-min) picker pair. */
function SchedulePicker({
  dateValue, timeValue, onDate, onTime, days, slots,
}: {
  dateValue: string; timeValue: string;
  onDate: (v: string) => void; onTime: (v: string) => void;
  days: { value: string; label: string }[]; slots: { value: string; label: string }[];
}) {
  return (
    <div className="flex gap-2">
      <select aria-label="Date" value={dateValue} onChange={(e) => onDate(e.target.value)} className={`${scheduleSelectCls} min-w-0 flex-1`}>
        <option value="">No date</option>
        {days.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      <select aria-label="Time" value={timeValue} onChange={(e) => onTime(e.target.value)} disabled={!dateValue} className={`${scheduleSelectCls} min-w-0 flex-1`}>
        {slots.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  );
}

// Classroom subject (ENGLISH/MATH) → midterm subject (READING_WRITING/MATH).
const MIDTERM_SUBJECT: Record<string, string> = { MATH: "MATH", ENGLISH: "READING_WRITING" };

/** Midterms already given to this class — each opens its control panel. */
function AssignedMidterms({ classId, onOpen }: { classId: number; onOpen: (id: number, title: string) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["classroom-midterm-v2", "given", classId],
    queryFn: () => midtermApi.classroomMidterms(classId),
  });
  const midterms = data ?? [];
  if (isLoading) return <LoadingState label="Loading midterms…" />;
  if (midterms.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Given midterms" description="Open a midterm to see who took it, manage its schedule, and publish results + certificates." />
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

interface Catalog {
  id: number;
  title: string;
  subject: string;
  /** Difficulty tier ("foundation"/"junior"/"middle"/"senior"); "" = untagged. */
  level: string;
  duration_minutes: number;
  question_count: number;
}

/**
 * Browse published midterms and assign one to the whole class (optionally scheduled with a
 * start countdown + deadline). Assigned midterms drill into a per-midterm control panel
 * (roster + stats + schedule + class-ranked certificates). Backed by /classes/<id>/midterms-v2.
 */
export function Midterms({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const classSubject = String((classroom as Record<string, unknown>).subject ?? "");
  const classLevel = String((classroom as Record<string, unknown>).level ?? "");
  const qc = useQueryClient();
  const { data: catalog, isLoading } = useQuery({ queryKey: ["midterm", "catalog"], queryFn: midtermApi.catalog });
  const [assignedId, setAssignedId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Catalog | null>(null);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("18:00");
  const [open, setOpen] = useState<{ id: number; title: string } | null>(null);
  const days = useMemo(() => nextNDays(7), []);
  const slots = useMemo(() => timeSlots(8, 18, 15), []);

  // Scope the picker to THIS classroom: subject (Math class → Math midterms) and
  // difficulty level (a Middle class only sees Middle midterms). Levels use the same
  // lowercase codes across Classroom/Midterm. An untagged classroom (blank level)
  // keeps seeing every level — same rule the assessment picker uses.
  const wanted = MIDTERM_SUBJECT[classSubject];
  const all = ((catalog ?? []) as Catalog[]);
  const midterms = all.filter(
    (m) => (!wanted || m.subject === wanted) && (!classLevel || m.level === classLevel),
  );

  const assign = useMutation({
    mutationFn: (m: Catalog) =>
      midtermApi.assignToClassroom(id, m.id, {
        starts_at: combineLocalDateTimeIso(startDate, startTime) ?? undefined,
        deadline: combineLocalDateTimeIso(deadlineDate, deadlineTime) ?? undefined,
      }),
    onSuccess: (_data, m) => {
      setPending(null);
      setAssignedId(m.id);
      pushGlobalToast({ tone: "success", message: `“${m.title}” assigned to the class.` });
      qc.invalidateQueries({ queryKey: ["classroom-midterm-v2", "given", id] });
      setTimeout(() => setAssignedId((cur) => (cur === m.id ? null : cur)), 2500);
    },
    onError: (e) => {
      const msg = normalizeApiError(e).message;
      setErr(msg);
      setPending(null);
      pushGlobalToast({ tone: "error", message: msg });
    },
  });

  function startAssign(m: Catalog) {
    setStartDate("");
    setStartTime("08:00");
    setDeadlineDate("");
    setDeadlineTime("18:00");
    setPending(m);
  }

  if (open) {
    return <MidtermPanel classId={id} midtermId={open.id} title={open.title} onBack={() => setOpen(null)} />;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Assign a midterm"
          description="Assign a published midterm to every student in this class. Optionally schedule when it opens."
        />
        {err && <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{err}</p>}
        {isLoading ? (
          <LoadingState label="Loading midterms…" />
        ) : midterms.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No published midterms match this class
            {classLevel ? ` (${classSubject.toLowerCase()} · ${classLevel} level)` : ` (${classSubject.toLowerCase()})`}.
            Midterms are authored in the Builder, where each one is tagged with a subject and level.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {midterms.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <Timer className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{m.title || `Midterm #${m.id}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.level ? `${m.level} · ` : ""}{m.duration_minutes}m · {m.question_count} questions
                  </p>
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
        onConfirm={() => pending && assign.mutate(pending)}
        onCancel={() => setPending(null)}
      >
        <div className="mt-4 space-y-3">
          <Field label="Opens at (optional)" hint="Pick a day this week and a time (8:00 AM – 6:00 PM). Leave the day empty to open immediately.">
            <SchedulePicker dateValue={startDate} timeValue={startTime} onDate={setStartDate} onTime={setStartTime} days={days} slots={slots} />
          </Field>
          <Field label="Deadline (optional)" hint="After this the midterm can no longer be started.">
            <SchedulePicker dateValue={deadlineDate} timeValue={deadlineTime} onDate={setDeadlineDate} onTime={setDeadlineTime} days={days} slots={slots} />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
