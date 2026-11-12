/**
 * /ops/journals in the console's look: the subject cards with their counts, the level grid with each journal's
 * state and progress, Create journal with the same call and the jump into the new journal, and the page's own
 * words when loading or creating fails.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { list: vi.fn(), create: vi.fn() };
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/features/journals/api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

function journal(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    subject: "MATH",
    subject_label: "Math",
    level: "junior",
    level_label: "Junior",
    title: "",
    display_title: `Journal ${id}`,
    status: "DRAFT",
    duration_months: 3,
    total_lessons: 36,
    version: 1,
    last_updated: "2026-11-01T09:00:00+05:00",
    progress: {
      sessions_total: 10, sessions_ready: 4, sessions_missing: 6,
      homework_total: 9, homework_ready: 4, homework_missing: 5,
      classwork_ready: 3, classwork_missing: 6,
      midterm_total: 1, midterm_count: 1, midterm_configured: 1,
      draft_count: 8, published_count: 2, completion_pct: 40,
    },
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
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const subjectCard = (code: string) => host.querySelector<HTMLButtonElement>(`button[data-subject="${code}"]`)!;
const levelCard = (lv: string) => host.querySelector<HTMLElement>(`[data-level="${lv}"]`)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), routerPush]) f.mockReset();
  api.list.mockResolvedValue({
    count: 2,
    results: [
      journal(5, { level: "junior", status: "PUBLISHED", progress: { ...journal(5).progress, completion_pct: 100 } }),
      journal(6, { level: "middle" }),
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

describe("subjects", () => {
  it("shows the header and each subject with its levels and how many journals are started", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Journals");
    expect(host.textContent).toContain("Pre-author every homework of a course, per level.");
    expect(subjectCard("MATH").textContent).toContain("Math");
    expect(subjectCard("MATH").textContent).toContain("4 levels · 2 journals started");
    expect(subjectCard("MATH").textContent).toContain("Foundation");
    expect(subjectCard("ENGLISH").textContent).toContain("3 levels · 0 journals started");
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("says when the journals could not load", async () => {
    api.list.mockRejectedValue(new Error("down"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load journals.");
  });
});

describe("levels", () => {
  it("shows each level's journal with its state and progress, and opens it", async () => {
    await render();
    await click(subjectCard("MATH"));
    expect(host.querySelector('nav[aria-label="Breadcrumb"]')!.textContent).toContain("Math");

    const junior = levelCard("junior");
    expect(junior.textContent).toContain("Junior");
    expect(junior.textContent).toContain("3 months · 36 lessons");
    expect(junior.textContent).toContain("PUBLISHED");
    expect(junior.textContent).toContain("100%");
    expect(junior.textContent).toContain("4/9 homework ready");
    expect(junior.textContent).toContain("1 midterm");
    expect(junior.textContent).toContain("Updated");
    expect(levelCard("middle").textContent).toContain("DRAFT");

    await click(junior);
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/5");
  });

  it("offers Create journal on a level without one, and opens the new journal", async () => {
    api.create.mockResolvedValue(journal(9, { level: "senior" }));
    await render();
    await click(subjectCard("MATH"));
    const senior = levelCard("senior");
    expect(senior.textContent).toContain("Not started");
    expect(senior.textContent).toContain("22 homework");
    expect(senior.textContent).toContain("2 midterms");
    await click(buttonIn(senior, "Create journal"));
    expect(api.create).toHaveBeenCalledWith("MATH", "senior");
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/9");
  });

  it("says when the journal could not be created", async () => {
    api.create.mockRejectedValue(new Error("nope"));
    await render();
    await click(subjectCard("ENGLISH"));
    await click(buttonIn(levelCard("junior"), "Create journal"));
    expect(api.create).toHaveBeenCalledWith("ENGLISH", "junior");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not create the journal.");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("goes back to the subjects", async () => {
    await render();
    await click(subjectCard("MATH"));
    await click(buttonIn(host, "Subjects"));
    expect(subjectCard("ENGLISH")).not.toBeNull();
  });
});
