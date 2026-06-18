"use client";

import { useState } from "react";
import { Check, RefreshCw, KeyRound } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { Card, CardHeader, Button, Field, Select, TextField } from "../ui";
import { useUpdateClass, useRegenerateCode } from "../hooks";
import type { ClassroomWithRole } from "../types";

/** Edit core class details + join code. Owner/Teacher only (gated by the workspace). */
export function Settings({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const update = useUpdateClass(id);
  const regen = useRegenerateCode(id);
  const c = classroom as Record<string, unknown>;

  const [form, setForm] = useState({
    name: String(c.name ?? ""),
    description: String(c.description ?? ""),
    lesson_days: String(c.lesson_days ?? "ODD"),
    lesson_time: String(c.lesson_time ?? ""),
    room_number: String(c.room_number ?? ""),
    max_students: c.max_students != null ? String(c.max_students) : "",
    is_active: c.is_active !== false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const joinCode = String(c.join_code ?? "");

  async function save() {
    setErr(null);
    setSaved(false);
    if (!form.name.trim()) return setErr("Class name can't be empty.");
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        description: form.description.trim(),
        lesson_days: form.lesson_days,
        lesson_time: form.lesson_time.trim(),
        room_number: form.room_number.trim(),
        max_students: form.max_students.trim() === "" ? null : Number(form.max_students),
        is_active: form.is_active,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(normalizeApiError(e).message);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Class settings" description="Update the details students see for this class." />
        <div className="mt-5 max-w-lg space-y-4">
          {err && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">{err}</p>}
          <TextField label="Class name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Field label="Description" htmlFor="set-desc">
            <textarea
              id="set-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="What this class covers — shown to students."
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lesson days" htmlFor="set-days">
              <Select id="set-days" value={form.lesson_days} onChange={(e) => setForm({ ...form, lesson_days: e.target.value })}>
                <option value="ODD">Odd days</option>
                <option value="EVEN">Even days</option>
              </Select>
            </Field>
            <TextField label="Lesson time" value={form.lesson_time} onChange={(e) => setForm({ ...form, lesson_time: e.target.value })} placeholder="18:00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Room" value={form.room_number} onChange={(e) => setForm({ ...form, room_number: e.target.value })} placeholder="Optional" />
            <TextField
              label="Capacity"
              type="number"
              min={0}
              value={form.max_students}
              onChange={(e) => setForm({ ...form, max_students: e.target.value })}
              hint="Informational only — never blocks joining"
              placeholder="No limit"
            />
          </div>
          <label className="flex items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-[var(--ring)]"
            />
            Class is active (unchecking archives it — students can no longer join or see it)
          </label>
          <div className="flex items-center gap-3 pt-2">
            <Button loading={update.isPending} onClick={save}>Save changes</Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Join code" description="Students enter this code to join the class." />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2 font-mono text-lg font-bold tracking-widest text-foreground">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> {joinCode || "—"}
          </span>
          <Button variant="secondary" icon={RefreshCw} loading={regen.isPending} onClick={() => regen.mutate()}>
            Regenerate
          </Button>
          <span className="text-xs text-muted-foreground">Regenerating invalidates the old code immediately.</span>
        </div>
      </Card>
    </div>
  );
}
