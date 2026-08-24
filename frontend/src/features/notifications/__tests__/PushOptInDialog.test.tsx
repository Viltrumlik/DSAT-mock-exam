import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The dialog that carries the notification ask to a student after they sign in.
 *
 * Ported from the banner this replaces, keeping the properties that actually cost something
 * when they break. The banner was already the second attempt — the first lived inside the bell
 * drawer, where only a student who opened the bell ever met it — and the school reported the
 * same failure about the banner. Production measured it: twelve push subscriptions school-wide.
 *
 * Three of these tests guard "must not appear", and that is the right ratio. **A refusal is
 * permanent per origin**: there is no second prompt and no API to reset one. A dialog that
 * shows up when it cannot possibly lead anywhere does not merely waste a moment, it spends the
 * single chance this browser will ever give us — so "does it stay away" matters more here than
 * "does it show".
 */

const usePushConfig = vi.fn();
const pushSupported = vi.fn();
const permissionState = vi.fn();

vi.mock("../notificationsHooks", () => ({
  usePushConfig: () => usePushConfig(),
}));

vi.mock("@/lib/push", () => ({
  pushSupported: () => pushSupported(),
  permissionState: () => permissionState(),
  subscribeToPush: vi.fn(),
}));

vi.mock("../notificationsApi", () => ({ notificationsApi: { subscribe: vi.fn() } }));

const { PushOptInDialog } = await import("../PushOptInDialog");

let container: HTMLDivElement;
let root: Root;

/** The dialog portals to document.body, so assertions read the whole document, not the host. */
function text(): string {
  return document.body.textContent ?? "";
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PushOptInDialog />));
  // The dialog waits before opening, so that it does not land in the same frame as the
  // dashboard and get dismissed reflexively. Every assertion below is about the state AFTER
  // that wait, so run the timer out here rather than in each test.
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  usePushConfig.mockReturnValue({ data: { enabled: true, public_key: "k" } });
  pushSupported.mockReturnValue(true);
  permissionState.mockReturnValue("default");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("PushOptInDialog", () => {
  it("asks when push is configured and unanswered", async () => {
    await render();
    expect(text()).toContain("Turn on notifications");
  });

  it("waits before opening, rather than landing with the page", async () => {
    // The delay is the difference between "a considered ask" and "a popup that looks like a
    // page error" — and a dialog that arrives mid-layout gets dismissed reflexively, which
    // per the note at the top of this file is a cost that cannot be recovered.
    //
    // Asserting at 500ms, not at 0ms. A `setTimeout(…, 0)` is still a macrotask and so is
    // still closed on the first paint, which means a 0ms check passes whatever the delay is
    // set to — the first version of this test did exactly that and proved nothing. This one
    // fails if the constant is lowered.
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<PushOptInDialog />));

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(text()).not.toContain("Turn on notifications");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(text()).toContain("Turn on notifications");
  });

  it("stays away when the deployment cannot deliver push", async () => {
    // `enabled` is false whenever VAPID keys are unset. Asking then collects a permission
    // nothing can use and burns the one chance to get it.
    usePushConfig.mockReturnValue({ data: { enabled: false, public_key: "" } });
    await render();
    expect(text()).not.toContain("Turn on notifications");
  });

  it("stays away once the student has already answered the browser prompt", async () => {
    permissionState.mockReturnValue("denied");
    await render();
    expect(text()).not.toContain("Turn on notifications");
  });

  it("stays away on a browser with no push support at all", async () => {
    pushSupported.mockReturnValue(false);
    await render();
    expect(text()).not.toContain("Turn on notifications");
  });

  it("does not come back after Not now, on the next page", async () => {
    // The regression this guards: the drawer version kept `dismissed` in component state,
    // which is fine for a drawer that unmounts and is harassment for anything mounted in the
    // shell, which re-mounts on every client-side navigation. Nagging is what produces the
    // reflexive "no" that can never be undone.
    await render();
    const notNow = buttonLabelled("Not now");
    expect(notNow).toBeTruthy();
    await act(async () => notNow!.click());
    expect(text()).not.toContain("Turn on notifications");

    await act(async () => root.unmount());
    container.remove();

    await render();
    expect(text()).not.toContain("Turn on notifications");
  });
});
