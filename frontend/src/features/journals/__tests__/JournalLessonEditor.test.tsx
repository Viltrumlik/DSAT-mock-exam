/**
 * The session's homework editor in the console's look: the brief, the picked content (cart), the content tabs
 * (Pastpapers / Assessments / Vocabulary / Submission) with their searches, filters and empty states, the ready
 * line, and Save with the same payload — a refusal shows the server's words, or the editor's own.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { get: vi.fn(), lesson: vi.fn(), contentOptions: vi.fn(), saveLesson: vi.fn(), videoUploadUrl: vi.fn() };
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => "/ops/journals/3/lessons/12",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/journals/api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: JournalLessonEditor } = await import("../JournalLessonEditor");

const JOURNAL = { id: 3, subject: "ENGLISH", subject_label: "English", level: "middle", level_label: "Middle", display_title: "English Middle" };
function lesson(over: Record<string, unknown> = {}) {
  return {
    id: 12,
    journal_id: 3,
    lesson_number: 2,
    lesson_type: "HOMEWORK",
    status: "DRAFT",
    title: "",
    instructions: "",
    external_url: "",
    external_urls: [],
    external_url_labels: [],
    video_url: "",
    video_file_url: null,
    allow_file_upload: false,
    practice_scope: "BOTH",
    practice_test_ids: [],
    practice_test_pack_ids: [],
    vocabulary_set_ids: [],
    assessments: [],
    attachment_urls: [],
    midterm: null,
    ...over,
  };
}
const OPTIONS = {
  subject: "ENGLISH",
  level: "middle",
  practice_tests: [],
  practice_test_packs: [],
  assessment_sets: [
    { id: 31, title: "Inference drill", subject: "english", source: "SQB", category: "Reading", description: "", question_count: 12 },
    { id: 32, title: "Grammar set", subject: "english", source: "EXTERNAL", category: "", description: "", question_count: 8 },
  ],
  vocabulary_sections: [
    { id: 1, title: "College Panda", sets: [{ id: 101, title: "Set 1", word_count: 25 }, { id: 102, title: "Set 2", word_count: 20 }] },
  ],
};

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
    root.render(<JournalLessonEditor journalId={3} lessonId={12} />);
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
const tab = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === name)!;
const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!;
const card = (title: string) =>
  Array.from(panel().querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((b) => b.textContent?.includes(title))!;
const cart = () => Array.from(host.querySelectorAll<HTMLElement>("li[data-cart]")).map((li) => li.textContent);
const title = () => host.querySelector<HTMLInputElement>("#jl-title")!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), routerPush]) f.mockReset();
  api.get.mockResolvedValue(JOURNAL);
  api.lesson.mockResolvedValue(lesson());
  api.contentOptions.mockResolvedValue(OPTIONS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("loading", () => {
  it("shows the brief, the empty cart and the scoped assessments", async () => {
    await render();
    expect(api.contentOptions).toHaveBeenCalledWith("ENGLISH", "middle", 12);
    expect(host.querySelector("h1")!.textContent).toBe("Lesson 2 homework");
    expect(host.textContent).toContain("English Middle");
    expect(host.textContent).toContain("DRAFT");
    expect(host.querySelector('label[for="jl-title"]')!.textContent).toBe("Title");
    expect(host.querySelector('label[for="jl-inst"]')!.textContent).toBe("Instructions *");
    expect(host.textContent).toContain("Tell students exactly what to do — this is the main brief.");
    expect(host.textContent).toContain("Due at the next lesson");
    expect(host.textContent).toContain("Nothing selected yet. Add an assessment or past paper from the library.");
    expect(host.textContent).toContain("0 selected");
    expect(host.textContent).toContain("Add instructions for students.");

    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent?.trim())).toEqual([
      "Pastpapers",
      "Assessments",
      "Vocabulary",
      "Submission",
    ]);
    expect(tab("Assessments").getAttribute("aria-selected")).toBe("true");
    expect(card("Inference drill").textContent).toContain("SQB");
    expect(card("Inference drill").textContent).toContain("Reading");
    expect(card("Inference drill").textContent).toContain("12 questions");
    expect(panel().textContent).toContain("Only Middle english sets are shown — content is scoped to this journal's level.");
  });

  it("says when the lesson could not load, with the way back", async () => {
    api.lesson.mockRejectedValue(new Error("down"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load this lesson.");
    await click(buttonIn(host, "Back to journal"));
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/3");
  });
});

describe("picking content", () => {
  it("adds an assessment to the cart and names the homework after it, and removes it again", async () => {
    await render();
    await click(card("Inference drill"));
    expect(card("Inference drill").getAttribute("aria-pressed")).toBe("true");
    expect(cart()).toEqual(["Inference drillReading · 12 questions"]);
    expect(title().value).toBe("Inference drill");
    expect(host.textContent).toContain("1 selected");

    await click(host.querySelector('[aria-label="Remove Inference drill"]')!);
    expect(cart()).toEqual([]);
    expect(card("Inference drill").getAttribute("aria-pressed")).toBe("false");
  });

  it("searches and filters the assessments, and says when none match", async () => {
    await render();
    await type(panel().querySelector<HTMLInputElement>('input[placeholder="Search assessments…"]')!, "grammar");
    expect(card("Grammar set")).toBeDefined();
    expect(card("Inference drill")).toBeUndefined();
    await type(panel().querySelector<HTMLInputElement>('input[placeholder="Search assessments…"]')!, "");
    await choose(panel().querySelector<HTMLSelectElement>('select[aria-label="Source"]')!, "SQB");
    expect(card("Inference drill")).toBeDefined();
    expect(card("Grammar set")).toBeUndefined();
    await type(panel().querySelector<HTMLInputElement>('input[placeholder="Search assessments…"]')!, "zzz");
    expect(panel().textContent).toContain("No assessment sets found");
    expect(panel().textContent).toContain("Create middle english sets in the Builder console.");
  });

  it("shows the pastpapers' empty state", async () => {
    await render();
    await click(tab("Pastpapers"));
    expect(panel().textContent).toContain("No pastpapers match");
    expect(panel().textContent).toContain("Try clearing the search or filters.");
    expect(panel().querySelector('[role="radiogroup"][aria-label="Region"]')).not.toBeNull();
  });

  it("picks vocabulary sets section by section", async () => {
    await render();
    await click(tab("Vocabulary"));
    const section = panel().querySelector<HTMLButtonElement>('button[data-vocab-section="1"]')!;
    expect(section.textContent).toContain("2 sets · 45 words");
    await click(section);
    await click(panel().querySelector('button[data-vocab-set="101"]')!);
    expect(panel().textContent).toContain("1 of 2 selected");
    await click(buttonIn(panel(), "All sections"));
    expect(panel().querySelector('button[data-vocab-section="1"]')!.textContent).toContain("1 selected");
    expect(host.textContent).toContain("Add instructions for students.");
  });
});

describe("saving", () => {
  it("saves the same payload and goes back to the journal", async () => {
    api.saveLesson.mockResolvedValue(lesson());
    await render();
    await click(card("Inference drill"));
    await type(host.querySelector<HTMLTextAreaElement>("#jl-inst")!, "Do the drill.");
    expect(host.textContent).toContain("Ready to save.");
    await click(tab("Vocabulary"));
    await click(panel().querySelector('button[data-vocab-section="1"]')!);
    await click(panel().querySelector('button[data-vocab-set="102"]')!);
    await click(tab("Submission"));
    const toggle = panel().querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await click(buttonIn(host, "Save lesson"));
    expect(api.saveLesson).toHaveBeenCalledTimes(1);
    expect(api.saveLesson).toHaveBeenCalledWith(3, 12, {
      title: "Inference drill",
      instructions: "Do the drill.",
      external_urls: [],
      external_url_labels: [],
      video_url: "",
      allow_file_upload: true,
      practice_scope: "ENGLISH",
      assessment_set_ids: [31],
      vocabulary_set_ids: [102],
      practice_test_ids: [],
      practice_test_pack_ids: [],
    });
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/3");
  });

  it("says what the file switch alone needs", async () => {
    await render();
    await type(host.querySelector<HTMLTextAreaElement>("#jl-inst")!, "Do it.");
    expect(host.textContent).toContain("Add content, a file, or enable file upload.");
    await click(tab("Submission"));
    await click(panel().querySelector('[role="switch"]')!);
    expect(host.textContent).toContain("Ready to save.");
  });

  it("shows a refusal in the server's words, or its own", async () => {
    api.saveLesson.mockRejectedValueOnce({ response: { status: 400, data: { detail: "Instructions are required." } } });
    await render();
    await click(buttonIn(host, "Save lesson"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Instructions are required.");
    api.saveLesson.mockRejectedValueOnce(new Error("down"));
    await click(buttonIn(host, "Save lesson"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not save the lesson.");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("cancels back to the journal", async () => {
    await render();
    await click(buttonIn(host, "Cancel"));
    expect(routerPush).toHaveBeenCalledWith("/ops/journals/3");
    expect(api.saveLesson).not.toHaveBeenCalled();
  });
});
