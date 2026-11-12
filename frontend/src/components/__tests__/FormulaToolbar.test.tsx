/**
 * FormulaToolbar (PR 24: the console look is the only one): the quick row and the groups insert their snippet with
 * the cursor offset, a group tab is pressed when open, and the buttons wear the console's tokens, not the old ones.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/MathText", () => ({
  MathText: ({ text, className }: { text: string; className?: string }) => <span className={className}>{text}</span>,
}));

const { FormulaToolbar } = await import("../FormulaToolbar");

let host: HTMLElement;
let root: Root;
const onInsert = vi.fn();

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onInsert.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<FormulaToolbar onInsert={onInsert} />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));

describe("FormulaToolbar", () => {
  it("inserts a quick symbol with its cursor offset", async () => {
    expect(host.textContent).toContain("Quick");
    const quick = host.querySelector<HTMLButtonElement>("button[aria-label]")!;
    await act(async () => quick.click());
    expect(onInsert).toHaveBeenCalledTimes(1);
    const [snippet, cursor] = onInsert.mock.calls[0];
    expect(typeof snippet).toBe("string");
    expect(snippet.length).toBeGreaterThan(0);
    expect(cursor).toBeGreaterThanOrEqual(0);
    expect(cursor).toBeLessThanOrEqual(snippet.length);
  });

  it("opens a group and inserts from it", async () => {
    expect(tabs()[0].getAttribute("aria-pressed")).toBe("true");
    const second = tabs()[1];
    await act(async () => second.click());
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(tabs()[0].getAttribute("aria-pressed")).toBe("false");
    const gridButtons = host.querySelectorAll<HTMLButtonElement>(".flex.flex-wrap.gap-1 > button");
    expect(gridButtons.length).toBeGreaterThan(0);
    await act(async () => gridButtons[0].click());
    expect(onInsert).toHaveBeenCalledTimes(1);
  });

  it("wears the console's tokens only", () => {
    const html = host.innerHTML;
    expect(html).toContain("bg-ms-card");
    expect(html).toContain("bg-ms-primary-soft");
    for (const old of ["bg-card ", "border-border", "text-muted-foreground", "bg-surface-2", "text-primary-foreground"]) {
      expect(html).not.toContain(old);
    }
  });
});
