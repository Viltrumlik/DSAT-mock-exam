/**
 * /ops/access — Manage grants in the console's look: the table with its status pills, the filters sent as
 * before, revoke and extend behind the same browser questions with the same calls, the audit trail in a
 * side sheet, the empty state and the server's refusal in its own words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = {
  listGrants: vi.fn(),
  revoke: vi.fn(),
  extend: vi.fn(),
  events: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/ops/access",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", () => ({ default: { get: vi.fn() }, classesApi: { list: vi.fn() } }));
vi.mock("@/lib/accessApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accessApi")>()),
  accessApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (access as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { GrantsManager } = await import("../GrantsManager");

function grant(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    user: 100 + id,
    user_email: `s${id}@example.com`,
    user_name: `Student ${id}`,
    user_profile_image_url: null,
    scope: "RESOURCE",
    subject: null,
    resource_type: "mock_exam",
    resource_id: 11,
    resource_label: "SAT Mock 1",
    classroom: null,
    classroom_name: "",
    source: "MANUAL",
    status: "ACTIVE",
    is_effective: true,
    granted_by: 1,
    granted_by_email: "admin@example.com",
    expires_at: null,
    created_at: "2026-11-01T09:00:00+05:00",
    updated_at: "2026-11-01T09:00:00+05:00",
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render(ui: React.ReactNode) {
  await act(async () => {
    root.render(ui);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
const rows = () => Array.from(host.querySelectorAll("tbody tr"));
const rowOf = (email: string) => rows().find((r) => r.textContent?.includes(email))!;
const action = (row: Element, title: string) => row.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
const selects = () => Array.from(host.querySelectorAll<HTMLSelectElement>("select"));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(access)) f.mockReset();
  access.listGrants.mockResolvedValue({
    count: 3,
    next: null,
    previous: null,
    results: [
      grant(1, { classroom_name: "Group A", source: "CLASSROOM" }),
      grant(2, { status: "REVOKED", expires_at: "2026-12-01T00:00:00+05:00" }),
      grant(3, { scope: "SUBJECT", subject: "math", resource_type: null, resource_id: null, resource_label: "" }),
    ],
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the grants table", () => {
  it("lists active grants first, with each grant's words, status and actions", async () => {
    await render(<GrantsManager />);
    expect(access.listGrants).toHaveBeenCalledWith({ status: "ACTIVE" });
    expect(Array.from(host.querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Student",
      "Target",
      "Source",
      "Status",
      "Expires",
      "Actions",
    ]);
    expect(rows()).toHaveLength(3);

    const first = rowOf("s1@example.com");
    expect(first.textContent).toContain("Student 1");
    expect(first.textContent).toContain("SAT Mock 1");
    expect(first.textContent).toContain("via Group A");
    expect(first.textContent).toContain("CLASSROOM");
    expect(first.textContent).toContain("ACTIVE");
    expect(first.textContent).toContain("—");
    expect(action(first, "History")).not.toBeNull();
    expect(action(first, "Extend / set expiry")).not.toBeNull();
    expect(action(first, "Revoke")).not.toBeNull();

    const revoked = rowOf("s2@example.com");
    expect(revoked.textContent).toContain("REVOKED");
    expect(revoked.textContent).toContain(new Date("2026-12-01T00:00:00+05:00").toLocaleDateString());
    expect(action(revoked, "Revoke")).toBeNull();

    expect(rowOf("s3@example.com").textContent).toContain("Subject · math");
    expect(host.textContent).toContain("3 grant(s) total");
  });

  it("says when more grants exist than are shown", async () => {
    access.listGrants.mockResolvedValue({ count: 40, next: "p2", previous: null, results: [grant(1)] });
    await render(<GrantsManager />);
    expect(host.textContent).toContain("40 grant(s) total · showing 1");
  });

  it("sends the filters as before", async () => {
    await render(<GrantsManager />);
    const [scope, status, source] = selects();
    expect(Array.from(status.options).map((o) => o.textContent)).toEqual(["All statuses", "Active", "Revoked", "Expired"]);
    await choose(status, "");
    expect(access.listGrants).toHaveBeenLastCalledWith({ status: "" });
    await choose(scope, "SUBJECT");
    await choose(source, "BULK");
    await type(host.querySelector<HTMLInputElement>('input[placeholder="Search by student name or email…"]')!, "ali");
    expect(access.listGrants).toHaveBeenLastCalledWith({ status: "", scope: "SUBJECT", source: "BULK", q: "ali" });

    const calls = access.listGrants.mock.calls.length;
    await click(Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Refresh")!);
    expect(access.listGrants.mock.calls.length).toBe(calls + 1);
  });

  it("shows the empty state when no grant matches", async () => {
    access.listGrants.mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
    await render(<GrantsManager />);
    expect(host.textContent).toContain("No grants match these filters.");
    expect(host.textContent).toContain("0 grant(s) total");
  });

  it("shows the server's refusal in its own words", async () => {
    access.listGrants.mockRejectedValue({ response: { data: { detail: "You do not have permission." } } });
    await render(<GrantsManager />);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("You do not have permission.");
  });

  it("falls back to its own words when the refusal has none", async () => {
    access.listGrants.mockRejectedValue(new Error("network"));
    await render(<GrantsManager />);
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Could not load grants.");
  });
});

describe("revoke, extend, history", () => {
  it("revokes after the same question, then reloads", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    access.revoke.mockResolvedValue(grant(1, { status: "REVOKED" }));
    await render(<GrantsManager />);
    await click(action(rowOf("s1@example.com"), "Revoke")!);
    expect(ask).toHaveBeenCalledWith("Revoke access for s1@example.com?");
    expect(access.revoke).toHaveBeenCalledWith(1);
    expect(access.listGrants).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the question is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await render(<GrantsManager />);
    await click(action(rowOf("s1@example.com"), "Revoke")!);
    expect(access.revoke).not.toHaveBeenCalled();
  });

  it("extends to the typed date, or clears it, with the same prompt", async () => {
    const ask = vi.spyOn(window, "prompt").mockReturnValueOnce("2026-12-31").mockReturnValueOnce("");
    access.extend.mockResolvedValue(grant(1));
    await render(<GrantsManager />);
    await click(action(rowOf("s1@example.com"), "Extend / set expiry")!);
    expect(ask).toHaveBeenCalledWith("New expiry (YYYY-MM-DD, or empty to clear):", "");
    expect(access.extend).toHaveBeenLastCalledWith(1, new Date("2026-12-31").toISOString());
    await click(action(rowOf("s1@example.com"), "Extend / set expiry")!);
    expect(access.extend).toHaveBeenLastCalledWith(1, null);
  });

  it("opens the audit trail in a side sheet", async () => {
    access.events.mockResolvedValue([
      { id: 1, grant: 1, action: "GRANTED", actor: 1, actor_email: "admin@example.com", note: "Paid in cash", snapshot: {}, created_at: "2026-11-01T09:00:00+05:00" },
    ]);
    await render(<GrantsManager />);
    await click(action(rowOf("s1@example.com"), "History")!);
    expect(access.events).toHaveBeenCalledWith(1);
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.textContent).toContain("Audit trail");
    expect(sheet.textContent).toContain("Grant #1");
    expect(sheet.textContent).toContain("s1@example.com · SAT Mock 1");
    expect(sheet.textContent).toContain("GRANTED");
    expect(sheet.textContent).toContain("by admin@example.com");
    expect(sheet.textContent).toContain("Paid in cash");
  });

  it("says when a grant has no events", async () => {
    access.events.mockResolvedValue([]);
    await render(<GrantsManager />);
    await click(action(rowOf("s1@example.com"), "History")!);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("No events recorded.");
  });
});
