"use client";

/**
 * The avatar art: twelve original characters, drawn here as SVG from their keys.
 *
 * The server owns the catalog — which keys exist, what they cost, who owns what
 * (`backend/livequiz/avatars.py`). This file only draws. Every character is the same small
 * body with its own features on top, so a skin is a palette rather than a second drawing:
 *
 *   default   the character's own colours
 *   rare      "Sunset" — a second palette and a warm glow behind it
 *   epic      "Galaxy" — a deep-space gradient, twinkling stars, a ring in orbit
 *   legendary "Golden" — a gold gradient, a halo, a sweeping shine, sparkles in orbit
 *
 * A face is the same drawing with different eyes and mouth: waiting (the default), right,
 * thinking, oops. Small sizes keep the palette and drop the effects, which would only be mud at
 * 28 px, and nothing moves below 64 px.
 */

import { createContext, useContext, useId } from "react";
import { BookOpen, Flame, Rocket, Sparkles, Star, Target, Users, Zap } from "lucide-react";

import { cn } from "@/lib/cn";

import type { AvatarSkin, AvatarWire } from "./api";
import styles from "./game.module.css";
import { initials, tileColor } from "./theme";

export type AvatarFace = "waiting" | "right" | "thinking" | "oops";

const FaceContext = createContext<AvatarFace>("waiting");

/** Effects are drawn from this size up; below it they would only be mud. */
const EFFECTS_FROM = 40;
const MOTION_FROM = 64;

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

export function avatarName(character: string, skin: AvatarSkin | null, hat?: string | null): string {
  const base = CHARACTERS[character]?.name ?? "Avatar";
  const look = skin ? `${SKIN_TITLES[skin]} ${base}` : base;
  const title = hat ? HATS[hat]?.title : undefined;
  return title ? `${look} with ${title}` : look;
}

/** Eyes sit here unless a character moves them (the frog wears them on top). */
const EYES = { left: [39, 55], right: [61, 55] } as const;

function Eyes({ left = EYES.left, right = EYES.right, r = 8 }: { left?: readonly number[]; right?: readonly number[]; r?: number }) {
  const face = useContext(FaceContext);
  const k = r / 8;
  return (
    <g>
      {[left, right].map(([x, y]) => {
        if (face === "right") {
          return (
            <path
              key={`${x}-${y}`}
              d={`M${x - r * 0.85} ${y + 1.5} Q${x} ${y - r} ${x + r * 0.85} ${y + 1.5}`}
              fill="none"
              stroke={INK}
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          );
        }
        const pupil =
          face === "thinking" ? [x + 2.6 * k, y - 2.6 * k] : face === "oops" ? [x, y + 1.8 * k] : [x + 1, y + 1];
        return (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r={r} fill="#fff" />
            <circle cx={pupil[0]} cy={pupil[1]} r={r * 0.5} fill={INK} />
            <circle cx={x + 2.5} cy={y - 1.5} r={r * 0.18} fill="#fff" />
          </g>
        );
      })}
    </g>
  );
}

function Blush({ opacity }: { opacity: number }) {
  return (
    <>
      <circle cx="30" cy="66" r="4" fill="#fb7185" opacity={opacity} />
      <circle cx="70" cy="66" r="4" fill="#fb7185" opacity={opacity} />
    </>
  );
}

/** For a beak or another mouth that does not change: only the blush answers a right answer. */
function HappyBlush() {
  return useContext(FaceContext) === "right" ? <Blush opacity={0.55} /> : null;
}

/** An open smile centred on `y`, the height of the character's resting smile. */
function OpenMouth({ y }: { y: number }) {
  return (
    <>
      <path d={`M43 ${y - 2} Q50 ${y + 9} 57 ${y - 2} Z`} fill={INK} />
      <path d={`M46.5 ${y + 2.8} Q50 ${y + 6.5} 53.5 ${y + 2.8} Q50 ${y + 1.6} 46.5 ${y + 2.8} Z`} fill="#fb7185" />
    </>
  );
}

