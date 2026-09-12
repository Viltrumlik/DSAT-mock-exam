"use client";

import type { LucideIcon } from "lucide-react";
import { CalendarDays, Flame, Sparkles, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The parts of the profile that are about the STUDENT.
 *
 * The page this belongs to had turned into a filing cabinet: a notification matrix and a
 * thirteen-row list of browser sessions — IP addresses and raw `Mozilla/5.0 (iPhone; CPU
 * iPhone OS 18_7 …)` strings — took up more than half of it. The owner's read was that four
 * unrelated things had been stuffed into one place and none of them was for anybody. Those
 * two are still in the product, behind a Settings tab; what stands in their place is the
 * only thing a student opens their own profile to see: how they are doing.
 *
 * Every tile here carries its own colour. A row of identically grey numbers is the same page
 * again in miniature — the eye has nothing to land on and no number looks more important
 * than any other, which is exactly what "austere" described.
 */

export type Tone = "primary" | "amber" | "emerald" | "sky" | "violet";

const TONE: Record<Tone, { card: string; icon: string; value: string; bar: string }> = {
  primary: {
    card: "border-primary/25 bg-primary-soft",
    icon: "bg-primary/15 text-primary dark:text-primary-hover",
    value: "text-primary dark:text-primary-hover",
    bar: "bg-primary",
  },
  amber: {
    card: "border-warning/25 bg-warning-soft",
    icon: "bg-warning/15 text-warning-foreground",
    value: "text-warning-foreground",
    bar: "bg-warning",
  },
  emerald: {
    card: "border-success/25 bg-success-soft",
    icon: "bg-success/15 text-success-foreground",
    value: "text-success-foreground",
    bar: "bg-success",
  },
  sky: {
    card: "border-info/25 bg-info-soft",
    icon: "bg-info/15 text-info-foreground",
    value: "text-info-foreground",
    bar: "bg-info",
  },
  violet: {
    card: "border-[color-mix(in_oklab,var(--chart-6)_25%,transparent)] bg-[color-mix(in_oklab,var(--chart-6)_10%,transparent)]",
    icon: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    value: "text-[var(--chart-6)]",
    bar: "bg-[var(--chart-6)]",
  },
};

export function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "primary",
  /** 0–100. Drawn as a bar under the number when given — omitted when there is nothing to fill. */
  fill,
  index = 0,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
  fill?: number | null;
  index?: number;
}) {
  const t = TONE[tone];
  return (
    <div
      className={cn("cr-card flex flex-col rounded-2xl border p-4", t.card)}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className={cn("cr-iconpop grid h-8 w-8 shrink-0 place-items-center rounded-xl", t.icon)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <p className={cn("ds-num mt-2 text-[28px] font-extrabold leading-none tracking-tight", t.value)}>
        {value}
      </p>
      {detail ? <p className="mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{detail}</p> : null}
      {fill != null ? (
        <span className="mt-3 block h-2 w-full overflow-hidden rounded-full bg-card/70">
          <span
            className={cn("ds-growx block h-full rounded-full", t.bar)}
            style={{
              width: `${Math.max(0, Math.min(100, fill))}%`,
              "--ds-delay": `${index * 70 + 180}ms`,
            } as React.CSSProperties}
          />
        </span>
      ) : null}
    </div>
  );
}

/**
 * The goal, as one thing rather than two.
 *
 * A target score and an exam date were two separate chips in the masthead, which is where a
 * number goes to be true and not to be acted on. Together they are a countdown: this is what
 * you are aiming at, and this is how long you have.
 */
export function GoalCard({
  target,
  best,
  examDate,
  daysLeft,
  onEdit,
}: {
  target: number | null;
  /** The best score behind them so far, so the ring has something to fill against. */
  best: number | null;
  examDate: string | null;
  daysLeft: number | null;
  onEdit: () => void;
}) {
  const pct = target && best ? Math.max(0, Math.min(100, Math.round((best / target) * 100))) : null;
  return (
    <div className="cr-card relative overflow-hidden rounded-2xl border border-border bg-card p-5">
      {/* One soft light, top-right, so the card is lit rather than filled. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full"
        style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--primary) 22%, transparent), transparent)" }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
            <Target className="h-4 w-4 text-primary dark:text-primary-hover" aria-hidden />
            Your goal
          </p>
          <p className="ds-num mt-2 text-[34px] font-extrabold leading-none tracking-tight text-foreground">
            {target ?? "—"}
            {target ? <span className="ml-1.5 text-base font-bold text-muted-foreground">/ 1600</span> : null}
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {best != null
              ? `Your best so far is ${best}.`
              : "Sit a mock and your best score will show up here."}
          </p>
        </div>

        <div className="min-w-0 text-right">
          <p className="flex items-center justify-end gap-2 text-[11.5px] font-bold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden />
            Exam day
          </p>
          <p className="ds-num mt-2 text-[22px] font-extrabold leading-none text-foreground">
            {daysLeft != null && daysLeft >= 0 ? `${daysLeft}` : "—"}
            {daysLeft != null && daysLeft >= 0 ? (
              <span className="ml-1.5 text-sm font-bold text-muted-foreground">
                {daysLeft === 1 ? "day left" : "days left"}
              </span>
            ) : null}
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{examDate ?? "No date picked yet"}</p>
        </div>
      </div>

      {pct != null ? (
        <div className="relative mt-4">
          <span className="block h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
            <span
              className="ds-growx block h-full rounded-full bg-gradient-to-r from-primary to-[var(--accent)]"
              style={{ width: `${pct}%`, "--ds-delay": "260ms" } as React.CSSProperties}
            />
          </span>
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">
            {pct}% of the way to your goal.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onEdit}
        className="ds-ring cr-press relative mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        {target ? "Change my goal" : "Set my goal"}
      </button>
    </div>
  );
}

/** The four icons the overview tiles use, exported so the page does not import five of them. */
export const STAT_ICONS = { xp: Trophy, streak: Flame, target: Target, spark: Sparkles };
