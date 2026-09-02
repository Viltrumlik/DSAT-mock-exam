"use client";

/**
 * Chrome shared by the four study modes: the full-screen frame with its
 * permanent "Back to vocabulary" exit, the load/empty/error boot sequence, and
 * the end-of-round outcome card.
 *
 * These modes are immersive takeovers (`fixed inset-0 z-50`) — StudentAppShell
 * routes them past its scroll container so the layer isn't trapped in the
 * shell's stacking context.
 *
 * Visually this is the student design language, not a bespoke one: the slim top
 * bar mirrors the app header, the outcome screen borrows the gradient hero and
 * the `cr-*` celebration motion from the results/homework surfaces, and every
 * number is `.ds-num` so digits don't jitter as a clock or counter ticks.
 */

import { AlertTriangle, ArrowLeft, BookOpen, RotateCcw, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Badge, Button, EmptyState, Progress, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

import { useVocabSet } from "../hooks";
import { useLaunchAssignmentId, withLaunchAssignment } from "../launchContext";
import type { VocabSetDetail } from "../types";
import { useDistractorPool } from "./useDistractorPool";
import type { ModeSession } from "./useModeSession";
import type { DistractorWord } from "./utils";

export const setHref = (setId: number) => `/vocabulary/sets/${setId}`;

/**
 * Every way out of a mode leads back to the set page — and must carry the
 * homework this run was launched from with it. Dropping it here is not
 * cosmetic: the set's score is the mean over four games, so a student who plays
 * flashcards from Monday's homework, walks back and starts matching would have
 * the second game bound by the server's guess instead, splitting one homework's
 * work across two assignments.
 */
function useSetHref(setId: number): string {
  const assignmentId = useLaunchAssignmentId();
  return withLaunchAssignment(setHref(setId), assignmentId);
}

/**
 * The takeover renders outside the student shell, so it carries the app's face
 * itself — same declaration the student pages use.
 */
const MODE_FONT: CSSProperties = { fontFamily: "var(--font-plus-jakarta), system-ui, sans-serif" };

interface ModeFrameProps {
  setId: number;
  title: string;
  subtitle?: string;
  /** Header slot — timers and counters live here. */
  right?: ReactNode;
  /** 0–100; renders a hairline bar under the header when given. */
  progress?: number;
  children: ReactNode;
}

export function ModeFrame({ setId, title, subtitle, right, progress, children }: ModeFrameProps) {
  const backHref = useSetHref(setId);
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" style={MODE_FONT}>
      {/* Progress rides the very top edge of the takeover. The empty rail keeps
          the header from jumping 6px when a mode boots without one. */}
      {/* The rail mirrors `Progress`'s own shape (h-1.5, rounded-full) rather
          than trying to square it off: `cn` is a naive join, so a `rounded-none`
          here would lose to the primitive's `rounded-full` anyway. */}
      {progress != null ? (
        <Progress value={progress} size="sm" className="shrink-0" label="Round progress" />
      ) : (
        <div className="h-1.5 shrink-0 rounded-full bg-surface-2" aria-hidden />
      )}

      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2.5 sm:px-5">
        <Link
          href={backHref}
          className="ds-ring inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1.5 text-[13px] font-bold text-muted-foreground transition-[color,border-color,background-color] duration-150 hover:border-border-strong hover:text-foreground sm:px-3"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Back to vocabulary</span>
          <span className="sm:hidden">Back</span>
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-extrabold leading-tight tracking-[-0.01em] text-foreground">
            {title}
          </p>
          {subtitle ? (
            <p className="truncate text-[11px] font-semibold leading-tight text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">{right}</div>
      </header>

      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * Header pill for a clock or a counter. The four accent tones mirror
 * `STUDY_MODE_ACCENT` in `components/StudyModeCard` — a mode's header pill
 * carries the same colour its launcher card does on the set page.
 */
export function ModePill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "info" | "warning" | "success" | "danger";
}) {
  return (
    <span
      className={cn(
        "ds-num inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-extrabold shadow-card",
        tone === "neutral" && "border-border bg-surface-2 text-muted-foreground",
        tone === "primary" && "border-primary/20 bg-primary-soft text-primary",
        tone === "info" && "border-info/20 bg-info-soft text-info-foreground",
        tone === "warning" && "border-warning/25 bg-warning-soft text-warning-foreground",
        tone === "success" && "border-success/25 bg-success-soft text-success-foreground",
        tone === "danger" && "border-danger/25 bg-danger-soft text-danger-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Keycap used in the modes' shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-extrabold text-muted-foreground shadow-card">
      {children}
    </kbd>
  );
}

export interface ModeBootContext {
  set: VocabSetDetail;
  /** The set's words plus, for tiny sets, bank top-ups to draw distractors from. */
  pool: DistractorWord[];
  /** Bump this as a React `key` to replay the mode with a fresh session. */
  runKey: number;
  restart: () => void;
}

/**
 * Loads the set and hands the mode a ready-to-play context. Every failure mode
 * (loading, gone, empty) renders inside the same frame so the exit never
 * disappears.
 */
export function ModeBoot({
  setId,
  title,
  children,
}: {
  setId: number;
  title: string;
  children: (ctx: ModeBootContext) => ReactNode;
}) {
  const { data: set, isLoading, isError } = useVocabSet(setId);
  const pool = useDistractorPool(set);
  const [runKey, setRunKey] = useState(0);
  // Above the early returns, as every hook here must be.
  const backHref = useSetHref(setId);

  if (isLoading) {
    return (
      <ModeFrame setId={setId} title={title}>
        <div className="flex h-full flex-col items-center justify-center gap-3">
          <Spinner className="h-7 w-7" />
          <p className="text-[13px] font-semibold text-muted-foreground">Dealing your words…</p>
        </div>
      </ModeFrame>
    );
  }

  if (isError || !set) {
    return (
      <ModeFrame setId={setId} title={title}>
        <div className="mx-auto max-w-lg px-4 py-16">
          <EmptyState
            className="cr-cardrise"
            icon={AlertTriangle}
            title="This set isn't available"
            description="It may have been removed, or it isn't shared with you."
            action={
              <Link href={backHref}>
                <Button variant="secondary">Back to vocabulary</Button>
              </Link>
            }
          />
        </div>
      </ModeFrame>
    );
  }

  if (set.words.length === 0) {
    return (
      <ModeFrame setId={setId} title={title} subtitle={set.title}>
        <div className="mx-auto max-w-lg px-4 py-16">
          <EmptyState
            className="cr-cardrise"
            icon={BookOpen}
            title="No words to study yet"
            description="This set is empty. Add words to it and the study modes will light up."
            action={
              <Link href={backHref}>
                <Button variant="secondary">Back to vocabulary</Button>
              </Link>
            }
          />
        </div>
      </ModeFrame>
    );
  }

  return <>{children({ set, pool, runKey, restart: () => setRunKey((n) => n + 1) })}</>;
}

/** Shown when the session could not be opened — nothing would be recorded. */
export function ModeStartError({
  setId,
  title,
  message,
  onRetry,
}: {
  setId: number;
  title: string;
  message: string;
  onRetry: () => void;
}) {
  const backHref = useSetHref(setId);
  return (
    <ModeFrame setId={setId} title={title}>
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          className="cr-cardrise"
          icon={AlertTriangle}
          title="Couldn't start this round"
          description={message}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={onRetry} leftIcon={<RotateCcw />}>
                Try again
              </Button>
              <Link href={backHref}>
                <Button variant="secondary">Back to vocabulary</Button>
              </Link>
            </div>
          }
        />
      </div>
    </ModeFrame>
  );
}

export interface ModeStat {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}

export function ModeStatGrid({ stats }: { stats: ModeStat[] }) {
  return (
    <div className={cn("grid gap-3", stats.length >= 3 ? "grid-cols-3" : "grid-cols-2")}>
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            "cr-pillin rounded-2xl border p-4 text-center shadow-card",
            s.tone === "success" && "border-success/25 bg-success-soft",
            s.tone === "danger" && "border-danger/25 bg-danger-soft",
            (!s.tone || s.tone === "neutral") && "border-border bg-card",
          )}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <p
            className={cn(
              "ds-num text-[26px] font-extrabold leading-none tracking-[-0.02em] sm:text-[30px]",
              s.tone === "success" && "text-success-foreground",
              s.tone === "danger" && "text-danger-foreground",
              (!s.tone || s.tone === "neutral") && "text-foreground",
            )}
          >
            {s.value}
          </p>
          <p className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            {s.label}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ── Celebration ─────────────────────────────────────────────────────────────
   The 3-cannon popper burst + confetti rain the results screen uses, generated
   from a fixed seed so a re-render never reshuffles mid-flight. Colours come
   from the theme's chart ramp (CSS variables), so the burst is legible in both
   light and dark. `.cr-popper`/`.cr-confetti` are already reduced-motion
   guarded; the layer is hidden outright in that mode so nothing sits frozen
   on screen. */

interface Fleck {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  duration: number;
  delay: number;
  fx?: string;
  fy?: string;
  rot?: string;
}

const FLECK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

/** Tiny LCG — deterministic so the burst is stable across re-renders. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function buildCelebration(): { poppers: Fleck[]; confetti: Fleck[] } {
  const rnd = seededRandom(0x5a7c0de);
  const poppers: Fleck[] = [];
  const cannons = [
    { left: 6, top: 94, aim: 1 },
    { left: 94, top: 94, aim: -1 },
    { left: 50, top: 98, aim: 0 },
  ];
  cannons.forEach((cannon, ci) => {
    for (let i = 0; i < 12; i += 1) {
      const spread = 90 + rnd() * 220;
      poppers.push({
        id: `p${ci}-${i}`,
        left: cannon.left,
        top: cannon.top,
        width: 6 + Math.round(rnd() * 5),
        height: 6 + Math.round(rnd() * 5),
        color: FLECK_COLORS[Math.floor(rnd() * FLECK_COLORS.length)],
        duration: 1.1 + rnd() * 0.9,
        delay: rnd() * 0.22,
        fx: `${cannon.aim * spread + (rnd() - 0.5) * 120}px`,
        fy: `${-(180 + rnd() * 260)}px`,
        rot: `${Math.round((rnd() - 0.5) * 900)}deg`,
      });
    }
  });

  const confetti: Fleck[] = [];
  for (let i = 0; i < 26; i += 1) {
    confetti.push({
      id: `c${i}`,
      left: rnd() * 100,
      top: -4,
      width: 5 + Math.round(rnd() * 5),
      height: 9 + Math.round(rnd() * 8),
      color: FLECK_COLORS[Math.floor(rnd() * FLECK_COLORS.length)],
      duration: 2.4 + rnd() * 1.8,
      delay: rnd() * 1.6,
    });
  }

  return { poppers, confetti };
}

function CelebrationLayer() {
  const { poppers, confetti } = useMemo(() => buildCelebration(), []);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden motion-reduce:hidden"
    >
      {poppers.map((p) => (
        <span
          key={p.id}
          className="cr-popper"
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: `${p.width}px`,
              height: `${p.height}px`,
              backgroundColor: p.color,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              "--fx": p.fx,
              "--fy": p.fy,
              "--rot": p.rot,
            } as CSSProperties
          }
        />
      ))}
      {confetti.map((c) => (
        <span
          key={c.id}
          className="cr-confetti"
          style={{
            left: `${c.left}%`,
            top: `${c.top}%`,
            width: `${c.width}px`,
            height: `${c.height}px`,
            backgroundColor: c.color,
            animationDuration: `${c.duration}s`,
            animationDelay: `${c.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

interface ModeOutcomeProps {
  setId: number;
  title: string;
  description?: string;
  stats: ModeStat[];
  session: Pick<ModeSession, "finishing" | "error" | "summary" | "retry">;
  onRestart: () => void;
  restartLabel?: string;
  /**
   * Fire the confetti burst and bounce the trophy. Modes pass `true` for a
   * clean sweep (no mistakes); finishing the set always celebrates too, so
   * leaving this unset is safe.
   */
  celebrate?: boolean;
  /** Extra content between the stats and the actions (e.g. the test review). */
  children?: ReactNode;
}

/** The end-of-round screen every mode lands on. */
export function ModeOutcome({
  setId,
  title,
  description,
  stats,
  session,
  onRestart,
  restartLabel = "Study again",
  celebrate,
  children,
}: ModeOutcomeProps) {
  // The set being MASTERED is the biggest thing that can happen on this screen, so it
  // celebrates even when the round itself was not the clean one that did it.
  const partying =
    Boolean(celebrate) ||
    Boolean(session.summary?.mode_mastered) ||
    Boolean(session.summary?.mastery?.is_mastered);
  const backHref = useSetHref(setId);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      {partying ? <CelebrationLayer /> : null}

      {/* HERO — gradient panel in the results/homework idiom. */}
      <div className="cr-celebpop relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary-hover px-6 py-9 text-center text-primary-foreground shadow-modal sm:px-10">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-52 w-52 rounded-full bg-white/[0.07]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-12 h-44 w-44 rounded-full bg-white/[0.05]" />
        <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.16]">
          <Trophy className={cn("h-8 w-8", partying && "cr-trophy")} aria-hidden />
        </span>
        <h2 className="relative mt-4 text-[28px] font-extrabold leading-none tracking-[-0.025em] sm:text-[32px]">
          {title}
        </h2>
        {description ? (
          <p className="relative mx-auto mt-3 max-w-md text-[15px] font-medium leading-relaxed opacity-[0.82]">
            {description}
          </p>
        ) : null}
      </div>

      <ModeStatGrid stats={stats} />

      <div className="flex items-center justify-center" aria-live="polite">
        {session.finishing ? (
          <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
            <Spinner className="h-4 w-4" /> Saving your progress…
          </span>
        ) : session.error ? (
          <span className="inline-flex flex-wrap items-center justify-center gap-2 text-[13px] font-semibold text-danger-foreground">
            {session.error}
            <Button size="sm" variant="secondary" onClick={session.retry} leftIcon={<RotateCcw />}>
              Retry save
            </Button>
          </span>
        ) : session.summary?.mastery?.is_mastered ? (
          <Badge variant="success" className="cr-pillin">
            <Sparkles className="h-3 w-3" aria-hidden /> Set mastered — all four games
          </Badge>
        ) : session.summary?.mode_mastered ? (
          <Badge variant="success" className="cr-pillin">
            <Sparkles className="h-3 w-3" aria-hidden /> Game mastered ·{" "}
            <span className="ds-num">
              {session.summary.mastery.mastered_modes}/{session.summary.mastery.total_modes}
            </span>
          </Badge>
        ) : session.summary ? (
          // Not mastered is not a failure, and it is not silence either: the student
          // should leave knowing exactly what the clean run they need looks like.
          <span className="text-[13px] font-semibold text-muted-foreground">
            Every word right in one round masters this game —{" "}
            <span className="ds-num font-bold text-foreground">
              {session.summary.mastery.mastered_modes}/{session.summary.mastery.total_modes}
            </span>{" "}
            so far.
          </span>
        ) : null}
      </div>

      {children}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={onRestart} leftIcon={<RotateCcw />}>
          {restartLabel}
        </Button>
        <Link href={backHref}>
          <Button size="lg" variant="secondary">
            Back to vocabulary
          </Button>
        </Link>
      </div>
    </div>
  );
}
