"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { classesApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { levelsForSubject, levelLabel } from "@/lib/levels";
import { useBranches, useRegions } from "@/features/org/orgHooks";
import { Fieldset } from "@/features/ops/people/Fieldset";
import { serverReason, type ClassroomCore } from "./classroomsApi";

/**
 * A class's own fields (`PATCH /classes/<id>/details/`). While the class follows an lc-up group,
 * the fields lc-up writes every sync (`core.lcup.locked_fields`) are shown but not editable, and are
 * left out of the save — the server would refuse a change to them, and keep it for 15 minutes at
 * most if it did not. Description, Telegram and the size cap stay ours.
 */

const INPUT =
  "h-8 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted-foreground";

function Field({ id, label, locked, children }: { id: string; label: string; locked?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {locked ? <span>Set in lc-up</span> : null}
      </label>
      {children}
    </div>
  );
}

export function ClassroomForm({ room, onSaved }: { room: ClassroomCore; onSaved: () => void }) {
  const uid = useId();
  const { push } = useToast();
  const locked = new Set(room.lcup?.locked_fields ?? []);
  const regions = useRegions();
  const branches = useBranches();

  const [name, setName] = useState(room.name);
  const [level, setLevel] = useState(room.level);
  const [description, setDescription] = useState(room.description);
  const [days, setDays] = useState(room.lesson_days || "ODD");
  const [time, setTime] = useState(room.lesson_time);
  const [hours, setHours] = useState(room.lesson_hours == null ? "" : String(room.lesson_hours));
  const [startDate, setStartDate] = useState(room.start_date ?? "");
  const [roomNumber, setRoomNumber] = useState(room.room_number);
  const [regionPick, setRegionPick] = useState<string | null>(null);
  const [branchId, setBranchId] = useState(room.branch ? String(room.branch.id) : "");
  const [chatId, setChatId] = useState(room.telegram_chat_id);
  const [groupUrl, setGroupUrl] = useState(room.telegram_group_url);
  const [maxStudents, setMaxStudents] = useState(room.max_students == null ? "" : String(room.max_students));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The class stores only its branch; the region select starts on that branch's region.
  const regionId =
    regionPick ?? String((branches.data ?? []).find((b) => String(b.id) === branchId)?.region ?? "");
  const branchOptions = useMemo(
    () =>
      (branches.data ?? []).filter(
        // The branch the class is at stays listed even once closed, or the select would look emptied.
        (b) => String(b.region) === regionId && (b.is_active || String(b.id) === branchId),
      ),
    [branches.data, regionId, branchId],
  );
  const levels = levelsForSubject(room.subject as never) as string[];

  const id = (field: string) => `${uid}-${field}`;
  const off = (field: string) => locked.has(field);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!off("name") && !name.trim()) return setError("Give the classroom a name.");
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        level,
        description: description.trim(),
        lesson_days: days,
        lesson_time: time.trim(),
        start_date: startDate || null,
        room_number: roomNumber.trim(),
        // `null` clears the branch; leaving it out would keep the old one.
        branch: branchId ? Number(branchId) : null,
        telegram_chat_id: chatId.trim(),
        telegram_group_url: groupUrl.trim(),
        max_students: maxStudents.trim() ? Number(maxStudents) : null,
      };
      if (hours.trim()) payload.lesson_hours = Number(hours);
      for (const field of locked) delete payload[field];
      await classesApi.governanceUpdate(room.id, payload as Parameters<typeof classesApi.governanceUpdate>[1]);
      push({ tone: "success", message: "Saved." });
      onSaved();
    } catch (err: unknown) {
      setError(serverReason(err, "Could not save the classroom."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Fieldset title="Details">
      <form onSubmit={(e) => void save(e)} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id={id("name")} label="Name" locked={off("name")}>
              <input id={id("name")} value={name} disabled={off("name")} onChange={(e) => setName(e.target.value)} className={INPUT} />
            </Field>
          </div>
          <Field id={id("level")} label="Level" locked={off("level")}>
            <select id={id("level")} value={level} disabled={off("level")} onChange={(e) => setLevel(e.target.value)} className={INPUT}>
              <option value="">— No level —</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {levelLabel(l as never)}
                </option>
              ))}
              {level && !levels.includes(level) ? <option value={level}>{level}</option> : null}
            </select>
          </Field>
          <Field id={id("days")} label="Lesson days" locked={off("lesson_days")}>
            <select id={id("days")} value={days} disabled={off("lesson_days")} onChange={(e) => setDays(e.target.value)} className={INPUT}>
              <option value="ODD">Odd days</option>
              <option value="EVEN">Even days</option>
            </select>
          </Field>
          <Field id={id("time")} label="Lesson time" locked={off("lesson_time")}>
            <input id={id("time")} value={time} disabled={off("lesson_time")} onChange={(e) => setTime(e.target.value)} placeholder="18:00" className={INPUT} />
          </Field>
          <Field id={id("hours")} label="Lesson hours" locked={off("lesson_hours")}>
            <input
              id={id("hours")}
              type="number"
              min={1}
              value={hours}
              disabled={off("lesson_hours")}
              onChange={(e) => setHours(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field id={id("start")} label="Start date" locked={off("start_date")}>
            <input
              id={id("start")}
              type="date"
              value={startDate}
              disabled={off("start_date")}
              onChange={(e) => setStartDate(e.target.value)}
              className={INPUT}
            />
          </Field>
          <Field id={id("room")} label="Room" locked={off("room_number")}>
            <input id={id("room")} value={roomNumber} disabled={off("room_number")} onChange={(e) => setRoomNumber(e.target.value)} className={INPUT} />
          </Field>
          <Field id={id("region")} label="Region" locked={off("branch")}>
            <select
              id={id("region")}
              value={regionId}
              disabled={off("branch")}
              onChange={(e) => {
                setRegionPick(e.target.value);
                setBranchId("");
              }}
              className={INPUT}
            >
              <option value="">— Choose region —</option>
              {(regions.data ?? []).map((r) => (
                <option key={r.id} value={String(r.id)}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id("branch")} label="Branch" locked={off("branch")}>
            <select
              id={id("branch")}
              value={branchId}
              disabled={off("branch") || !regionId}
              onChange={(e) => setBranchId(e.target.value)}
              className={INPUT}
            >
              <option value="">— No branch —</option>
              {branchOptions.map((b) => (
                <option key={b.id} value={String(b.id)}>
                  {b.name}
                  {b.is_active ? "" : " (closed)"}
                </option>
              ))}
              {/* Until the branch list loads, keep the class's own branch selectable by name. */}
              {room.branch && !branchOptions.some((b) => String(b.id) === String(room.branch!.id)) ? (
                <option value={String(room.branch.id)}>{room.branch.name}</option>
              ) : null}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field id={id("description")} label="Description">
              <textarea
                id={id("description")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={`${INPUT} h-auto py-1.5`}
              />
            </Field>
          </div>
          <Field id={id("chat")} label="Telegram chat id">
            <input id={id("chat")} value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="-1001234567890" className={INPUT} />
          </Field>
          <Field id={id("url")} label="Telegram link">
            <input id={id("url")} value={groupUrl} onChange={(e) => setGroupUrl(e.target.value)} placeholder="https://t.me/…" className={INPUT} />
          </Field>
          <Field id={id("max")} label="Max students">
            <input
              id={id("max")}
              type="number"
              min={1}
              value={maxStudents}
              onChange={(e) => setMaxStudents(e.target.value)}
              placeholder="No limit"
              className={INPUT}
            />
          </Field>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          {error ? (
            <p role="alert" className="text-foreground">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="h-8 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Fieldset>
  );
}
