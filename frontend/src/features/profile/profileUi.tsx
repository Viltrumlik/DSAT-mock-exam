"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The profile's pieces of the house design: white quartz panels, squircle corners, and a colour
 * per thing — a tint of its own hue behind every icon, never the kit's grey.
 *
 * One palette for the three tabs, so a colour means the same thing wherever it shows up: primary
 * for the student's own figures, emerald for what is done, amber for strikes and what is due,
 * sky for classes, violet for what is coming, rose only for signing out.
 */

export type Tone = "primary" | "emerald" | "amber" | "sky" | "violet" | "rose";

export const TONE: Record<Tone, { tile: string; text: string; soft: string; well: string; edge: string }> = {
  primary: {
    tile: "bg-primary/12 text-primary dark:text-primary-hover",
    text: "text-primary dark:text-primary-hover",
    soft: "bg-primary/10 text-primary hover:bg-primary/15 dark:text-primary-hover",
    well: "bg-primary/[0.06]",
    edge: "from-primary via-primary/40 to-transparent",
  },
  emerald: {
    tile: "bg-success/15 text-success-foreground",
    text: "text-success-foreground",
    soft: "bg-success/15 text-success-foreground hover:bg-success/20",
    well: "bg-success/[0.08]",
    edge: "from-success via-success/40 to-transparent",
  },
  amber: {
    tile: "bg-warning/15 text-warning-foreground",
    text: "text-warning-foreground",
    soft: "bg-warning/15 text-warning-foreground hover:bg-warning/20",
    well: "bg-warning/[0.09]",
    edge: "from-warning via-warning/40 to-transparent",
  },
  sky: {
    tile: "bg-info/15 text-info-foreground",
    text: "text-info-foreground",
    soft: "bg-info/15 text-info-foreground hover:bg-info/20",
    well: "bg-info/[0.08]",
    edge: "from-info via-info/40 to-transparent",
  },
  // `--chart-6` has no `-soft` companion, so violet mixes its own tints.
  violet: {
    tile: "bg-[color-mix(in_oklab,var(--chart-6)_16%,transparent)] text-[var(--chart-6)]",
    text: "text-[var(--chart-6)]",
    soft: "bg-[color-mix(in_oklab,var(--chart-6)_14%,transparent)] text-[var(--chart-6)] hover:bg-[color-mix(in_oklab,var(--chart-6)_20%,transparent)]",
    well: "bg-[color-mix(in_oklab,var(--chart-6)_8%,transparent)]",
    edge: "from-[var(--chart-6)] via-[color-mix(in_oklab,var(--chart-6)_40%,transparent)] to-transparent",
  },
  rose: {
    tile: "bg-danger/12 text-danger",
    text: "text-danger",
    soft: "bg-danger/10 text-danger hover:bg-danger/15",
    well: "bg-danger/[0.06]",
    edge: "from-danger via-danger/40 to-transparent",
  },
};

const TILE_SIZE = {
  sm: { box: "h-9 w-9 [--sq:6px]", icon: "h-[18px] w-[18px]" },
  md: { box: "h-11 w-11 [--sq:7px]", icon: "h-5 w-5" },
  lg: { box: "h-14 w-14 [--sq:8.5px]", icon: "h-7 w-7" },
};

/** An icon on a tint of its own colour. */
export function IconTile({
  icon: Icon,
  tone,
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  size?: keyof typeof TILE_SIZE;
  className?: string;
}) {
  return (
    <span className={cn("squircle grid shrink-0 place-items-center", TILE_SIZE[size].box, TONE[tone].tile, className)}>
      <Icon className={TILE_SIZE[size].icon} aria-hidden />
    </span>
  );
}

/**
 * A white quartz panel. `cr-cardrise` rather than a float: most panels hold controls, and a
 * surface that lifts under the pointer promises a click it doesn't take.
 */
export function Panel({
  children,
  className,
  index = 0,
  as: Tag = "section",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  index?: number;
  as?: "section" | "div" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn("quartz squircle cr-cardrise relative p-5 [--sq:13px] sm:p-6", className)}
      style={{ animationDelay: `${index * 60}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A panel's heading: its icon, its name, one line of what it is for, and room for an action. */
export function PanelHeader({
  icon,
  tone,
  title,
  description,
  actions,
  as: Heading = "h3",
}: {
  icon: LucideIcon;
  tone: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      {/* `flex-1` with a basis: the words wrap inside their own block while there is room for the
          actions beside them, and the actions drop below only on a narrow panel. Without it a
          slightly longer label ("Change goal" for "Set a goal") pushed the button under the text. */}
      <div className="flex min-w-0 flex-1 basis-[15rem] items-center gap-3">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0">
          <Heading className="text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-foreground">{title}</Heading>
          {description ? <p className="mt-0.5 text-[13px] font-medium text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The pill buttons. `solid` is the one thing to press on a panel; `soft` a secondary action in a
 * colour; `quiet` a text action whose hover is a tint, not grey.
 */
export function pill(kind: "solid" | "soft" | "quiet", tone: Tone = "primary", size: "sm" | "md" = "md") {
  return cn(
    "ds-ring cr-press inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-[inherit] font-bold no-underline transition-colors",
    "disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-10 px-4 text-[13.5px]",
    kind === "solid"
      ? "bg-primary text-primary-foreground shadow-[0_6px_14px_-8px_var(--primary)] hover:bg-primary-hover"
      : kind === "soft"
        ? TONE[tone].soft
        : tone === "rose"
          ? "text-danger hover:bg-danger/[0.07]"
          : "text-muted-foreground hover:bg-primary/[0.06] hover:text-foreground",
  );
}

/** The eyebrow over a figure: small, spaced capitals in the figure's own colour or muted. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-muted-foreground", className)}>
      {children}
    </p>
  );
}
