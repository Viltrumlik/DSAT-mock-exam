"use client";

import { useCallback, useEffect, useState } from "react";
import { examsAdminApi } from "@/lib/api";
import {
  AlertOctagon,
  CalendarClock,
  CheckCircle2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExamDate = {
  id: number;
  exam_date: string;
  label: string;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeList(data: unknown): ExamDate[] {
  if (Array.isArray(data)) return data as ExamDate[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
    return (data as { results: ExamDate[] }).results;
  }
  return [];
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function errMessage(e: unknown, fallback: string): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const first = Object.values(data as Record<string, unknown>)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === "string") return first;
  }
  return (e as { message?: string })?.message ?? fallback;
}

// ─── Add / edit form ────────────────────────────────────────────────────────

type FormState = { exam_date: string; label: string; is_active: boolean; sort_order: string };
const EMPTY_FORM: FormState = { exam_date: "", label: "", is_active: true, sort_order: "0" };

function ExamDateForm({
  initial,
  editing,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: FormState;
  editing: boolean;
  busy: boolean;
  onSubmit: (f: FormState) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);

  useEffect(() => setForm(initial), [initial]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-end gap-3"
    >
      <div className="min-w-[170px]">
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
          Exam date
        </label>
        <input
          type="date"
          required
          value={form.exam_date}
          onChange={(e) => setForm((f) => ({ ...f, exam_date: e.target.value }))}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="flex-1 min-w-[180px]">
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
          Label (optional)
        </label>
        <input
          type="text"
          placeholder="e.g. August SAT"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <div className="w-[100px]">
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
          Sort
        </label>
        <input
          type="number"
          min={0}
          value={form.sort_order}
          onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm font-bold text-foreground select-none">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          className="h-4 w-4 rounded border-border"
        />
        Active
      </label>
      <button
        type="submit"
        disabled={busy || !form.exam_date}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition"
      >
        {editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {editing ? "Save changes" : "Add date"}
      </button>
      {editing && onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      )}
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExamDatesPage() {
  const [rows, setRows] = useState<ExamDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | "new" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await examsAdminApi.listExamDatesAdmin();
      setRows(normalizeList(data));
    } catch (e) {
      setError(errMessage(e, "Failed to load exam dates."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(
    async (f: FormState) => {
      setBusyId("new");
      setError(null);
      try {
        await examsAdminApi.createExamDate({
          exam_date: f.exam_date,
          label: f.label.trim(),
          is_active: f.is_active,
          sort_order: Number(f.sort_order) || 0,
        });
        await load();
      } catch (e) {
        setError(errMessage(e, "Failed to add exam date."));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const handleUpdate = useCallback(
    async (id: number, f: FormState) => {
      setBusyId(id);
      setError(null);
      try {
        await examsAdminApi.updateExamDate(id, {
          exam_date: f.exam_date,
          label: f.label.trim(),
          is_active: f.is_active,
          sort_order: Number(f.sort_order) || 0,
        });
        setEditingId(null);
        await load();
      } catch (e) {
        setError(errMessage(e, "Failed to update exam date."));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const toggleActive = useCallback(
    async (row: ExamDate) => {
      setBusyId(row.id);
      setError(null);
      try {
        await examsAdminApi.updateExamDate(row.id, { is_active: !row.is_active });
        await load();
      } catch (e) {
        setError(errMessage(e, "Failed to update exam date."));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (row: ExamDate) => {
      if (!window.confirm(`Delete the exam date ${formatDate(row.exam_date)}? Students who chose it will lose it.`)) {
        return;
      }
      setBusyId(row.id);
      setError(null);
      try {
        await examsAdminApi.deleteExamDate(row.id);
        await load();
      } catch (e) {
        setError(errMessage(e, "Failed to delete exam date."));
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5">
            Admin console · Exam dates
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">SAT exam dates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dates added here power the student dashboard countdown and the exam-date picker in
            student profiles. Only <span className="font-semibold text-foreground">active</span>{" "}
            dates are offered to students.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Add form */}
      <ExamDateForm
        initial={EMPTY_FORM}
        editing={false}
        busy={busyId === "new"}
        onSubmit={handleCreate}
      />

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700 flex items-start gap-2">
          <AlertOctagon className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 border-b border-border px-5 py-2.5 bg-surface-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Date</p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Label</p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Status</p>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest text-right">Actions</p>
        </div>

        {loading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-5 py-3.5 animate-pulse">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-4 w-16 rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold text-foreground">No exam dates yet</p>
            <p className="text-sm text-muted-foreground mt-1">Add your first SAT date above.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) =>
              editingId === row.id ? (
                <div key={row.id} className="px-3 py-3">
                  <ExamDateForm
                    initial={{
                      exam_date: row.exam_date,
                      label: row.label ?? "",
                      is_active: row.is_active,
                      sort_order: String(row.sort_order ?? 0),
                    }}
                    editing
                    busy={busyId === row.id}
                    onSubmit={(f) => void handleUpdate(row.id, f)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : (
                <div
                  key={row.id}
                  className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-3 px-5 py-3.5"
                >
                  <div className="font-semibold text-foreground">{formatDate(row.exam_date)}</div>
                  <div className="text-sm text-muted-foreground truncate">{row.label || "—"}</div>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void toggleActive(row)}
                    title="Toggle active"
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold transition disabled:opacity-50",
                      row.is_active
                        ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                        : "bg-surface-2 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {row.is_active ? "Active" : "Inactive"}
                  </button>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => setEditingId(row.id)}
                      title="Edit"
                      className="inline-flex items-center justify-center rounded-lg border border-border bg-card p-1.5 text-foreground hover:bg-surface-2 disabled:opacity-50 transition"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void handleDelete(row)}
                      title="Delete"
                      className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 disabled:opacity-50 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          {rows.length} date{rows.length !== 1 ? "s" : ""} · {rows.filter((r) => r.is_active).length} active
        </div>
      )}
    </div>
  );
}
