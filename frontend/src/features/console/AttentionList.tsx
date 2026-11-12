"use client";

import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import type { AttentionSource } from "./attention";
import { buttonClass } from "./ui";
import { Illustration } from "./graphics/Illustration";

const TONE = {
  critical: "bg-ms-critical-soft text-ms-critical-fg",
  attention: "bg-ms-attention-soft text-ms-attention-fg",
  info: "bg-ms-info-soft text-ms-info-fg",
} as const;

/**
 * The "Needs you" list — the dashboard's card and the bell's panel show the same rows. Items first,
 * most urgent first (the sources' order); then a line for each source still loading or failed.
 * "Nothing needs you" is said only when every source answered and none has anything.
 */
export function AttentionList({
  sources,
  onNavigate,
  illustrate = false,
}: {
  sources: readonly AttentionSource[];
  onNavigate?: () => void;
  /** On a dashboard card: "All caught up" with the sunrise (Graphics board). Never in the bell's popover. */
  illustrate?: boolean;
}) {
  const items = sources.flatMap((s) => (s.item ? [s.item] : []));
  const loading = sources.filter((s) => s.status === "loading");
  const failed = sources.filter((s) => s.status === "error");

  return (
    <div className="flex flex-col">
      {items.map((item, i) => (
        <div
          key={item.id}
          className="animate-ms-fade-in flex items-center gap-3.5 border-b border-ms-line py-3 last:border-b-0"
          style={{ animationDelay: `${i * 50}ms` }}
        >
          <span
            className={`animate-ms-check-pop grid size-10 shrink-0 place-items-center rounded-[12px] ${TONE[item.tone]}`}
            style={{ animationDelay: `${60 + i * 50}ms` }}
          >
            <Icon name={item.icon} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold leading-5 text-ms-fg">{item.title}</span>
            {item.detail ? <span className="truncate text-[13px] leading-[18px] text-ms-fg-3">{item.detail}</span> : null}
          </span>
          <Link
            href={item.action.href}
            onClick={onNavigate}
            className={buttonClass({ size: "sm" })}
          >
            {item.action.label}
            <Icon name="right" size="sm" />
          </Link>
        </div>
      ))}
      {loading.length ? (
        <div aria-live="polite" className="flex flex-col gap-2.5 py-3">
          {loading.map((s) => (
            <span key={s.id} className="flex items-center gap-3.5">
              <span aria-hidden="true" className="animate-ms-shimmer size-10 shrink-0 rounded-full" />
              <span aria-hidden="true" className="animate-ms-shimmer h-3.5 w-1/2 rounded-[6px]" />
              <span className="sr-only">Checking {s.label}…</span>
            </span>
          ))}
        </div>
      ) : null}
      {failed.map((s) => (
        <div key={s.id} className="flex items-center gap-3 py-2.5 text-[14px]">
          <Icon name="alert" size="sm" className="text-ms-critical-fg" />
          <span className="flex-1 text-ms-critical-fg">Couldn’t check {s.label}.</span>
          <button type="button" onClick={s.retry} className="ms-press min-h-9 rounded-[8px] px-2.5 font-semibold text-ms-primary-text hover:bg-ms-surface-2">
            Retry
          </button>
        </div>
      ))}
      {items.length === 0 && loading.length === 0 && failed.length === 0 && illustrate ? (
        <div className="animate-ms-fade-in flex flex-col items-center gap-1.5 py-4 text-center">
          <Illustration name="sunrise" decorative className="mb-1 w-[180px]" />
          <b className="text-[16px] font-semibold text-ms-fg">All caught up</b>
          <p className="text-[14px] text-ms-fg-2">Nothing needs you right now.</p>
        </div>
      ) : items.length === 0 && loading.length === 0 && failed.length === 0 ? (
        <p className="flex items-center gap-2.5 py-4 text-[15px] text-ms-fg-2">
          {/* Done — the tick draws once and the words stay (Motion board). */}
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 text-ms-positive-fg">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.8" opacity=".3" />
            <path className="animate-ms-check-draw" d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="animate-ms-fade-in [animation-delay:160ms]">Nothing needs you right now.</span>
        </p>
      ) : null}
    </div>
  );
}
