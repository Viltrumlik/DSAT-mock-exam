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
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_DESTRUCTIVE,
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_FIELD_LABEL,
  STUDIO_INPUT,
  STUDIO_LINK,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
} from "@/components/studio/primitives";

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

/** Four-digit year from a practice_date, or "" if none/unparseable. */
function yearOf(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : String(d.getFullYear());
}

type RegionFilter = "ALL" | "US" | "INTL";
type StatusFilter = "ALL" | "live" | "draft";

/** Segmented filter: a small label over a row of options (the /ops toolbar look). */
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
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-muted-foreground">{label}</span>
      <div className="inline-flex flex-wrap gap-0.5 rounded-md border border-border bg-card p-0.5">
        {options.map((o) => {
          const on = value === o.v;
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange(o.v)}
              className={`h-7 rounded-sm px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
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
      <div className="relative z-10 w-full max-w-md border border-border bg-card shadow-xl">
        <div className={`${STUDIO_BOX_CAPTION} flex items-center justify-between gap-2`}>
          <h2 className="min-w-0">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className={`mx-4 mt-4 ${STUDIO_ERROR_BANNER}`}>
            {error}
          </div>
        )}

        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(form);
          }}
        >
          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Subject
            </label>
            <select
              value={form.subject}
              onChange={set("subject")}
              disabled={isEdit}
              className={`${STUDIO_INPUT} disabled:opacity-60`}
            >
              <option value="READING_WRITING">Reading &amp; Writing</option>
              <option value="MATH">Mathematics</option>
            </select>
            {isEdit ? (
              <p className="mt-1 text-[12px] text-muted-foreground">Subject can&apos;t be changed after creation.</p>
            ) : null}
          </div>

          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Collection
            </label>
            <input
              value={form.collection_name}
              onChange={set("collection_name")}
              placeholder="e.g. SAT October 2024"
              className={STUDIO_INPUT}
            />
            <p className="mt-1 text-[12px] text-muted-foreground">
              Sections sharing a collection name are grouped together for students.
            </p>
          </div>

          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Title
            </label>
            <input
              value={form.title}
              onChange={set("title")}
              placeholder="Optional — defaults to subject + date"
              className={STUDIO_INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={STUDIO_FIELD_LABEL}>
                Practice date
              </label>
              <input
                type="date"
                value={form.practice_date}
                onChange={set("practice_date")}
                className={STUDIO_INPUT}
              />
            </div>
            <div>
              <label className={STUDIO_FIELD_LABEL}>
                Form label
              </label>
              <input
                value={form.label}
                onChange={set("label")}
                placeholder="A, B, …"
                className={STUDIO_INPUT}
              />
            </div>
          </div>

          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Form type
            </label>
            <select
              value={form.form_type}
              onChange={set("form_type")}
              className={STUDIO_INPUT}
            >
              <option value="INTERNATIONAL">International</option>
              <option value="US">US Form</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className={STUDIO_BTN_SECONDARY}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={STUDIO_BTN_PRIMARY}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Section row ─────────────────────────────────────────────────────────────────

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

  return (
    <div className="flex flex-col hover:bg-surface-2/40">
      <div className="flex flex-1 flex-col gap-2 px-3 pt-2.5">
        {/* Badges: subject · region · status */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <SubjectIcon subject={section.subject} />
            {isRW ? "R&W" : "Math"}
          </span>
          <span className="text-muted-foreground">
            {section.form_type === "US" ? "🇺🇸 US" : "🌐 International"}
            {section.label ? ` · Form ${section.label}` : ""}
          </span>
          <span className={`ml-auto font-medium ${isPublished ? "text-muted-foreground" : "text-foreground"}`}>
            {isPublished ? "Live" : "Draft"}
          </span>
        </div>

        {/* Title + date */}
        <div>
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
            {section.title?.trim() || `${subjectLabel(section.subject)} · ${formatDate(section.practice_date)}`}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-muted-foreground">
            <Calendar className="h-3 w-3 shrink-0" />
            {formatDate(section.practice_date)}
            <span className="text-muted-foreground/50">·</span>
            <span>{modules.length} module{modules.length !== 1 ? "s" : ""}</span>
          </p>
        </div>

        {/* Publish violations (blocking SAT rules) */}
        {violations && violations.length > 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            <div>
              <strong className="font-semibold">Can&apos;t publish yet:</strong>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {violations.map((v, i) => (
                  <li key={`${v.code}-${i}`}>{v.message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Per-module edit links */}
        {modules.length === 0 ? (
          <p className="text-[12px] italic text-muted-foreground">
            No modules yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {modules.map((mod) => (
              <Link
                key={mod.id}
                href={`/builder/pastpapers/${section.id}/${mod.id}`}
                className={`group inline-flex items-center gap-1 text-[13px] ${STUDIO_LINK}`}
              >
                <p className="min-w-0 truncate">
                  {mod.module_order != null ? `Module ${mod.module_order}` : `Module #${mod.id}`} — edit questions
                </p>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-2">
        <button
          type="button"
          onClick={onTogglePublish}
          disabled={busy}
          className={isPublished ? STUDIO_BTN_SECONDARY : STUDIO_BTN_PRIMARY}
        >
          {busy ? "…" : isPublished ? "Unpublish" : "Publish"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className={STUDIO_BTN_SECONDARY}
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
        {confirmDelete ? (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex min-h-8 items-center rounded-md bg-red-600 px-2.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className={STUDIO_BTN_SECONDARY}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete section"
            className={`ml-auto ${STUDIO_BTN_DESTRUCTIVE}`}
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

  // Student-style filters + search.
  const [region, setRegion] = useState<RegionFilter>("ALL");
  const [year, setYear] = useState("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");

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

  // Distinct years present (desc) for the Year filter.
  const years = useMemo(() => {
    const set = new Set<string>();
    for (const s of sections) { const y = yearOf(s.practice_date); if (y) set.add(y); }
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [sections]);

  // Apply region / year / status / search.
  const filteredSections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sections.filter((s) => {
      if (region === "US" && s.form_type !== "US") return false;
      if (region === "INTL" && s.form_type === "US") return false;
      if (year !== "ALL" && yearOf(s.practice_date) !== year) return false;
      if (status === "live" && !s.is_published) return false;
      if (status === "draft" && s.is_published) return false;
      if (q) {
        const blob = `${s.title ?? ""} ${collectionOf(s)} ${s.label ?? ""} ${s.form_type} ${subjectLabel(s.subject)} ${formatDate(s.practice_date)}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [sections, region, year, status, search]);

  // Group sections by collection_name; newest practice_date first within a group.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, AdminPastpaperSection[]>();
    for (const s of filteredSections) {
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
  }, [filteredSections]);

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={STUDIO_PAGE_TITLE}>Pastpapers</h1>
          <p className={STUDIO_PAGE_DESC}>
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
            className={STUDIO_BTN_SECONDARY}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className={STUDIO_BTN_PRIMARY}
          >
            <Plus className="h-3.5 w-3.5" />
            New section
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className={STUDIO_ERROR_BANNER}>
          {error}
        </div>
      )}

      {/* Search + filters (student-style) */}
      {!loading && sections.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="relative w-full max-w-lg">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pastpapers…"
              aria-label="Search pastpapers"
              className="h-8 w-full rounded-md border border-border bg-card pl-8 pr-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <FilterGroup
              label="Region"
              value={region}
              onChange={(v) => setRegion(v as RegionFilter)}
              options={[{ v: "ALL", l: "All" }, { v: "US", l: "US" }, { v: "INTL", l: "International" }]}
            />
            {years.length > 0 ? (
              <FilterGroup
                label="Year"
                value={year}
                onChange={setYear}
                options={[{ v: "ALL", l: "All" }, ...years.map((y) => ({ v: y, l: y }))]}
              />
            ) : null}
            <FilterGroup
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as StatusFilter)}
              options={[{ v: "ALL", l: "All" }, { v: "live", l: "Live" }, { v: "draft", l: "Draft" }]}
            />
          </div>
        </div>
      ) : null}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : sections.length === 0 ? (
        <div className={`${STUDIO_CARD} px-3 py-8 text-center`}>
          <div className="mb-2 flex justify-center">
            <FileText className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">No pastpaper sections yet</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Create a section, then add its modules and questions.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className={`mt-3 ${STUDIO_BTN_PRIMARY}`}
          >
            <Plus className="h-3.5 w-3.5" />
            New section
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="border border-dashed border-border bg-card px-3 py-8 text-center">
          <p className="text-[13px] font-semibold text-foreground">No pastpapers match your filters</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Try a different region, year, status, or search.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.name} className={STUDIO_CARD}>
              <div className={`${STUDIO_BOX_CAPTION} flex items-center gap-2`}>
                <span>{g.name}</span>
                <span className="font-normal normal-case tracking-normal">
                  {g.items.length} section{g.items.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="divide-y divide-border">
                {g.items.map((section) => (
                  <SectionCard
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
