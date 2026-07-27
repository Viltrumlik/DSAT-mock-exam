"use client";

/**
 * Flashcard mode — flip, self-grade, then drill whatever didn't stick until the
 * "still learning" pile is empty. Every verdict from every round is reported, so
 * a word answered wrong then right records both attempts and the streak-based
 * progress model sees the real history.
 *
 * Accent: **primary** — the same one `STUDY_MODE_ACCENT.flashcard` gives the
 * Flashcards card on the set page. The verdict buttons are danger/success
 * because they *are* the grade, not because of the accent.
 */

import { Check, Flag, RotateCcw, RotateCw, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { SessionResult, VocabSetDetail, VocabWord } from "../types";
import { Kbd, ModeBoot, ModeFrame, ModeOutcome, ModePill, ModeStartError } from "./ModeChrome";
import { useModeKeys } from "./useModeKeys";
import { useModeSession } from "./useModeSession";
import { accuracyPercent } from "./utils";

const TITLE = "Flashcards";

export function FlashcardMode({ setId }: { setId: number }) {
  return (
    <ModeBoot setId={setId} title={TITLE}>
      {({ set, runKey, restart }) => (
        <FlashcardRunner key={runKey} setId={setId} set={set} onRestart={restart} />
      )}
    </ModeBoot>
  );
}

type Phase = "study" | "review" | "done";

function FlashcardRunner({
  setId,
  set,
  onRestart,
}: {
  setId: number;
  set: VocabSetDetail;
  onRestart: () => void;
}) {
  const session = useModeSession(setId, "flashcard");

  const [deck, setDeck] = useState<VocabWord[]>(set.words);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<VocabWord[]>([]);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<Phase>("study");

  const current = deck[index];

  const answer = (correct: boolean) => {
    if (!current) return;
    const nextMissed = correct ? missed : [...missed, current];
    setResults([...results, { word_id: current.id, correct }]);
    setMissed(nextMissed);
    // Reported here, not at the end: a student who quits after 20 of 25 cards
    // keeps those 20 verdicts.
    session.report({ word_id: current.id, correct });

    if (index + 1 < deck.length) {
      setIndex(index + 1);
      setFlipped(false);
      return;
    }
    if (nextMissed.length === 0) {
      setPhase("done");
      session.finish();
    } else {
      setPhase("review");
    }
  };

  const practiseMissed = () => {
    setDeck(missed);
    setMissed([]);
    setIndex(0);
    setFlipped(false);
    setRound(round + 1);
    setPhase("study");
  };

  useModeKeys(phase === "study", (key) => {
    if (key === " " || key === "Enter") {
      setFlipped((f) => !f);
      return true;
    }
    if (key === "1" || key === "ArrowLeft") {
      answer(false);
      return true;
    }
    if (key === "2" || key === "ArrowRight") {
      answer(true);
      return true;
    }
    return false;
  });

  if (session.fatal && session.error) {
    return <ModeStartError setId={setId} title={TITLE} message={session.error} onRetry={session.retry} />;
  }

  if (phase === "done") {
    const correct = results.filter((r) => r.correct).length;
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <ModeOutcome
          setId={setId}
          title="Every word learned"
          description={`You cleared all ${set.words.length} words in ${round} round${round === 1 ? "" : "s"}.`}
          stats={[
            { label: "Words", value: String(set.words.length) },
            { label: "Cards reviewed", value: String(results.length) },
            { label: "Accuracy", value: `${accuracyPercent(correct, results.length)}%`, tone: "success" },
          ]}
          session={session}
          onRestart={onRestart}
          celebrate={correct === results.length}
        />
      </ModeFrame>
    );
  }

  if (phase === "review") {
    const learned = deck.filter((w) => !missed.some((m) => m.id === w.id));
    const clearedPct = deck.length === 0 ? 0 : (learned.length / deck.length) * 100;
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8">
          {/* CHECKPOINT — a progress moment between rounds, not a results table. */}
          <div className="cr-cardrise overflow-hidden rounded-3xl border border-border bg-card p-6 shadow-pop">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <Flag className="h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="ds-overline">Checkpoint</p>
                <h2 className="ds-h2 mt-1">Round {round} done</h2>
                <p className="ds-small mt-1.5">Keep going — the pile shrinks every round.</p>
              </div>
            </div>

            {/* Segmented bar: what stuck this round vs what's coming back. */}
            <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="cr-bar h-full bg-success" style={{ width: `${clearedPct}%` }} />
              <div className="cr-bar h-full bg-warning" style={{ width: `${100 - clearedPct}%` }} />
            </div>
            <p className="mt-2.5 text-[12px] font-semibold text-muted-foreground">
              <span className="ds-num font-extrabold text-foreground">{learned.length}</span> of{" "}
              <span className="ds-num font-extrabold text-foreground">{deck.length}</span> cards cleared this round
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ReviewColumn
              tone="success"
              title="You know these"
              count={learned.length}
              words={learned}
              emptyText="Nothing landed this round — that's what the next one is for."
              delay={0}
            />
            <ReviewColumn
              tone="warning"
              title="Keep practising these"
              count={missed.length}
              words={missed}
              emptyText=""
              delay={80}
            />
          </div>

          <div className="flex justify-center">
            <Button size="lg" className="cr-press" onClick={practiseMissed} leftIcon={<RotateCcw />}>
              Practice {missed.length} word{missed.length === 1 ? "" : "s"} again
            </Button>
          </div>
        </div>
      </ModeFrame>
    );
  }

  return (
    <ModeFrame
      setId={setId}
      title={TITLE}
      subtitle={set.title}
      progress={(index / Math.max(1, deck.length)) * 100}
      right={
        <ModePill>
          {index + 1} / {deck.length}
        </ModePill>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
        {round > 1 ? (
          <p className="flex justify-center">
            <span className="cr-pillin inline-flex items-center gap-1.5 rounded-full border border-warning/25 bg-warning-soft px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-warning-foreground">
              <RotateCcw className="h-3 w-3" aria-hidden />
              Round <span className="ds-num">{round}</span> · still learning
            </span>
          </p>
        ) : null}

        <FlipCard word={current} flipped={flipped} onFlip={() => setFlipped(!flipped)} />

        <p className="text-center text-[12px] text-muted-foreground">
          Click the card or press <Kbd>Space</Kbd> to flip · <Kbd>1</Kbd> wrong · <Kbd>2</Kbd> correct
        </p>

        <div className="grid grid-cols-2 gap-3">
          <VerdictButton tone="wrong" onClick={() => answer(false)}>
            <X className="h-5 w-5" /> Wrong
          </VerdictButton>
          <VerdictButton tone="correct" onClick={() => answer(true)}>
            <Check className="h-5 w-5" /> Correct
          </VerdictButton>
        </div>
      </div>
    </ModeFrame>
  );
}

