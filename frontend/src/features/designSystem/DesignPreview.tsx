"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "next-themes";

import { Icon } from "@/components/ui/Icon";
import { ControlsSection } from "./ControlsSection";
import { DataSection } from "./DataSection";
import { FormsSection } from "./FormsSection";
import { IconSection } from "./IconSection";
import { MotionSection } from "./MotionSection";
import { OverlaysSection } from "./OverlaysSection";
import { TokenSection } from "./TokenSection";

function Section({ id, over, title, children }: { id: string; over: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-ms-over uppercase text-ms-fg-3">{over}</span>
        <h2 className="text-ms-title text-ms-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

const TYPE: { meta: string; className: string; sample: string; testId?: string }[] = [
  { meta: "over · 12/16 · 600 · caps", className: "text-ms-over uppercase text-ms-fg-3", sample: "Sign-in and contact" },
  { meta: "display · 30/36 · 700", className: "text-ms-display text-ms-fg", sample: "Sardor Qodirov", testId: "font-sans-sample" },
  { meta: "b-display · Plus Jakarta · Builder", className: "font-ms-display text-ms-b-display text-ms-fg", sample: "Full Mock 5 — November Checkpoint", testId: "font-display-sample" },
  { meta: "title · 22/28 · 700", className: "text-ms-title text-ms-fg", sample: "Middle M5 · Math · Muxlisa" },
  { meta: "h · 17/24 · 600", className: "text-ms-h text-ms-fg", sample: "Recent attendance" },
  { meta: "body · 15/22", className: "text-ms-body text-ms-fg-2", sample: "Every lesson, payment and message at the learning center, in one place." },
  { meta: "small · 13/18 · 500", className: "text-ms-small text-ms-fg-3", sample: "Joined 30 Jul 2026 · last seen 1 h ago" },
  { meta: "num · 24/28 · tabular", className: "text-ms-num tabular-nums text-ms-fg", sample: "1 300 000 so'm" },
  { meta: "mono · Geist Mono", className: "font-ms-mono text-[14px] text-ms-fg", sample: "QB-MATH-000030 · +998 90 153 85 52 · 9HTR4WQM", testId: "font-mono-sample" },
  { meta: "reading · 17/28 · Georgia", className: "font-ms-serif text-ms-reading text-ms-fg", sample: "Some economists argue that remote work reduces productivity because employees lose the informal hallway conversations that spark new ideas." },
];

/** Two elements that should resolve the same --ms-* values: one in the page, one portalled into <body>. */
function Probes() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const probe = "pointer-events-none fixed left-0 top-0 size-px bg-ms-card opacity-0";
  return (
    <>
      <span aria-hidden="true" data-testid="tree-probe" className={probe} />
      {mounted ? createPortal(<span aria-hidden="true" data-testid="portal-probe" className={probe} />, document.body) : null}
    </>
  );
}

/**
 * /ops/design — the console redesign's foundation (design handoff v0.3), rendered with the real
 * classes: tokens with their measured contrast, type, shape and depth, the 111 icons and the
 * motion. Not in the menu; the ops layout keeps scoped admins out.
 */
export default function DesignPreview() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div className="ms min-h-full">
      <div className="mx-auto flex max-w-(--ms-content-max) flex-col gap-12 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex max-w-[760px] flex-col gap-2">
            <span className="text-ms-over uppercase text-ms-fg-3">Console redesign · foundation</span>
            <h1 className="text-ms-display text-ms-fg">Design system</h1>
            <p className="text-ms-body text-ms-fg-2">
              The tokens, type, icons and motion the new Builder and Admin are built from, drawn with the same classes the
              screens will use. Nothing here changes a page yet.
            </p>
          </div>
          <div role="group" aria-label="Theme" className="inline-flex gap-0.5 rounded-full bg-ms-surface-2 p-[3px]">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={resolvedTheme === t}
                onClick={() => setTheme(t)}
                className={`ms-transition inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] ${
                  resolvedTheme === t ? "bg-ms-card font-semibold text-ms-fg shadow-ms-1" : "font-medium text-ms-fg-2"
                }`}
              >
                <Icon name={t === "light" ? "sun" : "moon"} size="sm" />
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </header>

        <Section id="colour" over="1 · Colour" title="Surfaces, brand and the six verdicts">
          <TokenSection />
        </Section>

        <Section id="type" over="2 · Type" title="Geist for the consoles, Georgia for what students read">
          <div className="flex flex-col rounded-ms-card bg-ms-card px-6 py-2 shadow-ms-1">
            {TYPE.map((row) => (
              <div key={row.meta} className="grid gap-2 border-b border-ms-line py-3.5 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
                <span className="font-ms-mono text-[13px] leading-[18px] text-ms-fg-3">{row.meta}</span>
                <span data-testid={row.testId} className={row.className}>{row.sample}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section id="shape" over="3 · Shape and depth" title="Two temperatures, three heights, two densities">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
              <b className="text-ms-h text-ms-fg">Radius</b>
              <div className="grid grid-cols-2 gap-3 text-[14px]">
                <div data-testid="radius-admin" className="grid h-16 place-items-center rounded-ms-card bg-ms-surface-2 text-ms-fg-2">Admin · 20</div>
                <div data-ms-temp="builder">
                  <div data-testid="radius-builder" className="grid h-16 place-items-center rounded-ms-card bg-ms-surface-2 text-ms-fg-2">Builder · 24</div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
              <b className="text-ms-h text-ms-fg">Elevation</b>
              <div className="grid grid-cols-3 gap-3 rounded-ms-card bg-ms-surface-2 p-3 text-[13px] text-ms-fg-2">
                <div className="grid h-16 place-items-center rounded-[14px] bg-ms-card shadow-ms-1">1 · card</div>
                <div className="grid h-16 place-items-center rounded-[14px] bg-ms-card shadow-ms-2">2 · float</div>
                <div className="grid h-16 place-items-center rounded-[14px] bg-ms-card shadow-ms-3">3 · overlay</div>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-ms-card bg-ms-card p-5 shadow-ms-1">
              <b className="text-ms-h text-ms-fg">Density</b>
              <div className="grid grid-cols-2 gap-3 text-[14px]">
                <div data-testid="ctl-comfortable" className="flex h-(--ms-h-ctl) items-center rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-ms-fg">Comfortable · 44</div>
                <div data-ms-density="compact">
                  <div data-testid="ctl-compact" className="flex h-(--ms-h-ctl) items-center rounded-ms-ctl border border-ms-border-input bg-ms-card px-3 text-ms-fg">Compact · 36</div>
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="icons" over="4 · Icons" title="111 icons: Lucide's generic set and 30 drawn for MasterSAT">
          <IconSection />
        </Section>

        <Section id="motion" over="5 · Motion" title="Motion that answers “did it work?”">
          <MotionSection />
        </Section>

        <Section id="controls" over="6 · Controls" title="Buttons, badges, chips and the list’s parts">
          <ControlsSection />
        </Section>

        <Section id="overlays" over="7 · Overlays" title="Dialogs, sheets, menus, tooltips and toasts — coming and going">
          <OverlaysSection />
        </Section>

        <Section id="forms" over="8 · Forms" title="Fields, select, combobox, dates, choices, tabs, avatars and keys">
          <FormsSection />
        </Section>

        <Section id="data" over="9 · Data display" title="Stat tiles, the header card, the timeline, charts and the drawings">
          <DataSection />
        </Section>
      </div>
      <Probes />
    </div>
  );
}
