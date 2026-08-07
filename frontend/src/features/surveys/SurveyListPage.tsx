"use client";

import Link from "next/link";
import { ClipboardList, ChevronRight, RefreshCw } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { useOpenSurveys } from "./surveysHooks";

function fmtDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function SurveyListPage() {
  const surveys = useOpenSurveys();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Surveys"
        description="Tell the school what you think. Each survey you finish earns you points."
      />

      <Card>
        <CardHeader>
          {/* CardHeader is a justify-between flex row, so the title block needs its own column. */}
          <div className="min-w-0">
            <CardTitle>Open now</CardTitle>
            <CardDescription>Surveys you haven&apos;t answered yet</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {surveys.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : surveys.isError ? (
            // Not an empty state: "nothing to answer" would quietly cost the student points.
            <div className="space-y-3">
              <Alert tone="danger" title="Couldn't load your surveys.">
                Your open surveys will be here as soon as the connection comes back.
              </Alert>
              <Button
                variant="secondary"
                leftIcon={<RefreshCw />}
                onClick={() => void surveys.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : (surveys.data?.length ?? 0) === 0 ? (
            <EmptyState
              compact
              icon={ClipboardList}
              title="Nothing to answer right now"
              description="When the school publishes a survey, it will show up here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {surveys.data?.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/surveys/${s.id}`}
                    className="ds-ring -mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
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
        </CardContent>
      </Card>
    </div>
  );
}
