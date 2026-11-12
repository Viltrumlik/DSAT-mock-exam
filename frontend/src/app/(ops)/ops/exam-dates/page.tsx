"use client";

import { useCallback, useEffect, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Button, ConfirmDialog, EmptyState } from "@/features/console/ui";
import { OpsPageHeader } from "@/features/ops/OpsPageHeader";
import { CheckRow, SkeletonRows } from "@/features/ops/settings/settingsParts";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { examsAdminApi } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * /ops/exam-dates — the SAT dates students count down to and pick in their profile.
 *
 * In the console's look (design handoff v0.3): the console header, the form as a card, a row per
 * date, the console's confirm dialog for a delete. The words, the date handling and the calls are
 * the page's own.
 */

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

/** The list's four columns, shared by its header and every row so they line up. */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-center gap-3";

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
  const idBase = editing ? "exam-date-edit" : "exam-date-new";

  useEffect(() => setForm(initial), [initial]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      data-form={editing ? "edit" : "new"}
      className={cn(
        "flex flex-wrap items-end gap-3 rounded-ms-card p-4 sm:p-5",
        editing ? "bg-ms-surface" : "animate-ms-card-in bg-ms-card shadow-ms-1",
      )}
    >
      <div className="min-w-[170px] flex-1 sm:flex-none">
        <label htmlFor={`${idBase}-date`} className={FIELD_LABEL}>
          Exam date
        </label>
        <input
          id={`${idBase}-date`}
          type="date"
          required
          value={form.exam_date}
          onChange={(e) => setForm((f) => ({ ...f, exam_date: e.target.value }))}
          className={cn(CONTROL, "tabular-nums")}
        />
      </div>
      <div className="min-w-[180px] flex-1">
        <label htmlFor={`${idBase}-label`} className={FIELD_LABEL}>
          Label (optional)
        </label>
        <input
          id={`${idBase}-label`}
          type="text"
          placeholder="e.g. August SAT"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          className={CONTROL}
        />
      </div>
      <div className="w-[100px]">
        <label htmlFor={`${idBase}-sort`} className={FIELD_LABEL}>
          Sort
        </label>
        <input
          id={`${idBase}-sort`}
          type="number"
          min={0}
          value={form.sort_order}
          onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
          className={cn(CONTROL, "tabular-nums")}
        />
      </div>
      <CheckRow
        id={`${idBase}-active`}
        className="h-(--ms-h-ctl)"
        checked={form.is_active}
        onChange={(checked) => setForm((f) => ({ ...f, is_active: checked }))}
      >
        Active
      </CheckRow>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          icon={editing ? "pencil" : "plus"}
          state={busy ? "busy" : "idle"}
          disabled={busy || !form.exam_date}
        >
          {editing ? "Save changes" : "Add date"}
        </Button>
        {editing && onCancel && (
          <Button variant="ghost" icon="x" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
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
  // The date being deleted outlives the dialog, so its words stay while the dialog leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExamDate | null>(null);

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

  /** The confirm dialog's action: a refusal is thrown, so the dialog says it and stays open. */
  const runDelete = async () => {
    const row = pendingDelete;
    if (!row) return;
    setBusyId(row.id);
    setError(null);
    try {
      await examsAdminApi.deleteExamDate(row.id);
    } catch (e) {
      throw new Error(errMessage(e, "Failed to delete exam date."));
    } finally {
      setBusyId(null);
    }
    await load();
  };

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="flex flex-col gap-5">
      <OpsPageHeader
        section="Exam dates"
        title="SAT exam dates"
        description={
          <>
            Dates added here power the student dashboard countdown and the exam-date picker in
            student profiles. Only <span className="font-semibold text-ms-fg">active</span>{" "}
            dates are offered to students.
          </>
        }
        actions={
          <Button variant="secondary" icon="refresh" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {/* Add form */}
      <ExamDateForm initial={EMPTY_FORM} editing={false} busy={busyId === "new"} onSubmit={handleCreate} />

      {/* Error */}
      {error ? <LibraryError>{error}</LibraryError> : null}

      {/* List */}
      <section aria-label="Exam dates" className="animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
        <div className={cn(COLUMNS, "border-b border-ms-border px-5 py-2.5 text-[13px] font-medium text-ms-fg-3")}>
          <p>Date</p>
          <p>Label</p>
          <p>Status</p>
          <p className="text-right">Actions</p>
        </div>

        {loading ? (
          <SkeletonRows count={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon="ms-examdate" title="No exam dates yet" detail="Add your first SAT date above." />
        ) : (
          <div className="divide-y divide-ms-line">
            {rows.map((row) =>
              editingId === row.id ? (
                <div key={row.id} data-row={row.id} className="p-2 sm:p-3">
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
                <div key={row.id} data-row={row.id} className={cn(COLUMNS, "ms-transition px-5 py-3 hover:bg-ms-surface")}>
                  <div className="min-w-0 text-[15px] font-semibold tabular-nums text-ms-fg">{formatDate(row.exam_date)}</div>
                  <div className="min-w-0 truncate text-[14px] text-ms-fg-2">{row.label || "—"}</div>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void toggleActive(row)}
                    title="Toggle active"
                    className={cn(
                      "ms-transition ms-press inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-[13px] font-semibold leading-none disabled:cursor-not-allowed disabled:opacity-50",
                      row.is_active
                        ? "bg-ms-positive-soft text-ms-positive-fg hover:shadow-[inset_0_0_0_1px_var(--ms-positive-line)]"
                        : "bg-ms-neutral-soft text-ms-neutral-fg hover:shadow-[inset_0_0_0_1px_var(--ms-border-strong)]",
                    )}
                  >
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />
                    {row.is_active ? "Active" : "Inactive"}
                  </button>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="pencil"
                      aria-label="Edit"
                      disabled={busyId === row.id}
                      onClick={() => setEditingId(row.id)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      aria-label="Delete"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setPendingDelete(row);
                        setDeleteOpen(true);
                      }}
                    />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {!loading && rows.length > 0 && (
        <p className="flex items-center gap-2 text-[14px] text-ms-fg-2">
          <Icon name="ok" size="sm" className="text-ms-positive-fg" />
          {rows.length} date{rows.length !== 1 ? "s" : ""} · {activeCount} active
        </p>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title={pendingDelete ? `Delete the exam date ${formatDate(pendingDelete.exam_date)}?` : ""}
        confirmLabel="Delete"
        onConfirm={runDelete}
      >
        Students who chose it will lose it.
      </ConfirmDialog>
    </div>
  );
}