function FlipCard({
  word,
  flipped,
  onFlip,
}: {
  word: VocabWord | undefined;
  flipped: boolean;
  onFlip: () => void;
}) {
  if (!word) return null;
  return (
    <div className="[perspective:1400px]">
      <button
        type="button"
        onClick={onFlip}
        aria-label={flipped ? "Show the word" : "Show the definition"}
        className="ds-ring cr-lift block h-[min(58vh,420px)] w-full rounded-3xl text-left"
      >
        <div
          className={cn(
            "relative h-full w-full transition-transform duration-500 ease-[var(--ds-ease-premium)] [transform-style:preserve-3d] motion-reduce:transition-none",
            flipped && "[transform:rotateY(180deg)]",
          )}
        >
          <CardFace hint="Flip for definition">
            <p className="ds-overline">Word</p>
            <p className="ds-display mt-4 break-words text-center">{word.word}</p>
            {word.part_of_speech ? (
              <span className="mt-4 inline-flex items-center rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] font-bold italic text-muted-foreground">
                {word.part_of_speech}
              </span>
            ) : null}
          </CardFace>
          <CardFace back hint="Flip for word">
            <p className="ds-overline">Definition</p>
            <p className="mt-4 max-w-xl text-center text-xl font-bold leading-snug text-foreground sm:text-2xl">
              {word.definition}
            </p>
            {word.part_of_speech ? (
              <span className="mt-3 inline-flex items-center rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] font-bold italic text-muted-foreground">
                {word.part_of_speech}
              </span>
            ) : null}
            {word.example ? (
              <p className="mt-5 max-w-md rounded-xl border-l-2 border-primary/40 bg-surface-2 px-4 py-2.5 text-left text-[13px] italic leading-relaxed text-muted-foreground">
                “{word.example}”
              </p>
            ) : null}
            {word.synonyms.length ? (
              <div className="mt-4 flex max-w-md flex-wrap items-center justify-center gap-1.5">
                <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                  Synonyms
                </span>
                {word.synonyms.map((s, i) => (
                  <span
                    key={`${s}-${i}`}
                    className="rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-bold text-primary"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : null}
          </CardFace>
        </div>
      </button>
    </div>
  );
}

/**
 * One side of the card. The corner chip is the flip affordance — the whole
 * face is clickable, but nothing on a plain word says "there's a back" without
 * it.
 */
function CardFace({ children, back, hint }: { children: ReactNode; back?: boolean; hint: string }) {
  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden rounded-3xl border border-border bg-card shadow-pop [backface-visibility:hidden]",
        back && "[transform:rotateY(180deg)]",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full bg-primary-soft"
      />
      <div className="h-full overflow-y-auto">
        <div className="relative flex min-h-full flex-col items-center justify-center px-6 pb-16 pt-12">
          {children}
        </div>
      </div>
      <span
        aria-hidden
        className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px] font-extrabold text-muted-foreground"
      >
        <RotateCw className="h-3 w-3" /> {hint}
      </span>
    </div>
  );
}

function VerdictButton({
  tone,
  onClick,
  children,
}: {
  tone: "wrong" | "correct";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ds-ring cr-press inline-flex h-16 items-center justify-center gap-2.5 rounded-2xl border-2 text-[16px] font-extrabold shadow-card",
        tone === "wrong"
          ? "border-danger/25 bg-danger-soft text-danger-foreground hover:border-danger/60"
          : "border-success/25 bg-success-soft text-success-foreground hover:border-success/60",
      )}
    >
      {children}
    </button>
  );
}

