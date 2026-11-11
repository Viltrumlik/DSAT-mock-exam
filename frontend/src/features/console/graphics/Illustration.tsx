import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Spot illustrations (design handoff v0.3, Graphics board · 1): flat line drawings for empty, done and
 * broken moments, in the system's own tokens so they change with dark mode. 240 × 160, 2.5 px lines, no
 * gradients, no faces, no stock art. One per screen at most — never in tables or dialogs.
 */
export type IllustrationName = "chairs" | "sunrise" | "magnifier" | "unplugged" | "laptop" | "plane";

const v = (token: string) => `var(--ms-${token})`;
const line = (stroke: string, width = 2.5): CSSProperties => ({ stroke: v(stroke), strokeWidth: width, strokeLinecap: "round", fill: "none" });
const shape = (fill: string, stroke: string, width = 2.5): CSSProperties => ({ fill: v(fill), stroke: v(stroke), strokeWidth: width, strokeLinejoin: "round" });

/** What each drawing shows, read out instead of the picture. */
export const ILLUSTRATION_LABEL: Record<IllustrationName, string> = {
  chairs: "Three empty chairs, the middle one with a plus sign",
  sunrise: "Sun rising over a horizon with a check mark",
  magnifier: "A magnifier over two empty cards",
  unplugged: "A plug pulled out of its socket",
  laptop: "A laptop showing the module editor",
  plane: "A paper plane leaving a dashed trail",
};

const ART: Record<IllustrationName, ReactNode> = {
  chairs: (
    <>
      <path d="M20 132h200" style={line("border-strong", 2)} />
      <g style={shape("surface-2", "fg-3")}>
        <rect x="34" y="72" width="32" height="28" rx="7" />
        <rect x="30" y="100" width="40" height="10" rx="4" />
        <rect x="154" y="72" width="32" height="28" rx="7" />
        <rect x="150" y="100" width="40" height="10" rx="4" />
      </g>
      <path d="M36 110v22M64 110v22M156 110v22M184 110v22" style={line("fg-3")} />
      <g style={shape("primary-soft-2", "primary")}>
        <rect x="94" y="72" width="32" height="28" rx="7" />
        <rect x="90" y="100" width="40" height="10" rx="4" />
      </g>
      <path d="M96 110v22M124 110v22" style={line("primary")} />
      <circle cx="110" cy="42" r="15" style={{ fill: v("primary") }} />
      <path d="M110 35v14M103 42h14" style={{ stroke: "#fff", strokeWidth: 2.5, strokeLinecap: "round" }} />
    </>
  ),
  sunrise: (
    <>
      <path d="M70 118a50 50 0 0 1 100 0Z" style={shape("primary-soft", "primary")} />
      <path d="M120 44v-14M78 60l-10-10M162 60l10-10M58 96H44M182 96h14" style={line("primary")} />
      <path d="M24 118h192" style={line("fg-3")} />
      <path d="M60 134h52M128 134h36" style={line("border-strong")} />
      <circle cx="166" cy="70" r="17" style={{ fill: v("positive") }} />
      <path d="M158 70.5l5.5 5.5 10.5-11" style={{ fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }} />
    </>
  ),
  magnifier: (
    <>
      <rect x="40" y="34" width="120" height="44" rx="10" style={shape("card", "border-strong", 2)} />
      <rect x="40" y="88" width="120" height="44" rx="10" style={shape("card", "border-strong", 2)} />
      <path d="M56 50h56M56 62h36M56 104h56M56 116h36" style={line("surface-3", 6)} />
      <circle cx="164" cy="84" r="26" style={shape("card", "fg-2", 3)} />
      <path d="M183 103l20 20" style={line("fg-2", 6)} />
      <path d="M157 78a7 7 0 1 1 9.5 6.5c-1.4.6-2.5 1.8-2.5 3.4v1" style={line("primary", 3)} />
      <circle cx="164" cy="96" r="2" style={{ fill: v("primary") }} />
    </>
  ),
  unplugged: (
    <>
      <path d="M16 96c30 0 40-20 74-20" style={line("fg-3", 3)} />
      <rect x="88" y="62" width="28" height="30" rx="6" style={shape("surface-2", "fg-2")} />
      <path d="M116 70h10M116 84h10" style={line("fg-2", 3)} />
      <rect x="146" y="58" width="30" height="38" rx="7" style={shape("surface-2", "fg-2")} />
      <path d="M154 70h2M154 84h2" style={line("fg-2", 4)} />
      <path d="M176 78c26 0 34 24 52 24" style={line("fg-3", 3)} />
      <path d="M134 52l-4-10M136 104l-3 10M141 50l4-9M142 106l4 9" style={line("critical", 3)} />
    </>
  ),
  laptop: (
    <>
      <rect x="48" y="26" width="144" height="92" rx="9" style={shape("card", "fg-2")} />
      <rect x="58" y="36" width="30" height="72" rx="4" style={{ fill: v("surface-2") }} />
      <path d="M63 46h20M63 56h20M63 66h20M63 76h14" style={line("surface-3", 4)} />
      <path d="M98 46h66M98 58h80M98 70h56" style={line("surface-3", 5)} />
      <rect x="98" y="82" width="38" height="10" rx="5" style={{ fill: v("rw") }} />
      <rect x="140" y="82" width="38" height="10" rx="5" style={{ fill: v("math") }} />
      <rect x="98" y="96" width="38" height="8" rx="4" style={shape("positive-soft", "positive", 1.5)} />
      <path d="M32 124h176l-12 12H44Z" style={shape("surface-2", "fg-2")} />
    </>
  ),
  plane: (
    <>
      <path d="M28 124c30-6 44-34 78-34s46 22 70-6" style={{ ...line("primary"), strokeDasharray: "6 7" }} />
      <path d="M214 34 166 54l20 10 8 20Z" style={shape("primary-soft-2", "primary")} />
      <path d="M186 64l28-30" style={line("primary")} />
      <rect x="34" y="34" width="94" height="40" rx="14" style={shape("card", "border-strong", 2)} />
      <path d="M48 50h54M48 60h34" style={line("surface-3", 5)} />
      <path d="M100 62l3 3 6-6M106 62l3 3 6-6" style={{ ...line("primary-text", 2), strokeLinejoin: "round" }} />
    </>
  ),
};

export function Illustration({ name, className, decorative = false }: { name: IllustrationName; className?: string; decorative?: boolean }) {
  return (
    <svg
      viewBox="0 0 240 160"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : ILLUSTRATION_LABEL[name]}
      aria-hidden={decorative || undefined}
      className={cn("h-auto w-[240px] max-w-full", className)}
    >
      {ART[name]}
    </svg>
  );
}
