"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { examsAdminApi } from "@/features/examsAdmin/api";
import {
  BookOpen,
  Calculator,
  ChevronRight,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
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

type PracticeTestPackSection = {
  id: number;
  subject: string;
  title: string;
  modules: { id: number; module_order: number | null }[];
};

type PracticeTestPack = {
  id: number;
  title: string;
  description: string;
  is_published: boolean;
  published_at: string | null;
  created_by: number | null;
  sections: PracticeTestPackSection[];
  section_count: number;
  created_at: string;
  updated_at: string;
};

type FormState = {
  title: string;
  description: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return s;
  }
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
              Title
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Practice Test Set 1"
              className={STUDIO_INPUT}
            />
          </div>

          <div>
            <label className={STUDIO_FIELD_LABEL}>
              Description
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional description for students..."
              rows={3}
              className={`${STUDIO_INPUT} resize-none`}
            />
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
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pack row ─────────────────────────────────────────────────────────────────

function PackRow({
  pack,
  onEdit,
  onDelete,
  onTogglePublish,
  onAddSection,
  addingSection,
  publishing,
}: {
  pack: PracticeTestPack;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePublish: () => void;
  onAddSection: (subject: "READING_WRITING" | "MATH") => void;
  addingSection: boolean;
  publishing: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rwSection = pack.sections.find((s) => s.subject === "READING_WRITING");
  const mathSection = pack.sections.find((s) => s.subject === "MATH");
  const hasRW = !!rwSection;
  const hasMath = !!mathSection;

  return (
    <div className="px-3 py-2.5 hover:bg-surface-2/40">
      {/* Pack header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[13px] font-semibold text-foreground">
              {pack.title || `Practice Test #${pack.id}`}
            </h3>
            <span
              className={`text-[12px] font-medium ${
                pack.is_published
                  ? "text-muted-foreground"
                  : "text-foreground"
              }`}
            >
              {pack.is_published ? "Published" : "Draft"}
            </span>
          </div>
          {pack.description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground line-clamp-2">
              {pack.description}
            </p>
          )}
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Created {formatDate(pack.created_at)}
            <span className="mx-1.5 text-muted-foreground/50">&middot;</span>
            {pack.sections.length} section{pack.sections.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePublish}
            disabled={publishing}
            className={pack.is_published ? STUDIO_BTN_SECONDARY : STUDIO_BTN_PRIMARY}
          >
            {publishing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : pack.is_published ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            {pack.is_published ? "Unpublish" : "Publish"}
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
            <div className="flex items-center gap-1.5">
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
              className={STUDIO_BTN_DESTRUCTIVE}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Sections + per-module links */}
      {pack.sections.length > 0 && (
        <div className="mt-2 space-y-2">
          {pack.sections.map((section) => {
            const modules = section.modules ?? [];
            return (
              <div key={section.id}>
                <div className="mb-1 flex items-center gap-2">
                  <div className="text-muted-foreground">
                    <SubjectIcon subject={section.subject} />
                  </div>
                  <span className="text-[12px] font-semibold text-foreground">
                    {subjectLabel(section.subject)}
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    {modules.length} module{modules.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {modules.length === 0 ? (
                  <p className="pl-5.5 text-[12px] text-muted-foreground italic">
                    No modules yet — add questions from the test admin.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pl-5.5">
                    {modules.map((mod) => (
                      <Link
                        key={mod.id}
                        href={`/builder/practice-tests/${pack.id}/${section.id}/${mod.id}`}
                        className={`group inline-flex items-center gap-1 text-[13px] ${STUDIO_LINK}`}
                      >
                        <div className="min-w-0">
                          <p>
                            {mod.module_order != null
                              ? `Module ${mod.module_order}`
                              : `Module #${mod.id}`}
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
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!hasRW && (
          <button
            type="button"
            onClick={() => onAddSection("READING_WRITING")}
            disabled={addingSection}
            className={STUDIO_BTN_SECONDARY}
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
            className={STUDIO_BTN_SECONDARY}
          >
            <Plus className="h-3 w-3" />
            Add Mathematics
          </button>
        )}
        {hasRW && hasMath && (
          <p className="text-[12px] text-muted-foreground italic">All sections added.</p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderPracticeTestsPage() {
  const [packs, setPacks] = useState<PracticeTestPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<PracticeTestPack | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-pack action state
  const [addingSectionFor, setAddingSectionFor] = useState<number | null>(null);
  const [publishingFor, setPublishingFor] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await examsAdminApi.getPracticeTestPacks();
      setPacks(data.items as PracticeTestPack[]);
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

  const openEdit = (pack: PracticeTestPack) => {
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
        description: form.description.trim() || "",
      };
      if (editingPack) {
        await examsAdminApi.updatePracticeTestPack(editingPack.id, payload);
      } else {
        await examsAdminApi.createPracticeTestPack(payload);
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
      await examsAdminApi.deletePracticeTestPack(id);
      await load();
    } catch (e) {
      setError(parseError(e));
    }
  };

  const handleTogglePublish = async (pack: PracticeTestPack) => {
    setPublishingFor(pack.id);
    try {
      if (pack.is_published) {
        await examsAdminApi.unpublishPracticeTestPack(pack.id);
      } else {
        await examsAdminApi.publishPracticeTestPack(pack.id);
      }
      await load();
    } catch (e) {
      setError(parseError(e));
    } finally {
      setPublishingFor(null);
    }
  };

  const handleAddSection = async (packId: number, subject: "READING_WRITING" | "MATH") => {
    setAddingSectionFor(packId);
    try {
      await examsAdminApi.addPracticeTestPackSection(packId, subject);
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
        description: editingPack.description ?? "",
      }
    : EMPTY_FORM;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={STUDIO_PAGE_TITLE}>Practice Tests</h1>
          <p className={STUDIO_PAGE_DESC}>
            Manage custom practice test packs. Each pack groups Reading &amp; Writing and Mathematics
            sections. Students can start any section in any order.
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
            New pack
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className={STUDIO_ERROR_BANNER}>
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : packs.length === 0 ? (
        <div className={`${STUDIO_CARD} px-3 py-8 text-center`}>
          <div className="mb-2 flex justify-center">
            <FlaskConical className="h-5 w-5 text-muted-foreground/60" />
          </div>
          <p className="text-[13px] font-semibold text-foreground">No practice test packs yet</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Create a pack to start building custom practice tests.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className={`mt-3 ${STUDIO_BTN_PRIMARY}`}
          >
            <Plus className="h-3.5 w-3.5" />
            New pack
          </button>
        </div>
      ) : (
        <div className={`${STUDIO_CARD} divide-y divide-border`}>
          {packs.map((pack) => (
            <PackRow
              key={pack.id}
              pack={pack}
              onEdit={() => openEdit(pack)}
              onDelete={() => void handleDelete(pack.id)}
              onTogglePublish={() => void handleTogglePublish(pack)}
              onAddSection={(subject) => void handleAddSection(pack.id, subject)}
              addingSection={addingSectionFor === pack.id}
              publishing={publishingFor === pack.id}
            />
          ))}
        </div>
      )}

      {/* Create / edit modal */}
      <PackModal
        open={modalOpen}
        title={editingPack ? "Edit practice test pack" : "New practice test pack"}
        initial={modalInitial}
        saving={saving}
        error={saveError}
        onSubmit={(f) => void handleSave(f)}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
