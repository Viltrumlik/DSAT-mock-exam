"use client";

/**
 * The pieces both sides of a live quiz share.
 *
 * Built on the classroom kit so a live quiz reads as the same product as the class it is
 * played in, rather than as a game bolted onto the side.
 */

import { Users, WifiOff, X } from "lucide-react";

import { Card, Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

import type { LiveParticipant } from "./api";
import type { LiveSocketStatus } from "./socket";

/** Podium colours, matching the school leaderboard so a place means the same thing. */
const MEDAL = ["#d4a017", "#9aa4b2", "#b4703a"];

export function ConnectionBanner({
  connection,
  refusedReason,
}: {
  connection: LiveSocketStatus;
  refusedReason: string | null;
}) {
  if (connection === "open") return null;

  // A refusal is final and says why; a drop is temporary and says it is retrying. They are
  // different messages because they need different things from the reader.
  const refused = connection === "refused";
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm",
        refused
          ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
      role="status"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {refused
          ? refusedReason
          : connection === "connecting"
            ? "Connecting to the quiz…"
            : "Lost contact — trying to reconnect."}
      </span>
    </div>
  );
}

export function CountdownBar({
  secondsLeft,
  total,
  warning,
}: {
  secondsLeft: number | null;
  total: number;
  warning: boolean;
}) {
  if (secondsLeft === null) return null;
  const fraction = total > 0 ? Math.max(0, Math.min(1, secondsLeft / total)) : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">Time left</span>
        <span
          className={cn(
            "font-mono text-2xl font-bold tabular-nums",
            warning ? "text-rose-600 dark:text-rose-400" : "text-foreground",
          )}
        >
          {Math.ceil(secondsLeft)}s
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-200 ease-linear",
            warning ? "bg-rose-500" : "bg-primary",
          )}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

/** The code, big enough to read from the back of the room. */
export function JoinCode({ code }: { code: string }) {
  if (!code) return null;
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Join at mastersat.uz/live
      </p>
      <p className="mt-1 font-mono text-5xl font-bold tracking-[0.2em] text-foreground sm:text-6xl">
        {code}
      </p>
    </div>
  );
}

export function LobbyGrid({
  participants,
  onRemove,
}: {
  participants: LiveParticipant[];
  /** Host only. Absent for a player, who must not be offered a control they'd be refused. */
  onRemove?: (participant: LiveParticipant) => void;
}) {
  const present = participants.filter((p) => p.status === "JOINED");

  if (present.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Users className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">Waiting for the class to join…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {present.map((person) => (
        <span
          key={person.id}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1.5 pl-3.5 text-sm font-medium",
            onRemove ? "pr-1.5" : "pr-3.5",
            !person.present && "opacity-50",
          )}
        >
          {person.display_name}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(person)}
              aria-label={`Remove ${person.display_name}`}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

export function LeaderboardList({
  rows,
  highlightUserId,
  limit,
}: {
  rows: LiveParticipant[];
  highlightUserId?: number | null;
  limit?: number;
}) {
  const shown = typeof limit === "number" ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nobody has scored yet.</p>;
  }

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
              isMe ? "bg-primary/10 ring-1 ring-primary/30" : "bg-surface-2",
            )}
          >
            <span
              className="w-7 shrink-0 text-center text-sm font-bold tabular-nums"
              style={{ color: place <= 3 ? MEDAL[place - 1] : undefined }}
            >
              {place}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {row.display_name}
              {isMe && <span className="ml-1.5 text-xs text-primary">you</span>}
            </span>
            <span className="shrink-0 font-mono text-sm font-bold tabular-nums">{row.score}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * How the room answered, once the question is closed.
 *
 * Counts only. Which student chose what is never sent to this screen, and it is projected
 * in front of the whole class — naming who got it wrong is not something this does.
 */
export function TallyBars({
  byChoice,
  choices,
  correctAnswer,
  answered,
}: {
  byChoice: Record<string, number>;
  choices: Array<{ id: string; text: string }>;
  correctAnswer: unknown;
  answered: number;
}) {
  const most = Math.max(1, ...Object.values(byChoice || {}));

  return (
    <div className="space-y-2">
      {choices.map((choice) => {
        const count = byChoice?.[choice.id] ?? 0;
        const isCorrect = String(correctAnswer ?? "").toLowerCase() === choice.id.toLowerCase();
        return (
          <div key={choice.id} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                isCorrect ? "bg-emerald-500 text-white" : "bg-surface-2 text-muted-foreground",
              )}
            >
              {choice.id}
            </span>
            <div className="h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-surface-2">
              <div
                className={cn("h-full rounded-lg", isCorrect ? "bg-emerald-500/30" : "bg-border")}
                style={{ width: `${(count / most) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums">{count}</span>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">{answered} answered</p>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "QUESTION_ACTIVE"
      ? "success"
      : status === "FINISHED"
        ? "neutral"
        : status === "TERMINATED"
          ? "danger"
          : status === "PAUSED"
            ? "warning"
            : "info";
  const label = status.replace(/_/g, " ").toLowerCase();
  return (
    <Pill tone={tone as never} dot={status === "QUESTION_ACTIVE"}>
      {label}
    </Pill>
  );
}

export function ScoreCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card pad="sm" className="text-center">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}
