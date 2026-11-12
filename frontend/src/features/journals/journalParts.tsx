"use client";

/**
 * The small pieces the Journals screens share in the console's look (design handoff v0.3): a field's
 * label and help, the loading line, the notices, the file drop and the file rows. The words stay each
 * screen's own; these only draw them.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";

/** A card on the page: white, rounded, a light shadow. */
export const PANEL = "rounded-ms-card bg-ms-card shadow-ms-1";

/** A back link above a page's title. */
export const BACK_LINK =
  "ms-transition mb-3 inline-flex items-center gap-1.5 rounded-[6px] text-[14px] font-medium text-ms-fg-2 hover:text-ms-primary-text";

/** A small count or state chip that is no verdict ("3 selected", a status code). */
export const CHIP = "inline-flex h-6 items-center whitespace-nowrap rounded-full bg-ms-surface-2 px-[9px] text-[13px] font-medium leading-none text-ms-fg-2";
/** The same chip, a size down, beside a row's or a list's name. */
export const CHIP_SM = "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-ms-surface-2 px-2 text-[12px] font-medium leading-none text-ms-fg-2";

/** A field: its words above (tied to the control by `htmlFor`), its help below. */
export function JField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={FIELD_LABEL}>
          {label}
        </label>
      ) : (
        <span className={FIELD_LABEL}>{label}</span>
      )}
      {children}
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  );
}

/** "Loading …" with the spinner, in a card or bare. */
export function LoadingLine({ children, card = false, className }: { children: ReactNode; card?: boolean; className?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn(
        "animate-ms-fade-in flex items-center gap-2.5 text-[14px] text-ms-fg-2",
        card ? cn(PANEL, "px-5 py-4") : "px-1 py-10",
        className,
      )}
    >
      <Icon name="loader" className="animate-ms-spin text-ms-primary-text" />
      {children}
    </div>
  );
}

/** A standing note in a verdict's colours: saved (positive) or still to do (attention). */
export function Notice({ tone, children }: { tone: "positive" | "attention"; children: ReactNode }) {
  const look = {
    positive: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" as IconName },
    attention: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" as IconName },
  }[tone];
  return (
    <div
      role={tone === "positive" ? "status" : "note"}
      className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] font-medium leading-5", look.box)}
    >
      <Icon name={look.icon} size="sm" className="mt-0.5" />
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** A tinted square holding a section's icon. */
export function Medallion({ icon, tone = "primary", size = "md" }: { icon: IconName; tone?: "primary" | "info"; size?: "md" | "lg" }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center",
        size === "lg" ? "size-12 rounded-[14px]" : "size-9 rounded-[10px]",
        tone === "info" ? "bg-ms-info-soft text-ms-info-fg" : "bg-ms-primary-soft text-ms-primary-text",
      )}
    >
      <Icon name={icon} size={size === "lg" ? "xl" : "md"} />
    </span>
  );
}

/** The dashed drop target over a hidden file input (`htmlFor` names the input). */
export function FileDrop({ htmlFor, roomy = false }: { htmlFor: string; roomy?: boolean }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "ms-transition flex cursor-pointer flex-col items-center gap-1.5 rounded-ms-ctl border-[1.5px] border-dashed border-ms-border-strong bg-ms-surface px-4 text-center hover:border-ms-primary hover:bg-ms-primary-soft",
        roomy ? "py-6" : "py-5",
      )}
    >
      <Icon name="upload" size="lg" className="text-ms-primary-text" />
      <p className="text-[14px] text-ms-fg-2">
        <strong className="font-semibold text-ms-fg">Click to browse</strong> or drop files
      </p>
    </label>
  );
}

/** A file already stored: opens in a new tab. */
export function StoredFile({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ms-transition flex items-center gap-2 rounded-ms-ctl border border-ms-border bg-ms-card px-3 py-2 text-[13px] font-medium text-ms-fg hover:bg-ms-surface"
    >
      <Icon name="file" size="sm" className="text-ms-fg-3" />
      <span className="truncate">{name}</span>
    </a>
  );
}

/** A file picked but not yet saved, with its ×. */
export function PendingFile({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-ms-ctl border border-ms-border bg-ms-surface px-3 py-1.5">
      <Icon name="file" size="sm" className="text-ms-fg-3" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ms-fg">{name}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="ms-transition grid size-7 place-items-center rounded-[8px] text-ms-fg-3 hover:bg-ms-critical-soft hover:text-ms-critical-fg"
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}

/** The round tick on a pickable card or row: filled blue when chosen. */
export function PickTick({ on, small = false }: { on: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ms-transition grid shrink-0 place-items-center rounded-full border-[1.5px]",
        small ? "size-4" : "size-5",
        on ? "border-ms-primary bg-ms-primary text-white" : "border-ms-border-input bg-ms-card text-transparent",
      )}
    >
      <Icon name="check" size="sm" className={small ? "size-2.5" : "size-3"} />
    </span>
  );
}
