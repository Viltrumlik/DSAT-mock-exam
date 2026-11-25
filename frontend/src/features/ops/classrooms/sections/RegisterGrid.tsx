"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
// The day menu is the portalled DropdownMenu: the grid scrolls sideways and would cut an absolute menu off.
import { DropdownMenu, DropdownMenuItem } from "@/components/ui";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { Button, DemoBadge, Segmented, Select } from "@/features/console/ui";
import { monthShort, shortDay } from "@/features/ops/detail/groupFacts";
import { P, holds } from "@/features/ops/permissions";
import { useMe } from "@/hooks/useMe";
import { classroomKeys, useClassroomRegister, type ClassroomRegister } from "../classroomsApi";
import { lessonChangesKey, type DayChange } from "../lessonChangesApi";
import { CancelLessonDialog, MoveLessonDialog, UndoChangeDialog } from "./LessonChangeDialogs";

/**
 * The group page's Attendance tab, lc-up's "Davomat" (Group board, 22 Nov 2026): a year and a month, then a ruled
 * register — students down, the month's lesson dates across — with a mark in every cell: ✓ came, ✓ late, ✕ absent,
 * a flag for excused, a snowflake for a frozen seat, a dash before the student joined, an empty ring for a lesson
 * not marked yet. Read-only: a register is marked from "Mark …'s lesson" in the header.
 *
 * A lesson day can be cancelled or moved from its column's "⋯" (`manage_lessons`, owner 2026-11-25): a cancelled
 * column is struck through, a moved one says where it went or came from, and a changed day offers Undo — a centre
 * holiday's too, which undoes it for every group (its dialog says so).
 */

const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Cell = { icon: IconName | null; title: string; tone: string };

const RING = "shadow-[inset_0_0_0_1.5px_var(--ms-border-strong)]";

const MARK: Record<string, Cell> = {
  PRESENT: { icon: "check", title: "Came", tone: "bg-ms-positive-soft text-ms-positive-fg" },
  LATE: { icon: "ms-late", title: "Late", tone: "bg-ms-attention-soft text-ms-attention-fg" },
  ABSENT: { icon: "x", title: "Absent", tone: "bg-ms-critical-soft text-ms-critical-fg" },
  EXCUSED: { icon: "flag", title: "Excused", tone: "bg-ms-attention-soft text-ms-attention-fg" },
};

type Student = ClassroomRegister["students"][number];

/** What one cell says, from the mark if there is one, else from the seat and the day. ``off``: no lesson that day. */
export function cellOf(s: Student, date: string, held: boolean, today: string, off = false): Cell {
  const mark = s.marks[date];
  if (mark) return MARK[mark] ?? { icon: null, title: mark, tone: "text-ms-fg-3" };
  if (off) return { icon: "minus", title: "No lesson", tone: "text-ms-fg-disabled" };
  if (s.left) return { icon: "minus", title: "Not in the group", tone: "text-ms-fg-disabled" };
  if (s.joined && date < s.joined) return { icon: "minus", title: "Not in the group yet", tone: "text-ms-fg-disabled" };
  if (s.seat_status === "frozen" && (!s.frozen_on || date >= s.frozen_on)) {
    return { icon: "ms-freeze", title: "Frozen", tone: "bg-ms-frozen-soft text-ms-frozen-fg" };
  }
  if (!held || date > today) return { icon: null, title: "Not marked yet", tone: cn("text-ms-fg-3", RING) };
  return { icon: null, title: "Not marked", tone: cn("text-ms-fg-3", RING) };
}

function monthName(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? MONTH_NAME[Number(m[2]) - 1] : month;
}

/** What a changed column says under its day: "Cancelled: Teacher ill", "Moved to 9 Dec", "Moved from 8 Dec". */
export function changeNote(change: DayChange): string {
  if (change.from_day) return `Moved from ${shortDay(change.from_day)}`;
  if (change.new_day) return `Moved to ${shortDay(change.new_day)}`;
  return `Cancelled: ${change.reason}`;
}

type DateCol = ClassroomRegister["dates"][number];
type Step = { action: "cancel" | "move"; day: string } | { action: "undo"; day: string; change: DayChange };

/** A date's header: the day (struck through when cancelled), what changed under it, and its "⋯" for whoever may. */
function DateHead({ d, today, canChange, onPick }: { d: DateCol; today: string; canChange: boolean; onPick: (step: Step) => void }) {
  const change = d.change ?? null;
  const note = change ? changeNote(change) : null;
  const day = shortDay(d.date);
  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={note ?? undefined}>
      <span className="inline-flex items-center gap-0.5">
        <span
          className={cn(
            "whitespace-nowrap text-[12.5px] tabular-nums",
            d.date === today ? "rounded-ms-badge bg-ms-info-soft px-1.5 py-0.5 font-semibold text-ms-info-fg" : "font-medium text-ms-fg-3",
            change?.kind === "cancel" && "line-through",
          )}
        >
          {day}
        </span>
        {canChange ? (
          <DropdownMenu
            portal
            trigger={
              <button
                type="button"
                aria-label={`Change the lesson of ${day}`}
                className="inline-grid h-6 w-6 place-items-center rounded-[6px] text-ms-fg-3 hover:bg-ms-surface-2 hover:text-ms-fg"
              >
                <Icon name="more" size="sm" />
              </button>
            }
          >
            {change ? (
              <DropdownMenuItem onClick={() => onPick({ action: "undo", day: d.date, change })}>Undo</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={() => onPick({ action: "cancel", day: d.date })}>Cancel lesson…</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onPick({ action: "move", day: d.date })}>Move lesson…</DropdownMenuItem>
              </>
            )}
          </DropdownMenu>
        ) : null}
      </span>
      {note ? <span className="block max-w-[96px] truncate text-[11px] font-normal text-ms-fg-3">{note}</span> : null}
    </span>
  );
}

