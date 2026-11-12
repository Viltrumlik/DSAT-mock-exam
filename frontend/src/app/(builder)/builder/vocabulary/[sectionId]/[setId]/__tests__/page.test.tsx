/**
 * Builder Vocabulary — one set's words (PR 19): the target card ("N to go." / "N over …"), a row per word, Add word
 * and the in-place edit sending the same payload (synonyms split on semicolons), the set CSV import's result line,
 * Delete in the console dialog, and "Set not found".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  listSections: vi.fn(),
  listSets: vi.fn(),
  listWords: vi.fn(),
  createWord: vi.fn(),
  updateWord: vi.fn(),
  deleteWord: vi.fn(),
  importSetCsv: vi.fn(),
};
const toast = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ sectionId: "3", setId: "31" }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/features/vocabularyAdmin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/vocabularyAdmin/api")>()),
  vocabularyAdminApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: Page } = await import("../page");

const word = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  section: 3,
  word: `word${id}`,
  definition: `Definition ${id}`,
  part_of_speech: "noun",
  example: "",
  synonyms: [],
  ...over,
});
const WORDS = [
  word(101, {
    word: "ephemeral",
    part_of_speech: "adjective",
    definition: "Lasting for a very short time",
    example: "The morning dew is ephemeral.",
    synonyms: ["fleeting", "transient"],
  }),
  word(102, { word: "laconic", definition: "" }),
];

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
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
/** The control a visible label names (the form's ids come from useId). */
function field<T extends HTMLElement>(scope: ParentNode, label: string): T {
  const l = Array.from(scope.querySelectorAll("label")).find((x) => x.textContent?.replace("*", "").trim() === label)!;
  return document.getElementById(l.htmlFor) as T;
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const byLabel = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const row = (id: number) => host.querySelector<HTMLElement>(`li[data-word="${id}"]`)!;
const form = () => host.querySelector<HTMLFormElement>("form")!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), toast]) f.mockReset();
  api.listSections.mockResolvedValue([
    { id: 3, title: "College Panda", slug: "college-panda", description: "", order: 1, is_published: true, set_count: 1, word_count: 2 },
  ]);
  api.listSets.mockResolvedValue([{ id: 31, section: 3, title: "Set 1", order: 1, word_count: 2 }]);
  api.listWords.mockResolvedValue(WORDS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the set's words", () => {
  it("shows the breadcrumb, the target card and a row per word", async () => {
    await render();
    expect(api.listWords).toHaveBeenCalledWith(31);
    const crumbs = host.querySelector('nav[aria-label="Vocabulary"]')!;
    expect(crumbs.querySelector('a[href="/builder/vocabulary/3"]')!.textContent).toBe("College Panda");
    expect(crumbs.querySelector('[aria-current="page"]')!.textContent).toBe("Set 1");
    expect(host.querySelector("h1")!.textContent).toBe("Set 1");
    expect(host.textContent).toContain("College Panda · Words a student studies in all four modes.");
    expect(host.textContent).toContain("2 / 25 words");
    expect(host.textContent).toContain("23 to go.");
    expect(host.querySelector('section[aria-label="Words"]')!.textContent).toContain("2 words");

    expect(row(101).textContent).toContain("ephemeral");
    expect(row(101).textContent).toContain("Adjective");
    expect(row(101).textContent).toContain("Lasting for a very short time");
    expect(row(101).textContent).toContain("“The morning dew is ephemeral.”");
    expect(row(101).textContent).toContain("Synonyms: fleeting; transient");
    expect(row(102).textContent).toContain("—");
    expect(row(102).textContent).not.toContain("Synonyms");
  });

  it("says how far over the target a set is, and when it is reached", async () => {
    api.listWords.mockResolvedValue(Array.from({ length: 27 }, (_, i) => word(200 + i)));
    await render();
    expect(host.textContent).toContain("27 / 25 words");
    expect(host.textContent).toContain("2 over the 25-word target — fine to keep, but the study modes are tuned for 25.");

    act(() => root.unmount());
    root = createRoot(host);
    api.listWords.mockResolvedValue(Array.from({ length: 25 }, (_, i) => word(300 + i)));
    await render();
    expect(host.textContent).toContain("Target reached.");
  });

  it("shows the empty state, and says when the set is gone", async () => {
    api.listWords.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("No words in this set yet");
    expect(host.textContent).toContain("Add them one at a time, or import a CSV. A set targets 25 words.");

    act(() => root.unmount());
    root = createRoot(host);
    api.listSets.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("Set not found");
    expect(host.querySelector('a[href="/builder/vocabulary/3"]')!.textContent).toContain("College Panda");
    expect(buttonIn(host, "Add word")).toBeUndefined();
  });
});

