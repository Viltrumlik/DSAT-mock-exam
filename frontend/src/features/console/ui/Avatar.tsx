"use client";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * Avatar (design handoff v0.3, Controls board · Small parts): initials from first + last name with the
 * Uzbek oʻ and gʻ kept whole, a colour picked from the name (never from status), a photo when there is
 * one, a snowflake flag for a frozen learner, a ring for "new" / "seen".
 */
export type AvatarSize = "sm" | "md" | "lg" | "xl";
export type AvatarTone = 1 | 2 | 3 | 4 | 5 | 6;

const SIZE: Record<AvatarSize, string> = {
  sm: "size-7 text-[12px]",
  md: "size-10 text-[15px]",
  lg: "size-16 text-[22px]",
  xl: "size-20 text-[26px]",
};
const FLAG: Record<AvatarSize, string> = { sm: "size-4 [&_svg]:size-2.5", md: "size-[22px] [&_svg]:size-3.5", lg: "size-7 [&_svg]:size-4", xl: "size-8 [&_svg]:size-[18px]" };
export const AVATAR_TONE: Record<AvatarTone, string> = {
  1: "bg-ms-av1-bg text-ms-av1-fg",
  2: "bg-ms-av2-bg text-ms-av2-fg",
  3: "bg-ms-av3-bg text-ms-av3-fg",
  4: "bg-ms-av4-bg text-ms-av4-fg",
  5: "bg-ms-av5-bg text-ms-av5-fg",
  6: "bg-ms-av6-bg text-ms-av6-fg",
};

/** The modifier letter turned comma (U+02BB) and the apostrophes people type in its place. */
const OKINA = /^[ʻʼ'‘’`]/;

/** A word's first letter; "Oʻtkir" → "Oʻ", "gʻani" → "Gʻ" (one Uzbek letter, two characters). */
function firstLetter(word: string): string {
  const head = word.charAt(0).toUpperCase();
  return (head === "O" || head === "G") && OKINA.test(word.slice(1)) ? `${head}ʻ` : head;
}

/** "Bekzod Jo'rayev" → "BJ"; "Oʻtkir Gʻaniyev" → "OʻGʻ"; "Kamola" → "K"; "" → "?". */
export function initialsOf(name: string | null | undefined): string {
  // Keep the okina-like marks inside words (they belong to oʻ / gʻ); everything else that is not a
  // letter or digit separates words.
  const words = (name ?? "").normalize("NFC").replace(/[^\p{L}\p{N}ʻʼ'‘’`]+/gu, " ").trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (!words.length) return "?";
  return words.length === 1 ? firstLetter(words[0]) : firstLetter(words[0]) + firstLetter(words[words.length - 1]);
}

/** One of six muted tones, steady for the same name (case and spacing do not change it). */
export function toneOf(key: string | number | null | undefined): AvatarTone {
  const s = String(key ?? "").trim().toLowerCase();
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 6) + 1) as AvatarTone;
}

export function Avatar({
  name,
  src,
  size = "md",
  tone,
  frozen = false,
  ring,
  className,
}: {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** Defaults to the name's own tone; pass the person's id-based tone where one exists. */
  tone?: AvatarTone;
  frozen?: boolean;
  /** "new": something unseen (primary ring); "seen": a quiet ring. */
  ring?: "new" | "seen";
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={frozen ? `${name} (frozen)` : name}
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none tracking-[.02em]",
        SIZE[size],
        AVATAR_TONE[tone ?? toneOf(name)],
        ring === "new" && "shadow-[0_0_0_2px_var(--ms-card),0_0_0_4.5px_var(--ms-primary)]",
        ring === "seen" && "shadow-[0_0_0_2px_var(--ms-card),0_0_0_3.5px_var(--ms-border-strong)]",
        className,
      )}
    >
      {src ? (
        // A photo replaces the initials; it is decoration over the labelled span.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span aria-hidden="true">{initialsOf(name)}</span>
      )}
      {frozen ? (
        <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-ms-frozen-soft text-ms-frozen-fg shadow-[0_0_0_2px_var(--ms-card)]", FLAG[size])}>
          <Icon name="ms-freeze" size="sm" />
        </span>
      ) : null}
    </span>
  );
}

/** Overlapping avatars with "+N" for the rest ("who is in this group"). */
export function AvatarStack({ names, max = 4, size = "sm" }: { names: string[]; max?: number; size?: AvatarSize }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="inline-flex items-center" aria-label={`${names.length} ${names.length === 1 ? "person" : "people"}: ${names.join(", ")}`} role="group">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={size} className={cn("shadow-[0_0_0_2px_var(--ms-card)]", i > 0 && "-ml-1")} />
      ))}
      {rest > 0 ? (
        <span aria-hidden="true" className={cn("-ml-1 inline-grid shrink-0 place-items-center rounded-full bg-ms-surface-2 font-semibold text-ms-fg-2 shadow-[0_0_0_2px_var(--ms-card)]", SIZE[size])}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
