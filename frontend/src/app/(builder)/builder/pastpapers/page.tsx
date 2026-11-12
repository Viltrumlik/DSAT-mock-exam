"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { examsAdminApi } from "@/features/examsAdmin/api";
import { LibraryCard, LibrarySkeleton, TestCover } from "@/features/builderLibrary/LibraryCard";
import {
  FIELD,
  FIELD_HINT,
  FIELD_LABEL,
  InlineDelete,
  LibraryError,
  LibraryFilter,
  LibraryHeader,
  LibraryModal,
  ModalActions,
  ModuleLinks,
  PublishViolations,
  SubjectBadge,
  sectionShape,
  sortedModules,
} from "@/features/builderLibrary/sectionParts";
import { Badge, Button, EmptyState, inputShell } from "@/features/console/ui";
import type { AdminPastpaperSection, SectionPublishViolation } from "@/lib/api";

/**
 * The past-paper library: real SAT papers, one section (subject) per card, grouped by the form's collection.
 * On the Builder library's card since PR 15b (design handoff v0.3, Modern board "Tests as a media library").
 */

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

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <LibraryModal open={open} title={title} error={error} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(form);
        }}
      >
        <div>
          <label htmlFor="pp-subject" className={FIELD_LABEL}>
            Subject
          </label>
          <select id="pp-subject" value={form.subject} onChange={set("subject")} disabled={isEdit} className={FIELD}>
            <option value="READING_WRITING">Reading &amp; Writing</option>
            <option value="MATH">Mathematics</option>
          </select>
          {isEdit ? <p className={FIELD_HINT}>Subject can&apos;t be changed after creation.</p> : null}
        </div>

        <div>
          <label htmlFor="pp-collection" className={FIELD_LABEL}>
            Collection
          </label>
          <input
            id="pp-collection"
            value={form.collection_name}
            onChange={set("collection_name")}
            placeholder="e.g. SAT October 2024"
            className={FIELD}
          />
          <p className={FIELD_HINT}>Sections sharing a collection name are grouped together for students.</p>
        </div>

        <div>
          <label htmlFor="pp-title" className={FIELD_LABEL}>
            Title
          </label>
          <input id="pp-title" value={form.title} onChange={set("title")} placeholder="Optional — defaults to subject + date" className={FIELD} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pp-date" className={FIELD_LABEL}>
              Practice date
            </label>
            <input id="pp-date" type="date" value={form.practice_date} onChange={set("practice_date")} className={FIELD} />
          </div>
          <div>
            <label htmlFor="pp-label" className={FIELD_LABEL}>
              Form label
            </label>
            <input id="pp-label" value={form.label} onChange={set("label")} placeholder="A, B, …" className={FIELD} />
          </div>
        </div>

        <div>
          <label htmlFor="pp-form-type" className={FIELD_LABEL}>
            Form type
          </label>
          <select id="pp-form-type" value={form.form_type} onChange={set("form_type")} className={FIELD}>
            <option value="INTERNATIONAL">International</option>
            <option value="US">US Form</option>
          </select>
        </div>

        <ModalActions saving={saving} onCancel={onClose} />
      </form>
    </LibraryModal>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────────

