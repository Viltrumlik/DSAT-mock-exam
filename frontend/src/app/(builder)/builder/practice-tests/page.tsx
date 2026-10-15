"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examsAdminApi } from "@/features/examsAdmin/api";
import { levelLabel } from "@/features/pastpapers/pastpaperLabels";
import type { AdminPastpaperSection, SectionPublishViolation } from "@/lib/api";
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  ChevronRight,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";

/**
 * The practice-test library: the centre's own single-section tests. Same look as the past-paper
 * builder (card, filter and modal classes), and each module links into the SAME question editor
 * (`/builder/practice-tests/<id>/<module>` re-exports the past-paper one). What differs is the card:
 * a permanent number given at first publish, a subtitle, a level, and who sees it.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type Access = "open" | "homework_only";

type FormState = {
  subject: "READING_WRITING" | "MATH";
  title: string;
  practice_access: Access;
  /** "" = all levels. */
  practice_level: string;
};

/** A new test starts Homework only, like the server's default: nothing reaches the library by accident. */
const EMPTY_FORM: FormState = {
  subject: "READING_WRITING",
  title: "",
  practice_access: "homework_only",
  practice_level: "",
};

const LEVEL_CODES = ["", "foundation", "junior", "middle", "senior"] as const;

type SubjectFilter = "ALL" | "READING_WRITING" | "MATH";
type StatusFilter = "ALL" | "published" | "draft";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SubjectIcon({ subject }: { subject: string }) {
  if (subject === "MATH") return <Calculator className="h-3.5 w-3.5" />;
  return <BookOpen className="h-3.5 w-3.5" />;
}

/**
 * Drafts (no number yet) first, then the highest number, then Reading & Writing before Math.
 * A number is per subject, so "Practice Test 3" can be one of each.
 */
function librarySort(a: AdminPastpaperSection, b: AdminPastpaperSection): number {
  const an = a.practice_number ?? null;
  const bn = b.practice_number ?? null;
  if ((an === null) !== (bn === null)) return an === null ? -1 : 1;
  if (an !== null && bn !== null && an !== bn) return bn - an;
  const rank = (x: AdminPastpaperSection) => (x.subject === "READING_WRITING" ? 0 : 1);
  const d = rank(a) - rank(b);
  return d !== 0 ? d : a.id - b.id;
}

/** Student-style segmented filter: an uppercase label + a pill row. */
function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5" data-filter={label.toLowerCase()}>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.l}
            </button>
          );
        })}
      </div>
    </div>
  );
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

const LABEL_CLASS = "mb-1 block text-xs font-bold text-muted-foreground uppercase tracking-widest";
const FIELD_CLASS =
  "w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

