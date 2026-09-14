"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/cn";

import { Panel, PanelHeader, TONE } from "../profileUi";

type ThemeChoice = "light" | "dark" | "system";

/**
 * The palettes the pictures are painted in. Fixed on purpose: the Light picture has to look
 * light while the page around it is dark, and the other way round. Blue in both, the way the app
 * itself is — dark mode's indigo was replaced by the same blue (the owner: "light modeda blue
 * turibdi dark modeda siyoh rang shuni har yerda blue qiling").
 */
const LOOK = {
  light: {
    page: "#eef2f8", side: "#ffffff", card: "#ffffff", line: "#e2e8f0", faint: "#d5ddea", ink: "#1e293b",
    accent: "#2a68c0", accentSoft: "#dbe7f7", green: "#059669", amber: "#d97706",
  },
  dark: {
    page: "#0b1120", side: "#111827", card: "#161f33", line: "#26324a", faint: "#334158", ink: "#e2e8f0",
    accent: "#3170d6", accentSoft: "#1e3a66", green: "#34d399", amber: "#fbbf24",
  },
} as const;

/** A miniature of this very page — the sidebar with its selected item, the hero, three tiles —
 *  so a student sees what they are choosing rather than an abstract swatch. */
function Preview({ look }: { look: keyof typeof LOOK }) {
  const c = LOOK[look];
  const edge = { background: c.card, boxShadow: `0 0 0 1px ${c.line}` };
  return (
    <span aria-hidden className="flex h-full w-full" style={{ background: c.page }}>
      <span className="flex w-[28%] flex-col gap-[5px] px-[6px] py-[7px]" style={{ background: c.side, boxShadow: `1px 0 0 ${c.line}` }}>
        <span className="mb-[3px] block h-[9px] w-[9px] rounded-[3px]" style={{ background: c.accent }} />
        <span className="block h-[5px] w-[80%] rounded-full" style={{ background: c.faint }} />
        <span className="block h-[9px] w-full rounded-[4px]" style={{ background: c.accent }} />
        <span className="block h-[5px] w-[70%] rounded-full" style={{ background: c.faint }} />
        <span className="block h-[5px] w-[85%] rounded-full" style={{ background: c.faint }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[5px] p-[7px]">
        <span className="block h-[6px] w-[55%] rounded-full" style={edge} />
        <span className="flex items-center gap-[5px] rounded-[5px] p-[5px]" style={edge}>
          <span className="block h-[14px] w-[14px] shrink-0 rounded-[4px]" style={{ background: c.accentSoft }} />
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="block h-[4px] w-[70%] rounded-full" style={{ background: c.ink }} />
            <span className="block h-[3px] w-[45%] rounded-full" style={{ background: c.faint }} />
          </span>
          <span className="block h-[7px] w-[18px] shrink-0 rounded-full" style={{ background: c.accent }} />
        </span>
        <span className="grid flex-1 grid-cols-3 gap-[4px]">
          {[c.accent, c.green, c.amber].map((tint) => (
            <span key={tint} className="flex flex-col gap-[3px] rounded-[4px] p-[4px]" style={edge}>
              <span className="block h-[5px] w-[5px] rounded-[2px]" style={{ background: tint }} />
              <span className="block h-[4px] w-[70%] rounded-full" style={{ background: tint }} />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

const CHOICES: { value: ThemeChoice; label: string; hint: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", hint: "Bright and clear", icon: Sun },
  { value: "dark", label: "Dark", hint: "Easy on the eyes at night", icon: Moon },
  { value: "system", label: "Automatic", hint: "Follows your device", icon: Monitor },
];

/**
 * Light, dark, or whatever the device is set to.
 *
 * The header's button only flips between light and dark, so a student who had once pressed it
 * had no way back to following their phone's own setting — which is what every account starts
 * on. The choice is kept in this browser (next-themes' own storage), as the header's always was.
 */
export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the stored choice in the browser; before that, mark nothing.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? ((theme as ThemeChoice | undefined) ?? "system") : null;

  return (
    <Panel>
      <PanelHeader icon={Palette} tone="violet" title="Appearance" description="How MasterSAT looks on this device." />

      <div role="radiogroup" aria-label="Theme" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CHOICES.map(({ value, label, hint, icon: Icon }) => {
          const selected = current === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(value)}
              className={cn(
                "ds-ring cr-press squircle group flex flex-col gap-3 border-2 p-3 text-left font-[inherit] transition-colors [--sq:12px]",
                selected ? "border-primary bg-primary/[0.06]" : "quartz border-transparent hover:border-primary/30",
              )}
            >
              <span className="squircle relative block h-24 overflow-hidden [--sq:9px]">
                {value === "system" ? (
                  // One picture, light on the left and dark on the right: the dark copy lies on
                  // top of the light one, clipped to its right half, so the two halves line up.
                  <>
                    <span className="absolute inset-0">
                      <Preview look="light" />
                    </span>
                    <span className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
                      <Preview look="dark" />
                    </span>
                  </>
                ) : (
                  <Preview look={value} />
                )}
              </span>
              <span className="flex items-center gap-2.5">
                <span className={cn("squircle grid h-8 w-8 shrink-0 place-items-center [--sq:6px]", TONE.violet.tile)}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-extrabold text-foreground">{label}</span>
                  <span className="block text-[12px] font-medium leading-snug text-muted-foreground">{hint}</span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                    selected ? "border-primary bg-primary text-primary-foreground" : "border-primary/25",
                  )}
                >
                  {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-[12.5px] font-medium text-muted-foreground">
        Saved in this browser. The sun and moon button at the top of the page switches between light and dark too.
      </p>
    </Panel>
  );
}
