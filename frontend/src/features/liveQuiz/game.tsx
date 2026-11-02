"use client";

/**
 * The game kit: the full-screen canvas, the bar across the top, the answer tiles, the
 * "how did I do" splash, the power-up bar and the podium.
 *
 * Every piece draws state the server already decided. A tile press sends an answer and
 * waits; nothing here marks anything right or wrong on its own.
 */

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ChevronsUp,
  Clock,
  Eraser,
  Flame,
  Loader2,
  RotateCw,
  Shield,
  Snowflake,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";

import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import type { AvatarWire, LiveChoice, LiveParticipant, PowerUpKey, TeamStanding } from "./api";
import styles from "./game.module.css";
import { AvatarDisc, GemIcon, PlayerAvatar, type AvatarFace } from "./avatars";
import { POWERUPS, ordinal, shortName, tileColor, tileShape, type TileShape } from "./theme";
import type { OwnFeedback } from "./useLiveQuiz";

// ─── Canvas and top bar ───────────────────────────────────────────────────────

/**
 * The full-screen game, drawn on `document.body` rather than where it is rendered.
 *
 * The app shell animates its page area with a transform, and a transformed ancestor becomes
 * the box a `position: fixed` child is fixed to — so in place, the "full screen" filled only
 * the content column, under the shell's own header and sidebar. A portal puts it above both.
 */
export function GameCanvas({ children, className }: { children: React.ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // The page behind must not scroll under a thumb that meant to scroll the game.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div className={cn(styles.canvas, className)} data-testid="live-game-canvas">
      {children}
    </div>,
    document.body,
  );
}

export function GamePanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(styles.panel, className)}>{children}</div>;
}