export function RegisterGrid({ roomId }: { roomId: number }) {
  const [month, setMonth] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const { me } = useMe();
  const canChange = holds(me, P.manageLessons);
  const queryClient = useQueryClient();
  const query = useClassroomRegister(roomId, month);
  const data = query.data;
  const changed = () => {
    setStep(null);
    void queryClient.invalidateQueries({ queryKey: classroomKeys.all });
    // The Today board and the timetable list the day's lessons too, and the timetable every lesson change.
    void queryClient.invalidateQueries({ queryKey: ["classes", "admin", "lessons"] });
    void queryClient.invalidateQueries({ queryKey: lessonChangesKey });
  };
  const shown = month ?? data?.month ?? null;
  const years = [...new Set((data?.months ?? []).map((m) => m.slice(0, 4)))];
  const year = shown?.slice(0, 4) ?? years[years.length - 1] ?? "";
  const months = (data?.months ?? []).filter((m) => m.startsWith(year));

  return (
    <section aria-label="Register" className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {years.length > 1 ? (
          <Select<string>
            aria-label="Year"
            className="w-[110px]"
            value={year}
            onChange={(y) => {
              const last = (data?.months ?? []).filter((m) => m.startsWith(y)).pop();
              if (last) setMonth(last);
            }}
            options={years.map((y) => ({ value: y, label: y }))}
          />
        ) : year ? (
          <span className="text-[14px] font-semibold tabular-nums text-ms-fg-2">{year}</span>
        ) : null}
        {months.length > 1 && shown ? (
          <Segmented<string> label="Month" size="sm" value={shown} onChange={setMonth} options={months.map((m) => ({ value: m, label: monthShort(m) }))} />
        ) : null}
        <span className="flex-1" />
        <span className="flex flex-wrap gap-3 text-[13px] text-ms-fg-3">
          {(["PRESENT", "LATE", "ABSENT", "EXCUSED"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <Icon name={MARK[k].icon as IconName} size="sm" className={MARK[k].tone.split(" ").find((c) => c.startsWith("text-"))} />
              {MARK[k].title}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <Icon name="ms-freeze" size="sm" className="text-ms-frozen-fg" />
            Frozen
          </span>
        </span>
      </div>

      {query.isError && !data ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px] text-ms-critical-fg">
          <Icon name="alert" size="sm" />
          <span className="flex-1">
            <b>Could not load {shown ? `${monthName(shown)}’s` : "the"} register.</b> Marks already saved are safe.
          </span>
          <Button size="sm" icon="refresh" onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : query.isPending ? (
        <p aria-busy className="text-[14px] text-ms-fg-3">
          Loading the register…
        </p>
      ) : data && data.dates.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-ms-ctl bg-ms-surface px-6 py-10 text-center">
          <Icon name="calcheck" size="xl" className="text-ms-fg-3" />
          <h3 className="text-ms-h text-ms-fg">No lessons in {monthName(data.month)}</h3>
          <p className="text-[14px] text-ms-fg-2">No register was held and no lesson day is left in this month.</p>
        </div>
      ) : data && data.students.length === 0 ? (
        <p className="text-[14px] text-ms-fg-2">No students in this group.</p>
      ) : data ? (
        <div className={cn("overflow-x-auto rounded-ms-ctl border border-ms-grid", query.isPlaceholderData && "opacity-60")}>
          <table className="w-full text-[14px]" style={{ minWidth: 200 + data.dates.length * 46 }}>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-[1] min-w-[170px] bg-ms-head px-3 text-left">
                  Student
                </th>
                {data.dates.map((d) => (
                  <th key={d.date} scope="col" className="px-1 text-center">
                    <DateHead d={d} today={data.today} canChange={canChange} onPick={setStep} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id}>
                  <td className="sticky left-0 z-[1] whitespace-nowrap bg-ms-card px-3 font-medium">
                    <Link href={`/ops/${s.section}/${s.id}`} prefetch={false} className={cn("hover:underline", s.left && "text-ms-fg-3")}>
                      {s.name}
                    </Link>
                    {s.is_demo || s.seat_status === "trial" ? <span className="ml-1.5 align-middle"><DemoBadge /></span> : null}
                    {s.left ? <span className="ml-1.5 text-[12px] font-normal text-ms-fg-3">left</span> : null}
                  </td>
                  {data.dates.map((d) => {
                    // Called off, moved away or a centre holiday: nobody had a lesson that day.
                    const c = cellOf(s, d.date, d.held, data.today, Boolean(d.change && !d.change.from_day));
                    return (
                      <td key={d.date} className="px-1 py-1.5 text-center">
                        <span title={c.title} aria-label={c.title} role="img" className={cn("inline-grid h-7 w-[34px] place-items-center rounded-[8px]", c.tone)}>
                          {c.icon ? <Icon name={c.icon} size="sm" /> : null}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {step?.action === "cancel" ? (
        <CancelLessonDialog roomId={roomId} day={step.day} onClose={() => setStep(null)} onDone={changed} />
      ) : step?.action === "move" ? (
        <MoveLessonDialog roomId={roomId} day={step.day} onClose={() => setStep(null)} onDone={changed} />
      ) : step?.action === "undo" ? (
        <UndoChangeDialog
          change={{
            id: step.change.id,
            kind: step.change.kind,
            // A moved-in column is the new day: the change itself is about the day it came from.
            day: step.change.from_day ?? step.day,
            new_day: step.change.from_day ? step.day : (step.change.new_day ?? null),
            holiday: step.change.holiday,
          }}
          onClose={() => setStep(null)}
          onDone={changed}
        />
      ) : null}
    </section>
  );
}
