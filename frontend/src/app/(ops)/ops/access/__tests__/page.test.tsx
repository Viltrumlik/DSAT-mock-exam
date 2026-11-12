/**
 * /ops/access in the console's look: the console header and four tabs (kept in the page, not the address),
 * By user (pick, list, revoke / extend with the same calls, grant to the locked student, change user) and
 * By resource (pick one test, who has it, revoke, add users), with their empty states and the server's
 * refusals in its own words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const classesList = vi.fn();
const routerReplace = vi.fn();
const access = {
  listGrants: vi.fn(),
  revoke: vi.fn(),
  extend: vi.fn(),
  events: vi.fn(),
  resourceTypes: vi.fn(),
  searchResources: vi.fn(),
  grantResources: vi.fn(),
  grantClassroomResources: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: routerReplace }),
  usePathname: () => "/ops/access",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a) },
  classesApi: { list: (...a: unknown[]) => classesList(...a) },
}));
vi.mock("@/lib/accessApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accessApi")>()),
  accessApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (access as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

const USERS = [
  { id: 5, first_name: "Ali", last_name: "Valiyev", email: "ali@example.com", role: "student", profile_image_url: null },
  { id: 6, first_name: "Malika", last_name: "Karimova", email: "malika@example.com", role: "teacher", profile_image_url: null },
];

function grant(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    user: 5,
    user_email: "ali@example.com",
    user_name: "Ali Valiyev",
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
const list = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
/** The test search waits 250 ms after a change. */
async function searchDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
  await settle();
}
async function render() {
  await act(async () => {
    root.render(<Page />);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
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
const tab = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === name)!;
const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!;
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
/** A user row starts with its avatar's initials, so it is found by the name inside it. */
const userRow = (name: string) =>
  Array.from(panel().querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.includes(name))!;
const rowOf = (words: string) => Array.from(panel().querySelectorAll("tbody tr")).find((r) => r.textContent?.includes(words))!;
const action = (row: Element, title: string) => row.querySelector<HTMLButtonElement>(`button[title="${title}"]`);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [get, classesList, routerReplace, ...Object.values(access)]) f.mockReset();
  get.mockImplementation(async (url: string) => (url === "/users/" ? { data: USERS } : { data: [] }));
  classesList.mockResolvedValue({ items: [] });
  access.resourceTypes.mockResolvedValue(["mock_exam"]);
  access.searchResources.mockResolvedValue([
    { resource_type: "mock_exam", resource_id: 11, label: "SAT Mock 1", subjects: ["math"], published: true },
  ]);
  access.listGrants.mockResolvedValue(list([grant(1), grant(2, { status: "EXPIRED", classroom_name: "Group A" })]));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("the page", () => {
  it("opens on Grant access under the console header, and the tabs switch in place", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Access management");
    expect(host.textContent).toContain("Admin console · Access");
    expect(host.textContent).toContain(
      "Grant and manage access to past papers, mock exams, practice tests, and assessments — by student, by resource, in bulk, or per classroom.",
    );
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      "Grant access",
      "By user",
      "By resource",
      "Manage grants",
    ]);
    expect(tab("Grant access").getAttribute("aria-selected")).toBe("true");
    expect(panel().textContent).toContain("Tests → students");

    await click(tab("Manage grants"));
    expect(tab("Manage grants").getAttribute("aria-selected")).toBe("true");
    expect(access.listGrants).toHaveBeenCalledWith({ status: "ACTIVE" });
    expect(panel().textContent).toContain("grant(s) total");
    // The open tab stays in the page: the address is not touched.
    expect(routerReplace).not.toHaveBeenCalled();
  });
});

