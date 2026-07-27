"use client";

/**
 * Chrome shared by the four study modes: the full-screen frame with its
 * permanent "Back to vocabulary" exit, the load/empty/error boot sequence, and
 * the end-of-round outcome card.
 *
 * These modes are immersive takeovers (`fixed inset-0 z-50`) — StudentAppShell
 * routes them past its scroll container so the layer isn't trapped in the
 * shell's stacking context.
 */

import { AlertTriangle, ArrowLeft, BookOpen, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";

import { Badge, Button, EmptyState, Progress, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

import { useVocabSet } from "../hooks";
import type { VocabSetDetail } from "../types";
import { useDistractorPool } from "./useDistractorPool";
import type { ModeSession } from "./useModeSession";
import type { DistractorWord } from "./utils";

export const setHref = (setId: number) => `/vocabulary/sets/${setId}`;

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
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <Link
          href={setHref(setId)}
          className="ds-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to vocabulary</span>
          <span className="sm:hidden">Back</span>
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-bold text-foreground">{title}</p>
          {subtitle ? <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2">{right}</div>
      </header>
      {progress != null ? <Progress value={progress} size="sm" className="rounded-none" label="Round progress" /> : null}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

/** Header pill for a clock or a counter. */
export function ModePill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold tabular-nums",
        tone === "neutral" && "border-border bg-surface-2 text-muted-foreground",
        tone === "primary" && "border-primary/20 bg-primary-soft text-primary",
        tone === "danger" && "border-danger/20 bg-danger-soft text-danger-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Keycap used in the modes' shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-bold text-muted-foreground">
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

  if (isLoading) {
    return (
      <ModeFrame setId={setId} title={title}>
        <div className="flex h-full items-center justify-center">
          <Spinner className="h-7 w-7" />
        </div>
      </ModeFrame>
    );
  }

  if (isError || !set) {
    return (
      <ModeFrame setId={setId} title={title}>
        <div className="mx-auto max-w-lg px-4 py-16">
          <EmptyState
            icon={AlertTriangle}
            title="This set isn't available"
            description="It may have been removed, or it isn't shared with you."
            action={
              <Link href={setHref(setId)}>
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
            icon={BookOpen}
            title="No words to study yet"
            description="This set is empty. Add words to it and the study modes will light up."
            action={
              <Link href={setHref(setId)}>
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
  return (
    <ModeFrame setId={setId} title={title}>
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't start this round"
          description={message}
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={onRetry} leftIcon={<RotateCcw />}>
                Try again
              </Button>
              <Link href={setHref(setId)}>
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
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl border border-border bg-card p-4 text-center shadow-card">
          <p
            className={cn(
              "text-2xl font-extrabold tabular-nums",
              s.tone === "success" && "text-success-foreground",
              s.tone === "danger" && "text-danger-foreground",
              (!s.tone || s.tone === "neutral") && "text-foreground",
            )}
          >
            {s.value}
          </p>
          <p className="mt-1 text-[12px] font-semibold text-muted-foreground">{s.label}</p>
        </div>
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
  children,
}: ModeOutcomeProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="text-center">
        <h2 className="ds-h2">{title}</h2>
        {description ? <p className="ds-lead mt-2">{description}</p> : null}
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
        ) : session.summary?.set_completed ? (
          <Badge variant="success">Set complete</Badge>
        ) : null}
      </div>

      {children}

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={onRestart} leftIcon={<RotateCcw />}>
          {restartLabel}
        </Button>
        <Link href={setHref(setId)}>
          <Button variant="secondary">Back to vocabulary</Button>
        </Link>
      </div>
    </div>
  );
}