// `p` is accepted so every feature can hand its palette through the same shape; the face
// itself is drawn in ink and blush, the same on every skin.
function Face({ smile = "M45 67 Q50 71 55 67", cheeks = true }: { p?: Palette; smile?: string; cheeks?: boolean }) {
  const face = useContext(FaceContext);
  // "M45 67 …": the mouth's height, which every other mouth is drawn from.
  const y = Number(smile.split(" ")[1]);
  if (face === "right") {
    return (
      <g>
        <Blush opacity={0.55} />
        <OpenMouth y={y} />
      </g>
    );
  }
  return (
    <g>
      {cheeks && <Blush opacity={0.35} />}
      {face === "thinking" ? (
        <path d={`M45.5 ${y + 1} Q50 ${y + 1} 54.5 ${y - 1.2}`} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      ) : face === "oops" ? (
        <ellipse cx="50" cy={y + 1} rx="2.4" ry="2.9" fill={INK} />
      ) : (
        <path d={smile} fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      )}
    </g>
  );
}

function RobotFace({ accent }: { accent: string }) {
  const face = useContext(FaceContext);
  const led = (x: number) => {
    if (face === "right") {
      return <path key={x} d={`M${x - 4.5} 55.5 Q${x} 49.5 ${x + 4.5} 55.5`} fill="none" stroke={accent} strokeWidth="2.8" strokeLinecap="round" />;
    }
    const dx = face === "thinking" ? 2 : 0;
    const dy = face === "thinking" ? -1.5 : face === "oops" ? 1.5 : 0;
    return <circle key={x} cx={x + dx} cy={53.5 + dy} r="4" fill={accent} />;
  };
  return (
    <>
      <rect x="30" y="45" width="40" height="17" rx="8.5" fill={INK} />
      {led(41)}
      {led(59)}
      {face === "right" ? (
        <path d="M40 70 Q50 78 60 70" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      ) : face === "oops" ? (
        <circle cx="50" cy="73" r="3" fill={INK} opacity="0.75" />
      ) : (
        <rect x="40" y="70" width={face === "thinking" ? 14 : 20} height="5" rx="2.5" fill={INK} opacity="0.75" />
      )}
    </>
  );
}

function FrogMouth() {
  const face = useContext(FaceContext);
  if (face === "right") {
    return (
      <>
        <path d="M36 62 Q50 80 64 62 Z" fill={INK} />
        <path d="M44 69 Q50 74 56 69 Q50 67 44 69 Z" fill="#fb7185" />
      </>
    );
  }
  if (face === "oops") return <ellipse cx="50" cy="68" rx="3" ry="3.6" fill={INK} />;
  return (
    <path
      d={face === "thinking" ? "M38 68 Q50 70 62 63" : "M33 64 Q50 76 67 64"}
      fill="none"
      stroke={INK}
      strokeWidth="2.4"
      strokeLinecap="round"
    />
  );
}

