/**
 * Builder Categories (PR 20): the sets grouped by their trimmed category, "(Uncategorised)" last, the set and
 * question counts, the Math / English pills, the View questions link, the empty state and the load error.
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
const row = (name: string) => host.querySelector<HTMLElement>(`li[data-category="${name}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listAllSets.mockReset();
  listAllSets.mockResolvedValue({
    results: [
      set(1, { category: "Algebra", questions: qs(3) }),
      set(2, { category: " Algebra ", subject: "english", questions: qs(2) }),
      set(3, { category: "", questions: qs(1) }),
      set(4, { category: "Geometry" }),
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

describe("categories", () => {
  it("groups the sets by category with their counts, Uncategorised last", async () => {
    await render();
    expect(listAllSets).toHaveBeenCalledTimes(1);
    expect(host.querySelector("h1")!.textContent).toBe("Categories");
    expect(host.querySelector('[role="note"]')!.textContent).toContain("Category management is set-level");
    expect(host.querySelector('[role="note"] a[href="/builder/sets"]')).not.toBeNull();
    expect(host.textContent).toContain("3 categories");
    expect(Array.from(host.querySelectorAll<HTMLElement>("li[data-category]")).map((li) => li.dataset.category)).toEqual([
      "Algebra",
      "Geometry",
      "(Uncategorised)",
    ]);

    expect(row("Algebra").textContent).toContain("2 sets · 5 questions");
    expect(row("Algebra").textContent).toContain("Math · 3");
    expect(row("Algebra").textContent).toContain("English · 2");
    expect(row("Algebra").querySelector("a")!.getAttribute("href")).toBe("/builder/bank?category=Algebra");

    expect(row("Geometry").textContent).toContain("1 set · 0 questions");
    expect(row("Geometry").textContent).not.toContain("Math ·");

    const none = row("(Uncategorised)");
    expect(none.textContent).toContain("1 set · 1 question");
    expect(none.querySelector("p")!.className).toContain("italic");
    expect(none.querySelector("a")!.getAttribute("href")).toBe("/builder/bank?category=(Uncategorised)");
  });

  it("shows the empty state with a way to Assessments", async () => {
    listAllSets.mockResolvedValue({ results: [] });
    await render();
    expect(host.textContent).toContain("0 categories");
    expect(host.textContent).toContain("No categories found.");
    expect(host.textContent).toContain("Add categories when creating assessment sets in Assessments.");
  });

  it("says when the sets could not load", async () => {
    listAllSets.mockRejectedValue(new Error("boom"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load assessment sets.");
  });
});
