"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { examsAdminApi } from "@/features/examsAdmin/api";
import type { AdminPastpaperPack } from "@/lib/api";
import {
  BookOpen,
  Calculator,
  Calendar,
  ChevronRight,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FormState = {
  title: string;
  practice_date: string;
  label: string;
  form_type: "INTERNATIONAL" | "US";
};

const EMPTY_FORM: FormState = {
  title: "",
  practice_date: "",
  label: "",
  form_type: "INTERNATIONAL",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch {
    return s;
  }
}

function subjectLabel(subject: string): string {
  if (subject === "READING_WRITING") return "Reading & Writing";
  if (subject === "MATH") return "Mathematics";
  return subject;
}

function SubjectIcon({ subject }: { subject: string }) {
  if (subject === "MATH") return <Calculator className="h-3.5 w-3.5" />;
  return <BookOpen className="h-3.5 w-3.5" />;
}

function parseError(e: unknown): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (!data) return "An error occurred.";
  if (typeof data === "string") return data;
  if (typeof data === "object" && data !== null) {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    const parts = Object.entries(d)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : String(v)}`)
      .join(" ");
    return parts || "An error occurred.";
  }
  return "An error occurred.";
}

// ─── Pack form modal ──────────────────────────────────────────────────────────

function PackModal({
  open,
  title,
  initial,
  saving,
  error,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: FormState;
  saving: boolean;
  error: string | null;
  onSubmit: (f: FormState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  if (!open) return null;

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-surface-2">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          <div>
            <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Title
            </label>
            <input
              value={form.title}
              onChange={set("title")}
              placeholder="e.g. SAT October 2024"
              className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Practice date
              </label>
              <input
                type="date"
                value={form.practice_date}
                onChange={set("practice_date")}
                className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Form label
              </label>
              <input
                value={form.label}
                onChange={set("label")}
                placeholder="A, B, …"
                className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Form type
            </label>
            <select
              value={form.form_type}
              onChange={set("form_type")}
              className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="INTERNATIONAL">International</option>
              <option value="US">US Form</option>
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pack row ──────────────────────────────────────────────────────────────────

function PackRow({
  pack,
  onEdit,
  onDelete,
  onAddSection,
  addingSection,
}: {
  pack: AdminPastpaperPack;
  onEdit: () => void;
  onDelete: () => void;
  onAddSection: (subject: "READING_WRITING" | "MATH") => void;
  addingSection: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rwSection = pack.sections.find((s) => s.subject === "READING_WRITING");
  const mathSection = pack.sections.find((s) => s.subject === "MATH");
  const hasRW = !!rwSection;
  const hasMath = !!mathSection;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      {/* Pack header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-extrabold text-foreground">
              {pack.title || `Pack #${pack.id}`}
            </h3>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {pack.form_type === "US" ? "US Form" : "International"}
              {pack.label ? ` · Form ${pack.label}` : ""}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatDate(pack.practice_date)}
            <span className="ml-2 text-muted-foreground/50">·</span>
            <span>{pack.sections.length} section{pack.sections.length !== 1 ? "s" : ""}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2 transition-colors flex items-center gap-1.5"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onDelete}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 transition-colors"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="h-3 w-3" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Sections + per-module links */}
      {pack.sections.length > 0 && (
        <div className="mt-4 space-y-2">
          {pack.sections.map((section) => {
            const isRW = section.subject === "READING_WRITING";
            const modules = section.modules ?? [];
            return (
              <div key={section.id}>
                {/* Section header row */}
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <div className={`rounded-md p-1 ${isRW ? "bg-primary/10 text-primary" : "bg-emerald-100 text-emerald-700"}`}>
                    <SubjectIcon subject={section.subject} />
                  </div>
                  <span className="text-xs font-bold text-foreground">{subjectLabel(section.subject)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {modules.length} module{modules.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Per-module links */}
                {modules.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground italic">
                    No modules yet — add questions from the test admin.
                  </p>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {modules.map((mod) => (
                      <Link
                        key={mod.id}
                        href={`/builder/pastpapers/${pack.id}/${section.id}/${mod.id}`}
                        className={`group flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:border-primary/30 hover:bg-primary/5 ${
                          isRW ? "border-primary/20 bg-primary/5" : "border-emerald-200 bg-emerald-50/50"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-extrabold text-foreground">
                            {mod.module_order != null ? `Module ${mod.module_order}` : `Module #${mod.id}`}
                          </p>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add section buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        {!hasRW && (
          <button
            type="button"
            onClick={() => onAddSection("READING_WRITING")}
            disabled={addingSection}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:border-primary/70 hover:bg-primary/5 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add Reading &amp; Writing
          </button>
        )}
        {!hasMath && (
          <button
            type="button"
            onClick={() => onAddSection("MATH")}
            disabled={addingSection}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-emerald-400/50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add Mathematics
          </button>
        )}
        {hasRW && hasMath && (
          <p className="text-xs text-muted-foreground italic">All sections added.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPastpapersPage() {
  const [packs, setPacks] = useState<AdminPastpaperPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<AdminPastpaperPack | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-pack section-adding state
  const [addingSectionFor, setAddingSectionFor] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await examsAdminApi.getPastpaperPacks();
      setPacks(data.items);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openCreate = () => {
    setEditingPack(null);
    setSaveError(null);
    setModalOpen(true);
  };

  const openEdit = (pack: AdminPastpaperPack) => {
    setEditingPack(pack);
    setSaveError(null);
    setModalOpen(true);
  };

  const handleSave = async (form: FormState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: form.title.trim() || undefined,
        practice_date: form.practice_date || null,
        label: form.label.trim() || undefined,
        form_type: form.form_type,
      };
      if (editingPack) {
        await examsAdminApi.updatePastpaperPack(editingPack.id, payload);
      } else {
        await examsAdminApi.createPastpaperPack(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setSaveError(parseError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await examsAdminApi.deletePastpaperPack(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    }
  };

  const handleAddSection = async (packId: number, subject: "READING_WRITING" | "MATH") => {
    setAddingSectionFor(packId);
    try {
      await examsAdminApi.addPastpaperPackSection(packId, subject);
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setAddingSectionFor(null);
    }
  };

  const modalInitial: FormState = editingPack
    ? {
        title: editingPack.title ?? "",
        practice_date: editingPack.practice_date ?? "",
        label: editingPack.label ?? "",
        form_type: (editingPack.form_type as "INTERNATIONAL" | "US") ?? "INTERNATIONAL",
      }
    : EMPTY_FORM;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Pastpapers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage pastpaper packs. Each pack groups a Reading &amp; Writing section and a
            Mathematics section from one SAT form. Students see packs on the Pastpapers page.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New pack
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : packs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
            <FileText className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-extrabold text-foreground">No pastpaper packs yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a pack, then add Reading &amp; Writing and Mathematics sections.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New pack
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {packs.map((pack) => (
            <PackRow
              key={pack.id}
              pack={pack}
              onEdit={() => openEdit(pack)}
              onDelete={() => void handleDelete(pack.id)}
              onAddSection={(subject) => void handleAddSection(pack.id, subject)}
              addingSection={addingSectionFor === pack.id}
            />
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <PackModal
        open={modalOpen}
        title={editingPack ? "Edit pack" : "New pastpaper pack"}
        initial={modalInitial}
        saving={saving}
        error={saveError}
        onSubmit={(f) => void handleSave(f)}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
