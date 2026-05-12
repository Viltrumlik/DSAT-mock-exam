"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";

export type VocabWord = {
  id: number;
  word: string;
  meaning: string;
  example: string;
  part_of_speech: string;
  difficulty: number;
};

export function Flashcard({
  word,
  onCorrect,
  onWrong,
  autoFocusActions = false,
}: {
  word: VocabWord;
  onCorrect: () => void;
  onWrong: () => void;
  autoFocusActions?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);

  const posLabel = useMemo(() => {
    const p = (word.part_of_speech || "").trim().toLowerCase();
    return p ? p.replace(/_/g, " ") : "word";
  }, [word.part_of_speech]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-label-foreground">Flashcard</p>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            Part of speech: <span className="font-semibold text-foreground">{posLabel}</span> · Difficulty{" "}
            <span className="font-semibold text-foreground">{word.difficulty}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground shadow-sm transition-colors hover:bg-surface-2"
        >
          {flipped ? "Show word" : "Flip"}
        </button>
      </div>

      <div className="mt-4 [perspective:1000px]">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="relative h-[320px] w-full rounded-2xl border border-border bg-card shadow-xl transition-transform duration-500 [transform-style:preserve-3d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80"
          aria-label="Flip flashcard"
          style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
        >
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center [backface-visibility:hidden]">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Word</p>
            <p className="mt-3 text-4xl font-extrabold tracking-tight text-foreground">{word.word}</p>
            <p className="mt-3 text-sm text-muted-foreground">
              Tap to flip. Then choose <span className="font-semibold text-foreground">Correct</span> or{" "}
              <span className="font-semibold text-foreground">Wrong</span>.
            </p>
          </div>

          <div className="absolute inset-0 flex flex-col justify-center px-6 text-left [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Meaning</p>
            <p className="mt-2 text-lg font-bold text-foreground">{word.meaning || "—"}</p>
            {word.example ? (
              <>
                <p className="mt-5 text-xs font-extrabold uppercase tracking-[0.18em] text-primary">Example</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{word.example}</p>
              </>
            ) : null}
          </div>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onWrong}
          className={cn(
            "rounded-2xl border border-border px-4 py-3 text-sm font-extrabold shadow-sm transition-colors",
            "bg-card text-foreground hover:bg-surface-2",
          )}
          autoFocus={autoFocusActions}
        >
          Wrong
          <span className="mt-1 block text-xs font-semibold text-muted-foreground">Show again soon</span>
        </button>
        <button
          type="button"
          onClick={onCorrect}
          className={cn(
            "rounded-2xl border border-primary/30 px-4 py-3 text-sm font-extrabold shadow-sm transition-colors",
            "bg-primary/10 text-foreground hover:bg-primary/15",
          )}
        >
          Correct
          <span className="mt-1 block text-xs font-semibold text-muted-foreground">Increase interval</span>
        </button>
      </div>
    </div>
  );
}

