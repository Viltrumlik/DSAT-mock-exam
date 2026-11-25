"use client";

import { useState } from "react";

import { buttonClass } from "@/features/console/ui";
import { formatApiErrorForToast } from "@/lib/apiError";
import { cn } from "@/lib/cn";

import { dayText } from "./format";
import { useFillRegister, useToolboxGroups } from "./toolboxHooks";
import { CARD, CONTROL, DoneLine, ErrorLine, LABEL } from "./ui";

type Mode = "present" | "some_absent" | "none";

const MODES: { id: Mode; label: string }[] = [
  { id: "present", label: "Everyone present" },
  { id: "some_absent", label: "1–2 absent at random" },
  { id: "none", label: "Nothing marked" },
];

/** Today on the copy: its pages' clock is moved to the test date. */
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });
}

/** A group's register on a day, filled as a teacher would (the attendance window is not asked). */
export function RegisterPanel() {
  const groups = useToolboxGroups();
  const fill = useFillRegister();
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [mode, setMode] = useState<Mode>("present");

  return (
    <section className={cn(CARD, "flex max-w-2xl flex-col gap-3 p-4")} aria-labelledby="tb-register">
      <h2 id="tb-register" className="text-[15px] font-semibold text-ms-fg">Fill a register</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className={cn(LABEL, "min-w-56 flex-1")}>
          Group
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={CONTROL}>
            <option value="">Choose a group</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          Day
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(CONTROL, "w-44")} />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-4 text-[14px] text-ms-fg">
        <legend className="mb-1 text-[13px] text-ms-fg-2">Marks</legend>
        {MODES.map((m) => (
          <label key={m.id} className="flex items-center gap-2">
            <input type="radio" name="tb-register-mode" checked={mode === m.id} onChange={() => setMode(m.id)} /> {m.label}
          </label>
        ))}
      </fieldset>
      <div>
        <button
          type="button"
          disabled={!groupId || !date || fill.isPending}
          onClick={() => fill.mutate({ classroom_id: Number(groupId), date, mode })}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          Fill the register
        </button>
      </div>
      {fill.error ? <ErrorLine>{formatApiErrorForToast(fill.error)}</ErrorLine> : null}
      {fill.data ? (
        <DoneLine>
          {dayText(fill.data.date)}: {fill.data.students} on the register, {fill.data.present} present, {fill.data.absent} absent
          {fill.data.opened ? " (the register was opened now)" : ""}.
        </DoneLine>
      ) : null}
    </section>
  );
}