describe("add and edit", () => {
  it("adds a word with the trimmed fields and the synonyms split on semicolons", async () => {
    api.createWord.mockResolvedValue(word(103, { word: "sanguine" }));
    await render();
    await click(buttonIn(host, "Add word"));
    expect(buttonIn(host, "Add word").disabled).toBe(true);
    const save = buttonIn(form(), "Save");
    expect(save.disabled).toBe(true);
    await type(field(form(), "Word"), " sanguine ");
    await choose(field(form(), "Part of speech"), "adjective");
    await type(field(form(), "Definition"), "Optimistic ");
    await type(field(form(), "Example sentence"), "She stayed sanguine.");
    await type(field(form(), "Synonyms"), "hopeful; upbeat ;; cheerful");
    expect(form().textContent).toContain("Separate with semicolons.");
    await click(buttonIn(form(), "Save"));
    expect(api.createWord).toHaveBeenCalledWith(31, {
      word: "sanguine",
      definition: "Optimistic",
      part_of_speech: "adjective",
      example: "She stayed sanguine.",
      synonyms: ["hopeful", "upbeat", "cheerful"],
    });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "“sanguine” added." });
    expect(host.querySelector("form")).toBeNull();
  });

  it("shows the server's words when a save fails, and keeps the form", async () => {
    api.createWord.mockRejectedValue({ response: { status: 400, data: { detail: "Already in this set." } } });
    await render();
    await click(buttonIn(host, "Add word"));
    await type(field(form(), "Word"), "ephemeral");
    await type(field(form(), "Definition"), "Short-lived");
    await click(buttonIn(form(), "Save"));
    expect(form().textContent).toContain("Already in this set.");
  });

  it("opens a word in place with its values and saves the same patch", async () => {
    api.updateWord.mockResolvedValue(WORDS[0]);
    await render();
    const toggle = byLabel("Edit ephemeral");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(toggle);
    expect(byLabel("Collapse ephemeral").getAttribute("aria-expanded")).toBe("true");
    const f = row(101).querySelector("form")!;
    expect(field<HTMLInputElement>(f, "Word").value).toBe("ephemeral");
    expect(field<HTMLSelectElement>(f, "Part of speech").value).toBe("adjective");
    expect(field<HTMLInputElement>(f, "Synonyms").value).toBe("fleeting; transient");
    // The row's own definition hides while it is open.
    expect(row(101).textContent).not.toContain("Synonyms: fleeting");

    await type(field(f, "Definition"), "Lasting a very short time");
    await click(buttonIn(f, "Save"));
    expect(api.updateWord).toHaveBeenCalledWith(101, {
      word: "ephemeral",
      definition: "Lasting a very short time",
      part_of_speech: "adjective",
      example: "The morning dew is ephemeral.",
      synonyms: ["fleeting", "transient"],
    });
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Word updated." });
    expect(row(101).querySelector("form")).toBeNull();
  });
});

describe("CSV import and delete", () => {
  it("uploads the picked file into this set and says what landed", async () => {
    api.importSetCsv.mockResolvedValue({ set_id: 31, created_count: 4, created_words: 1, linked_words: 3, word_ids: [1, 2, 3, 4] });
    await render();
    await click(buttonIn(host, "Import CSV"));
    expect(dialog()!.textContent).toContain("Import words into this set");
    expect(dialog()!.textContent).toContain("One word per row — every row lands in “Set 1”.");
    const input = document.getElementById("vocab-set-csv") as HTMLInputElement;
    const file = new File(["word,definition\n"], "set.csv", { type: "text/csv" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(api.importSetCsv).toHaveBeenCalledWith(31, file);
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toContain(
      "Imported 1 new word into this set · 3 existing words reused.",
    );
  });

  it("names the bad row when the import is refused", async () => {
    api.importSetCsv.mockRejectedValue({
      response: { status: 400, data: { detail: "Invalid CSV.", errors: [{ row: 7, errors: { word: ["Already in this set."] } }] } },
    });
    await render();
    await click(buttonIn(host, "Import CSV"));
    const input = document.getElementById("vocab-set-csv") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "bad.csv")], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Row 7 · word: Already in this set.");
  });

  it("deletes a word after asking", async () => {
    api.deleteWord.mockResolvedValue(undefined);
    await render();
    await click(byLabel("Delete laconic"));
    expect(dialog()!.textContent).toContain("Delete word?");
    expect(dialog()!.textContent).toContain("“laconic” is removed from the section bank and from every set that uses it.");
    await click(buttonIn(dialog()!, "Delete word"));
    expect(api.deleteWord).toHaveBeenCalledWith(102);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Word deleted." });
  });

  it("shows a refusal in the dialog", async () => {
    api.deleteWord.mockRejectedValue({ response: { status: 409, data: { detail: "This word is in live homework." } } });
    await render();
    await click(byLabel("Delete ephemeral"));
    await click(buttonIn(dialog()!, "Delete word"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("This word is in live homework.");
    expect(toast).not.toHaveBeenCalled();
  });
});
