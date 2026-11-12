"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { usePresence } from "./presence";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal frame (design handoff v0.3, Overlays board): scrim and panel come in and go out, focus
 * stays inside (Tab cycles), Esc closes unless `locked`, and focus goes back where it was. In a
 * portal with its own `.ms`, so a transformed ancestor cannot trap it.
 */
export function Dialog({
  open,
  onClose,
  labelledBy,
  width = 440,
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  width?: number;
  /** While true (an action is running) Esc and the scrim do nothing. */
  locked?: boolean;
  children: ReactNode;
}) {
  const { mounted, closing } = usePresence(open);
  const panel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => back?.focus?.();
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (!locked) onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const [head, tail] = [items[0], items[items.length - 1]];
    if (e.shiftKey && document.activeElement === head) {
      e.preventDefault();
      tail.focus();
    } else if (!e.shiftKey && document.activeElement === tail) {
      e.preventDefault();
      head.focus();
    }
  };

  return createPortal(
    <div className="ms fixed inset-0 z-[70] grid place-items-center bg-transparent p-4" data-state={closing ? "closing" : "open"}>
      <div
        aria-hidden="true"
        className={cn("absolute inset-0 bg-ms-scrim", closing ? "animate-ms-scrim-out" : "animate-ms-scrim-in")}
        onClick={() => {
          if (!locked) onClose();
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        style={{ maxWidth: width }}
        className={cn(
          "relative flex max-h-[calc(100dvh-32px)] w-full flex-col overflow-hidden rounded-ms-dlg border border-ms-border bg-ms-card shadow-ms-3",
          closing ? "animate-ms-dialog-out" : "animate-ms-dialog-in",
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

type Phase = "idle" | "busy" | "done";

/**
 * "Only for what cannot be undone — and they say what will happen" (Overlays board). The title asks
 * the question with the name or count; `children` lists the consequences; the confirm button repeats
 * the action and the count and shows its progress (do → doing → done). `typeToConfirm` ("DELETE")
 * must be typed first. If `onConfirm` throws, the dialog shakes and says why, and stays open.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  icon,
  tone = "info",
  children,
  confirmLabel,
  busyLabel,
  doneLabel,
  confirmIcon,
  typeToConfirm,
  onConfirm,
  afterError,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon: IconName;
  tone?: "info" | "critical" | "frozen";
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  doneLabel?: string;
  confirmIcon?: IconName;
  typeToConfirm?: string;
  /** Resolve when it went through; throw an Error whose message says what went wrong. */
  onConfirm: () => Promise<void>;
  /** Under the error: the stronger way out a refusal opens (an assessment set's force delete after a 409). */
  afterError?: ReactNode;
}) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [typed, setTyped] = useState("");
  const [openedFor, setOpenedFor] = useState(open);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setPhase("idle");
      setError(null);
      setTyped("");
    }
  }
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const danger = tone === "critical";
  const ready = !typeToConfirm || typed.trim().toUpperCase() === typeToConfirm.toUpperCase();
  const run = async () => {
    if (!ready || phase !== "idle") return;
    setPhase("busy");
    setError(null);
    try {
      await onConfirm();
      setPhase("done");
      timer.current = window.setTimeout(onClose, 650);
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error && e.message ? e.message : "That didn’t go through. Try again.");
      setShake((n) => n + 1);
    }
  };

  const ICON_TONE = {
    info: "bg-ms-info-soft text-ms-info-fg",
    critical: "bg-ms-critical-soft text-ms-critical-fg",
    frozen: "bg-ms-frozen-soft text-ms-frozen-fg",
  } as const;

  return (
    <Dialog open={open} onClose={onClose} labelledBy={id} locked={phase !== "idle"}>
      <div
        key={shake}
        className={cn("flex flex-col gap-3.5 overflow-y-auto px-[22px] pb-2 pt-[22px]", shake > 0 && "animate-ms-shake")}
      >
        <span className={cn("grid size-10 place-items-center rounded-[12px]", ICON_TONE[tone])}>
          <Icon name={icon} />
        </span>
        <h2 id={id} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
          {title}
        </h2>
        <div className="flex flex-col gap-2 text-[15px] leading-[23px] text-ms-fg-2">{children}</div>
        {typeToConfirm ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold text-ms-fg">Type {typeToConfirm} to confirm</span>
            <input
              data-autofocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "ms-transition h-(--ms-h-ctl) rounded-ms-ctl border bg-ms-card px-3 font-ms-mono text-[15px] text-ms-fg focus-visible:outline-none",
                error ? "border-ms-critical focus-visible:shadow-[0_0_0_3px_var(--ms-critical-soft)]" : "border-ms-border-input focus-visible:border-ms-primary focus-visible:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]",
              )}
            />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="animate-ms-fade-in flex items-start gap-2 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3 py-2.5 text-[14px] text-ms-fg">
            <Icon name="alert" size="sm" className="mt-0.5 shrink-0 text-ms-critical-fg" />
            {error}
          </p>
        ) : null}
        {afterError}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">
        <Button variant="ghost" onClick={onClose} disabled={phase !== "idle"} data-autofocus={typeToConfirm ? undefined : true}>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          icon={confirmIcon}
          state={phase}
          busyLabel={busyLabel}
          doneLabel={doneLabel}
          disabled={!ready}
          onClick={() => void run()}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
