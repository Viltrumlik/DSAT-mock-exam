"use client";

import { cn } from "@/lib/cn";

/**
 * The minted token students earn. A rendered object rather than a line icon, so it is
 * deliberately never given a tinted chip to sit in — it carries its own material.
 *
 * Sizes are capped at the 288px source: the coin's milled edge and the recessed shield
 * turn to mush when upscaled, and there is no vector fallback for a photographic render.
 */
const SIZES = {
  sm: "h-5 w-5",      // inline, beside a number
  md: "h-10 w-10",    // stat card
  lg: "h-16 w-16",    // page header
  xl: "h-24 w-24",    // hero
} as const;

export type PointCoinSize = keyof typeof SIZES;

export function PointCoin({
  size = "md",
  className,
  /** Set when the coin sits next to the word "points" already — avoids a doubled label. */
  decorative = true,
}: {
  size?: PointCoinSize;
  className?: string;
  decorative?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/point-coin.png"
      alt={decorative ? "" : "Point"}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={cn(
        SIZES[size],
        "shrink-0 select-none object-contain",
        // The render is lit for a dark backdrop; on a light page it needs a shadow of its
        // own or it reads as a flat sticker.
        "drop-shadow-[0_1px_2px_rgba(15,23,42,0.28)] dark:drop-shadow-none",
        className,
      )}
    />
  );
}

export default PointCoin;
