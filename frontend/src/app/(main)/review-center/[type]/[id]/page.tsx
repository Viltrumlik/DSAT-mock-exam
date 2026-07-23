"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye } from "lucide-react";

import { useMe } from "@/hooks/useMe";
import { getReviewBundle } from "@/features/reviewCenter/api";
import { ReviewQuestionList } from "@/features/reviewCenter/ReviewQuestionList";
import { REVIEW_TYPE_LABELS, isReviewContentType } from "@/features/reviewCenter/types";
import { isReviewerRole } from "@/features/reviewCenter/ui";

export default function ReviewViewerPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">Loading…</div>}>
      <ReviewViewerInner />
    </Suspense>
  );
}

function ReviewViewerInner() {
  const params = useParams<{ type: string; id: string }>();
  const searchParams = useSearchParams();
  const { me } = useMe();
  const role = (me as { role?: string } | undefined)?.role;
  const allowed = isReviewerRole(role);

  const rawType = String(params?.type ?? "");
  const id = Number(params?.id);
  const title = searchParams.get("title") ?? undefined;
  const validType = isReviewContentType(rawType) ? rawType : null;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["review-bundle", rawType, id],
    queryFn: () => getReviewBundle(validType!, id, title),
    enabled: allowed && !!validType && Number.isFinite(id),
    staleTime: 60_000,
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-sm text-muted-foreground">
        This area is for content reviewers.
      </div>
    );
  }

  if (!validType || !Number.isFinite(id)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Unknown item.</p>
        <Link href="/review-center" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
          Back to Review Center
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <Link
        href="/review-center"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Review Center
      </Link>

      <header className="mb-5 border-b border-border pb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-primary">
          {REVIEW_TYPE_LABELS[validType]}
        </div>
        <h1 className="mt-1 text-xl font-extrabold tracking-tight text-foreground">
          {data?.title ?? title ?? "Loading…"}
        </h1>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-2/60 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
          <Eye className="h-3.5 w-3.5" />
          Review mode — read-only, no timer or fullscreen
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-border bg-surface-2/40" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700">
          Could not load this item. {(error as { message?: string })?.message ?? ""}
        </div>
      ) : (
        <ReviewQuestionList questions={data?.questions ?? []} />
      )}
    </div>
  );
}
