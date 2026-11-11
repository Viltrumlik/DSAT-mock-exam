"use client";

import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { Icon, type IconName } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { Tooltip } from "./Tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "subtle" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant | "done", string> = {
  primary: "bg-ms-primary text-white hover:bg-ms-primary-hover",
  secondary: "bg-ms-surface-2 text-ms-fg hover:bg-ms-surface-3",
  ghost: "bg-transparent text-ms-fg-2 hover:bg-ms-surface-2 hover:text-ms-fg",
  subtle: "bg-ms-primary-soft text-ms-primary-text hover:bg-ms-primary-soft-2",
  danger: "bg-ms-danger-btn text-white hover:bg-ms-danger-btn-hover",
  // "Button shows progress": blue → green once it is done (Motion board).
  done: "bg-ms-positive text-white",
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
}: { variant?: ButtonVariant | "done"; size?: ButtonSize; square?: boolean; className?: string } = {}): string {
  return cn(
    "ms-press inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ms-btn font-semibold leading-none",
    "disabled:cursor-not-allowed disabled:bg-ms-surface-2 disabled:text-ms-fg-disabled",
    "aria-disabled:cursor-not-allowed aria-disabled:bg-ms-surface-2 aria-disabled:text-ms-fg-disabled",
    VARIANT[variant],
    square ? SIZE[size].square : SIZE[size].text,
    className,
  );
}

/** The tick a finished button draws once (Motion board, "Done — check draws"). */
function DrawnCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path className="animate-ms-check-draw" d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type ButtonState = "idle" | "busy" | "done";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  /**
   * "Button shows progress" (Motion board): what it will do, that it is doing it ("Freezing…", a
   * spinner), that it is done (green, the tick drawn). Busy and done ignore clicks without turning grey.
   */
  state?: ButtonState;
  busyLabel?: ReactNode;
  doneLabel?: ReactNode;
  /** A square icon button's key, shown in its tooltip. */
  shortcut?: string;
  /** Square icon buttons with a name get a tooltip naming them; `false` leaves it out, a side moves it. */
  tooltip?: boolean | "top" | "bottom" | "right";
};

/** A button; with an icon and no words it is square, must carry an `aria-label`, and shows it as a tooltip. */
export function Button({
  variant,
  size = "md",
  icon,
  children,
  className,
  type = "button",
  state = "idle",
  busyLabel,
  doneLabel,
  shortcut,
  tooltip = true,
  onClick,
  ...rest
}: ButtonProps) {
  const square = children === undefined || children === null || children === false;
  const iconSize = size === "sm" ? "sm" : "md";
  const lead =
    state === "busy" ? (
      <Icon name="loader" size={iconSize} className="animate-ms-spin" />
    ) : state === "done" ? (
      <DrawnCheck />
    ) : icon ? (
      <Icon name={icon} size={iconSize} />
    ) : null;
  const words = state === "busy" ? (busyLabel ?? children) : state === "done" ? (doneLabel ?? children) : children;

  const button = (
    <button
      type={type}
      aria-busy={state === "busy" || undefined}
      className={buttonClass({ variant: state === "done" ? "done" : variant, size, square, className })}
      onClick={state === "idle" ? onClick : undefined}
      {...rest}
    >
      {state === "idle" ? (
        <>
          {lead}
          {words}
        </>
      ) : (
        // The label crossfades: the new words come in as the state changes.
        <span key={state} className={cn("animate-ms-fade-in inline-flex items-center", size === "sm" ? "gap-1.5" : "gap-2")}>
          {lead}
          {words}
        </span>
      )}
    </button>
  );
  const name = rest["aria-label"];
  return square && name && tooltip ? (
    <Tooltip label={name} shortcut={shortcut} side={typeof tooltip === "string" ? tooltip : "top"}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}
