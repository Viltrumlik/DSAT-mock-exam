"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Hourglass } from "lucide-react";
import { mockApi } from "@/lib/mockApi";
import { HeroPage, Skeleton } from "@/components/ui";
// The house devices, so a result reads as part of the same product as the classroom.
import { Card, EmptyState, ErrorState } from "@/features/classroom/ui";

function ScoreCard({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="cr-card cr-lift px-6 py-4 text-center">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>
      <p className="ds-num mt-1 text-[28px] font-extrabold text-foreground">
        {value ?? "—"}
        <span className="ds-num text-[14px] font-bold text-muted-foreground"> /800</span>
      </p>
    </Card>
  );
}

export default function MockResultPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const id = Number(attemptId);
  const result = useQuery({
    queryKey: ["mock", "result", id],
    queryFn: () => mockApi.getResults(id),
    retry: 1,
  });

  return (
    <HeroPage width="narrow" className="space-y-5">
      <Link
        href="/mock-exam"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to mocks
      </Link>

      {result.isPending ? (
        <>
          <Skeleton className="h-64 rounded-2xl" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
          </div>
        </>
      ) : result.isError ? (
        // "Result not available yet" used to cover this too — telling a student who had just
        // finished a paper that their score does not exist, when the request simply failed.
        <Card className="cr-card">
          <ErrorState
            title="Your result isn't loading right now."
            message="Your paper and your score are safe — this page just couldn't fetch them."
            onRetry={() => void result.refetch()}
          />
        </Card>
      ) : !result.data ? (
        <Card className="cr-card">
          <EmptyState
            icon={Hourglass}
            title="Result not available yet"
            description="This sitting hasn't been scored. It will appear here once it is."
          />
        </Card>
      ) : (
        <>
          <Card pad="none" className="cr-card overflow-hidden">
            <div className="relative overflow-hidden bg-gradient-to-br from-primary to-primary-hover px-6 py-10 text-center text-primary-foreground sm:px-[34px]">
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-white/[0.06]"
              />
              <div className="relative">
                <span className="inline-flex items-center rounded-[20px] bg-white/20 px-[13px] py-[5px] text-xs font-extrabold">
                  Mock result
                </span>
                <p className="mt-3 text-[15px] font-bold opacity-[0.86]">{result.data.title}</p>
                <div className="cr-daypop mt-5 flex items-end justify-center gap-1">
                  <span className="ds-num text-[64px] font-extrabold leading-none">
                    {result.data.total_score ?? "—"}
                  </span>
                  <span className="ds-num mb-2 text-[20px] font-bold opacity-[0.72]">/ 1600</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-4">
            <ScoreCard label="Reading & Writing" value={result.data.english_score} />
            <ScoreCard label="Math" value={result.data.math_score} />
          </div>
        </>
      )}
    </HeroPage>
  );
}
