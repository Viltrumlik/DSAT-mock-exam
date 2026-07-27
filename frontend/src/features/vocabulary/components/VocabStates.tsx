import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { normalizeApiError } from "@/lib/apiError";

/**
 * The mutation hooks in `../hooks.ts` rethrow an already-normalized `ApiError`
 * from `onError`, and `normalizeApiError` cannot re-normalize its own output —
 * a second pass would flatten every message to "Request failed.". So read the
 * message off the value first and only normalize raw axios errors.
 */
export function vocabErrorMessage(err: unknown): string {
  const message = (err as { message?: unknown } | null | undefined)?.message;
  if (typeof message === "string" && message.trim()) return message;
  return normalizeApiError(err).message;
}

/**
 * Loading placeholder for the section/set card grids. Deliberately mirrors the
 * real card's shape — icon square, title, meta chips, mastery bar, footer — so
 * the swap to live data doesn't reflow the page.
 */
export function VocabCardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="cr-cardrise rounded-2xl border border-border bg-card p-5 shadow-card"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <div className="flex items-start gap-4">
            <Skeleton className="h-11 w-11" />
            <div className="flex flex-1 flex-col gap-2 pt-0.5">
              <Skeleton variant="text" className="w-2/3" />
              <Skeleton variant="text" className="w-full" />
            </div>
            <Skeleton variant="circle" className="h-14 w-14 shrink-0" />
          </div>

          <div className="mt-4 flex gap-2">
            <Skeleton variant="circle" className="h-5 w-20" />
            <Skeleton variant="circle" className="h-5 w-24" />
          </div>

          <Skeleton variant="circle" className="mt-5 h-2.5 w-full" />

          <div className="mt-3 flex gap-3">
            <Skeleton variant="text" className="w-20" />
            <Skeleton variant="text" className="w-20" />
            <Skeleton variant="text" className="w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Loading placeholder for the word list — one boxed stack of word rows. */
export function VocabRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn("cr-rowin flex items-center gap-4 p-4", i > 0 && "border-t border-border")}
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton variant="circle" className="h-9 w-9 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton variant="text" className="w-1/3" />
            <Skeleton variant="text" className="w-3/4" />
          </div>
          <Skeleton variant="circle" className="h-6 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Shared failure state — same silhouette as the design system's `EmptyState`
 * (icon in a soft circle → bold title → muted body → CTA), tinted danger so it
 * reads as "something broke" rather than "nothing here yet".
 */
export function VocabErrorState({
  title = "Couldn't load your vocabulary",
  description = "Something went wrong on our end. Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry: () => void;
}) {
  return (
    <div className="cr-cardrise flex flex-col items-center rounded-2xl border border-dashed border-danger/30 bg-danger-soft p-12 text-center">
      {/* Same 14×14 rounded-2xl plate `EmptyState` uses, so the two states are
          the same silhouette with different tints. */}
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-card ring-1 ring-danger/20">
        <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      </div>
      <p className="ds-h4">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button className="cr-press mt-5" variant="secondary" leftIcon={<RefreshCw />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
