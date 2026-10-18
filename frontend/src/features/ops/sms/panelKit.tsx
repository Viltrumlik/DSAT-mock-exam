"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { skipLabel } from "./format";
import type { Skipped } from "./smsApi";

/**
 * What the SMS panels share. Drawn like the console's changelists and /ops/finance: hairline
 * borders, 13px text, 34px rows — figures and tables, no tiles.
 *
 * A failed read renders an error with a retry, never the empty state: "no SMS were sent" and
 * "the journal did not load" must not look the same on a page about money.
 */

// `cn` does not merge Tailwind classes, so a cell's alignment is never set twice: the shared
// classes carry no alignment, a cell adds its own.
export const BOX = "border border-border bg-card";
export const CAPTION_TEXT = "text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
export const TABLE = "w-full border-separate border-spacing-0 text-[13px] text-foreground";
export const TH = "h-8 whitespace-nowrap border-b border-border bg-card px-2 text-left text-[12px] font-semibold text-muted-foreground";
export const TD = "h-[34px] border-b border-border px-2 py-1";
export const TR = "hover:bg-surface-2 [&:last-child>td]:border-b-0";
export const TEXT_BUTTON =
  "rounded-sm text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-hover";

/** A hairline box with a caption row; `actions` sit at the caption's right. */
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(BOX, className)}>
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <h2 className={CAPTION_TEXT}>{title}</h2>
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Loading() {
  return (
    <p role="status" className="text-[13px] text-muted-foreground">
      Loading…
    </p>
  );
}

/** "The <what> didn't load." and a retry. */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className={cn(BOX, "px-3 py-3 text-[13px]")}>
      <span className="font-semibold text-foreground">The {what} didn&apos;t load.</span>{" "}
      <button type="button" onClick={onRetry} className={TEXT_BUTTON}>
        Try again
      </button>
    </div>
  );
}

/**
 * The words of an API refusal: the contract's `{detail}`, or `fallback` when the body is anything
 * else — an HTML 502 from the proxy, a bare string, nothing at all.
 */
export function errorText(e: unknown, fallback = "That didn't work. Try again."): string {
  const data = (e as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

/**
 * A paid POST that failed with no HTTP answer — the network, a timeout, or the auth layer's
 * AUTH_TEMPORAL_STALE (which rejects an answer that did arrive) — may well have reached the
 * server and sent its SMS. A refusal (any answer) means nothing went out.
 */
export function mayHaveBeenSent(e: unknown): boolean {
  return !(e as { response?: unknown } | null | undefined)?.response;
}

export const MAYBE_SENT = "The server may already have sent this — check the list before trying again.";

/** `errorText` for a POST that costs money: no answer is "it may have gone", never "try again". */
export function paidErrorText(e: unknown, fallback?: string): string {
  return mayHaveBeenSent(e) ? MAYBE_SENT : errorText(e, fallback);
}

/** Who a send leaves out, by reason, with their names. Reasons with nobody are left out. */
export function SkippedList({ skipped }: { skipped: Skipped | undefined }) {
  const rows = Object.entries(skipped ?? {}).filter(([, people]) => (people?.length ?? 0) > 0);
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">Nobody is skipped.</p>;
  return (
    <ul className="space-y-1.5 text-[13px]">
      {rows.map(([reason, people]) => (
        <li key={reason}>
          <span className="font-semibold text-foreground">
            {skipLabel(reason)} · {people!.length}
          </span>
          <span className="text-muted-foreground">: {people!.map((p) => p.name || `#${p.user_id}`).join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}
