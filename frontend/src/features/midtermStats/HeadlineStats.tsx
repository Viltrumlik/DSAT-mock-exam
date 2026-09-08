"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { monthLabel, passerSplit, plural, rateReason, rosterNote } from "./format";
import { RateFigure, ScheduledFigure } from "./StatsUI";
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
        "flex flex-col rounded-2xl border p-4",
        emphasis ? "border-primary/25 bg-primary-soft" : "border-border bg-card",
      )}
    >
      {/* Two lines' worth of height whether or not the label needs them. A label that wraps
          used to push its own value ~18px below the other four, and a row of headline
          figures that do not share a baseline reads as a layout accident. */}
      <p
        className={cn(
          "min-h-[2.2em] text-[11px] font-bold uppercase leading-[1.1] tracking-wide",
          // On the tinted surface `text-primary` measures 3.02:1 in dark — under AA for an
          // 11px bold label. Fixed here rather than by moving the app-wide token: this is
          // the only place a small label sits on primary-soft.
          emphasis ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-extrabold tracking-tight tabular-nums",
          // Large text, so AA asks 3:1 — which the dark `--primary` (2.85:1 on its own soft
          // tint) misses and `--primary-hover` clears at 4.18:1.
          emphasis ? "text-3xl text-primary dark:text-primary-hover" : "text-2xl text-foreground",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

/**
 * The same row for a month nobody has sat yet: what is BOOKED, and not one rate.
 *
 * The verdict tiles are gone rather than zeroed. "Passed 0 · Did not pass 117" is arithmetically
 * true of a scheduled month and is a lie about a school, and a tile is exactly the thing a
 * reader quotes without the banner above it.
 */
function ScheduledHeadline({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Tile
        label="Pass rate"
        value={<ScheduledFigure className="text-2xl font-extrabold" />}
        detail={`Nobody has sat ${monthLabel(stats.month) || "this month"} yet, so there is no rate to compute — not a rate of zero.`}
      />
      <Tile
        label="Papers scheduled"
        value={t.midterms}
        detail={`${plural(t.classrooms, "class", "classes")} with a paper booked in this month.`}
      />
      <Tile
        label="Students"
        value={t.distinct_students}
        detail={`${plural(t.roster, "roster place")} are waiting on these papers. None of them is an absence yet.`}
      />
    </div>
  );
}

export function HeadlineStats({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  const notPassed = t.failed + t.absent;
  const split = passerSplit(t);

  // Decided here rather than by the caller: this component is the one that puts a percentage
  // in 30px type, so it is the one that must never do so for a paper nobody has sat.
  if (stats.is_future) return <ScheduledHeadline stats={stats} />;

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

      {/* The big number under "Students" is the HEADCOUNT. It used to be `roster`, which is
          summed once per (classroom, paper) pair — so a class of 20 sitting two papers made
          this tile say 40 students — and the real headcount was 12px detail text below it,
          with the clarifying line appearing only when the two differed. That is: the small
          print showed up exactly when the big number did not mean its label. The roster count
          is still here, named as roster places, because it is the denominator of every rate
          on this page; it is no longer wearing the word "Students". */}
      <Tile
        label="Students"
        value={t.distinct_students}
        detail={
          <>
            {`${plural(t.classrooms, "class", "classes")} · ${plural(t.midterms, "paper")}`}
            {t.roster !== t.distinct_students ? (
              <span className="block" title={rosterNote(t.roster, t.distinct_students) ?? undefined}>
                {plural(t.roster, "roster place")} — every rate is over these.
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
        label="How passers got through"
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
