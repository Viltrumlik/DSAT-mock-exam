"use client";

/**
 * Matching mode — words and definitions shuffled into one grid, dealt six at a
 * time. A round is a wall: it can't be left until every pair is found, and the
 * clock counts up across the whole set so the score is "how fast", not "how many".
 */

import { Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatClock } from "@/features/testing-simulation/utils/time";
import { cn } from "@/lib/cn";

import type { SessionResult, VocabSetDetail, VocabWord } from "../types";
import { ModeBoot, ModeFrame, ModeOutcome, ModePill, ModeStartError } from "./ModeChrome";
import { useElapsedSeconds } from "./timers";
import { useModeSession } from "./useModeSession";
import { buildMatchCards, chunkForMatching, isMatchingPair } from "./utils";
import type { MatchCard } from "./utils";

const TITLE = "Matching";

/** How long a mismatched pair stays lit red before the board clears. */
const WRONG_FLASH_MS = 650;
/** Beat between the last pair fading out and the next round dealing. */
const ROUND_BREAK_MS = 550;

export function MatchingMode({ setId }: { setId: number }) {
  return (
    <ModeBoot setId={setId} title={TITLE}>
      {({ set, runKey, restart }) => (
        <MatchingRunner key={runKey} setId={setId} set={set} onRestart={restart} />
      )}
    </ModeBoot>
  );
}

function MatchingRunner({
  setId,
  set,
  onRestart,
}: {
  setId: number;
  set: VocabSetDetail;
  onRestart: () => void;
}) {
  const session = useModeSession(setId, "matching");
  const [rounds] = useState<VocabWord[][]>(() => chunkForMatching(set.words));

  const [roundIndex, setRoundIndex] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [done, setDone] = useState(false);
  // Words touched by a wrong attempt anywhere in the run — they score as missed.
  const [missed, setMissed] = useState<Set<number>>(() => new Set());

  const elapsed = useElapsedSeconds(!done);

  const handleMistake = (wordIds: number[]) => {
    setMissed((prev) => {
      const next = new Set(prev);
      wordIds.forEach((id) => next.add(id));
      return next;
    });
    setMistakes((m) => m + 1);
  };

  const handleRoundDone = () => {
    if (roundIndex + 1 < rounds.length) {
      setRoundIndex(roundIndex + 1);
      return;
    }
    setDone(true);
    // Safe to read from this render: a round only completes on a click that
    // lands after every mistake in it has already been folded into state.
    const results: SessionResult[] = set.words.map((w) => ({
      word_id: w.id,
      correct: !missed.has(w.id),
    }));
    session.finish(results);
  };

  if (session.fatal && session.error) {
    return <ModeStartError setId={setId} title={TITLE} message={session.error} onRetry={session.retry} />;
  }

  const clock = (
    <ModePill tone={done ? "primary" : "neutral"}>
      <Timer className="h-3.5 w-3.5" />
      {formatClock(elapsed)}
    </ModePill>
  );

  if (done) {
    const matchedFirstTry = set.words.length - missed.size;
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title} right={clock}>
        <ModeOutcome
          setId={setId}
          title="All pairs matched"
          description={`${set.words.length} word${set.words.length === 1 ? "" : "s"} across ${rounds.length} round${rounds.length === 1 ? "" : "s"}.`}
          stats={[
            { label: "Total time", value: formatClock(elapsed) },
            { label: "Mistakes", value: String(mistakes), tone: mistakes === 0 ? "success" : "danger" },
            { label: "Clean first try", value: `${matchedFirstTry}/${set.words.length}` },
          ]}
          session={session}
          onRestart={onRestart}
        />
      </ModeFrame>
    );
  }

  return (
    <ModeFrame
      setId={setId}
      title={TITLE}
      subtitle={`${set.title} · round ${roundIndex + 1} of ${rounds.length}`}
      progress={(roundIndex / rounds.length) * 100}
      right={clock}
    >
      <MatchingRound
        key={roundIndex}
        words={rounds[roundIndex] ?? []}
        onMistake={handleMistake}
        onComplete={handleRoundDone}
      />
    </ModeFrame>
  );
}

function MatchingRound({
  words,
  onMistake,
  onComplete,
}: {
  words: VocabWord[];
  onMistake: (wordIds: number[]) => void;
  onComplete: () => void;
}) {
  // Lazy initial state, not useMemo: the deal must survive every re-render of
  // the round, otherwise a mismatch would reshuffle the board under the student.
  const [cards] = useState<MatchCard[]>(() => buildMatchCards(words));
  const [matched, setMatched] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongPair, setWrongPair] = useState<string[] | null>(null);
  const [locked, setLocked] = useState(false);

  const timers = useRef<number[]>([]);
  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const pick = (card: MatchCard) => {
    if (locked || matched.has(card.key)) return;
    if (selected === card.key) {
      setSelected(null);
      return;
    }
    if (selected == null) {
      setSelected(card.key);
      return;
    }

    const first = cards.find((c) => c.key === selected);
    if (!first) {
      setSelected(card.key);
      return;
    }

    if (isMatchingPair(first, card)) {
      const next = new Set(matched);
      next.add(first.key);
      next.add(card.key);
      setMatched(next);
      setSelected(null);
      if (next.size === cards.length) after(ROUND_BREAK_MS, onComplete);
      return;
    }

    onMistake([first.wordId, card.wordId]);
    setWrongPair([first.key, card.key]);
    setLocked(true);
    after(WRONG_FLASH_MS, () => {
      setWrongPair(null);
      setSelected(null);
      setLocked(false);
    });
  };

  const remaining = (cards.length - matched.size) / 2;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <p className="text-center text-[13px] text-muted-foreground">
        Tap a word, then its definition. {remaining} pair{remaining === 1 ? "" : "s"} left.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card) => {
          const isMatched = matched.has(card.key);
          const isSelected = selected === card.key;
          const isWrong = !!wrongPair?.includes(card.key);
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => pick(card)}
              disabled={isMatched}
              aria-pressed={isSelected}
              className={cn(
                "ds-ring flex min-h-[104px] items-center justify-center rounded-2xl border p-3 text-center transition-[opacity,border-color,background-color,transform] duration-200 motion-reduce:transition-none",
                card.face === "word"
                  ? "text-[15px] font-extrabold text-foreground"
                  : "text-[13px] font-medium text-foreground",
                isMatched
                  ? "pointer-events-none border-transparent bg-surface-2 opacity-25"
                  : isWrong
                    ? "border-danger/50 bg-danger-soft text-danger-foreground"
                    : isSelected
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border bg-card shadow-card hover:border-border-strong hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              )}
            >
              <span className="line-clamp-4">{card.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MatchingMode;
