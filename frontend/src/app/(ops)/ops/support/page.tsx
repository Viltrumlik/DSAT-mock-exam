"use client";

import { useMemo, useState } from "react";
import { CalendarClock, LifeBuoy } from "lucide-react";

import { Alert, Badge, Card, Skeleton } from "@/components/ui";
import {
  useSetSupportHour,
  useSupportTeachers,
  useSupportWeek,
} from "@/features/opsSupport/opsSupportHooks";
import { WeeklyHoursEditor } from "@/features/opsSupport/WeeklyHoursEditor";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import type { SupportHour } from "@/features/opsSupport/opsSupportApi";

/**
 * Support teaching, from the school's side: who does it, and which hours they are available.
 *
 * This console had no support section at all, so the only way to set a teacher's hours was to
 * be that teacher. The endpoints for an admin to act on somebody else's calendar already
 * existed — what was missing was any surface that used them.
 *
 * The week is a GRID — hours down, days across — rather than a list of chips per day. The
 * first version wrapped twelve chips onto two rows per day, five days running, so the same
 * hour sat in a different place on every row and the one question this page exists to answer
 * ("is he free at three on Thursday?") could not be answered by looking. Aligned columns
 * answer it without reading a single label.
 */

const SUBJECT_LABEL: Record<string, string> = {
  math: "Maths",
  english: "English",
  both: "Both",
};

/** 24h and zero-padded: the labels are a column header repeated down the page, so they have
 *  to be the same width or the grid stops looking like a grid. */
function hourLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "--" : `${String(d.getHours()).padStart(2, "0")}:00`;
}

function dayParts(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { weekday: iso, day: "" };
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    day: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
  };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

const CELL_TONE: Record<string, string> = {
  open: "border-success/30 bg-success-soft text-success-foreground hover:border-success/60",
  closed: "border-border bg-surface-3 text-muted-foreground hover:border-muted-foreground/40",
  booked: "border-primary/30 bg-primary-soft text-primary",
  // Outside the weekly schedule. Deliberately the flattest thing on the grid — these hours
  // are not a decision anybody made about this week, they are simply not working time, and
  // giving them the same visual weight as a withdrawal would make every calendar look full
  // of cancellations.
  off: "border-dashed border-border bg-transparent text-muted-foreground/50",
};

