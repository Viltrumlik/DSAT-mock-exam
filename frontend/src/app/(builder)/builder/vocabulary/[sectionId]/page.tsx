"use client";

/**
 * /builder/vocabulary/[sectionId] — the sets inside one vocabulary section.
 *
 * Second level of the drill-down. The section CSV importer lives here because
 * its `set` column routes each row into a set — rows sharing a value land
 * together, so one file can seed a whole section in a single upload.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronRight,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
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
import { csvImportErrorText } from "@/features/vocabularyAdmin/api";
import {
  useAdminSections,
  useAdminSets,
  useCreateSet,
  useDeleteSet,
  useImportSectionCsv,
  useUpdateSet,
} from "@/features/vocabularyAdmin/hooks";
import {
  VOCAB_CSV_COLUMNS,
  VOCAB_SET_TARGET_WORDS,
  type AdminVocabSet,
} from "@/features/vocabularyAdmin/types";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";

/** Progress against the 25-word target. Guidance only — nothing is blocked. */
function WordCountMeter({ count }: { count: number }) {
  const over = count > VOCAB_SET_TARGET_WORDS;
  const pct = Math.min(100, Math.round((count / VOCAB_SET_TARGET_WORDS) * 100));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        <span
          className={cn("block h-full rounded-full", over ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </span>
      <span className={cn("tabular-nums font-bold", over ? "text-amber-700" : "text-foreground")}>
        {count} / {VOCAB_SET_TARGET_WORDS}
      </span>
      {over && (
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800">
          {count - VOCAB_SET_TARGET_WORDS} over
        </span>
      )}
    </span>
  );
}

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

  const [pendingDelete, setPendingDelete] = useState<AdminVocabSet | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const runDelete = () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.push({ tone: "success", message: "Set deleted." });
      },
      // 409 = the set is assigned as homework; the detail names the blocker.
      onError: (e) => setDeleteError(normalizeApiError(e).message || "Could not delete this set."),
    });
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
    <div className={STUDIO_SECTION_GAP}>
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
        <Link
          href="/builder/vocabulary"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-primary hover:bg-surface-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Vocabulary
        </Link>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
        <span className="rounded-lg px-2 py-1 text-foreground">
          {section?.title ?? `Section #${sectionId}`}
        </span>
      </nav>

      {notFound ? (
        <div className={STUDIO_CARD}>
          <StudioEmptyState
            icon={Layers}
            title="Section not found"
            body="It may have been deleted. Go back to the section list to pick another."
            action={
              <Link href="/builder/vocabulary" className={STUDIO_BTN_SECONDARY}>
                <ArrowLeft className="h-4 w-4" />
                Back to sections
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {section?.title ?? "Section"}
                </h1>
                {section && <StateTag state={section.is_published ? "PUBLISHED" : "DRAFT"} size="xs" />}
              </div>
              {section?.description && (
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">{section.description}</p>
              )}
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {sets.length} set{sets.length !== 1 ? "s" : ""}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="inline-flex items-center gap-1">
                  <BookMarked className="h-3 w-3" />
                  {totalWords} word{totalWords !== 1 ? "s" : ""}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className={STUDIO_BTN_SECONDARY}
              >
                <RefreshCcw className={cn("h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  setCsvMsg(null);
                  if (csvInputRef.current) csvInputRef.current.value = "";
                  setCsvOpen(true);
                }}
                className={STUDIO_BTN_SECONDARY}
              >
                <Upload className="h-4 w-4" />
                Import CSV
              </button>
            </div>
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
                <label className={STUDIO_FIELD_LABEL} htmlFor="vocab-set-title">
                  Set title
                </label>
                <input
                  id="vocab-set-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`e.g. Set ${sets.length + 1}`}
                  className={STUDIO_INPUT}
                />
              </div>
              <button
                type="submit"
                disabled={!title.trim() || createMut.isPending}
                className={STUDIO_BTN_PRIMARY}
              >
                {createMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create set
              </button>
            </div>
          </form>

          {/* Error */}
          {error && <div className={STUDIO_ERROR_BANNER}>{normalizeApiError(error).message}</div>}

          {/* Sets */}
          {isLoading ? (
            <StudioSpinner size="lg" center />
          ) : sets.length === 0 ? (
            <div className={STUDIO_CARD}>
              <StudioEmptyState
                icon={Layers}
                title="No sets in this section yet"
                body={`Create a set above, or import a CSV to seed several at once. A set targets ${VOCAB_SET_TARGET_WORDS} words.`}
              />
            </div>
          ) : (
            <div className={STUDIO_CARD}>
              <div className="border-b border-border px-5 py-4 font-bold text-foreground">
                {sets.length} set{sets.length === 1 ? "" : "s"}
              </div>
              <div className="divide-y divide-border">
                {sets.map((set) => {
                  const isEditing = editingId === set.id;
                  const isBusy = busyId === set.id;
                  return (
                    <div
                      key={set.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface-2/50"
                    >
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              submitRename(set);
                            }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input
                              autoFocus
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className={cn(STUDIO_INPUT, "max-w-xs")}
                            />
                            <button
                              type="submit"
                              disabled={!editTitle.trim() || isBusy}
                              className={STUDIO_BTN_PRIMARY}
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
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
                            <p className="truncate font-extrabold text-foreground">
                              #{set.id} · {set.title}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              <WordCountMeter count={set.word_count} />
                            </p>
                          </>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(set.id);
                              setEditTitle(set.title);
                            }}
                            title="Rename set"
                            aria-label={`Rename set ${set.title}`}
                            className="inline-flex items-center rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <Link
                            href={`/builder/vocabulary/${sectionId}/${set.id}`}
                            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-surface-2"
                          >
                            Open words
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setPendingDelete(set);
                            }}
                            title="Delete set"
                            aria-label={`Delete set ${set.title}`}
                            className="inline-flex items-center rounded-xl border border-border p-1.5 text-muted-foreground transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Section CSV import */}
      {csvOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !importMut.isPending && setCsvOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Import words into this section</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  One word per row. Rows sharing a <code className="font-mono">set</code> value land
                  in the same set.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !importMut.isPending && setCsvOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-surface-2"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border bg-surface-2/60 px-3 py-2">
                <p className={STUDIO_FIELD_LABEL}>Columns</p>
                <code className="block font-mono text-[11px] leading-relaxed text-foreground">
                  {VOCAB_CSV_COLUMNS}
                </code>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-bold">word</span> and{" "}
                  <span className="font-bold">definition</span> are required. A numeric{" "}
                  <span className="font-bold">set</span> becomes “Set 3”; any other value is used as
                  the title, and an existing set with that title is appended to. Separate{" "}
                  <span className="font-bold">synonyms</span> with semicolons. The whole file is
                  rejected if any row is invalid.
                </p>
              </div>

              <div>
                <label className={STUDIO_FIELD_LABEL} htmlFor="vocab-section-csv">
                  CSV file
                </label>
                <input
                  id="vocab-section-csv"
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={importMut.isPending}
                  onChange={(e) => void handleCsvFile(e.target.files?.[0] ?? null)}
                  className="w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-bold file:text-primary disabled:opacity-50"
                />
              </div>

              {importMut.isPending && (
                <p className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Importing…
                </p>
              )}

              {csvMsg && (
                <div
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-semibold",
                    csvMsg.ok
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-700",
                  )}
                >
                  {csvMsg.text}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setCsvOpen(false)}
                disabled={importMut.isPending}
                className={STUDIO_BTN_SECONDARY}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        tone="danger"
        title="Delete vocabulary set?"
        description={
          pendingDelete
            ? `“${pendingDelete.title}” will be removed from this section. Its words stay in the section bank.`
            : undefined
        }
        confirmLabel="Delete set"
        loading={deleteMut.isPending}
        onConfirm={runDelete}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      >
        {deleteError ? <div className={STUDIO_ERROR_BANNER}>{deleteError}</div> : null}
      </ConfirmDialog>
    </div>
  );
}
