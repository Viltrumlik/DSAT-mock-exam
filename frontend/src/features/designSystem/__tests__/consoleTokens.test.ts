/**
 * The console redesign's tokens (design handoff v0.3, `ui-redesign-kit/design-handoff/console.css`)
 * live in their own section of globals.css under an `--ms-` prefix. Fifteen of the design's bare
 * names (`--bg`, `--card`, `--primary`, …) are already the student app's tokens, so the prefix is
 * what keeps every existing page exactly as it was until a console component reads the new ones.
 *
 * The contrast pairs are the ones the design's Tokens board checked against WCAG 2.2 AA. They are
 * owner-approved values: a failing pair is reported, never quietly retuned.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONSOLE_TOKENS_END,
  CONSOLE_TOKENS_START,
  contrastRatio,
  readConsoleTokens,
} from "../contrast";
import { COLOUR_GROUPS, CONTRAST_PAIRS } from "../tokenList";

const css = fs.readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

function section(): string {
  const start = css.indexOf(CONSOLE_TOKENS_START);
  const end = css.indexOf(CONSOLE_TOKENS_END);
  expect(start, "console token section start marker").toBeGreaterThan(-1);
  expect(end, "console token section end marker").toBeGreaterThan(start);
  return css.slice(start, end);
}

/** Tokens that are the same in both themes: type, shape, size, motion and layout frames. */
// `rail` is the rail's width; `rail-bg`, `rail-fg`… are its colours, themed like any other.
const UNTHEMED = /^--ms-(font-|r-|h-|fs-|dur-|ease-|subnav|rail$|topbar|filter-col|sheet|content-max)/;
const isColour = (name: string) => !UNTHEMED.test(name) && !name.startsWith("--ms-sh-");

describe("contrastRatio", () => {
  it("is 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("gives white on the brand blue about 5.5:1", () => {
    expect(contrastRatio("#ffffff", "#2a68c0")).toBeGreaterThan(5.4);
    expect(contrastRatio("#ffffff", "#2a68c0")).toBeLessThan(5.6);
  });

  it("composites a translucent background over what is under it before measuring", () => {
    const overWhite = contrastRatio("#047857", "rgba(5,150,105,.10)", "#ffffff");
    const overBlack = contrastRatio("#047857", "rgba(5,150,105,.10)", "#000000");
    expect(overWhite).toBeGreaterThan(4.5);
    expect(overBlack).toBeLessThan(overWhite);
  });
});

describe("console tokens in globals.css", () => {
  it("only declares --ms- names in the console section", () => {
    const body = section();
    const themeStart = body.indexOf("\n@theme inline {");
    expect(themeStart).toBeGreaterThan(-1);
    const themeEnd = body.indexOf("\n}", themeStart);
    const themeBlock = body.slice(themeStart, themeEnd);
    const rest = body.slice(0, themeStart) + body.slice(themeEnd);

    const declared = [...rest.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(80);
    for (const name of declared) expect(name).toMatch(/^--ms-/);

    const themeKeys = [...themeBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
    expect(themeKeys.length).toBeGreaterThan(80);
    for (const name of themeKeys) {
      expect(name).toMatch(/^--(color|radius|shadow|font|text|ease|animate)-ms-/);
    }
  });

  it("gives every light colour and shadow a dark twin", () => {
    const { light, dark } = readConsoleTokens(css);
    const themed = Object.keys(light).filter((n) => !UNTHEMED.test(n)).sort();
    expect(themed.length).toBeGreaterThan(70);
    expect(Object.keys(dark).sort()).toEqual(themed);
  });

  it("lists every colour token in the preview's groups, and nothing else", () => {
    const { light } = readConsoleTokens(css);
    const tokens = Object.keys(light).filter(isColour).map((n) => n.replace(/^--ms-/, "")).sort();
    expect(COLOUR_GROUPS.flatMap((g) => g.names).sort()).toEqual(tokens);
  });

  it("exposes a Tailwind colour for every colour token", () => {
    const body = section();
    const { light } = readConsoleTokens(css);
    for (const name of Object.keys(light).filter(isColour)) {
      const key = name.replace(/^--ms-/, "");
      expect(body).toContain(`--color-ms-${key}: var(${name});`);
    }
  });

  it.each(CONTRAST_PAIRS)("%s on %s is at least %s:1 in light and dark", (fg, bg, min) => {
    const { light, dark } = readConsoleTokens(css);
    for (const [theme, tokens] of [["light", light], ["dark", dark]] as const) {
      const value = (n: string) => (n.startsWith("#") ? n : tokens[`--ms-${n}`]);
      expect(value(fg), `${theme} --ms-${fg}`).toBeTruthy();
      expect(value(bg), `${theme} --ms-${bg}`).toBeTruthy();
      const ratio = contrastRatio(value(fg), value(bg), tokens["--ms-card"]);
      expect(ratio, `${theme}: ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    }
  });
});
