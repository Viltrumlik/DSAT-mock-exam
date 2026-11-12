/**
 * Builder Vocabulary — sections (PR 19): the list with its counts, Create section with the same payload and the
 * jump into the new section, Rename and Publish with the same patches, and Delete in the console dialog — a 409
 * refusal shows the server's words there.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  listSections: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
};
const toast = vi.fn();
const routerPush = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/vocabularyAdmin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/vocabularyAdmin/api")>()),
  vocabularyAdminApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

function section(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Section ${id}`,
    slug: `section-${id}`,
    description: "",
    order: id,
    is_published: false,
    set_count: 2,
    word_count: 40,
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
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const card = (id: number) => host.querySelector<HTMLElement>(`article[data-section="${id}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), toast, routerPush]) f.mockReset();
  api.listSections.mockResolvedValue([
    section(1, { title: "College Panda", is_published: true, description: "Tier 1 words", set_count: 3, word_count: 75 }),
    section(2, { title: "650 Hard Words", set_count: 1, word_count: 1 }),
  ]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the sections list", () => {
  it("shows each section with its state and counts, and the totals", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Vocabulary");
    expect(card(1).textContent).toContain("#1 · College Panda");
    expect(card(1).textContent).toContain("Published");
    expect(card(1).textContent).toContain("Tier 1 words");
    expect(card(1).textContent).toContain("3 sets");
    expect(card(1).textContent).toContain("75 words");
    expect(card(2).textContent).toContain("Draft");
    expect(card(2).textContent).toContain("1 set");
    expect(card(2).textContent).toContain("1 word");
    expect(card(2).querySelector('a[href="/builder/vocabulary/2"]')).not.toBeNull();
    // Sections 2 · Sets 4 · Words 76.
    expect(host.textContent).toMatch(/Sections\s*2/);
    expect(host.textContent).toMatch(/Sets\s*4/);
    expect(host.textContent).toMatch(/Words\s*76/);
  });

  it("shows the empty state when there are no sections", async () => {
    api.listSections.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("No vocabulary sections yet");
  });
});

describe("create, rename, publish", () => {
  it("creates a section with the trimmed title and description, then opens it", async () => {
    api.createSection.mockResolvedValue(section(7, { title: "SAT Core" }));
    await render();
    const create = buttonIn(host, "Create section");
    expect(create.disabled).toBe(true);
    await type(document.getElementById("vocab-section-title") as HTMLInputElement, "  SAT Core ");
    await type(document.getElementById("vocab-section-description") as HTMLInputElement, " Everyday words ");
    await click(buttonIn(host, "Create section"));
    expect(api.createSection).toHaveBeenCalledWith({ title: "SAT Core", description: "Everyday words" });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Section “SAT Core” created." });
    expect(routerPush).toHaveBeenCalledWith("/builder/vocabulary/7");
  });

  it("renames in place with a title patch", async () => {
    api.updateSection.mockResolvedValue(section(2, { title: "700 Hard Words" }));
    await render();
    await click(byLabel("Rename section 650 Hard Words"));
    const field = card(2).querySelector<HTMLInputElement>('input[aria-label="Section title"]')!;
    expect(field.value).toBe("650 Hard Words");
    await type(field, "700 Hard Words");
    await click(buttonIn(card(2), "Save"));
    expect(api.updateSection).toHaveBeenCalledWith(2, { title: "700 Hard Words" });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Section renamed." });
  });

  it("publishes a draft and hides a published one", async () => {
    api.updateSection.mockImplementation(async (id: number, patch: { is_published: boolean }) => section(id, patch));
    await render();
    await click(buttonIn(card(2), "Publish"));
    expect(api.updateSection).toHaveBeenLastCalledWith(2, { is_published: true });
    expect(toast).toHaveBeenLastCalledWith({ tone: "success", message: "Section published." });
    await click(buttonIn(card(1), "Unpublish"));
    expect(api.updateSection).toHaveBeenLastCalledWith(1, { is_published: false });
    expect(toast).toHaveBeenLastCalledWith({ tone: "success", message: "Section hidden from students." });
  });
});

describe("delete", () => {
  it("asks first with the counts, and shows a 409 refusal in the dialog", async () => {
    api.deleteSection.mockRejectedValue({ response: { status: 409, data: { detail: "Set 3 is live homework." } } });
    await render();
    await click(byLabel("Delete section College Panda"));
    expect(dialog()!.textContent).toContain("Delete vocabulary section?");
    expect(dialog()!.textContent).toContain("“College Panda” and its 3 sets / 75 words will be permanently removed.");
    await click(buttonIn(dialog()!, "Delete section"));
    expect(api.deleteSection).toHaveBeenCalledWith(1);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Set 3 is live homework.");
    expect(toast).not.toHaveBeenCalled();
  });

  it("deletes and says so", async () => {
    api.deleteSection.mockResolvedValue(undefined);
    await render();
    await click(byLabel("Delete section 650 Hard Words"));
    expect(dialog()!.textContent).toContain("“650 Hard Words” and its 1 set / 1 word will be permanently removed.");
    await click(buttonIn(dialog()!, "Delete section"));
    expect(api.deleteSection).toHaveBeenCalledWith(2);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Section deleted." });
  });
});
