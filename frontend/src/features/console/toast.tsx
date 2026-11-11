"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { usePresence } from "./ui/presence";

/**
 * The console's toast (design handoff v0.3, Overlays + Motion boards): bottom-centre, one at a time
 * (the newest replaces the older), it rises in and sinks out. With Undo it stays 8 s while a ring
 * counts down, and pauses on hover or focus; an error stays until dismissed; anything else leaves
 * after 5 s. Never the only place a failure is shown.
 */
export type ToastInput = {
  message: string;
  icon?: IconName;
  tone?: "neutral" | "error";
  /** One action besides Undo: "Retry", "View". */
  action?: { label: string; icon?: IconName; run: () => void };
  /** Only for what is exactly reversible. */
  undo?: () => void | Promise<void>;
};
type Shown = ToastInput & { id: number };

export const UNDO_MS = 8000;
const PLAIN_MS = 5000;

let current: Shown | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const toast = {
  show(input: ToastInput): number {
    current = { ...input, id: ++seq };
    emit();
    return current.id;
  },
  dismiss(id?: number) {
    if (current && (id === undefined || current.id === id)) {
      current = null;
      emit();
    }
  },
};

export function useToast(): Shown | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

/** The one toast on screen. Mounted once, in the console shell. */
export function Toaster() {
  const live = useToast();
  // The toast keeps drawing while it sinks out after it was dismissed.
  const [last, setLast] = useState<Shown | null>(live);
  if (live && live !== last) setLast(live);
  const { mounted, closing } = usePresence(Boolean(live));
  const shown = live ?? last;

  const [paused, setPaused] = useState(false);
  const left = useRef(0);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const life = shown ? (shown.undo ? UNDO_MS : shown.tone === "error" ? 0 : PLAIN_MS) : 0;

  // A new toast starts its clock; pausing keeps what is left of it.
  useEffect(() => {
    if (!live || !life) return;
    left.current = life;
    setPaused(false);
  }, [live, life]);
  useEffect(() => {
    if (!live || !life || paused) return;
    started.current = Date.now();
    const id = live.id;
    timer.current = window.setTimeout(() => toast.dismiss(id), left.current);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      left.current = Math.max(0, left.current - (Date.now() - started.current));
    };
  }, [live, life, paused]);

  if (!mounted || !shown || typeof document === "undefined") return null;
  const error = shown.tone === "error";
  return createPortal(
    <div className="ms pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center bg-transparent px-4">
      <div
        key={shown.id}
        role={error ? "alert" : "status"}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        className={cn(
          "pointer-events-auto flex min-h-[52px] max-w-[min(560px,100%)] items-center gap-3 rounded-[16px] py-2 pl-[18px] pr-2 text-[15px] font-medium leading-5 shadow-ms-2",
          error ? "bg-ms-critical-soft text-ms-fg ring-1 ring-ms-critical-line" : "bg-ms-inverse-bg text-ms-inverse-fg",
          closing ? "animate-ms-sink-out" : "animate-ms-rise-in",
        )}
      >
        {shown.icon || error ? <Icon name={shown.icon ?? "alert"} className={cn("shrink-0", error && "text-ms-critical-fg")} /> : null}
        <span className="flex-1">{shown.message}</span>
        {shown.undo ? (
          <button
            type="button"
            onClick={async () => {
              const id = shown.id;
              await shown.undo?.();
              toast.dismiss(id);
            }}
            className="ms-press inline-flex h-9 shrink-0 items-center gap-2 rounded-[8px] px-3 font-semibold text-ms-inverse-link hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]"
          >
            {/* A real clock: how long Undo is still possible. */}
            <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".3" />
              <circle
                className="animate-ms-countdown"
                style={{ ["--ms-undo" as string]: `${UNDO_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                cx="11"
                cy="11"
                r="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                transform="rotate(-90 11 11)"
              />
            </svg>
            Undo
          </button>
        ) : null}
        {shown.action ? (
          <button
            type="button"
            onClick={() => {
              shown.action?.run();
              toast.dismiss(shown.id);
            }}
            className={cn(
              "ms-press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 font-semibold",
              error ? "text-ms-primary-text hover:bg-ms-card" : "text-ms-inverse-link hover:bg-[color-mix(in_srgb,currentColor_12%,transparent)]",
            )}
          >
            {shown.action.icon ? <Icon name={shown.action.icon} size="sm" /> : null}
            {shown.action.label}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => toast.dismiss(shown.id)}
          className="ms-press grid size-9 shrink-0 place-items-center rounded-[8px] opacity-70 hover:opacity-100"
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
