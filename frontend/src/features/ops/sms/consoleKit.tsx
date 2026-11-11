"use client";

import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { Badge as ConsoleBadge, Button as ConsoleButton, Dialog, inputShell, type BadgeTone } from "@/features/console/ui";

/**
 * The SMS panel's controls in the console's look (design handoff v0.3, PR 13a), with the props the
 * panel already passed to the student app's kit — `Alert tone`, `Badge variant`, `Button loading`,
 * `Field label/htmlFor/hint`, `Select selectSize`, `Switch onCheckedChange`, `Modal footer` — so the
 * panels change their import and nothing else: the words, the ids and the behaviour stay.
 */

// ── notices ──────────────────────────────────────────────────────────────

export type AlertTone = "info" | "success" | "warning" | "danger" | "neutral";

const ALERT: Record<AlertTone, { box: string; icon: IconName }> = {
  info: { box: "border-ms-info-line bg-ms-info-soft text-ms-info-fg", icon: "info" },
  success: { box: "border-ms-positive-line bg-ms-positive-soft text-ms-positive-fg", icon: "ok" },
  warning: { box: "border-ms-attention-line bg-ms-attention-soft text-ms-attention-fg", icon: "warn" },
  danger: { box: "border-ms-critical-line bg-ms-critical-soft text-ms-critical-fg", icon: "alert" },
  neutral: { box: "border-ms-border bg-ms-surface text-ms-fg-2", icon: "info" },
};

/** A notice in its verdict's soft tone, the icon first; the words stay as the panel wrote them. */
export function Alert({ tone = "info", title, children, className }: { tone?: AlertTone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const look = ALERT[tone];
  return (
    <div role="status" className={cn("animate-ms-fade-in flex items-start gap-3 rounded-ms-ctl border px-4 py-3 text-[14px] leading-5", look.box, className)}>
      <Icon name={look.icon} size="sm" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : undefined)}>{children}</div> : null}
      </div>
    </div>
  );
}

// ── badges ───────────────────────────────────────────────────────────────

export type BadgeVariant = "brand" | "primary" | "neutral" | "outline" | "success" | "warning" | "danger" | "info" | "accent" | "live";

const TONE: Record<BadgeVariant, BadgeTone> = {
  brand: "info",
  primary: "info",
  neutral: "neutral",
  outline: "line",
  success: "positive",
  warning: "attention",
  danger: "critical",
  info: "info",
  accent: "info",
  live: "info",
};

/** The old variant names on the console badge; a verdict (success / warning / danger) leads with a dot. */
export function Badge({ variant = "neutral", children, className }: { variant?: BadgeVariant; children: ReactNode; className?: string }) {
  const tone = TONE[variant];
  return (
    <ConsoleBadge tone={tone} dot={tone === "positive" || tone === "attention" || tone === "critical"} className={className}>
      {children}
    </ConsoleBadge>
  );
}

// ── buttons ──────────────────────────────────────────────────────────────

type OldVariant = "primary" | "secondary" | "outline" | "ghost" | "subtle" | "danger";
const VARIANT: Record<OldVariant, "primary" | "secondary" | "ghost" | "subtle" | "danger"> = {
  primary: "primary",
  secondary: "secondary",
  outline: "secondary",
  ghost: "ghost",
  subtle: "subtle",
  danger: "danger",
};

/** The console button; `loading` is its busy state (a spinner, clicks ignored, the words kept). */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { variant?: OldVariant; size?: "sm" | "md" | "lg"; loading?: boolean; children?: ReactNode }) {
  return (
    <ConsoleButton variant={VARIANT[variant]} size={size === "sm" ? "sm" : "md"} state={loading ? "busy" : "idle"} {...rest}>
      {children}
    </ConsoleButton>
  );
}

// ── fields ───────────────────────────────────────────────────────────────

/** A label above, help or an error below (the console Field's shape), around a native control with its own id. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-[14px] font-medium leading-5 text-ms-fg">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-ms-critical-fg">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] font-medium leading-[18px] text-ms-critical-fg">
          <Icon name="alert" size="sm" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] leading-[18px] text-ms-fg-3">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL = "w-full outline-none placeholder:text-ms-fg-3";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; inputSize?: "sm" | "md" | "lg" }>(function Input(
  { invalid = false, inputSize: _size, className, disabled, ...rest },
  ref,
) {
  void _size;
  return <input ref={ref} disabled={disabled} aria-invalid={invalid || undefined} className={inputShell({ invalid, disabled, className: cn(CONTROL, className) })} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; selectSize?: "sm" | "md" | "lg" }>(function Select(
  { invalid = false, selectSize: _size, className, disabled, children, ...rest },
  ref,
) {
  void _size;
  return (
    <select ref={ref} disabled={disabled} aria-invalid={invalid || undefined} className={inputShell({ invalid, disabled, className: cn(CONTROL, className) })} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { invalid = false, className, disabled, ...rest },
  ref,
) {
  return <textarea ref={ref} disabled={disabled} aria-invalid={invalid || undefined} className={inputShell({ invalid, disabled, area: true, className: cn(CONTROL, "resize-y", className) })} {...rest} />;
});

// ── switch ───────────────────────────────────────────────────────────────

/** An on/off switch with its words beside it; `role="switch"` and `aria-checked` as before. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  ariaLabel,
  id,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
  id?: string;
  className?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label ?? ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "ms-transition relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        checked ? "bg-ms-primary" : "bg-ms-surface-3",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className={cn("ms-transition inline-block size-5 rounded-full bg-white shadow-ms-1", checked ? "translate-x-[22px]" : "translate-x-[2px]")} />
    </button>
  );
  if (!label) return control;
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-3 text-[15px] text-ms-fg">
      {control}
      <span>{label}</span>
    </label>
  );
}

// ── dialog ───────────────────────────────────────────────────────────────

/** The console Dialog shell with the old Modal's title, description and footer. */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Dialog open={open} onClose={onClose} labelledBy={id} width={520}>
      <div className="flex flex-col gap-4 overflow-y-auto px-[22px] pb-2 pt-[22px]">
        {title || description ? (
          <div className="flex flex-col gap-1">
            {title ? (
              <h2 id={id} className="text-[20px] font-bold leading-7 tracking-[-0.01em] text-ms-fg">
                {title}
              </h2>
            ) : null}
            {description ? <p className="text-[14px] text-ms-fg-2">{description}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
      {footer ? <div className="mt-3 flex items-center justify-end gap-2 border-t border-ms-border bg-ms-surface px-5 py-3.5">{footer}</div> : null}
    </Dialog>
  );
}
