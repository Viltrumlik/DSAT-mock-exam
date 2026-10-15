/**
 * Practice tests as homework: the teacher's picker, the student's launcher, the results page.
 *
 * A practice test is a past-paper row with a number and a level, so picking one writes its id into
 * the SAME `selectedTestIds` set the past papers use and it travels as `practice_test_ids` —
 * grant, grade and launcher are then shared with past papers, not duplicated. The old
 * "practice test packs" tab (a different table, a different payload key) is gone, and with it
 * `practice_test_pack_ids`: a form that still sent it would be attaching something this tab
 * cannot show.
 *
 * Three small honesty rules ride along. The launcher says "Open Practice Test" for a practice
 * test, never "Open Past Paper". The results page filters on Practice Test. And a row sat without
 * the clock says so, because 1,520 on an untimed sitting is not the same number as 1,520 on a
 * timed one.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAssignment = vi.fn();
const getAssignmentOptions = vi.fn();
const useUnifiedResults = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    getAssignmentOptions: (...args: unknown[]) => getAssignmentOptions(...args),
    updateAssignment: vi.fn(),
    createAssignment: (...args: unknown[]) => createAssignment(...args),
    videoUploadUrl: vi.fn(),
  },
}));

// The results page reads one query hook; everything else on it is plain rendering.
vi.mock("../hooks", () => ({
  useUnifiedResults: (...args: unknown[]) => useUnifiedResults(...args),
}));

const AssignmentForm = (await import("../pages/AssignmentForm")).default;
const { Results } = await import("../pages/Results");
const { contentActions } = await import("../homeworkApi");
type AssignmentDetail = import("../homeworkApi").AssignmentDetail;

/** One past paper, and one practice test that is Homework only (hidden from students until set). */
const OPTIONS = {
  practice_tests: [
    {
      id: 3,
      title: "SAT March 2026 Form A",
      subject: "MATH",
      label: "A",
      form_type: "US",
      practice_date: "2026-03-01",
      created_at: null,
      mock_exam: null,
      collection_name: "March 2026 US A",
      is_published: true,
      already_assigned: false,
    },
  ],
  practice_test_items: [
    {
      id: 9,
      number: 4,
      title: "Algebra focus",
      subject: "MATH",
      level: "middle",
      access: "homework_only",
      already_assigned: false,
    },
  ],
  assessment_sets: [],
  practice_test_packs: [],
  vocabulary_sections: [],
  classroom_subject: "MATH",
  classroom_level: "middle",
};

let container: HTMLDivElement;
let root: Root;

async function renderForm() {
  await act(async () => {
    root.render(<AssignmentForm classId={34} onCancel={() => {}} onSaved={() => {}} />);
  });
}

/** Buttons can wear a count badge ("Publish assignment1"), so match the label before the digits. */
function buttonLabelled(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => {
    const label = (b.textContent || "").trim();
    return label === text || new RegExp(`^${text}\\d+$`).test(label);
  }) as HTMLButtonElement | undefined;
}

/** The pick-card button whose text contains `text`. */
function cardWith(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button[aria-pressed]")].find((b) =>
    (b.textContent || "").includes(text),
  ) as HTMLButtonElement | undefined;
}

const shownText = () => (container.textContent || "").replace(/\s+/g, " ").trim();

async function click(el: Element | null | undefined) {
  if (!el) throw new Error("nothing to click");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

/** React listens on the native input event, so the value has to be set the way the browser does. */
async function type(selector: string, value: string) {
  const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  createAssignment.mockReset();
  createAssignment.mockResolvedValue({ id: 5 });
  getAssignmentOptions.mockReset();
  getAssignmentOptions.mockResolvedValue(OPTIONS);
  useUnifiedResults.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AssignmentForm — the Practice tests tab", () => {
  it("sends a picked practice test as practice_test_ids, and no pack key at all", async () => {
    await renderForm();

    await click(buttonLabelled("Practice tests"));
    const card = cardWith("Practice Test 4");
    expect(card, "the tab should list Practice Test 4").toBeTruthy();
    // Homework only is the teacher's cue that students will not see it until it is set.
    expect(card!.textContent).toContain("Homework only");
    expect(card!.textContent).toContain("Algebra focus");
    expect(card!.textContent).toContain("Middle");
    await click(card);
    // The picker's cards are rebuilt on every render, so read the card again rather than the
    // element clicked.
    expect(cardWith("Practice Test 4")!.getAttribute("aria-pressed")).toBe("true");

    await type("#asg-title", "Practice Test 4");
    await type("#asg-inst", "Sit it without the clock.");
    await click(buttonLabelled("Publish assignment"));

    expect(createAssignment).toHaveBeenCalled();
    const fd = createAssignment.mock.calls[0][1] as FormData;
    expect(fd.get("practice_test_ids")).toBe("[9]");
    // The packs tab is gone; its payload key must not survive it.
    expect(fd.has("practice_test_pack_ids")).toBe(false);
  });

  it("shares one selection with the past papers: both kinds ride in practice_test_ids", async () => {
    await renderForm();

    await click(buttonLabelled("Practice tests"));
    await click(cardWith("Practice Test 4"));
    await click(buttonLabelled("Pastpapers"));
    await click(cardWith("SAT March 2026"));

    await type("#asg-title", "Mixed set");
    await type("#asg-inst", "Both, please.");
    await click(buttonLabelled("Publish assignment"));

    const fd = createAssignment.mock.calls[0][1] as FormData;
    expect(JSON.parse(String(fd.get("practice_test_ids"))).sort()).toEqual([3, 9]);
  });

  it("puts the pick in the cart, and removing it from there clears it", async () => {
    await renderForm();
    await click(buttonLabelled("Practice tests"));
    await click(cardWith("Practice Test 4"));

    expect(shownText()).toContain("1 selected");
    const remove = container.querySelector('button[aria-label="Remove Practice Test 4"]');
    expect(remove, "the cart should list the practice test with a remove button").toBeTruthy();

    await click(remove);
    expect(cardWith("Practice Test 4")!.getAttribute("aria-pressed")).toBe("false");
    expect(shownText()).toContain("0 selected");
  });

  it("names it a practice test, not a past paper, when saying what fills the rest of the grade", async () => {
    await renderForm();
    await click(buttonLabelled("Practice tests"));
    await click(cardWith("Practice Test 4"));
    await click(buttonLabelled("Submission"));
    await click(container.querySelector('[role="switch"][aria-label*="part I mark myself"]'));
    await type("#asg-manual-share", "20");

    expect(shownText()).toContain("The other 80% comes from the 1 practice test attached here.");
    expect(shownText()).not.toContain("1 past paper");
  });

  it("groups a practice test the class already has under Already assigned", async () => {
    getAssignmentOptions.mockResolvedValue({
      ...OPTIONS,
      practice_test_items: [{ ...OPTIONS.practice_test_items[0], already_assigned: true }],
    });
    await renderForm();
    await click(buttonLabelled("Practice tests"));

    expect(shownText()).toContain("Already assigned");
    expect(cardWith("Practice Test 4")!.textContent).toContain("Already assigned");
  });

  it("says so when this subject has no published practice test", async () => {
    getAssignmentOptions.mockResolvedValue({ ...OPTIONS, practice_test_items: [] });
    await renderForm();
    await click(buttonLabelled("Practice tests"));

    expect(shownText()).toContain("No practice tests for this subject yet");
    expect(cardWith("Practice Test")).toBeUndefined();
  });

  it("offers no Practice test packs tab any more", async () => {
    await renderForm();
    expect(buttonLabelled("Practice test packs")).toBeUndefined();
    expect(buttonLabelled("Packs")).toBeUndefined();
  });
});

