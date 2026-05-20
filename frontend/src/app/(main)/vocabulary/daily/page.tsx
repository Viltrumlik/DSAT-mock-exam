"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { vocabularyApi } from "@/lib/api";
import { Flashcard, type VocabWord } from "@/components/vocabulary/Flashcard";
import { QuizPractice } from "@/components/vocabulary/QuizPractice";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { EmptyState } from "@/components/ui/EmptyState";
import { BookOpen, Flame, RefreshCcw, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";

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
  const progressPct = items.length > 0 ? Math.round((Math.min(idx, items.length) / items.length) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-6">

      {/* ═══ Header ══════════════════════════════════════════════════════ */}
      <PageHeader
        eyebrow="Vocabulary"
        title="Daily Practice"
        description="Reviews come first (spaced repetition), then new words. A little every day adds up."
      />

      {/* ═══ Stats Row ═══════════════════════════════════════════════════ */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Words Learned"
          value={payload?.stats.total_learned ?? "—"}
          icon={BookOpen}
          accent="text-primary bg-primary/10"
        />
        <StatCard
          label="Accuracy"
          value={`${payload?.stats.accuracy_percent ?? "—"}%`}
          icon={Target}
          accent="text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40"
        />
        <StatCard
          label="Streak"
          value={`${payload?.stats.streak_days ?? "—"}d`}
          icon={Flame}
          accent="text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40"
        />
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
          <ProgressRing
            value={progressPct}
            size={48}
            strokeWidth={5}
            color={done ? "text-emerald-500" : "text-primary"}
          />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Session</p>
            <p className="text-xl font-black tabular-nums text-foreground">
              {Math.min(idx, items.length)}/{items.length}
            </p>
          </div>
        </div>
      </div>

      {/* ═══ Mode + Actions ═════════════════════════════════════════════ */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("flashcards")}
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors",
            mode === "flashcards"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          Flashcards
        </button>
        <button
          type="button"
          onClick={() => setMode("quiz")}
          className={cn(
            "rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors",
            mode === "quiz"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground",
          )}
        >
          Practice Quiz
        </button>
        <div className="ms-auto flex items-center gap-2">
          <Link
            href="/vocabulary/words"
            className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            Browse Words
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-bold text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* ═══ Main Content ═══════════════════════════════════════════════ */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No vocabulary words yet"
            description="Ask an admin to add words, then come back here for your daily session."
          />
        ) : done ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-950/40">
              <Trophy className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="text-xl font-extrabold text-foreground">Session Complete</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Come back tomorrow for new items and scheduled reviews.
            </p>
            <button
              type="button"
              onClick={() => setIdx(0)}
              className="mt-6 inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-foreground hover:bg-surface-2 transition-colors"
            >
              <RefreshCcw className="h-4 w-4" />
              Review Again
            </button>
          </div>
        ) : current ? (
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <p className="text-sm font-bold text-muted-foreground">
                  Item {idx + 1} / {items.length}
                </p>
                <span className={cn(
                  "rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                  current.kind === "review"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                    : "bg-primary/10 text-primary",
                )}>
                  {current.kind === "review" ? "Review" : "New"}
                </span>
              </div>
              {submitting && <p className="text-xs font-bold text-muted-foreground animate-pulse">Saving…</p>}
            </div>

            {/* Progress bar */}
            <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  done ? "bg-emerald-500" : "bg-primary",
                )}
                style={{ width: `${progressPct}%` }}
              />
            </div>

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
                onAnswer={(r) => void submit(r)}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
