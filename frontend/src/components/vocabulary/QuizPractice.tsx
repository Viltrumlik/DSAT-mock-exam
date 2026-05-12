"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import type { VocabWord } from "./Flashcard";

type Choice = { id: string; label: string; isCorrect: boolean };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function QuizPractice({
  word,
  pool,
  onAnswer,
}: {
  word: VocabWord;
  pool: VocabWord[];
  onAnswer: (result: "correct" | "wrong") => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const choices = useMemo<Choice[]>(() => {
    const correct = (word.meaning || "").trim();
    const distractors = shuffle(
      pool
        .filter((w) => w.id !== word.id)
        .map((w) => (w.meaning || "").trim())
        .filter(Boolean),
    )
      .filter((m, i, a) => a.indexOf(m) === i)
      .slice(0, 3);
    const all = shuffle([correct, ...distractors].filter(Boolean));
    return all.map((label, idx) => ({
      id: `${word.id}-${idx}`,
      label,
      isCorrect: label === correct,
    }));
  }, [pool, word.id, word.meaning]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Quiz</p>
        <p className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">{word.word}</p>
        <p className="mt-2 text-sm text-muted-foreground">Pick the best meaning.</p>

        <div className="mt-4 grid gap-2">
          {choices.length ? (
            choices.map((c) => {
              const isPicked = picked === c.id;
              const show = picked != null;
              const ok = show && c.isCorrect;
              const bad = show && isPicked && !c.isCorrect;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={picked != null}
                  onClick={() => {
                    setPicked(c.id);
                    onAnswer(c.isCorrect ? "correct" : "wrong");
                  }}
                  className={cn(
                    "rounded-xl border border-border px-3 py-2 text-left text-sm font-semibold transition-colors",
                    "bg-card hover:bg-surface-2 disabled:cursor-not-allowed",
                    ok && "border-emerald-400/50 bg-emerald-500/10",
                    bad && "border-rose-400/50 bg-rose-500/10",
                  )}
                >
                  <span className="block text-foreground">{c.label || "—"}</span>
                </button>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">Not enough words to generate choices yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

