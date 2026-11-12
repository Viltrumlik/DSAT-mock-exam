/**
 * The Full mocks library (PR 15a): a card per mock with its cover (the test's shape and length), Incomplete with
 * what is missing, the status chips, and Publish / Delete calling the same API as before.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminMock } from "@/features/mocksAdmin/api";

const listMocks = vi.fn();
const publishMock = vi.fn();
const unpublishMock = vi.fn();
const deleteMock = vi.fn();
const push = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push }) }));
vi.mock("@/features/mocksAdmin/api", () => ({
  mocksAdminApi: {
    listMocks: (...a: unknown[]) => listMocks(...a),
    publishMock: (...a: unknown[]) => publishMock(...a),
    unpublishMock: (...a: unknown[]) => unpublishMock(...a),
    deleteMock: (...a: unknown[]) => deleteMock(...a),
    createMock: vi.fn(),
  },
}));

const { default: Page } = await import("../page");

function mock(id: number, over: Partial<AdminMock> & { counts?: [number, number, number, number] } = {}): AdminMock {
  const [r1, r2, m1, m2] = over.counts ?? [27, 27, 22, 22];
  const mod = (mid: number, order: number, count: number, target: number, mins: number) => ({
    id: mid,
    module_order: order,
    time_limit_minutes: mins,
    question_count: count,
    question_target: target,
  });
  return {
    id,
    title: `Full Mock ${id}`,
    break_minutes: 10,
    is_published: false,
    published_at: null,
    created_by: 1,
    created_at: "2026-11-01T10:00:00Z",
    sections: [
      { subject: "READING_WRITING", modules: [mod(id * 10 + 1, 1, r1, 27, 32), mod(id * 10 + 2, 2, r2, 27, 32)] },
      { subject: "MATH", modules: [mod(id * 10 + 3, 1, m1, 22, 35), mod(id * 10 + 4, 2, m2, 22, 35)] },
    ],
    question_count: r1 + r2 + m1 + m2,
    publish_ready: true,
    publish_block_reason: "",
    publish_warnings: [],
    ...over,
  } as AdminMock;
}

let host: HTMLElement;
let root: Root;

async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <Page />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const cards = () => Array.from(host.querySelectorAll("article"));
const card = (title: string) => cards().find((a) => a.textContent?.includes(title))!;
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [listMocks, publishMock, unpublishMock, deleteMock, push]) f.mockReset();
  listMocks.mockResolvedValue([
    mock(1, { is_published: true }),
    mock(2, { counts: [27, 19, 0, 22], publish_ready: false, publish_block_reason: "Math module 1 has no questions." }),
    mock(3),
  ]);
  publishMock.mockResolvedValue({});
  deleteMock.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the full mocks library", () => {
  it("draws each mock's cover: its modules and break, and its length", async () => {
    await render();
    expect(cards()).toHaveLength(3);
    const first = card("#1 · Full Mock 1");
    // R&W 1, R&W 2, the break, Math 1, Math 2 — and 32 + 32 + 10 + 35 + 35 minutes.
    expect(first.querySelectorAll("[title]")).toHaveLength(5);
    expect(first.querySelector('[title="Math · Module 1 · 22 / 22 questions · 35 min"]')).not.toBeNull();
    expect(first.textContent).toContain("2:24:00");
    expect(first.textContent).toContain("Published");
    expect(first.textContent).toContain("98 questions · 10 min break");
  });

  it("says a draft is incomplete, how much is missing, and why it cannot publish", async () => {
    await render();
    const draft = card("#2 · Full Mock 2");
    expect(draft.textContent).toContain("Incomplete");
    expect(draft.textContent).toContain("30 questions missing");
    expect(draft.textContent).toContain("Math module 1 has no questions.");
    expect(buttonIn(draft, "Publish").disabled).toBe(true);
    expect(card("#3 · Full Mock 3").textContent).not.toContain("Incomplete");
  });

  it("filters by status with the chips, each with its count", async () => {
    await render();
    const drafts = buttonIn(host, "Drafts");
    expect(drafts.textContent).toContain("2");
    await click(drafts);
    expect(drafts.getAttribute("aria-pressed")).toBe("true");
    expect(cards().map((a) => a.querySelector("a[href]")!.getAttribute("href"))).toEqual(["/builder/full-mocks/2", "/builder/full-mocks/3"]);
    await click(buttonIn(host, "Published"));
    expect(cards()).toHaveLength(1);
  });

  it("publishes a ready draft with the same call", async () => {
    await render();
    await click(buttonIn(card("#3 · Full Mock 3"), "Publish"));
    expect(publishMock).toHaveBeenCalledWith(3);
  });

  it("asks before deleting, then deletes with the same call", async () => {
    await render();
    await click(card("#3 · Full Mock 3").querySelector<HTMLButtonElement>('button[aria-label="Delete mock Full Mock 3"]')!);
    expect(document.body.textContent).toContain("Delete full mock?");
    expect(document.body.textContent).toContain("and all of its modules and questions will be permanently removed.");
    await click(buttonIn(document.body, "Delete mock"));
    expect(deleteMock).toHaveBeenCalledWith(3);
  });
});
