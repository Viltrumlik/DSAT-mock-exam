"use client";

/**
 * /builder/vocabulary/[sectionId]/[setId] — the word editor for one set.
 *
 * Bottom of the drill-down. Words created here are minted in the set's section
 * and appended to the set, so the same headword can be reused by another set in
 * the section without being duplicated.
 *
 * In the console's look (design handoff v0.3, PR 19). The words and the calls are the page's own.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ToastProvider";
import { LibraryError } from "@/features/builderLibrary/sectionParts";
import { Badge, Button, ConfirmDialog, EmptyState, buttonClass } from "@/features/console/ui";
import { CONTROL, FIELD_LABEL, HINT, SERIF_AREA } from "@/features/questionsAdmin/questionLook";
import { csvImportErrorText } from "@/features/vocabularyAdmin/api";
import { CsvImportDialog, VocabCrumbs } from "@/features/vocabularyAdmin/builderParts";
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
  const id = useId();
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
      className="animate-ms-fade-in flex flex-col gap-3 border-t border-ms-line bg-ms-primary-soft/40 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSave(form);
      }}
    >
      {error ? <LibraryError>{error}</LibraryError> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-word`} className={FIELD_LABEL}>
            Word <span className="text-ms-critical-fg">*</span>
          </label>
          <input
            id={`${id}-word`}
            ref={wordRef}
            value={form.word}
            onChange={set("word")}
            required
            placeholder="e.g. ephemeral"
            className={CONTROL}
          />
        </div>
        <div>
          <label htmlFor={`${id}-part`} className={FIELD_LABEL}>
            Part of speech
          </label>
          <select
            id={`${id}-part`}
            value={form.part_of_speech}
            onChange={(e) => setForm((prev) => ({ ...prev, part_of_speech: asPartOfSpeech(e.target.value) }))}
            className={CONTROL}
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
        <label htmlFor={`${id}-definition`} className={FIELD_LABEL}>
          Definition <span className="text-ms-critical-fg">*</span>
        </label>
        <div className="font-ms-serif">
          <textarea
            id={`${id}-definition`}
            value={form.definition}
            onChange={set("definition")}
            required
            rows={2}
            placeholder="Lasting for a very short time"
            className={cn(SERIF_AREA, "text-[15px] leading-6")}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-example`} className={FIELD_LABEL}>
          Example sentence
        </label>
        <div className="font-ms-serif">
          <textarea
            id={`${id}-example`}
            value={form.example}
            onChange={set("example")}
            rows={2}
            placeholder="The morning dew is ephemeral, vanishing with the sunrise."
            className={cn(SERIF_AREA, "text-[15px] italic leading-6")}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-synonyms`} className={FIELD_LABEL}>
          Synonyms
        </label>
        <input
          id={`${id}-synonyms`}
          value={form.synonyms}
          onChange={set("synonyms")}
          placeholder="fleeting; transient; momentary"
          className={CONTROL}
        />
        <p className={HINT}>Separate with semicolons.</p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          icon="check"
          state={saving ? "busy" : "idle"}
          busyLabel="Saving…"
          disabled={saving || !canSubmit}
        >
          Save
        </Button>
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

  // The word being deleted outlives the dialog, so its words stay while the dialog leaves.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AdminVocabWord | null>(null);

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

  const runDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    try {
      await deleteMut.mutateAsync(target.id);
    } catch (e) {
      throw new Error(normalizeApiError(e).message || "Could not delete this word.");
    }
    setExpandedId((prev) => (prev === target.id ? null : prev));
    toast.push({ tone: "success", message: "Word deleted." });
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
  const left = VOCAB_SET_TARGET_WORDS - count;
  const pct = Math.min(100, Math.round((count / VOCAB_SET_TARGET_WORDS) * 100));
  const notFound = !setsLoading && !vocabSet;

  return (
    <div className="flex flex-col gap-5">
      <VocabCrumbs
        items={[
          { label: "Vocabulary", href: "/builder/vocabulary" },
          { label: section?.title ?? `Section #${sectionId}`, href: `/builder/vocabulary/${sectionId}` },
          { label: vocabSet?.title ?? `Set #${setId}` },
        ]}
      />

      {notFound ? (
        <div className="rounded-ms-card bg-ms-card p-4 shadow-ms-1">
          <EmptyState
            icon="book"
            title="Set not found"
            detail="It may have been deleted. Go back to the section to pick another set."
            action={
              <Link href={`/builder/vocabulary/${sectionId}`} className={buttonClass({ variant: "secondary" })}>
                <Icon name="left" size="sm" />
                Back to sets
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Header */}
          <header className="animate-ms-fade-in flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 basis-[18rem]">
              <h1 className="break-words font-ms-display text-ms-b-display text-ms-fg">{vocabSet?.title ?? "Set"}</h1>
              <p className="mt-1 text-[14px] text-ms-fg-2">
                {section?.title ? `${section.title} · ` : ""}Words a student studies in all four modes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                icon="refresh"
                state={isFetching ? "busy" : "idle"}
                disabled={isFetching}
                onClick={() => void refetch()}
              >
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
              <Button
                variant="primary"
                icon="plus"
                disabled={addingNew}
                onClick={() => {
                  setSaveError(null);
                  setExpandedId(null);
                  setAddingNew(true);
                }}
              >
                Add word
              </Button>
            </div>
          </header>

          {/* Target progress — guidance, never a gate */}
          <div className="animate-ms-card-in rounded-ms-card bg-ms-card p-4 shadow-ms-1 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[15px] font-semibold text-ms-fg">
                <span className={cn("tabular-nums", over && "text-ms-attention-fg")}>
                  {count} / {VOCAB_SET_TARGET_WORDS}
                </span>{" "}
                words
              </p>
              {over ? (
                <p className="text-[13px] font-medium text-ms-attention-fg">
                  {count - VOCAB_SET_TARGET_WORDS} over the {VOCAB_SET_TARGET_WORDS}-word target — fine to keep, but the
                  study modes are tuned for {VOCAB_SET_TARGET_WORDS}.
                </p>
              ) : (
                <p className={cn("text-[13px]", left === 0 ? "font-medium text-ms-positive-fg" : "text-ms-fg-2")}>
                  {left === 0 ? "Target reached." : `${left} to go.`}
                </p>
              )}
            </div>
            <div aria-hidden="true" className="mt-2.5 h-2 overflow-hidden rounded-full bg-ms-surface-3">
              <div
                className={cn(
                  "ms-transition h-full rounded-full",
                  over ? "bg-ms-attention" : left === 0 ? "bg-ms-positive" : "bg-ms-primary",
                )}
                style={{ width: `${over ? 100 : pct}%` }}
              />
            </div>
          </div>

          {/* Error */}
          {error ? <LibraryError>{normalizeApiError(error).message}</LibraryError> : null}

          {/* Words */}
          {isLoading ? (
            <div aria-busy="true" aria-label="Loading" className="h-[280px] animate-ms-shimmer rounded-ms-card bg-ms-surface-2" />
          ) : (
            <section aria-label="Words" className="animate-ms-fade-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1">
              <div className="border-b border-ms-line px-5 py-3.5 text-[15px] font-semibold text-ms-fg">
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
                <div className="p-4">
                  <EmptyState
                    icon="book"
                    title="No words in this set yet"
                    detail={`Add them one at a time, or import a CSV. A set targets ${VOCAB_SET_TARGET_WORDS} words.`}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-ms-line">
                  {words.map((word) => {
                    const isExpanded = expandedId === word.id;
                    return (
                      <li key={word.id} data-word={word.id}>
                        <div
                          className={cn(
                            "ms-transition flex items-start gap-4 px-5 py-4",
                            isExpanded ? "bg-ms-primary-soft/40" : "hover:bg-ms-surface",
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="break-words font-ms-serif text-[17px] font-semibold leading-6 text-ms-fg">
                                {word.word}
                              </p>
                              <Badge tone="neutral">{VOCAB_PART_LABEL[asPartOfSpeech(word.part_of_speech)]}</Badge>
                            </div>
                            {!isExpanded && (
                              <>
                                <p className="mt-1 font-ms-serif text-[15px] leading-6 text-ms-fg">{word.definition || "—"}</p>
                                {word.example ? (
                                  <p className="mt-1 font-ms-serif text-[14px] italic leading-[22px] text-ms-fg-2">
                                    &ldquo;{word.example}&rdquo;
                                  </p>
                                ) : null}
                                {word.synonyms?.length > 0 ? (
                                  <p className="mt-1 text-[13px] text-ms-fg-3">Synonyms: {formatSynonyms(word.synonyms)}</p>
                                ) : null}
                              </>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant={isExpanded ? "secondary" : "ghost"}
                              size="sm"
                              icon={isExpanded ? "up" : "pencil"}
                              aria-label={isExpanded ? `Collapse ${word.word}` : `Edit ${word.word}`}
                              aria-expanded={isExpanded}
                              onClick={() => {
                                setSaveError(null);
                                setAddingNew(false);
                                setExpandedId((prev) => (prev === word.id ? null : word.id));
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              icon="trash"
                              aria-label={`Delete ${word.word}`}
                              onClick={() => {
                                setPendingDelete(word);
                                setDeleteOpen(true);
                              }}
                            />
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
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {/* Set CSV import */}
      <CsvImportDialog
        open={csvOpen}
        onClose={() => setCsvOpen(false)}
        title="Import words into this set"
        intro={<>One word per row — every row lands in “{vocabSet?.title ?? `Set #${setId}`}”.</>}
        help={
          <>
            <span className="font-semibold text-ms-fg">word</span> and{" "}
            <span className="font-semibold text-ms-fg">definition</span> are required. A{" "}
            <span className="font-semibold text-ms-fg">set</span> column is ignored here — import from the section to
            split rows across sets. Separate <span className="font-semibold text-ms-fg">synonyms</span> with semicolons.
            The whole file is rejected if any row is invalid.
          </>
        }
        inputId="vocab-set-csv"
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
        title="Delete word?"
        confirmLabel="Delete word"
        busyLabel="Deleting…"
        onConfirm={runDelete}
      >
        {pendingDelete ? `“${pendingDelete.word}” is removed from the section bank and from every set that uses it.` : null}
      </ConfirmDialog>
    </div>
  );
}
