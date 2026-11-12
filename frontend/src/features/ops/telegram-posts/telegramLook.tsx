"use client";

import { useId, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Checkbox, Dialog, buttonClass, inputShell, type BadgeTone } from "@/features/console/ui";
import { cn } from "@/lib/cn";

/**
 * The console's look (design handoff v0.3) for the Telegram posts pages and the /ops/events page that shares
 * their audience picker: cards, notices, a ticked row with its words, the dialog frame. The words are the
 * pages' own; these only draw them.
 */

/** A card on the page. `overflow-hidden` so a row's hover fill keeps the card's corners. */
export const BOX = "overflow-hidden rounded-ms-card bg-ms-card shadow-ms-1";
/** The small grey heading over a card's rows. */
export const CAPTION = "text-ms-over uppercase text-ms-fg-3";
/** A card's caption row. */
export const CAPTION_ROW = "flex min-h-11 items-center gap-2 border-b border-ms-line px-5 py-2.5";
/** A long field in the console's shell. */
export const AREA = inputShell({ area: true, className: "w-full resize-y outline-none placeholder:text-ms-fg-3" });
/** A native file input with its button drawn as a secondary console button. */
export const FILE_INPUT =
  "block w-full min-w-0 text-[14px] text-ms-fg-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-ms-btn file:border-0 file:bg-ms-surface-2 file:px-3 file:text-[14px] file:font-semibold file:text-ms-fg hover:file:bg-ms-surface-3";
/** A link that reads as a link in running text. */
export const TEXT_LINK = "font-medium text-ms-primary-text hover:underline";

/** The old badge variants (`audience.ts` keeps them) as the console's verdict tones. */
const TONE_OF: Record<string, BadgeTone> = {
  success: "positive",
  warning: "attention",
  danger: "critical",
  info: "info",
  neutral: "neutral",
  outline: "line",
};
export function toneOf(variant: string): BadgeTone {
  return TONE_OF[variant] ?? "neutral";
}
/** A verdict leads with a dot; a plain state does not. */
export function dotted(tone: BadgeTone): boolean {
  return tone === "positive" || tone === "attention" || tone === "critical";
}

type NoticeTone = "info" | "success" | "warning" | "danger";
const NOTICE: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: { box: "border-ms-info-line bg-ms-info-soft text-ms-info-fg", icon: "info" },
  success: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
  warning: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  danger: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
};

/** A notice in its verdict's soft tone, the icon first. */
export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const look = NOTICE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5", look.box)}
    >
      <Icon name={look.icon} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "The <what> didn't load." and Try again — an error, never drawn like an empty list. */
export function LoadFailed({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="animate-ms-fade-in m-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ms-ctl border border-ms-critical-line bg-ms-critical-soft px-3.5 py-3 text-[14px]">
      <Icon name="alert" size="sm" className="text-ms-critical-fg" />
      <p className="min-w-0 flex-1 font-semibold text-ms-fg">{children}</p>
      <button type="button" onClick={onRetry} className={buttonClass({ variant: "ghost", size: "sm", className: "text-ms-primary-text" })}>
        Try again
      </button>
    </div>
  );
}

/** Rows that are still loading. */
export function RowsLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2" />
      ))}
    </div>
  );
}

/** A console tick box with its words beside it; the whole row is the label. */
export function CheckRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex min-h-9 items-center gap-2.5 text-[14px] leading-5 text-ms-fg", disabled ? "cursor-not-allowed text-ms-fg-disabled" : "cursor-pointer")}>
      <Checkbox label={label} checked={checked} onChange={onChange} disabled={disabled} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** One radio as a pill that fills when chosen; the label holds the input, so a click on the words picks it. */
export function RadioPill({
  name,
  checked,
  disabled = false,
  onChange,
  children,
}: {
  name?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "ms-transition inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[14px] font-medium",
        checked ? "border-ms-primary bg-ms-primary-soft text-ms-primary-text" : "border-ms-border-input bg-ms-card text-ms-fg hover:bg-ms-surface",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="size-4 shrink-0 accent-[var(--ms-primary)]" />
      {children}
    </label>
  );
}

/** The console dialog with a title, an optional line under it, a scrolling body and a footer of buttons. */
export function FormDialog({
  title,
  description,
  onClose,
  width = 560,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog open onClose={onClose} labelledBy={id} width={width}>
      <div className="flex items-start gap-3 border-b border-ms-border px-[22px] pb-3.5 pt-[18px]">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="truncate text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-[14px] text-ms-fg-2">{description}</p> : null}
        </div>
        <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} className="-mr-1.5" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">{children}</div>
      {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">{footer}</div> : null}
    </Dialog>
  );
}
