"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { RollNumber } from "../RollNumber";
import { buttonClass } from "./Button";
import { chipClass, ChipCount } from "./Chip";

/**
 * Data display (design handoff v0.3, DataDisplay board): the stat tile, the header card and the timeline.
 * Verdicts are words with icons; numbers are tabular; every number leads somewhere.
 */
export type Tone = "positive" | "attention" | "critical" | "info" | "frozen" | "neutral";

const SOFT: Record<Tone, string> = {
  positive: "bg-ms-positive-soft text-ms-positive-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
  frozen: "bg-ms-frozen-soft text-ms-frozen-fg",
  neutral: "bg-ms-surface-2 text-ms-fg-2",
};
const FG: Record<Tone, string> = {
  positive: "text-ms-positive-fg",
  attention: "text-ms-attention-fg",
  critical: "text-ms-critical-fg",
  info: "text-ms-info-fg",
  frozen: "text-ms-frozen-fg",
  neutral: "text-ms-fg",
};

// ─── Stat tile ───────────────────────────────────────────────────────────────

/**
 * A number, its label, its unit — and where it leads (the whole tile opens the filtered list behind it).
 * No bar or gauge restating the number. While loading it shimmers; when it failed it says so with Retry,
 * never as a zero.
 */
export function StatTile({
  label,
  value,
  unit,
  sub,
  href,
  tone,
  icon,
  state = "ready",
  error = "Couldn’t load it.",
  onRetry,
  delay = 0,
  className,
}: {
  label: ReactNode;
  value?: string | number;
  unit?: ReactNode;
  /** Under the number: "9 450 000 so'm in total". */
  sub?: ReactNode;
  href?: string;
  /** Colours the number (and the tile, for frozen) when it is a verdict. */
  tone?: Tone;
  icon?: IconName;
  state?: "ready" | "loading" | "error";
  error?: string;
  onRetry?: () => void;
  delay?: number;
  className?: string;
}) {
  const frozen = tone === "frozen";
  const body = (
    <>
      <span className={cn("flex items-center gap-1.5 text-[13.5px]", frozen ? "text-ms-frozen-fg" : "text-ms-fg-2")}>
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </span>
      {state === "loading" ? (
        <span aria-hidden="true" className="flex flex-col gap-2 py-1">
          <span className="animate-ms-shimmer h-7 w-24 rounded-[6px]" />
          <span className="animate-ms-shimmer h-3.5 w-32 rounded-[6px]" />
        </span>
      ) : state === "error" ? (
        <span role="alert" className="flex flex-col items-start gap-1.5">
          <span className="flex items-center gap-1.5 text-[14px] font-medium text-ms-critical-fg">
            <Icon name="alert" size="sm" />
            {error}
          </span>
          {onRetry ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onRetry();
              }}
              className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2 text-ms-primary-text" })}
            >
              Retry
            </button>
          ) : null}
        </span>
      ) : (
        <>
          <span className="flex flex-wrap items-baseline gap-1.5">
            <RollNumber value={value ?? "—"} className={cn("text-[28px] font-bold leading-8 tabular-nums", tone ? FG[tone] : "text-ms-fg")} />
            {unit ? <span className="text-[14px] text-ms-fg-2">{unit}</span> : null}
          </span>
          {sub ? <span className="text-[13px] text-ms-fg-3">{sub}</span> : null}
        </>
      )}
    </>
  );
  const cls = cn(
    "animate-ms-card-in flex min-w-0 flex-col gap-1.5 rounded-[16px] p-4",
    frozen ? "bg-ms-frozen-soft" : "bg-ms-surface",
    href && state !== "error" && "ms-hover-lift",
    className,
  );
  return href && state !== "error" ? (
    <Link href={href} className={cls} style={{ animationDelay: `${delay}ms` }}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={{ animationDelay: `${delay}ms` }}>
      {body}
    </div>
  );
}

// ─── Header card ─────────────────────────────────────────────────────────────

export type GlanceFact = {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  href?: string;
};

/**
 * Who, what state, what to do — before any tab. The glance facts answer the desk's two questions first
 * ("Did he come today?", "Does he owe?"); the notice explains a state in words (what still works, what lifts
 * it); the tab row sits at the card's foot.
 */
