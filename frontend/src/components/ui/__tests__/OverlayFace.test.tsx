/**
 * An overlay lands outside the class that set its page's typeface — dialogs and drawers portal onto
 * `<body>`, and the toast stack renders from the root layout, above every shell — and `<body>` is
 * Georgia. So every dialog, drawer and toast in the student app read in the reading serif, buttons
 * included. They now take their face from the surface that opened them: the UI sans everywhere,
 * except inside a staff console, whose pages are set in the body face (see OverlayFace).
 *
 * jsdom does not cascade the stylesheet, so these read the class that sets the face rather than a
 * computed font-family. The typeface itself was measured in Chromium, on the real routes.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "@/components/ToastProvider";
import { Dialog } from "@/features/classroom/ui/Dialog";
import { Drawer } from "../Drawer";
import { Modal } from "../Modal";
import { OverlayFaceProvider } from "../OverlayFace";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(ui: React.ReactNode) {
  await act(async () => root.render(ui));
}

/** "ui" when the text sits inside `ds-app`; "body" when it inherits the document's face. */
function faceOf(text: string): "ui" | "body" {
  const el = Array.from(document.body.querySelectorAll("h2, p")).find(
    (n) => n.textContent?.trim() === text,
  );
  if (!el) throw new Error(`nothing on the page reads "${text}"`);
  return el.closest(".ds-app") ? "ui" : "body";
}

const noop = () => {};

describe.each([
  ["Modal", <Modal key="m" open onClose={noop} title="Join a class">Enter the code.</Modal>],
  ["Drawer", <Drawer key="d" open onClose={noop} title="Join a class">Enter the code.</Drawer>],
  ["classroom Dialog", <Dialog key="c" open onClose={noop} title="Join a class">Enter the code.</Dialog>],
])("%s", (_name, overlay) => {
  it("is set in the UI sans, though it is portalled out of the page", async () => {
    await render(overlay);
    const dialog = document.body.querySelector("[role=dialog]");
    expect(dialog).not.toBeNull();
    expect(host.contains(dialog)).toBe(false);
    expect(faceOf("Join a class")).toBe("ui");
  });

  it("matches a console set in the body face", async () => {
    await render(<OverlayFaceProvider face="body">{overlay}</OverlayFaceProvider>);
    expect(faceOf("Join a class")).toBe("body");
  });
});

function RaiseToast() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.push({ tone: "success", message: "Saved." })}>
      Save
    </button>
  );
}

async function clickSave() {
  await act(async () => host.querySelector("button")?.click());
}

describe("toasts", () => {
  it("are set in the UI sans", async () => {
    await render(
      <ToastProvider>
        <RaiseToast />
      </ToastProvider>,
    );
    await clickSave();
    expect(faceOf("Saved.")).toBe("ui");
  });

  it("raised inside a console set in the body face, match that console", async () => {
    // The stack renders above the console, in the root layout, so the face has to travel with the
    // toast from where it was raised — the stack itself cannot see the console's provider.
    await render(
      <ToastProvider>
        <OverlayFaceProvider face="body">
          <RaiseToast />
        </OverlayFaceProvider>
      </ToastProvider>,
    );
    await clickSave();
    expect(faceOf("Saved.")).toBe("body");
  });

  it("raised by a mastersat-toast event, which carries no surface, are set in the UI sans", async () => {
    await render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    await act(async () => {
      window.dispatchEvent(new CustomEvent("mastersat-toast", { detail: { message: "Saved." } }));
    });
    expect(faceOf("Saved.")).toBe("ui");
  });
});
