"use client";

/**
 * The avatar art: twelve original characters, drawn here as SVG from their keys.
 *
 * The server owns the catalog — which keys exist, what they cost, who owns what
 * (`backend/livequiz/avatars.py`). This file only draws. Every character is the same small
 * body with its own features on top, so a skin is a palette rather than a second drawing:
 *
 *   default   the character's own colours
 *   rare      "Sunset" — a second palette, chosen per character
 *   epic      "Galaxy" — a deep-space gradient with stars
 *   legendary "Golden" — a gold gradient with sparkles
 */

import { useId } from "react";

import { cn } from "@/lib/cn";

import type { AvatarSkin, AvatarWire } from "./api";
import { initials, tileColor } from "./theme";

interface Palette {
  body: string;
  belly: string;
  accent: string;
}

const INK = "#1f1d2e";

const CHARACTERS: Record<string, { name: string; base: Palette; sunset: Palette }> = {
  owl: { name: "Hoot", base: { body: "#8b5e3c", belly: "#ecd6b6", accent: "#f59e0b" }, sunset: { body: "#c2410c", belly: "#fed7aa", accent: "#7c3aed" } },
  cat: { name: "Mochi", base: { body: "#f4a261", belly: "#fde8d0", accent: "#e76f51" }, sunset: { body: "#64748b", belly: "#e2e8f0", accent: "#f472b6" } },
  robot: { name: "Bolt", base: { body: "#94a3b8", belly: "#e2e8f0", accent: "#22d3ee" }, sunset: { body: "#f59e0b", belly: "#fef3c7", accent: "#ef4444" } },
  fox: { name: "Ember", base: { body: "#f97316", belly: "#fff7ed", accent: "#7c2d12" }, sunset: { body: "#e5e7eb", belly: "#ffffff", accent: "#64748b" } },
  panda: { name: "Bao", base: { body: "#f8fafc", belly: "#ffffff", accent: "#1f2937" }, sunset: { body: "#fda4af", belly: "#fff1f2", accent: "#9f1239" } },
  frog: { name: "Lily", base: { body: "#4ade80", belly: "#dcfce7", accent: "#15803d" }, sunset: { body: "#38bdf8", belly: "#e0f2fe", accent: "#0369a1" } },
  penguin: { name: "Pebble", base: { body: "#1e293b", belly: "#f8fafc", accent: "#f59e0b" }, sunset: { body: "#7c3aed", belly: "#f5f3ff", accent: "#f472b6" } },
  dino: { name: "Rex", base: { body: "#34d399", belly: "#d1fae5", accent: "#f59e0b" }, sunset: { body: "#f472b6", belly: "#fce7f3", accent: "#7c3aed" } },
  bunny: { name: "Clover", base: { body: "#e5e7eb", belly: "#ffffff", accent: "#f9a8d4" }, sunset: { body: "#a16207", belly: "#fef3c7", accent: "#f9a8d4" } },
  dragon: { name: "Blaze", base: { body: "#ef4444", belly: "#fde68a", accent: "#7f1d1d" }, sunset: { body: "#0ea5e9", belly: "#bae6fd", accent: "#1e3a8a" } },
  unicorn: { name: "Nova", base: { body: "#f5f3ff", belly: "#ffffff", accent: "#fbbf24" }, sunset: { body: "#fce7f3", belly: "#ffffff", accent: "#a78bfa" } },
  alien: { name: "Zip", base: { body: "#a3e635", belly: "#ecfccb", accent: "#65a30d" }, sunset: { body: "#f472b6", belly: "#fce7f3", accent: "#be185d" } },
};

export const AVATAR_CHARACTERS = Object.keys(CHARACTERS);

const SKIN_TITLES: Record<AvatarSkin, string> = { rare: "Sunset", epic: "Galaxy", legendary: "Golden" };

export function avatarName(character: string, skin: AvatarSkin | null): string {
  const base = CHARACTERS[character]?.name ?? "Avatar";
  return skin ? `${SKIN_TITLES[skin]} ${base}` : base;
}

/** Eyes sit here unless a character moves them (the frog wears them on top). */
const EYES = { left: [39, 55], right: [61, 55] } as const;

function Eyes({ left = EYES.left, right = EYES.right, r = 8 }: { left?: readonly number[]; right?: readonly number[]; r?: number }) {
  return (
    <g>
      {[left, right].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r} fill="#fff" />
          <circle cx={x + 1} cy={y + 1} r={r * 0.5} fill={INK} />
          <circle cx={x + 2.5} cy={y - 1.5} r={r * 0.18} fill="#fff" />
        </g>
      ))}
    </g>
  );
}