const CELL_LABEL: Record<string, string> = {
  open: "Available",
  closed: "Withdrawn",
  booked: "Booked",
  off: "Outside working hours",
};

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-muted-foreground">
      {(["open", "closed", "booked", "off"] as const).map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded border ${CELL_TONE[state]}`} aria-hidden />
          {CELL_LABEL[state]}
        </span>
      ))}
      <span className="text-muted-foreground/70">
        · click a working hour to withdraw or re-open it. To change the hours themselves, use
        the weekly schedule above.
      </span>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
      <div className="text-lg font-extrabold leading-none text-foreground">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export default function OpsSupportPage() {
  const teachers = useSupportTeachers();
  const [selected, setSelected] = useState<number | null>(null);
  const week = useSupportWeek(selected);
  const setHour = useSetSupportHour(selected);
  const [error, setError] = useState<string | null>(null);

  // The grid needs hours as ROWS, but the payload is days each carrying their own hours.
  // Pivot once here rather than searching the payload per cell.
  const grid = useMemo(() => {
    const days = week.data?.days_out ?? [];
    const hourKeys = new Set<string>();
    for (const d of days) for (const h of d.hours) hourKeys.add(hourLabel(h.starts_at));
    const rows = [...hourKeys].sort();
    const byDayHour = new Map<string, SupportHour>();
    for (const d of days) {
      for (const h of d.hours) byDayHour.set(`${d.date}|${hourLabel(h.starts_at)}`, h);
    }
    return { days, rows, byDayHour };
  }, [week.data]);

  return (
    <div className="space-y-5">
      <OpsPageHeader
        section="Support"
        title="Support teaching"
        description="Set each teacher's weekly hours once — they keep applying. The grid below is for withdrawing one specific hour."
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,17rem)_1fr]">
        {/* Who */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold">
            <LifeBuoy className="h-4 w-4 text-primary" aria-hidden /> Support teachers
          </h2>

          {teachers.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12 rounded-xl" />
              <Skeleton className="h-12 rounded-xl" />
            </div>
          ) : teachers.isError ? (
            <Alert tone="danger">
              The list didn&apos;t load.{" "}
              <button className="underline" onClick={() => void teachers.refetch()}>
                Try again
              </button>
            </Alert>
          ) : teachers.data.length === 0 ? (
            <p className="text-sm font-semibold text-muted-foreground">
              No support teachers yet. Create one from Users with the support teacher role.
            </p>
          ) : (
            <ul className="space-y-1">
              {teachers.data.map((t) => {
                const active = selected === t.id;
                const name = t.name || t.email;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setSelected(t.id);
                      }}
                      aria-pressed={active}
                      className={`ds-ring flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary-soft"
                          : "border-transparent hover:border-border hover:bg-surface-2"
                      }`}
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                          active ? "bg-primary text-primary-foreground" : "bg-surface-3 text-muted-foreground"
                        }`}
                        aria-hidden
                      >
                        {initials(name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-foreground">{name}</span>
                        <span className="block truncate text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
                          {SUBJECT_LABEL[t.subject] ?? t.subject}
                        </span>
                      </span>
                      {!t.is_active ? <Badge variant="neutral">Off</Badge> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* When — the standing weekly rule first, then the dated exceptions to it. In that
            order because that is the order the two are decided in: you agree the week, and
            only then do you withdraw a specific Thursday. */}
        <div className="space-y-4">
        {selected != null ? (
          <Card>
            <WeeklyHoursEditor
              // Remount on teacher change. Without the key the editor keeps the previous
              // teacher's draft in state while the new one's schedule loads, and a fast admin
              // could save Ali's hours onto Dilafruz.
              key={selected}
              supportTeacherId={selected}
              teacherName={
                teachers.data?.find((t) => t.id === selected)?.name ?? "This teacher"
              }
            />
          </Card>
        ) : null}

        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-extrabold">
              <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> This week
            </h2>
            {selected != null && week.data ? (
              <div className="flex gap-2">
                <Stat value={week.data.free_hours} label="Free" />
                <Stat value={week.data.booked_sessions} label="Booked" />
              </div>
            ) : null}
          </div>

          {selected == null ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                Pick a support teacher to see and change their hours.
              </p>
            </div>
          ) : week.isPending ? (
            <Skeleton className="h-72 rounded-xl" />
          ) : week.isError ? (
            <Alert tone="danger">
              That calendar didn&apos;t load.{" "}
              <button className="underline" onClick={() => void week.refetch()}>
                Try again
              </button>
            </Alert>
          ) : grid.rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                No hours in this teacher&apos;s window yet.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm font-bold text-foreground">{week.data.support_teacher.name}</p>

              {/* Wide grids scroll inside their own box — the console page itself must never
                  scroll sideways. */}
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[520px] border-separate border-spacing-1">
                  <thead>
                    <tr>
                      <th className="w-14" />
                      {grid.days.map((d) => {
                        const { weekday, day } = dayParts(d.date);
                        return (
                          <th key={d.date} className="pb-1 text-center">
                            <div className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-foreground">
                              {weekday}
                            </div>
                            <div className="text-[11px] font-semibold text-muted-foreground">{day}</div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.rows.map((hour) => (
                      <tr key={hour}>
                        <th
                          scope="row"
                          className="pr-1 text-right align-middle text-[11px] font-bold tabular-nums text-muted-foreground"
                        >
                          {hour}
                        </th>
                        {grid.days.map((d) => {
                          const cell = grid.byDayHour.get(`${d.date}|${hour}`);
                          if (!cell) return <td key={d.date} />;
                          const booked = cell.state === "booked";
                          const closed = cell.state === "closed";
                          // Not working time at all. Withdrawing an hour that is already
                          // outside the schedule would write a row that changes nothing, so
                          // the cell is inert — the weekly form above is where this moves.
                          const off = cell.state === "off";
                          const who = (cell.bookings ?? []).map((b) => b.student).join(", ");
                          return (
                            <td key={d.date}>
                              <button
                                type="button"
                                // A booked hour is somebody's appointment. Withdrawing it here
                                // would strand a student expecting to be seen, so the control
                                // is disabled and the settle/cancel flow owns that case.
                                disabled={booked || off || setHour.isPending}
                                aria-label={`${dayParts(d.date).weekday} ${hour} — ${cell.state}`}
                                title={
                                  booked
                                    ? `Booked: ${who}`
                                    : off
                                      ? "Outside working hours — change the weekly schedule above"
                                      : closed
                                        ? "Withdrawn — click to re-open"
                                        : "Available — click to withdraw"
                                }
                                onClick={() => {
                                  setError(null);
                                  setHour.mutate(
                                    { startsAt: cell.starts_at, action: closed ? "open" : "close" },
                                    {
                                      onError: (e) => {
                                        const detail = (
                                          e as { response?: { data?: { detail?: string } } }
                                        )?.response?.data?.detail;
                                        setError(detail ?? "That hour couldn't be changed.");
                                      },
                                    },
                                  );
                                }}
                                className={`ds-ring h-8 w-full rounded-md border text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-90 ${CELL_TONE[cell.state] ?? CELL_TONE.open}`}
                              >
                                {booked ? initials(who || "?") : closed ? "—" : off ? "·" : ""}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Legend />
            </>
          )}
        </Card>
        </div>
      </div>
    </div>
  );
}
