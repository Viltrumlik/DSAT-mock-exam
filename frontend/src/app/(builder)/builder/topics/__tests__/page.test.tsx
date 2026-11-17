/**
 * /builder/topics (owner, 2026-11-17: "midtermda topicni admin o'zi qo'shadigan qilib bering"): each level's
 * list in its order, add, rename, move, retire, restore, delete only when unused, and a polite wall for a
 * non-admin.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TopicList, TopicRow } from "@/features/questionsAdmin/topicsApi";

const api = {
  lists: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/questionsAdmin/topicsApi", () => ({
  topicListsKey: ["questionbank", "topic-lists"],
  topicsApi: {
    lists: (...a: unknown[]) => api.lists(...a),
    create: (...a: unknown[]) => api.create(...a),
    update: (...a: unknown[]) => api.update(...a),
    reorder: (...a: unknown[]) => api.reorder(...a),
    remove: (...a: unknown[]) => api.remove(...a),
  },
}));

const { default: Page } = await import("../page");

const topic = (id: number, name: string, order: number, over: Partial<TopicRow> = {}): TopicRow => ({
  id,
  name,
  code: name.toLowerCase(),
  order,
  retired: false,
  questions: 0,
  graded: 0,
  ...over,
});

const junior = (): TopicList => ({
  id: 5,
  name: "Junior Math",
  subject: "MATH",
  level: "junior",
  level_label: "Junior",
  topics: [
    topic(1, "Percent", 0, { questions: 4, graded: 30 }),
    topic(2, "Circles", 1),
    topic(3, "Angles", 2, { retired: true, questions: 2 }),
    topic(4, "Proportion", 3),
  ],
});

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const row = (id: number) => host.querySelector<HTMLElement>(`li[data-topic="${id}"]`)!;
const within = (el: HTMLElement, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === words || b.getAttribute("aria-label") === words,
  );
const activeNames = () =>
  Array.from(host.querySelectorAll<HTMLElement>("ol > li[data-topic] p.font-semibold")).map((p) => p.textContent);

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(api).forEach((f) => f.mockReset().mockResolvedValue(undefined));
  api.lists.mockResolvedValue([junior()]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("/builder/topics", () => {
  it("lists the active topics in order, with how much each is used, and the retired ones apart", async () => {
    await render();
    expect(host.textContent).toContain("Midterm topics");
    expect(host.textContent).toContain("Junior · 3 topics · 1 retired");
    expect(activeNames()).toEqual(["Percent", "Circles", "Proportion"]);
    expect(row(1).textContent).toContain("4 questions · 30 graded answers");
    expect(row(2).textContent).toContain("Not used yet");
    const retired = host.querySelector<HTMLElement>("details[data-retired]")!;
    expect(retired.textContent).toContain("Retired (1)");
    expect(retired.textContent).toContain("Angles");
  });

  it("offers Delete only on a topic nothing uses", async () => {
    await render();
    expect(within(row(1), "Delete Percent")).toBeUndefined();
    expect(within(row(2), "Delete Circles")).toBeTruthy();
  });

  it("adds a topic", async () => {
    await render();
    await typeInto(host.querySelector<HTMLInputElement>("#new-topic-5")!, "Quadratic Equations");
    await click(within(host, "Add topic")!);
    expect(api.create).toHaveBeenCalledWith(5, "Quadratic Equations");
    expect(api.lists).toHaveBeenCalledTimes(2);
    expect(host.querySelector<HTMLInputElement>("#new-topic-5")!.value).toBe("");
  });

  it("renames a topic inline", async () => {
    await render();
    await click(within(row(1), "Rename")!);
    await typeInto(row(1).querySelector<HTMLInputElement>("input")!, "Foiz");
    await click(within(row(1), "Save")!);
    expect(api.update).toHaveBeenCalledWith(1, { name: "Foiz" });
  });

  it("moves a topic among the active ones, sending every topic of the list", async () => {
    await render();
    expect(within(row(1), "Move Percent up")!.disabled).toBe(true);
    await click(within(row(4), "Move Proportion up")!);
    // Proportion swaps with Circles; the retired Angles keeps its place.
    expect(api.reorder).toHaveBeenCalledWith(5, [1, 4, 3, 2]);
  });

  it("retires and restores", async () => {
    await render();
    await click(within(row(2), "Retire")!);
    expect(api.update).toHaveBeenCalledWith(2, { retired: true });
    await click(within(row(3), "Restore")!);
    expect(api.update).toHaveBeenCalledWith(3, { retired: false });
  });

  it("asks before deleting", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await render();
    await click(within(row(2), "Delete Circles")!);
    expect(api.remove).not.toHaveBeenCalled();
    await click(within(row(2), "Delete Circles")!);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.remove).toHaveBeenCalledWith(2);
  });

  it("shows the server's reason when a write is refused", async () => {
    api.create.mockRejectedValue({ response: { status: 400, data: { detail: "'Percent' is already in Junior Math." } } });
    await render();
    await typeInto(host.querySelector<HTMLInputElement>("#new-topic-5")!, "percent");
    await click(within(host, "Add topic")!);
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("already in Junior Math");
    expect(host.querySelector<HTMLInputElement>("#new-topic-5")!.value).toBe("percent");
  });

  it("tells a non-admin the lists are the admins'", async () => {
    api.lists.mockRejectedValue({ response: { status: 403, data: { detail: "Only admins manage topic lists." } } });
    await render();
    expect(host.textContent).toContain("Only admins manage topics.");
    expect(host.querySelector("[data-topic-list]")).toBeNull();
  });
});
