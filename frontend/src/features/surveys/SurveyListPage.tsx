"use client";

import Link from "next/link";
import { ClipboardList, ChevronRight, MessageSquare } from "lucide-react";
import { HeroPage, PageHero, Skeleton } from "@/components/ui";
// The house devices, so a survey reads as part of the same product as the classroom.
import { Card, CardHeader, EmptyState, ErrorState } from "@/features/classroom/ui";
import { useOpenSurveys } from "./surveysHooks";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SurveyListPage() {
  const surveys = useOpenSurveys();
  const openCount = surveys.data?.length ?? 0;

  return (
    <HeroPage className="space-y-5">
      <Card pad="none" className="cr-card overflow-hidden">
        <PageHero
          badge="Survey"
          icon={MessageSquare}
          title="Surveys"
          description="Tell the learning center what you think. Each survey you finish earns you points."
          // Only when there is something: a lone "0" in the masthead reads as a scoreboard
          // of what the student has failed to do, and the card below already says it kindly.
          tiles={
            openCount > 0
              ? [{
                  label: "Waiting for you",
                  value: `${openCount} survey${openCount === 1 ? "" : "s"}`,
                  accent: true,
                  icon: ClipboardList,
                }]
              : []
          }
        />
      </Card>

      <Card className="cr-card space-y-3">
        <CardHeader title="Open now" description="Surveys you haven't answered yet" />
        {surveys.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : surveys.isError ? (
          // Not an empty state: "nothing to answer" would quietly cost the student points.
          <ErrorState
            title="Couldn't load your surveys."
            message="Your open surveys will be here as soon as the connection comes back."
            onRetry={() => void surveys.refetch()}
          />
        ) : openCount === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Nothing to answer right now"
            description="When the learning center publishes a survey, it will show up here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {surveys.data?.map((s, i) => (
              <li key={s.id} style={{ animationDelay: `${i * 50}ms` }} className="cr-rowin">
                <Link
                  href={`/surveys/${s.id}`}
                  className="ds-ring -mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <ClipboardList className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-foreground">{s.title}</p>
                    <p className="truncate text-xs font-semibold text-muted-foreground">
                      <span className="ds-num">{s.question_count}</span>
                      {` question${s.question_count === 1 ? "" : "s"}`}
                      {s.closes_at ? ` · closes ${fmtDate(s.closes_at)}` : ""}
                    </p>
                  </div>
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </HeroPage>
  );
}