export function HeaderCard({
  avatar,
  title,
  badges,
  meta,
  actions,
  facts = [],
  notice,
  children,
  className,
}: {
  avatar?: ReactNode;
  title: ReactNode;
  /** Beside the name: role, verdicts ("Frozen for debt"), "lc-up linked". */
  badges?: ReactNode;
  /** Lines under the name: handle, phone, parent. */
  meta?: ReactNode[];
  actions?: ReactNode;
  facts?: GlanceFact[];
  notice?: { tone: Tone; icon?: IconName; title: ReactNode; body?: ReactNode; aside?: ReactNode };
  /** The tab row. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("animate-ms-card-in flex min-w-0 flex-col gap-5 rounded-ms-card bg-ms-card px-6 pt-6 shadow-ms-1", !children && "pb-6", className)}>
      <div className="flex flex-wrap items-start gap-4">
        {avatar}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-[26px] font-bold leading-8 text-ms-fg [overflow-wrap:anywhere]">{title}</h1>
            {badges}
          </div>
          {meta?.length ? (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[14px] text-ms-fg-2">
              {meta.map((m, i) => (
                <span key={i} className="tabular-nums">{m}</span>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {facts.length ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-ms-line lg:grid-cols-4">
          {facts.map((f, i) => {
            const inner = (
              <>
                <dt className="text-[13px] text-ms-fg-3">{f.label}</dt>
                <dd className="flex flex-wrap items-baseline gap-1">
                  <span className={cn("text-[20px] font-bold leading-6 tabular-nums", f.tone ? FG[f.tone] : "text-ms-fg")}>{f.value}</span>
                  {f.unit ? <span className="text-[13px] text-ms-fg-2">{f.unit}</span> : null}
                </dd>
                {f.sub ? <dd className="text-[12.5px] leading-[17px] text-ms-fg-3">{f.sub}</dd> : null}
              </>
            );
            return f.href ? (
              <Link key={i} href={f.href} className="flex min-w-0 flex-col gap-1 bg-ms-surface px-4 py-3 hover:bg-ms-surface-2">
                {inner}
              </Link>
            ) : (
              <div key={i} className="flex min-w-0 flex-col gap-1 bg-ms-surface px-4 py-3">
                {inner}
              </div>
            );
          })}
        </dl>
      ) : null}
      {notice ? (
        <div className={cn("flex flex-wrap items-start gap-3 rounded-[14px] px-4 py-3", SOFT[notice.tone])}>
          <Icon name={notice.icon ?? "info"} className="mt-0.5 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-[14px]">
            <b className="font-semibold">{notice.title}</b>
            {notice.body ? <span className="text-ms-fg-2">{notice.body}</span> : null}
          </span>
          {notice.aside}
        </div>
      ) : null}
      {children ? <div className="-mx-2">{children}</div> : null}
    </section>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

export type TimelineEvent = {
  id: string | number;
  /** For the filter chips: "money", "seat", "messages", "security". */
  kind: string;
  icon: IconName;
  tone: Tone;
  title: ReactNode;
  /** Who · when: "by Dilnoza Karimova · 14 Oct". */
  meta: ReactNode;
  /** Right: an amount, a verdict. */
  aside?: ReactNode;
  /** Where one helps: "Resend". */
  action?: ReactNode;
};

/** History, newest first, with filter chips that count what they would show. */
export function Timeline({
  events,
  filters = [],
  label = "History",
  empty = "Nothing has happened yet.",
}: {
  events: TimelineEvent[];
  filters?: { id: string; label: string }[];
  label?: string;
  empty?: string;
}) {
  const [kind, setKind] = useState("all");
  const shown = useMemo(() => (kind === "all" ? events : events.filter((e) => e.kind === kind)), [events, kind]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {filters.length ? (
        <div role="group" aria-label={`Filter ${label.toLowerCase()}`} className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {[{ id: "all", label: "All" }, ...filters].map((f) => {
            const n = f.id === "all" ? events.length : events.filter((e) => e.kind === f.id).length;
            return (
              <button key={f.id} type="button" aria-pressed={kind === f.id} onClick={() => setKind(f.id)} className={chipClass(kind === f.id, n === 0)}>
                {f.label}
                <ChipCount n={n} on={kind === f.id} />
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="py-3 text-[14px] text-ms-fg-2">{kind === "all" ? empty : "Nothing of this kind yet."}</p>
      ) : (
        <ol aria-label={label} className="flex flex-col">
          {shown.map((e, i) => (
            <li key={e.id} className="animate-ms-fade-in relative grid grid-cols-[32px_minmax(0,1fr)] gap-3 pb-[18px]" style={{ animationDelay: `${i * 35}ms` }}>
              {i < shown.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-[34px] w-0.5 bg-ms-border" /> : null}
              <span className={cn("grid size-8 place-items-center rounded-full", SOFT[e.tone])}>
                <Icon name={e.icon} size="sm" />
              </span>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 pt-1">
                <span className="flex min-w-0 flex-col">
                  <span className="text-[14.5px] font-medium leading-5 text-ms-fg">{e.title}</span>
                  <span className="text-[13px] leading-[18px] text-ms-fg-3">{e.meta}</span>
                </span>
                {e.aside || e.action ? (
                  <span className="flex shrink-0 items-center gap-2">
                    {e.aside ? <span className="text-right text-[14px] tabular-nums text-ms-fg">{e.aside}</span> : null}
                    {e.action}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
