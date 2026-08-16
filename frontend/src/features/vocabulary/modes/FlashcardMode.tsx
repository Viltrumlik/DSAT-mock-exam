"use client";

/**
 * Flashcard mode — flip, self-grade, then drill whatever didn't stick until the
 * "still learning" pile is empty. Every verdict from every round is reported, so
 * a word answered wrong then right records both attempts and the streak-based
 * progress model sees the real history.
 *
 * A verdict does not deal the next card: it starts a five-second hold with the
 * definition face-up. The hold is the teaching, and it is also what stops the
 * mode being cleared by holding down `2` — see `lockedRef` below.
 *
 * Accent: **primary** — the same one `STUDY_MODE_ACCENT.flashcard` gives the
 * Flashcards card on the set page. The verdict buttons are danger/success
 * because they *are* the grade, not because of the accent.
 */

import { Check, Flag, RotateCcw, RotateCw, Sparkles, Timer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

import type { SessionResult, VocabSetDetail, VocabWord } from "../types";
import { Kbd, ModeBoot, ModeFrame, ModeOutcome, ModePill, ModeStartError } from "./ModeChrome";
import { useModeKeys } from "./useModeKeys";
import { useModeSession } from "./useModeSession";
import { accuracyPercent } from "./utils";

const TITLE = "Flashcards";

/**
 * How long the card holds after a verdict. Long enough that the definition is
 * actually read — the pause is study time the student was skipping, not a
 * penalty for answering.
 */
const COOLDOWN_SECONDS = 5;
const COOLDOWN_STEP_MS = 1000;

/** Non-null only while a graded card is being held. */
interface Cooldown {
  /** The verdict just given — the strip and the buttons both colour off it. */
  correct: boolean;
  secondsLeft: number;
}

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
  const [cooldown, setCooldown] = useState<Cooldown | null>(null);

  // Both piles are committed through refs rather than the state above, because
  // `answer` also runs from a window-level key handler: two events in one tick
  // would each read the same render's `results`/`missed` and the second would
  // overwrite the first, silently dropping a verdict. MatchingMode carries
  // `missedRef` for exactly this reason.
  const resultsRef = useRef<SessionResult[]>([]);
  const missedRef = useRef<VocabWord[]>([]);
  /**
   * The throttle itself, and the only one. A ref rather than `cooldown != null`
   * because a held key repeats faster than React re-renders, and because the
   * two buttons are one of *three* ways in — `useModeKeys` binds
   * `1`/`ArrowLeft`/`2`/`ArrowRight` at the window, so `disabled` on them
   * throttles nothing at all.
   */
  const lockedRef = useRef(false);

  const cooldownTimer = useRef<number | undefined>(undefined);
  // The mode is a full-screen takeover the student leaves by a client-side
  // <Link>, so no navigation event ever stops this interval: without the
  // unmount clear it keeps ticking and advances a card in a tree that is gone.
  // Same guard MatchingMode puts on its board timers.
  useEffect(() => () => window.clearInterval(cooldownTimer.current), []);

  const current = deck[index];

  /** End the hold and deal the next card — or close the round. */
  const advance = () => {
    window.clearInterval(cooldownTimer.current);
    cooldownTimer.current = undefined;
    setCooldown(null);
    setFlipped(false);
    lockedRef.current = false;

    if (index + 1 < deck.length) {
      setIndex(index + 1);
      return;
    }
    if (missedRef.current.length === 0) {
      // Already graded the instant the last verdict landed (see `answer`);
      // `finish` is a latch, so this call is only here to keep the two exits
      // honest if the round ever ends by some other path.
      setPhase("done");
      session.finish();
    } else {
      setPhase("review");
    }
  };

  const answer = (correct: boolean) => {
    if (lockedRef.current || !current) return;
    lockedRef.current = true;

    const result: SessionResult = { word_id: current.id, correct };
    resultsRef.current = [...resultsRef.current, result];
    setResults(resultsRef.current);
    if (!correct) {
      missedRef.current = [...missedRef.current, current];
      setMissed(missedRef.current);
    }
    // Reported here, not when the hold ends: a student who walks out mid-pause —
    // or after 20 of 25 cards — keeps every verdict they actually gave.
    session.report(result);

    // Graded here too, for the same reason and a sharper one: the hold opens a
    // five-second window after the *final* card in which leaving would flush the
    // session as partial, and a session that never completes scores as if the
    // game was never played. The student has finished the set by this point.
    if (index + 1 >= deck.length && missedRef.current.length === 0) session.finish();

    // The hold is meant to teach, so the answer has to be on screen for it.
    setFlipped(true);
    setCooldown({ correct, secondsLeft: COOLDOWN_SECONDS });

    // The remaining count is an interval-local instead of being read back off
    // `cooldown`: this callback is created once and would otherwise keep seeing
    // the render that started it and stall at 4. `useLeadInTicks` in ./timers
    // has the right shape but re-anchors from an effect, which paints one frame
    // of the *previous* card's leftover 0 before it resets.
    let left = COOLDOWN_SECONDS;
    cooldownTimer.current = window.setInterval(() => {
      left -= 1;
      if (left > 0) {
        setCooldown({ correct, secondsLeft: left });
        return;
      }
      advance();
    }, COOLDOWN_STEP_MS);
  };

  const practiseMissed = () => {
    // Read before the reset: `setDeck` keeps the array it was handed, so
    // re-pointing the ref afterwards cannot empty the new deck.
    setDeck(missedRef.current);
    missedRef.current = [];
    setMissed([]);
    setIndex(0);
    setFlipped(false);
    setRound(round + 1);
    setPhase("study");
  };

  // Flipping stays live during the hold — the pause is a pause, not a freeze —
  // but the verdict keys are swallowed by `answer`'s lock. They still report as
  // consumed so an arrow doesn't scroll the takeover out from under the card.
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

        {cooldown ? (
          <CooldownStrip correct={cooldown.correct} secondsLeft={cooldown.secondsLeft} />
        ) : (
          <p className="text-center text-[12px] text-muted-foreground">
            Click the card or press <Kbd>Space</Kbd> to flip · <Kbd>1</Kbd> wrong · <Kbd>2</Kbd> correct
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <VerdictButton
            tone="wrong"
            held={cooldown != null}
            chosen={cooldown?.correct === false}
            onClick={() => answer(false)}
          >
            <X className="h-5 w-5" /> Wrong
          </VerdictButton>
          <VerdictButton
            tone="correct"
            held={cooldown != null}
            chosen={cooldown?.correct === true}
            onClick={() => answer(true)}
          >
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

/**
 * The hold between a verdict and the next card. It has to read as a deliberate
 * pause: two greyed-out buttons on their own just look broken, so this names
 * what happens next and shows the time draining away.
 */
function CooldownStrip({ correct, secondsLeft }: { correct: boolean; secondsLeft: number }) {
  return (
    <div
      role="status"
      className="cr-pillin flex items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3"
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          correct ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
        )}
      >
        {correct ? (
          <Check className="h-4.5 w-4.5" aria-hidden />
        ) : (
          <RotateCcw className="h-4.5 w-4.5" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold text-foreground">
          {correct ? "Nice — sit with the definition for a beat." : "Read it through — you'll see this one again."}
        </p>
        {/* The width steps once a second; the linear tween joins the steps into
            one continuous drain. Under reduced motion the steps stay bare, which
            still reads as a countdown because the digit beside it moves too. */}
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: `${(secondsLeft / COOLDOWN_SECONDS) * 100}%` }}
          />
        </div>
      </div>
      {/* aria-hidden: `role="status"` announces the strip once when it appears,
          and a digit ticking every second would re-announce the whole thing five
          times over the top of it. */}
      <span aria-hidden>
        <ModePill tone="primary">
          <Timer className="h-3.5 w-3.5" />
          <span className="ds-num">{secondsLeft}s</span>
        </ModePill>
      </span>
    </div>
  );
}

function VerdictButton({
  tone,
  held,
  chosen,
  onClick,
  children,
}: {
  tone: "wrong" | "correct";
  /** A card is being held: neither button takes a click. */
  held: boolean;
  /** This is the verdict the student just gave. */
  chosen: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={held}
      aria-pressed={chosen}
      className={cn(
        "ds-ring cr-press inline-flex h-16 items-center justify-center gap-2.5 rounded-2xl border-2 text-[16px] font-extrabold shadow-card",
        tone === "wrong"
          ? "border-danger/25 bg-danger-soft text-danger-foreground hover:border-danger/60"
          : "border-success/25 bg-success-soft text-success-foreground hover:border-success/60",
        // Cosmetic only — the real throttle is `lockedRef`, which the window key
        // handler goes through and `disabled` never reaches. This just keeps the
        // chosen verdict readable and lets the other one recede for the hold.
        held && "pointer-events-none",
        held && !chosen && "opacity-40 shadow-none",
        chosen && (tone === "wrong" ? "border-danger" : "border-success"),
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
