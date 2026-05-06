"use client";

import { useCallback, useEffect, useState } from "react";
import { vocabularyApi } from "@/lib/api";
import { useToast } from "@/components/ToastProvider";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

type WordRow = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
  created_at?: string;
};

export default function VocabularyAdminPage() {
  const { push } = useToast();
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<WordRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    word: "",
    meaning: "",
    example: "",
    part_of_speech: "",
    difficulty: "3",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<WordRow>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await vocabularyApi.adminListWords();
      const arr = Array.isArray(data) ? data : [];
      setWords(arr as WordRow[]);
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      push({ tone: "error", message: typeof d === "string" ? d : "Could not load words." });
      setWords([]);
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const word = form.word.trim();
    if (!word) {
      push({ tone: "error", message: "Word is required." });
      return;
    }
    setCreating(true);
    try {
      await vocabularyApi.adminCreateWord({
        word,
        meaning: form.meaning.trim() || undefined,
        example: form.example.trim() || undefined,
        part_of_speech: form.part_of_speech.trim() || undefined,
        difficulty: Number(form.difficulty) || 3,
      });
      push({ tone: "success", message: "Word created." });
      setForm({ word: "", meaning: "", example: "", part_of_speech: "", difficulty: "3" });
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      push({
        tone: "error",
        message: typeof d === "string" ? d : "Could not create word.",
      });
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async (id: number) => {
    try {
      await vocabularyApi.adminUpdateWord(id, {
        word: editDraft.word?.trim(),
        meaning: editDraft.meaning,
        example: editDraft.example,
        part_of_speech: editDraft.part_of_speech,
        difficulty: editDraft.difficulty,
      });
      push({ tone: "success", message: "Saved." });
      setEditingId(null);
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      push({
        tone: "error",
        message: typeof d === "string" ? d : "Could not save.",
      });
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm("Delete this word?")) return;
    try {
      await vocabularyApi.adminDeleteWord(id);
      push({ tone: "success", message: "Deleted." });
      await load();
    } catch (e: unknown) {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      push({
        tone: "error",
        message: typeof d === "string" ? d : "Could not delete.",
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ds-gold">Vocabulary admin</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">Words</h1>
        <p className="mt-2 text-sm text-muted-foreground">Create and maintain words used in Daily practice and search.</p>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-extrabold uppercase tracking-wider text-muted-foreground">Add word</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm font-semibold text-foreground">
            Word *
            <input
              value={form.word}
              onChange={(e) => setForm((f) => ({ ...f, word: e.target.value }))}
              className="ui-input mt-1 w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
              placeholder="e.g. ephemeral"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Difficulty (1–5)
            <input
              type="number"
              min={1}
              max={5}
              value={form.difficulty}
              onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))}
              className="ui-input mt-1 w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground md:col-span-2">
            Meaning
            <input
              value={form.meaning}
              onChange={(e) => setForm((f) => ({ ...f, meaning: e.target.value }))}
              className="ui-input mt-1 w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground md:col-span-2">
            Example
            <input
              value={form.example}
              onChange={(e) => setForm((f) => ({ ...f, example: e.target.value }))}
              className="ui-input mt-1 w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm font-semibold text-foreground">
            Part of speech
            <input
              value={form.part_of_speech}
              onChange={(e) => setForm((f) => ({ ...f, part_of_speech: e.target.value }))}
              className="ui-input mt-1 w-full rounded-xl border border-border bg-surface-2/80 px-3 py-2 text-sm"
              placeholder="noun, verb…"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create word
        </button>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="font-bold text-foreground">Library ({words.length})</span>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm font-bold text-primary underline"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : words.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">No words yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border bg-surface-2/40 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Word</th>
                  <th className="px-4 py-3">Meaning</th>
                  <th className="px-4 py-3">POS</th>
                  <th className="px-4 py-3">Lv.</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {words.map((w) =>
                  editingId === w.id ? (
                    <tr key={w.id} className="bg-primary/5">
                      <td className="px-4 py-3 align-top">
                        <input
                          value={editDraft.word ?? w.word}
                          onChange={(e) => setEditDraft((d) => ({ ...d, word: e.target.value }))}
                          className="ui-input w-full rounded-lg border border-border bg-card px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          value={editDraft.meaning ?? w.meaning}
                          onChange={(e) => setEditDraft((d) => ({ ...d, meaning: e.target.value }))}
                          className="ui-input w-full rounded-lg border border-border bg-card px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          value={editDraft.part_of_speech ?? w.part_of_speech}
                          onChange={(e) => setEditDraft((d) => ({ ...d, part_of_speech: e.target.value }))}
                          className="ui-input w-full rounded-lg border border-border bg-card px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={editDraft.difficulty ?? w.difficulty}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, difficulty: Number(e.target.value) }))
                          }
                          className="ui-input w-16 rounded-lg border border-border bg-card px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <button
                          type="button"
                          onClick={() => void saveEdit(w.id)}
                          className="mr-2 font-bold text-primary"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditDraft({});
                          }}
                          className="font-bold text-muted-foreground"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={w.id}>
                      <td className="px-4 py-3 font-bold text-foreground">{w.word}</td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">{w.meaning || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{w.part_of_speech || "—"}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{w.difficulty}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(w.id);
                            setEditDraft({ ...w });
                          }}
                          className="mr-2 inline-flex rounded-lg p-2 text-primary hover:bg-primary/10"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(w.id)}
                          className="inline-flex rounded-lg p-2 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
