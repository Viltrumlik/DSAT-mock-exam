/**
 * WCAG 2.2 contrast for the console design tokens (`--ms-*` in app/globals.css).
 *
 * The tokens are owner-approved values from the design handoff; this is how a test — and the
 * /ops/design preview — proves each text/background pair still clears AA after an edit.
 * Soft fills are translucent (`rgba(…, .14)` in the dark theme), so a background is composited
 * over the surface under it before the ratio is taken, the way the eye sees it.
 */

/** The globals.css section that holds the console tokens starts and ends with these comments. */
export const CONSOLE_TOKENS_START = "/* ── console tokens (--ms-*) · design handoff v0.3 ── */";
export const CONSOLE_TOKENS_END = "/* ── end console tokens ── */";

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(",").map((p) => p.trim());
    return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
  }
  throw new Error(`contrastRatio: cannot read colour "${input}"`);
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + under.r * (1 - a),
    g: top.g * a + under.g * (1 - a),
    b: top.b * a + under.b * (1 - a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast of `fg` on `bg`, 1–21. A translucent `bg` is laid over `under` (default white) first,
 * and a translucent `fg` over the resulting background.
 */
export function contrastRatio(fg: string, bg: string, under = "#ffffff"): number {
  const base = over(parseColor(bg), parseColor(under));
  const ink = over(parseColor(fg), base);
  const [hi, lo] = [luminance(ink), luminance(base)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--ms-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

function firstBlock(css: string, selector: string): string {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.[\]]/g, "\\$&")}\\s*\\{`));
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** The light (`:root`) and dark (`.dark`) `--ms-*` declarations of the console token section. */
export function readConsoleTokens(css: string): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const start = css.indexOf(CONSOLE_TOKENS_START);
  const end = css.indexOf(CONSOLE_TOKENS_END);
  if (start < 0 || end < start) return { light: {}, dark: {} };
  const body = css.slice(start, end);
  return { light: declarations(firstBlock(body, ":root")), dark: declarations(firstBlock(body, ".dark")) };
}
