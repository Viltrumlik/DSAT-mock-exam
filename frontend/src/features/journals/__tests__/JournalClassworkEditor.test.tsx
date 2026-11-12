/**
 * The session's classwork plan in the console's look: the timetable and its total, the homework review from the
 * previous session, the new topic's fields, the pick lists, the revision line, and Save with the same payload —
 * the editor's own words when loading or saving fails.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JournalDetail } from "../types";

const api = { classwork: vi.fn(), contentOptions: vi.fn(), saveClasswork: vi.fn(), videoUploadUrl: vi.fn() };

vi.mock("@/features/journals/api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { default: JournalClassworkEditor } = await import("../JournalClassworkEditor");

const JOURNAL = { id: 3, subject: "MATH", level: "junior" } as unknown as JournalDetail;

function classwork(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    timetable: [],
    total_minutes: 110,
    homework_review_minutes: 20,
    new_topic_minutes: 30,
    break_minutes: 10,
    exercises_minutes: 20,
    revision_minutes: 30,
    new_topic_title: "Linear equations",
    new_topic_instructions: "Teach slope.",
    new_topic_external_url: "",
    new_topic_external_urls: [],
    new_topic_external_url_labels: [],
    new_topic_video_url: "",
    new_topic_video_file_url: null,
    new_topic_practice_test_ids: [],
    new_topic_practice_test_pack_ids: [],
    new_topic_vocabulary_set_ids: [],
    new_topic_vocabulary: [],
    new_topic_assessments: [{ id: 1, assessment_set_id: 31, title: "Inference drill", subject: "math", level: "junior", source: "" }],
    new_topic_attachment_urls: [{ id: 4, name: "slides.pdf", url: "https://files.test/slides.pdf" }],
    exercise_practice_test_ids: [],
    exercise_practice_test_pack_ids: [],
    exercise_vocabulary_set_ids: [],
    exercise_vocabulary: [],
    exercise_assessments: [],
    revision_notes: "",
    revision_targets: { assessments: [], practice_test_ids: [], practice_test_pack_ids: [] },
    homework_review: {
      lesson_id: 11,
      lesson_number: 1,
      title: "Reading",
      instructions: "Read page one.",
      external_url: "",
      external_urls: ["https://example.com/slides"],
      external_url_labels: ["Slides"],
      video_url: "",
      video_file_url: null,
      assessments: [{ id: 5, assessment_set_id: 31, title: "Inference drill", subject: "math", level: "junior", source: "" }],
      practice_test_ids: [77],
      practice_test_pack_ids: [],
      attachment_urls: [{ id: 2, name: "notes.pdf", url: "https://files.test/notes.pdf" }],
      allow_file_upload: false,
    },
    is_ready: false,
    validation: [],
    ...over,
  };
}
const OPTIONS = {
  subject: "MATH",
  level: "junior",
  practice_tests: [{ id: 77, title: "May 2024", collection_name: "US" }],
  practice_test_packs: [],
  assessment_sets: [
    { id: 31, title: "Inference drill", subject: "math", category: "Algebra", description: "", question_count: 12 },
    { id: 32, title: "Grammar set", subject: "math", category: "", description: "", question_count: 8 },
  ],
  vocabulary_sections: [],
};

let host: HTMLElement;
let root: Root;
const onSaved = vi.fn();

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<JournalClassworkEditor journalId={3} lessonId={12} journal={JOURNAL} onSaved={onSaved} />);
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
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const block = (key: string) => host.querySelector<HTMLElement>(`section[data-block="${key}"]`)!;
// Found by the list's own name (jsdom's selector engine trips on "&" inside an attribute value).
const pickList = (title: string) =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-picklist]")).find((el) => el.dataset.picklist === title)!;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [...Object.values(api), onSaved]) f.mockReset();
  api.classwork.mockResolvedValue(classwork());
  api.contentOptions.mockResolvedValue(OPTIONS);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the plan", () => {
  it("shows the timetable, the homework review and the new topic as saved", async () => {
    await render();
    expect(api.classwork).toHaveBeenCalledWith(3, 12);
    expect(api.contentOptions).toHaveBeenCalledWith("MATH", "junior", 12);
    expect(host.textContent).toContain("Lesson timetable");
    expect(host.textContent).toContain("110 min total");
    expect(Array.from(host.querySelectorAll("thead th")).map((th) => th.textContent)).toEqual([
      "Stage", "Homework", "New topic", "Break", "Exercises", "Revision",
    ]);

    const review = block("HOMEWORK_REVIEW");
    expect(review.textContent).toContain("Session 1: Reading");
    expect(review.textContent).toContain("Read page one.");
    expect(review.textContent).toContain("Inference drillAssessment");
    expect(review.textContent).toContain("Past paper #77Past paper");
    expect(review.querySelector<HTMLAnchorElement>('a[href="https://files.test/notes.pdf"]')!.textContent).toContain("notes.pdf");
    expect(review.querySelector<HTMLAnchorElement>('a[href="https://example.com/slides"]')!.textContent).toBe("SlidesLink");

    expect(host.querySelector<HTMLInputElement>("#cw-title")!.value).toBe("Linear equations");
    expect(host.querySelector('label[for="cw-title"]')!.textContent).toBe("Title *");
    expect(host.querySelector<HTMLTextAreaElement>("#cw-inst")!.value).toBe("Teach slope.");
    expect(block("NEW_TOPIC").querySelector('a[href="https://files.test/slides.pdf"]')).not.toBeNull();
    expect(pickList("Assessments for the new topic").textContent).toContain("1 selected");
    expect(block("BREAK").textContent).toContain("No setup needed.");
    expect(block("REVISION").textContent).toContain("Add exercises above — revision re-opens them.");
    expect(host.textContent).toContain("Add a new-topic title and instructions to finish.");
  });

  it("says when the first session has nothing to review", async () => {
    api.classwork.mockResolvedValue(classwork({ homework_review: null }));
    await render();
    expect(block("HOMEWORK_REVIEW").textContent).toContain("This is the first session — there is no previous homework to review.");
  });

  it("adds up the minutes as a stage changes", async () => {
    await render();
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Break minutes"]')!, "15");
    expect(host.textContent).toContain("115 min total");
  });

  it("says when the plan could not load", async () => {
    api.classwork.mockRejectedValue(new Error("down"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load the classwork plan.");
  });
});

describe("pick lists", () => {
  it("searches a long list and says when nothing matches", async () => {
    api.contentOptions.mockResolvedValue({
      ...OPTIONS,
      assessment_sets: Array.from({ length: 6 }, (_, i) => ({ id: 40 + i, title: `Set ${i}`, subject: "math", category: "", description: "", question_count: 5 })),
    });
    await render();
    const list = pickList("Assessments");
    const search = list.querySelector<HTMLInputElement>('input[placeholder="Search assessments…"]')!;
    await type(search, "set 3");
    expect(list.querySelectorAll("button[aria-pressed]")).toHaveLength(1);
    await type(search, "zzz");
    expect(list.textContent).toContain("No matches for “zzz”.");
  });

  it("says when there is nothing to pick", async () => {
    api.contentOptions.mockResolvedValue({ ...OPTIONS, assessment_sets: [], practice_tests: [] });
    await render();
    expect(pickList("Assessments").textContent).toContain("No assessment sets for this level yet.");
    expect(pickList("Past papers & practice tests").textContent).toContain("No past papers for this subject.");
    expect(block("EXERCISES").textContent).toContain("No published vocabulary sets yet.");
  });
});

describe("saving", () => {
  it("saves the same payload and says when", async () => {
    const saved = classwork({ is_ready: true });
    api.saveClasswork.mockResolvedValue(saved);
    await render();
    await click(buttonIn(pickList("Assessments"), "Grammar set"));
    await click(buttonIn(pickList("Past papers & practice tests"), "May 2024"));
    expect(block("REVISION").textContent).toContain("Revision covers the 2 items selected in Exercises.");
    await type(host.querySelector<HTMLTextAreaElement>("#cw-rev")!, "Watch the signs.");
    await type(host.querySelector<HTMLInputElement>("#cw-title")!, "  Slope  ");

    await click(buttonIn(host, "Save classwork"));
    expect(api.saveClasswork).toHaveBeenCalledTimes(1);
    expect(api.saveClasswork).toHaveBeenCalledWith(3, 12, {
      homework_review_minutes: 20,
      new_topic_minutes: 30,
      break_minutes: 10,
      exercises_minutes: 20,
      revision_minutes: 30,
      new_topic_title: "Slope",
      new_topic_instructions: "Teach slope.",
      new_topic_external_urls: [],
      new_topic_external_url_labels: [],
      video_url: "",
      revision_notes: "Watch the signs.",
      new_topic_assessment_set_ids: [31],
      new_topic_practice_test_ids: [],
      exercise_assessment_set_ids: [32],
      exercise_practice_test_ids: [77],
      exercise_vocabulary_set_ids: [],
    });
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(host.textContent).toContain("Classwork ready.");
    expect(host.textContent).toMatch(/Classwork ready\. Saved .+\./);
  });

  it("says when the plan could not be saved", async () => {
    api.saveClasswork.mockRejectedValue(new Error("down"));
    await render();
    await click(buttonIn(host, "Save classwork"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not save the classwork plan.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
