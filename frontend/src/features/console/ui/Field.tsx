"use client";

import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Text fields (design handoff v0.3, Controls board): the label above, help below, and an error that says
 * how to fix it ("Enter 9 digits after +998 — 2 are missing."), never just "Invalid". A disabled field
 * says why in its help ("Set by lc-up. Change it there."). The control inside takes its id, its
 * `aria-describedby` and `aria-invalid` from the field, so the words are read with it.
 */
type FieldContext = { id: string; describedBy?: string; invalid: boolean };
const Ctx = createContext<FieldContext | null>(null);

/** The id and descriptions the control inside a Field must carry (or its own, outside one). */
export function useFieldControl(own?: string): FieldContext {
  const ctx = useContext(Ctx);
  const fallback = useId();
  return ctx ?? { id: own ?? fallback, invalid: false };
}

export function Field({
  label,
  optional = false,
  help,
  error,
  counter,
  className,
  children,
}: {
  label: ReactNode;
  optional?: boolean;
  /** Below the control: what to type, or why it can't be changed. */
  help?: ReactNode;
  /** Replaces the help while set; say how to fix it. */
  error?: string | null;
  /** Right of the help: "118 / 160 · 1 SMS each". */
  counter?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const below = `${id}-below`;
  const hasBelow = Boolean(error || help);
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[14px] font-medium leading-5 text-ms-fg">
        {label}
        {optional ? <span className="font-normal text-ms-fg-3"> (optional)</span> : null}
      </label>
      <Ctx.Provider value={{ id, describedBy: hasBelow ? below : undefined, invalid: Boolean(error) }}>{children}</Ctx.Provider>
      {hasBelow || counter ? (
        <div className="flex items-start justify-between gap-3 text-[13px] leading-[18px]">
          {error ? (
            <p id={below} className="animate-ms-fade-in flex items-start gap-1.5 font-medium text-ms-critical-fg">
              <Icon name="alert" size="sm" className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : help ? (
            <p id={below} className="text-ms-fg-3">{help}</p>
          ) : (
            <span />
          )}
          {counter ? <span className="shrink-0 tabular-nums text-ms-fg-3">{counter}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The input's box: 44 px (36 compact), focus ring, red edge on error, quieter when read-only or off. */
export function inputShell({
  invalid = false,
  disabled = false,
  readOnly = false,
  area = false,
  pill = false,
  className,
}: { invalid?: boolean; disabled?: boolean; readOnly?: boolean; area?: boolean; pill?: boolean; className?: string } = {}) {
  return cn(
    "ms-transition flex min-w-0 items-center gap-2 border text-[15px] text-ms-fg",
    pill ? "rounded-full px-4" : "rounded-ms-ctl px-3",
    area ? "min-h-24 items-start py-2.5 leading-normal" : "h-[var(--ms-h-ctl)]",
    disabled
      ? "cursor-not-allowed border-ms-border bg-ms-surface-2 text-ms-fg-disabled"
      : readOnly
        ? "border-ms-border bg-ms-surface"
        : invalid
          ? "border-ms-critical bg-ms-card focus-within:shadow-[0_0_0_3px_var(--ms-critical-soft)]"
          : "border-ms-border-input bg-ms-card focus-within:border-ms-primary focus-within:shadow-[0_0_0_3px_var(--ms-primary-soft-2)]",
    className,
  );
}

const BARE = "min-w-0 flex-1 bg-transparent outline-none placeholder:text-ms-fg-3 disabled:cursor-not-allowed";

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix" | "size"> & {
  /** Fixed text before the value: "+998". */
  prefix?: ReactNode;
  /** Fixed text after the value: "so'm". */
  suffix?: ReactNode;
  icon?: IconName;
  /** Monospaced and large: ticket codes the door scanner reads. */
  mono?: boolean;
  pill?: boolean;
  shellClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

export function TextInput({ prefix, suffix, icon, mono = false, pill = false, shellClassName, className, id, disabled, readOnly, ref, ...rest }: TextInputProps) {
  const f = useFieldControl(id);
  return (
    <div className={inputShell({ invalid: f.invalid, disabled, readOnly, pill, className: shellClassName })}>
      {icon ? <Icon name={icon} size="sm" className="shrink-0 text-ms-fg-3" /> : null}
      {prefix ? <span className="shrink-0 text-ms-fg-2 tabular-nums">{prefix}</span> : null}
      <input
        ref={ref}
        id={f.id}
        aria-invalid={f.invalid || undefined}
        aria-describedby={f.describedBy}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(BARE, mono && "font-ms-mono text-[17px] tracking-[.08em]", className)}
        {...rest}
      />
      {suffix ? <span className="shrink-0 text-ms-fg-3">{suffix}</span> : null}
    </div>
  );
}

export function TextArea({ className, id, disabled, readOnly, rows = 4, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const f = useFieldControl(id);
  return (
    <div className={inputShell({ invalid: f.invalid, disabled, readOnly, area: true })}>
      <textarea
        id={f.id}
        rows={rows}
        aria-invalid={f.invalid || undefined}
        aria-describedby={f.describedBy}
        disabled={disabled}
        readOnly={readOnly}
        className={cn(BARE, "w-full resize-y", className)}
        {...rest}
      />
    </div>
  );
}

/** "1250000" → "1 250 000" (the console's money grouping, as `formatSom`). */
export function groupDigits(digits: string): string {
  return digits.replace(/\D/g, "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Where the caret goes after regrouping: just after the same count of digits it followed before. */
export function caretAfterDigits(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) seen++;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}

/** Money: digits grouped as you type, "so'm" after them; the value is a whole number (or null when empty). */
export function MoneyInput({
  value,
  onChange,
  suffix = "so'm",
  ...rest
}: Omit<TextInputProps, "value" | "onChange" | "inputMode" | "type" | "ref"> & { value: number | null; onChange: (n: number | null) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const shown = value === null ? "" : groupDigits(String(Math.max(0, Math.round(value))));
  useLayoutEffect(() => {
    if (caret === null || !ref.current || document.activeElement !== ref.current) return;
    ref.current.setSelectionRange(caret, caret);
  }, [caret, shown]);
  return (
    <TextInput
      {...rest}
      ref={ref}
      inputMode="numeric"
      autoComplete="off"
      suffix={suffix}
      value={shown}
      className="tabular-nums"
      onChange={(e) => {
        const raw = e.target.value;
        const at = e.target.selectionStart ?? raw.length;
        const digits = raw.replace(/\D/g, "").slice(0, 15);
        const digitsBefore = Math.min(raw.slice(0, at).replace(/\D/g, "").replace(/^0+(?=\d)/, "").length, digits.length);
        setCaret(caretAfterDigits(groupDigits(digits), digitsBefore));
        onChange(digits ? Number(digits) : null);
      }}
    />
  );
}
