/**
 * ⌘K (design handoff v0.3, Overlays board and Main · E, layer 3): every page this person may open,
 * and a few actions, one keystroke away. It is built from the menu the person already sees, so a
 * page hidden from a role's menu is never one search away.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }) }));

const { CommandPalette } = await import("../CommandPalette");
const { consoleCommands } = await import("../commands");
const { OPS_NAV_GROUPS, visibleNav } = await import("@/features/ops/shell/opsNav");

type Cmd = ReturnType<typeof consoleCommands>[number];
const SUPER_ADMIN = { role: "super_admin", permissions: ["*"] };
const ADMIN = { role: "admin", permissions: [] };

let host: HTMLDivElement;
let root: Root;

function Harness({ commands }: { commands: Cmd[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button">before</button>
      <CommandPalette open={open} onOpenChange={setOpen} commands={commands} />
    </>
  );
}

function render(commands: Cmd[]) {
  act(() => root.render(<Harness commands={commands} />));
}

const key = (init: KeyboardEventInit, target: EventTarget = document) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const combobox = () => document.body.querySelector<HTMLInputElement>('[role="combobox"]');
const options = () => [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
function type(text: string) {
  const input = combobox()!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("CommandPalette", () => {
  it("opens with ⌘K and with Ctrl+K, and closes with Escape", () => {
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN)));
    expect(combobox()).toBeNull();
    key({ key: "k", metaKey: true });
    expect(combobox()).not.toBeNull();
    key({ key: "Escape" }, combobox()!);
    expect(combobox()).toBeNull();
    key({ key: "k", ctrlKey: true });
    expect(combobox()).not.toBeNull();
  });

  it("is a combobox driving a listbox", () => {
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN)));
    key({ key: "k", metaKey: true });
    const input = combobox()!;
    const listId = input.getAttribute("aria-controls")!;
    expect(document.getElementById(listId)?.getAttribute("role")).toBe("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const active = input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(active)?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(input);
  });

  it("filters by name, ignoring case, accents, apostrophes and punctuation", () => {
    const extra: Cmd = { id: "x", label: "Oʻquv markazi", group: "Actions", icon: "home", run: () => {} };
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN), [extra]));
    key({ key: "k", metaKey: true });
    type("lcup");
    expect(options().some((o) => o.includes("lc-up (CRM link)"))).toBe(true);
    expect(options().some((o) => o.includes("Students"))).toBe(false);
    type("o'quv");
    expect(options().some((o) => o.includes("Oʻquv markazi"))).toBe(true);
    type("SUPPORT hours");
    expect(options().some((o) => o.includes("Support hours"))).toBe(true);
  });

  it("says so when nothing matches, rather than showing an empty box", () => {
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN)));
    key({ key: "k", metaKey: true });
    type("zzzz");
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain("Nothing called “zzzz”");
  });

  it("moves with the arrows, goes with Enter, and gives focus back", () => {
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, SUPER_ADMIN)));
    const before = host.querySelector("button")!;
    act(() => before.focus());
    key({ key: "k", metaKey: true });
    type("s");
    const first = combobox()!.getAttribute("aria-activedescendant");
    key({ key: "ArrowDown" }, combobox()!);
    const second = combobox()!.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    const target = document.getElementById(second!)!.getAttribute("data-href");
    key({ key: "Enter" }, combobox()!);
    expect(push).toHaveBeenCalledWith(target);
    expect(combobox()).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("does not offer a desk admin the pages their menu hides", () => {
    render(consoleCommands(visibleNav(OPS_NAV_GROUPS, ADMIN)));
    key({ key: "k", metaKey: true });
    const all = options().join("|");
    expect(all).toContain("Students");
    expect(all).not.toContain("Broadcast");
    expect(all).not.toContain("Journals");
    expect(all).not.toContain("Midterm results");
  });

  it("runs an action and closes", () => {
    const run = vi.fn();
    render([{ id: "dark", label: "Dark theme", group: "Actions", icon: "moon", run }]);
    key({ key: "k", metaKey: true });
    key({ key: "Enter" }, combobox()!);
    expect(run).toHaveBeenCalledTimes(1);
    expect(combobox()).toBeNull();
  });
});
