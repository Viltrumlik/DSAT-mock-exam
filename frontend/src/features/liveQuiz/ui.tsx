"use client";

/**
 * The two pieces of the app's own chrome a live quiz still uses: the connection banner and
 * the status pill. Everything that looks like a game lives in `game.tsx`.
 */

import { WifiOff } from "lucide-react";

import { Pill } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

import type { LiveSocketStatus } from "./socket";

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
  const label = status === "QUESTION_ACTIVE" ? "in play" : status.replace(/_/g, " ").toLowerCase();
  return (
    <Pill tone={tone as never} dot={status === "QUESTION_ACTIVE"}>
      {label}
    </Pill>
  );
}
