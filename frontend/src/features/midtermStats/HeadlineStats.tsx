"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { monthLabel, passerSplit, plural, rateReason } from "./format";
import { RateFigure } from "./StatsUI";
import type { MonthlyStats } from "./types";

/**
 * The month in five numbers, above everything else on the page.
 *
 * The old page showed nothing about a cohort as a whole — no rate, no distribution, no
 * comparison — so the first question anyone actually asked ("how did the school do?") could
 * only be answered by reading student rows and adding up in your head. This row answers it,
 * and every figure in it carries the counts it was computed from so nobody has to trust a
 * bare percentage.
 */

function Tile({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        emphasis ? "border-primary/25 bg-primary-soft" : "border-border bg-card",
      )}
    >
      <p
        className={cn(
          "text-[11px] font-bold uppercase tracking-wide",
          emphasis ? "text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-extrabold tracking-tight tabular-nums",
          emphasis ? "text-3xl text-primary" : "text-2xl text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

export function HeadlineStats({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  const notPassed = t.failed + t.absent;
  const split = passerSplit(t);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Tile
        emphasis
        label="Pass rate"
        value={
          <RateFigure
            rate={t.pass_rate}
            reason={rateReason("pass", t.roster)}
            className="text-3xl"
          />
        }
        detail={
          t.roster > 0
            ? `${t.passed} of ${t.roster} roster places passed in ${monthLabel(stats.month)}.`
            : "No students on any roster this month."
        }
      />

      <Tile
        label="Students"
        value={t.roster}
        detail={
          <>
            {t.distinct_students === t.roster
              ? `${plural(t.classrooms, "class", "classes")} · ${plural(t.midterms, "paper")}`
              : `${plural(t.distinct_students, "student")} across ${plural(t.classrooms, "class", "classes")} · ${plural(t.midterms, "paper")}`}
            {t.distinct_students !== t.roster ? (
              <span
                className="block"
                title="A class that sat two papers this month has its roster counted twice, and a student enrolled in two classes counts in both. That is what the pooled rule asks for; the distinct headcount is shown so the difference is visible."
              >
                Roster places, counted once per paper.
              </span>
            ) : null}
          </>
        }
      />

      <Tile
        label="Passed"
        value={t.passed}
        detail={`${t.passed_first} at the first sitting · ${t.passed_retake} on a retake`}
      />

      <Tile
        label="Did not pass"
        value={notPassed}
        detail={
          <>
            {t.failed} failed · {t.absent} absent
            {t.pending > 0 ? (
              <span className="block">
                {t.pending} still awaiting a result (counted in the denominator, not here).
              </span>
            ) : null}
          </>
        }
      />

      <Tile
        label="How the passers got through"
        value={
          <RateFigure
            rate={split ? t.first_try_share : null}
            reason={rateReason("share", t.roster)}
          />
        }
        detail={
          split ? (
            <>
              {split.first} first sitting · {split.retake} retake
              <span className="block">
                {t.passed_first} of {t.passed} passers needed no retake.
              </span>
            </>
          ) : (
            "Nobody passed this month, so there is no first-sitting/retake split to show."
          )
        }
      />
    </div>
  );
}
