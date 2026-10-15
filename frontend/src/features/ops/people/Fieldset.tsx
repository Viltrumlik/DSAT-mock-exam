"use client";

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { cn } from "@/lib/cn";

/** A Django-admin fieldset: a thin header bar and its rows. Plain — no tint, no icon. */
export function Fieldset({
  title,
  right,
  children,
  className,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-md border border-border bg-card", className)} aria-label={title}>
      <header className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
        {right}
      </header>
      <div className="p-3 text-[13px]">{children}</div>
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
  if (query.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-muted-foreground">
        Could not load.{" "}
        <button
          type="button"
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-primary-hover"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </p>
    );
  }
  if (isEmpty(query.data)) return <p className="text-muted-foreground">Nothing yet</p>;
  return <>{render(query.data)}</>;
}

/** A label/value row, as Django's read-only field. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-border py-1.5 last:border-b-0 sm:grid-cols-[10rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

/** The changelist's dense table (34px rows), inside a box that scrolls sideways on a phone. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-3 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                scope="col"
                className="h-8 whitespace-nowrap border-b border-border px-3 text-left text-[12px] font-semibold text-muted-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}

/** One cell of `Table`. */
export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <td className={cn("h-[34px] whitespace-nowrap border-b border-border px-3 text-foreground", className)}>{children}</td>
  );
}

/** A subsection heading inside a fieldset ("Earlier groups", "Payments"). */
export function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 mt-4 text-xs font-semibold uppercase text-muted-foreground first:mt-0">{children}</h3>;
}

/** The changelist's link colour, for a link inside a table or a row. */
export const LINK_CLASS = "text-primary hover:underline dark:text-primary-hover";
