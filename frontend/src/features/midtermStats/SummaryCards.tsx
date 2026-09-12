"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarX2, CircleCheck, CircleX, GraduationCap, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { RATE_TONE_FILL, RATE_TONE_TEXT, expectedNote, notPassed, ofTotal, rateTone } from "./outcome";
import { SplitBar } from "./SplitBar";
import { monthLabel, plural } from "./format";
import { ScheduledFigure } from "./StatsUI";
import type { MonthlyStats } from "./types";

/**
 * The month in four cards, in the words people use and the colours they expect.
 *
 * What this replaces: five grey tiles, one of them headed "How passers got through", each
 * carrying two lines of small print about denominators. The figures were right and nobody
 * could read them — the owner's word for the page was *chalkash*, tangled. So: four cards,
 * one idea each, coloured by what they say (green passed, red failed, amber nobody came),
 * and every caveat that used to sit under a number moved to one line at the foot of the
 * page where it belongs.
 *
 * The counts themselves are unchanged, and so is the rule they were computed by: passed
 * over everyone who was due to sit, an absent student counting as not passed. Only the
 * words and the colours are new.
 */

type Tone = "primary" | "success" | "danger" | "info";

const TONE: Record<Tone, { card: string; icon: string; value: string }> = {
  primary: {
    card: "border-primary/25 bg-primary-soft",
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    value: "text-primary dark:text-primary-hover",
  },
  success: {
    card: "border-success/25 bg-success-soft",
    icon: "bg-success/15 text-success-foreground",
    value: "text-success-foreground",
  },
  danger: {
    card: "border-danger/25 bg-danger-soft",
    icon: "bg-danger/15 text-danger-foreground",
    value: "text-danger-foreground",
  },
  info: {
    card: "border-border bg-card",
    icon: "bg-surface-2 text-muted-foreground",
    value: "text-foreground",
  },
};

function Card({
  icon: Icon,
  label,
  value,
  detail,
  tone = "info",
  valueClass,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
  valueClass?: string;
  children?: React.ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("flex flex-col rounded-2xl border p-4", t.card)}>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", t.icon)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <p className={cn("mt-2 text-3xl font-extrabold tracking-tight tabular-nums", valueClass ?? t.value)}>
        {value}
      </p>
      {detail ? <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{detail}</p> : null}
      {children}
    </div>
  );
}

/** A month nobody has sat: what is booked, and not one rate. */
function Booked({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Card
        icon={CalendarX2}
        tone="primary"
        label="Pass rate"
        value={<ScheduledFigure className="text-3xl font-extrabold" />}
        detail={`Nobody has sat ${monthLabel(stats.month) || "this month"} yet, so there is no rate — not a rate of zero.`}
      />
      <Card
        icon={GraduationCap}
        label="Exams booked"
        value={t.midterms}
        detail={`${plural(t.classrooms, "class", "classes")} have an exam in this month.`}
      />
      <Card
        icon={Users}
        label="Students"
        value={t.distinct_students}
        detail="None of them has missed anything yet."
      />
    </div>
  );
}

export function SummaryCards({ stats }: { stats: MonthlyStats }) {
  const t = stats.totals;
  // Decided here, not by the caller: this is the component that prints a percentage in 30px
  // type, so it is the one that must never do it for a month nobody has sat.
  if (stats.is_future) return <Booked stats={stats} />;

  const tone = rateTone(t.pass_rate);
  const note = expectedNote(t.roster, t.distinct_students);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        icon={CircleCheck}
        tone="primary"
        label="Pass rate"
        valueClass={RATE_TONE_TEXT[tone]}
        value={t.pass_rate == null ? "—" : `${t.pass_rate}%`}
        detail={
          t.roster > 0
            ? `${ofTotal(t.passed, t.roster)} passed in ${monthLabel(stats.month)}.`
            : "Nobody was due to sit an exam this month."
        }
      >
        <span className="mt-3 block h-2 w-full overflow-hidden rounded-full bg-card/70">
          <span
            className={cn("block h-full rounded-full", RATE_TONE_FILL[tone])}
            style={{ width: `${Math.max(0, Math.min(100, t.pass_rate ?? 0))}%` }}
          />
        </span>
      </Card>

      <Card
        icon={CircleCheck}
        tone="success"
        label="Passed"
        value={t.passed}
        detail={
          t.passed > 0
            ? `${t.passed_first} passed first time${t.passed_retake > 0 ? ` · ${t.passed_retake} after a retake` : ""}`
            : "Nobody passed this month."
        }
      />

      <Card
        icon={CircleX}
        tone="danger"
        label="Did not pass"
        value={notPassed(t)}
        detail={
          <>
            {t.failed} failed the exam · {t.absent} did not come
            {t.pending > 0 ? (
              <span className="block">{t.pending} still waiting for a result.</span>
            ) : null}
          </>
        }
      />

      <Card
        icon={Users}
        label="Students"
        value={t.distinct_students}
        detail={
          <>
            {plural(t.classrooms, "class", "classes")} · {plural(t.midterms, "exam")}
            {note ? (
              <span className="block" title={`Every rate on this page is over ${t.roster}.`}>
                Rates are over {note}
              </span>
            ) : null}
          </>
        }
      >
        <SplitBar tally={t} className="mt-3" />
      </Card>
    </div>
  );
}
