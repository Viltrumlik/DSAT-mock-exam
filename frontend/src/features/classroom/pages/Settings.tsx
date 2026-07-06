"use client";

import { useState } from "react";
import { Check, RefreshCw, KeyRound } from "lucide-react";
import { normalizeApiError } from "@/lib/apiError";
import { pushGlobalToast } from "@/lib/toastBus";
import { Card, CardHeader, Button, Field, Select, TextField, ConfirmDialog } from "../ui";
import { useUpdateClass, useRegenerateCode } from "../hooks";
import type { ClassroomWithRole } from "../types";
import { levelsForSubject, levelLabel } from "@/lib/levels";

/** Edit core class details + join code. Owner/Teacher only (gated by the workspace). */
export function Settings({ classroom }: { classroom: ClassroomWithRole }) {
  const id = Number(classroom.id);
  const update = useUpdateClass(id);
  const regen = useRegenerateCode(id);
  const c = classroom as Record<string, unknown>;

  const subject = String(c.subject ?? "");
  const levelOptions = levelsForSubject(subject);

  const [form, setForm] = useState({
    name: String(c.name ?? ""),
    description: String(c.description ?? ""),
    level: String(c.level ?? ""),
    lesson_days: String(c.lesson_days ?? "ODD"),
    lesson_time: String(c.lesson_time ?? ""),
    room_number: String(c.room_number ?? ""),
    max_students: c.max_students != null ? String(c.max_students) : "",
    is_active: c.is_active !== false,
  });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const joinCode = String(c.join_code ?? "");
  const wasActive = c.is_active !== false;

  async function persist() {
    setErr(null);
    setSaved(false);
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        description: form.description.trim(),
        level: form.level,
        lesson_days: form.lesson_days,
        lesson_time: form.lesson_time.trim(),
        room_number: form.room_number.trim(),
        max_students: form.max_students.trim() === "" ? null : Number(form.max_students),
        is_active: form.is_active,
      });
      setConfirmArchive(false);
      setSaved(true);
      pushGlobalToast({ tone: "success", message: "Class settings saved." });
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      const msg = normalizeApiError(e).message;
      setErr(msg);
      setConfirmArchive(false);
      pushGlobalToast({ tone: "error", message: msg });
    }
  }

  function save() {
    setErr(null);
    if (!form.name.trim()) return setErr("Class name can't be empty.");
    // Archiving (active → inactive) is significant — confirm before persisting.
    if (wasActive && !form.is_active) {
      setConfirmArchive(true);
      return;
    }
    void persist();
  }

  async function regenerate() {
    try {
      await regen.mutateAsync();
      setConfirmRegen(false);
      pushGlobalToast({ tone: "success", message: "New join code generated." });
    } catch (e) {
      pushGlobalToast({ tone: "error", message: normalizeApiError(e).message });
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
            <Field label="Level" htmlFor="set-level" hint="Controls which assessments this class can be assigned.">
              <Select id="set-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}>
                <option value="">— No level —</option>
                {levelOptions.map((l) => (
                  <option key={l} value={l}>{levelLabel(l)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Lesson days" htmlFor="set-days">
              <Select id="set-days" value={form.lesson_days} onChange={(e) => setForm({ ...form, lesson_days: e.target.value })}>
                <option value="ODD">Odd days</option>
                <option value="EVEN">Even days</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Lesson time" value={form.lesson_time} onChange={(e) => setForm({ ...form, lesson_time: e.target.value })} placeholder="18:00" />
            <div />
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
          <Button variant="secondary" icon={RefreshCw} loading={regen.isPending} onClick={() => setConfirmRegen(true)}>
            Regenerate
          </Button>
          <span className="text-xs text-muted-foreground">Regenerating invalidates the old code immediately.</span>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmArchive}
        title="Archive this class?"
        description="Students will no longer be able to join or see this class. You can reactivate it later from these settings."
        confirmLabel="Archive class"
        tone="danger"
        loading={update.isPending}
        onConfirm={() => void persist()}
        onCancel={() => setConfirmArchive(false)}
      />
      <ConfirmDialog
        open={confirmRegen}
        title="Regenerate join code?"
        description="The current code stops working immediately. Anyone with the old code won't be able to join until you share the new one."
        confirmLabel="Regenerate"
        tone="danger"
        loading={regen.isPending}
        onConfirm={regenerate}
        onCancel={() => setConfirmRegen(false)}
      />
    </div>
  );
}
