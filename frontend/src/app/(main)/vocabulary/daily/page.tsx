"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Flashcard, type VocabWord } from "@/components/vocabulary/Flashcard";
import { QuizPractice } from "@/components/vocabulary/QuizPractice";

type DailyItem =
  | { kind: "new"; word: VocabWord; progress: null }
  | { kind: "review"; word: VocabWord; progress: any };

type DailyPayload = {
  target: number;
  items: DailyItem[];
  stats: { total_learned: number; accuracy_percent: number; streak_days: number };
};

export default function VocabularyDailyPage() {
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<DailyPayload | null>(null);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<"flashcards" | "quiz">("flashcards");
  const [submitting, setSubmitting] = useState(false);

  const items = useMemo(() => payload?.items ?? [], [payload]);
  const current = items[idx] ?? null;

  const pool = useMemo(() => items.map((x) => x.word), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await vocabularyApi.getDaily({ target: 10 })) as DailyPayload;
      setPayload(data);
      setIdx(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (result: "correct" | "wrong") => {
    if (!current) return;
    setSubmitting(true);
    try {
      await vocabularyApi.review({ word_id: current.word.id, result });
      setIdx((i) => Math.min(items.length, i + 1));
    } finally {
      setSubmitting(false);
    }
  };

  const done = idx >= items.length && items.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-ds-gold">Daily Vocabulary</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-foreground md:text-3xl">Learn a little, every day</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Reviews come first (spaced repetition), then new words.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="brand">Learned: {payload?.stats.total_learned ?? "—"}</Badge>
          <Badge variant="neutral">Accuracy: {payload?.stats.accuracy_percent ?? "—"}%</Badge>
          <Badge variant="neutral">Streak: {payload?.stats.streak_days ?? "—"}d</Badge>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("flashcards")}
          className={`rounded-xl border px-3 py-2 text-sm font-bold ${
            mode === "flashcards" ? "border-primary/40 bg-primary/10" : "border-border bg-card hover:bg-surface-2"
          }`}
        >
          Flashcards
        </button>
        <button
          type="button"
          onClick={() => setMode("quiz")}
          className={`rounded-xl border px-3 py-2 text-sm font-bold ${
            mode === "quiz" ? "border-primary/40 bg-primary/10" : "border-border bg-card hover:bg-surface-2"
          }`}
        >
          Practice quiz
        </button>
        <div className="ms-auto flex items-center gap-2">
          <Link
            href="/vocabulary/words"
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold hover:bg-surface-2"
          >
            Browse words
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold hover:bg-surface-2"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading your daily session…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No vocabulary words found yet. Ask an admin to add words, then come back here.
          </p>
        ) : done ? (
          <div>
            <p className="text-lg font-extrabold text-foreground">Nice work — session complete.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Come back tomorrow for new items and scheduled reviews.
            </p>
            <button
              type="button"
              onClick={() => {
                setIdx(0);
              }}
              className="mt-4 rounded-xl border border-border bg-card px-4 py-2 text-sm font-bold hover:bg-surface-2"
            >
              Review again
            </button>
          </div>
        ) : current ? (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-muted-foreground">
                Item {idx + 1} / {items.length}{" "}
                <span className="ms-2 rounded-lg bg-surface-2 px-2 py-1 text-[11px] font-extrabold uppercase tracking-wider text-label-foreground">
                  {current.kind === "review" ? "Review" : "New"}
                </span>
              </p>
              {submitting ? <p className="text-sm font-semibold text-muted-foreground">Saving…</p> : null}
            </div>

            <div className="mt-4">
              {mode === "flashcards" ? (
                <Flashcard
                  word={current.word}
                  onCorrect={() => void submit("correct")}
                  onWrong={() => void submit("wrong")}
                  autoFocusActions
                />
              ) : (
                <QuizPractice
                  word={current.word}
                  pool={pool}
                  onAnswer={(r) => {
                    void submit(r);
                  }}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

