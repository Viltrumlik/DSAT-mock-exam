/**
 * Builder full mock overview (PR 20): the header (title, Published / Draft, question count), Publish greyed with the
 * block reason, "Shorter than a real SAT", Save details with the same payload, Publish / Unpublish calling the same
 * API, the module links by section, and a failed load.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  getMock: vi.fn(),
  updateMock: vi.fn(),
  publishMock: vi.fn(),
  unpublishMock: vi.fn(),
};
const toast = vi.fn();
const recordRecent = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ mockId: "5" }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/console/recent", () => ({ recordRecent: (...a: unknown[]) => recordRecent(...a) }));
vi.mock("@/features/mocksAdmin/api", () => ({
  mocksAdminApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

const mod = (id: number, order: number, minutes: number, count: number, target: number | null) => ({
  id,
  module_order: order,
  time_limit_minutes: minutes,
  question_count: count,
  question_target: target,
});
function mock(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    title: "Mock November",
    break_minutes: 10,
    is_published: false,
    published_at: null,
    created_by: null,
    created_at: "2026-11-01T10:00:00Z",
    question_count: 79,
    sections: [
      { subject: "READING_WRITING", modules: [mod(51, 1, 32, 27, 27), mod(52, 2, 32, 20, 27)] },
      { subject: "MATH", modules: [mod(53, 1, 35, 22, 22), mod(54, 2, 35, 10, null)] },
    ],
    publish_ready: false,
    publish_block_reason: "Math module 2 has no questions.",
    publish_warnings: ["Reading & Writing module 2 has 20 of 27 questions."],
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
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
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), toast, recordRecent]) f.mockReset();
  api.getMock.mockResolvedValue(mock());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the full mock", () => {
  it("shows the header, the notes and the modules by section", async () => {
    await render();
    expect(api.getMock).toHaveBeenCalledWith(5);
    expect(recordRecent).toHaveBeenCalledWith({ kind: "mock", id: 5, name: "Mock November", href: "/builder/full-mocks/5" });
    expect(host.querySelector('a[href="/builder/full-mocks"]')!.textContent).toContain("Back to full mocks");
    expect(host.querySelector("h1")!.textContent).toBe("Mock November");
    const header = host.querySelector("header")!;
    expect(header.textContent).toContain("Draft");
    expect(header.textContent).toContain("79 questions");

    const publish = buttonIn(header, "Publish");
    expect(publish.disabled).toBe(true);
    expect(publish.title).toBe("Math module 2 has no questions.");
    expect(host.textContent).toContain("Math module 2 has no questions.");
    expect(host.textContent).toContain("Shorter than a real SAT");
    expect(host.textContent).toContain("Reading & Writing module 2 has 20 of 27 questions.");

    const sections = Array.from(host.querySelectorAll<HTMLElement>("section[aria-label]")).map((s) => s.getAttribute("aria-label"));
    expect(sections).toEqual(["Reading & Writing", "Math"]);
    const m51 = host.querySelector<HTMLAnchorElement>('a[data-module="51"]')!;
    expect(m51.getAttribute("href")).toBe("/builder/full-mocks/5/51");
    expect(m51.textContent).toContain("Module 1");
    expect(m51.textContent).toContain("32 min · 27 / 27 questions");
    expect(m51.textContent).toContain("Edit questions");
    expect(host.querySelector('a[data-module="54"]')!.textContent).toContain("35 min · 10 questions");
  });

  it("saves the trimmed title and the break", async () => {
    api.updateMock.mockResolvedValue(mock({ title: "Mock December", break_minutes: 15 }));
    await render();
    const save = buttonIn(host, "Save details");
    expect(save.disabled).toBe(true);
    await type(document.getElementById("mock-title") as HTMLInputElement, " Mock December ");
    await type(document.getElementById("mock-break") as HTMLInputElement, "15");
    await click(buttonIn(host, "Save details"));
    expect(api.updateMock).toHaveBeenCalledWith(5, { title: "Mock December", break_minutes: 15 });
    expect(toast).toHaveBeenCalledWith({ message: "Mock details saved.", tone: "success" });
    expect(api.getMock).toHaveBeenCalledTimes(2);
  });

  it("publishes a ready draft and unpublishes a published one", async () => {
    api.getMock.mockResolvedValue(mock({ publish_ready: true, publish_block_reason: "", publish_warnings: [] }));
    api.publishMock.mockResolvedValue(mock({ is_published: true }));
    await render();
    expect(host.textContent).not.toContain("Shorter than a real SAT");
    const publish = buttonIn(host.querySelector("header")!, "Publish");
    expect(publish.disabled).toBe(false);
    await click(publish);
    expect(api.publishMock).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith({ message: "Mock published.", tone: "success" });

    act(() => root.unmount());
    root = createRoot(host);
    api.getMock.mockResolvedValue(mock({ is_published: true, publish_ready: true }));
    api.unpublishMock.mockRejectedValue({ response: { data: { detail: "Students are sitting this mock." } } });
    await render();
    const header = host.querySelector("header")!;
    expect(header.textContent).toContain("Published");
    await click(buttonIn(header, "Unpublish"));
    expect(api.unpublishMock).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith({ message: "Students are sitting this mock.", tone: "error" });
  });

  it("shows the server's words when the mock cannot load", async () => {
    api.getMock.mockRejectedValue({ response: { data: { detail: "Not found." } } });
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Not found.");
    expect(host.querySelector('a[href="/builder/full-mocks"]')).not.toBeNull();
  });
});
