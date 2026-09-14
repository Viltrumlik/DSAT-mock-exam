"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/cn";

import { Panel, PanelHeader, TONE } from "../profileUi";

type ThemeChoice = "light" | "dark" | "system";

/** A little picture of the page in each look. Fixed colours on purpose: the Light card has to
 *  look light while the page around it is dark, and the other way round. */
function Preview({ look }: { look: "light" | "dark" }) {
  const c =
    look === "light"
      ? { bg: "#f5f7fb", card: "#ffffff", line: "#e3e8f2", accent: "#2a68c0" }
      : { bg: "#0b1220", card: "#131c2e", line: "#243049", accent: "#6d7cf0" };
  return (
    <span className="flex h-full w-full gap-1.5 p-2" style={{ background: c.bg }}>
      <span className="block w-1/4 rounded-[5px]" style={{ background: c.card, boxShadow: `0 0 0 1px ${c.line}` }} />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="block h-3.5 rounded-[4px]" style={{ background: c.accent }} />
        <span className="block flex-1 rounded-[5px] p-1.5" style={{ background: c.card, boxShadow: `0 0 0 1px ${c.line}` }}>
          <span className="block h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
          <span className="mt-1 block h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
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
                  <span className="absolute inset-0 grid grid-cols-2">
                    <span className="overflow-hidden">
                      <Preview look="light" />
                    </span>
                    <span className="overflow-hidden">
                      <Preview look="dark" />
                    </span>
                  </span>
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
