"use client";

import { useState } from "react";
import Link from "next/link";
import { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { cn } from "@/lib/cn";
import { Button, Menu, Sheet, signedAmount, type MenuItem } from "@/features/console/ui";
import { formatPhone } from "@/features/ops/people/format";
import { dayText } from "@/features/ops/detail/groupFacts";
import { serverReason, useClassroomPart, type ClassroomCore, type ClassroomRoster } from "../classroomsApi";
import type { SeatAction, SeatStatus } from "../seatsApi";
import { AddSeatDialog, NewStudentDialog, SeatActionDialog } from "./SeatDialogs";
import { AddStudent, FIXED_DATE, SEAT_ACTIONS } from "./StudentsSection";

/**
 * The group page's roster, lc-up's left column (Group board, 22 Nov 2026): "Students" with its count, A→Z, Add,
 * the four dots' legend, then one row per student — number, dot, name, phone, what they owe (`view_money` only),
 * and a ⋮ with the seat's own steps (the seat tools once lc-up is off; the old Remove for a class lc-up does not run;
 * nothing for a class lc-up runs). The footer shows the rest and who left the group.
 */

const FIRST = 12;

type Row = ClassroomRoster["students"][number];
type Dot = "active" | "owes" | "trial" | "frozen";

const DOT: Record<Dot, { label: string; colour: string }> = {
  active: { label: "Active", colour: "bg-ms-positive" },
  owes: { label: "Owes", colour: "bg-ms-critical" },
  trial: { label: "Demo", colour: "bg-ms-attention" },
  frozen: { label: "Frozen", colour: "bg-ms-frozen" },
};

/** A frozen or demo seat says so first; a debt next; anyone else is active. */
export function dotOf(row: Pick<Row, "seat_status" | "owes">): Dot {
  if (row.seat_status === "frozen") return "frozen";
  if (row.seat_status === "trial") return "trial";
  if (row.owes) return "owes";
  return "active";
}

type Step =
  | { kind: "action"; action: SeatAction; student: { id: number; name: string }; trial?: boolean; day?: string | null; dateLabel?: string }
  | { kind: "add" }
  | { kind: "seat"; student: { id: number; name: string } }
  | { kind: "new" };

export function RosterAside({
  room,
  onChanged,
  canMoney,
  className,
}: {
  room: ClassroomCore;
  onChanged: () => void;
  /** `view_money`: what each student owes beside their name. */
  canMoney: boolean;
  className?: string;
}) {
  const managed = room.lcup?.managed ?? false;
  const seatsOpen = room.seats_open ?? false;
  const query = useClassroomPart<ClassroomRoster>(room.id, "roster");
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [descending, setDescending] = useState(false);
  const [all, setAll] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [step, setStep] = useState<Step | null>(null);

  const done = () => {
    setStep(null);
    onChanged();
  };

  const remove = async (id: number, name: string) => {
    setBusy(true);
    try {
      await classesApi.removeMember(room.id, id);
      push({ tone: "success", message: `Removed ${name} from ${room.name}.` });
      onChanged();
    } catch (e: unknown) {
      push({ tone: "error", message: serverReason(e, "Could not remove the student.") });
    } finally {
      setBusy(false);
    }
  };

  const itemsFor = (s: Row): MenuItem[] => {
    const name = s.name || s.username;
    const items: MenuItem[] = [{ label: "Open profile", icon: "user", href: `/ops/${s.section}/${s.id}` }];
    if (managed) return items;
    if (seatsOpen) {
      const status: SeatStatus = s.seat_status ?? "active";
      for (const { action, label } of SEAT_ACTIONS[status]) {
        items.push({
          label,
          danger: action === "leave",
          onSelect: () =>
            setStep({
              kind: "action",
              action,
              student: { id: s.id, name },
              trial: status === "trial",
              ...(action === "fix-date" ? { day: status === "frozen" ? s.seat_frozen_on : s.seat_start_date, dateLabel: FIXED_DATE[status] } : {}),
            }),
        });
      }
    } else {
      items.push({ label: "Remove", icon: "trash", danger: true, onSelect: () => void remove(s.id, name) });
    }
    return items;
  };

  const students = query.data?.students ?? [];
  const left = query.data?.left ?? [];
  const sorted = descending ? [...students].reverse() : students;
  const shown = all ? sorted : sorted.slice(0, FIRST);
  // "Owes" counts students, never families (owner's rule 5); a debt shows only with `view_money`.
  const tally: Record<Dot, number> = { active: 0, owes: 0, trial: 0, frozen: 0 };
  for (const s of students) tally[canMoney ? dotOf(s) : dotOf({ ...s, owes: null })] += 1;

  return (
    <aside aria-label="Students" className={cn("flex min-w-0 flex-col gap-1 rounded-ms-card border border-ms-border bg-ms-card px-3 pb-3 pt-4", className)}>
      <div className="flex items-center gap-2 px-2 pb-2">
        <h2 className="text-ms-h flex-1 text-ms-fg">Students</h2>
        {query.data ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-ms-surface-2 px-2 text-[13px] font-semibold tabular-nums text-ms-fg-2">
            {students.length}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          icon="sort"
          aria-label={descending ? "Sort A to Z" : "Sort Z to A"}
          onClick={() => setDescending((v) => !v)}
        />
        {managed ? null : (
          <Button variant="subtle" size="sm" icon="userplus" onClick={() => setStep({ kind: "add" })}>
            Add
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-2 text-[13px] text-ms-fg-3">
        {(Object.keys(DOT) as Dot[]).filter((d) => canMoney || d !== "owes").map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", DOT[d].colour)} />
            {DOT[d].label}
            {query.data ? <span className="tabular-nums text-ms-fg-2">{tally[d]}</span> : null}
          </span>
        ))}
      </div>
      {managed ? <p className="px-2 pb-2 text-[13px] text-ms-fg-3">Students come from lc-up. Add or remove them there.</p> : null}

      {query.isPending ? (
        <p className="px-2 py-2 text-[14px] text-ms-fg-3">Loading…</p>
      ) : query.isError ? (
        <p role="alert" className="mx-2 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-[14px] text-ms-critical-fg">
          Could not load.{" "}
          <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : students.length === 0 ? (
        <p className="px-2 py-2 text-[14px] text-ms-fg-2">No students in this group.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {shown.map((s) => {
            const n = sorted.indexOf(s) + 1;
            const dot = dotOf(canMoney ? s : { ...s, owes: null });
            const name = s.name || s.username;
            return (
              <li key={s.id} data-testid="roster-row" className="flex min-h-12 items-center gap-2.5 rounded-ms-ctl px-2 hover:bg-ms-row-hover">
                <span className="w-5 shrink-0 text-right text-[13px] tabular-nums text-ms-fg-3">{n}</span>
                <span aria-label={DOT[dot].label} role="img" className={cn("size-2 shrink-0 rounded-full", DOT[dot].colour)} />
                <span className="min-w-0 flex-1 leading-tight">
                  <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} title={name} className="block truncate font-medium text-ms-fg hover:underline">
                    {name}
                  </Link>
                  {s.phone ? <span className="block truncate text-[12.5px] tabular-nums text-ms-fg-3">{formatPhone(s.phone)}</span> : null}
                </span>
                {canMoney && s.owes ? (
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ms-critical-fg">{signedAmount(-s.owes)}</span>
                ) : null}
                <Menu label={`More actions for ${name}`} items={itemsFor(s)} disabled={busy} />
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-1.5 flex flex-wrap gap-1.5 px-1">
        {sorted.length > FIRST ? (
          <Button variant="ghost" size="sm" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${sorted.length}`}
          </Button>
        ) : null}
        {left.length ? (
          <Button variant="ghost" size="sm" icon="archive" aria-expanded={leftOpen} onClick={() => setLeftOpen((v) => !v)}>
            Left the group · {left.length}
          </Button>
        ) : null}
      </div>
      {leftOpen && left.length ? (
        <ul aria-label="Left the group" className="m-0 mt-1 flex list-none flex-col border-t border-ms-border p-0 pt-1">
          {left.map((s) => (
            <li key={s.id} className="flex min-h-11 items-center gap-2.5 px-2">
              <span className="min-w-0 flex-1 leading-tight">
                <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className="block truncate font-medium text-ms-fg hover:underline">
                  {s.name}
                </Link>
                <span className="block text-[12.5px] text-ms-fg-3">last day {dayText(s.seat_left_on)}</span>
              </span>
              {seatsOpen ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setStep({ kind: "action", action: "fix-date", student: { id: s.id, name: s.name }, day: s.seat_left_on, dateLabel: "Last day" })
                  }
                >
                  Fix date
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet open={step?.kind === "add"} onClose={() => setStep(null)} title="Add a student">
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ms-fg-3">to {room.name}</p>
          <AddStudent
            room={room}
            onAdded={() => {
              setStep(null);
              onChanged();
            }}
            onChoose={seatsOpen ? (student) => setStep({ kind: "seat", student }) : undefined}
          />
          {seatsOpen ? (
            <Button variant="secondary" icon="userplus" className="self-start" onClick={() => setStep({ kind: "new" })}>
              New student
            </Button>
          ) : null}
        </div>
      </Sheet>
      {step?.kind === "action" ? (
        <SeatActionDialog
          roomId={room.id}
          student={step.student}
          action={step.action}
          trial={step.trial}
          day={step.day}
          dateLabel={step.dateLabel}
          onClose={() => setStep(null)}
          onDone={done}
        />
      ) : null}
      {step?.kind === "seat" ? <AddSeatDialog roomId={room.id} student={step.student} onClose={() => setStep(null)} onDone={done} /> : null}
      {step?.kind === "new" ? <NewStudentDialog roomId={room.id} onClose={() => setStep(null)} onDone={onChanged} /> : null}
    </aside>
  );
}
