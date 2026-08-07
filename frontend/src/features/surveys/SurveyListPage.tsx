"use client";

import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import ErrorPanel from "@/components/ErrorPanel";
import { useOpenSurveys } from "./surveysHooks";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SurveyListPage() {
  const surveys = useOpenSurveys();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Surveys"
        description="Tell the school what you think. Each survey you finish earns you points."
      />

      <Card>
        <CardHeader>
          <CardTitle>Open now</CardTitle>
          <CardDescription>Surveys you haven&apos;t answered yet</CardDescription>
        </CardHeader>
        <CardContent>
          {surveys.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
          ) : surveys.isError ? (
            // Not an empty state: "nothing to answer" would quietly cost the student points.
            <ErrorPanel
              message="Couldn't load your surveys."
              actionLabel="Try again"
              onAction={() => surveys.refetch()}
            />
          ) : (surveys.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing to answer right now"
              description="When the school publishes a survey, it will show up here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {surveys.data?.map((s) => (
                <li key={s.id}>
                  <Link href={`/surveys/${s.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-surface-2 rounded-xl px-2 -mx-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.question_count} question{s.question_count === 1 ? "" : "s"}
                        {s.closes_at ? ` · closes ${fmtDate(s.closes_at)}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
