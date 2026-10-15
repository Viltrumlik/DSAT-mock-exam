"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { cn } from "@/lib/cn";

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
  primary: "text-primary",
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  danger: "text-danger",
  info: "text-info-foreground",
  accent: "text-info-foreground",
  neutral: "text-foreground",
};

const TONE_SQUARE: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning-foreground",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info-foreground",
  accent: "bg-accent-soft text-accent",
  neutral: "bg-surface-2 text-muted-foreground",
};

/** A small coloured square holding an icon — what a box or a tile is about, at a glance. */
export function IconSquare({ icon: Icon, tone = "primary", size = "md" }: { icon: LucideIcon; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg",
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
      className={cn("min-w-0 rounded-xl border border-border bg-card shadow-sm", className)}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-3 px-5 pb-1 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? <IconSquare icon={icon} tone={tone} /> : null}
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {right}
      </header>
      <div className="px-5 pb-5 pt-3 text-sm">{children}</div>
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
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-2" />
        <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface-2" />
        <div className="h-3.5 w-3/5 animate-pulse rounded bg-surface-2" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2.5 text-danger-foreground">
        Could not load.{" "}
        <button
          type="button"
          className="font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    );
  }
  if (isEmpty(query.data)) return <p className="py-2 text-muted-foreground">Nothing yet</p>;
  return <>{render(query.data)}</>;
}

/** A label and its value, the label on the left — Django's read-only field, with room to breathe. */
export function Row({ label, icon: Icon, children }: { label: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-2.5 last:border-b-0">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        {Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
        {label}
      </span>
      <span className="min-w-0 break-words text-right font-medium text-foreground">{children}</span>
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
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon ? <IconSquare icon={icon} tone={tone === "neutral" ? "primary" : tone} size="sm" /> : null}
        <span className="truncate">{label}</span>
      </div>
      {/* Wrapped, never cut: on a phone's half-width tile "650,000 UZS" lost its last digits to "…". */}
      <div className={cn("mt-2 break-words text-lg font-semibold leading-snug tabular-nums sm:text-xl", TONE_TEXT[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 break-words text-xs text-muted-foreground">{sub}</div> : null}
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
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm text-foreground lining-nums">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "h-9 whitespace-nowrap border-y border-border bg-surface-2/60 px-3 text-left text-xs font-semibold text-muted-foreground first:pl-5 last:pr-5",
                  typeof h === "string" ? undefined : h.className,
                )}
              >
                {typeof h === "string" ? h : h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:hover>td]:bg-surface-2/40">{children}</tbody>
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
        "h-11 border-b border-border/70 px-3 first:pl-5 last:pr-5",
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
    <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">{children}</h3>
  );
}

/** The console's link colour, for a link inside a table or a row. */
export const LINK_CLASS = "font-medium text-primary hover:underline dark:text-primary-hover";
