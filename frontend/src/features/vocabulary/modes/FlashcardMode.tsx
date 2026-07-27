"use client";

/**
 * Flashcard mode — flip, self-grade, then drill whatever didn't stick until the
 * "still learning" pile is empty. Every verdict from every round is reported, so
 * a word answered wrong then right records both attempts and the streak-based
 * progress model sees the real history.
 */

import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { useState } from "react";

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
    const nextResults = [...results, { word_id: current.id, correct }];
    const nextMissed = correct ? missed : [...missed, current];
    setResults(nextResults);
    setMissed(nextMissed);

    if (index + 1 < deck.length) {
      setIndex(index + 1);
      setFlipped(false);
      return;
    }
    if (nextMissed.length === 0) {
      setPhase("done");
      session.finish(nextResults);
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
        />
      </ModeFrame>
    );
  }

  if (phase === "review") {
    const learned = deck.filter((w) => !missed.some((m) => m.id === w.id));
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
          <div className="text-center">
            <h2 className="ds-h2">Round {round} done</h2>
            <p className="ds-lead mt-2">Keep going — the pile shrinks every round.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ReviewColumn
              tone="success"
              title="Learned"
              count={learned.length}
              words={learned}
              emptyText="Nothing landed this round — that's what the next one is for."
            />
            <ReviewColumn
              tone="warning"
              title="Still learning"
              count={missed.length}
              words={missed}
              emptyText=""
            />
          </div>

          <div className="flex justify-center">
            <Button size="lg" onClick={practiseMissed} leftIcon={<RotateCcw />}>
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
          <p className="text-center text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Round {round} · still learning
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
        className="ds-ring block h-[min(58vh,420px)] w-full rounded-3xl text-left"
      >
        <div
          className={cn(
            "relative h-full w-full transition-transform duration-500 ease-[var(--ds-ease-premium)] [transform-style:preserve-3d] motion-reduce:transition-none",
            flipped && "[transform:rotateY(180deg)]",
          )}
        >
          <CardFace>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Word</p>
            <p className="mt-4 text-center text-3xl font-extrabold text-foreground sm:text-4xl">{word.word}</p>
            {word.part_of_speech ? (
              <p className="mt-2 text-sm italic text-muted-foreground">{word.part_of_speech}</p>
            ) : null}
          </CardFace>
          <CardFace back>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Definition</p>
            <p className="mt-4 text-center text-xl font-semibold text-foreground sm:text-2xl">{word.definition}</p>
            {word.part_of_speech ? (
              <p className="mt-3 text-sm italic text-muted-foreground">{word.part_of_speech}</p>
            ) : null}
            {word.example ? (
              <p className="mt-4 max-w-md text-center text-sm text-muted-foreground">“{word.example}”</p>
            ) : null}
            {word.synonyms.length ? (
              <p className="mt-4 text-[12px] text-muted-foreground">
                <span className="font-semibold">Synonyms:</span> {word.synonyms.join(", ")}
              </p>
            ) : null}
          </CardFace>
        </div>
      </button>
    </div>
  );
}

function CardFace({ children, back }: { children: React.ReactNode; back?: boolean }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-card [backface-visibility:hidden]",
        back && "[transform:rotateY(180deg)]",
      )}
    >
      {children}
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
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "ds-ring cr-press inline-flex h-14 items-center justify-center gap-2 rounded-2xl border text-[15px] font-bold",
        tone === "wrong"
          ? "border-danger/25 bg-danger-soft text-danger-foreground hover:border-danger/40"
          : "border-success/25 bg-success-soft text-success-foreground hover:border-success/40",
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
}: {
  tone: "success" | "warning";
  title: string;
  count: number;
  words: VocabWord[];
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-2">
        {tone === "success" ? (
          <Sparkles className="h-4 w-4 text-success" />
        ) : (
          <RotateCcw className="h-4 w-4 text-warning" />
        )}
        <p className="ds-h4">{title}</p>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums",
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
        <ul className="mt-3 flex flex-col gap-1.5">
          {words.map((w) => (
            <li key={w.id} className="truncate text-sm font-semibold text-foreground">
              {w.word}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default FlashcardMode;
