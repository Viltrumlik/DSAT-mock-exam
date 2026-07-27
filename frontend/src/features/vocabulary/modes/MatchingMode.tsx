"use client";

/**
 * Matching mode — words and definitions shuffled into one grid, dealt six at a
 * time. A round is a wall: it can't be left until every pair is found, and the
 * clock counts up across the whole set so the score is "how fast", not "how many".
 *
 * Accent: **info** — the same one `STUDY_MODE_ACCENT.matching` gives the Matching
 * card on the set page. Danger (a wrong pair) and success (board cleared) are
 * feedback, not accent, and outrank it where they appear.
 */

import { Layers, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatClock } from "@/features/testing-simulation/utils/time";
import { cn } from "@/lib/cn";

import type { VocabSetDetail, VocabWord } from "../types";
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

/**
 * The "wrong pair" shake. Kept local rather than added to globals.css because
 * it's the only surface that uses it; the reduced-motion rule mirrors the
 * global guard so the flash still reads without any movement.
 */
const SHAKE_CSS = `
@keyframes vocab-match-shake {
  0%, 100% { transform: translateX(0); }
  18% { transform: translateX(-6px); }
  38% { transform: translateX(5px); }
  58% { transform: translateX(-3px); }
  78% { transform: translateX(2px); }
}
.vocab-match-shake { animation: vocab-match-shake .42s cubic-bezier(.36,.07,.19,.97) both; }
@media (prefers-reduced-motion: reduce) {
  .vocab-match-shake { animation: none; }
}
`;

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
  // Grading happens inside a click handler that may itself be the one recording
  // a mistake, so it reads the ref: state would still be a render behind.
  const missedRef = useRef<Set<number>>(new Set());

  const elapsed = useElapsedSeconds(!done);

  const handleMistake = (wordIds: number[]) => {
    const next = new Set(missedRef.current);
    wordIds.forEach((id) => next.add(id));
    missedRef.current = next;
    setMissed(next);
    setMistakes((m) => m + 1);
  };

  // A word is graded the moment its pair is found — wrong-then-right still
  // scores as missed — so an abandoned run records the pairs already solved.
  const handlePairFound = (wordId: number) => {
    session.report({ word_id: wordId, correct: !missedRef.current.has(wordId) });
  };

  const handleRoundDone = () => {
    if (roundIndex + 1 < rounds.length) {
      setRoundIndex(roundIndex + 1);
      return;
    }
    setDone(true);
    session.finish();
  };

  if (session.fatal && session.error) {
    return <ModeStartError setId={setId} title={TITLE} message={session.error} onRetry={session.retry} />;
  }

  const clock = (
    <ModePill tone={done ? "info" : "neutral"}>
      <Timer className="h-3.5 w-3.5" aria-hidden />
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
          celebrate={mistakes === 0}
        />
      </ModeFrame>
    );
  }

  return (
    <ModeFrame
      setId={setId}
      title={TITLE}
      subtitle={set.title}
      progress={(roundIndex / rounds.length) * 100}
      right={
        <>
          <span className="hidden sm:inline-flex">
            <ModePill tone="info">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              Round {roundIndex + 1} / {rounds.length}
            </ModePill>
          </span>
          {clock}
        </>
      }
    >
      {/* Mounted beside the board, not inside it, so the keyframes survive the
          remount that deals each new round. */}
      <style>{SHAKE_CSS}</style>
      <MatchingRound
        key={roundIndex}
        words={rounds[roundIndex] ?? []}
        roundNumber={roundIndex + 1}
        roundCount={rounds.length}
        onMistake={handleMistake}
        onPairFound={handlePairFound}
        onComplete={handleRoundDone}
      />
    </ModeFrame>
  );
}

function MatchingRound({
  words,
  roundNumber,
  roundCount,
  onMistake,
  onPairFound,
  onComplete,
}: {
  words: VocabWord[];
  roundNumber: number;
  roundCount: number;
  onMistake: (wordIds: number[]) => void;
  onPairFound: (wordId: number) => void;
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
      onPairFound(card.wordId);
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
  const total = cards.length / 2;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      {/* Board header — instruction on the left, live pair counter on the right. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-between">
        <p className="text-[13px] font-semibold text-muted-foreground">
          Tap a word, then its definition.
        </p>
        <div className="flex items-center gap-2">
          <span className="ds-num inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-[12px] font-extrabold text-muted-foreground sm:hidden">
            Round {roundNumber} / {roundCount}
          </span>
          <span
            className={cn(
              "ds-num inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-extrabold",
              remaining === 0
                ? "border-success/25 bg-success-soft text-success-foreground"
                : "border-info/20 bg-info-soft text-info-foreground",
            )}
          >
            {remaining} of {total} pair{total === 1 ? "" : "s"} left
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((card, i) => {
          const isMatched = matched.has(card.key);
          const isSelected = selected === card.key;
          const isWrong = !!wrongPair?.includes(card.key);
          return (
            // The entrance animation lives on the wrapper: `cr-rowin` fills
            // forwards, and holding `transform: none` on the button itself
            // would cancel the selected/matched transforms below.
            <div key={card.key} className="cr-rowin" style={{ animationDelay: `${i * 45}ms` }}>
              <button
                type="button"
                onClick={() => pick(card)}
                disabled={isMatched}
                aria-pressed={isSelected}
                className={cn(
                  "ds-ring flex h-full min-h-[104px] w-full items-center justify-center rounded-2xl border-2 p-3 text-center transition-[opacity,border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none",
                  card.face === "word"
                    ? "text-[15px] font-extrabold text-foreground"
                    : "text-[13px] font-medium text-foreground",
                  isMatched
                    ? "pointer-events-none scale-[0.94] border-transparent bg-surface-2 text-muted-foreground opacity-30 shadow-none"
                    : isWrong
                      ? "vocab-match-shake border-danger bg-danger-soft text-danger-foreground shadow-pop"
                      : isSelected
                        ? "-translate-y-1 border-info bg-info-soft text-info-foreground shadow-pop"
                        : "border-border bg-card shadow-card hover:-translate-y-0.5 hover:border-border-strong hover:shadow-pop motion-reduce:hover:translate-y-0",
                )}
              >
                <span className="line-clamp-4">{card.text}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MatchingMode;
