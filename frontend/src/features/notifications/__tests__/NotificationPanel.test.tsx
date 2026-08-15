/**
 * The notification drawer's four branches, its sections, and the permission prompt's one rule.
 *
 * That rule is the load-bearing one: a REFUSED notification permission is permanent per
 * origin, so the prompt must not appear on a deployment that has no VAPID keys and could not
 * deliver anything. Asking there burns the platform's single chance, forever. It also must
 * not appear once the student has already answered.
 *
 * And the drawer must never render a failed fetch as "You're all caught up" — that is the
 * exact lie AppShell's comment says this panel was rebuilt to stop telling.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationInbox } from "../notificationsApi";

const useNotifications = vi.fn();
const useMarkRead = vi.fn();
const usePushConfig = vi.fn();
const pushSupported = vi.fn();
const permissionState = vi.fn();

vi.mock("../notificationsHooks", () => ({
  useNotifications: (...a: unknown[]) => useNotifications(...a),
  useMarkRead: (...a: unknown[]) => useMarkRead(...a),
  usePushConfig: (...a: unknown[]) => usePushConfig(...a),
}));
vi.mock("@/lib/push", () => ({
  pushSupported: (...a: unknown[]) => pushSupported(...a),
  permissionState: (...a: unknown[]) => permissionState(...a),
  subscribeToPush: vi.fn(),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { NotificationPanel } = await import("../NotificationPanel");

const INBOX: NotificationInbox = {
  notifications: [
    {
      id: 1, category: "GRADES", category_label: "Grades", event: "HOMEWORK_GRADED",
      title: "Your work has been marked", body: "in Math Middle A",
      link_url: "/classes", is_read: false, read_at: null,
      created_at: new Date().toISOString(),
    },
    {
      id: 2, category: "SUPPORT", category_label: "Support", event: "SUPPORT_BOOKED",
      title: "Support session booked", body: "Tomorrow at 15:00",
      link_url: "/support", is_read: true, read_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
  unread_total: 1,
  unread_by_category: { GRADES: 1 },
  categories: [
    { value: "GRADES", label: "Grades" },
    { value: "SUPPORT", label: "Support" },
  ],
};

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined, isPending: false, isError: false,
    refetch: vi.fn(), ...overrides,
  };
}

let host: HTMLElement;
let root: Root;

async function render(open = true) {
  await act(async () => root.render(<NotificationPanel open={open} />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useMarkRead.mockReturnValue({ mutate: vi.fn(), isPending: false });
  // Default: push unconfigured, so the prompt stays away unless a test enables it.
  usePushConfig.mockReturnValue(query({ data: { enabled: false, public_key: "" } }));
  pushSupported.mockReturnValue(true);
  permissionState.mockReturnValue("default");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("NotificationPanel", () => {
  it("lists the notifications with their section", async () => {
    useNotifications.mockReturnValue(query({ data: INBOX }));
    await render();

    expect(host.textContent).toContain("Your work has been marked");
    expect(host.textContent).toContain("Support session booked");
    expect(host.textContent).toContain("Grades");
  });

  it("offers a chip per section, with the unread count", async () => {
    useNotifications.mockReturnValue(query({ data: INBOX }));
    await render();

    const chips = [...host.querySelectorAll("button")].map((b) => b.textContent);
    expect(chips).toContain("All");
    expect(chips.some((c) => c?.startsWith("Grades"))).toBe(true);
    expect(chips.some((c) => c?.includes("1"))).toBe(true);
  });

  it("shows a failure as an error, never as caught up", async () => {
    useNotifications.mockReturnValue(query({ isError: true }));
    await render();

    expect(host.textContent).toContain("aren't loading");
    expect(host.textContent).not.toContain("caught up");
  });

  it("shows an empty inbox as caught up", async () => {
    useNotifications.mockReturnValue(query({
      data: { ...INBOX, notifications: [], unread_total: 0, unread_by_category: {} },
    }));
    await render();

    expect(host.textContent).toContain("caught up");
    expect(host.textContent).not.toContain("aren't loading");
  });

  it("offers mark-all only when something is unread", async () => {
    useNotifications.mockReturnValue(query({ data: INBOX }));
    await render();
    expect(host.textContent).toContain("Mark all as read");

    await act(async () => root.render(<div />));
    useNotifications.mockReturnValue(query({
      data: { ...INBOX, unread_total: 0 },
    }));
    await render();
    expect(host.textContent).not.toContain("Mark all as read");
  });

  it("does not fetch while the drawer is shut", async () => {
    useNotifications.mockReturnValue(query({ data: INBOX }));
    await render(false);

    // Second argument is React Query's `enabled`.
    expect(useNotifications).toHaveBeenCalledWith(null, false);
  });

  describe("the push permission prompt", () => {
    it("stays away when the deployment cannot deliver push", async () => {
      usePushConfig.mockReturnValue(query({ data: { enabled: false, public_key: "" } }));
      useNotifications.mockReturnValue(query({ data: INBOX }));
      await render();

      expect(host.textContent).not.toContain("Get these on your phone");
    });

    it("appears when push is configured and unanswered", async () => {
      usePushConfig.mockReturnValue(query({ data: { enabled: true, public_key: "k" } }));
      useNotifications.mockReturnValue(query({ data: INBOX }));
      await render();

      expect(host.textContent).toContain("Get these on your phone");
    });

    it("stays away once the student has already answered", async () => {
      usePushConfig.mockReturnValue(query({ data: { enabled: true, public_key: "k" } }));
      permissionState.mockReturnValue("denied");
      useNotifications.mockReturnValue(query({ data: INBOX }));
      await render();

      expect(host.textContent).not.toContain("Get these on your phone");
    });

    it("stays away where the browser has no push at all", async () => {
      usePushConfig.mockReturnValue(query({ data: { enabled: true, public_key: "k" } }));
      pushSupported.mockReturnValue(false);
      useNotifications.mockReturnValue(query({ data: INBOX }));
      await render();

      expect(host.textContent).not.toContain("Get these on your phone");
    });
  });
});
