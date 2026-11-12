"use client";

/**
 * /builder/vocabulary — vocabulary section list.
 *
 * Top of the three-level authoring drill-down: section → set → word. A section
 * is what a student browses in the Question Bank tab, so unpublishing one hides
 * every set inside it without destroying anything.
 *
 * In the console's look (design handoff v0.3, PR 19): the Builder's header, the create card, a card per section,
 * the console confirm dialog. The words and the calls are the page's own.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { LibraryError, LibraryHeader } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, ConfirmDialog, EmptyState, StatTile, buttonClass } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { RenameForm } from "@/features/vocabularyAdmin/builderParts";
import {
  useAdminSections,
  useCreateSection,
  useDeleteSection,
  useUpdateSection,
} from "@/features/vocabularyAdmin/hooks";
import type { AdminVocabSection } from "@/features/vocabularyAdmin/types";
import { normalizeApiError } from "@/lib/apiError";

export default function BuilderVocabularyPage() {
  const router = useRouter();
  const toast = useToast();

  const { data, isLoading, error, refetch, isFetching } = useAdminSections();
  const sections = data ?? [];

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // The section being deleted outlives the dialog, so its words stay while the dialog leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminVocabSection | null>(null);

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

  const runDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
    } catch (e) {
      // A 409 means one of its sets is live homework — the message names it.
      throw new Error(normalizeApiError(e).message || "Could not delete this section.");
    }
    toast.push({ tone: "success", message: "Section deleted." });
  };

  const totalSets = sections.reduce((sum, s) => sum + s.set_count, 0);
  const totalWords = sections.reduce((sum, s) => sum + s.word_count, 0);
  const busyId = updateMut.isPending ? updateMut.variables?.id : null;

  return (
    <div className="flex flex-col gap-5">
      <LibraryHeader
        eyebrow="Vocabulary bank"
        title="Vocabulary"
        description="A section is a named collection — “College Panda”, “650 Hard Words”. Sections hold sets of about 25 words, and a teacher assigns a set as homework. Only a published section is visible to students."
        actions={
          <Button variant="secondary" icon="refresh" state={isFetching ? "busy" : "idle"} disabled={isFetching} onClick={() => void refetch()}>
            Refresh
          </Button>
        }
      />

      {/* Create form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitCreate();
        }}
        className="animate-ms-card-in rounded-ms-card bg-ms-card p-4 shadow-ms-1 sm:p-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className={FIELD_LABEL} htmlFor="vocab-section-title">
              Section title
            </label>
            <input
              id="vocab-section-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. College Panda — Tier 1"
              className={CONTROL}
            />
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label className={FIELD_LABEL} htmlFor="vocab-section-description">
              Description (optional)
            </label>
            <input
              id="vocab-section-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this collection covers"
              className={CONTROL}
            />
          </div>
          <Button type="submit" variant="primary" icon="plus" state={createMut.isPending ? "busy" : "idle"} disabled={!title.trim() || createMut.isPending}>
            Create section
          </Button>
        </div>
      </form>

      {/* Stats */}
      {!isLoading && sections.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Sections" value={sections.length} icon="ms-vocab" />
          <StatTile label="Sets" value={totalSets} icon="layers" delay={40} />
          <StatTile label="Words" value={totalWords} icon="book" delay={80} />
        </div>
      )}

      {/* Error */}
      {error ? <LibraryError>{normalizeApiError(error).message}</LibraryError> : null}

      {/* List */}
      {isLoading ? (
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[112px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-ms-card bg-ms-card p-4 shadow-ms-1">
          <EmptyState
            icon="ms-vocab"
            title="No vocabulary sections yet"
            detail="Create a section above, then fill it with sets of 25 words."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map((section, i) => {
            const isEditing = editingId === section.id;
            const isBusy = busyId === section.id;
            return (
              <article
                key={section.id}
                data-section={section.id}
                style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
                className="animate-ms-card-in rounded-ms-card bg-ms-card p-5 shadow-ms-1"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 basis-[18rem]">
                    {isEditing ? (
                      <RenameForm
                        label="Section title"
                        value={editTitle}
                        onChange={setEditTitle}
                        onSubmit={() => submitRename(section)}
                        onCancel={() => setEditingId(null)}
                        busy={isBusy}
                      />
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="min-w-0 break-words text-[17px] font-bold leading-6 text-ms-fg">
                            <Link href={`/builder/vocabulary/${section.id}`} className="hover:text-ms-primary-text">
                              #{section.id} · {section.title}
                            </Link>
                          </h3>
                          {section.is_published ? (
                            <Badge tone="positive" dot>
                              Published
                            </Badge>
                          ) : (
                            <Badge tone="line">Draft</Badge>
                          )}
                        </div>
                        {section.description ? <p className="mt-1 text-[14px] text-ms-fg-2">{section.description}</p> : null}
                        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ms-fg-2">
                          <span className="inline-flex items-center gap-1.5">
                            <Icon name="layers" size="sm" className="size-3.5 text-ms-fg-3" />
                            {section.set_count} set{section.set_count !== 1 ? "s" : ""}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Icon name="book" size="sm" className="size-3.5 text-ms-fg-3" />
                            {section.word_count} word{section.word_count !== 1 ? "s" : ""}
                          </span>
                          <span className="font-ms-mono text-[12px] text-ms-fg-3">{section.slug}</span>
                        </p>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="eye"
                        state={isBusy ? "busy" : "idle"}
                        disabled={isBusy}
                        onClick={() => togglePublished(section)}
                      >
                        {section.is_published ? "Unpublish" : "Publish"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="pencil"
                        aria-label={`Rename section ${section.title}`}
                        onClick={() => {
                          setEditingId(section.id);
                          setEditTitle(section.title);
                        }}
                      />
                      <Link href={`/builder/vocabulary/${section.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                        Open sets
                        <Icon name="right" size="sm" />
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="trash"
                        aria-label={`Delete section ${section.title}`}
                        onClick={() => {
                          setPendingDelete(section);
                          setDeleteOpen(true);
                        }}
                      />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title="Delete vocabulary section?"
        confirmLabel="Delete section"
        busyLabel="Deleting…"
        onConfirm={runDelete}
      >
        {pendingDelete
          ? `“${pendingDelete.title}” and its ${pendingDelete.set_count} set${
              pendingDelete.set_count === 1 ? "" : "s"
            } / ${pendingDelete.word_count} word${pendingDelete.word_count === 1 ? "" : "s"} will be permanently removed.`
          : null}
      </ConfirmDialog>
    </div>
  );
}
