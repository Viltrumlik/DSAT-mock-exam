"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Calculator, ClipboardCheck } from "lucide-react";

import { Skeleton } from "@/components/ui";
import { ErrorState } from "@/features/classroom/ui";
import { cn } from "@/lib/cn";

import { recentResults, resultHref, resultTitle, subjectLabel } from "./profileModel";
import { IconTile, Panel, PanelHeader, TONE } from "./profileUi";
import type { Load, ProfileAttempt } from "./types";

/**
 * One finished test, as a row that opens its review. The Overview's "Latest results" and a public
 * learner's Results tab draw it the same way, so the two cannot drift apart.
 */
export function ResultRow({ attempt: a }: { attempt: ProfileAttempt }) {
  const math = (a.practice_test_details?.subject ?? "").toUpperCase() === "MATH";
  const title = resultTitle(a);
  const when = a.submitted_at ? new Date(a.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
  return (
    <li className="quartz quartz-float squircle group relative flex items-center gap-3 px-3.5 py-2.5 [--sq:9px]">
      <IconTile icon={math ? Calculator : BookOpen} tone={math ? "sky" : "emerald"} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-bold text-foreground">{title}</p>
        <p className="truncate text-[12px] font-medium text-muted-foreground">
          {subjectLabel(a.practice_test_details?.subject)}
          {when ? ` · ${when}` : ""}
        </p>
      </div>
      <span className="ds-num text-[20px] font-extrabold tabular-nums text-foreground">{a.score}</span>
      <Link
        href={resultHref(a)}
        className="ds-ring inline-flex items-center gap-1 rounded-md text-[12.5px] font-bold text-primary no-underline after:absolute after:inset-0 after:content-[''] dark:text-primary-hover"
      >
        {/* The word only where there is room for it; on a phone the arrow says it, and the
            link keeps "Review" as its name either way. */}
        <span className="sr-only sm:not-sr-only">Review</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

/** More than the Overview's three: this tab is the whole history a learner who left has to read. */
const RESULTS_SHOWN = 20;

/**
 * A learner who left the learning center reads their own finished tests here, read only (owner,
 * 2026-10-14). The server serves them completed attempts and nothing else, so there is no start,
 * resume, XP, homework or class on this tab.
 */
export function ResultsTab({ attempts, onRetry }: { attempts: Load<ProfileAttempt[]>; onRetry: () => void }) {
  const results = attempts.status === "ready" ? recentResults(attempts.data, RESULTS_SHOWN) : [];

  return (
    <Panel>
      <PanelHeader
        icon={ClipboardCheck}
        tone="primary"
        title="Your results"
        description="The tests you finished, to read through again whenever you like."
      />
      <div className="mt-5">
        {attempts.status === "loading" ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="squircle h-[58px] [--sq:9px]" />
            ))}
          </div>
        ) : attempts.status === "error" ? (
          <ErrorState title="Your results didn't load." message="Nothing is lost — try again in a moment." onRetry={onRetry} />
        ) : results.length === 0 ? (
          <p className={cn("squircle px-4 py-3 text-[13px] font-medium text-muted-foreground [--sq:9px]", TONE.primary.well)}>
            No results yet
          </p>
        ) : (
          <ul className="space-y-2">
            {results.map((a) => (
              <ResultRow key={a.id} attempt={a} />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
