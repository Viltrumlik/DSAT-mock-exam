"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ElementType;
  iconRight?: React.ElementType;
  block?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap " +
  "transition-colors duration-150 select-none focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] " +
  "disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-[var(--primary-hover)] shadow-sm",
  secondary:
    "bg-card text-foreground border border-border hover:bg-surface-2 shadow-sm",
  ghost: "bg-transparent text-foreground hover:bg-surface-2",
  danger: "bg-rose-600 text-white hover:bg-rose-500 shadow-sm",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

const iconSize: Record<Size, string> = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" };

/**
 * The same look, for something that navigates rather than acts.
 *
 * Wrapping this Button in a `<Link>` produces `<a><button></a>`: two tab stops and two
 * announced roles for one destination. Use this instead — it renders a single anchor.
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  block,
  className,
}: { variant?: Variant; size?: Size; block?: boolean; className?: string } = {}) {
  return cn(base, variants[variant], sizes[size], block && "w-full", className);
}

/** Premium, minimal button. One accent, calm states. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, iconRight: IconRight, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(base, variants[variant], sizes[size], block && "w-full", className)}
      {...rest}
    >
      {loading ? (
        <Loader2 className={cn(iconSize[size], "animate-spin")} aria-hidden />
      ) : (
        Icon && <Icon className={iconSize[size]} aria-hidden />
      )}
      {children}
      {!loading && IconRight && <IconRight className={iconSize[size]} aria-hidden />}
    </button>
  );
});
