"use client";

import { useId } from "react";

import { Alert, Button, Field, Input, SegmentedControl } from "../consoleKit";
import { fromLocalInput, toLocalInput } from "@/lib/datetimeLocal";
import { isNightInTashkent, tashkentDateTime, tashkentHour, tashkentTime, todayInTashkent } from "../format";

export interface WhenValue {
  mode: "now" | "at";
  /** A `datetime-local` value; "" until a time is picked. */
  at: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The server lets a send time a minute old through: the time it took to click Confirm. */
const PAST_GRACE_MS = 60_000;

/** ISO for a draft's `scheduled_at`; null means now, or no time yet. */
export const whenIso = (value: WhenValue): string | null => (value.mode === "at" ? fromLocalInput(value.at) : null);

/** What stops this time being sent; null when it can be. */
export function whenProblem(value: WhenValue, now: Date = new Date()): string | null {
  if (value.mode === "now") return null;
  const iso = fromLocalInput(value.at);
  if (!iso) return "Pick when it goes out.";
  return new Date(iso).getTime() < now.getTime() - PAST_GRACE_MS ? "That time has passed — pick a later one." : null;
}

/** "Now", "Today 10:00", "Tomorrow 10:00" or "9 Nov, 15:30", in Tashkent. */
export function whenLabel(value: WhenValue, now: Date = new Date()): string {
  if (value.mode === "now") return "Now";
  const iso = fromLocalInput(value.at);
  if (!iso) return "Pick a time";
  const day = todayInTashkent(new Date(iso));
  if (day === todayInTashkent(now)) return `Today ${tashkentTime(iso)}`;
  if (day === todayInTashkent(new Date(now.getTime() + DAY_MS))) return `Tomorrow ${tashkentTime(iso)}`;
  return tashkentDateTime(iso);
}

/** Ten o'clock in Tashkent, which has one offset all year. */
const tenOn = (day: string): WhenValue => ({ mode: "at", at: toLocalInput(`${day}T10:00:00+05:00`) });

export function WhenStep({
  value,
  onChange,
  now = new Date(),
}: {
  value: WhenValue;
  onChange: (next: WhenValue) => void;
  now?: Date;
}) {
  const uid = useId();
  const iso = whenIso(value);
  const goesOut = value.mode === "now" ? now : iso ? new Date(iso) : null;
  const problem = whenProblem(value, now);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<WhenValue["mode"]>
          ariaLabel="When"
          size="sm"
          value={value.mode}
          onChange={(mode) => onChange({ ...value, mode })}
          options={[
            { value: "now", label: "Now" },
            { value: "at", label: "At a set time" },
          ]}
        />
        {tashkentHour(now) < 10 ? (
          <Button size="sm" variant="secondary" onClick={() => onChange(tenOn(todayInTashkent(now)))}>
            Today 10:00
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => onChange(tenOn(todayInTashkent(new Date(now.getTime() + DAY_MS))))}>
          Tomorrow 10:00
        </Button>
      </div>
      {value.mode === "at" ? (
        <Field label="Goes out at" htmlFor={`${uid}-at`} hint="Tashkent time.">
          <Input
            id={`${uid}-at`}
            type="datetime-local"
            inputSize="sm"
            min={toLocalInput(now.toISOString())}
            value={value.at}
            onChange={(e) => onChange({ ...value, at: e.target.value })}
          />
        </Field>
      ) : (
        <p className="text-[13px] text-ms-fg-3">It goes out as soon as it is confirmed.</p>
      )}
      {problem && value.at ? <Alert tone="danger">{problem}</Alert> : null}
      {goesOut && isNightInTashkent(goesOut) ? <Alert tone="warning">Students get this at night.</Alert> : null}
    </div>
  );
}
