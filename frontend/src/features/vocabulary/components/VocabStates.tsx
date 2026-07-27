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

export function VocabCardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-40 rounded-2xl" />
      ))}
    </div>
  );
}

export function VocabRowsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-2xl" />
      ))}
    </div>
  );
}

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
    <div className="flex flex-col items-center rounded-2xl border border-danger/25 bg-danger-soft p-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-card">
        <AlertTriangle className="h-6 w-6 text-danger" />
      </div>
      <p className="ds-h4">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      <Button className="mt-5" variant="secondary" leftIcon={<RefreshCw />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
