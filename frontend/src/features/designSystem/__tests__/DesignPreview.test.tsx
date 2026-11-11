/**
 * /ops/design — the living preview of the console redesign's foundation: tokens, type, shape,
 * icons and motion, rendered with the real classes. jsdom does not cascade the stylesheet, so
 * these check what is on the page and how it behaves; colours, radii and timings are measured
 * in Chromium (the PR's Playwright pass).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DesignPreview from "../DesignPreview";
import { COLOUR_GROUPS } from "../tokenList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<DesignPreview />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("DesignPreview", () => {
  it("shows a tile for each of the 111 icons with its name", () => {
    const tiles = host.querySelectorAll("[data-icon-tile]");
    expect(tiles).toHaveLength(111);
    expect(host.textContent).toContain("ms-freeze");
    expect(host.textContent).toContain("wifi-off");
  });

  it("replays a motion demo", async () => {
    const tile = host.querySelector('[data-motion="fade-in"]') as HTMLElement;
    expect(tile).not.toBeNull();
    const before = tile.querySelector("[data-demo]");
    const replay = [...tile.querySelectorAll("button")].find((b) => b.textContent === "Replay");
    expect(replay).toBeDefined();
    await act(async () => replay!.click());
    const after = tile.querySelector("[data-demo]");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("puts a probe in a portal on <body> and one in the page, to compare their tokens", () => {
    const portal = document.body.querySelector('[data-testid="portal-probe"]');
    expect(portal).not.toBeNull();
    expect(host.contains(portal)).toBe(false);
    expect(host.querySelector('[data-testid="tree-probe"]')).not.toBeNull();
  });

  it("lays every colour token out as a swatch", () => {
    expect(host.querySelectorAll("[data-swatch]")).toHaveLength(COLOUR_GROUPS.flatMap((g) => g.names).length);
  });

  it("is set in the console surface, not the page's reading serif", () => {
    expect(host.firstElementChild?.classList.contains("ms")).toBe(true);
  });
});
