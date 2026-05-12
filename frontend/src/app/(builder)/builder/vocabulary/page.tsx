"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { vocabularyApi } from "@/lib/api";
import {
  BookMarked,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { STUDIO_FIELD_LABEL, STUDIO_INPUT } from "@/components/studio/primitives";

// ─── Types ────────────────────────────────────────────────────────────────────

type VocabWord = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
  created_at: string;
};

type WordForm = {
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: string;
};

const EMPTY_FORM: WordForm = {
  word: "",
  meaning: "",
  example: "",
  part_of_speech: "noun",
  difficulty: "2",
};

/** SAT-relevant part-of-speech options (simplified from 9 → 4). */
const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb"] as const;

const DIFFICULTY_LABELS: Record<number, string> = { 1: "Easy", 2: "Medium", 3: "Hard" };

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function difficultyClass(d: number): string {
  if (d === 1) return "bg-emerald-100 text-emerald-800";
  if (d === 3) return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

const FIELD_LABEL = STUDIO_FIELD_LABEL;
const INPUT = STUDIO_INPUT;

// ─── Inline word form ─────────────────────────────────────────────────────────

function WordInlineForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial: WordForm;
  onSave: (f: WordForm) => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<WordForm>(initial);
  const wordRef = useRef<HTMLInputElement>(null);

  // Auto-focus word field
  useEffect(() => { wordRef.current?.focus(); }, []);

  const set =
    (k: keyof WordForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const canSubmit = form.word.trim().length > 0 && form.meaning.trim().length > 0;

  return (
    <form
      className="space-y-3 px-5 py-4 bg-primary/3 border-t border-primary/10"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSave(form);
      }}
    >
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={FIELD_LABEL}>
            Word <span className="text-red-500">*</span>
          </label>
          <input
            ref={wordRef}
            value={form.word}
            onChange={set("word")}
            required
            placeholder="e.g. ephemeral"
            className={INPUT}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={FIELD_LABEL}>Part of speech</label>
            <select value={form.part_of_speech} onChange={set("part_of_speech")} className={INPUT}>
              {PARTS_OF_SPEECH.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={FIELD_LABEL}>Difficulty</label>
            <select value={form.difficulty} onChange={set("difficulty")} className={INPUT}>
              <option value="1">Easy</option>
              <option value="2">Medium</option>
              <option value="3">Hard</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL}>
          Meaning <span className="text-red-500">*</span>
        </label>
        <textarea
          value={form.meaning}
          onChange={set("meaning")}
          required
          rows={2}
          placeholder="Lasting for a very short time"
          className={cn(INPUT, "resize-none")}
        />
      </div>

      <div>
        <label className={FIELD_LABEL}>Example sentence</label>
        <textarea
          value={form.example}
          onChange={set("example")}
          rows={2}
          placeholder="The morning dew is ephemeral, vanishing with the sunrise."
          className={cn(INPUT, "resize-none")}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BuilderVocabularyPage() {
  const [words, setWords] = useState<VocabWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Inline editor state
  const [expandedId, setExpandedId] = useState<number | null>(null); // row being edited
  const [addingNew, setAddingNew] = useState(false);                  // new-word form visible

  // Per-action feedback
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await vocabularyApi.adminListWords();
      setWords(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return words;
    return words.filter(
      (w) =>
        w.word.toLowerCase().includes(term) ||
        w.meaning.toLowerCase().includes(term) ||
        w.part_of_speech.toLowerCase().includes(term),
    );
  }, [words, q]);

  const handleCreate = async (form: WordForm) => {
    setSavingId("new");
    setSaveError(null);
    try {
      const payload = {
        word: form.word.trim(),
        meaning: form.meaning.trim(),
        example: form.example.trim(),
        part_of_speech: form.part_of_speech,
        difficulty: Number(form.difficulty),
      };
      const created = await vocabularyApi.adminCreateWord(payload) as VocabWord;
      // Optimistic prepend then sync
      setWords((prev) => [created, ...prev]);
      setAddingNew(false);
    } catch (e) {
      setSaveError(parseError(e));
    } finally {
      setSavingId(null);
    }
  };

  const handleUpdate = async (id: number, form: WordForm) => {
    setSavingId(id);
    setSaveError(null);
    try {
      const payload = {
        word: form.word.trim(),
        meaning: form.meaning.trim(),
        example: form.example.trim(),
        part_of_speech: form.part_of_speech,
        difficulty: Number(form.difficulty),
      };
      const updated = await vocabularyApi.adminUpdateWord(id, payload) as VocabWord;
      // Optimistic update
      setWords((prev) => prev.map((w) => (w.id === id ? updated : w)));
      setExpandedId(null);
    } catch (e) {
      setSaveError(parseError(e));
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await vocabularyApi.adminDeleteWord(id);
      setWords((prev) => prev.filter((w) => w.id !== id));
      setConfirmDeleteId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (e) {
      setError(parseError(e));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleExpand = (id: number) => {
    setSaveError(null);
    setExpandedId((prev) => (prev === id ? null : id));
    setAddingNew(false);
  };

  const openAddNew = () => {
    setSaveError(null);
    setAddingNew(true);
    setExpandedId(null);
    // scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Vocabulary</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SAT vocabulary bank. Words appear in students&apos; daily spaced-repetition sessions and
            the word list browser.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground hover:bg-surface-2 disabled:opacity-50 transition-colors"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openAddNew}
            disabled={addingNew}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add word
          </button>
        </div>
      </div>

      {/* Global error banner */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* Stats + search */}
      {!loading && words.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <BookMarked className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-foreground">{words.length} words</span>
          </div>
          <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-border bg-surface-2/60 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by word, meaning, or part of speech…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {q && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : words.length === 0 && !addingNew ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
            <BookMarked className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-extrabold text-foreground">No vocabulary words yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the first word to start building the SAT vocabulary bank.
          </p>
          <button
            type="button"
            onClick={openAddNew}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add word
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-3 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {q ? `${filtered.length} of ${words.length} words` : `${words.length} words`}
            </p>
          </div>

          {/* Inline "add new" form at top of list */}
          {addingNew && (
            <WordInlineForm
              initial={EMPTY_FORM}
              onSave={(f) => void handleCreate(f)}
              onCancel={() => { setAddingNew(false); setSaveError(null); }}
              saving={savingId === "new"}
              error={savingId === "new" ? saveError : null}
            />
          )}

          {filtered.length === 0 && !addingNew ? (
            <div className="p-8 text-center">
              <p className="font-semibold text-foreground">No words match &ldquo;{q}&rdquo;</p>
              <button
                type="button"
                onClick={() => setQ("")}
                className="mt-3 text-sm font-semibold text-primary hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((word) => {
                const isExpanded = expandedId === word.id;
                return (
                  <div key={word.id}>
                    {/* Row summary */}
                    <div
                      className={cn(
                        "flex items-start gap-4 px-5 py-4 transition-colors",
                        isExpanded ? "bg-primary/3" : "hover:bg-surface-2/40",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-extrabold text-foreground">{word.word}</p>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${difficultyClass(word.difficulty)}`}
                          >
                            {DIFFICULTY_LABELS[word.difficulty] ?? word.difficulty}
                          </span>
                          <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {word.part_of_speech}
                          </span>
                        </div>
                        {!isExpanded && (
                          <>
                            <p className="mt-1 text-sm text-foreground/80">{word.meaning || "—"}</p>
                            {word.example && (
                              <p className="mt-1 text-xs text-muted-foreground italic">
                                &ldquo;{word.example}&rdquo;
                              </p>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* Expand / collapse edit */}
                        <button
                          type="button"
                          onClick={() => toggleExpand(word.id)}
                          className={cn(
                            "rounded-lg border p-1.5 transition-colors",
                            isExpanded
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                          )}
                          title={isExpanded ? "Collapse" : "Edit word"}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>

                        {/* Delete */}
                        {confirmDeleteId === word.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void handleDelete(word.id)}
                              disabled={deletingId === word.id}
                              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                              {deletingId === word.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Delete"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-bold text-foreground hover:bg-surface-2"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(word.id)}
                            className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 transition-colors"
                            title="Delete word"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline editor */}
                    {isExpanded && (
                      <WordInlineForm
                        initial={{
                          word: word.word,
                          meaning: word.meaning,
                          example: word.example,
                          part_of_speech: word.part_of_speech,
                          difficulty: String(word.difficulty),
                        }}
                        onSave={(f) => void handleUpdate(word.id, f)}
                        onCancel={() => { setExpandedId(null); setSaveError(null); }}
                        saving={savingId === word.id}
                        error={savingId === word.id ? saveError : null}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
