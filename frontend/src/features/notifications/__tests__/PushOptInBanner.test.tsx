import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The banner that carries the notification ask into the shell, where a student actually meets
 * it after signing in — the drawer-only version was why the school reported that nothing ever
 * asked them.
 *
 * What is worth testing here is not the ask (the drawer's tests already cover that logic, and
 * it is now the same hook) but the two things that are new and that a shell-mounted component
 * gets wrong: it must not reappear on every client-side navigation once dismissed, and it must
 * stay away entirely when the deployment cannot deliver push — which is production today,
 * because the VAPID keys were never set.
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

const { PushOptInBanner } = await import("../PushOptInBanner");

let container: HTMLDivElement;
let root: Root;

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<PushOptInBanner />));
}

beforeEach(() => {
  window.localStorage.clear();
  usePushConfig.mockReturnValue({ data: { enabled: true, public_key: "k" } });
  pushSupported.mockReturnValue(true);
  permissionState.mockReturnValue("default");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("PushOptInBanner", () => {
  it("offers the ask when push is configured and unanswered", async () => {
    await render();
    expect(container.textContent).toContain("Turn on notifications");
  });

  it("stays away when the deployment cannot deliver push", async () => {
    // Production's current state: no VAPID keys, so `enabled` is false. Asking here would
    // collect a permission nothing can use and burn the one chance to get it.
    usePushConfig.mockReturnValue({ data: { enabled: false, public_key: "" } });
    await render();
    expect(container.textContent).toBe("");
  });

  it("stays away once the student has already answered the browser prompt", async () => {
    permissionState.mockReturnValue("denied");
    await render();
    expect(container.textContent).toBe("");
  });

  it("does not come back after Not now, on the next page", async () => {
    // The regression this guards: the drawer version kept `dismissed` in component state,
    // which is fine for a drawer that unmounts and harassment for a banner that re-mounts on
    // every client-side navigation.
    await render();
    const notNow = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Not now",
    );
    expect(notNow).toBeTruthy();
    await act(async () => notNow!.click());
    expect(container.textContent).toBe("");

    await act(async () => root.unmount());
    container.remove();

    await render();
    expect(container.textContent).toBe("");
  });
});