function AlienEyes() {
  const face = useContext(FaceContext);
  if (face === "right") {
    return (
      <>
        <path d="M31 57 Q39 44 47 57" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
        <path d="M53 57 Q61 44 69 57" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      </>
    );
  }
  const glint = face === "thinking" ? [4, -7] : face === "oops" ? [0, 5] : [3, -4];
  return (
    <>
      <ellipse cx="39" cy="55" rx="9" ry="11" fill={INK} />
      <ellipse cx="61" cy="55" rx="9" ry="11" fill={INK} />
      <circle cx={39 + glint[0]} cy={55 + glint[1]} r="3" fill="#fff" />
      <circle cx={61 + glint[0]} cy={55 + glint[1]} r="3" fill="#fff" />
    </>
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
        <HappyBlush />
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
    front: (p) => <RobotFace accent={p.accent} />,
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
        <FrogMouth />
        <Blush opacity={0.35} />
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
        <HappyBlush />
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
        <AlienEyes />
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

/** A hat sits on the head, wherever the character. `crown` is the gradient id its gold needs. */
/** The Navroʻz garland's five flowers: where each leaf sits, the petals, and their colour. */
const TULIPS: Array<[number, number, string, string]> = [
  [22, 36, "M22 34 Q22 27 24 26 L26 29 L28 26 Q30 27 30 34 Q26 37 22 34 Z", "#ef4444"],
  [34, 29, "M34 27 Q34 20 36 19 L38 22 L40 19 Q42 20 42 27 Q38 30 34 27 Z", "#f472b6"],
  [46, 26, "M46 24 Q46 17 48 16 L50 19 L52 16 Q54 17 54 24 Q50 27 46 24 Z", "#facc15"],
  [58, 29, "M58 27 Q58 20 60 19 L62 22 L64 19 Q66 20 66 27 Q62 30 58 27 Z", "#ef4444"],
  [70, 36, "M70 34 Q70 27 72 26 L74 29 L76 26 Q78 27 78 34 Q74 37 70 34 Z", "#f472b6"],
];

const HATS: Record<string, { title: string; draw: (crown: string) => React.ReactNode }> = {
  grad_cap: {
    title: "Graduation cap",
    draw: () => (
      <>
        <path d="M33 30 L33 38 Q50 44 67 38 L67 30 Z" fill="#2b2a3d" />
        <polygon points="18,26 50,13 82,26 50,39" fill="#1f1d2e" />
        <polygon points="18,26 50,13 82,26 50,19" fill="#3a3756" />
        <circle cx="50" cy="26" r="2.2" fill="#fbbf24" />
        <path d="M50 26 L74 30 L76 42" fill="none" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="73.5" y="41" width="5" height="8" rx="2" fill="#fbbf24" />
      </>
    ),
  },
  headphones: {
    title: "Headphones",
    draw: () => (
      <>
        <path d="M19 60 Q17 18 50 18 Q83 18 81 60" fill="none" stroke="#334155" strokeWidth="6" strokeLinecap="round" />
        <path d="M21 56 Q20 22 50 22 Q80 22 79 56" fill="none" stroke="#64748b" strokeWidth="1.6" strokeLinecap="round" />
        <rect x="10" y="50" width="14" height="24" rx="6" fill="#2563eb" />
        <rect x="76" y="50" width="14" height="24" rx="6" fill="#2563eb" />
        <rect x="13" y="54" width="8" height="16" rx="4" fill="#93c5fd" opacity="0.6" />
        <rect x="79" y="54" width="8" height="16" rx="4" fill="#93c5fd" opacity="0.6" />
      </>
    ),
  },
  doppi: {
    title: "Doʻppi",
    draw: () => (
      <>
        <path d="M25 39 L27.5 15 Q50 6 72.5 15 L75 39 Q50 32.5 25 39 Z" fill="#111827" />
        <line x1="50" y1="9" x2="50" y2="33.5" stroke="#374151" strokeWidth="1" strokeLinecap="round" />
        <path d="M37.5 17 q5.2 5.4 0.4 11.6 q-5.4 -4.8 -0.4 -11.6 z" fill="#f8fafc" />
        <path d="M50 13.5 q5.2 5.4 0.4 11.6 q-5.4 -4.8 -0.4 -11.6 z" fill="#f8fafc" />
        <path d="M62.5 17 q5.2 5.4 0.4 11.6 q-5.4 -4.8 -0.4 -11.6 z" fill="#f8fafc" />
        <circle cx="43.5" cy="27" r="1.2" fill="#f8fafc" />
        <circle cx="56.5" cy="27" r="1.2" fill="#f8fafc" />
        <path d="M25.5 37 Q50 30.5 74.5 37" fill="none" stroke="#f8fafc" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
  },
  crown: {
    title: "Crown",
    draw: (crown) => (
      <>
        <polygon points="29,36 27,15 39,25 50,9 61,25 73,15 71,36" fill={`url(#${crown})`} stroke="#b45309" strokeWidth="1" />
        <rect x="29" y="31" width="42" height="7" rx="2" fill="#f59e0b" />
        <circle cx="39" cy="34.5" r="2.2" fill="#ef4444" />
        <circle cx="50" cy="34.5" r="2.2" fill="#2563eb" />
        <circle cx="61" cy="34.5" r="2.2" fill="#10b981" />
        <circle cx="27" cy="15" r="2.4" fill="#fde047" />
        <circle cx="50" cy="9" r="2.6" fill="#fde047" />
        <circle cx="73" cy="15" r="2.4" fill="#fde047" />
      </>
    ),
  },
  winter_beanie: {
    title: "Winter beanie",
    draw: () => (
      <>
        <path d="M24 40 Q24 13 50 13 Q76 13 76 40 Z" fill="#2563eb" />
        <path d="M28 24 Q50 18 72 24" fill="none" stroke="#93c5fd" strokeWidth="3" strokeLinecap="round" />
        <path d="M25.5 31 Q50 25 74.5 31" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
        <rect x="22" y="34" width="56" height="9" rx="4.5" fill="#1e3a8a" />
        <circle cx="50" cy="11" r="6.5" fill="#f8fafc" />
        <circle cx="48" cy="9" r="2" fill="#ffffff" />
      </>
    ),
  },
  navroz_tulips: {
    title: "Navroʻz tulips",
    draw: () => (
      <g transform="translate(0 2)">
        <path d="M22 38 Q50 20 78 38" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" />
        {TULIPS.map(([x, y, petals, fill]) => (
          <g key={x}>
            <ellipse cx={x} cy={y} rx="3" ry="1.6" fill="#22c55e" transform={`rotate(-30 ${x} ${y})`} />
            <path d={petals} fill={fill} />
          </g>
        ))}
      </g>
    ),
  },
};

/** The frog's eyes are on top of its head, so a hat sits higher to keep them showing. */
const HAT_LIFT: Record<string, number> = { frog: -12 };

/** A four-point sparkle whose top point is at (x, y). */
function sparkle(x: number, y: number, s: number): string {
  const a = 0.3 * s;
  const b = 0.7 * s;
  return `M${x} ${y} l${a} ${b} l${b} ${a} l${-b} ${a} l${-a} ${b} l${-a} ${-b} l${-b} ${-a} l${b} ${-a} z`;
}

const GALAXY_STARS: ReadonlyArray<readonly [number, number, number]> = [
  [34, 44, 1.3],
  [66, 76, 1.1],
  [70, 46, 1],
  [30, 78, 1.2],
  [58, 40, 0.9],
  [44, 84, 0.9],
  [76, 62, 1.2],
  [26, 60, 0.8],
  [52, 50, 0.7],
];

const RING_BACK = "M6 64 A44 9 0 0 1 94 64";
const RING_FRONT = "M6 64 A44 9 0 0 0 94 64";

/** One character in one look. Unknown keys draw nothing — callers fall back to initials. */
export function LiveAvatar({
  character,
  skin = null,
  size = 48,
  face = "waiting",
  still = false,
  hat,
  className,
}: {
  character: string;
  skin?: AvatarSkin | null;
  size?: number;
  face?: AvatarFace;
  hat?: string | null;
  /** Hold the effects still, whatever the size: a long list would otherwise all move at once. */
  still?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const ids = { galaxy: `lqg-${uid}`, gold: `lqy-${uid}` };
  const features = FEATURES[character];
  if (!features || !CHARACTERS[character]) return null;
  const p = paletteFor(character, skin, ids);
  const name = avatarName(character, skin, hat);
  const hatArt = hat ? HATS[hat] : undefined;
  const rich = size >= EFFECTS_FROM;
  const moving = rich && !still && size >= MOTION_FROM;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={name}
      className={cn("shrink-0", className)}
      style={{ overflow: "visible" }}
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
        {hat === "crown" && (
          <linearGradient id={`lqk-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fef08a" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        )}
        {skin === "rare" && rich && (
          <radialGradient id={`lqs-${uid}`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#fdba74" stopOpacity="0.75" />
            <stop offset="0.6" stopColor="#fb923c" stopOpacity="0.25" />
            <stop offset="1" stopColor="#fb923c" stopOpacity="0" />
          </radialGradient>
        )}
        {skin === "legendary" && rich && (
          <>
            <linearGradient id={`lqh-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fef08a" />
              <stop offset="1" stopColor="#f59e0b" />
            </linearGradient>
            <clipPath id={`lqc-${uid}`}>
              {features.box ? <rect x="22" y="32" width="56" height="56" rx="16" /> : <ellipse cx="50" cy="61" rx="31" ry="29" />}
            </clipPath>
          </>
        )}
      </defs>
      <ellipse cx="50" cy="93" rx="24" ry="4" fill="#000" opacity="0.15" />
      {skin === "rare" && rich && <circle cx="50" cy="58" r="47" fill={`url(#lqs-${uid})`} />}
      {skin === "epic" && rich && (
        <path d={RING_BACK} fill="none" stroke="#c4b5fd" strokeWidth="2.2" opacity="0.75" transform="rotate(-12 50 64)" />
      )}
      {skin === "legendary" && rich && (
        <>
          <circle cx="50" cy="58" r="46" fill="none" stroke={`url(#lqh-${uid})`} strokeWidth="2.4" opacity="0.85" />
          <circle cx="50" cy="58" r="49" fill="none" stroke="#fde68a" strokeWidth="0.8" opacity="0.4" />
        </>
      )}
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
        <>
          <g fill="#fff">
            {GALAXY_STARS.slice(0, rich ? GALAXY_STARS.length : 5).map(([cx, cy, r], i) => (
              <circle
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r={r}
                className={moving ? styles.twinkle : undefined}
                style={moving ? { animationDelay: `${i * 0.3}s` } : undefined}
              />
            ))}
          </g>
          {rich && <ellipse cx="60" cy="74" rx="10" ry="6" fill="#f0abfc" opacity="0.18" />}
        </>
      )}
      {skin === "legendary" && rich && (
        <g clipPath={`url(#lqc-${uid})`}>
          {/* Parked left of the body while it moves; across it when it must hold still. */}
          <polygon
            points={moving ? "-30,20 -14,20 -34,100 -50,100" : "40,20 52,20 32,100 20,100"}
            fill="#fff"
            opacity="0.45"
            className={moving ? styles.shimmer : undefined}
          />
        </g>
      )}
      <FaceContext.Provider value={face}>{features.front(p)}</FaceContext.Provider>
      {hatArt && <g transform={`translate(0 ${HAT_LIFT[character] ?? 0})`}>{hatArt.draw(`lqk-${uid}`)}</g>}
      {skin === "epic" && rich && (
        <path d={RING_FRONT} fill="none" stroke="#c4b5fd" strokeWidth="2.2" opacity="0.9" transform="rotate(-12 50 64)" />
      )}
      {skin === "legendary" && rich && (
        <>
          <g fill="#fde047" className={moving ? styles.orbit : undefined}>
            <path d={sparkle(50, 6.5, 4.5)} />
            <path d={sparkle(91, 74.4, 3.6)} />
            <path d={sparkle(9, 74.4, 3.6)} />
          </g>
          <g fill="#fef9c3">
            <path d={sparkle(16, 27.6, 2.4)} />
            <path d={sparkle(84, 25.8, 2.2)} />
          </g>
        </>
      )}
      {skin === "legendary" && !rich && (
        <g fill="#fde047">
          <path d={sparkle(14, 30, 7)} />
          <path d={sparkle(86, 26, 5)} />
          <path d={sparkle(84, 80, 4)} />
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
  face,
  still,
  className,
}: {
  avatar?: AvatarWire | null;
  name: string;
  size?: number;
  colorIndex?: number;
  face?: AvatarFace;
  still?: boolean;
  className?: string;
}) {
  if (avatar && CHARACTERS[avatar.character]) {
    return (
      <LiveAvatar
        character={avatar.character}
        skin={avatar.skin}
        hat={avatar.hat}
        size={size}
        face={face}
        still={still}
        className={className}
      />
    );
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

/** An avatar on its round backdrop: the disc the lobby, the podium and the top bar all share. */
export function AvatarDisc({
  avatar,
  name,
  size,
  face,
  still,
  colorIndex = 0,
  background = "rgba(255, 255, 255, 0.06)",
  className,
}: {
  avatar?: AvatarWire | null;
  name: string;
  size: number;
  face?: AvatarFace;
  still?: boolean;
  colorIndex?: number;
  background?: string;
  className?: string;
}) {
  const ring = avatar?.frame ? FRAME_RINGS[avatar.frame] : undefined;
  if (ring) {
    return (
      <span
        className={cn("flex shrink-0 rounded-full", className)}
        style={{ width: size, height: size, padding: Math.max(2, Math.round(size * 0.03)), background: ring }}
      >
        <span className="flex h-full w-full items-center justify-center rounded-full bg-[#1b1636]">
          <PlayerAvatar avatar={avatar} name={name} size={Math.round(size * 0.78)} face={face} still={still} colorIndex={colorIndex} />
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full", className)}
      style={{ width: size, height: size, background }}
    >
      <PlayerAvatar avatar={avatar} name={name} size={Math.round(size * 0.82)} face={face} still={still} colorIndex={colorIndex} />
    </span>
  );
}

const FRAME_RINGS: Record<string, string> = {
  bronze: "linear-gradient(135deg, #f3c49b, #b45309 55%, #7c2d12)",
  silver: "linear-gradient(135deg, #f8fafc, #94a3b8 55%, #475569)",
  gold: "linear-gradient(135deg, #fef08a, #f59e0b 55%, #b45309)",
  aurora: "conic-gradient(#22d3ee, #a78bfa, #f472b6, #34d399, #22d3ee)",
};

const EMOTES: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  lets_go: { label: "Let’s go!", icon: Rocket, color: "#2563eb" },
  on_fire: { label: "On fire", icon: Flame, color: "#ea580c" },
  gg: { label: "GG", icon: Sparkles, color: "#7c3aed" },
  wow: { label: "Wow", icon: Star, color: "#b45309" },
};

/** What a student says on the podium and at the reveal, as a speech bubble. */
export function EmoteBubble({ emote, className }: { emote?: string | null; className?: string }) {
  const meta = emote ? EMOTES[emote] : undefined;
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "relative inline-flex items-center gap-[7px] whitespace-nowrap rounded-[14px] bg-white px-[11px] py-1.5 text-[13px] font-extrabold text-[#1f1d2e] shadow-[0_6px_16px_rgba(0,0,0,0.3)]",
        className,
      )}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" style={{ color: meta.color }} aria-hidden />
      {meta.label}
      <span aria-hidden className="absolute -bottom-[5px] left-[18px] h-2.5 w-2.5 rotate-45 bg-white" />
    </span>
  );
}

export type TitleTone = "amber" | "teal" | "blue" | "violet";

export const TITLES: Record<string, { name: string; icon: React.ElementType; tone: TitleTone }> = {
  streak_master: { name: "Streak master", icon: Flame, tone: "amber" },
  team_captain: { name: "Team captain", icon: Users, tone: "amber" },
  lightning: { name: "Lightning", icon: Zap, tone: "teal" },
  word_wise: { name: "Word wise", icon: BookOpen, tone: "blue" },
  perfect_game: { name: "Perfect game", icon: Target, tone: "violet" },
};

const TITLE_CHIP: Record<TitleTone, Record<"dark" | "light", React.CSSProperties>> = {
  amber: {
    dark: { background: "rgba(251, 191, 36, 0.16)", borderColor: "rgba(251, 191, 36, 0.45)", color: "#fde68a" },
    light: { background: "#fffbeb", borderColor: "rgba(217, 119, 6, 0.3)", color: "#92400e" },
  },
  teal: {
    dark: { background: "rgba(45, 212, 191, 0.14)", borderColor: "rgba(45, 212, 191, 0.45)", color: "#99f6e4" },
    light: { background: "#f0fdfa", borderColor: "rgba(15, 118, 110, 0.3)", color: "#115e59" },
  },
  blue: {
    dark: { background: "rgba(96, 165, 250, 0.16)", borderColor: "rgba(96, 165, 250, 0.45)", color: "#bfdbfe" },
    light: { background: "#eff6ff", borderColor: "rgba(29, 78, 216, 0.3)", color: "#1e40af" },
  },
  violet: {
    dark: { background: "rgba(167, 139, 250, 0.16)", borderColor: "rgba(167, 139, 250, 0.45)", color: "#ddd6fe" },
    light: { background: "#f5f3ff", borderColor: "rgba(109, 40, 217, 0.3)", color: "#5b21b6" },
  },
};

/**
 * A title the student has earned. `fit` is for a column narrower than the longest name, which on
 * a phone a podium's is: the chip then takes two lines rather than running into its neighbour.
 */
export function TitleChip({
  title,
  tone = "dark",
  fit = false,
  className,
}: {
  title?: string | null;
  tone?: "dark" | "light";
  fit?: boolean;
  className?: string;
}) {
  const meta = title ? TITLES[title] : undefined;
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-[5px] rounded-full border px-[9px] py-[3px] text-[11px] font-extrabold uppercase leading-tight tracking-[0.08em]",
        fit ? "max-sm:rounded-xl max-sm:px-1.5 max-sm:text-[10px] sm:whitespace-nowrap" : "whitespace-nowrap",
        className,
      )}
      style={TITLE_CHIP[meta.tone][tone]}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {meta.name}
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
