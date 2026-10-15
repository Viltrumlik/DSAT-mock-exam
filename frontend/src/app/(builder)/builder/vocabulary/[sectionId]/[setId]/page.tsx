"use client";

/**
 * /builder/vocabulary/[sectionId]/[setId] — the word editor for one set.
 *
 * Bottom of the drill-down. Words created here are minted in the set's section
 * and appended to the set, so the same headword can be reused by another set in
 * the section without being duplicated.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { StudioEmptyState } from "@/components/studio/StudioEmptyState";
import { StudioSpinner } from "@/components/studio/StudioSpinner";
import {
  STUDIO_BOX_CAPTION,
  STUDIO_BTN_PRIMARY,
  STUDIO_BTN_SECONDARY,
  STUDIO_CARD,
  STUDIO_ERROR_BANNER,
  STUDIO_FIELD_LABEL,
  STUDIO_ICON_BTN_DANGER,
  STUDIO_INPUT,
  STUDIO_LINK,
  STUDIO_OK_BANNER,
  STUDIO_PAGE_DESC,
  STUDIO_PAGE_TITLE,
  STUDIO_SECTION_GAP,
} from "@/components/studio/primitives";
import { useToast } from "@/components/ToastProvider";
import { ConfirmDialog } from "@/features/classroom/ui";
import { csvImportErrorText } from "@/features/vocabularyAdmin/api";
import {
  useAdminSections,
  useAdminSets,
  useAdminWords,
  useCreateWord,
  useDeleteWord,
  useImportSetCsv,
  useUpdateWord,
} from "@/features/vocabularyAdmin/hooks";
import {
  asPartOfSpeech,
  formatSynonyms,
  parseSynonyms,
  VOCAB_CSV_COLUMNS,
  VOCAB_PART_LABEL,
  VOCAB_PARTS_OF_SPEECH,
  VOCAB_SET_TARGET_WORDS,
  type AdminVocabWord,
  type VocabPartOfSpeech,
  type WordCreatePayload,
} from "@/features/vocabularyAdmin/types";
import { normalizeApiError } from "@/lib/apiError";
import { cn } from "@/lib/cn";



type WordForm = {
  word: string;
  definition: string;
  part_of_speech: VocabPartOfSpeech;
  example: string;
  /** Semicolon-separated in the editor; split into the JSON list on save. */
  synonyms: string;
};

const EMPTY_FORM: WordForm = {
  word: "",
  definition: "",
  part_of_speech: "other",
  example: "",
  synonyms: "",
};

function toPayload(form: WordForm): WordCreatePayload {
  return {
    word: form.word.trim(),
    definition: form.definition.trim(),
    part_of_speech: form.part_of_speech,
    example: form.example.trim(),
    synonyms: parseSynonyms(form.synonyms),
  };
}

// ─── Inline word form ─────────────────────────────────────────────────────────

function WordInlineForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: WordForm;
  onSave: (form: WordForm) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<WordForm>(initial);
  const wordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    wordRef.current?.focus();
  }, []);

  const set =
    (key: keyof WordForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const canSubmit = form.word.trim().length > 0 && form.definition.trim().length > 0;

  return (
    <form
      className="space-y-3 border-t border-border bg-surface-2/50 px-3 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSave(form);
      }}
    >
      {error && <div className={STUDIO_ERROR_BANNER}>{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={STUDIO_FIELD_LABEL}>
            Word <span className="text-red-500">*</span>
          </label>
          <input
            ref={wordRef}
            value={form.word}
            onChange={set("word")}
            required
            placeholder="e.g. ephemeral"
            className={STUDIO_INPUT}
          />
        </div>
        <div>
          <label className={STUDIO_FIELD_LABEL}>Part of speech</label>
          <select
            value={form.part_of_speech}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, part_of_speech: asPartOfSpeech(e.target.value) }))
            }
            className={STUDIO_INPUT}
          >
            {VOCAB_PARTS_OF_SPEECH.map((p) => (
              <option key={p} value={p}>
                {VOCAB_PART_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={STUDIO_FIELD_LABEL}>
          Definition <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.definition}
          onChange={set("definition")}
          required
          rows={2}
          placeholder="Lasting for a very short time"
          className={cn(STUDIO_INPUT, "resize-none")}
        />
      </div>

      <div>
        <label className={STUDIO_FIELD_LABEL}>Example sentence</label>
        <textarea
          value={form.example}
          onChange={set("example")}
          rows={2}
          placeholder="The morning dew is ephemeral, vanishing with the sunrise."
          className={cn(STUDIO_INPUT, "resize-none")}
        />
      </div>

      <div>
        <label className={STUDIO_FIELD_LABEL}>Synonyms</label>
        <input
          value={form.synonyms}
          onChange={set("synonyms")}
          placeholder="fleeting; transient; momentary"
          className={STUDIO_INPUT}
        />
        <p className="mt-1 text-[12px] text-muted-foreground">Separate with semicolons.</p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={STUDIO_BTN_SECONDARY}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !canSubmit} className={STUDIO_BTN_PRIMARY}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderVocabularySetPage() {
  const params = useParams<{ sectionId: string; setId: string }>();
  const sectionId = Number(params.sectionId);
  const setId = Number(params.setId);
  const toast = useToast();

  const { data: sections } = useAdminSections();
  const section = useMemo(
    () => (sections ?? []).find((s) => s.id === sectionId) ?? null,
    [sections, sectionId],
  );

  const { data: sets, isLoading: setsLoading } = useAdminSets(sectionId);
  const vocabSet = useMemo(() => (sets ?? []).find((s) => s.id === setId) ?? null, [sets, setId]);

  const { data, isLoading, error, refetch, isFetching } = useAdminWords(setId);
  const words = data ?? [];

  const [addingNew, setAddingNew] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<AdminVocabWord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [csvOpen, setCsvOpen] = useState(false);
  const [csvMsg, setCsvMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const createMut = useCreateWord(sectionId, setId);
  const updateMut = useUpdateWord(sectionId, setId);
  const deleteMut = useDeleteWord(sectionId, setId);
  const importMut = useImportSetCsv(sectionId, setId);

  const handleCreate = (form: WordForm) => {
    setSaveError(null);
    createMut.mutate(toPayload(form), {
      onSuccess: (created) => {
        setAddingNew(false);
        toast.push({ tone: "success", message: `“${created.word}” added.` });
      },
      onError: (e) => setSaveError(normalizeApiError(e).message || "Could not save the word."),
    });
  };

  const handleUpdate = (wordId: number, form: WordForm) => {
    setSaveError(null);
    updateMut.mutate(
      { wordId, patch: toPayload(form) },
      {
        onSuccess: () => {
          setExpandedId(null);
          toast.push({ tone: "success", message: "Word updated." });
        },
        onError: (e) => setSaveError(normalizeApiError(e).message || "Could not save the word."),
      },
    );
  };

  const runDelete = () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    deleteMut.mutate(pendingDelete.id, {
      onSuccess: () => {
        if (expandedId === pendingDelete.id) setExpandedId(null);
        setPendingDelete(null);
        toast.push({ tone: "success", message: "Word deleted." });
      },
      onError: (e) => setDeleteError(normalizeApiError(e).message || "Could not delete this word."),
    });
  };

  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    setCsvMsg(null);
    try {
      const res = await importMut.mutateAsync(file);
      setCsvMsg({
        ok: true,
        // "Imported 25" used to count reused words as newly authored ones.
        text: `Imported ${res.created_words} new word${res.created_words === 1 ? "" : "s"} into this set${
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

  const count = words.length;
  const over = count > VOCAB_SET_TARGET_WORDS;
  const pct = Math.min(100, Math.round((count / VOCAB_SET_TARGET_WORDS) * 100));
  const notFound = !setsLoading && !vocabSet;

  return (
    <div className={STUDIO_SECTION_GAP}>
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1.5 text-[13px]">
        <Link
          href="/builder/vocabulary"
          className={`${STUDIO_LINK} inline-flex items-center gap-1`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Vocabulary
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <Link
          href={`/builder/vocabulary/${sectionId}`}
          className={STUDIO_LINK}
        >
          {section?.title ?? `Section #${sectionId}`}
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-foreground">
          {vocabSet?.title ?? `Set #${setId}`}
        </span>
      </nav>

      {notFound ? (
        <div className={STUDIO_CARD}>
          <StudioEmptyState
            icon={BookMarked}
            title="Set not found"
            body="It may have been deleted. Go back to the section to pick another set."
            action={
              <Link href={`/builder/vocabulary/${sectionId}`} className={STUDIO_BTN_SECONDARY}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sets
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className={STUDIO_PAGE_TITLE}>
                {vocabSet?.title ?? "Set"}
              </h1>
              <p className={STUDIO_PAGE_DESC}>
                {section?.title ? `${section.title} · ` : ""}Words a student studies in all four
                modes.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching}
                className={STUDIO_BTN_SECONDARY}
              >
                <RefreshCcw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
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
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setSaveError(null);
                  setExpandedId(null);
                  setAddingNew(true);
                }}
                disabled={addingNew}
                className={STUDIO_BTN_PRIMARY}
              >
                <Plus className="h-3.5 w-3.5" />
                Add word
              </button>
            </div>
          </div>

          {/* Target progress — guidance, never a gate */}
          <div className={`${STUDIO_CARD} px-3 py-2.5`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-foreground">
                <span className="tabular-nums">
                  {count} / {VOCAB_SET_TARGET_WORDS}
                </span>{" "}
                words
              </p>
              {over ? (
                <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400">
                  {count - VOCAB_SET_TARGET_WORDS} over the {VOCAB_SET_TARGET_WORDS}-word target —
                  fine to keep, but the study modes are tuned for {VOCAB_SET_TARGET_WORDS}.
                </p>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {VOCAB_SET_TARGET_WORDS - count === 0
                    ? "Target reached."
                    : `${VOCAB_SET_TARGET_WORDS - count} to go.`}
                </p>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-surface-2">
              <div
                className={cn("h-full rounded-sm transition-all", over ? "bg-amber-500" : "bg-primary")}
                style={{ width: `${over ? 100 : pct}%` }}
              />
            </div>
          </div>

          {/* Error */}
          {error && <div className={STUDIO_ERROR_BANNER}>{normalizeApiError(error).message}</div>}

          {/* Words */}
          {isLoading ? (
            <StudioSpinner size="lg" center />
          ) : (
            <div className={STUDIO_CARD}>
              <div className={STUDIO_BOX_CAPTION}>
                {count} word{count === 1 ? "" : "s"}
              </div>

              {addingNew && (
                <WordInlineForm
                  initial={EMPTY_FORM}
                  onSave={handleCreate}
                  onCancel={() => {
                    setAddingNew(false);
                    setSaveError(null);
                  }}
                  saving={createMut.isPending}
                  error={createMut.isPending ? null : saveError}
                />
              )}

              {count === 0 && !addingNew ? (
                <StudioEmptyState
                  icon={BookMarked}
                  title="No words in this set yet"
                  body={`Add them one at a time, or import a CSV. A set targets ${VOCAB_SET_TARGET_WORDS} words.`}
                />
              ) : (
                <div className="divide-y divide-border">
                  {words.map((word) => {
                    const isExpanded = expandedId === word.id;
                    return (
                      <div key={word.id}>
                        <div
                          className={cn(
                            "flex items-start gap-3 px-3 py-2 transition-colors",
                            isExpanded ? "bg-surface-2/50" : "hover:bg-surface-2",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[13px] font-semibold text-foreground">{word.word}</p>
                              <span className="rounded-md border border-border px-1.5 py-px text-[11px] text-muted-foreground">
                                {VOCAB_PART_LABEL[asPartOfSpeech(word.part_of_speech)]}
                              </span>
                            </div>
                            {!isExpanded && (
                              <>
                                <p className="mt-0.5 text-[13px] text-foreground/80">
                                  {word.definition || "—"}
                                </p>
                                {word.example && (
                                  <p className="mt-0.5 text-[12px] italic text-muted-foreground">
                                    &ldquo;{word.example}&rdquo;
                                  </p>
                                )}
                                {word.synonyms?.length > 0 && (
                                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                                    Synonyms: {formatSynonyms(word.synonyms)}
                                  </p>
                                )}
                              </>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSaveError(null);
                                setAddingNew(false);
                                setExpandedId((prev) => (prev === word.id ? null : word.id));
                              }}
                              title={isExpanded ? "Collapse" : "Edit word"}
                              aria-label={isExpanded ? `Collapse ${word.word}` : `Edit ${word.word}`}
                              className={cn(
                                "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                isExpanded
                                  ? "border-primary/30 bg-primary/10 text-primary dark:text-primary-hover"
                                  : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                              )}
                            >
                              {isExpanded ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null);
                                setPendingDelete(word);
                              }}
                              title="Delete word"
                              aria-label={`Delete ${word.word}`}
                              className={STUDIO_ICON_BTN_DANGER}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <WordInlineForm
                            initial={{
                              word: word.word,
                              definition: word.definition,
                              part_of_speech: asPartOfSpeech(word.part_of_speech),
                              example: word.example ?? "",
                              synonyms: formatSynonyms(word.synonyms),
                            }}
                            onSave={(form) => handleUpdate(word.id, form)}
                            onCancel={() => {
                              setExpandedId(null);
                              setSaveError(null);
                            }}
                            saving={updateMut.isPending}
                            error={updateMut.isPending ? null : saveError}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Set CSV import */}
      {csvOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4"
          onClick={() => !importMut.isPending && setCsvOpen(false)}
        >
          <div
            className="w-full max-w-md border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-2.5">
              <div>
                <h2 className="text-[14px] font-semibold text-foreground">Import words into this set</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  One word per row — every row lands in “{vocabSet?.title ?? `Set #${setId}`}”.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !importMut.isPending && setCsvOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3">
              <div className="border border-border bg-surface-2/60 px-3 py-2">
                <p className={STUDIO_FIELD_LABEL}>Columns</p>
                <code className="block font-mono text-[11px] leading-relaxed text-foreground">
                  {VOCAB_CSV_COLUMNS}
                </code>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">word</span> and{" "}
                  <span className="font-medium text-foreground">definition</span> are required. A{" "}
                  <span className="font-medium text-foreground">set</span> column is ignored here — import from the
                  section to split rows across sets. Separate{" "}
                  <span className="font-medium text-foreground">synonyms</span> with semicolons. The whole file is
                  rejected if any row is invalid.
                </p>
              </div>

              <div>
                <label className={STUDIO_FIELD_LABEL} htmlFor="vocab-set-csv">
                  CSV file
                </label>
                <input
                  id="vocab-set-csv"
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={importMut.isPending}
                  onChange={(e) => void handleCsvFile(e.target.files?.[0] ?? null)}
                  className="w-full rounded-md text-[13px] file:mr-3 file:h-8 file:rounded-md file:border file:border-border file:bg-card file:px-2.5 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                />
              </div>

              {importMut.isPending && (
                <p className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Importing…
                </p>
              )}

              {csvMsg && (
                <div className={csvMsg.ok ? STUDIO_OK_BANNER : STUDIO_ERROR_BANNER}>
                  {csvMsg.text}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-border px-4 py-2.5">
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
        title="Delete word?"
        description={
          pendingDelete
            ? `“${pendingDelete.word}” is removed from the section bank and from every set that uses it.`
            : undefined
        }
        confirmLabel="Delete word"
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
