/**
 * ⌘K finds people, classes and questions on the server (design handoff v0.3, Main · F scenario 1:
 * "parent at the desk: did Bekzod come, does he owe?"). Each console searches only what its host
 * and the person's role may read; a failed group says so and offers Retry — it never looks empty.
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const push = vi.fn();
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }) }));

const { CommandPalette } = await import("../CommandPalette");
const { entityScope, formatSom } = await import("../entitySearch");

const PEOPLE = {
  results: [
    { id: 21, name: "Bekzod Jo'rayev", phone: "+998 90 153 85 52", status: "centre", groups: [{ id: 5, name: "Middle M5" }], lcup: { linked: true, balance: -750000 } },
    { id: 22, name: "Bekzod Aliyev", username: "bekzod2", status: "frozen_debt", groups: [], lcup: { linked: true, balance: -1300000 } },
  ],
};
const CLASSES = { results: [{ id: 7, name: "Middle M7", teacher: null, students: 14, is_active: true }] };

let host: HTMLDivElement;
let root: Root;
function Harness({ kinds }: { kinds: ("Students" | "Classes" | "Questions")[] }) {
  const [open, setOpen] = useState(true);
  return <CommandPalette open={open} onOpenChange={setOpen} commands={[]} entityKinds={kinds} />;
}
const combobox = () => document.body.querySelector<HTMLInputElement>('[role="combobox"]')!;
const options = () => [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? "");
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(combobox(), text);
    combobox().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 260));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  push.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("⌘K entity search", () => {
  it("finds students with the verdict that matters at the desk, and opens one", async () => {
    get.mockImplementation(async (url: string) => ({ data: url.startsWith("/users/") ? PEOPLE : CLASSES }));
    act(() => root.render(<Harness kinds={["Students", "Classes"]} />));
    await type("bekzod");
    expect(get).toHaveBeenCalledWith("/users/admin/people/", expect.objectContaining({ params: { section: "students", q: "bekzod", page_size: 25 } }));
    const all = options();
    expect(all[0]).toContain("Bekzod Jo'rayev");
    expect(all[0]).toContain("Owes 750 000 so'm");
    expect(all[0]).toContain("Middle M5");
    expect(all[1]).toContain("Frozen for debt");
    expect(all.some((o) => o.includes("Middle M7") && o.includes("No teacher"))).toBe(true);
    await act(async () => {
      combobox().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(push).toHaveBeenCalledWith("/ops/students/21");
  });

  it("says a search failed, and tries again on Retry", async () => {
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/classes/")) throw new Error("boom");
      return { data: PEOPLE };
    });
    act(() => root.render(<Harness kinds={["Students", "Classes"]} />));
    await type("bek");
    expect(document.body.textContent).toContain("Couldn’t search classes.");
    expect(document.body.textContent).not.toContain("Nothing called");
    const calls = get.mock.calls.length;
    const retry = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    await act(async () => retry.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260));
    });
    expect(get.mock.calls.length).toBeGreaterThan(calls);
  });

  it("asks the server nothing for a single character", async () => {
    act(() => root.render(<Harness kinds={["Students"]} />));
    await type("b");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("entityScope", () => {
  it("searches people and classes in Admin for admins, people only for teachers, nothing for auditors", () => {
    expect(entityScope("admin", { role: "super_admin" })).toEqual(["Students", "Classes"]);
    expect(entityScope("admin", { role: "admin" })).toEqual(["Students", "Classes"]);
    expect(entityScope("admin", { role: "teacher" })).toEqual(["Students"]);
    expect(entityScope("admin", { role: "test_auditor" })).toEqual([]);
  });

  it("searches questions in the Builder — never people, which its host refuses", () => {
    for (const role of ["super_admin", "test_admin", "test_auditor", "teacher"]) {
      expect(entityScope("builder", { role })).toEqual(["Questions"]);
    }
    expect(entityScope("builder", { role: "student" })).toEqual([]);
  });

  it("writes money the learning center's way", () => {
    expect(formatSom(1250000)).toBe("1 250 000 so'm");
  });
});