export function TimerBar({
  secondsLeft,
  totalSeconds,
  frozen,
}: {
  secondsLeft: number | null;
  totalSeconds: number;
  frozen?: boolean;
}) {
  if (frozen) {
    return (
      <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
        <Snowflake className="h-4 w-4" aria-hidden /> Clock stopped
      </div>
    );
  }
  if (secondsLeft === null || totalSeconds <= 0) return null;
  const fraction = Math.max(0, Math.min(1, secondsLeft / totalSeconds));
  const color = fraction > 0.5 ? "#a3e635" : fraction > 0.25 ? "#facc15" : "#fb7185";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${Math.ceil(secondsLeft)} seconds left`}>
      <div className={cn(styles.timerBar, "min-w-0 flex-1")}>
        <div className={styles.timerFill} style={{ width: `${fraction * 100}%`, background: color }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-[22px] font-extrabold tabular-nums">
        {Math.ceil(secondsLeft)}
      </span>
    </div>
  );
}

export function StreakBadge({ streak, className }: { streak: number; className?: string }) {
  if (streak < 2) return null;
  return (
    <span className={cn("h-10 shrink-0 items-center gap-1.5 rounded-full bg-orange-400/15 px-3.5 text-base font-extrabold", className ?? "inline-flex")}>
      <Flame className={cn("h-[18px] w-[18px] text-orange-400", styles.flame)} aria-hidden />
      {streak}
    </span>
  );
}

const ROUND_BUTTON =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white transition-colors hover:bg-white/15";

export function GameTopBar({
  index,
  total,
  score,
  streak,
  rank,
  team,
  avatar,
  name,
  muted,
  onToggleMute,
  onExit,
  timer,
  children,
}: {
  index?: number;
  total?: number;
  score?: number;
  streak?: number;
  rank?: number | null;
  /** Team mode: this student's team, as a chip in its colour (the name from a laptop up). */
  team?: number | null;
  /** Whose score it is: their avatar sits beside the number. */
  avatar?: AvatarWire | null;
  name?: string;
  muted: boolean;
  onToggleMute: () => void;
  onExit?: () => void;
  /** The student's timer, on its own row, where the counters cannot squeeze it. */
  timer?: React.ReactNode;
  /** The host's controls, between the counters. */
  children?: React.ReactNode;
}) {
  const hasIndex = typeof index === "number" && typeof total === "number" && total > 0;
  return (
    <div className="sticky top-0 z-10 space-y-3 px-4 pb-2 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {onExit && (
          <button type="button" onClick={onExit} aria-label="Leave the game" className={ROUND_BUTTON}>
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        )}
        {hasIndex && (
          <span className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-white/10 px-3.5 font-mono text-base font-extrabold tabular-nums">
            {Math.min(index + 1, total)} / {total}
          </span>
        )}
        {typeof team === "number" && (
          <span
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-sm font-bold"
            title={`Team ${TEAM_NAMES[team] ?? team + 1}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: tileColor(team) }} aria-hidden />
            <span className="sr-only sm:not-sr-only">Team {TEAM_NAMES[team] ?? team + 1}</span>
          </span>
        )}
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
        {/* A phone has room for the question number or the streak, not both; the feedback
            screen says the streak after every answer anyway. */}
        <StreakBadge streak={streak ?? 0} className={hasIndex ? "hidden sm:inline-flex" : "inline-flex"} />
        {typeof rank === "number" && rank > 0 && (
          <span className="hidden shrink-0 px-1 text-sm font-semibold text-white/80 sm:inline">{ordinal(rank)}</span>
        )}
        {typeof score === "number" && (
          <span className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/10 pr-3.5", name ? "pl-1" : "pl-3.5")}>
            {name && <AvatarDisc avatar={avatar} name={name} size={32} still />}
            <span className="font-mono text-base font-extrabold tabular-nums">{score.toLocaleString()}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          className={ROUND_BUTTON}
        >
          {muted ? <VolumeX className="h-[18px] w-[18px]" aria-hidden /> : <Volume2 className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      </div>
      {timer}
    </div>
  );
}

// ─── The question and its tiles ───────────────────────────────────────────────

/** A word is the whole question and reads large; a sentence or a passage does not. */
const SHORT_PROMPT = 40;

export function QuestionCard({
  prompt,
  questionPrompt,
  image,
  large,
}: {
  prompt: string;
  questionPrompt?: string;
  /** An SAT question's figure. */
  image?: string | null;
  large?: boolean;
}) {
  // A word question's "question prompt" is a one-line instruction; an SAT one's is a passage,
  // which reads as a passage — left-aligned, and scrolling on its own if it is long.
  const passage = Boolean(questionPrompt && questionPrompt.length > 120);
  const short = prompt.length <= SHORT_PROMPT;
  return (
    <div className={cn(styles.panel, "px-[18px] py-[22px] sm:px-8 sm:py-8", passage ? "text-left" : "text-center")}>
      {questionPrompt &&
        (passage ? (
          <div className="mb-4 max-h-[40vh] overflow-y-auto rounded-2xl bg-black/20 p-4 text-base leading-relaxed text-white/90">
            <AssessmentText text={questionPrompt} block preserveNewlines />
          </div>
        ) : (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-white/70">
            <AssessmentText text={questionPrompt} />
          </p>
        ))}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- a question figure from media storage
        <img src={image} alt="" className="mx-auto mb-4 max-h-[36vh] rounded-xl bg-white object-contain p-2" />
      )}
      <div
        className={cn(
          "leading-snug",
          short ? "font-extrabold" : "font-semibold",
          short
            ? large
              ? "text-4xl sm:text-5xl"
              : "text-[32px] sm:text-4xl"
            : large
              ? "text-3xl sm:text-4xl"
              : "text-xl sm:text-2xl",
        )}
      >
        <AssessmentText text={prompt} block />
      </div>
    </div>
  );
}

function ShapeIcon({ shape, size = 22 }: { shape: TileShape; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" aria-hidden className="shrink-0">
      {shape === "Triangle" && <polygon points="12,3.5 21.5,20 2.5,20" />}
      {shape === "Diamond" && <polygon points="12,2 22,12 12,22 2,12" />}
      {shape === "Circle" && <circle cx="12" cy="12" r="9.5" />}
      {shape === "Square" && <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />}
      {shape === "Star" && <polygon points="12,2.5 14.9,8.6 21.5,9.5 16.7,14.1 17.9,20.7 12,17.5 6.1,20.7 7.3,14.1 2.5,9.5 9.1,8.6" />}
    </svg>
  );
}

