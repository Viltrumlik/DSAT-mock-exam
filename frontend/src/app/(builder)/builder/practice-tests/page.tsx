"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { examsAdminApi } from "@/features/examsAdmin/api";
import { levelLabel } from "@/features/pastpapers/pastpaperLabels";
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
  RadioRow,
  SubjectBadge,
  sectionShape,
  sortedModules,
} from "@/features/builderLibrary/sectionParts";
import { Badge, Button, EmptyState } from "@/features/console/ui";
import type { AdminPastpaperSection, SectionPublishViolation } from "@/lib/api";

/**
 * The practice-test library: the centre's own single-section tests. Same look as the past-paper
 * builder (card, filter and modal classes), and each module links into the SAME question editor
 * (`/builder/practice-tests/<id>/<module>` re-exports the past-paper one). What differs is the card:
 * a permanent number given at first publish, a subtitle, a level, and who sees it.
 *
 * On the Builder library's card since PR 15b (design handoff v0.3, Modern board "Tests as a media library").
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
          <span className={FIELD_LABEL}>Subject</span>
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
          {isEdit ? <p className={FIELD_HINT}>Subject can&apos;t be changed after creation.</p> : null}
        </div>

        <div>
          <label htmlFor="practice-title" className={FIELD_LABEL}>
            Subtitle
          </label>
          <input
            id="practice-title"
            name="title"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            placeholder="Optional — e.g. Algebra focus"
            className={FIELD}
          />
        </div>

        <div>
          <span className={FIELD_LABEL}>Who sees it</span>
          <div className="flex flex-col gap-2">
            <RadioRow
              name="practice_access"
              value="open"
              checked={form.practice_access === "open"}
              onChange={() => setForm((p) => ({ ...p, practice_access: "open" }))}
            >
              <strong className="font-semibold">Open</strong> — in the library for students of the level
            </RadioRow>
            <RadioRow
              name="practice_access"
              value="homework_only"
              checked={form.practice_access === "homework_only"}
              onChange={() => setForm((p) => ({ ...p, practice_access: "homework_only" }))}
            >
              <strong className="font-semibold">Homework only</strong> — hidden until a teacher sets it
            </RadioRow>
          </div>
        </div>

        <div>
          <label htmlFor="practice-level" className={FIELD_LABEL}>
            Level
          </label>
          <select
            id="practice-level"
            name="practice_level"
            value={form.practice_level}
            onChange={(e) => setForm((p) => ({ ...p, practice_level: e.target.value }))}
            className={FIELD}
          >
            {LEVEL_CODES.map((code) => (
              <option key={code} value={code}>
                {levelLabel(code)}
              </option>
            ))}
          </select>
        </div>

        <ModalActions saving={saving} onCancel={onClose} />
      </form>
    </LibraryModal>
  );
}

// ─── Practice-test card ───────────────────────────────────────────────────────

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
  const subtitle = section.title?.trim();
  const title = section.practice_number ? `Practice Test ${section.practice_number}` : "Draft — numbered when published";
  const first = sortedModules(section)[0];
  const href = first ? `/builder/practice-tests/${section.id}/${first.id}` : undefined;
  const shape = sectionShape(section);

  return (
    <LibraryCard
      delay={Math.min(index, 8) * 40}
      cover={<TestCover blocks={shape.blocks} minutes={shape.minutes} href={href} label={`Open ${title}`} />}
      icon="pencil"
      title={title}
      href={href}
      subtitle={subtitle || undefined}
      meta={
        <>
          {modules.length} module{modules.length !== 1 ? "s" : ""}
        </>
      }
      status={
        <>
          {/* Badges: subject · level · access · status */}
          <SubjectBadge subject={section.subject} />
          <Badge tone="line">{levelLabel(section.practice_level)}</Badge>
          {section.practice_access === "open" ? <Badge tone="line">Open</Badge> : <Badge tone="attention">Homework only</Badge>}
          {isPublished ? (
            <Badge tone="positive" dot>
              Published
            </Badge>
          ) : (
            <Badge tone="line">Draft</Badge>
          )}
        </>
      }
      /* Per-module edit links: the past-paper question editor */
      body={<ModuleLinks section={section} hrefFor={(m) => `/builder/practice-tests/${section.id}/${m.id}`} />}
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
          <InlineDelete label="Delete practice test" busy={busy} onDelete={onDelete} />
        </>
      }
    />
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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <LibraryHeader
        eyebrow="Simulation"
        title="Practice tests"
        description={
          <>
            The centre&apos;s own tests. Students see Open tests of their group&apos;s level; Homework only tests
            appear when a teacher sets them.
          </>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <Icon name="refresh" size="md" className={loading ? "animate-ms-spin" : undefined} />
              Refresh
            </Button>
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New practice test
            </Button>
          </>
        }
      />

      {/* Error banner */}
      {error && <LibraryError>{error}</LibraryError>}

      {/* Filters */}
      {!loading && sections.length > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <LibraryFilter
            label="Subject"
            value={subject}
            onChange={(v) => setSubject(v as SubjectFilter)}
            options={[
              { v: "ALL", l: "All" },
              { v: "READING_WRITING", l: "Reading & Writing" },
              { v: "MATH", l: "Math" },
            ]}
          />
          <LibraryFilter
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
        <LibrarySkeleton />
      ) : sections.length === 0 ? (
        <EmptyState
          icon="pencil"
          title="No practice tests yet"
          detail="Create a practice test, then add the questions of each of its modules."
          action={
            <Button variant="primary" icon="plus" onClick={openCreate}>
              New practice test
            </Button>
          }
        />
      ) : visibleSections.length === 0 ? (
        <EmptyState icon="filter" title="No practice tests match your filters" detail="Try a different subject or status." />
      ) : (
        <div className="grid gap-x-[22px] gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
          {visibleSections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
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
