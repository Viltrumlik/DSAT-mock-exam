"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ms-primary text-white hover:bg-ms-primary-hover",
  secondary: "bg-ms-surface-2 text-ms-fg hover:bg-ms-surface-3",
  ghost: "bg-transparent text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg",
  subtle: "bg-ms-primary-soft text-ms-primary-text hover:bg-ms-primary-soft-2",
  danger: "bg-ms-danger-btn text-white hover:bg-ms-danger-btn-hover",
};
// One size class per shape: `cn` does not merge conflicting utilities, so a padded button and an
// icon-only square never share a class list.
const SIZE: Record<ButtonSize, { text: string; square: string }> = {
  sm: { text: "h-9 gap-1.5 px-3 text-[14px]", square: "size-9 text-[14px]" },
  md: { text: "h-(--ms-h-ctl) gap-2 px-[18px] text-[15px]", square: "size-(--ms-h-ctl) text-[15px]" },
};

/**
 * The console's buttons (design handoff v0.3, Controls board): primary (one per screen), secondary,
 * ghost, subtle, danger; 44 px, or 36 px for `sm`. The same classes dress a link that acts as a
 * button. Disabled is grey whatever the variant, and every button gives under the finger.
 */
export function buttonClass({
  variant = "secondary",
  size = "md",
  square = false,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; square?: boolean; className?: string } = {}): string {
  return cn(
    "ms-press inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ms-btn font-semibold leading-none",
    "disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
    "aria-disabled:cursor-not-allowed aria-disabled:bg-ms-surface-2 aria-disabled:text-ms-fg-disabled",
    VARIANT[variant],
    square ? SIZE[size].square : SIZE[size].text,
    className,
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children?: ReactNode;
};

/** A button; with an icon and no words it is square and must carry an `aria-label`. */
export function Button({ variant, size = "md", icon, children, className, type = "button", ...rest }: ButtonProps) {
  const square = children === undefined || children === null || children === false;
  return (
    <button type={type} className={buttonClass({ variant, size, square, className })} {...rest}>
      {icon ? <Icon name={icon} size={size === "sm" ? "sm" : "md"} /> : null}
      {children}
    </button>
  );
}
