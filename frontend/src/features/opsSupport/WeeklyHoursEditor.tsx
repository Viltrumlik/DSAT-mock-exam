"use client";

/**
 * A support teacher's STANDING weekly schedule: which weekdays they work, and when.
 *
 * This is the form the school asked for, and it replaces a workflow that could not be
 * completed. Hours used to be set by clicking cells on a rolling four-day grid — so "I work
 * 10–4 on Wednesdays" had to be re-entered every time the window slid forward, which meant it
 * never was, and the desk ran on an 08:00–18:00 default nobody had agreed to.
 *
 * The grid is still below this, and it is still useful — it is where you withdraw one specific
 * Thursday afternoon. But it is now the EXCEPTION layer over this rule, not the only way to
 * express the rule. The two compose in one direction: this can close an hour the grid would
 * open, never the reverse.
 *
 * **The whole week saves at once**, and the Save button is the only thing that writes.
 * Per-row auto-save was the obvious alternative and is wrong here: switching Tuesday off and
 * then fixing Wednesday's hours would fire two writes, and an admin who changed their mind
 * half way would have already half-applied a schedule students can book against.
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Info, TriangleAlert } from "lucide-react";

import { Alert, Button, Select, Skeleton, Switch } from "@/components/ui";
import type { SupportWorkingDay } from "./opsSupportApi";
import { useSetSupportWorkingHours, useSupportWorkingHours } from "./opsSupportHooks";

/** `13` → `"13:00"`. Zero-padded because these sit in a column and have to align. */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function sameSchedule(a: SupportWorkingDay[], b: SupportWorkingDay[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((d, i) =>
    d.weekday === b[i].weekday &&
    d.is_working === b[i].is_working &&
    d.start_hour === b[i].start_hour &&
    d.end_hour === b[i].end_hour,
  );
}

export function WeeklyHoursEditor({
  supportTeacherId,
  teacherName,
}: {
  supportTeacherId: number;
  teacherName: string;
}) {
  const schedule = useSupportWorkingHours(supportTeacherId);
  const save = useSetSupportWorkingHours(supportTeacherId);

  const [draft, setDraft] = useState<SupportWorkingDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Re-seed when the server answers, and when the admin switches teacher. Keyed on the id as
  // well as the payload so that picking a second teacher cannot leave the first one's draft
  // on screen — that would let somebody save Ali's hours onto Dilafruz.
  useEffect(() => {
    if (schedule.data) setDraft(schedule.data.days.map((d) => ({ ...d })));
    setError(null);
    setSaved(null);
  }, [schedule.data, supportTeacherId]);

  const openHour = schedule.data?.open_hour ?? 8;
  const closeHour = schedule.data?.close_hour ?? 18;

  /** Every hour the desk could possibly open at, and every hour it could close at. */
  const startOptions = useMemo(
    () => Array.from({ length: closeHour - openHour }, (_, i) => openHour + i),
    [openHour, closeHour],
  );
  const endOptions = useMemo(
    () => Array.from({ length: closeHour - openHour }, (_, i) => openHour + 1 + i),
    [openHour, closeHour],
  );

  const dirty = Boolean(draft && schedule.data && !sameSchedule(draft, schedule.data.days));

  function patch(weekday: number, next: Partial<SupportWorkingDay>) {
    setSaved(null);
    setDraft((prev) =>
      (prev ?? []).map((d) => {
        if (d.weekday !== weekday) return d;
        const merged = { ...d, ...next };
        // Keep the window coherent as the admin types rather than refusing it on save. A
        // start that has just overtaken the finish pushes the finish along, which is what
        // somebody dragging a day later actually means.
        if (merged.end_hour <= merged.start_hour) {
          merged.end_hour = Math.min(closeHour, merged.start_hour + 1);
        }
        return merged;
      }),
    );
  }

  /** Copy the first working day's window onto every other working day. */
  function applyToAll() {
    const source = (draft ?? []).find((d) => d.is_working);
    if (!source) return;
    setSaved(null);
    setDraft((prev) =>
      (prev ?? []).map((d) =>
        d.is_working
          ? { ...d, start_hour: source.start_hour, end_hour: source.end_hour }
          : d,
      ),
    );
  }

  function submit() {
    if (!draft) return;
    setError(null);
    setSaved(null);
    save.mutate(draft, {
      onSuccess: (res) => {
        const clashes = res.bookings_outside_schedule ?? [];
        setSaved(
          clashes.length === 0
            ? "Working hours saved. They apply from now on."
            : `Working hours saved. ${clashes.length} existing booking${clashes.length === 1 ? "" : "s"} ` +
              `now sit outside these hours — they are still going ahead, so cancel them on the ` +
              `grid below if they should not.`,
        );
      },
      onError: (e) => {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        setError(detail ?? "Those hours couldn't be saved.");
      },
    });
  }

  if (schedule.isPending) return <Skeleton className="h-64 rounded-xl" />;

  // A failed fetch must never render as "this teacher works no days" — that reads as a
  // decision somebody made, and an admin acting on it would save it as one.
  //
  // Gated on having no draft, NOT on `isError` alone. React Query keeps `data` through a
  // failed BACKGROUND refetch while still raising `isError`, so testing the flag first would
  // replace a form the admin may be halfway through editing with an error banner and lose
  // their edits — on a blip that changed nothing. Same lesson as the auth fix: a transient
  // failure must not destroy working state. A stale-but-real schedule stays on screen and
  // says so.
  if (!draft) {
    return (
      <Alert tone="danger">
        The weekly schedule didn&apos;t load.{" "}
        <button className="underline" onClick={() => void schedule.refetch()}>
          Try again
        </button>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-extrabold">
          <CalendarRange className="h-4 w-4 text-primary" aria-hidden /> Weekly schedule
        </h2>
        {(draft ?? []).some((d) => d.is_working) ? (
          <Button size="sm" variant="secondary" onClick={applyToAll} disabled={save.isPending}>
            Same hours every working day
          </Button>
        ) : null}
      </div>

      <p className="text-sm font-medium text-muted-foreground">
        Set once — {teacherName} is bookable at these hours every week, until you change them.
      </p>

      {/* "Nobody has set this up" and "somebody chose 08:00–18:00" look identical on screen
          and mean very different things. Say which one this is. */}
      {schedule.data && !schedule.data.configured ? (
        <Alert tone="info">
          <span className="inline-flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              No schedule has been set yet, so {teacherName} is currently bookable{" "}
              {hourLabel(openHour)}–{hourLabel(closeHour)} every day — the platform default.
              Save below to replace it.
            </span>
          </span>
        </Alert>
      ) : null}

      {/* The form is still usable and still saveable — the last read just failed, so what is
          on screen may be behind the server. Said plainly rather than swallowed: an admin
          about to save needs to know they might be overwriting somebody else's edit. */}
      {schedule.isError ? (
        <Alert tone="warning">
          Couldn&apos;t refresh these hours just now, so they may be out of date.{" "}
          <button className="underline" onClick={() => void schedule.refetch()}>
            Try again
          </button>
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {saved ? <Alert tone="success">{saved}</Alert> : null}

      <div className="overflow-hidden rounded-xl border border-border">
        {draft.map((day, i) => (
          // A GRID, not a wrapping flex row. The controls are too wide to sit beside a day
          // name in the console's narrow right-hand column, so a flex row wrapped them onto
          // their own line at an unpredictable point and every row ended up a different
          // height. Two columns from `sm` up, stacked below it, so the switches stay in one
          // vertical line and the eye can run down the week.
          <div
            key={day.weekday}
            className={`grid grid-cols-1 items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[minmax(0,9rem)_1fr] ${
              i > 0 ? "border-t border-border" : ""
            } ${day.is_working ? "" : "bg-surface-2"}`}
          >
            <div className="flex items-center gap-2.5">
              {/* `id` + our own <label>, never the Switch's `label` prop — that prop renders
                  as VISIBLE text, so passing it printed the day name twice. A <button> is a
                  labelable element, so htmlFor still gives the switch its accessible name. */}
              <Switch
                id={`workday-${day.weekday}`}
                checked={day.is_working}
                onCheckedChange={(next) => patch(day.weekday, { is_working: next })}
                disabled={save.isPending}
              />
              <label
                htmlFor={`workday-${day.weekday}`}
                className={`cursor-pointer text-sm font-bold ${
                  day.is_working ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {day.label}
              </label>
            </div>

            {day.is_working ? (
              /* Each Select is boxed in a fixed-width wrapper. `Select` renders its own
                 `relative w-full` container around the element, so a width class passed to
                 the component lands on the inner <select> and the wrapper still claims the
                 whole row — which stacked the two dropdowns vertically and made every day
                 three lines tall. Constraining from outside is the only thing that works. */
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-[5.75rem] shrink-0">
                  <Select
                    aria-label={`${day.label} — first hour`}
                    value={String(day.start_hour)}
                    disabled={save.isPending}
                    onChange={(e) => patch(day.weekday, { start_hour: Number(e.target.value) })}
                  >
                    {startOptions.map((h) => (
                      <option key={h} value={String(h)}>{hourLabel(h)}</option>
                    ))}
                  </Select>
                </div>
                <span className="text-xs font-bold text-muted-foreground">to</span>
                <div className="w-[5.75rem] shrink-0">
                  <Select
                    aria-label={`${day.label} — last hour`}
                    value={String(day.end_hour)}
                    disabled={save.isPending}
                    onChange={(e) => patch(day.weekday, { end_hour: Number(e.target.value) })}
                  >
                    {endOptions
                      .filter((h) => h > day.start_hour)
                      .map((h) => (
                        <option key={h} value={String(h)}>{hourLabel(h)}</option>
                      ))}
                  </Select>
                </div>
                {/* The end is exclusive, and an admin has no way to know that from two
                    dropdowns. Say what it means in sessions, which is the unit they think in. */}
                <span className="whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
                  last session {hourLabel(day.end_hour - 1)}
                </span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground">Not working</span>
            )}
          </div>
        ))}
      </div>

      {!draft.some((d) => d.is_working) ? (
        <Alert tone="warning">
          <span className="inline-flex items-start gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Every day is switched off. Saving this takes {teacherName} off the students&apos;
              booking calendar entirely.
            </span>
          </span>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2">
        <Button onClick={submit} loading={save.isPending} disabled={!dirty}>
          Save working hours
        </Button>
        {dirty ? (
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              if (schedule.data) setDraft(schedule.data.days.map((d) => ({ ...d })));
              setError(null);
              setSaved(null);
            }}
          >
            Discard
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default WeeklyHoursEditor;
