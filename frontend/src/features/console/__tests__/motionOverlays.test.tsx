/**
 * PR 7 (design handoff v0.3, Overlays + Motion boards): overlays leave the way they came, the dialog
 * says what will happen and shakes when it fails, the toast counts Undo down and pauses, buttons
 * show progress, tooltips name icon buttons, menus move by keyboard, ticks and snowflakes move only
 * when something changes in front of you, and `?` lists the shortcuts.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShortcutsDialog } from "../ShortcutsDialog";
import { Toaster, toast } from "../toast";
import { Button, ConfirmDialog, Menu, Tooltip, usePresence } from "../ui";
import { StatusPill } from "@/features/ops/sms/look";

let host: HTMLDivElement;
let root: Root;
const render = (node: React.ReactNode) => act(() => root.render(node));
const q = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector<T>(sel);
const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("element not found");
  act(() => (el as HTMLElement).click());
};
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** A browser that animates: matchMedia exists and reduced motion is off. */
function fullMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => toast.dismiss());
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePresence", () => {
  function Probe({ open }: { open: boolean }) {
    const { mounted, closing } = usePresence(open);
    return mounted ? <span data-probe={closing ? "closing" : "open"} /> : null;
  }

  it("keeps a closing overlay for its exit, then lets it go", () => {
    fullMotion();
    render(<Probe open />);
    expect(q("[data-probe]")?.dataset.probe).toBe("open");
    render(<Probe open={false} />);
    expect(q("[data-probe]")?.dataset.probe).toBe("closing");
    tick(159);
    expect(q("[data-probe]")).not.toBeNull();
    tick(1);
    expect(q("[data-probe]")).toBeNull();
  });

  it("leaves at once under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    render(<Probe open />);
    render(<Probe open={false} />);
    expect(q("[data-probe]")).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  function Harness({ onConfirm, typeToConfirm }: { onConfirm: () => Promise<void>; typeToConfirm?: string }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <span data-open={open ? "yes" : "no"} />
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          title="Delete Bekzod's account?"
          icon="trash"
          tone="critical"
          confirmLabel="Delete account"
          busyLabel="Deleting…"
          doneLabel="Deleted"
          typeToConfirm={typeToConfirm}
          onConfirm={onConfirm}
        >
          <p>This cannot be undone.</p>
        </ConfirmDialog>
      </>
    );
  }
  const confirmButton = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.includes("Delet"))!;

  it("asks with the name, and waits for DELETE to be typed", () => {
    render(<Harness onConfirm={() => Promise.resolve()} typeToConfirm="DELETE" />);
    const dialog = q('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Delete Bekzod's account?");
    expect(confirmButton().disabled).toBe(true);
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "delete");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirmButton().disabled).toBe(false);
  });

  it("shows its progress, says it is done, then closes", async () => {
    let finish!: () => void;
    render(<Harness onConfirm={() => new Promise<void>((r) => (finish = r))} />);
    click(confirmButton());
    expect(confirmButton().getAttribute("aria-busy")).toBe("true");
    expect(confirmButton().textContent).toBe("Deleting…");
    // Busy: Escape does not close it halfway.
    act(() => q('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("[data-open]")?.dataset.open).toBe("yes");
    await act(async () => finish());
    expect(confirmButton().textContent).toBe("Deleted");
    expect(confirmButton().className).toContain("bg-ms-positive");
    tick(650);
    expect(q("[data-open]")?.dataset.open).toBe("no");
  });

  it("shakes and says why when it fails, and stays open", async () => {
    render(<Harness onConfirm={() => Promise.reject(new Error("Eskiz has no balance left."))} />);
    await act(async () => confirmButton().click());
    expect(q('[role="dialog"] [role="alert"]')?.textContent).toContain("Eskiz has no balance left.");
    expect(q('[role="dialog"] .animate-ms-shake')).not.toBeNull();
    expect(q("[data-open]")?.dataset.open).toBe("yes");
    expect(confirmButton().textContent).toBe("Delete account");
  });

  it("closes on Escape when nothing is running", () => {
    render(<Harness onConfirm={() => Promise.resolve()} />);
    act(() => q('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("[data-open]")?.dataset.open).toBe("no");
  });
});

describe("toast", () => {
  it("shows one at a time: the newest replaces the older", () => {
    render(<Toaster />);
    act(() => void toast.show({ message: "First" }));
    act(() => void toast.show({ message: "Second" }));
    const shown = [...document.body.querySelectorAll('[role="status"]')].map((t) => t.textContent);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("Second");
  });

  it("leaves after 5 s; an error stays until dismissed", () => {
    render(<Toaster />);
    act(() => void toast.show({ message: "Saved" }));
    tick(4999);
    expect(q('[role="status"]')).not.toBeNull();
    tick(1);
    expect(q('[role="status"]')).toBeNull();
    act(() => void toast.show({ tone: "error", message: "Couldn’t save" }));
    tick(60_000);
    expect(q('[role="alert"]')?.textContent).toContain("Couldn’t save");
    click(q('button[aria-label="Dismiss"]'));
    expect(q('[role="alert"]')).toBeNull();
  });

  it("counts Undo down for 8 s, pauses while the pointer is on it, and undoes", async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => void toast.show({ message: "Cleared 2 filters", undo }));
    const box = q('[role="status"]')!;
    expect(box.querySelector(".animate-ms-countdown")).not.toBeNull();
    tick(4000);
    act(() => box.dispatchEvent(new Event("pointerover", { bubbles: true })));
    act(() => {
      // React listens for pointerenter through pointerover/pointerout pairs.
      box.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: document.body }));
    });
    tick(10_000);
    expect(q('[role="status"]')).not.toBeNull();
    const undoButton = [...box.querySelectorAll("button")].find((b) => b.textContent?.includes("Undo"))!;
    await act(async () => undoButton.click());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(q('[role="status"]')).toBeNull();
  });
});

