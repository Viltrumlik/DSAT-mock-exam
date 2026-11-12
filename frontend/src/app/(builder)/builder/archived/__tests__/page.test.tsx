/**
 * Builder Archived (PR 20): only the inactive sets, each with Inactive, its subject, its questions and category,
 * the Questions and Open editor links; the empty state.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAllSets = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/assessmentsAdmin/api", () => ({
  assessmentsAdminApi: { listAllSets: (...a: unknown[]) => listAllSets(...a) },
}));

const { default: Page } = await import("../page");

const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const set = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Set ${id}`,
  subject: "math",
  category: "",
  is_active: true,
  questions: [],
  ...over,
});

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<Page />);
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
const row = (id: number) => host.querySelector<HTMLElement>(`li[data-set="${id}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listAllSets.mockReset();
  listAllSets.mockResolvedValue({
    results: [
      set(5, { is_active: false, subject: "english", title: "Old reading", category: "Reading", questions: qs(2) }),
      set(6, { is_active: false, title: "Empty draft" }),
      set(7, { title: "Live set", questions: qs(4) }),
    ],
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("archived", () => {
  it("lists only the inactive sets, with their links", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Archived Content");
    expect(host.querySelector('[role="note"]')!.textContent).toContain("Academic record preservation");
    expect(host.textContent).toContain("What counts as archived");
    expect(host.textContent).toContain("2 inactive sets");
    expect(Array.from(host.querySelectorAll<HTMLElement>("li[data-set]")).map((li) => li.dataset.set)).toEqual(["5", "6"]);

    expect(row(5).textContent).toContain("Old reading");
    expect(row(5).textContent).toContain("Inactive");
    expect(row(5).textContent).toContain("English");
    expect(row(5).textContent).toContain("2 questions · Reading");
    expect(row(5).querySelector('a[href="/builder/bank?setId=5"]')!.textContent).toContain("Questions");
    expect(row(5).querySelector('a[href="/builder/sets/5"]')!.textContent).toContain("Open editor");

    expect(row(6).textContent).toContain("Math");
    expect(row(6).textContent).toContain("0 questions");
    expect(host.textContent).not.toContain("Live set");
  });

  it("shows the empty state when every set is active", async () => {
    listAllSets.mockResolvedValue({ results: [set(7)] });
    await render();
    expect(host.textContent).toContain("0 inactive sets");
    expect(host.textContent).toContain("No archived content.");
    expect(host.textContent).toContain("All assessment sets are currently active.");
  });

  it("says when the sets could not load", async () => {
    listAllSets.mockRejectedValue(new Error("boom"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load assessment sets.");
  });
});