describe("By user", () => {
  it("lists the users, narrows them by the search, and opens one's grants", async () => {
    await render();
    await click(tab("By user"));
    expect(get).toHaveBeenCalledWith("/users/");
    expect(panel().textContent).toContain("Ali Valiyev");
    expect(panel().textContent).toContain("teacher");

    const search = panel().querySelector<HTMLInputElement>('input[placeholder="Search a user by name, username, or email…"]')!;
    await type(search, "malika");
    expect(panel().textContent).not.toContain("Ali Valiyev");
    await type(search, "nobody");
    expect(panel().textContent).toContain("No users match.");
    await type(search, "");

    await click(userRow("Ali Valiyev"));
    expect(access.listGrants).toHaveBeenCalledWith({ user: 5, page_size: 200 });
    expect(Array.from(panel().querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "Access to",
      "Source",
      "Status",
      "Expires",
      "Actions",
    ]);
    expect(rowOf("via Group A").textContent).toContain("EXPIRED");
    expect(action(rowOf("via Group A"), "Revoke")).toBeNull();
    expect(action(rowOf("ACTIVE"), "Revoke")).not.toBeNull();

    await click(buttonIn(panel(), "Change user"));
    expect(panel().querySelector("table")).toBeNull();
    expect(panel().textContent).toContain("Malika Karimova");
  });

  it("revokes and extends with the same questions and calls", async () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    const date = vi.spyOn(window, "prompt").mockReturnValue("2027-01-15");
    access.revoke.mockResolvedValue(grant(1, { status: "REVOKED" }));
    access.extend.mockResolvedValue(grant(1));
    await render();
    await click(tab("By user"));
    await click(userRow("Ali Valiyev"));

    await click(action(rowOf("ACTIVE"), "Revoke")!);
    expect(ask).toHaveBeenCalledWith('Revoke "SAT Mock 1" for ali@example.com?');
    expect(access.revoke).toHaveBeenCalledWith(1);

    await click(action(rowOf("ACTIVE"), "Extend / set expiry")!);
    expect(date).toHaveBeenCalledWith("New expiry (YYYY-MM-DD, or empty to clear):", "");
    expect(access.extend).toHaveBeenCalledWith(1, new Date("2027-01-15").toISOString());
  });

  it("grants to the chosen user from the embedded form", async () => {
    await render();
    await click(tab("By user"));
    await click(userRow("Ali Valiyev"));
    await click(buttonIn(panel(), "Grant access"));
    expect(panel().textContent).toContain("1 student selected");
    expect(panel().textContent).not.toContain("Tests → classroom");
  });

  it("shows the empty state, and the server's refusal in its own words", async () => {
    access.listGrants.mockResolvedValueOnce(list([]));
    await render();
    await click(tab("By user"));
    await click(userRow("Ali Valiyev"));
    expect(panel().textContent).toContain("No access grants yet. Use “Grant access” to add some.");

    access.listGrants.mockRejectedValueOnce({ response: { data: { detail: "Not allowed here." } } });
    await click(buttonIn(panel(), "Change user"));
    await click(userRow("Ali Valiyev"));
    expect(panel().querySelector('[role="alert"]')!.textContent).toBe("Not allowed here.");
  });
});

describe("By resource", () => {
  it("shows who can open the picked test, revokes, and adds users", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    access.revoke.mockResolvedValue(grant(1, { status: "REVOKED" }));
    await render();
    await click(tab("By resource"));
    expect(panel().textContent).toContain("Pick a test / resource");
    // A single pick: no type tabs.
    expect(panel().textContent).not.toContain("Tests / resources");
    await searchDebounce();
    expect(access.searchResources).toHaveBeenCalledWith("mock_exam", "", 30);

    await click(buttonIn(panel(), "SAT Mock 1"));
    expect(access.listGrants).toHaveBeenCalledWith({ resource_type: "mock_exam", resource_id: 11, status: "ACTIVE", page_size: 200 });
    expect(panel().textContent).toContain("2 users with active access");
    expect(Array.from(panel().querySelectorAll("th")).map((th) => th.textContent)).toEqual([
      "User",
      "Source",
      "Status",
      "Expires",
      "Actions",
    ]);

    const before = access.listGrants.mock.calls.length;
    await click(action(rowOf("ACTIVE"), "Revoke")!);
    expect(window.confirm).toHaveBeenCalledWith("Revoke access for ali@example.com?");
    expect(access.revoke).toHaveBeenCalledWith(1);
    expect(access.listGrants.mock.calls.length).toBe(before + 1);

    await click(buttonIn(panel(), "Add users"));
    // The test is locked in: the form goes Recipients → Confirm.
    expect(panel().textContent).toContain("Step 1");
    expect(panel().textContent).toContain("Recipients");
    expect(panel().textContent).toContain("Confirm");
  });

  it("shows the empty state, and falls back to its own words on a refusal without any", async () => {
    access.listGrants.mockResolvedValueOnce(list([]));
    await render();
    await click(tab("By resource"));
    await searchDebounce();
    await click(buttonIn(panel(), "SAT Mock 1"));
    expect(panel().textContent).toContain("0 users with active access");
    expect(panel().textContent).toContain("No one has access yet. Use “Add users”.");

    access.listGrants.mockRejectedValueOnce(new Error("network"));
    await click(buttonIn(panel(), "SAT Mock 1")); // unpick
    await click(buttonIn(panel(), "SAT Mock 1")); // pick again
    expect(panel().querySelector('[role="alert"]')!.textContent).toBe("Could not load access for this resource.");
  });
});