describe("the homework launcher", () => {
  function homework(section: NonNullable<AssignmentDetail["practice_bundle_tests"]>[number]): AssignmentDetail {
    return {
      id: 120,
      title: "Lesson 20 homework",
      due_at: null,
      status: "PUBLISHED",
      category: "HOMEWORK",
      max_score: null,
      practice_test_ids: [section.id],
      practice_bundle_tests: [section],
    };
  }

  it("opens a practice test as a Practice Test, named by its number", () => {
    const actions = contentActions(
      homework({
        id: 9,
        name: "Practice Test 4",
        is_practice_test: true,
        state: "not_started",
        subject: "MATH",
        attempt_id: null,
        retake: false,
      }),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("Open Practice Test");
    expect(actions[0].name).toBe("Practice Test 4");
    // It still starts like any section: the attempt is created from the test id.
    expect(actions[0].startTestId).toBe(9);
  });

  it("falls back to the practice-test wording when a practice test arrives with no name", () => {
    const [action] = contentActions(
      homework({ id: 9, is_practice_test: true, state: "not_started", attempt_id: null }),
    );

    expect(action.name).toBe("Practice Test");
    expect(action.label).toBe("Open Practice Test");
  });

  it("still opens a past paper as a Past Paper", () => {
    const [action] = contentActions(
      homework({ id: 12, name: "SAT March 2024", state: "not_started", attempt_id: null }),
    );

    expect(action.label).toBe("Open Past Paper");
    expect(action.name).toBe("SAT March 2024");
  });

  it("falls back to the past-paper wording when a past paper arrives with no name", () => {
    const [action] = contentActions(homework({ id: 12, state: "not_started", attempt_id: null }));

    expect(action.name).toBe("Past Paper");
  });
});

describe("Results — practice tests", () => {
  const ROWS = [
    {
      student_id: 1,
      student: "Aziza Karimova",
      content_name: "Practice Test 4",
      type: "Practice Test",
      score: 1380,
      status: "COMPLETED",
      submission_date: "2026-10-14T09:00:00Z",
      untimed: true,
    },
    {
      student_id: 2,
      student: "Bobur Aliyev",
      content_name: "March 2026 US A",
      type: "Past Paper",
      score: 1210,
      status: "COMPLETED",
      submission_date: "2026-10-13T09:00:00Z",
      untimed: false,
    },
    {
      // A row from an older server, or an assessment: the field is simply absent.
      student_id: 3,
      student: "Dilnoza Rustamova",
      content_name: "Reading drill 2",
      type: "Assessment",
      score: 8,
      status: "COMPLETED",
      submission_date: null,
    },
  ];

  function renderResults() {
    useUnifiedResults.mockReturnValue({
      data: { summary: { average_score: null, completion_rate: null, total_attempts: 3, pending_work: 0 }, rows: ROWS },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    return act(async () => {
      root.render(<Results classroom={{ id: 34 } as never} />);
    });
  }

  it("offers a Practice Test filter and asks the server for it by its own name", async () => {
    await renderResults();

    const select = container.querySelector("#r-type") as HTMLSelectElement;
    const option = [...select.options].find((o) => o.textContent === "Practice Test");
    expect(option, "the type filter should list Practice Test").toBeTruthy();
    expect(option!.value).toBe("practice test");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "practice test");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const lastFilters = useUnifiedResults.mock.calls.at(-1)?.[1] as { type?: string };
    expect(lastFilters.type).toBe("practice test");
  });

  it("marks an untimed sitting, and only that one", async () => {
    await renderResults();

    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Untimed");
    expect(rows[1].textContent).not.toContain("Untimed");
    // A row that never carried the field is read as timed, not as an error.
    expect(rows[2].textContent).not.toContain("Untimed");
  });
});
