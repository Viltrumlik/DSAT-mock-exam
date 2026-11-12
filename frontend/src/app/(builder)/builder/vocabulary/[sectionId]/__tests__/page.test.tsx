/**
 * Builder Vocabulary — one section's sets (PR 19): the breadcrumb and header, the word-count meter with "N over",
 * Create set and Rename with the same payloads, the section CSV import's result line, Delete in the console
 * dialog, and "Section not found".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  listSections: vi.fn(),
  listSets: vi.fn(),
  createSet: vi.fn(),
  updateSet: vi.fn(),
  deleteSet: vi.fn(),
  importSectionCsv: vi.fn(),
};
const toast = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ sectionId: "3" }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/vocabularyAdmin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/vocabularyAdmin/api")>()),
  vocabularyAdminApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

const SECTION = {
  id: 3,
  title: "College Panda",
  slug: "college-panda",
  description: "Tier 1 words",
  order: 1,
  is_published: true,
  set_count: 2,
  word_count: 39,
};
const set = (id: number, title: string, word_count: number) => ({ id, section: 3, title, order: id, word_count });

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
const row = (id: number) => host.querySelector<HTMLElement>(`li[data-set="${id}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), toast]) f.mockReset();
  api.listSections.mockResolvedValue([SECTION]);
  api.listSets.mockResolvedValue([set(31, "Set 1", 12), set(32, "Set 2", 27)]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the section's sets", () => {
  it("shows the breadcrumb, the header and a row per set with the meter", async () => {
    await render();
    expect(api.listSets).toHaveBeenCalledWith(3);
    const crumbs = host.querySelector('nav[aria-label="Vocabulary"]')!;
    expect(crumbs.querySelector('a[href="/builder/vocabulary"]')!.textContent).toContain("Vocabulary");
    expect(crumbs.querySelector('[aria-current="page"]')!.textContent).toBe("College Panda");
    expect(host.querySelector("h1")!.textContent).toBe("College Panda");
    expect(host.textContent).toContain("Tier 1 words");

    expect(row(31).textContent).toContain("#31 · Set 1");
    expect(row(31).textContent).toContain("12 / 25");
    expect(row(31).textContent).not.toContain("over");
    expect(row(32).textContent).toContain("27 / 25");
    expect(row(32).textContent).toContain("2 over");
    expect(row(32).querySelector('a[href="/builder/vocabulary/3/32"]')).not.toBeNull();
  });

  it("says when the section is gone", async () => {
    api.listSections.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("Section not found");
    expect(host.querySelector('a[href="/builder/vocabulary"]')).not.toBeNull();
  });
});

describe("create and rename", () => {
  it("creates a set with the trimmed title", async () => {
    api.createSet.mockResolvedValue(set(33, "Set 3", 0));
    await render();
    const field = document.getElementById("vocab-set-title") as HTMLInputElement;
    expect(field.placeholder).toBe("e.g. Set 3");
    await type(field, " Set 3  ");
    await click(buttonIn(host, "Create set"));
    expect(api.createSet).toHaveBeenCalledWith(3, { title: "Set 3" });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Set “Set 3” created." });
  });

  it("renames a set in place", async () => {
    api.updateSet.mockResolvedValue(set(31, "Warm-up", 12));
    await render();
    await click(byLabel("Rename set Set 1"));
    const field = row(31).querySelector<HTMLInputElement>('input[aria-label="Set title"]')!;
    await type(field, "Warm-up");
    await click(buttonIn(row(31), "Save"));
    expect(api.updateSet).toHaveBeenCalledWith(31, { title: "Warm-up" });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Set renamed." });
  });
});

describe("CSV import and delete", () => {
  it("uploads the picked file and says what landed", async () => {
    api.importSectionCsv.mockResolvedValue({ section_id: 3, created_sets: 2, created_words: 20, linked_words: 5, set_ids: [33, 34] });
    await render();
    await click(buttonIn(host, "Import CSV"));
    expect(dialog()!.textContent).toContain("Import words into this section");
    expect(dialog()!.textContent).toContain("set,word,definition,part_of_speech,example,synonyms");
    const input = document.getElementById("vocab-section-csv") as HTMLInputElement;
    const file = new File(["set,word,definition\n"], "words.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(api.importSectionCsv).toHaveBeenCalledWith(3, file);
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toContain(
      "Imported 20 new words into 2 new sets · 5 existing words reused.",
    );
  });

  it("deletes a set after asking, and shows a 409 refusal in the dialog", async () => {
    api.deleteSet.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Assigned as homework to 2 classes." } } });
    api.deleteSet.mockResolvedValueOnce(undefined);
    await render();
    await click(byLabel("Delete set Set 2"));
    expect(dialog()!.textContent).toContain("Delete vocabulary set?");
    expect(dialog()!.textContent).toContain("“Set 2” will be removed from this section. Its words stay in the section bank.");
    await click(buttonIn(dialog()!, "Delete set"));
    expect(api.deleteSet).toHaveBeenCalledWith(32);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Assigned as homework to 2 classes.");
    await click(buttonIn(dialog()!, "Delete set"));
    expect(api.deleteSet).toHaveBeenCalledTimes(2);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Set deleted." });
  });
});
