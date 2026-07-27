"use client";

/**
 * Speed mode — sixty seconds, one word at a time, two definitions to choose
 * between. A click advances instantly: no confirm step, no feedback pause, the
 * whole point is recognition under time pressure.
 */

import { Timer, Zap } from "lucide-react";
import { useRef, useState } from "react";

import { formatClock } from "@/features/testing-simulation/utils/time";
import { cn } from "@/lib/cn";

import type { SessionResult, VocabSetDetail } from "../types";
import { Kbd, ModeBoot, ModeFrame, ModeOutcome, ModePill, ModeStartError } from "./ModeChrome";
import { useCountdownSeconds, useLeadInTicks } from "./timers";
import { useModeKeys } from "./useModeKeys";
import { useModeSession } from "./useModeSession";
import {
  accuracyPercent,
  buildSpeedPrompts,
  SPEED_LEAD_IN_STEP_MS,
  SPEED_LEAD_IN_TICKS,
  SPEED_ROUND_SECONDS,
} from "./utils";
import type { DistractorWord, SpeedPrompt } from "./utils";

const TITLE = "Speed";

/** Below this the clock turns red. */
const URGENT_SECONDS = 10;

export function SpeedMode({ setId }: { setId: number }) {
  return (
    <ModeBoot setId={setId} title={TITLE}>
      {({ set, pool, runKey, restart }) => (
        <SpeedRunner key={runKey} setId={setId} set={set} pool={pool} onRestart={restart} />
      )}
    </ModeBoot>
  );
}

type Phase = "leadin" | "playing" | "done";

function SpeedRunner({
  setId,
  set,
  pool,
  onRestart,
}: {
  setId: number;
  set: VocabSetDetail;
  pool: DistractorWord[];
  onRestart: () => void;
}) {
  const session = useModeSession(setId, "speed");
  const [prompts] = useState<SpeedPrompt[]>(() => buildSpeedPrompts(set.words, pool));

  const [phase, setPhase] = useState<Phase>("leadin");
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<SessionResult[]>([]);
  // The expiry callback is latched inside the timer, so it can't read state
  // through a closure — it reads the ref instead.
  const resultsRef = useRef<SessionResult[]>([]);

  const end = (final: SessionResult[]) => {
    setPhase("done");
    session.finish(final);
  };

  const tick = useLeadInTicks(SPEED_LEAD_IN_TICKS, SPEED_LEAD_IN_STEP_MS, phase === "leadin", () =>
    setPhase("playing"),
  );

  const secondsLeft = useCountdownSeconds({
    durationSeconds: SPEED_ROUND_SECONDS,
    running: phase === "playing",
    onExpire: () => end(resultsRef.current),
  });

  const current = prompts[index];

  const answer = (optionIndex: number) => {
    if (phase !== "playing" || !current) return;
    const option = current.options[optionIndex];
    if (!option) return;

    const next = [...results, { word_id: current.wordId, correct: option.correct }];
    resultsRef.current = next;
    setResults(next);

    if (index + 1 < prompts.length) {
      setIndex(index + 1);
    } else {
      end(next);
    }
  };

  useModeKeys(phase === "playing", (key) => {
    if (key === "1" || key === "ArrowLeft") {
      answer(0);
      return true;
    }
    if (key === "2" || key === "ArrowRight") {
      answer(1);
      return true;
    }
    return false;
  });

  if (session.fatal && session.error) {
    return <ModeStartError setId={setId} title={TITLE} message={session.error} onRetry={session.retry} />;
  }

  if (phase === "leadin") {
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Get ready</p>
          <p
            key={tick}
            className="cr-pop text-[124px] font-extrabold leading-none tabular-nums text-primary sm:text-[168px]"
            aria-live="assertive"
          >
            {Math.max(1, tick)}
          </p>
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            {SPEED_ROUND_SECONDS} seconds. Pick the right definition — press <Kbd>1</Kbd> or <Kbd>2</Kbd> to go
            faster.
          </p>
        </div>
      </ModeFrame>
    );
  }

  if (phase === "done") {
    const correct = results.filter((r) => r.correct).length;
    const ranOut = results.length < prompts.length;
    return (
      <ModeFrame setId={setId} title={TITLE} subtitle={set.title}>
        <ModeOutcome
          setId={setId}
          title={ranOut ? "Time!" : "Round cleared"}
          description={
            ranOut
              ? `You got through ${results.length} of ${prompts.length} words before the clock ran out.`
              : `All ${prompts.length} words answered with ${formatClock(secondsLeft)} to spare.`
          }
          stats={[
            { label: "Correct", value: String(correct), tone: "success" },
            { label: "Accuracy", value: `${accuracyPercent(correct, results.length)}%` },
            { label: "Answered", value: `${results.length}/${prompts.length}` },
          ]}
          session={session}
          onRestart={onRestart}
          restartLabel="Race again"
        />
      </ModeFrame>
    );
  }

  return (
    <ModeFrame
      setId={setId}
      title={TITLE}
      subtitle={set.title}
      progress={(index / Math.max(1, prompts.length)) * 100}
      right={
        <>
          <ModePill>
            <Zap className="h-3.5 w-3.5" />
            {index + 1} / {prompts.length}
          </ModePill>
          <ModePill tone={secondsLeft <= URGENT_SECONDS ? "danger" : "primary"}>
            <Timer className="h-3.5 w-3.5" />
            {formatClock(secondsLeft)}
          </ModePill>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <p className="text-center text-3xl font-extrabold text-foreground sm:text-4xl">{current?.word}</p>
        <div className="grid gap-3">
          {current?.options.map((option, i) => (
            <button
              key={`${current.wordId}-${i}`}
              type="button"
              onClick={() => answer(i)}
              className={cn(
                "ds-ring cr-press flex min-h-[84px] items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left",
                "text-[15px] font-semibold text-foreground shadow-card hover:border-primary/40 hover:bg-primary-soft",
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[13px] font-bold text-muted-foreground">
                {i + 1}
              </span>
              <span>{option.text}</span>
            </button>
          ))}
        </div>
      </div>
    </ModeFrame>
  );
}

export default SpeedMode;