function SectionCard({
  section,
  index,
  onEdit,
  onDelete,
  onTogglePublish,
  busy,
  violations,
}: {
  section: AdminPastpaperSection;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
  busy: boolean;
  violations: SectionPublishViolation[] | null;
}) {
  const isPublished = section.is_published === true;
  const modules = section.modules ?? [];
  const title = section.title?.trim() || `${subjectLabel(section.subject)} · ${formatDate(section.practice_date)}`;
  const first = sortedModules(section)[0];
  const href = first ? `/builder/pastpapers/${section.id}/${first.id}` : undefined;
  const shape = sectionShape(section);

  return (
    <LibraryCard
      delay={Math.min(index, 8) * 40}
      cover={<TestCover short blocks={shape.blocks} minutes={shape.minutes} href={href} label={`Open ${title}`} />}
      icon="ms-pastpaper"
      title={title}
      href={href}
      meta={
        <span className="inline-flex items-center gap-1">
          <Icon name="cal" size="sm" className="size-3.5" />
          {formatDate(section.practice_date)}
          <span aria-hidden>·</span>
          {modules.length} module{modules.length !== 1 ? "s" : ""}
        </span>
      }
      status={
        <>
          {/* Badges: subject · region · status */}
          <SubjectBadge subject={section.subject} />
          <Badge tone="line">
            {section.form_type === "US" ? "🇺🇸 US" : "🌐 International"}
            {section.label ? ` · Form ${section.label}` : ""}
          </Badge>
          {isPublished ? (
            <Badge tone="positive" dot>
              Live
            </Badge>
          ) : (
            <Badge tone="line">Draft</Badge>
          )}
        </>
      }
      /* Per-module edit links */
      body={<ModuleLinks section={section} hrefFor={(m) => `/builder/pastpapers/${section.id}/${m.id}`} />}
      /* Publish violations (blocking SAT rules) */
      note={<PublishViolations violations={violations} />}
      actions={
        <>
          <Button variant="secondary" size="sm" icon="eye" state={busy ? "busy" : "idle"} onClick={onTogglePublish}>
            {isPublished ? "Unpublish" : "Publish"}
          </Button>
          <Button variant="ghost" size="sm" icon="pencil" onClick={onEdit}>
            Edit
          </Button>
          <InlineDelete label="Delete section" onDelete={onDelete} />
        </>
      }
    />
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
      const data = await examsAdminApi.getStandaloneSections("pastpaper");
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

  let cardIndex = 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <LibraryHeader
        eyebrow="Simulation"
        title="Pastpapers"
        description={
          <>
            Manage standalone pastpaper sections. Each section is a single Reading &amp; Writing or
            Mathematics test, published independently. Use a shared collection name to group sections
            from the same SAT form for students.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <Icon name="refresh" size="md" className={loading ? "animate-ms-spin" : undefined} />
              Refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New section
            </Button>
          </>
        }
      />

      {/* Error banner */}
      {error && <LibraryError>{error}</LibraryError>}

      {/* Search + filters (student-style) */}
      {!loading && sections.length > 0 ? (
        <div className="flex flex-col gap-4">
          <div className={inputShell({ className: "w-full max-w-[640px]" })}>
            <Icon name="search" className="shrink-0 text-ms-fg-3" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pastpapers…"
              aria-label="Search pastpapers"
              className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-ms-fg-3"
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <LibraryFilter
              label="Region"
              value={region}
              onChange={(v) => setRegion(v as RegionFilter)}
              options={[{ v: "ALL", l: "All" }, { v: "US", l: "US" }, { v: "INTL", l: "International" }]}
            />
            {years.length > 0 ? (
              <LibraryFilter
                label="Year"
                value={year}
                onChange={setYear}
                options={[{ v: "ALL", l: "All" }, ...years.map((y) => ({ v: y, l: y }))]}
              />
            ) : null}
            <LibraryFilter
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
        <LibrarySkeleton count={4} />
      ) : sections.length === 0 ? (
        <EmptyState
          icon="ms-pastpaper"
          title="No pastpaper sections yet"
          detail="Create a section, then add its modules and questions."
          action={
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New section
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState icon="filter" title="No pastpapers match your filters" detail="Try a different region, year, status, or search." />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.name} aria-label={g.name} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-1">
                <span className="text-ms-over uppercase text-ms-fg-2">{g.name}</span>
                <span className="text-[13px] text-ms-fg-3">
                  {g.items.length} section{g.items.length !== 1 ? "s" : ""}
                </span>
                <span className="h-px flex-1 bg-ms-line" />
              </div>
              {/* A collection is a form's R&W and Math sections: two columns hold a pair side by side
                  without the empty third track auto-fill left on a wide screen. */}
              <div className="grid gap-x-[22px] gap-y-8 md:grid-cols-2">
                {g.items.map((section) => (
                  <SectionCard
                    key={section.id}
                    section={section}
                    index={cardIndex++}
                    onEdit={() => openEdit(section)}
                    onDelete={() => void handleDelete(section.id)}
                    onTogglePublish={() => void handleTogglePublish(section)}
                    busy={publishBusy === section.id}
                    violations={violationsFor[section.id] ?? null}
                  />
                ))}
              </div>
            </section>
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
