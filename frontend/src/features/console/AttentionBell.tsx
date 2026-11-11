"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { attentionCount, type AttentionSource } from "./attention";
import { AttentionList } from "./AttentionList";

/**
 * The top bar's bell (design handoff v0.3, Shell board): the same items as the dashboard's
 * "Needs you", from anywhere. Its number is the count of KINDS of problem, not of people, and shows
 * only when there is one. Hidden for anyone with no sources (their role reads none of them).
 */
export function AttentionBell({ sources }: { sources: readonly AttentionSource[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const count = attentionCount(sources);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!sources.length) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={count ? `${count} ${count === 1 ? "thing needs" : "things need"} you` : "Needs you"}
        onClick={() => setOpen((o) => !o)}
        className="ms-transition relative grid size-11 shrink-0 place-items-center rounded-full text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg"
      >
        <Icon name="bell" size="lg" />
        {count ? (
          <span key={count} className="animate-ms-pop absolute right-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ms-danger-btn px-1 text-[12px] font-semibold tabular-nums text-white">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Needs you"
          className="animate-ms-dialog-in absolute right-0 top-full z-50 origin-top-right mt-2 w-[min(420px,calc(100vw-24px))] rounded-ms-pop border border-ms-border bg-ms-card px-4 pb-2 pt-3 shadow-ms-2"
        >
          <div className="pb-1 text-[13px] font-semibold text-ms-fg-3">Needs you</div>
          <AttentionList sources={sources} onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
