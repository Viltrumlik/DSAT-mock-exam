"use client";

import { useId, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Dialog, inputShell } from "@/features/console/ui";
import { FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

/**
 * What the console's settings pages share — Branches, Mobile app, Exam dates, Shop, Stories, Broadcast — in the
 * console's look (design handoff v0.3): a card with a caption row, a notice in its verdict's soft tone, a load
 * failure that is never drawn as an empty list, a labelled field, a tick box with its words, and a form dialog.
 * The words are always the page's own: nothing here adds one.
 */

// ── notices ──────────────────────────────────────────────────────────────

export type NoticeTone = "info" | "success" | "warning" | "danger";

const NOTICE: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: { box: "border-ms-info-line bg-ms-info-soft text-ms-info-fg", icon: "info" },
  success: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
  warning: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  danger: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
};

/** A notice in its verdict's soft tone, its icon first. A refusal is an alert; the rest are statuses. */
export function Notice({ tone, children, className }: { tone: NoticeTone; children: ReactNode; className?: string }) {
  const look = NOTICE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5", look.box, className)}
    >
      <Icon name={look.icon} size="sm" className="mt-0.5 size-4" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── the card ─────────────────────────────────────────────────────────────

/** A card with a caption row: the caption at the left, a count or a fact at the right. */
export function Panel({
  title,
  icon,
  aside,
  children,
  className,
  label,
}: {
  title: ReactNode;
  icon?: IconName;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The region's name for a screen reader, when the caption is not plain words. */
  label?: string;
}) {
  return (
    <section aria-label={label} className={cn("animate-ms-card-in overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1", className)}>
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-ms-line px-5 py-2.5">
        {icon ? <Icon name={icon} size="sm" className="text-ms-fg-3" /> : null}
        <h2 className="text-ms-over uppercase text-ms-fg-3">{title}</h2>
        {aside ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A count at the caption's right. `tone="primary"` when the count is work waiting. */
export function CaptionCount({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[13px] font-semibold tabular-nums leading-none",
        tone === "primary" ? "bg-ms-primary-soft text-ms-primary-text" : "bg-ms-surface-2 text-ms-fg-2",
      )}
    >
      {children}
    </span>
  );
}

/** Rows that are still loading: shimmering bars, never words that pretend to be data. */
export function SkeletonRows({ count, thumb }: { count: number; thumb?: "square" | "round" }) {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-ms-line">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          {thumb ? (
            <div className={cn("size-12 shrink-0 animate-ms-shimmer bg-ms-surface-2", thumb === "round" ? "rounded-full" : "rounded-[10px]")} />
          ) : null}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-48 max-w-full animate-ms-shimmer rounded-[6px] bg-ms-surface-2" />
            <div className="h-3 w-28 max-w-full animate-ms-shimmer rounded-[6px] bg-ms-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A small text action: Try again, Refund. */
export const TEXT_BUTTON =
  "ms-transition rounded-[6px] text-[14px] font-semibold text-ms-primary-text hover:underline disabled:cursor-not-allowed disabled:text-ms-fg-disabled disabled:hover:no-underline";

/** A list that did not load, in the page's words, and a way to try again. An error is never an empty list. */
export function LoadFailed({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="p-4">
      <div role="alert" className="animate-ms-fade-in flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
        <Icon name="alert" size="sm" className="text-ms-critical-fg" />
        <span className="min-w-0 flex-1 font-semibold text-ms-fg">{children}</span>
        <button type="button" onClick={onRetry} className={TEXT_BUTTON}>
          Try again
        </button>
      </div>
    </div>
  );
}

// ── fields ───────────────────────────────────────────────────────────────

/** A long free-text field in the console's shell. */
export const AREA = inputShell({
  area: true,
  className: "w-full resize-y outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
});

/** A native file picker, its button in the console's soft primary. */
export const FILE_INPUT =
  "block w-full text-[14px] text-ms-fg-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-[10px] file:border-0 file:bg-ms-primary-soft file:px-3 file:text-[14px] file:font-semibold file:text-ms-primary-text disabled:opacity-50";

/** The label above a native control (by `htmlFor`), its help or its error below. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <label htmlFor={htmlFor} className={FIELD_LABEL}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-ms-critical-fg">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="animate-ms-fade-in mt-1.5 flex items-start gap-1.5 text-[13px] font-medium leading-[18px] text-ms-critical-fg">
          <Icon name="alert" size="sm" className="mt-px size-3.5" />
          {error}
        </p>
      ) : hint ? (
        <p className={HINT}>{hint}</p>
      ) : null}
    </div>
  );
}

/** A tick box with its words beside it: a real checkbox under the console's 20 px box. */
export function CheckRow({
  id,
  checked,
  onChange,
  disabled = false,
  children,
  className,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("inline-flex select-none items-center gap-2.5 text-[14px] font-medium leading-5 text-ms-fg", disabled ? "cursor-not-allowed text-ms-fg-3" : "cursor-pointer", className)}>
      <span className="relative inline-grid size-5 shrink-0 place-items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-[1] m-0 cursor-pointer appearance-none rounded-[6px] focus-visible:outline-none disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className={cn(
            "ms-transition grid size-5 place-items-center rounded-[6px] border-[1.5px] text-white",
            "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ms-ring",
            disabled ? "border-ms-border bg-ms-surface-2" : checked ? "border-ms-primary bg-ms-primary" : "border-ms-border-input bg-ms-card",
          )}
        >
          {checked ? <Icon name="check" size="sm" className="animate-ms-check-pop size-3.5" /> : null}
        </span>
      </span>
      <span>{children}</span>
    </label>
  );
}

// ── the form dialog ──────────────────────────────────────────────────────

/** A form in the console's dialog: its title and Close at the top, the fields scrolling, the actions at the foot. */
export function FormDialog({
  open,
  onClose,
  title,
  width = 520,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={titleId} width={width}>
      <div className="flex items-start justify-between gap-3 border-b border-ms-line px-[22px] pb-3.5 pt-[18px]">
        <h2 id={titleId} className="min-w-0 break-words text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
          {title}
        </h2>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">{footer}</div>
      ) : null}
    </Dialog>
  );
}