function ReviewColumn({
  tone,
  title,
  count,
  words,
  emptyText,
  delay,
}: {
  tone: "success" | "warning";
  title: string;
  count: number;
  words: VocabWord[];
  emptyText: string;
  delay: number;
}) {
  return (
    <div
      className={cn(
        "cr-cardrise rounded-2xl border bg-card p-4 shadow-card",
        tone === "success" ? "border-success/25" : "border-warning/25",
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            tone === "success" ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
          )}
        >
          {tone === "success" ? (
            <Sparkles className="h-4.5 w-4.5" aria-hidden />
          ) : (
            <RotateCcw className="h-4.5 w-4.5" aria-hidden />
          )}
        </span>
        <p className="ds-h4 min-w-0 flex-1 truncate">{title}</p>
        <span
          className={cn(
            "ds-num rounded-full px-2.5 py-0.5 text-[13px] font-extrabold",
            tone === "success"
              ? "bg-success-soft text-success-foreground"
              : "bg-warning-soft text-warning-foreground",
          )}
        >
          {count}
        </span>
      </div>
      {words.length === 0 ? (
        emptyText ? <p className="mt-3 text-[13px] text-muted-foreground">{emptyText}</p> : null
      ) : (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {words.map((w, i) => (
            <li
              key={w.id}
              className={cn(
                "cr-rowin max-w-full truncate rounded-full border px-2.5 py-1 text-[13px] font-bold",
                tone === "success"
                  ? "border-success/20 bg-success-soft text-success-foreground"
                  : "border-warning/20 bg-warning-soft text-warning-foreground",
              )}
              style={{ animationDelay: `${delay + i * 40}ms` }}
            >
              {w.word}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FlashcardMode;
