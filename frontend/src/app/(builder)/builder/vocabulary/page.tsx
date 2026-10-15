"use client";

/**
 * /builder/vocabulary — vocabulary section list.
 *
 * Top of the three-level authoring drill-down: section → set → word. A section
 * is what a student browses in the Question Bank tab, so unpublishing one hides
 * every set inside it without destroying anything.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookMarked,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";

import { StateTag } from "@/components/governance";
import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { StudioSpinner } from "@/components/studio/StudioSpinner";
import {
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_FIELD_LABEL,
  STUDIO_INPUT,
  STUDIO_SECTION_GAP,
} from "@/components/studio/primitives";
import { useToast } from "@/components/ToastProvider";
import { ConfirmDialog } from "@/features/classroom/ui";
import {
  useAdminSections,
  useCreateSection,
  useDeleteSection,
  useUpdateSection,
} from "@/features/vocabularyAdmin/hooks";
import type { AdminVocabSection } from "@/features/vocabularyAdmin/types";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

export default function BuilderVocabularyPage() {
  const router = useRouter();
  const toast = useToast();

  const { data, isLoading, error, refetch, isFetching } = useAdminSections();
  const sections = data ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [pendingDelete, setPendingDelete] = useState<AdminVocabSection | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createMut = useCreateSection();
  const updateMut = useUpdateSection();
  const deleteMut = useDeleteSection();

  const fail = (e: unknown, fallback: string) =>
    toast.push({ tone: "error", message: normalizeApiError(e).message || fallback });

  const submitCreate = () => {
    if (!title.trim() || createMut.isPending) return;
    createMut.mutate(
      { title: title.trim(), description: description.trim() },
      {
        onSuccess: (section) => {
          setTitle("");
          setDescription("");
          toast.push({ tone: "success", message: `Section “${section.title}” created.` });
          router.push(`/builder/vocabulary/${section.id}`);
        },
        onError: (e) => fail(e, "Could not create the section."),
      },
    );
  };

  const submitRename = (section: AdminVocabSection) => {
    const next = editTitle.trim();
    if (!next || next === section.title) {
      setEditingId(null);
      return;
    }
    updateMut.mutate(
      { id: section.id, patch: { title: next } },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.push({ tone: "success", message: "Section renamed." });
        },
        onError: (e) => fail(e, "Could not rename the section."),
      },
    );
  };

  const togglePublished = (section: AdminVocabSection) => {
    updateMut.mutate(
      { id: section.id, patch: { is_published: !section.is_published } },
      {
        onSuccess: (updated) =>
          toast.push({
            tone: "success",
            message: updated.is_published ? "Section published." : "Section hidden from students.",
          }),
        onError: (e) => fail(e, "Could not change visibility."),
      },
    );
  };

  const runDelete = () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.push({ tone: "success", message: "Section deleted." });
      },
      // A 409 means one of its sets is live homework — the message names it.
      onError: (e) => setDeleteError(normalizeApiError(e).message || "Could not delete this section."),
    });
  };

  const closeDelete = () => {
    setPendingDelete(null);
    setDeleteError(null);
  };

  const totalSets = sections.reduce((sum, s) => sum + s.set_count, 0);
  const totalWords = sections.reduce((sum, s) => sum + s.word_count, 0);
  const busyId = updateMut.isPending ? updateMut.variables?.id : null;

  return (
    <div className={STUDIO_SECTION_GAP}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            Vocabulary bank
          </p>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Vocabulary</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            A section is a named collection — “College Panda”, “650 Hard Words”. Sections hold sets
            of about 25 words, and a teacher assigns a set as homework. Only a published section is
            visible to students.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className={STUDIO_BTN_SECONDARY}
        >
          <RefreshCcw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Create form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitCreate();
        }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className={STUDIO_FIELD_LABEL} htmlFor="vocab-section-title">
              Section title
            </label>
            <input
              id="vocab-section-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. College Panda — Tier 1"
              className={STUDIO_INPUT}
            />
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label className={STUDIO_FIELD_LABEL} htmlFor="vocab-section-description">
              Description (optional)
            </label>
            <input
              id="vocab-section-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this collection covers"
              className={STUDIO_INPUT}
            />
          </div>
          <button type="submit" disabled={!title.trim() || createMut.isPending} className={STUDIO_BTN_PRIMARY}>
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create section
          </button>
        </div>
      </form>

      {/* Stats */}
      {!isLoading && sections.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-foreground">{sections.length}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Sections
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-primary">{totalSets}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Sets
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xl font-extrabold tabular-nums text-muted-foreground">{totalWords}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Words
            </p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className={STUDIO_ERROR_BANNER}>{normalizeApiError(error).message}</div>}

      {/* List */}
      {isLoading ? (
        <StudioSpinner size="lg" center />
      ) : sections.length === 0 ? (
        <div className={STUDIO_CARD}>
          <StudioEmptyState
            icon={BookMarked}
            title="No vocabulary sections yet"
            body="Create a section above, then fill it with sets of 25 words."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section) => {
            const isEditing = editingId === section.id;
            const isBusy = busyId === section.id;
            return (
              <div key={section.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitRename(section);
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className={cn(STUDIO_INPUT, "max-w-sm")}
                        />
                        <button
                          type="submit"
                          disabled={!editTitle.trim() || isBusy}
                          className={STUDIO_BTN_PRIMARY}
                        >
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className={STUDIO_BTN_SECONDARY}
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate font-extrabold text-foreground">
                            #{section.id} · {section.title}
                          </h3>
                          <StateTag state={section.is_published ? "PUBLISHED" : "DRAFT"} size="xs" />
                        </div>
                        {section.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                        )}
                        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Layers className="h-3 w-3" />
                            {section.set_count} set{section.set_count !== 1 ? "s" : ""}
                          </span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="inline-flex items-center gap-1">
                            <BookMarked className="h-3 w-3" />
                            {section.word_count} word{section.word_count !== 1 ? "s" : ""}
                          </span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="font-mono text-[11px]">{section.slug}</span>
                        </p>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => togglePublished(section)}
                        disabled={isBusy}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50",
                          section.is_published
                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
                        )}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : section.is_published ? (
                          <EyeOff className="h-3 w-3" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        {section.is_published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(section.id);
                          setEditTitle(section.title);
                        }}
                        title="Rename section"
                        aria-label={`Rename section ${section.title}`}
                        className="inline-flex items-center rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <Link
                        href={`/builder/vocabulary/${section.id}`}
                        className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-2"
                      >
                        Open sets
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setPendingDelete(section);
                        }}
                        title="Delete section"
                        aria-label={`Delete section ${section.title}`}
                        className="inline-flex items-center rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete vocabulary section?"
        description={
          pendingDelete
            ? `“${pendingDelete.title}” and its ${pendingDelete.set_count} set${
                pendingDelete.set_count === 1 ? "" : "s"
              } / ${pendingDelete.word_count} word${
                pendingDelete.word_count === 1 ? "" : "s"
              } will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete section"
        loading={deleteMut.isPending}
        onConfirm={runDelete}
        onCancel={closeDelete}
      >
        {deleteError ? <div className={STUDIO_ERROR_BANNER}>{deleteError}</div> : null}
      </ConfirmDialog>
    </div>
  );
}
