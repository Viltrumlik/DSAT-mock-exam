"use client";

import type { ReactNode } from "react";

import { Icon } from "@/components/ui/Icon";
import { buttonClass } from "./Button";
import { follow } from "./follow";

/** "1 2 3 … 9": the ends, and the current page with one either side. */
export function pageWindow(page: number, pages: number): Array<number | "…"> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  keep.forEach((n, i) => {
    const prev = keep[i - 1];
    if (prev !== undefined && n - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) out.push("…");
    out.push(n);
  });
  return out;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * Pages under a list (DataDisplay board): "1–25 of 219 students" on the left; per page, ‹ 1 2 … 9 ›
 * on the right. Page links are real links (a new tab works); a plain click goes through `onPage`.
 */
export function Pagination({
  page,
  pages,
  count,
  pageSize,
  pageSizes,
  noun,
  hrefFor,
  onPage,
  onPageSize,
}: {
  page: number;
  pages: number;
  count: number;
  pageSize: number;
  pageSizes: readonly number[];
  noun: { singular: string; plural: string };
  hrefFor: (page: number) => string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const from = count === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(count, page * pageSize);
  const square = buttonClass({ variant: "ghost", size: "sm", square: true, className: "tabular-nums" });
  const step = (p: number, icon: "left" | "right", label: string): ReactNode =>
    p >= 1 && p <= pages ? (
      <a href={hrefFor(p)} aria-label={label} onClick={(e) => follow(e, () => onPage(p))} className={buttonClass({ size: "sm", square: true })}>
        <Icon name={icon} size="sm" />
      </a>
    ) : (
      <button type="button" disabled aria-label={label} className={buttonClass({ size: "sm", square: true })}>
        <Icon name={icon} size="sm" />
      </button>
    );

  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3.5 text-[14px]">
      <span className="tabular-nums text-ms-fg-2">
        {count > 0 ? `${fmt(from)}–${fmt(to)} of ` : ""}
        {fmt(count)} {count === 1 ? noun.singular : noun.plural}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-ms-fg-2">
          Per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="ms-transition h-9 rounded-ms-ctl border border-ms-border-input bg-ms-card pl-2.5 pr-2 text-[14px] tabular-nums text-ms-fg focus-visible:border-ms-primary"
          >
            {pageSizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {pages > 1 ? (
          <div className="flex items-center gap-1">
            {step(page - 1, "left", "Previous page")}
            {pageWindow(page, pages).map((n, i) =>
              n === "…" ? (
                <span key={`gap-${i}`} aria-hidden="true" className="px-1 text-ms-fg-3">
                  …
                </span>
              ) : n === page ? (
                <span key={n} aria-current="page" className={buttonClass({ variant: "subtle", size: "sm", square: true, className: "tabular-nums" })}>
                  {n}
                </span>
              ) : (
                <a key={n} href={hrefFor(n)} aria-label={`Page ${n}`} onClick={(e) => follow(e, () => onPage(n))} className={square}>
                  {n}
                </a>
              ),
            )}
            {step(page + 1, "right", "Next page")}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
