"use client";

import { cn } from "@/lib/cn";

/**
 * The school's two minted objects.
 *
 *   point — the silver token. A score: earned, corrected, reset each season.
 *   coin  — the blue coin. A currency: minted from points, and once spent it is gone.
 *
 * Two distinct objects rather than one in two metals, because the things they stand for
 * behave differently — a student can lose points to a corrected register but never loses a
 * coin they have already been given.
 *
 * These are rendered objects, not line icons: they carry their own material and lighting, so
 * they are never given a tinted chip to sit in (that treatment is what makes a flat stroke
 * icon legible, and it makes a render look like a sticker).
 */
const ART = {
  point: { src: "/images/point-coin.png", alt: "Point" },
  coin: { src: "/images/reward-coin.png", alt: "Coin" },
} as const;

const SIZES = {
  sm: "h-5 w-5",      // inline, beside a number
  md: "h-10 w-10",    // stat card
  lg: "h-16 w-16",    // section heading
  xl: "h-24 w-24",    // hero / empty state
} as const;

type Common = { className?: string; decorative?: boolean };

/**
 * `sm` is deliberately unavailable for the coin. Its face is near-black with a thin blue
 * rim, so at 20px on a dark background it collapses into an unreadable dot — the silver
 * token survives that size, the coin does not.
 */
export type RewardCoinProps = Common &
  ({ kind?: "point"; size?: keyof typeof SIZES } | { kind: "coin"; size?: "md" | "lg" | "xl" });

export function RewardCoin({
  kind = "point",
  size = "md",
  className,
  /** Leave true when the coin sits beside its own label — avoids reading it out twice. */
  decorative = true,
}: RewardCoinProps) {
  const art = ART[kind];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={art.src}
      alt={decorative ? "" : art.alt}
      aria-hidden={decorative || undefined}
      draggable={false}
      className={cn(
        SIZES[size],
        "shrink-0 select-none object-contain",
        // Both are lit for a dark backdrop; on a light page they need a shadow of their own
        // or they read as flat stickers.
        "drop-shadow-[0_1px_2px_rgba(15,23,42,0.28)] dark:drop-shadow-none",
        className,
      )}
    />
  );
}

export default RewardCoin;
