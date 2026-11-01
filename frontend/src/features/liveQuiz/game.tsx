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
import { Check, Clock, Flame, Snowflake, Trophy, Volume2, VolumeX, X } from "lucide-react";

import { AssessmentText } from "@/lib/assessmentText";
import { cn } from "@/lib/cn";

import type { LiveChoice, LiveParticipant, PowerUpKey, TeamStanding } from "./api";
import styles from "./game.module.css";
import { POWERUPS, ordinal, tileColor } from "./theme";
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
      <span className="w-8 shrink-0 text-right font-mono text-lg font-bold tabular-nums">
        {Math.ceil(secondsLeft)}
      </span>
    </div>
  );
}

export function StreakBadge({ streak }: { streak: number }) {
  if (streak < 2) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/20 px-2.5 py-1 text-sm font-bold text-orange-200">
      <Flame className={cn("h-4 w-4 text-orange-400", styles.flame)} aria-hidden />
      {streak}
    </span>
  );
}

export function GameTopBar({
  index,
  total,
  score,
  streak,
  rank,
  muted,
  onToggleMute,
  onExit,
  children,
}: {
  index?: number;
  total?: number;
  score?: number;
  streak?: number;
  rank?: number | null;
  muted: boolean;
  onToggleMute: () => void;
  onExit?: () => void;
  /** The timer, between the counters. */
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
      {onExit && (
        <button
          type="button"
          onClick={onExit}
          aria-label="Leave the game"
          className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      )}
      {typeof index === "number" && typeof total === "number" && total > 0 && (
        <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-sm font-bold tabular-nums">
          {Math.min(index + 1, total)}/{total}
        </span>
      )}
      {/* The timer: inline on a laptop, its own full-width row on a phone, where the
          counters would otherwise squeeze it to a sliver. */}
      <div className="order-last flex w-full min-w-0 justify-center empty:hidden sm:order-none sm:w-auto sm:flex-1">
        {children}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <StreakBadge streak={streak ?? 0} />
        {typeof rank === "number" && rank > 0 && (
          <span className="hidden shrink-0 text-sm font-semibold text-white/80 sm:inline">{ordinal(rank)}</span>
        )}
        {typeof score === "number" && (
          <span className="shrink-0 rounded-full bg-white/10 px-3 py-1 font-mono text-sm font-bold tabular-nums">
            {score.toLocaleString()}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "Turn sound on" : "Turn sound off"}
          className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}

// ─── The question and its tiles ───────────────────────────────────────────────

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
  return (
    <div className={cn(styles.panel, "px-5 py-6 sm:px-8 sm:py-8", passage ? "text-left" : "text-center")}>
      {questionPrompt &&
        (passage ? (
          <div className="mb-4 max-h-[40vh] overflow-y-auto rounded-2xl bg-black/20 p-4 text-base leading-relaxed text-white/90">
            <AssessmentText text={questionPrompt} block preserveNewlines />
          </div>
        ) : (
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
            <AssessmentText text={questionPrompt} />
          </p>
        ))}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- a question figure from media storage
        <img src={image} alt="" className="mx-auto mb-4 max-h-[36vh] rounded-xl bg-white object-contain p-2" />
      )}
      <div className={cn("font-semibold leading-snug", large ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl")}>
        <AssessmentText text={prompt} block />
      </div>
    </div>
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
    <div
      className={cn(
        "grid gap-3",
        choices.length <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        choices.length === 5 && "lg:grid-cols-5",
      )}
    >
      {choices.map((choice, position) => {
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
            aria-label={`Option ${position + 1}`}
            aria-pressed={isPicked || undefined}
            className={cn(
              styles.tile,
              large ? cn(styles.tileLarge, "text-2xl") : "text-lg",
              // Room for the count bar along the bottom, clear of a two-line option.
              counts && styles.tileCounts,
              isPicked && styles.tilePicked,
              dim && styles.tileDim,
              isGone && styles.tileGone,
            )}
            style={{ background: tileColor(position), animationDelay: `${position * 45}ms` }}
          >
            <span className="absolute left-3 top-2 font-mono text-xs font-bold text-white/60">{position + 1}</span>
            <span className="flex min-w-0 flex-col items-center break-words">
              {optionImages?.[choice.id] && (
                // eslint-disable-next-line @next/next/no-img-element -- an option picture from media storage
                <img src={optionImages[choice.id]} alt="" className="mb-2 max-h-24 rounded-lg bg-white object-contain p-1" />
              )}
              <AssessmentText text={choice.text} />
            </span>
            {isRight && (
              <span className={cn("absolute right-3 top-3 rounded-full bg-white p-1 text-emerald-600", styles.pop)}>
                <Check className="h-4 w-4" aria-hidden />
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

export function FeedbackSplash({
  feedback,
  opensAt,
}: {
  feedback: OwnFeedback;
  /** When the next question appears — the bar drains to it. Null on the last one. */
  opensAt: number | null;
}) {
  const known = typeof feedback.is_correct === "boolean";
  const right = feedback.is_correct === true;
  const tone = feedback.timed_out
    ? "from-amber-500/30 to-amber-600/10 ring-amber-400/40"
    : !known
      ? "from-white/15 to-white/5 ring-white/20"
      : right
        ? "from-emerald-500/35 to-emerald-600/10 ring-emerald-400/50"
        : "from-rose-500/30 to-rose-600/10 ring-rose-400/40";
  const answer = !right ? choiceText(feedback) : null;
  const drainMs = opensAt ? Math.max(0, opensAt - feedback.receivedAt) : 0;
  const breakdown = feedback.breakdown;

  return (
    <div
      className={cn(
        styles.splash,
        !right && known && !feedback.timed_out && styles.shake,
        "mx-auto w-full max-w-lg rounded-3xl bg-gradient-to-b p-6 text-center ring-1 sm:p-8",
        tone,
      )}
      role="status"
      aria-live="polite"
    >
      <div className={cn("mx-auto flex h-16 w-16 items-center justify-center rounded-full", styles.pop,
        feedback.timed_out ? "bg-amber-400 text-amber-950" : !known ? "bg-white/80 text-slate-900" : right ? "bg-emerald-400 text-emerald-950" : "bg-rose-400 text-rose-950")}
      >
        {feedback.timed_out ? <Clock className="h-8 w-8" aria-hidden /> : right || !known ? <Check className="h-9 w-9" aria-hidden /> : <X className="h-9 w-9" aria-hidden />}
      </div>

      {feedback.second_try && (
        <p className="mt-4 text-xs font-bold uppercase tracking-widest text-cyan-200">Second chance</p>
      )}
      <p className={cn("text-3xl font-extrabold", feedback.second_try ? "mt-1" : "mt-4")}>
        {feedback.timed_out ? "Time's up" : !known ? "Answer saved" : right ? "Correct!" : "Not this time"}
      </p>

      {right && typeof feedback.points_awarded === "number" && (
        <p className={cn("mt-2 font-mono text-5xl font-black tabular-nums text-emerald-200", styles.pop)}>
          +{feedback.points_awarded.toLocaleString()}
        </p>
      )}
      {right && breakdown && (
        <p className="mt-2 text-sm text-white/70">
          {breakdown.base} for the answer
          {breakdown.speed > 0 && <> · +{breakdown.speed} for speed</>}
          {breakdown.multiplier > 1 && <> · ×{breakdown.multiplier}</>}
        </p>
      )}

      {answer && (
        <div className="mt-4 rounded-2xl bg-black/20 px-4 py-3 text-left">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/60">The answer</p>
          <p className="mt-1 font-semibold">
            <AssessmentText text={answer} />
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
        {(feedback.streak ?? 0) >= 2 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/25 px-3 py-1 font-bold text-orange-100">
            <Flame className={cn("h-4 w-4", styles.flame)} aria-hidden /> {feedback.streak} in a row
          </span>
        )}
        {typeof feedback.rank === "number" && (
          <span className="rounded-full bg-white/10 px-3 py-1 font-semibold">
            {ordinal(feedback.rank)}
            {feedback.player_count ? ` of ${feedback.player_count}` : ""}
          </span>
        )}
        {typeof feedback.score === "number" && (
          <span className="rounded-full bg-white/10 px-3 py-1 font-mono font-semibold tabular-nums">
            {feedback.score.toLocaleString()} pts
          </span>
        )}
      </div>

      {feedback.awarded && (
        <p className={cn("mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-bold text-slate-950", styles.pop)}
          style={{ background: POWERUPS[feedback.awarded].color }}
        >
          <span aria-hidden>{POWERUPS[feedback.awarded].glyph}</span>
          You earned {POWERUPS[feedback.awarded].label}!
        </p>
      )}

      {feedback.finished ? (
        <p className="mt-5 text-sm font-semibold text-white/80">That was your last question.</p>
      ) : (
        drainMs > 0 && (
          <div className="mt-6">
            <div className={styles.drain} style={{ animationDuration: `${drainMs}ms` }} />
            <p className="mt-2 text-xs text-white/60">Next question coming up…</p>
          </div>
        )
      )}
    </div>
  );
}

// ─── Power-ups ────────────────────────────────────────────────────────────────

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
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Power-ups">
      {armed.map((key) => (
        <span
          key={`armed-${key}`}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-slate-950 ring-2 ring-white"
          style={{ background: POWERUPS[key].color }}
          title={POWERUPS[key].help}
        >
          <span aria-hidden>{POWERUPS[key].glyph}</span> {POWERUPS[key].label} on
        </span>
      ))}
      {inventory.map((key, i) => (
        <button
          key={`${key}-${i}`}
          type="button"
          disabled={disabled}
          onClick={() => onUse(key)}
          title={POWERUPS[key].help}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm font-bold ring-1 ring-white/20 transition hover:bg-white/20 disabled:opacity-40"
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs text-slate-950"
            style={{ background: POWERUPS[key].color }}
            aria-hidden
          >
            {POWERUPS[key].glyph}
          </span>
          {POWERUPS[key].label}
        </button>
      ))}
    </div>
  );
}

// ─── The end ──────────────────────────────────────────────────────────────────

const PODIUM_COLORS = ["#fbbf24", "#cbd5e1", "#d08a4a"];

export function Podium({ rows }: { rows: LiveParticipant[] }) {
  const top = rows.slice(0, 3);
  // Second, first, third — the familiar shape, tallest in the middle.
  const order = [top[1], top[0], top[2]];
  const heights = [120, 170, 90];
  const places = [2, 1, 3];
  return (
    <div className="flex items-end justify-center gap-3 sm:gap-5" aria-label="Top three">
      {order.map((row, i) =>
        row ? (
          <div key={row.id} className={cn("flex w-28 flex-col items-center sm:w-36", styles.rise)}
            style={{ animationDelay: `${[400, 800, 0][i]}ms` }}
          >
            <p className="mb-2 line-clamp-2 text-center text-sm font-bold sm:text-base">{row.display_name}</p>
            <p className="mb-2 font-mono text-sm tabular-nums text-white/80">{row.score.toLocaleString()}</p>
            <div
              className={cn("flex w-full items-start justify-center rounded-t-2xl pt-3", styles.podiumBar)}
              style={{ height: heights[i], background: PODIUM_COLORS[places[i] - 1], animationDelay: `${[400, 800, 0][i]}ms` }}
            >
              <span className="text-3xl font-black text-slate-900/80">{places[i]}</span>
            </div>
          </div>
        ) : (
          <div key={`empty-${i}`} className="w-28 sm:w-36" />
        ),
      )}
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
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
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

/** The student's lobby: their own name big, and the room filling up around it. */
export function PlayerLobby({ me, participants }: { me: LiveParticipant | null; participants: LiveParticipant[] }) {
  const joined = participants.filter((p) => p.status === "JOINED");
  return (
    <CenterMessage
      title="You're in!"
      subtitle="Waiting for your teacher to start. Keep this screen open."
      icon={
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-3xl font-black text-violet-700">
          {me ? me.display_name.slice(0, 1).toUpperCase() : "★"}
        </span>
      }
    >
      {me && <p className="mt-6 text-xl font-bold">{me.display_name}</p>}
      {me && typeof me.team === "number" && (
        <p className="mt-1 inline-flex items-center gap-2 text-sm font-bold" style={{ color: tileColor(me.team) }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: tileColor(me.team) }} />
          You&apos;re on Team {TEAM_NAMES[me.team] ?? me.team + 1}
        </p>
      )}
      <p className="mt-2 text-sm text-white/60">{joined.length} in the room</p>
      <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
        {joined.slice(0, 40).map((p) => (
          <span key={p.id} className={cn("rounded-full bg-white/10 px-3 py-1 text-sm", styles.pop)}>
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
      <Trophy className={cn("mx-auto h-12 w-12 text-amber-300", styles.pop)} aria-hidden />
      <h1 className="mt-2 text-3xl font-extrabold">{title}</h1>
      {subtitle && <p className="mt-1 text-white/70">{subtitle}</p>}
    </div>
  );
}

export const TEAM_NAMES = ["Comets", "Falcons", "Tigers", "Waves", "Pixels", "Rockets"];

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
  }));
}

/** The projected lobby in team mode: one column per team; the host can move a player along. */
export function TeamColumns({
  participants,
  teams,
  onMove,
}: {
  participants: LiveParticipant[];
  teams: number;
  onMove?: (participant: LiveParticipant) => void;
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
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
                  {p.display_name}
                  {onMove && (
                    <button
                      type="button"
                      onClick={() => onMove(p)}
                      aria-label={`Move ${p.display_name} to the next team`}
                      className="rounded-full px-1 text-white/60 hover:bg-white/15 hover:text-white"
                    >
                      ⇄
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
