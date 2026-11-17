/**
 * "+ New topic" under a midterm question's Topic picker (owner, 2026-11-17: "midtermda topicni admin o'zi
 * qo'shadigan qilib bering"): it adds the topic to the level's list, refreshes every picker, and hands the
 * new topic back so the question picks it. A refused name says why and keeps what was typed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/questionsAdmin/topicsApi", () => ({
  topicListsKey: ["questionbank", "topic-lists"],
  topicsApi: { create: (...a: unknown[]) => create(...a) },
}));

const { NewTopicInline } = await import("../NewTopicInline");

let host: HTMLElement;
let root: Root;
let qc: QueryClient;
const onCreated = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <NewTopicInline listId={5} listName="Junior Math" inputId="q1-new-topic" onCreated={onCreated} />
      </QueryClientProvider>,
    );
  });
}

const buttonNamed = (words: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  create.mockReset();
  onCreated.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("+ New topic", () => {
  it("starts closed, with a link to the Topics page", async () => {
    await render();
    expect(buttonNamed("New topic")).toBeTruthy();
    expect(host.querySelector('a[href="/builder/topics"]')!.textContent).toContain("Manage topics");
    expect(host.querySelector("#q1-new-topic")).toBeNull();
  });

  it("adds the typed name to the list, refreshes the pickers and hands the topic back", async () => {
    create.mockResolvedValue({ id: 99, name: "Quadratic Inequalities", code: "quadratic-inequalities", order: 27, retired: false, questions: 0, graded: 0 });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await render();
    await click(buttonNamed("New topic"));
    expect(host.textContent).toContain("New topic in Junior Math");
    await typeInto(host.querySelector<HTMLInputElement>("#q1-new-topic")!, "  Quadratic Inequalities ");
    await click(buttonNamed("Add"));
    await settle();
    expect(create).toHaveBeenCalledWith(5, "Quadratic Inequalities");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["questionbank", "taxonomy"] });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 99 }));
    // Closed again, ready for the next one.
    expect(host.querySelector("#q1-new-topic")).toBeNull();
  });

  it("says why a name was refused and keeps it typed", async () => {
    create.mockRejectedValue({ response: { status: 400, data: { detail: "'Percent' is already in Junior Math." } } });
    await render();
    await click(buttonNamed("New topic"));
    await typeInto(host.querySelector<HTMLInputElement>("#q1-new-topic")!, "percent");
    await click(buttonNamed("Add"));
    await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("already in Junior Math");
    expect(host.querySelector<HTMLInputElement>("#q1-new-topic")!.value).toBe("percent");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("does nothing with a blank name, and Cancel closes it", async () => {
    await render();
    await click(buttonNamed("New topic"));
    expect(buttonNamed("Add").disabled).toBe(true);
    await click(buttonNamed("Cancel"));
    expect(host.querySelector("#q1-new-topic")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
