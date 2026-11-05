/**
 * A toast floats over the page, so the page must not show through it. `cn` does not merge Tailwind classes: a
 * see-through `bg-primary/5` beside `bg-card` beat it, and "Saved." read on top of whatever lay behind.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "../ToastProvider";

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<ToastProvider>page</ToastProvider>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a toast", () => {
  it.each(["neutral", "success", "error"])("of tone %s has a solid background", async (tone) => {
    await act(async () => {
      window.dispatchEvent(new CustomEvent("mastersat-toast", { detail: { tone, message: "Saved." } }));
    });
    const toast = Array.from(host.querySelectorAll("p")).find((p) => p.textContent === "Saved.")!.parentElement!;
    const backgrounds = Array.from(toast.classList).filter((name) => name.startsWith("bg-"));
    expect(backgrounds).toContain("bg-card");
    // A tint is an image laid over the card; a second background colour would fight it, and a see-through one lets the page in.
    expect(backgrounds.filter((name) => name !== "bg-card" && !name.startsWith("bg-[linear-gradient"))).toEqual([]);
  });
});