describe("Button progress and tooltips", () => {
  it("ignores clicks while busy or done, without turning grey", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" state="busy" busyLabel="Freezing…" onClick={onClick}>
        Freeze 2
      </Button>,
    );
    const b = q<HTMLButtonElement>("button")!;
    expect(b.textContent).toBe("Freezing…");
    expect(b.disabled).toBe(false);
    click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("names an icon-only button in a tooltip after 400 ms, with its shortcut", () => {
    render(<Button icon="columns" aria-label="Choose columns" shortcut="C" />);
    const wrap = q("button")!.parentElement!;
    act(() => wrap.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    tick(399);
    expect(q("[data-tooltip]")).toBeNull();
    tick(1);
    expect(q("[data-tooltip]")?.textContent).toBe("Choose columnsC");
    act(() => wrap.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(q("[data-tooltip]")).toBeNull();
  });

  it("a Tooltip says nothing to screen readers: the button's name does", () => {
    render(
      <Tooltip label="Collapse">
        <button type="button" aria-label="Collapse" />
      </Tooltip>,
    );
    act(() => q("button")!.parentElement!.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
    tick(400);
    expect(q("[data-tooltip]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Menu", () => {
  it("opens on its first item, moves by arrows, says why an item is off, and closes on Escape", () => {
    const send = vi.fn();
    const move = vi.fn();
    render(
      <Menu
        label="Actions for Bekzod"
        items={[
          { label: "Send SMS", icon: "msg", shortcut: "S", onSelect: send },
          { label: "Move to another class", disabledReason: "lc-up runs this class", onSelect: move },
          { label: "Delete account…", danger: true },
        ]}
      />,
    );
    const trigger = q<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    click(trigger);
    const items = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    expect(items[1].textContent).toContain("lc-up runs this class");
    act(() => q('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    // The disabled item is skipped.
    expect(document.activeElement).toBe(items[2]);
    click(items[1]);
    expect(move).not.toHaveBeenCalled();
    act(() => q('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("delivery ticks", () => {
  const msg = (status: string) => ({ status, eskiz_status: "", error: "", attempts: 1, checked_at: null }) as never;

  it("draws one tick for sent and two for delivered, and slides the second in only on a change", () => {
    render(<StatusPill message={msg("DELIVERED")} />);
    expect(q("[data-ticks]")?.dataset.ticks).toBe("2");
    expect(q(".animate-ms-tick-in")).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    render(<StatusPill message={msg("SENT")} />);
    expect(q("[data-ticks]")?.dataset.ticks).toBe("1");
    render(<StatusPill message={msg("DELIVERED")} />);
    expect(q("[data-ticks]")?.dataset.ticks).toBe("2");
    expect(q(".animate-ms-tick-in")).not.toBeNull();
  });
});

describe("shortcuts", () => {
  it("opens with “?”, but not while typing in a field", () => {
    render(
      <>
        <input aria-label="field" />
        <ShortcutsDialog />
      </>,
    );
    const input = q<HTMLInputElement>('input[aria-label="field"]')!;
    input.focus();
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })));
    expect(q('[role="dialog"]')).toBeNull();
    input.blur();
    act(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })));
    expect(q('[role="dialog"]')?.textContent).toContain("Keyboard shortcuts");
  });
});