// `p` is accepted so every feature can hand its palette through the same shape; the face
// itself is drawn in ink and blush, the same on every skin.
function Face({ smile = "M45 67 Q50 71 55 67", cheeks = true }: { p?: Palette; smile?: string; cheeks?: boolean }) {
  return (
    <g>
      {cheeks && (
        <>
          <circle cx="30" cy="66" r="4" fill="#fb7185" opacity="0.35" />
          <circle cx="70" cy="66" r="4" fill="#fb7185" opacity="0.35" />
        </>
      )}
      <path d={smile} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}

/** Per-character drawing: what goes behind the body, the body's shape, and what goes on top. */
const FEATURES: Record<string, { behind?: (p: Palette) => React.ReactNode; box?: boolean; front: (p: Palette) => React.ReactNode }> = {
  owl: {
    behind: (p) => (
      <>
        <polygon points="24,44 28,22 42,36" fill={p.body} />
        <polygon points="76,44 72,22 58,36" fill={p.body} />
      </>
    ),
    front: (p) => (
      <>
        <ellipse cx="22" cy="66" rx="6" ry="13" fill={p.accent} opacity="0.85" />
        <ellipse cx="78" cy="66" rx="6" ry="13" fill={p.accent} opacity="0.85" />
        <Eyes r={9} />
        <polygon points="46,62 54,62 50,69" fill={p.accent} />
      </>
    ),
  },
  cat: {
    behind: (p) => (
      <>
        <polygon points="24,46 28,18 46,34" fill={p.body} />
        <polygon points="76,46 72,18 54,34" fill={p.body} />
        <polygon points="29,40 31,25 40,34" fill="#f9a8d4" />
        <polygon points="71,40 69,25 60,34" fill="#f9a8d4" />
      </>
    ),
    front: (p) => (
      <>
        <Eyes />
        <polygon points="47.5,62 52.5,62 50,65" fill="#f472b6" />
        <g stroke={INK} strokeWidth="1.2" strokeLinecap="round" opacity="0.6">
          <line x1="20" y1="63" x2="34" y2="65" />
          <line x1="20" y1="69" x2="34" y2="68" />
          <line x1="80" y1="63" x2="66" y2="65" />
          <line x1="80" y1="69" x2="66" y2="68" />
        </g>
        <Face p={p} />
      </>
    ),
  },
  robot: {
    box: true,
    behind: (p) => (
      <>
        <line x1="50" y1="32" x2="50" y2="17" stroke={INK} strokeWidth="2.5" />
        <circle cx="50" cy="15" r="5" fill={p.accent} />
        <circle cx="20" cy="58" r="5" fill={p.accent} />
        <circle cx="80" cy="58" r="5" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <rect x="30" y="45" width="40" height="17" rx="8.5" fill={INK} />
        <circle cx="41" cy="53.5" r="4" fill={p.accent} />
        <circle cx="59" cy="53.5" r="4" fill={p.accent} />
        <rect x="40" y="70" width="20" height="5" rx="2.5" fill={INK} opacity="0.75" />
      </>
    ),
  },
  fox: {
    behind: (p) => (
      <>
        <polygon points="22,48 25,14 46,34" fill={p.body} />
        <polygon points="78,48 75,14 54,34" fill={p.body} />
        <polygon points="25,24 25,14 33,22" fill={p.accent} />
        <polygon points="75,24 75,14 67,22" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <ellipse cx="41" cy="67" rx="10" ry="8" fill={p.belly} />
        <ellipse cx="59" cy="67" rx="10" ry="8" fill={p.belly} />
        <Eyes />
        <circle cx="50" cy="63" r="3.2" fill={INK} />
        <Face p={p} cheeks={false} smile="M46 69 Q50 72 54 69" />
      </>
    ),
  },
  panda: {
    behind: (p) => (
      <>
        <circle cx="27" cy="36" r="9" fill={p.accent} />
        <circle cx="73" cy="36" r="9" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <ellipse cx="39" cy="56" rx="10" ry="8" fill={p.accent} transform="rotate(-20 39 56)" />
        <ellipse cx="61" cy="56" rx="10" ry="8" fill={p.accent} transform="rotate(20 61 56)" />
        <Eyes r={6} />
        <ellipse cx="50" cy="64" rx="3.5" ry="2.5" fill={INK} />
        <Face p={p} cheeks={false} />
      </>
    ),
  },
  frog: {
    behind: (p) => (
      <>
        <circle cx="36" cy="38" r="12" fill={p.body} />
        <circle cx="64" cy="38" r="12" fill={p.body} />
      </>
    ),
    front: (p) => (
      <>
        <Eyes left={[36, 38]} right={[64, 38]} r={8} />
        <path d="M33 64 Q50 76 67 64" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="30" cy="66" r="4" fill="#fb7185" opacity="0.35" />
        <circle cx="70" cy="66" r="4" fill="#fb7185" opacity="0.35" />
        <circle cx="44" cy="80" r="2" fill={p.accent} opacity="0.5" />
        <circle cx="58" cy="82" r="2.5" fill={p.accent} opacity="0.5" />
      </>
    ),
  },
  penguin: {
    behind: (p) => (
      <>
        <ellipse cx="20" cy="68" rx="6" ry="15" fill={p.body} transform="rotate(15 20 68)" />
        <ellipse cx="80" cy="68" rx="6" ry="15" fill={p.body} transform="rotate(-15 80 68)" />
      </>
    ),
    front: (p) => (
      <>
        <ellipse cx="50" cy="64" rx="21" ry="24" fill={p.belly} />
        <Eyes />
        <polygon points="45,63 55,63 50,70" fill={p.accent} />
        <ellipse cx="40" cy="89" rx="7" ry="3" fill={p.accent} />
        <ellipse cx="60" cy="89" rx="7" ry="3" fill={p.accent} />
      </>
    ),
  },
  dino: {
    behind: (p) => (
      <>
        <polygon points="36,36 41,22 46,33" fill={p.accent} />
        <polygon points="45,32 50,18 55,32" fill={p.accent} />
        <polygon points="54,33 59,22 64,36" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <Eyes />
        <circle cx="45" cy="64" r="1.4" fill={INK} />
        <circle cx="55" cy="64" r="1.4" fill={INK} />
        <Face p={p} smile="M42 69 Q50 75 58 69" />
        <ellipse cx="30" cy="76" rx="5" ry="3.5" fill={p.body} stroke={INK} strokeOpacity="0.15" />
        <ellipse cx="70" cy="76" rx="5" ry="3.5" fill={p.body} stroke={INK} strokeOpacity="0.15" />
      </>
    ),
  },
  bunny: {
    behind: (p) => (
      <>
        <ellipse cx="38" cy="22" rx="7" ry="20" fill={p.body} />
        <ellipse cx="62" cy="22" rx="7" ry="20" fill={p.body} />
        <ellipse cx="38" cy="24" rx="3.5" ry="14" fill={p.accent} />
        <ellipse cx="62" cy="24" rx="3.5" ry="14" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <Eyes />
        <ellipse cx="50" cy="63" rx="3" ry="2.2" fill={p.accent} />
        <rect x="47" y="68" width="6" height="5" rx="1.2" fill="#fff" stroke={INK} strokeWidth="0.8" />
        <Face p={p} smile="M44 66 Q50 69 56 66" />
      </>
    ),
  },
  dragon: {
    behind: (p) => (
      <>
        <path d="M24 56 L6 40 L12 62 L4 66 L22 72 Z" fill={p.accent} />
        <path d="M76 56 L94 40 L88 62 L96 66 L78 72 Z" fill={p.accent} />
        <polygon points="32,38 26,18 42,32" fill={p.accent} />
        <polygon points="68,38 74,18 58,32" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <Eyes />
        <g stroke={p.accent} strokeWidth="1.4" opacity="0.5" fill="none">
          <path d="M40 72 Q50 76 60 72" />
          <path d="M42 78 Q50 81 58 78" />
        </g>
        <circle cx="46" cy="64" r="1.4" fill={INK} />
        <circle cx="54" cy="64" r="1.4" fill={INK} />
        <Face p={p} cheeks={false} smile="M44 68 Q50 71 56 68" />
      </>
    ),
  },
  unicorn: {
    behind: () => (
      <>
        <circle cx="30" cy="40" r="8" fill="#f9a8d4" />
        <circle cx="24" cy="50" r="7" fill="#c4b5fd" />
        <circle cx="22" cy="61" r="6" fill="#93c5fd" />
        <circle cx="40" cy="33" r="7" fill="#fbcfe8" />
      </>
    ),
    front: (p) => (
      <>
        <polygon points="45,33 50,9 55,33" fill={p.accent} />
        <g stroke="#fff" strokeWidth="1.2" opacity="0.8">
          <line x1="47" y1="26" x2="53" y2="23" />
          <line x1="48" y1="19" x2="52" y2="17" />
        </g>
        <Eyes />
        <Face p={p} />
      </>
    ),
  },
  alien: {
    behind: (p) => (
      <>
        <line x1="40" y1="34" x2="32" y2="16" stroke={p.accent} strokeWidth="2.5" />
        <line x1="60" y1="34" x2="68" y2="16" stroke={p.accent} strokeWidth="2.5" />
        <circle cx="32" cy="15" r="4.5" fill={p.accent} />
        <circle cx="68" cy="15" r="4.5" fill={p.accent} />
      </>
    ),
    front: (p) => (
      <>
        <ellipse cx="39" cy="55" rx="9" ry="11" fill={INK} />
        <ellipse cx="61" cy="55" rx="9" ry="11" fill={INK} />
        <circle cx="42" cy="51" r="3" fill="#fff" />
        <circle cx="64" cy="51" r="3" fill="#fff" />
        <Face p={p} smile="M46 70 Q50 72 54 70" />
      </>
    ),
  },
};

function paletteFor(character: string, skin: AvatarSkin | null, ids: { galaxy: string; gold: string }): Palette {
  const art = CHARACTERS[character];
  if (skin === "rare") return art.sunset;
  if (skin === "epic") return { body: `url(#${ids.galaxy})`, belly: "#c4b5fd", accent: "#f0abfc" };
  if (skin === "legendary") return { body: `url(#${ids.gold})`, belly: "#fef3c7", accent: "#b45309" };
  return art.base;
}

/** One character in one look. Unknown keys draw nothing — callers fall back to initials. */
export function LiveAvatar({
  character,
  skin = null,
  size = 48,
  className,
}: {
  character: string;
  skin?: AvatarSkin | null;
  size?: number;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const ids = { galaxy: `lqg-${uid}`, gold: `lqy-${uid}` };
  const features = FEATURES[character];
  if (!features || !CHARACTERS[character]) return null;
  const p = paletteFor(character, skin, ids);
  const name = avatarName(character, skin);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={ids.galaxy} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d28d9" />
          <stop offset="0.55" stopColor="#312e81" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
        <linearGradient id={ids.gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fef08a" />
          <stop offset="0.5" stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="93" rx="24" ry="4" fill="#000" opacity="0.15" />
      {features.behind?.(p)}
      {features.box ? (
        <rect x="22" y="32" width="56" height="56" rx="16" fill={p.body} />
      ) : (
        <ellipse cx="50" cy="61" rx="31" ry="29" fill={p.body} />
      )}
      {!features.box && character !== "penguin" && (
        <ellipse cx="50" cy="72" rx="17" ry="13" fill={p.belly} opacity="0.9" />
      )}
      {skin === "epic" && (
        <g fill="#fff">
          <circle cx="34" cy="44" r="1.2" />
          <circle cx="66" cy="76" r="1" />
          <circle cx="70" cy="46" r="0.9" />
          <circle cx="30" cy="78" r="1.1" />
          <circle cx="58" cy="40" r="0.8" />
        </g>
      )}
      {features.front(p)}
      {skin === "legendary" && (
        <g fill="#fde047">
          <path d="M14 30 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 z" />
          <path d="M86 26 l1.5 3.5 l3.5 1.5 l-3.5 1.5 l-1.5 3.5 l-1.5 -3.5 l-3.5 -1.5 l3.5 -1.5 z" />
          <path d="M84 80 l1.2 3 l3 1.2 l-3 1.2 l-1.2 3 l-1.2 -3 l-3 -1.2 l3 -1.2 z" />
        </g>
      )}
    </svg>
  );
}

/** A player's face anywhere in the game: their avatar, or their initials if they have none. */
export function PlayerAvatar({
  avatar,
  name,
  size = 32,
  colorIndex = 0,
  className,
}: {
  avatar?: AvatarWire | null;
  name: string;
  size?: number;
  colorIndex?: number;
  className?: string;
}) {
  if (avatar && CHARACTERS[avatar.character]) {
    return <LiveAvatar character={avatar.character} skin={avatar.skin} size={size} className={className} />;
  }
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-black text-white", className)}
      style={{ width: size, height: size, background: tileColor(colorIndex), fontSize: Math.max(10, size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** The gem itself — a small cut stone, so a price never needs the word. */
export function GemIcon({ size = 16, className }: { size?: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`gem-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#67e8f9" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <path d="M6 3h12l4 6-10 12L2 9z" fill={`url(#gem-${uid})`} />
      <path d="M2 9h20M8 3l-2 6 6 12 6-12-2-6" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="1" />
    </svg>
  );
}
