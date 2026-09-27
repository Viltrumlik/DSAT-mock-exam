/**
 * The teacher kit's modal, and the four things it used to get wrong.
 *
 * WHAT THESE TESTS CANNOT SEE, stated plainly so nobody reads more into a green run than is
 * there: jsdom computes no layout and no stacking contexts. It will happily report a
 * `position: fixed` overlay behaving perfectly while it sits inside a transformed ancestor —
 * the exact bug the portal exists to prevent. So "it portals" below proves the MECHANISM (the
 * overlay hangs off `<body>`, under a node carrying the `.dzboard` token scope), never the
 * visual outcome. Whether the modal is actually anchored to the viewport, and actually
 * coloured, is a browser's answer, and only a browser's.
 *
 * Focus is the other half, and that jsdom does model honestly: `focus()` moves
 * `document.activeElement`, so who holds focus, and where it goes back to, is real here.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, type DialogSize } from "../ui";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

const panel = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const backdrop = () => document.querySelector('[role="presentation"]') as HTMLElement;
const buttons = () => [...panel()!.querySelectorAll("button")] as HTMLButtonElement[];

function press(el: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(event); });
  return event;
}

function mouse(el: EventTarget, type: "mousedown" | "click") {
  act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })); });
}

describe("where the dialog is mounted", () => {
  it("portals onto <body> instead of rendering where it was opened from", () => {
    render(<Dialog open title="Remove Dilnoza from Math Junior 3?" onClose={vi.fn()} />);

    // Nothing of it is inside the tree that mounted it — therefore nothing of it is inside
    // whatever transformed card that tree happens to be sitting in.
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.contains(panel())).toBe(false);
    expect(panel()).not.toBeNull();
  });

  it("carries the .dzboard token scope onto the portal root, off <body>", () => {
    render(<Dialog open title="Remove Dilnoza from Math Junior 3?" onClose={vi.fn()} />);

    // Without this the portal leaves the scope behind and every var(--dz-*) below falls back
    // to nothing: the modal renders colourless, in the wrong typeface.
    const scope = panel()!.closest(".dzboard");
    expect(scope).not.toBeNull();
    expect(scope!.parentElement).toBe(document.body);
  });

  it("renders nothing at all while closed", () => {
    render(<Dialog open={false} title="Remove Dilnoza from Math Junior 3?" onClose={vi.fn()} />);
    expect(panel()).toBeNull();
  });
});

describe("what a screen reader is told", () => {
  it("is named by the heading itself, and described by the line under it", () => {
    render(
      <Dialog
        open
        title="Remove Dilnoza from Math Junior 3?"
        description="Her work stays; only the place in this class goes."
        onClose={vi.fn()}
      />,
    );

    expect(panel()!.getAttribute("aria-modal")).toBe("true");
    const named = document.getElementById(panel()!.getAttribute("aria-labelledby")!);
    expect(named?.tagName).toBe("H2");
    expect(named?.textContent).toBe("Remove Dilnoza from Math Junior 3?");
    const described = document.getElementById(panel()!.getAttribute("aria-describedby")!);
    expect(described?.textContent).toBe("Her work stays; only the place in this class goes.");
  });

  it("claims no description when there is none to point at", () => {
    render(<Dialog open title="Remove Dilnoza from Math Junior 3?" onClose={vi.fn()} />);
    expect(panel()!.getAttribute("aria-describedby")).toBeNull();
  });
});

describe("focus", () => {
  function Harness({ open }: { open: boolean }) {
    return (
      <>
        <button type="button">Remove student</button>
        <Dialog open={open} title="Remove Dilnoza?" confirmLabel="Remove" tone="danger" onConfirm={vi.fn()} onClose={vi.fn()} />
      </>
    );
  }

  it("moves into the dialog on open — onto the panel, not onto the destructive button", () => {
    render(<Harness open={false} />);
    const opener = host.querySelector("button")!;
    act(() => opener.focus());

    render(<Harness open />);

    expect(panel()!.contains(document.activeElement)).toBe(true);
    // The panel itself: a stray Enter on arrival must not be able to fire Remove.
    expect(document.activeElement).toBe(panel());
    expect(panel()!.getAttribute("tabindex")).toBe("-1");
  });

  it("goes back where it came from when the dialog closes", () => {
    render(<Harness open={false} />);
    const opener = host.querySelector("button")!;
    act(() => opener.focus());
    render(<Harness open />);
    expect(document.activeElement).not.toBe(opener);

    render(<Harness open={false} />);

    // Otherwise a keyboard user is dropped at the top of the document and has to walk the
    // whole page back to the row they opened this from.
    expect(document.activeElement).toBe(opener);
  });

  it("cannot be tabbed out of: Tab wraps at the last stop, Shift+Tab at the first", () => {
    render(<Dialog open title="Remove Dilnoza?" confirmLabel="Remove" tone="danger" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const [cancel, remove] = buttons();

    // From the panel, Tab enters the ring at the first control rather than leaving for the page.
    const entering = press(panel()!, "Tab");
    expect(entering.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    act(() => remove.focus());
    const wrapping = press(remove, "Tab");
    expect(wrapping.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);

    act(() => cancel.focus());
    const backwards = press(cancel, "Tab", { shiftKey: true });
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(remove);
  });

  it("holds focus even mid-request, when both buttons are disabled and there is nothing to land on", () => {
    render(<Dialog open busy title="Removing Dilnoza…" confirmLabel="Remove" onConfirm={vi.fn()} onClose={vi.fn()} />);

    const trapped = press(panel()!, "Tab");
    expect(trapped.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(panel());
  });
});

describe("closing, and the ways it must not happen", () => {
  it("Escape closes, and never confirms", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Dialog open title="Remove Dilnoza?" confirmLabel="Remove" tone="danger" onConfirm={onConfirm} onClose={onClose} />);

    press(panel()!, "Escape");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a press that starts and ends on the backdrop closes", () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<Dialog open title="Remove Dilnoza?" onConfirm={onConfirm} onClose={onClose} />);

    mouse(backdrop(), "mousedown");
    mouse(backdrop(), "click");

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a drag that starts INSIDE and ends on the backdrop does not close", () => {
    const onClose = vi.fn();
    render(
      <Dialog
        open
        title="Remove Dilnoza?"
        description="Her work stays; only the place in this class goes."
        onClose={onClose}
      />,
    );

    // Selecting the description and letting go a few pixels outside. The browser fires the
    // click on the common ancestor of press and release — the backdrop — which used to throw
    // away whatever the teacher was doing.
    const description = panel()!.querySelector("p")!;
    mouse(description, "mousedown");
    mouse(backdrop(), "click");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("busy suppresses Escape, the backdrop and Cancel alike", () => {
    const onClose = vi.fn();
    render(<Dialog open busy title="Removing Dilnoza…" confirmLabel="Remove" onConfirm={vi.fn()} onClose={onClose} />);

    press(panel()!, "Escape");
    mouse(backdrop(), "mousedown");
    mouse(backdrop(), "click");
    expect(onClose).not.toHaveBeenCalled();

    const [cancel, remove] = buttons();
    expect(cancel.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    mouse(cancel, "click");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("size", () => {
  it("defaults to the one-decision width, so no caller that never asked moves", () => {
    render(<Dialog open title="Remove Dilnoza?" onClose={vi.fn()} />);
    expect(panel()!.style.maxWidth).toBe("440px");
  });

  it("gives each named size its own width", () => {
    const widths: Array<[DialogSize, string]> = [
      ["sm", "360px"],
      ["md", "440px"],
      ["lg", "680px"],
      ["xl", "1040px"],
    ];
    for (const [size, width] of widths) {
      render(<Dialog open size={size} title="Remove Dilnoza?" onClose={vi.fn()} />);
      expect(panel()!.style.maxWidth).toBe(width);
    }
  });
});
