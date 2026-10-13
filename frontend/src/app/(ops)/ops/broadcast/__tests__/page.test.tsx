/**
 * The broadcast page: a super admin picks who hears it — the learning center's students, the
 * public learners, or both (owner, 2026-10-13: "Xabar yuborishda tanlash") — reviews, and sends.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({ broadcast: vi.fn() }));
const session = vi.hoisted(() => ({ role: "super_admin" }));

vi.mock("@/features/notifications/notificationsApi", () => ({ notificationsApi: notifications }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me: { role: session.role } }) }));

const { default: BroadcastPage } = await import("../page");

let host: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function choose(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLSelectElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  session.role = "super_admin";
  notifications.broadcast.mockResolvedValue({ audience: "public_students", recipients: 12, notified: 11, pushed: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<BroadcastPage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("Broadcast", () => {
  it("offers the learning center's students, the public learners, and both", () => {
    const options = [...host.querySelectorAll<HTMLOptionElement>("#broadcast-audience option")].map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Learning center students", "Public students", "All students"]));
  });

  it("sends to the audience chosen, only after a review that names it", async () => {
    await choose("#broadcast-audience", "public_students");
    await type("#broadcast-title", "Hello");
    await click(button("Review"));
    expect(notifications.broadcast).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Public students");

    await click(button("Send"));
    expect(notifications.broadcast).toHaveBeenCalledWith({ title: "Hello", audience: "public_students", push: false });
    expect(host.textContent).toContain("Sent to 12 people");
  });

  it("will not review a message with no title", async () => {
    await click(button("Review"));
    expect(host.textContent).toContain("Give the message a title");
    expect(notifications.broadcast).not.toHaveBeenCalled();
  });

  it("says a failed send failed, and keeps the message", async () => {
    notifications.broadcast.mockRejectedValueOnce({ response: { status: 500, data: { detail: "Something broke." } } });
    await type("#broadcast-title", "Hello");
    await click(button("Review"));
    await click(button("Send"));
    expect(host.textContent).toContain("Something broke.");
    expect((host.querySelector("#broadcast-title") as HTMLInputElement | null)?.value ?? "Hello").toBe("Hello");
  });

  it("is a super admin's alone", async () => {
    await act(async () => root.unmount());
    session.role = "admin";
    root = createRoot(host);
    await act(async () => root.render(<BroadcastPage />));
    expect(host.textContent).toContain("Only a super admin");
    expect(host.querySelector("#broadcast-title")).toBeNull();
  });
});
