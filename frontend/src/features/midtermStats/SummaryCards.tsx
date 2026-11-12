"use client";

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { RATE_TONE_FILL, RATE_TONE_TEXT } from "./look";
import { expectedNote, notPassed, ofTotal, rateTone } from "./outcome";
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
 *
 * Drawn as the console's stat tiles (design handoff v0.3): a white card, the verdict in the
 * icon's chip and the number's colour, never in colour alone.
 */

type Tone = "primary" | "success" | "danger" | "info";

const TONE: Record<Tone, { icon: string; value: string }> = {
  primary: { icon: "bg-ms-primary-soft text-ms-primary-text", value: "text-ms-primary-text" },
  success: { icon: "bg-ms-positive-soft text-ms-positive-fg", value: "text-ms-positive-fg" },
  danger: { icon: "bg-ms-critical-soft text-ms-critical-fg", value: "text-ms-critical-fg" },
  info: { icon: "bg-ms-surface-2 text-ms-fg-2", value: "text-ms-fg" },
};

function Card({
  icon,
  label,
  value,
  detail,
  tone = "info",
  valueClass,
  index = 0,
  children,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  valueClass?: string;
  /** Position in the row, so the four arrive left to right rather than together. */
  index?: number;
  children?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <div
      className="animate-ms-card-in flex min-w-0 flex-col rounded-ms-card bg-ms-card p-4 shadow-ms-1"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px]", t.icon)}>
          <Icon name={icon} size="sm" />
        </span>
        <p className="text-[13.5px] font-medium text-ms-fg-2">{label}</p>
      </div>
      <p className={cn("mt-2 text-ms-display tabular-nums", valueClass ?? t.value)}>{value}</p>
      {detail ? <p className="mt-1 text-[13px] leading-[18px] text-ms-fg-3">{detail}</p> : null}
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
        index={0}
        icon="cal"
        tone="primary"
        label="Pass rate"
        value={<ScheduledFigure />}
        detail={`Nobody has sat ${monthLabel(stats.month) || "this month"} yet, so there is no rate — not a rate of zero.`}
      />
      <Card
        index={1}
        icon="cap"
        label="Exams booked"
        value={t.midterms}
        detail={`${plural(t.classrooms, "class", "classes")} have an exam in this month.`}
      />
      <Card
        index={2}
        icon="users"
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
        index={0}
        icon="ok"
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
        <span className="mt-3 block h-2 w-full overflow-hidden rounded-full bg-ms-surface-2">
          <span
            className={cn("mts-grow block h-full rounded-full", RATE_TONE_FILL[tone])}
            style={{
              width: `${Math.max(0, Math.min(100, t.pass_rate ?? 0))}%`,
              "--mts-delay": "220ms",
            } as CSSProperties}
          />
        </span>
      </Card>

      <Card
        index={1}
        icon="ok"
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
        index={2}
        icon="x"
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
        index={3}
        icon="users"
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