export function AnswerTiles({
  choices,
  onPick,
  picked,
  hidden,
  correctId,
  counts,
  disabled,
  large,
  optionImages,
}: {
  /** SAT options that are pictures, keyed by choice id. */
  optionImages?: Record<string, string>;
  /** Already in display order. Colours follow position, so a shuffled student sees their own colours. */
  choices: LiveChoice[];
  onPick?: (choiceId: string) => void;
  picked?: string | null;
  hidden?: string[];
  /** Once known: the right option glows and the rest step back. */
  correctId?: string | null;
  /** Host, after the reveal: how many chose each. */
  counts?: Record<string, number>;
  disabled?: boolean;
  large?: boolean;
}) {
  const gone = useMemo(() => new Set(hidden ?? []), [hidden]);
  const interactive = Boolean(onPick) && !disabled;

  // Number keys answer on a laptop: 1 is the first tile on screen.
  useEffect(() => {
    if (!interactive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > choices.length) return;
      const choice = choices[n - 1];
      if (choice && !gone.has(choice.id)) onPick?.(choice.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, choices, gone, onPick]);

  const most = counts ? Math.max(1, ...Object.values(counts)) : 1;
  const norm = (value: unknown) => String(value ?? "").trim().toUpperCase();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {choices.map((choice, position) => {
        const shape = tileShape(position);
        const isGone = gone.has(choice.id);
        const isPicked = picked != null && norm(picked) === norm(choice.id);
        const isRight = correctId != null && norm(correctId) === norm(choice.id);
        const dim = (picked != null && !isPicked && correctId == null) || (correctId != null && !isRight);
        return (
          <button
            key={choice.id}
            type="button"
            disabled={!interactive || isGone}
            onClick={() => onPick?.(choice.id)}
            aria-label={`${shape}, option ${position + 1}: ${choice.text}`}
            aria-pressed={isPicked || undefined}
            className={cn(
              styles.tile,
              large ? cn(styles.tileLarge, "text-2xl") : "text-[19px] leading-snug",
              // Room for the count bar along the bottom, clear of a two-line option.
              counts && styles.tileCounts,
              isPicked && styles.tilePicked,
              dim && styles.tileDim,
              isGone && styles.tileGone,
            )}
            style={{ background: tileColor(position), animationDelay: `${position * 45}ms` }}
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-black/20">
              <ShapeIcon shape={shape} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-start break-words">
              {optionImages?.[choice.id] && (
                // eslint-disable-next-line @next/next/no-img-element -- an option picture from media storage
                <img src={optionImages[choice.id]} alt="" className="mb-2 max-h-24 rounded-lg bg-white object-contain p-1" />
              )}
              <AssessmentText text={choice.text} />
            </span>
            {isRight ? (
              <span className={cn("absolute right-2 top-2 rounded-full bg-white p-1 text-emerald-600", styles.pop)}>
                <Check className="h-4 w-4" aria-hidden />
              </span>
            ) : (
              <span
                aria-hidden
                className="absolute right-2.5 top-2.5 flex h-[22px] w-[22px] items-center justify-center rounded-md bg-black/30 text-xs font-extrabold"
              >
                {position + 1}
              </span>
            )}
            {counts && (
              <span className="absolute inset-x-3 bottom-2 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/25">
                  <span
                    className="block h-full rounded-full bg-white/90"
                    style={{ width: `${((counts[choice.id] ?? 0) / most) * 100}%` }}
                  />
                </span>
                <span className="font-mono text-sm tabular-nums">{counts[choice.id] ?? 0}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── After an answer ──────────────────────────────────────────────────────────

function choiceText(feedback: OwnFeedback): string | null {
  const id = String(feedback.correct_answer ?? "").toUpperCase();
  if (!id) return null;
  const found = feedback.question?.choices.find((c) => c.id.toUpperCase() === id);
  return found ? found.text : String(feedback.correct_answer);
}

/** Each verdict's colour, as the "r, g, b" the card's border and wash are mixed from. */
function splashTone(feedback: OwnFeedback): { rgb: string; points: string; face: AvatarFace } {
  if (feedback.timed_out) return { rgb: "245, 158, 11", points: "#fcd34d", face: "thinking" };
  if (feedback.is_correct === true) return { rgb: "16, 185, 129", points: "#6ee7b7", face: "right" };
  if (feedback.is_correct === false) return { rgb: "244, 63, 94", points: "#fda4af", face: "oops" };
  return { rgb: "255, 255, 255", points: "#ffffff", face: "waiting" };
}

export function FeedbackSplash({
  feedback,
  opensAt,
  avatar,
  name,
}: {
  feedback: OwnFeedback;
  /** When the next question appears — the bar drains to it. Null on the last one. */
  opensAt: number | null;
  /** The student's own character, who takes the news above the card. */
  avatar?: AvatarWire | null;
  name?: string;
}) {
  const known = typeof feedback.is_correct === "boolean";
  const right = feedback.is_correct === true;
  const tone = splashTone(feedback);
  const answer = !right ? choiceText(feedback) : null;
  const drainMs = opensAt ? Math.max(0, opensAt - feedback.receivedAt) : 0;
  const breakdown = feedback.breakdown;

  return (
    <div
      className={cn(styles.splash, !right && known && !feedback.timed_out && styles.shake, "mx-auto flex w-full max-w-lg flex-col items-center")}
      role="status"
      aria-live="polite"
    >
      <div className={cn("relative z-[1]", styles.bob)}>
        <span
          className="flex h-[156px] w-[156px] items-center justify-center rounded-full"
          style={{ background: "rgba(18, 13, 38, 0.9)", boxShadow: `0 0 0 6px rgba(${tone.rgb}, 0.25)` }}
        >
          {avatar ? (
            <PlayerAvatar avatar={avatar} name={name ?? ""} size={128} face={tone.face} />
          ) : feedback.timed_out ? (
            <Clock className="h-16 w-16 text-amber-300" aria-hidden />
          ) : right || !known ? (
            <Check className="h-16 w-16 text-emerald-300" aria-hidden />
          ) : (
            <X className="h-16 w-16 text-rose-300" aria-hidden />
          )}
        </span>
      </div>

      <div
        className="-mt-10 flex w-full flex-col items-center gap-2 rounded-[28px] px-[22px] pb-6 pt-[52px] text-center"
        style={{
          border: `1px solid rgba(${tone.rgb}, 0.55)`,
          background: `linear-gradient(180deg, rgba(${tone.rgb}, 0.28), rgba(${tone.rgb}, 0.08))`,
        }}
      >
        {feedback.second_try && (
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-200">Second chance</p>
        )}
        <p className="text-[34px] font-extrabold leading-tight">
          {feedback.timed_out ? "Time's up" : !known ? "Answer saved" : right ? "Correct!" : "Not this time"}
        </p>

        {right && typeof feedback.points_awarded === "number" && (
          <p className={cn("font-mono text-[60px] font-extrabold leading-none tabular-nums", styles.pop)} style={{ color: tone.points }}>
            +{feedback.points_awarded.toLocaleString()}
          </p>
        )}
        {right && breakdown && (
          <p className="text-[15px] text-white/80">
            {breakdown.base} for the answer
            {breakdown.speed > 0 && <> · +{breakdown.speed} for speed</>}
            {breakdown.multiplier > 1 && <> · ×{breakdown.multiplier}</>}
          </p>
        )}

        {answer && (
          <div className="mt-1 w-full rounded-2xl bg-black/20 px-4 py-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">The answer</p>
            <p className="mt-1 font-semibold">
              <AssessmentText text={answer} />
            </p>
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm font-bold">
          {(feedback.streak ?? 0) >= 2 && (
            <span className="inline-flex h-[34px] items-center gap-1.5 rounded-full bg-white/[0.12] px-3">
              <Flame className={cn("h-4 w-4 text-orange-400", styles.flame)} aria-hidden /> {feedback.streak} in a row
            </span>
          )}
          {typeof feedback.rank === "number" && (
            <span className="inline-flex h-[34px] items-center rounded-full bg-white/[0.12] px-3">
              {ordinal(feedback.rank)}
              {feedback.player_count ? ` of ${feedback.player_count}` : ""}
            </span>
          )}
          {typeof feedback.score === "number" && (
            <span className="inline-flex h-[34px] items-center rounded-full bg-white/[0.12] px-3 font-mono tabular-nums">
              {feedback.score.toLocaleString()} pts
            </span>
          )}
        </div>

        {feedback.awarded && (
          <p
            className={cn("mt-1 inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-bold text-slate-950", styles.pop)}
            style={{ background: POWERUPS[feedback.awarded].color }}
          >
            <PowerUpIcon powerUp={feedback.awarded} color="currentColor" />
            You earned {POWERUPS[feedback.awarded].label}!
          </p>
        )}

        {feedback.finished ? (
          <p className="mt-2 text-sm font-semibold text-white/80">That was your last question.</p>
        ) : (
          drainMs > 0 && (
            <div className="mt-3 w-full">
              <div className={styles.drain} style={{ animationDuration: `${drainMs}ms` }} />
              <p className="mt-2 text-[13px] text-white/70">Next question coming up…</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Power-ups ────────────────────────────────────────────────────────────────

export function PowerUpIcon({ powerUp, color, size = 17 }: { powerUp: PowerUpKey; color?: string; size?: number }) {
  const stroke = color ?? POWERUPS[powerUp].color;
  const common = { width: size, height: size, color: stroke, strokeWidth: 2.2, "aria-hidden": true, className: "shrink-0" } as const;
  if (powerUp === "double") return <ChevronsUp {...common} />;
  if (powerUp === "eraser") return <Eraser {...common} />;
  if (powerUp === "streak_saver") return <Shield {...common} />;
  if (powerUp === "time_freeze") return <Snowflake {...common} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill={stroke} />
    </svg>
  );
}

export function PowerUpBar({
  inventory,
  armed,
  onUse,
  disabled,
}: {
  inventory: PowerUpKey[];
  armed: PowerUpKey[];
  onUse: (key: PowerUpKey) => void;
  disabled?: boolean;
}) {
  if (inventory.length === 0 && armed.length === 0) return null;
  const chip = (key: PowerUpKey) => (
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
      style={{ background: `${POWERUPS[key].color}29` }}
    >
      <PowerUpIcon powerUp={key} />
    </span>
  );
  return (
    <div className="mx-auto flex w-full max-w-xl flex-wrap justify-center gap-2" aria-label="Power-ups">
      {armed.map((key) => (
        <span
          key={`armed-${key}`}
          className="flex h-12 w-[calc((100%-1rem)/3)] min-w-0 items-center gap-2 rounded-[14px] border-2 border-white bg-white/[0.14] px-2.5 text-[13px] font-bold leading-tight"
          title={POWERUPS[key].help}
        >
          {chip(key)}
          {POWERUPS[key].label} on
        </span>
      ))}
      {inventory.map((key, i) => (
        <button
          key={`${key}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => onUse(key)}
          title={POWERUPS[key].help}
          aria-label={`Use ${POWERUPS[key].label}: ${POWERUPS[key].help}`}
          className="flex h-12 w-[calc((100%-1rem)/3)] min-w-0 items-center gap-2 rounded-[14px] border border-white/[0.14] bg-white/[0.08] px-2.5 text-left text-[13px] font-bold leading-tight transition hover:bg-white/15 disabled:opacity-40"
        >
          {chip(key)}
          {POWERUPS[key].label}
        </button>
      ))}
    </div>
  );
}

// ─── The end ──────────────────────────────────────────────────────────────────

const PODIUM_COLORS = ["#fbbf24", "#cbd5e1", "#d08a4a"];

/** Second, first, third in every list below: the familiar shape, tallest in the middle. */
const PODIUM_SIZES = {
  // Inside the student's summary, on a phone.
  small: { width: "w-24 sm:w-32", discs: [58, 72, 54], bars: [90, 130, 70], name: "text-sm" },
  // One of two panels on the projector (team mode).
  panel: { width: "w-24 sm:w-40 xl:w-[180px]", discs: [80, 80, 80], bars: [125, 170, 90], name: "text-[17px]" },
  // The whole projector.
  stage: { width: "w-24 sm:w-[230px]", discs: [116, 140, 108], bars: [120, 165, 85], name: "text-[17px]" },
} as const;

/** On a phone the stage's discs are wider than their columns. */
const STAGE_DISC_ON_PHONE = "origin-bottom max-sm:scale-75";

export function Podium({ rows, size = "small" }: { rows: LiveParticipant[]; size?: keyof typeof PODIUM_SIZES }) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const places = [2, 1, 3];
  const look = PODIUM_SIZES[size];
  return (
    <div className="flex items-end justify-center gap-3 sm:gap-4" aria-label="Top three">
      {order.map((row, i) =>
        row ? (
          <div key={row.id} className={cn("flex flex-col items-center", look.width, styles.rise)}
            style={{ animationDelay: `${[400, 800, 0][i]}ms` }}
          >
            <AvatarDisc
              avatar={row.avatar}
              name={row.display_name}
              size={look.discs[i]}
              face={row.avatar ? "right" : undefined}
              colorIndex={row.team ?? 0}
              background="rgba(255, 255, 255, 0.08)"
              className={size === "stage" ? STAGE_DISC_ON_PHONE : undefined}
            />
            <p className={cn("mt-2 line-clamp-2 max-w-full text-center font-bold", look.name)}>{row.display_name}</p>
            <p className="mt-0.5 font-mono text-[15px] tabular-nums text-white/80">{row.score.toLocaleString()}</p>
            <div
              className={cn("mt-2.5 flex w-full justify-center pt-2.5", styles.podiumBar)}
              style={{
                height: look.bars[i],
                borderRadius: "16px 16px 0 0",
                background: `linear-gradient(180deg, ${PODIUM_COLORS[places[i] - 1]}, ${PODIUM_COLORS[places[i] - 1]}cc)`,
                animationDelay: `${[400, 800, 0][i]}ms`,
              }}
            >
              <span className="font-mono text-[34px] font-black leading-tight" style={{ color: "rgba(18, 13, 38, 0.72)" }}>
                {places[i]}
              </span>
            </div>
          </div>
        ) : (
          <div key={`empty-${i}`} className={look.width} />
        ),
      )}
    </div>
  );
}

/** Everybody after the podium, as chips: the whole class is on the screen and none of it scrolls. */
export function RestChips({ rows }: { rows: LiveParticipant[] }) {
  if (rows.length === 0) return null;
  return (
    <div className={cn(styles.panel, "flex flex-wrap justify-center gap-2 px-4 py-3")}>
      {rows.map((row, index) => (
        <span key={row.id} className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] py-1 pl-1.5 pr-3">
          <span className="w-6 text-right font-mono text-[13px] font-extrabold text-white/70">{row.rank ?? index + 4}</span>
          <PlayerAvatar avatar={row.avatar} name={row.display_name} size={28} colorIndex={index} still />
          <span className="text-sm font-semibold">{shortName(row.display_name)}</span>
          <span className="font-mono text-[13px] tabular-nums text-white/75">{row.score.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

export function Confetti({ pieces = 70 }: { pieces?: number }) {
  // Positions are random once per mount, not per render.
  const [bits] = useState(() =>
    Array.from({ length: pieces }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      duration: 2.4 + Math.random() * 2,
      color: ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"][i % 5],
    })),
  );
  return (
    // Above the panels: behind them, their backdrop blur turns every piece into a smudge.
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {bits.map((bit, i) => (
        <span
          key={i}
          className={styles.confetti}
          style={{
            left: `${bit.left}%`,
            background: bit.color,
            animationDelay: `${bit.delay}s`,
            animationDuration: `${bit.duration}s`,
          }}
        />
      ))}
    </div>
  );
}

export function FinalStandings({
  rows,
  highlightUserId,
  limit,
}: {
  rows: LiveParticipant[];
  highlightUserId?: number | null;
  limit?: number;
}) {
  const shown = typeof limit === "number" ? rows.slice(0, limit) : rows;
  return (
    <ol className="space-y-1.5">
      {shown.map((row, index) => {
        const place = row.rank ?? index + 1;
        const isMe = highlightUserId != null && row.user_id === highlightUserId;
        return (
          <li
            key={row.id}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5",
              isMe ? "bg-white/20 ring-1 ring-white/40" : "bg-white/[0.06]",
            )}
          >
            <span className="w-7 shrink-0 text-center text-sm font-black tabular-nums" style={{ color: place <= 3 ? PODIUM_COLORS[place - 1] : undefined }}>
              {place}
            </span>
            <PlayerAvatar avatar={row.avatar} name={row.display_name} size={28} colorIndex={index} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {row.display_name}
              {isMe && <span className="ml-1.5 text-xs text-white/70">you</span>}
            </span>
            {(row.best_streak ?? 0) >= 3 && (
              <span className="hidden items-center gap-0.5 text-xs text-orange-300 sm:inline-flex">
                <Flame className="h-3.5 w-3.5" aria-hidden />
                {row.best_streak}
              </span>
            )}
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{row.score.toLocaleString()}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A confirm box drawn inside the canvas. The app's own dialog sits below the canvas's layer,
 * so on a full-screen game it would open behind it, where nobody can press it.
 */
export function GameConfirm({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn(styles.splash, "w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900 shadow-2xl")}>
        <p className="text-lg font-bold">{title}</p>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A waiting screen: lobby, countdown, paused, stopped. */
export function CenterMessage({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className={styles.pop}>{icon}</div>}
      <p className={cn("mt-4 text-3xl font-extrabold sm:text-4xl", styles.rise)}>{title}</p>
      {subtitle && <p className="mt-2 max-w-md text-white/70">{subtitle}</p>}
      {children}
    </div>
  );
}

/**
 * When the connection drags on: what is still known, and two ways out. Saying "lost contact" and
 * spinning forever is what sent students to ask their teacher whether the code was wrong.
 */
export function ReconnectScreen({
  code,
  gameRunning,
  attempt,
  onRetry,
  onExit,
  leaveHref = "/live",
}: {
  code?: string;
  gameRunning?: boolean;
  attempt?: number;
  onRetry: () => void;
  onExit?: () => void;
  leaveHref?: string;
}) {
  const row = "flex items-center gap-3 py-3 text-sm";
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-4 px-4 pb-10 pt-4 text-center" role="status">
      {onExit && (
        <div className="flex w-full">
          <button type="button" onClick={onExit} aria-label="Leave the game" className={ROUND_BUTTON}>
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
      )}
      <div className="mt-8 flex h-20 w-20 items-center justify-center rounded-full border border-amber-400/35 bg-amber-400/15">
        <WifiOff className="h-[34px] w-[34px] text-amber-300" aria-hidden />
      </div>
      <h1 className="text-[26px] font-extrabold leading-tight">Taking longer than usual</h1>
      <p className="max-w-[310px] text-[15px] leading-relaxed text-white/80">
        We can&apos;t reach the game right now. Your place and your points are saved.
      </p>
      <div className={cn(styles.panel, "w-full divide-y divide-white/10 px-4 py-1 text-left")}>
        {code && (
          <div className={row}>
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            <span>
              Code <b className="font-mono tabular-nums">{code}</b> found
            </span>
          </div>
        )}
        {gameRunning && (
          <div className={row}>
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
            <span>The game is running</span>
          </div>
        )}
        <div className={row}>
          <Loader2 className="h-5 w-5 shrink-0 text-amber-300 motion-safe:animate-spin" aria-hidden />
          <span>Reconnecting{attempt ? ` · attempt ${attempt}` : "…"}</span>
        </div>
      </div>
      <div className="flex w-full flex-col gap-2.5">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-white text-[17px] font-extrabold text-violet-700 shadow-[inset_0_-4px_0_rgba(109,40,217,0.16)]"
        >
          <RotateCw className="h-5 w-5" aria-hidden /> Try again
        </button>
        <Link
          href={leaveHref}
          className="inline-flex h-[52px] items-center justify-center rounded-[14px] border border-white/20 bg-white/[0.08] text-base font-bold text-white hover:bg-white/15"
        >
          Enter a different code
        </Link>
      </div>
      <p className="text-[13px] text-white/70">Still stuck? Ask your teacher to check the lobby.</p>
    </div>
  );
}

/** The student's lobby: their own name big, and the room filling up around it. */
export function PlayerLobby({ me, participants }: { me: LiveParticipant | null; participants: LiveParticipant[] }) {
  const joined = participants.filter((p) => p.status === "JOINED");
  return (
    <CenterMessage
      title="You're in!"
      subtitle="Waiting for your teacher to start. Keep this screen open."
      icon={
        me?.avatar ? (
          <AvatarDisc avatar={me.avatar} name={me.display_name} size={136} background="rgba(255, 255, 255, 0.1)" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-3xl font-black text-violet-700">
            {me ? me.display_name.slice(0, 1).toUpperCase() : "★"}
          </span>
        )
      }
    >
      {me && <p className="mt-6 text-xl font-bold">{me.display_name}</p>}
      {me && (
        <Link href="/live/shop" className="mt-1 inline-flex items-center gap-1 text-sm text-cyan-200 hover:underline">
          <GemIcon size={14} /> {me.avatar ? "Change your avatar" : "Pick an avatar in the shop"}
        </Link>
      )}
      {me && typeof me.team === "number" && (
        <p className="mt-1 inline-flex items-center gap-2 text-sm font-bold" style={{ color: tileColor(me.team) }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: tileColor(me.team) }} />
          You&apos;re on Team {TEAM_NAMES[me.team] ?? me.team + 1}
        </p>
      )}
      <p className="mt-2 text-sm text-white/60">{joined.length} in the room</p>
      <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
        {joined.slice(0, 40).map((p, i) => (
          <span key={p.id} className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1 pr-3 text-sm", styles.pop)}>
            <PlayerAvatar avatar={p.avatar} name={p.display_name} size={24} colorIndex={i} />
            {p.display_name}
          </span>
        ))}
      </div>
    </CenterMessage>
  );
}

export function TrophyHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center">
      <Trophy className={cn("mx-auto h-11 w-11 text-amber-400", styles.pop)} aria-hidden />
      <h1 className="mt-2 text-[30px] font-extrabold leading-tight sm:text-[44px]">{title}</h1>
      {subtitle && <p className="mt-1 text-[15px] text-white/70 sm:text-base">{subtitle}</p>}
    </div>
  );
}

export const TEAM_NAMES = ["Comets", "Falcons", "Meteors", "Waves", "Pixels", "Rockets"];

/** Team mode: the teams as podium rows, so the same podium draws them. */
export function teamRows(teams: TeamStanding[]): LiveParticipant[] {
  return teams.map((team) => ({
    id: team.team,
    user_id: -1 - team.team,
    display_name: `Team ${team.name}`,
    status: "JOINED",
    present: true,
    score: team.score,
    correct_count: 0,
    answered_count: 0,
    rank: team.rank,
    team: team.team,
  }));
}

/** The projected lobby in team mode: one column per team; the host can move a player along. */
export function TeamColumns({
  participants,
  teams,
  onMove,
  onRemove,
}: {
  participants: LiveParticipant[];
  teams: number;
  onMove?: (participant: LiveParticipant) => void;
  onRemove?: (participant: LiveParticipant) => void;
}) {
  return (
    <div className="grid w-full gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(teams, 3)}, minmax(0, 1fr))` }}>
      {Array.from({ length: teams }, (_, team) => {
        const members = participants.filter((p) => p.team === team);
        return (
          <div key={team} className={cn(styles.panel, "p-3")}>
            <p className="mb-2 flex items-center gap-2 text-sm font-extrabold">
              <span className="h-3 w-3 rounded-full" style={{ background: tileColor(team) }} />
              Team {TEAM_NAMES[team] ?? team + 1}
              <span className="ml-auto text-xs font-semibold text-white/60">{members.length}</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {members.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-1.5 text-sm font-semibold"
                  style={{ opacity: p.present ? 1 : 0.5 }}
                >
                  <AvatarDisc avatar={p.avatar} name={p.display_name} size={40} colorIndex={team} still />
                  {p.display_name}
                  {onMove && (
                    <button
                      type="button"
                      onClick={() => onMove(p)}
                      aria-label={`Move ${p.display_name} to the next team`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white"
                    >
                      ⇄
                    </button>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(p)}
                      aria-label={`Remove ${p.display_name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 hover:bg-white/15 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
