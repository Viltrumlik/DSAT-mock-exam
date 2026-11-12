"use client";

/**
 * /builder/vocabulary/[sectionId] — the sets inside one vocabulary section.
 *
 * Second level of the drill-down. The section CSV importer lives here because
 * its `set` column routes each row into a set — rows sharing a value land
 * together, so one file can seed a whole section in a single upload.
 *
 * In the console's look (design handoff v0.3, PR 19). The words and the calls are the page's own.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, ConfirmDialog, EmptyState, buttonClass } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL } from "@/features/questionsAdmin/questionLook";
import { csvImportErrorText } from "@/features/vocabularyAdmin/api";
import { CsvImportDialog, RenameForm, VocabCrumbs, WordCountMeter } from "@/features/vocabularyAdmin/builderParts";
import {
  useAdminSections,
  useAdminSets,
  useCreateSet,
  useDeleteSet,
  useImportSectionCsv,
  useUpdateSet,
} from "@/features/vocabularyAdmin/hooks";
import { VOCAB_SET_TARGET_WORDS, type AdminVocabSet } from "@/features/vocabularyAdmin/types";
import { normalizeApiError } from "@/lib/apiError";

export default function BuilderVocabularySectionPage() {
  const params = useParams<{ sectionId: string }>();
  const sectionId = Number(params.sectionId);
  const toast = useToast();

  const { data: sections, isLoading: sectionsLoading } = useAdminSections();
  const section = useMemo(
    () => (sections ?? []).find((s) => s.id === sectionId) ?? null,
    [sections, sectionId],
  );

  const { data, isLoading, error, refetch, isFetching } = useAdminSets(sectionId);
  const sets = data ?? [];

  const [title, setTitle] = useState("");

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // The set being deleted outlives the dialog, so its words stay while the dialog leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminVocabSet | null>(null);

  const [csvOpen, setCsvOpen] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const createMut = useCreateSet(sectionId);
  const updateMut = useUpdateSet(sectionId);
  const deleteMut = useDeleteSet(sectionId);
  const importMut = useImportSectionCsv(sectionId);

  const fail = (e: unknown, fallback: string) =>
    toast.push({ tone: "error", message: normalizeApiError(e).message || fallback });

  const submitCreate = () => {
    if (!title.trim() || createMut.isPending) return;
    createMut.mutate(
      { title: title.trim() },
      {
        onSuccess: (created) => {
          setTitle("");
          toast.push({ tone: "success", message: `Set “${created.title}” created.` });
        },
        onError: (e) => fail(e, "Could not create the set."),
      },
    );
  };

  const submitRename = (set: AdminVocabSet) => {
    const next = editTitle.trim();
    if (!next || next === set.title) {
      setEditingId(null);
      return;
    }
    updateMut.mutate(
      { setId: set.id, patch: { title: next } },
      {
        onSuccess: () => {
          setEditingId(null);
          toast.push({ tone: "success", message: "Set renamed." });
        },
        onError: (e) => fail(e, "Could not rename the set."),
      },
    );
  };

  const runDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deleteMut.mutateAsync(pendingDelete.id);
    } catch (e) {
      // 409 = the set is assigned as homework; the detail names the blocker.
      throw new Error(normalizeApiError(e).message || "Could not delete this set.");
    }
    toast.push({ tone: "success", message: "Set deleted." });
  };

  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    setCsvMsg(null);
    try {
      const res = await importMut.mutateAsync(file);
      setCsvMsg({
        ok: true,
        text: `Imported ${res.created_words} new word${res.created_words === 1 ? "" : "s"} into ${
          res.created_sets
        } new set${res.created_sets === 1 ? "" : "s"}${
          res.linked_words ? ` · ${res.linked_words} existing word${res.linked_words === 1 ? "" : "s"} reused` : ""
        }.`,
      });
    } catch (e: unknown) {
      setCsvMsg({ ok: false, text: csvImportErrorText(e) });
    } finally {
      // Re-picking the same file must re-fire onChange after a failed import.
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const busyId = updateMut.isPending ? updateMut.variables?.setId : null;
  const totalWords = sets.reduce((sum, s) => sum + s.word_count, 0);
  const notFound = !sectionsLoading && !section;

  return (
    <div className="flex flex-col gap-5">
      <VocabCrumbs items={[{ label: "Vocabulary", href: "/builder/vocabulary" }, { label: section?.title ?? `Section #${sectionId}` }]} />

      {notFound ? (
        <div className="rounded-ms-card bg-ms-card p-4 shadow-ms-1">
          <EmptyState
            icon="layers"
            title="Section not found"
            detail="It may have been deleted. Go back to the section list to pick another."
            action={
              <Link href="/builder/vocabulary" className={buttonClass({ variant: "secondary" })}>
                <Icon name="left" size="sm" />
                Back to sections
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="animate-ms-fade-in flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-ms-display text-ms-b-display text-ms-fg">{section?.title ?? "Section"}</h1>
                {section ? (
                  section.is_published ? (
                    <Badge tone="positive" dot>
                      Published
                    </Badge>
                  ) : (
                    <Badge tone="line">Draft</Badge>
                  )
                ) : null}
              </div>
              {section?.description ? <p className="mt-1 max-w-2xl text-[14px] text-ms-fg-2">{section.description}</p> : null}
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ms-fg-2">
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="layers" size="sm" className="size-3.5 text-ms-fg-3" />
                  {sets.length} set{sets.length !== 1 ? "s" : ""}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="book" size="sm" className="size-3.5 text-ms-fg-3" />
                  {totalWords} word{totalWords !== 1 ? "s" : ""}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon="refresh" state={isFetching ? "busy" : "idle"} disabled={isFetching} onClick={() => void refetch()}>
                Refresh
              </Button>
              <Button
                variant="secondary"
                icon="upload"
                onClick={() => {
                  setCsvMsg(null);
                  if (csvInputRef.current) csvInputRef.current.value = "";
                  setCsvOpen(true);
                }}
              >
                Import CSV
              </Button>
            </div>
          </header>

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
                <label className={FIELD_LABEL} htmlFor="vocab-set-title">
                  Set title
                </label>
                <input
                  id="vocab-set-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`e.g. Set ${sets.length + 1}`}
                  className={CONTROL}
                />
              </div>
              <Button type="submit" variant="primary" icon="plus" state={createMut.isPending ? "busy" : "idle"} disabled={!title.trim() || createMut.isPending}>
                Create set
              </Button>
            </div>
          </form>

          {/* Error */}
          {error ? <LibraryError>{normalizeApiError(error).message}</LibraryError> : null}

          {/* Sets */}
          {isLoading ? (
            <div aria-busy="true" aria-label="Loading" className="h-[240px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ) : sets.length === 0 ? (
            <div className="rounded-ms-card bg-ms-card p-4 shadow-ms-1">
              <EmptyState
                icon="layers"
                title="No sets in this section yet"
                detail={`Create a set above, or import a CSV to seed several at once. A set targets ${VOCAB_SET_TARGET_WORDS} words.`}
              />
            </div>
          ) : (
            <section aria-label="Sets" className="animate-ms-fade-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
              <div className="border-b border-ms-line px-5 py-3.5 text-[15px] font-semibold text-ms-fg">
                {sets.length} set{sets.length === 1 ? "" : "s"}
              </div>
              <ul className="divide-y divide-ms-line">
                {sets.map((set) => {
                  const isEditing = editingId === set.id;
                  const isBusy = busyId === set.id;
                  return (
                    <li
                      key={set.id}
                      data-set={set.id}
                      className="ms-transition flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4 hover:bg-ms-surface"
                    >
                      <div className="min-w-0 flex-1 basis-[16rem]">
                        {isEditing ? (
                          <RenameForm
                            label="Set title"
                            className="max-w-xs"
                            value={editTitle}
                            onChange={setEditTitle}
                            onSubmit={() => submitRename(set)}
                            onCancel={() => setEditingId(null)}
                            busy={isBusy}
                          />
                        ) : (
                          <>
                            <Link
                              href={`/builder/vocabulary/${sectionId}/${set.id}`}
                              className="block truncate text-[16px] font-semibold leading-[22px] text-ms-fg hover:text-ms-primary-text"
                            >
                              #{set.id} · {set.title}
                            </Link>
                            <p className="mt-1.5">
                              <WordCountMeter count={set.word_count} />
                            </p>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="pencil"
                            aria-label={`Rename set ${set.title}`}
                            onClick={() => {
                              setEditingId(set.id);
                              setEditTitle(set.title);
                            }}
                          />
                          <Link href={`/builder/vocabulary/${sectionId}/${set.id}`} className={buttonClass({ variant: "secondary", size: "sm" })}>
                            Open words
                            <Icon name="right" size="sm" />
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="trash"
                            aria-label={`Delete set ${set.title}`}
                            onClick={() => {
                              setPendingDelete(set);
                              setDeleteOpen(true);
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Section CSV import */}
      <CsvImportDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Import words into this section"
        intro={
          <>
            One word per row. Rows sharing a <code className="font-ms-mono">set</code> value land in the same set.
          </>
        }
        help={
          <>
            <span className="font-semibold text-ms-fg">word</span> and <span className="font-semibold text-ms-fg">definition</span> are
            required. A numeric <span className="font-semibold text-ms-fg">set</span> becomes “Set 3”; any other value is used as the
            title, and an existing set with that title is appended to. Separate{" "}
            <span className="font-semibold text-ms-fg">synonyms</span> with semicolons. The whole file is rejected if any row is invalid.
          </>
        }
        inputId="vocab-section-csv"
        inputRef={csvInputRef}
        busy={importMut.isPending}
        msg={csvMsg}
        onFile={(f) => void handleCsvFile(f)}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        tone="critical"
        icon="trash"
        title="Delete vocabulary set?"
        confirmLabel="Delete set"
        busyLabel="Deleting…"
        onConfirm={runDelete}
      >
        {pendingDelete ? `“${pendingDelete.title}” will be removed from this section. Its words stay in the section bank.` : null}
      </ConfirmDialog>
    </div>
  );
}
