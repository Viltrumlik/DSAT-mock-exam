"use client";

/**
 * A support teacher's STANDING weekly schedule: which weekdays they work, and when.
 *
 * This is the form the school asked for, and it replaces a workflow that could not be
 * completed. Hours used to be set by clicking cells on a rolling four-day grid — so "I work
 * 10–4 on Wednesdays" had to be re-entered every time the window slid forward, which meant it
 * never was, and the desk ran on an 08:00–18:00 default nobody had agreed to.
 *
 * The four-day grid that used to sit below this is gone. It answered the same question in a
 * second, contradictory way, and two controls for one fact is how an admin ends up setting
 * hours in one place and wondering why the other disagrees. Withdrawing a single hour is the
 * support teacher's own job from the teacher portal, where they can see who is booked into it.
 *
 * **The whole week saves at once**, and the Save button is the only thing that writes.
 * Per-row auto-save was the obvious alternative and is wrong here: switching Tuesday off and
 * then fixing Wednesday's hours would fire two writes, and an admin who changed their mind
 * half way would have already half-applied a schedule students can book against.
 *
 * Drawn in the console's look (design handoff v0.3): notices in the verdict colours, the week as
 * one hairline list, native selects in the console's field shell.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Switch } from "@/features/console/ui";
import { CONTROL } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
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

type NoticeTone = "info" | "attention" | "critical" | "positive";

const NOTICE: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: { box: "border-ms-info-line bg-ms-info-soft text-ms-info-fg", icon: "info" },
  attention: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  critical: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
  positive: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
};

/** A standing line above the week, in the colour of what it says, always with its icon. */
function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const t = NOTICE[tone];
  return (
    <div role="status" className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5", t.box)}>
      <Icon name={t.icon} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "Try again" inside a notice: a link-like button in the notice's own colour. */
const RETRY = "rounded-[6px] font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ms-ring";

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
              `now sit outside these hours. They are still going ahead — ${teacherName} can ` +
              `cancel them from the teacher portal if they should not.`,
        );
      },
      onError: (e) => {
        const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail;
        setError(detail ?? "Those hours couldn't be saved.");
      },
    });
  }

  if (schedule.isPending) {
    return <div aria-busy className="animate-ms-shimmer h-64 rounded-ms-card" />;
  }

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
      <Notice tone="critical">
        The weekly schedule didn&apos;t load.{" "}
        <button type="button" className={RETRY} onClick={() => void schedule.refetch()}>
          Try again
        </button>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* No heading of its own: the panel this sits inside already carries one, and two
          titles stacked on the same box is what made the old version look cluttered. */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 basis-[16rem] text-[14px] leading-5 text-ms-fg-2">
          Set once — {teacherName} is bookable at these hours every week, until you change them.
        </p>
        {(draft ?? []).some((d) => d.is_working) ? (
          <Button size="sm" variant="secondary" icon="switch" onClick={applyToAll} disabled={save.isPending}>
            Same hours every day
          </Button>
        ) : null}
      </div>

      {/* "Nobody has set this up" and "somebody chose 08:00–18:00" look identical on screen
          and mean very different things. Say which one this is. */}
      {schedule.data && !schedule.data.configured ? (
        <Notice tone="info">
          No schedule has been set yet, so {teacherName} is currently bookable{" "}
          {hourLabel(openHour)}–{hourLabel(closeHour)} every day — the platform default.
          Save below to replace it.
        </Notice>
      ) : null}

      {/* The form is still usable and still saveable — the last read just failed, so what is
          on screen may be behind the server. Said plainly rather than swallowed: an admin
          about to save needs to know they might be overwriting somebody else's edit. */}
      {schedule.isError ? (
        <Notice tone="attention">
          Couldn&apos;t refresh these hours just now, so they may be out of date.{" "}
          <button type="button" className={RETRY} onClick={() => void schedule.refetch()}>
            Try again
          </button>
        </Notice>
      ) : null}

      {error ? <Notice tone="critical">{error}</Notice> : null}
      {saved ? <Notice tone="positive">{saved}</Notice> : null}

      <div className="overflow-hidden rounded-ms-ctl border border-ms-border">
        {draft.map((day, i) => (
          // A GRID, not a wrapping flex row. The controls are too wide to sit beside a day
          // name in the console's narrow right-hand column, so a flex row wrapped them onto
          // their own line at an unpredictable point and every row ended up a different
          // height. Two columns from `sm` up, stacked below it, so the switches stay in one
          // vertical line and the eye can run down the week.
          <div
            key={day.weekday}
            className={cn(
              "ms-transition grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:grid-cols-[minmax(0,10rem)_1fr]",
              i > 0 && "border-t border-ms-line",
              day.is_working ? "bg-ms-card" : "bg-ms-surface",
            )}
          >
            {/* The day's name is the switch's own label, so it names the switch for a
                screen reader and is printed once. */}
            <Switch
              checked={day.is_working}
              onChange={(next) => patch(day.weekday, { is_working: next })}
              label={<span className="font-semibold">{day.label}</span>}
              busy={save.isPending}
            />

            {day.is_working ? (
              /* Each select is boxed in a fixed-width wrapper: the console's field shell is
                 full-width, so the box decides how wide it is and the two hours stay on one
                 line beside "to". */
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-28 shrink-0 tabular-nums">
                  <select
                    aria-label={`${day.label} — first hour`}
                    className={CONTROL}
                    value={String(day.start_hour)}
                    disabled={save.isPending}
                    onChange={(e) => patch(day.weekday, { start_hour: Number(e.target.value) })}
                  >
                    {startOptions.map((h) => (
                      <option key={h} value={String(h)}>{hourLabel(h)}</option>
                    ))}
                  </select>
                </div>
                <span className="text-[14px] text-ms-fg-3">to</span>
                <div className="w-28 shrink-0 tabular-nums">
                  <select
                    aria-label={`${day.label} — last hour`}
                    className={CONTROL}
                    value={String(day.end_hour)}
                    disabled={save.isPending}
                    onChange={(e) => patch(day.weekday, { end_hour: Number(e.target.value) })}
                  >
                    {endOptions
                      .filter((h) => h > day.start_hour)
                      .map((h) => (
                        <option key={h} value={String(h)}>{hourLabel(h)}</option>
                      ))}
                  </select>
                </div>
                {/* The end is exclusive, and an admin has no way to know that from two
                    dropdowns. Say what it means in sessions, which is the unit they think in. */}
                <span className="whitespace-nowrap text-[13px] tabular-nums text-ms-fg-3">
                  last session {hourLabel(day.end_hour - 1)}
                </span>
              </div>
            ) : (
              <span className="text-[14px] text-ms-fg-3">Not working</span>
            )}
          </div>
        ))}
      </div>

      {!draft.some((d) => d.is_working) ? (
        <Notice tone="attention">
          Every day is switched off. Saving this takes {teacherName} off the students&apos;
          booking calendar entirely.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={submit} state={save.isPending ? "busy" : "idle"} disabled={!dirty}>
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
