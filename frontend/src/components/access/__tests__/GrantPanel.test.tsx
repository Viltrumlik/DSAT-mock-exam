/**
 * /ops/access — the Grant access wizard in the console's look: Recipients → Tests → Confirm with the same
 * calls and payloads (students and classroom), the Sections choice and the expiry, the server's refusal in
 * its own words, and the embedded By-user form that skips the recipients step.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const classesList = vi.fn();
const access = {
  resourceTypes: vi.fn(),
  searchResources: vi.fn(),
  grantResources: vi.fn(),
  grantClassroomResources: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

const { GrantPanel } = await import("../GrantPanel");

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
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
/** A student row starts with its avatar's initials, so it is found by the name inside it. */
const studentRow = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.includes(name) && !b.getAttribute("aria-label"))!;
const text = () => host.textContent ?? "";

const STUDENTS = [
  { id: 5, first_name: "Ali", last_name: "Valiyev", email: "ali@example.com", role: "student", profile_image_url: null },
  { id: 6, first_name: "Malika", last_name: "Karimova", email: "malika@example.com", role: "student", profile_image_url: null },
];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [get, classesList, ...Object.values(access)]) f.mockReset();
  get.mockImplementation(async (url: string) => (url === "/users/" ? { data: STUDENTS } : { data: [] }));
  classesList.mockResolvedValue({ items: [{ id: 3, name: "Group A", subject: "MATH" }] });
  access.resourceTypes.mockResolvedValue(["practice_test_pack", "mock_exam", "module"]);
  access.searchResources.mockImplementation(async (type: string) =>
    type === "mock_exam"
      ? [{ resource_type: "mock_exam", resource_id: 11, label: "SAT Mock 1", subjects: ["math", "english"], published: true }]
      : [{ resource_type: "practice_test_pack", resource_id: 21, label: "Pack A", subjects: ["math"], published: false }],
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("tests → students", () => {
  it("walks the three steps and grants with the same payload, then offers to grant more", async () => {
    const onSuccess = vi.fn();
    access.grantResources.mockResolvedValue({ requested: 1, created: 1, skipped: 0, grant_ids: [90] });
    await render(<GrantPanel onSuccess={onSuccess} />);

    expect(text()).toContain("Step 1");
    expect(text()).toContain("Recipients");
    expect(text()).toContain("Tests → students");
    expect(text()).toContain("Grant one or many tests to one or many students.");
    expect(buttonIn(host, "Continue to tests").disabled).toBe(true);

    await click(studentRow("Ali Valiyev"));
    expect(buttonIn(host, "Continue to tests").disabled).toBe(false);
    await click(buttonIn(host, "Continue to tests"));

    // The Tests step keeps the recipient in view; the picker opens on Mock exams and hides module.
    expect(text()).toContain("1 recipient selected");
    expect(host.querySelector('[aria-label="Remove Ali Valiyev"]')).not.toBeNull();
    expect(buttonIn(host, "Mock exam").getAttribute("aria-pressed")).toBe("true");
    expect(buttonIn(host, "Practice test pack")).toBeTruthy();
    expect(buttonIn(host, "Module")).toBeUndefined();
    await searchDebounce();
    expect(access.searchResources).toHaveBeenCalledWith("mock_exam", "", 30);
    expect(buttonIn(host, "Review grant").disabled).toBe(true);

    await click(buttonIn(host, "SAT Mock 1"));
    expect(buttonIn(host, "SAT Mock 1").getAttribute("aria-pressed")).toBe("true");
    await click(buttonIn(host, "Review grant"));

    expect(text()).toContain("Review this grant");
    expect(text()).toContain("Confirm the details below. Students are notified immediately.");
    expect(text()).toContain("Recipients · 1");
    expect(text()).toContain("Tests · 1");
    expect(text()).toContain("1 student will get 1 test(s)");
    expect(text()).toContain("with permanent access.");
    expect(text()).not.toContain("Sections");

    await click(buttonIn(host, "Grant access"));
    expect(access.grantResources).toHaveBeenCalledWith({
      user_ids: [5],
      resources: [{ resource_type: "mock_exam", resource_id: 11, subject_scope: undefined }],
      expires_at: null,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Access granted");
    expect(text()).toContain("1 created, 0 already had access (1 requested).");

    await click(buttonIn(host, "Grant more access"));
    expect(text()).toContain("Tests → classroom");
    expect(buttonIn(host, "Continue to tests").disabled).toBe(true);
  });

  it("shows the server's refusal in its own words and stays on the confirm step", async () => {
    access.grantResources.mockRejectedValue({ response: { data: { detail: "Ali Valiyev is frozen." } } });
    await render(<GrantPanel />);
    await click(studentRow("Ali Valiyev"));
    await click(buttonIn(host, "Continue to tests"));
    await searchDebounce();
    await click(buttonIn(host, "SAT Mock 1"));
    await click(buttonIn(host, "Review grant"));
    await click(buttonIn(host, "Grant access"));

    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Ali Valiyev is frozen.");
    expect(text()).toContain("Review this grant");
    expect(text()).not.toContain("Access granted");
  });

  it("falls back to its own words when the refusal has none", async () => {
    access.grantResources.mockRejectedValue(new Error("network"));
    await render(<GrantPanel />);
    await click(studentRow("Ali Valiyev"));
    await click(buttonIn(host, "Continue to tests"));
    await searchDebounce();
    await click(buttonIn(host, "SAT Mock 1"));
    await click(buttonIn(host, "Review grant"));
    await click(buttonIn(host, "Grant access"));
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Could not grant access.");
  });

  it("will not go on to Confirm once every recipient is taken off on the Tests step", async () => {
    await render(<GrantPanel />);
    await click(studentRow("Ali Valiyev"));
    await click(buttonIn(host, "Continue to tests"));
    await searchDebounce();
    await click(buttonIn(host, "SAT Mock 1"));
    expect(buttonIn(host, "Review grant").disabled).toBe(false);
    await click(host.querySelector('[aria-label="Remove Ali Valiyev"]')!);
    expect(buttonIn(host, "Review grant").disabled).toBe(true);
  });
});

describe("tests → classroom", () => {
  it("grants a pack to the classroom with the chosen sections and expiry", async () => {
    access.grantClassroomResources.mockResolvedValue({ requested: 12, created: 10, skipped: 2, grant_ids: [] });
    await render(<GrantPanel />);

    await click(buttonIn(host, "Tests → classroom"));
    const select = host.querySelector<HTMLSelectElement>("select")!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Select a classroom…", "Group A · MATH"]);
    expect(buttonIn(host, "Continue to tests").disabled).toBe(true);
    await choose(select, "3");
    await click(buttonIn(host, "Continue to tests"));

    expect(text()).toContain("Recipient");
    expect(text()).toContain("Group A");
    await click(buttonIn(host, "Practice test pack"));
    await searchDebounce();
    expect(access.searchResources).toHaveBeenLastCalledWith("practice_test_pack", "", 30);
    expect(text()).toContain("math · draft");
    await click(buttonIn(host, "Pack A"));
    await click(buttonIn(host, "Review grant"));

    expect(text()).toContain("Confirm the details below. The classroom are notified immediately.");
    expect(text()).toContain("Sections");
    expect(text()).toContain("Math grants only the Math section, Reading only the Reading & Writing section.");
    await click(buttonIn(host, "Math"));
    const expires = host.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    await type(expires, "2026-12-01T10:00");
    expect(text()).toContain("Group A will get 1 test(s)");
    expect(text()).toContain(`with temporary access until ${new Date("2026-12-01T10:00").toLocaleDateString()}.`);

    await click(buttonIn(host, "Grant access"));
    expect(access.grantClassroomResources).toHaveBeenCalledWith({
      classroom_id: 3,
      resources: [{ resource_type: "practice_test_pack", resource_id: 21, subject_scope: "math" }],
      expires_at: new Date("2026-12-01T10:00").toISOString(),
    });
    expect(text()).toContain("10 created, 2 already had access (12 requested).");
  });
});

describe("embedded (By user → Grant access)", () => {
  it("skips the recipients step and grants to the locked student", async () => {
    access.grantResources.mockResolvedValue({ requested: 1, created: 1, skipped: 0, grant_ids: [] });
    await render(<GrantPanel lockUserIds={[9]} />);

    expect(text()).not.toContain("Tests → classroom");
    expect(text()).toContain("1 student selected");
    await searchDebounce();
    await click(buttonIn(host, "SAT Mock 1"));
    await click(buttonIn(host, "Review grant"));
    expect(text()).toContain("1 selected student");
    await click(buttonIn(host, "Back"));
    expect(text()).toContain("1 student selected");
    await click(buttonIn(host, "Review grant"));
    await click(buttonIn(host, "Grant access"));
    expect(access.grantResources).toHaveBeenCalledWith({
      user_ids: [9],
      resources: [{ resource_type: "mock_exam", resource_id: 11, subject_scope: undefined }],
      expires_at: null,
    });
  });
});
