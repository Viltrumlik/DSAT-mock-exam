/**
 * The colours this page puts text in, measured rather than eyeballed.
 *
 * Every flagged percentage and every tinted chip was under WCAG AA in the light theme while
 * the dark theme passed — the classic "only one theme was checked" miss. These tests do not
 * assert class names; they resolve the class to its Tailwind v4 oklch value, composite the
 * 10% tint over the card the chip actually sits on, and compute the real ratio. Swap
 * `text-sky-700` back to `text-sky-600` and the arithmetic fails, not a string comparison.
 *
 * 4.5:1 is the bar because every one of these is 12–14px text, which AA does not treat as
 * large.
 */
import { describe, expect, it } from "vitest";
import { TAG_TONES, type TagTone } from "../components/Tag";
import { FLAGGED_RATE_CLASS } from "../components/Rate";

/** `--card` in each theme, from `app/globals.css` (`--surface`). */
const CARD = { light: "#f8fafc", dark: "#111827" } as const;
type Theme = keyof typeof CARD;

/** Tailwind v4 palette entries this page uses, as published oklch triples. */
const PALETTE: Record<string, [number, number, number]> = {
  "rose-300": [0.81, 0.117, 11.638],
  "rose-500": [0.645, 0.246, 16.439],
  "rose-600": [0.586, 0.253, 17.585],
  "rose-700": [0.514, 0.222, 16.935],
  "sky-300": [0.828, 0.111, 230.318],
  "sky-500": [0.685, 0.169, 237.323],
  "sky-600": [0.588, 0.158, 241.966],
  "sky-700": [0.5, 0.134, 242.749],
  "amber-300": [0.879, 0.169, 91.605],
  "amber-500": [0.769, 0.188, 70.08],
  "amber-600": [0.666, 0.179, 58.318],
  "amber-800": [0.473, 0.137, 46.201],
};

type Rgb = [number, number, number];

function oklchToSrgb(L: number, C: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((u) => {
    const enc = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.max(u, 0) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, enc));
  }) as Rgb;
}

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
}

/** What the browser does for a `/10` utility: source-over in sRGB. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function shade(name: string): Rgb {
  const entry = PALETTE[name];
  if (!entry) {
    throw new Error(
      `No measured value for "${name}". Add its oklch triple to PALETTE so its contrast is checked, rather than dropping the check.`,
    );
  }
  return oklchToSrgb(...entry);
}

/** `text-sky-700` / `dark:text-sky-300` → the shade this theme actually paints. */
function inkFor(classes: string, theme: Theme): Rgb {
  const tokens = classes.split(/\s+/).filter(Boolean);
  const dark = tokens.find((t) => t.startsWith("dark:text-"))?.slice("dark:text-".length);
  const light = tokens.find((t) => t.startsWith("text-"))?.slice("text-".length);
  const picked = theme === "dark" ? (dark ?? light) : light;
  if (!picked) throw new Error(`No text colour in "${classes}"`);
  return shade(picked);
}

/** `bg-sky-500/10` composited over the card, or the bare card when there is no tint. */
function surfaceFor(classes: string, theme: Theme): Rgb {
  const card = hexToRgb(CARD[theme]);
  const tint = classes.split(/\s+/).find((t) => /^bg-[a-z]+-\d+\/\d+$/.test(t));
  if (!tint) return card;
  const [, name, alpha] = /^bg-([a-z]+-\d+)\/(\d+)$/.exec(tint)!;
  return composite(shade(name), Number(alpha) / 100, card);
}

const AA = 4.5;

describe("Tag tones", () => {
  const tones: TagTone[] = ["info", "warning", "danger"];

  for (const tone of tones) {
    for (const theme of ["light", "dark"] as Theme[]) {
      it(`tone="${tone}" clears AA in ${theme}`, () => {
        const classes = TAG_TONES[tone];
        const ratio = contrast(inkFor(classes, theme), surfaceFor(classes, theme));
        expect(ratio).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it("proves the check is real: the tones these replaced actually fail it", () => {
    // The shipped values were `text-sky-600` / `text-rose-600` / `text-amber-600`, and the
    // light theme is where they fell down. If this ever passes, the maths above has stopped
    // measuring anything.
    const failing = [
      "bg-sky-500/10 text-sky-600",
      "bg-rose-500/10 text-rose-600",
      "bg-amber-500/10 text-amber-600",
    ];
    for (const classes of failing) {
      expect(contrast(inkFor(classes, "light"), surfaceFor(classes, "light"))).toBeLessThan(AA);
    }
  });
});

describe("flagged percentage", () => {
  it("clears AA on the card in both themes", () => {
    for (const theme of ["light", "dark"] as Theme[]) {
      const ratio = contrast(inkFor(FLAGGED_RATE_CLASS, theme), hexToRgb(CARD[theme]));
      expect(ratio).toBeGreaterThanOrEqual(AA);
    }
  });

  it("proves the check is real: rose-600 fails on the light card", () => {
    expect(contrast(shade("rose-600"), hexToRgb(CARD.light))).toBeLessThan(AA);
  });
});
