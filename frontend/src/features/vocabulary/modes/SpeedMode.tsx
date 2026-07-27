"use client";

/**
 * Speed mode — sixty seconds, one word at a time, two definitions to choose
 * between. A click advances instantly: no confirm step, no feedback pause, the
 * whole point is recognition under time pressure.
 *
 * Accent: **warning** — the same one `STUDY_MODE_ACCENT.speed` gives the Speed
 * card on the set page, so the mode a student picked is the mode they land in.
 * Danger is reserved for the last ten seconds, and outranks the accent there.
 */

import { Timer, Zap } from "lucide-react";
import { useState } from "react";

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

  const end = () => {
    setPhase("done");
    session.finish();
  };

  const tick = useLeadInTicks(SPEED_LEAD_IN_TICKS, SPEED_LEAD_IN_STEP_MS, phase === "leadin", () =>
    setPhase("playing"),
  );

  const secondsLeft = useCountdownSeconds({
    durationSeconds: SPEED_ROUND_SECONDS,
    running: phase === "playing",
    onExpire: () => end(),
  });

  const current = prompts[index];

  const answer = (optionIndex: number) => {
    if (phase !== "playing" || !current) return;
    const option = current.options[optionIndex];
    if (!option) return;

    // Reported the instant it is picked: a sixty-second round is one a student
    // abandons mid-way, and the answers up to that point still count.
    session.report({ word_id: current.wordId, correct: option.correct });
    setResults([...results, { word_id: current.wordId, correct: option.correct }]);

    if (index + 1 < prompts.length) {
      setIndex(index + 1);
    } else {
      end();
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
        <div className="relative flex h-full flex-col items-center justify-center gap-7 px-4 py-10">
          {/* Ambient halo behind the digit — centred by flex so the float animation
              never fights a translate utility. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <div className="cr-float h-[min(82vw,460px)] w-[min(82vw,460px)] rounded-full bg-warning-soft" />
          </div>

          <p className="ds-overline cr-pillin relative">Get ready</p>

          {/* The digit re-mounts on every tick (keyed), so the pop replays 3 → 2 → 1. */}
          <div className="cr-pulse relative flex h-[min(56vw,224px)] w-[min(56vw,224px)] items-center justify-center rounded-full border border-warning/30 bg-card">
            <p
              key={tick}
              className="cr-celebpop ds-num text-[92px] font-extrabold leading-none tracking-[-0.05em] text-warning-foreground sm:text-[124px]"
              aria-live="assertive"
            >
              {Math.max(1, tick)}
            </p>
          </div>

          <div className="relative flex max-w-sm flex-col items-center gap-2 text-center">
            <p className="text-[15px] font-bold text-foreground">
              <span className="ds-num">{SPEED_ROUND_SECONDS}</span> seconds. Pick the right definition.
            </p>
            <p className="text-[13px] text-muted-foreground">
              Press <Kbd>1</Kbd> or <Kbd>2</Kbd> to go faster.
            </p>
          </div>
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

  const urgent = secondsLeft <= URGENT_SECONDS;
  const optionCount = current?.options.length ?? 0;

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
            <span className="ds-num">
              {index + 1} / {prompts.length}
            </span>
          </ModePill>
          {/* ModePill takes no className, so the urgency pulse rides on a wrapper. */}
          <span className={cn("inline-flex rounded-full", urgent && "animate-pulse")}>
            <ModePill tone={urgent ? "danger" : "warning"}>
              <Timer className="h-3.5 w-3.5" />
              <span className="ds-num">{formatClock(secondsLeft)}</span>
            </ModePill>
          </span>
        </>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
        {/* PROMPT — re-mounts per word so the pop marks each new card. */}
        <div
          key={index}
          className={cn(
            "cr-pop relative overflow-hidden rounded-3xl border bg-card p-6 text-center shadow-pop sm:p-8",
            urgent ? "border-danger/45" : "border-border",
          )}
        >
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full",
              urgent ? "bg-danger-soft" : "bg-warning-soft",
            )}
          />
          <p className="ds-overline relative">Which definition fits?</p>
          <p className="relative mt-3 text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[44px]">
            {current?.word}
          </p>
          <span
            className={cn(
              "ds-num relative mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-extrabold",
              urgent
                ? "animate-pulse border-danger/40 bg-danger-soft text-danger-foreground"
                : "border-border bg-surface-2 text-muted-foreground",
            )}
          >
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {formatClock(secondsLeft)}
          </span>
        </div>

        {/* CHOICES — big targets; the badge doubles as the 1 / 2 key hint. */}
        <div className={cn("grid gap-3 sm:gap-4", optionCount > 1 && "sm:grid-cols-2")}>
          {current?.options.map((option, i) => (
            <button
              key={`${current.wordId}-${i}`}
              type="button"
              onClick={() => answer(i)}
              style={{ animationDelay: `${i * 50}ms` }}
              className={cn(
                // cr-pillin, not cr-rowin: a speed round can't afford a long
                // entrance travel between words.
                // rounded-2xl matches the answer options in Matching and Test —
                // one radius for "a thing you pick" across all four modes.
                "ds-ring cr-press cr-pillin group flex min-h-[132px] flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-card sm:min-h-[156px]",
                "hover:border-warning/45 hover:bg-warning-soft active:border-warning",
              )}
            >
              {/* Soft accent fill, not a solid one: `--warning` is a light amber
                  in dark mode, so white-on-warning would fail contrast there. */}
              <span className="ds-num flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[15px] font-extrabold text-muted-foreground group-hover:bg-warning-soft group-hover:text-warning-foreground">
                {i + 1}
              </span>
              <span className="text-[16px] font-semibold leading-snug text-foreground sm:text-[17px]">
                {option.text}
              </span>
            </button>
          ))}
        </div>

        {optionCount > 1 ? (
          <p className="text-center text-[12px] font-medium text-muted-foreground">
            Press <Kbd>1</Kbd> or <Kbd>2</Kbd> — arrows work too
          </p>
        ) : null}
      </div>
    </ModeFrame>
  );
}

export default SpeedMode;