/** One option of a radio group: a bordered row that lights up when chosen. */
function RadioRow({
  name,
  value,
  checked,
  disabled,
  onChange,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-sm text-foreground transition-colors ${
        checked ? "border-primary/40 bg-primary/5" : "border-border bg-surface-2/60 hover:bg-surface-2"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 accent-[var(--color-primary,#2a68c0)]"
      />
      <span>{children}</span>
    </label>
  );
}

// ─── Practice-test form modal ─────────────────────────────────────────────────

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 hover:bg-surface-2">
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
            <span className={LABEL_CLASS}>Subject</span>
            <div className="grid grid-cols-2 gap-2">
              <RadioRow
                name="subject"
                value="READING_WRITING"
                checked={form.subject === "READING_WRITING"}
                disabled={isEdit}
                onChange={() => setForm((p) => ({ ...p, subject: "READING_WRITING" }))}
              >
                Reading &amp; Writing
              </RadioRow>
              <RadioRow
                name="subject"
                value="MATH"
                checked={form.subject === "MATH"}
                disabled={isEdit}
                onChange={() => setForm((p) => ({ ...p, subject: "MATH" }))}
              >
                Math
              </RadioRow>
            </div>
            {isEdit ? (
              <p className="mt-1 text-[11px] text-muted-foreground">Subject can&apos;t be changed after creation.</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="practice-title" className={LABEL_CLASS}>
              Subtitle
            </label>
            <input
              id="practice-title"
              name="title"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Optional — e.g. Algebra focus"
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <span className={LABEL_CLASS}>Who sees it</span>
            <div className="space-y-2">
              <RadioRow
                name="practice_access"
                value="open"
                checked={form.practice_access === "open"}
                onChange={() => setForm((p) => ({ ...p, practice_access: "open" }))}
              >
                <strong className="font-bold">Open</strong> — in the library for students of the level
              </RadioRow>
              <RadioRow
                name="practice_access"
                value="homework_only"
                checked={form.practice_access === "homework_only"}
                onChange={() => setForm((p) => ({ ...p, practice_access: "homework_only" }))}
              >
                <strong className="font-bold">Homework only</strong> — hidden until a teacher sets it
              </RadioRow>
            </div>
          </div>

          <div>
            <label htmlFor="practice-level" className={LABEL_CLASS}>
              Level
            </label>
            <select
              id="practice-level"
              name="practice_level"
              value={form.practice_level}
              onChange={(e) => setForm((p) => ({ ...p, practice_level: e.target.value }))}
              className={FIELD_CLASS}
            >
              {LEVEL_CODES.map((code) => (
                <option key={code} value={code}>
                  {levelLabel(code)}
                </option>
              ))}
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

// ─── Practice-test card ───────────────────────────────────────────────────────

function SectionCard({
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
  const accent = isRW ? "var(--color-primary, #2a68c0)" : "#16a34a";
  const subtitle = section.title?.trim();

  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="flex flex-1 flex-col gap-3 p-5">
        {/* Badges: subject · level · access · status */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isRW ? "bg-primary/10 text-primary" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            }`}
          >
            <SubjectIcon subject={section.subject} />
            {isRW ? "R&W" : "Math"}
          </span>
          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {levelLabel(section.practice_level)}
          </span>
          <span
            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              section.practice_access === "open"
                ? "bg-surface-2 text-muted-foreground"
                : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            }`}
          >
            {section.practice_access === "open" ? "Open" : "Homework only"}
          </span>
          <span
            className={`ml-auto rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isPublished ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-surface-2 text-muted-foreground"
            }`}
          >
            {isPublished ? "Published" : "Draft"}
          </span>
        </div>

        {/* Number + subtitle */}
        <div>
          <h3 className="line-clamp-2 text-[15px] font-extrabold leading-snug text-foreground">
            {section.practice_number ? `Practice Test ${section.practice_number}` : "Draft — numbered when published"}
          </h3>
          {subtitle ? (
            <p data-subtitle className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3 shrink-0" />
            <span>{modules.length} module{modules.length !== 1 ? "s" : ""}</span>
          </p>
        </div>

        {/* Publish violations (blocking SAT rules) */}
        {violations && violations.length > 0 ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <strong>Can&apos;t publish yet:</strong>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {violations.map((v, i) => (
                  <li key={`${v.code}-${i}`}>{v.message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Per-module edit links: the past-paper question editor */}
        {modules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs italic text-muted-foreground">
            No modules yet.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {modules.map((mod) => (
              <Link
                key={mod.id}
                href={`/builder/practice-tests/${section.id}/${mod.id}`}
                className={`group flex items-center gap-2 rounded-xl border px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5 ${
                  isRW ? "border-primary/20 bg-primary/5" : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/20 dark:bg-emerald-500/5"
                }`}
              >
                <p className="min-w-0 flex-1 truncate text-xs font-extrabold text-foreground">
                  {mod.module_order != null ? `Module ${mod.module_order}` : `Module #${mod.id}`} — edit questions
                </p>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-1.5 border-t border-border bg-surface-2/40 px-4 py-3">
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
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-2"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
        {confirmDelete ? (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
              className="rounded-xl bg-red-600 px-2.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-xl border border-border bg-card px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete practice test"
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPracticeTestsPage() {
  const [sections, setSections] = useState<AdminPastpaperSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPastpaperSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-section publish / delete state
  const [busyId, setBusyId] = useState<number | null>(null);
  const [violationsFor, setViolationsFor] = useState<Record<number, SectionPublishViolation[]>>({});

  const [subject, setSubject] = useState<SubjectFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await examsAdminApi.getStandaloneSections("practice_test");
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

  const visibleSections = useMemo(
    () =>
      sections
        .filter((s) => {
          if (subject !== "ALL" && s.subject !== subject) return false;
          if (status === "published" && !s.is_published) return false;
          if (status === "draft" && s.is_published) return false;
          return true;
        })
        .sort(librarySort),
    [sections, subject, status],
  );

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
      const title = form.title.trim();
      if (editing) {
        // The subject and the kind are fixed at creation, so an edit never sends them.
        await examsAdminApi.updateSection(editing.id, {
          title,
          practice_access: form.practice_access,
          practice_level: form.practice_level,
        });
      } else {
        await examsAdminApi.createSection({
          subject: form.subject,
          title,
          is_practice_test: true,
          practice_access: form.practice_access,
          practice_level: form.practice_level,
        });
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
    setBusyId(id);
    setError(null);
    try {
      await examsAdminApi.deleteSection(id);
      await load();
    } catch (e) {
      // A test students have already taken refuses with a reason; it is shown as the server wrote it.
      setError(parseError(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleTogglePublish = async (section: AdminPastpaperSection) => {
    setBusyId(section.id);
    setError(null);
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
      setBusyId(null);
    }
  };

  const modalInitial: FormState = useMemo(
    () =>
      editing
        ? {
            subject: editing.subject === "MATH" ? "MATH" : "READING_WRITING",
            title: editing.title ?? "",
            practice_access: editing.practice_access === "open" ? "open" : "homework_only",
            practice_level: editing.practice_level ?? "",
          }
        : EMPTY_FORM,
    [editing],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div data-header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Practice tests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The centre&apos;s own tests. Students see Open tests of their group&apos;s level; Homework only tests
            appear when a teacher sets them.
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
            New practice test
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Filters */}
      {!loading && sections.length > 0 ? (
        <div className="flex flex-wrap gap-5">
          <FilterGroup
            label="Subject"
            value={subject}
            onChange={(v) => setSubject(v as SubjectFilter)}
            options={[
              { v: "ALL", l: "All" },
              { v: "READING_WRITING", l: "Reading & Writing" },
              { v: "MATH", l: "Math" },
            ]}
          />
          <FilterGroup
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              { v: "ALL", l: "All" },
              { v: "published", l: "Published" },
              { v: "draft", l: "Draft" },
            ]}
          />
        </div>
      ) : null}

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
          <p className="font-extrabold text-foreground">No practice tests yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a practice test, then add the questions of each of its modules.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New practice test
          </button>
        </div>
      ) : visibleSections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <p className="font-extrabold text-foreground">No practice tests match your filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a different subject or status.</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {visibleSections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              onEdit={() => openEdit(section)}
              onDelete={() => void handleDelete(section.id)}
              onTogglePublish={() => void handleTogglePublish(section)}
              busy={busyId === section.id}
              violations={violationsFor[section.id] ?? null}
            />
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <SectionModal
        open={modalOpen}
        title={editing ? "Edit practice test" : "New practice test"}
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
