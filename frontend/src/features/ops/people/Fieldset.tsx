"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/features/console/ui";

/**
 * A fact or a verdict as the console's pill (design handoff v0.3, rule 3): a verdict — positive, attention,
 * critical — leads with a dot so it is never colour alone; a fact that is no verdict stays neutral or outlined.
 */
export function Pill({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const verdict = tone === "positive" || tone === "attention" || tone === "critical";
  return (
    <Badge tone={tone} dot={verdict}>
      {children}
    </Badge>
  );
}

/**
 * The building blocks of an /ops change form. Close to Django admin — a box per subject, label and
 * value rows, plain tables — but made to be read (owner, 2026-10-15: "ux uchun ishlang … ranglar
 * qo'shing ba'zi elementlarga … spacing bilan ishlang odamlar elementlarni ajratishi uchun"): room
 * between things, an icon and a colour that say what a box is about, and colour on the values that
 * carry a verdict (a debt, an absence, a pass) — never on everything.
 */

/** The colours a verdict may take, from the app's semantic tokens. */
export type Tone = "primary" | "success" | "warning" | "danger" | "info" | "accent" | "neutral";

/**
 * A tone as text. Each passes WCAG AA on a card (4.5:1) at 14px: the bright `--success` (3.8:1)
 * and `--accent` (2.8:1) are for dots and icons, so their text takes the deeper shade.
 */
export const TONE_TEXT: Record<Tone, string> = {
  primary: "text-ms-primary-text",
  success: "text-ms-positive-fg",
  warning: "text-ms-attention-fg",
  danger: "text-ms-critical-fg",
  info: "text-ms-info-fg",
  accent: "text-ms-info-fg",
  neutral: "text-ms-fg",
};

const TONE_SQUARE: Record<Tone, string> = {
  primary: "bg-ms-primary-soft text-ms-primary-text",
  success: "bg-ms-positive-soft text-ms-positive-fg",
  warning: "bg-ms-attention-soft text-ms-attention-fg",
  danger: "bg-ms-critical-soft text-ms-critical-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
  accent: "bg-ms-info-soft text-ms-info-fg",
  neutral: "bg-ms-surface-2 text-ms-fg-2",
};

/** A small coloured square holding an icon — what a box or a tile is about, at a glance. */
export function IconSquare({ icon: Icon, tone = "primary", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px]",
        size === "sm" ? "h-7 w-7" : "h-9 w-9",
        TONE_SQUARE[tone],
      )}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} />
    </span>
  );
}

/** A box for one subject: an icon and a title over its content. */
export function Fieldset({
  title,
  icon,
  tone = "primary",
  description,
  right,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: Tone;
  /** One quiet line under the title: what the box shows, where it comes from. */
  description?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("animate-ms-card-in min-w-0 rounded-ms-card bg-ms-card shadow-ms-1", className)}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-3 px-[22px] pb-1 pt-5">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <IconSquare icon={icon} tone={tone} /> : null}
          <div className="min-w-0">
            <h2 className="text-ms-h text-ms-fg">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-ms-fg-3">{description}</p> : null}
          </div>
        </div>
        {right}
      </header>
      <div className="px-[22px] pb-5 pt-3 text-[14px] text-ms-fg">{children}</div>
    </section>
  );
}

/** One part's body: loading, error with Retry, "Nothing yet", or the data. An error is never the empty text. */
export function PartBody<T>({
  query,
  isEmpty,
  render,
}: {
  query: UseQueryResult<T>;
  isEmpty: (d: T) => boolean;
  render: (d: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <div aria-busy className="space-y-2.5 py-1">
        <span className="sr-only">Loading…</span>
        <div className="animate-ms-shimmer h-3.5 w-2/3 rounded-[6px]" />
        <div className="animate-ms-shimmer h-3.5 w-1/2 rounded-[6px]" />
        <div className="animate-ms-shimmer h-3.5 w-3/5 rounded-[6px]" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="animate-ms-fade-in rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-ms-critical-fg">
        Could not load.{" "}
        <button
          type="button"
          className="font-semibold text-ms-primary-text underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ms-ring"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    );
  }
  if (isEmpty(query.data)) return <p className="py-2 text-ms-fg-2">Nothing yet</p>;
  return <>{render(query.data)}</>;
}

/** A label and its value, the label on the left — Django's read-only field, with room to breathe. */
export function Row({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ms-line py-2.5 last:border-b-0">
      <span className="flex shrink-0 items-center gap-2 text-ms-fg-3">
        {Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
        {label}
      </span>
      <span className="min-w-0 break-words text-right font-medium text-ms-fg">{children}</span>
    </div>
  );
}

/** A figure with its label — the header's glance, a tab's summary. `tone` colours the value only. */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
}) {
  return (
    <div className="min-w-0 rounded-[16px] bg-ms-surface px-4 py-3.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ms-fg-2">
        {icon ? <IconSquare icon={icon} tone={tone === "neutral" ? "primary" : tone} size="sm" /> : null}
        <span className="truncate">{label}</span>
      </div>
      {/* Wrapped, never cut: on a phone's half-width tile "650,000 UZS" lost its last digits to "…". */}
      <div className={cn("mt-2 break-words text-lg font-semibold leading-snug tabular-nums sm:text-xl", TONE_TEXT[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 break-words text-[12.5px] text-ms-fg-3">{sub}</div> : null}
    </div>
  );
}

/**
 * A secondary column a phone does not show: give it to the column's header (`Table`'s `head`) and
 * to each of its cells (`Td`'s `className`), so a phone sees the columns that matter and no table
 * runs wider than its box.
 */
export const WIDE_ONLY = "hidden sm:table-cell";

/** A column header: its text, or its text and the classes its header cell takes (`WIDE_ONLY`). */
export type Column = string | { label: string; className?: string };

/** A table that runs to the box's edges, its header on a soft band and its rows spaced to be read. */
export function Table({ head, children }: { head: Column[]; children: ReactNode }) {
  return (
    <div className="-mx-[22px] overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[14px] text-ms-fg lining-nums">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "h-10 whitespace-nowrap border-b border-ms-border px-3 text-left text-[13px] font-medium text-ms-fg-3 first:pl-[22px] last:pr-[22px]",
                  typeof h === "string" ? undefined : h.className,
                )}
              >
                {typeof h === "string" ? h : h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:hover>td]:bg-ms-surface">{children}</tbody>
      </table>
    </div>
  );
}

/**
 * One cell of `Table`; its colour is inherited, so a `TONE_TEXT` class passed in is the only one
 * (`cn` is not tailwind-merge: a default `text-foreground` beside `text-danger` won by CSS order,
 * and a 50% homework rate showed black). `wrap` lets a phone break the text onto a second line instead of cutting it
 * ("Excused — Kasal" lost its reason to an ellipsis); from `sm` up it stays on one line. A prop, not
 * a class: `cn` is not tailwind-merge, so a `whitespace-normal` passed in would fight the default.
 */
export function Td({ children, className, wrap = false }: { children: ReactNode; className?: string; wrap?: boolean }) {
  return (
    <td
      className={cn(
        "h-11 border-b border-ms-line px-3 first:pl-[22px] last:pr-[22px]",
        wrap ? "whitespace-normal break-words py-2 sm:whitespace-nowrap sm:py-0" : "whitespace-nowrap",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** A subsection heading inside a box ("Earlier groups", "Payments"). */
export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-ms-over mb-2 mt-6 text-ms-fg-3 first:mt-0">{children}</h3>
  );
}

/** The console's link colour, for a link inside a table or a row. */
export const LINK_CLASS = "font-medium text-ms-primary-text hover:underline";
