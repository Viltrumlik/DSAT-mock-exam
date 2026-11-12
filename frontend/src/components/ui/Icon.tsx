import { CONSOLE_ICONS, HEAVY_STROKE, type IconName } from "./icons/consoleIcons";

export type { IconName };

/** 16 in tables and badges, 18 in buttons and menus, 20 in tiles, 24 in empty states and phone tabs. */
export type IconSize = "sm" | "md" | "lg" | "xl";

const PX: Record<IconSize, number> = { sm: 16, md: 18, lg: 20, xl: 24 };

/** All 111 names, in the design's order (generic first, then the 30 `ms-*`). */
export const ICON_NAMES = Object.keys(CONSOLE_ICONS) as IconName[];

export type IconProps = {
  name: IconName;
  size?: IconSize;
  /** Names the icon for a screen reader. Leave it out when a word next to it already says it. */
  label?: string;
  className?: string;
};

/**
 * One icon from the console redesign, by its design name: the board's
 * `<span class="i i-lg i-ms-freeze">` is `<Icon name="ms-freeze" size="lg" />`.
 *
 * Always `currentColor` — an icon is tinted only as part of a verdict, and then next to a word.
 * Decorative (hidden from screen readers) unless it has a `label`.
 */
export function Icon({ name, size = "md", label, className }: IconProps) {
  const Glyph = CONSOLE_ICONS[name];
  return (
    <Glyph
      size={PX[size]}
      strokeWidth={HEAVY_STROKE.has(name) ? 2.4 : 2}
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      {...(label ? { role: "img", "aria-label": label } : {})}
    />
  );
}
