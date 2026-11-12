"use client";

import { useId, type ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Button, Checkbox, Dialog, type BadgeTone } from "@/features/console/ui";
import { FIELD_LABEL, HINT } from "@/features/questionsAdmin/questionLook";
import { cn } from "@/lib/cn";
import type { SurveyStatus } from "./surveysApi";

/**
 * The console's look (design handoff v0.3) for the survey builder at /ops/surveys: a field with its words, a
 * notice in its verdict's tone, a ticked row, the dialog frame. Only the builder's own files use these — the
 * student's survey form keeps the student app's look. The words are the pages' own; these only draw them.
 */

/** A card on the page. */
export const BOX = "rounded-ms-card bg-ms-card shadow-ms-1";
/** A quieter panel inside a card: the create box, the survey's settings, the follow-up box. */
export const INSET = "rounded-ms-card border border-ms-border bg-ms-surface";

/** The survey's state as a verdict: Draft plain, Published green, Closed amber. */
export const STATUS_TONE: Record<SurveyStatus, BadgeTone> = {
  DRAFT: "neutral",
  PUBLISHED: "positive",
  CLOSED: "attention",
};

/** A field: its words above (with the required star), the control, the help under it. */
export function Field({
  label,
  htmlFor,
  hint,
  required = false,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const words = (
    <>
      {label}
      {required ? <span className="ml-0.5 text-ms-critical-fg">*</span> : null}
    </>
  );
  return (
    <div className={cn("min-w-0", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={FIELD_LABEL}>
          {words}
        </label>
      ) : (
        <p className={FIELD_LABEL}>{words}</p>
      )}
      {children}
      {hint ? <p className={HINT}>{hint}</p> : null}
    </div>
  );
}

type NoticeTone = "info" | "success" | "warning" | "danger";
const NOTICE: Record<NoticeTone, { box: string; icon: IconName }> = {
  info: { box: "border-ms-info-line bg-ms-info-soft text-ms-info-fg", icon: "info" },
  success: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
  warning: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  danger: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
};

/** A notice in its verdict's soft tone: the icon, a bold first line, then the rest. */
export function Notice({ tone, title, children }: { tone: NoticeTone; title?: ReactNode; children?: ReactNode }) {
  const look = NOTICE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("animate-ms-fade-in flex items-start gap-2.5 rounded-ms-ctl border px-3.5 py-2.5 text-[14px] leading-5", look.box)}
    >
      <Icon name={look.icon} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
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
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex min-h-9 items-center gap-2.5 text-[14px] leading-5", disabled ? "cursor-not-allowed text-ms-fg-disabled" : "cursor-pointer text-ms-fg")}>
      <Checkbox label={label} checked={checked} onChange={() => onChange(!checked)} disabled={disabled} />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

/** Rows that are still loading. */
export function Shimmer({ rows, className }: { rows: number; className: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={cn("animate-ms-shimmer rounded-ms-ctl bg-ms-surface-2", className)} />
      ))}
    </div>
  );
}

/** The console dialog with a title, the line under it, a body and a footer of buttons. */
export function SurveyDialog({
  open,
  title,
  description,
  onClose,
  locked = false,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  locked?: boolean;
  footer: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={id} locked={locked}>
      <div className="flex flex-col gap-3 overflow-y-auto px-[22px] pb-2 pt-[22px]">
        <div className="flex items-start gap-3">
          <h2 id={id} className="min-w-0 flex-1 text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
            {title}
          </h2>
          <Button variant="ghost" size="sm" icon="x" aria-label="Close" tooltip={false} onClick={onClose} className="-mr-1.5 -mt-0.5" />
        </div>
        {description ? <p className="text-[15px] leading-[23px] text-ms-fg-2">{description}</p> : null}
        {children}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">{footer}</div>
    </Dialog>
  );
}
