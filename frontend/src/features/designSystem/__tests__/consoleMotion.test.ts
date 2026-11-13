/**
 * The console redesign's motion (design handoff v0.3, Motion board): one-shot versions of the
 * board's looping tiles, as Tailwind classes, so no component writes its own @keyframes.
 *
 * Two rules here are traps this codebase has already fallen into:
 *   - an entrance with `animation-fill-mode: both|forwards` keeps its closing frame applied for
 *     the life of the page, which silently kills every :hover transform on the element (the
 *     `.cr-card` lift that never moved). Entrances use `backwards`; only exits hold their end.
 *   - keyframes animate the individual `translate` / `scale` / `rotate` properties, never
 *     `transform`, so they compose with Tailwind's own translate/scale utilities.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CONSOLE_TOKENS_END, CONSOLE_TOKENS_START } from "../contrast";

const css = fs.readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
const section = css.slice(css.indexOf(CONSOLE_TOKENS_START), css.indexOf(CONSOLE_TOKENS_END));

/** `--animate-ms-<name>: <value>;` from the theme. */
const themed = Object.fromEntries(
  [...section.matchAll(/--animate-ms-([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
);
/** `@utility animate-ms-<name> { … animation: <value>; }` — the three that also set a dasharray or gradient. */
const utilities = Object.fromEntries(
  [...section.matchAll(/@utility animate-ms-([a-z0-9-]+)\s*\{([^}]*)\}/g)].map((m) => [
    m[1],
    (m[2].match(/animation:\s*([^;]+);/) ?? [, ""])[1].trim(),
  ]),
);
const all: Record<string, string> = { ...themed, ...utilities };
const keyframes = [...section.matchAll(/@keyframes (ms-[a-z0-9-]+)\s*\{/g)].map((m) => m[1]);

const isExit = (name: string) => /-out(-|$)/.test(name);
const isLoop = (value: string) => /\binfinite\b/.test(value);

const ENTRANCES = [
  "fade-in", "check-pop", "check-draw", "rise-in", "sheet-in-bottom", "sheet-in-right",
  "dialog-in", "scrim-in", "roll-in", "snow-in", "tick-in", "card-in", "wipe-in",
  // The drag lift (PR 14a): the picked-up row grows into its own scale and shadow.
  "lift",
  // The tablet's sub-category sheet comes out of the rail (Shell v0.4, PR 25).
  "sheet-in-left",
];
const EXITS = ["fade-out", "sink-out", "sheet-out-bottom", "sheet-out-right", "sheet-out-left", "dialog-out", "scrim-out", "roll-out"];
const LOOPS = ["shimmer", "spin", "pulse", "ring-turn"];
const ONCE = ["pop", "shake", "flash", "burst", "countdown"];

describe("console motion", () => {
  it("has every animation the Motion board shows", () => {
    expect(Object.keys(all).sort()).toEqual([...ENTRANCES, ...EXITS, ...LOOPS, ...ONCE].sort());
  });

  it.each(ENTRANCES)("%s holds only its opening frame (backwards), never its closing one", (name) => {
    expect(all[name]).toMatch(/\bbackwards\b/);
    expect(all[name]).not.toMatch(/\b(both|forwards)\b/);
  });

  it.each(EXITS)("%s ends hidden (forwards) until the element is removed", (name) => {
    expect(isExit(name)).toBe(true);
    expect(all[name]).toMatch(/\bforwards\b/);
  });

  it("never holds a closing frame on anything that stays on screen", () => {
    for (const [name, value] of Object.entries(all)) {
      if (isExit(name) || name === "burst" || name === "countdown") continue;
      expect(value, name).not.toMatch(/\b(both|forwards)\b/);
    }
  });

  it.each(LOOPS)("%s loops", (name) => {
    expect(isLoop(all[name])).toBe(true);
  });

  it("gives every animation its keyframes, and leaves no keyframes unused", () => {
    const used = Object.values(all).map((v) => v.split(/\s+/)[0]);
    for (const name of used) expect(keyframes).toContain(name);
    for (const name of keyframes) expect(used).toContain(name);
  });

  it("never animates transform", () => {
    for (const m of section.matchAll(/@keyframes (ms-[a-z0-9-]+)\s*\{([\s\S]*?)\n\s{0,2}\}/g)) {
      expect(m[2], m[1]).not.toMatch(/\btransform\s*:/);
    }
  });

  it("collapses every animation to its end state under reduced motion, except the Undo clock", () => {
    const media = section.slice(section.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(media.length).toBeGreaterThan(0);
    expect(media).toMatch(/\[class\*="animate-ms-"\]:not\(\.animate-ms-countdown\)\s*\{[^}]*animation-duration:\s*1ms !important;/);
    expect(media).toMatch(/animation-iteration-count:\s*1 !important;/);
    // globals.css already has `* { animation-duration: 0.001ms !important }` for reduced motion;
    // the clock has to win against it too, with its own !important on a class selector.
    expect(media).toMatch(/\.animate-ms-countdown\s*\{\s*animation-duration:\s*var\(--ms-undo, 8s\) !important;/);
  });

  it.each(["ms-press", "ms-hover-lift", "ms-transition"])("defines the %s utility", (name) => {
    expect(section).toMatch(new RegExp(`@utility ${name}\\s*\\{`));
  });
});
