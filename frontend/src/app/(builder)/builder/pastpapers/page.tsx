"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examsAdminApi } from "@/features/examsAdmin/api";
import type { AdminPastpaperSection, SectionPublishViolation } from "@/lib/api";
import {
  AlertTriangle,
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
  subject: "READING_WRITING" | "MATH";
  title: string;
  collection_name: string;
  practice_date: string;
  label: string;
  form_type: "INTERNATIONAL" | "US";
};

const EMPTY_FORM: FormState = {
  subject: "READING_WRITING",
  title: "",
  collection_name: "",
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

function collectionOf(s: AdminPastpaperSection): string {
  return (s.collection_name && s.collection_name.trim()) || "Ungrouped";
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

function parseViolations(e: unknown): SectionPublishViolation[] {
  const data = (e as { response?: { data?: { violations?: unknown } } })?.response?.data;
  const v = data?.violations;
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => {
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        return { code: String(r.code ?? ""), message: String(r.message ?? r.code ?? "") };
      }
      return { code: "", message: String(row) };
    })
    .filter((x) => x.message);
}

// ─── Section form modal ─────────────────────────────────────────────────────────

function SectionModal({
  open,
  title,
  initial,
  saving,
  error,
  isEdit,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initial: FormState;
  saving: boolean;
  error: string | null;
  isEdit: boolean;
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
              Subject
            </label>
            <select
              value={form.subject}
              onChange={set("subject")}
              disabled={isEdit}
              className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value="READING_WRITING">Reading &amp; Writing</option>
              <option value="MATH">Mathematics</option>
            </select>
            {isEdit ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Subject can&apos;t be changed after creation.</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Collection
            </label>
            <input
              value={form.collection_name}
              onChange={set("collection_name")}
              placeholder="e.g. SAT October 2024"
              className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sections sharing a collection name are grouped together for students.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest">
              Title
            </label>
            <input
              value={form.title}
              onChange={set("title")}
              placeholder="Optional — defaults to subject + date"
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

// ─── Section row ─────────────────────────────────────────────────────────────────

function SectionRow({
  section,
  onEdit,
  onDelete,
  onTogglePublish,
  busy,
  violations,
}: {
  section: AdminPastpaperSection;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
  busy: boolean;
  violations: SectionPublishViolation[] | null;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isRW = section.subject === "READING_WRITING";
  const isPublished = section.is_published === true;
  const modules = section.modules ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className={`rounded-md p-1 ${isRW ? "bg-primary/10 text-primary" : "bg-emerald-100 text-emerald-700"}`}>
              <SubjectIcon subject={section.subject} />
            </div>
            <h3 className="font-extrabold text-foreground">
              {section.title?.trim() || `${subjectLabel(section.subject)} · ${formatDate(section.practice_date)}`}
            </h3>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {section.form_type === "US" ? "US Form" : "International"}
              {section.label ? ` · Form ${section.label}` : ""}
            </span>
            <span
              className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                isPublished ? "bg-emerald-100 text-emerald-700" : "bg-surface-2 text-muted-foreground"
              }`}
            >
              {isPublished ? "Live" : "Draft"}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatDate(section.practice_date)}
            <span className="ml-2 text-muted-foreground/50">·</span>
            <span>{modules.length} module{modules.length !== 1 ? "s" : ""}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePublish}
            disabled={busy}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50 ${
              isPublished
                ? "border border-border bg-card text-foreground hover:bg-surface-2"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {busy ? "…" : isPublished ? "Unpublish" : "Publish"}
          </button>
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

      {/* Publish violations (blocking SAT rules) */}
      {violations && violations.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <strong>Can&apos;t publish yet — resolve these first:</strong>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {violations.map((v, i) => (
                <li key={`${v.code}-${i}`}>{v.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Per-module links */}
      <div className="mt-4">
        {modules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-2.5 text-xs text-muted-foreground italic">
            No modules yet — they appear here once this section has modules.
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {modules.map((mod) => (
              <Link
                key={mod.id}
                href={`/builder/pastpapers/${section.id}/${mod.id}`}
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
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPastpapersPage() {
  const [sections, setSections] = useState<AdminPastpaperSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPastpaperSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-section publish state
  const [publishBusy, setPublishBusy] = useState<number | null>(null);
  const [violationsFor, setViolationsFor] = useState<Record<number, SectionPublishViolation[]>>({});

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await examsAdminApi.getStandaloneSections();
      setSections(data);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Group sections by collection_name; newest practice_date first within a group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, AdminPastpaperSection[]>();
    for (const s of sections) {
      const key = collectionOf(s);
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(s);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        // Reading & Writing before Math, then by id.
        const rank = (x: AdminPastpaperSection) => (x.subject === "READING_WRITING" ? 0 : 1);
        const d = rank(a) - rank(b);
        return d !== 0 ? d : a.id - b.id;
      });
    }
    return order.map((name) => ({ name, items: map.get(name)! }));
  }, [sections]);

  const openCreate = () => {
    setEditing(null);
    setSaveError(null);
    setModalOpen(true);
  };

  const openEdit = (section: AdminPastpaperSection) => {
    setEditing(section);
    setSaveError(null);
    setModalOpen(true);
  };

  const handleSave = async (form: FormState) => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: form.title.trim() || undefined,
        collection_name: form.collection_name.trim() || undefined,
        practice_date: form.practice_date || null,
        label: form.label.trim() || undefined,
        form_type: form.form_type,
      };
      if (editing) {
        await examsAdminApi.updateSection(editing.id, payload);
      } else {
        await examsAdminApi.createSection({ subject: form.subject, ...payload });
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
      await examsAdminApi.deleteSection(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    }
  };

  const handleTogglePublish = async (section: AdminPastpaperSection) => {
    setPublishBusy(section.id);
    setViolationsFor((prev) => {
      const next = { ...prev };
      delete next[section.id];
      return next;
    });
    try {
      if (section.is_published) {
        await examsAdminApi.unpublishSection(section.id);
      } else {
        await examsAdminApi.publishSection(section.id);
      }
      await load();
    } catch (e) {
      const violations = parseViolations(e);
      if (violations.length > 0) {
        setViolationsFor((prev) => ({ ...prev, [section.id]: violations }));
      } else {
        setError(parseError(e));
      }
    } finally {
      setPublishBusy(null);
    }
  };

  const modalInitial: FormState = editing
    ? {
        subject: (editing.subject === "MATH" ? "MATH" : "READING_WRITING"),
        title: editing.title ?? "",
        collection_name: editing.collection_name ?? "",
        practice_date: editing.practice_date ?? "",
        label: editing.label ?? "",
        form_type: (editing.form_type as "INTERNATIONAL" | "US") ?? "INTERNATIONAL",
      }
    : EMPTY_FORM;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Pastpapers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage standalone pastpaper sections. Each section is a single Reading &amp; Writing or
            Mathematics test, published independently. Use a shared collection name to group sections
            from the same SAT form for students.
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
            New section
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
      ) : sections.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
            <FileText className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-extrabold text-foreground">No pastpaper sections yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a section, then add its modules and questions.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New section
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.name} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{g.name}</span>
                <span className="text-[11px] text-muted-foreground/60">
                  {g.items.length} section{g.items.length !== 1 ? "s" : ""}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                {g.items.map((section) => (
                  <SectionRow
                    key={section.id}
                    section={section}
                    onEdit={() => openEdit(section)}
                    onDelete={() => void handleDelete(section.id)}
                    onTogglePublish={() => void handleTogglePublish(section)}
                    busy={publishBusy === section.id}
                    violations={violationsFor[section.id] ?? null}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <SectionModal
        open={modalOpen}
        title={editing ? "Edit section" : "New pastpaper section"}
        initial={modalInitial}
        saving={saving}
        error={saveError}
        isEdit={!!editing}
        onSubmit={(f) => void handleSave(f)}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
