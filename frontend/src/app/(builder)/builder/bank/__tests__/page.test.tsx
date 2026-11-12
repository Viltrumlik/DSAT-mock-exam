/**
 * Builder Old sets bank (PR 20): the tiles, a row per question (type, set, In use / Free, category, points,
 * state, Open in set), the subject select refetching with the subject, the type / status / set filters, the
 * search, Reset filters, and the 150-row cap.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listAllSets = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className, title }: { children: React.ReactNode; href: string; className?: string; title?: string }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/assessmentsAdmin/api", () => ({
  assessmentsAdminApi: { listAllSets: (...a: unknown[]) => listAllSets(...a) },
}));

const { default: Page } = await import("../page");

const question = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  prompt: `Question ${id}`,
  question_type: "multiple_choice",
  is_active: true,
  points: 1,
  ...over,
});
const SETS = [
  {
    id: 1,
    title: "Algebra basics",
    subject: "math",
    category: "Algebra",
    is_active: true,
    questions: [question(1, { prompt: "Solve 2x + 3 = 7" }), question(2, { prompt: "Find the slope", question_type: "numeric", is_active: false, points: 2 })],
  },
  {
    id: 2,
    title: "Reading set",
    subject: "english",
    category: "",
    is_active: false,
    questions: [question(3, { prompt: "Which choice best states the main idea?", question_type: "short_text" })],
  },
];

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
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
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const rows = () => Array.from(host.querySelectorAll<HTMLElement>("li[data-question]")).map((li) => li.dataset.question);
const row = (key: string) => host.querySelector<HTMLElement>(`li[data-question="${key}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listAllSets.mockReset();
  listAllSets.mockResolvedValue({ results: SETS });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the bank", () => {
  it("shows the tiles and a row per question", async () => {
    await render();
    expect(listAllSets).toHaveBeenCalledWith(undefined);
    expect(host.querySelector("h1")!.textContent).toBe("Old sets bank");
    expect(host.querySelector('a[href="/builder/sets"]')!.textContent).toContain("Add questions via set");
    expect(host.textContent).toMatch(/Total\s*3/);
    expect(host.textContent).toMatch(/Active\s*2/);
    expect(host.textContent).toMatch(/Sets\s*2/);
    expect(host.textContent).toMatch(/Inactive\s*1/);
    expect(host.textContent).toContain("3 questions");
    // The domain lists active questions first, then by set.
    expect(rows()).toEqual(["1-1", "2-3", "1-2"]);

    const first = row("1-1");
    expect(first.textContent).toContain("Solve 2x + 3 = 7");
    expect(first.textContent).toContain("MC");
    expect(first.querySelector('a[href="/builder/sets/1"]')!.textContent).toBe("Algebra basics");
    expect(first.textContent).toContain("edits create new revision");
    expect(first.textContent).toContain("Algebra");
    expect(first.textContent).toContain("1pt");
    expect(first.textContent).toContain("In use");
    const open = first.querySelector<HTMLAnchorElement>('a[href="/builder/sets/1?questionId=1"]')!;
    expect(open.textContent).toContain("Open in set →");
    expect(open.title).toBe('Open in set "Algebra basics"');

    expect(row("1-2").textContent).toContain("Numeric");
    expect(row("1-2").textContent).toContain("2pt");
    expect(row("1-2").textContent).toContain("Archived");

    expect(row("2-3").textContent).toContain("Text");
    expect(row("2-3").textContent).toContain("Free");
    expect(row("2-3").textContent).toContain("Active");
  });

  it("refetches with the subject the select names", async () => {
    await render();
    await choose(host.querySelector<HTMLSelectElement>('select[aria-label="Subject"]')!, "math");
    expect(listAllSets).toHaveBeenLastCalledWith({ subject: "math" });
  });

  it("filters by type, status and set, and Reset filters brings them all back", async () => {
    await render();
    const toggle = buttonIn(host, "Filters");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await choose(document.getElementById("bank-type") as HTMLSelectElement, "numeric");
    expect(rows()).toEqual(["1-2"]);
    expect(host.textContent).toContain("3 total");

    await choose(document.getElementById("bank-type") as HTMLSelectElement, "all");
    await choose(document.getElementById("bank-status") as HTMLSelectElement, "active");
    expect(rows()).toEqual(["1-1", "2-3"]);

    await choose(document.getElementById("bank-set") as HTMLSelectElement, "2");
    expect(rows()).toEqual(["2-3"]);

    await click(buttonIn(host, "Reset filters"));
    expect(rows()).toEqual(["1-1", "2-3", "1-2"]);
    expect((document.getElementById("bank-set") as HTMLSelectElement).value).toBe("all");
  });

  it("searches the prompt, the set and the category", async () => {
    await render();
    const input = host.querySelector<HTMLInputElement>('form[role="search"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "slope");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    await settle();
    expect(rows()).toEqual(["1-2"]);
    expect(host.textContent).toContain("1 question");
  });

  it("caps the list at 150 and says so", async () => {
    listAllSets.mockResolvedValue({
      results: [{ ...SETS[0], questions: Array.from({ length: 151 }, (_, i) => question(i + 1)) }],
    });
    await render();
    expect(host.textContent).toContain("151 questions (showing first 150)");
    expect(rows()).toHaveLength(150);
    expect(host.textContent).toContain("Showing 150 of 151 results — narrow your search to see more.");
  });

  it("shows the empty state, and the server's words on a failed load", async () => {
    listAllSets.mockResolvedValue({ results: [] });
    await render();
    expect(host.textContent).toContain("No questions match your filters.");

    act(() => root.unmount());
    root = createRoot(host);
    listAllSets.mockRejectedValue({ response: { data: { detail: "Not allowed." } } });
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Not allowed.");
  });
});
