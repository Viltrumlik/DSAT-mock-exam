/**
 * The runner's "More" menu, and specifically which papers may be LEFT.
 *
 * A midterm is one sitting. It cannot be paused, and leaving the screen is a proctoring
 * offence that auto-submits after three seconds — so a "Save & Exit" item there is a
 * friendly-looking button that ends the student's exam, which is the opposite of what it
 * says. Pastpapers genuinely resume, so they keep it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MoreMenu } from "../tools/MoreMenu";

type Props = React.ComponentProps<typeof MoreMenu>;

let container: HTMLDivElement;
let root: Root;

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    isFullscreen: false,
    onToggleFullscreen: vi.fn(),
    highlighterActive: false,
    onToggleHighlighter: vi.fn(),
    notesOpen: false,
    onToggleNotes: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onToggleHelp: vi.fn(),
    pauseAllowed: false,
    paused: false,
    onTogglePause: vi.fn(),
    saveExitAllowed: true,
    onSaveAndExit: vi.fn(),
    ...overrides,
  };
}

/** Mount the menu and open it, returning the item labels currently on screen. */
function openMenu(overrides: Partial<Props> = {}): { labels: string[]; props: Props } {
  const props = baseProps(overrides);
  act(() => {
    root.render(<MoreMenu {...props} />);
  });
  const trigger = Array.from(container.querySelectorAll("button")).find((b) =>
    /more/i.test(b.textContent ?? ""),
  );
  if (!trigger) throw new Error("More trigger not found");
  act(() => {
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return { labels: menuLabels(), props };
}

/** Labels of every item inside the open menu.
 *
 * Reads buttons within the `role="menu"` panel rather than `[role="menuitem"]`: only the
 * Save & Exit entry carries that role today, so querying by it would silently pass every
 * "the other tools are still there" assertion. */
function menuLabels(): string[] {
  const panel = container.querySelector('[role="menu"]');
  if (!panel) return [];
  return Array.from(panel.querySelectorAll("button")).map((el) => (el.textContent ?? "").trim());
}

const has = (labels: string[], re: RegExp) => labels.some((l) => re.test(l));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MoreMenu — Save & Exit", () => {
  it("is offered when the paper can genuinely be resumed", () => {
    const { labels } = openMenu({ saveExitAllowed: true });
    expect(has(labels, /save\s*&\s*exit/i)).toBe(true);
  });

  it("is NOT offered on a midterm", () => {
    const { labels } = openMenu({ saveExitAllowed: false });
    expect(has(labels, /save\s*&\s*exit/i)).toBe(false);
  });

  it("still calls back when it IS offered", () => {
    const onSaveAndExit = vi.fn();
    openMenu({ saveExitAllowed: true, onSaveAndExit });
    const panel = container.querySelector('[role="menu"]') as HTMLElement;
    const item = Array.from(panel.querySelectorAll("button")).find((el) =>
      /save\s*&\s*exit/i.test(el.textContent ?? ""),
    ) as HTMLElement;
    act(() => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSaveAndExit).toHaveBeenCalledTimes(1);
  });

  it("hiding it does not disturb the tools a midterm still needs", () => {
    const { labels } = openMenu({ saveExitAllowed: false });
    expect(has(labels, /full screen/i)).toBe(true);
    expect(has(labels, /highlighter/i)).toBe(true);
    expect(has(labels, /notes/i)).toBe(true);
    expect(has(labels, /zoom in/i)).toBe(true);
    expect(has(labels, /keyboard shortcuts/i)).toBe(true);
  });

  it("pause and save-exit are independent gates", () => {
    const pastpaper = openMenu({ pauseAllowed: true, saveExitAllowed: true });
    expect(has(pastpaper.labels, /pause/i)).toBe(true);
    expect(has(pastpaper.labels, /save\s*&\s*exit/i)).toBe(true);

    const midterm = openMenu({ pauseAllowed: false, saveExitAllowed: false });
    expect(has(midterm.labels, /pause/i)).toBe(false);
    expect(has(midterm.labels, /save\s*&\s*exit/i)).toBe(false);
  });
});
