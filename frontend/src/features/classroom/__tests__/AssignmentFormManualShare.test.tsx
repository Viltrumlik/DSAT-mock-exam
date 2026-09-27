/**
 * The share of a homework's grade the teacher marks by hand, chosen on the create form.
 *
 * The switch is OFF by default and sends NOTHING — `manual_grade_weight_percent` stays NULL,
 * which is what "no manual component" means, so no homework that already exists reads any
 * differently. Turned on, the teacher says what share is theirs and the form shows them the
 * consequence in their own terms: at 20, the other 80% comes from the four assessments and two
 * vocabulary sets they attached. A percentage against nothing in particular is a number a
 * teacher cannot check, which is why the parts are named and not merely counted.
 *
 * Two refusals live here. Out of 0-100 never leaves the browser. And a share below 100 on a
 * homework with nothing auto-graded is a grade that cannot be completed as described — said
 * plainly while the teacher is still editing, not as a submit-time error and not as a 400.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateAssignment = vi.fn();
const createAssignment = vi.fn();
const getAssignmentOptions = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    getAssignmentOptions: (...args: unknown[]) => getAssignmentOptions(...args),
    updateAssignment: (...args: unknown[]) => updateAssignment(...args),
    createAssignment: (...args: unknown[]) => createAssignment(...args),
    videoUploadUrl: vi.fn(),
  },
}));

const AssignmentForm = (await import("../pages/AssignmentForm")).default;

/** Four assessments and two vocabulary sets — the owner's own example of a bundle. */
const BUNDLED_OPTIONS = {
  practice_tests: [],
  assessment_sets: [1, 2, 3, 4].map((id) => ({
    id,
    title: `Reading drill ${id}`,
    subject: "english",
    category: "Reading",
    description: "",
    question_count: 10,
  })),
  practice_test_packs: [],
  vocabulary_sections: [
    {
      id: 7,
      title: "Real Exam Words",
      sets: [
        { id: 11, title: "Set 20", word_count: 25 },
        { id: 12, title: "Set 21", word_count: 25 },
      ],
    },
  ],
  classroom_subject: "ENGLISH",
  classroom_level: "senior",
};

const EMPTY_OPTIONS = { ...BUNDLED_OPTIONS, assessment_sets: [], vocabulary_sections: [] };

/** A homework row as the edit form receives it. */
function editingRow(extra: Record<string, unknown> = {}) {
  return {
    id: 91,
    title: "Essay week",
    instructions: "Write 500 words on the passage.",
    category: "HOMEWORK",
    status: "PUBLISHED",
    allow_file_upload: true,
    external_urls: [],
    external_url_labels: [],
    ...extra,
  };
}

/** The bundle above, as it comes back on the row being edited. */
const BUNDLED_CONTENT = {
  assessment_homeworks: [1, 2, 3, 4].map((id) => ({ set: { id } })),
  vocab_homeworks: [{ set_id: 11 }, { set_id: 12 }],
};

let container: HTMLDivElement;
let root: Root;

async function renderForm(editing: Record<string, unknown> | null) {
  await act(async () => {
    root.render(
      <AssignmentForm classId={34} editingAssignment={editing} onCancel={() => {}} onSaved={() => {}} />,
    );
  });
}

/** The save/publish button wears a count badge once the cart has anything in it, so its
 *  text reads "Save changes6" on a homework that carries content. */
function buttonLabelled(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find((b) => {
    const label = (b.textContent || "").trim();
    return label === text || new RegExp(`^${text}\\d+$`).test(label);
  }) as HTMLButtonElement | undefined;
}

const manualSwitch = () =>
  container.querySelector('[role="switch"][aria-label*="part I mark myself"]') as HTMLButtonElement | null;

const shareInput = () => container.querySelector("#asg-manual-share") as HTMLInputElement | null;

/** Everything the form currently says, with its line breaks flattened. */
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

/** Open the settings tab, where the owner asked for this to live. */
async function openSubmissionTab() {
  await click(buttonLabelled("Submission"));
}

beforeEach(() => {
  updateAssignment.mockReset();
  updateAssignment.mockResolvedValue({ id: 91 });
  createAssignment.mockReset();
  createAssignment.mockResolvedValue({ id: 5 });
  getAssignmentOptions.mockReset();
  getAssignmentOptions.mockResolvedValue(EMPTY_OPTIONS);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("AssignmentForm — the share the teacher marks", () => {
  it("is off to begin with, and the create request carries no share at all", async () => {
    await renderForm(null);
    await openSubmissionTab();

    expect(manualSwitch()?.getAttribute("aria-checked")).toBe("false");
    expect(shareInput(), "the percentage is only asked for once the switch is on").toBeNull();

    await type("#asg-title", "Reading for Monday");
    await type("#asg-inst", "Read pages 20-24.");
    await click(buttonLabelled("Publish assignment"));

    expect(createAssignment).toHaveBeenCalled();
    const fd = createAssignment.mock.calls[0][1] as FormData;
    // Absent, not 0: NULL is what says "no manual component", and a 0 would mean something
    // else entirely — a review the teacher wants to give that carries no weight.
    expect(fd.has("manual_grade_weight_percent")).toBe(false);
  });

  it("sends the share the teacher typed", async () => {
    await renderForm(null);
    await openSubmissionTab();
    await click(manualSwitch());
    await type("#asg-manual-share", "20");
    await type("#asg-title", "Essay week");
    await type("#asg-inst", "Write 500 words.");
    await click(buttonLabelled("Publish assignment"));

    const fd = createAssignment.mock.calls[0][1] as FormData;
    expect(fd.get("manual_grade_weight_percent")).toBe("20");
  });

  it("tells the teacher what the rest of the grade is made of, by name", async () => {
    getAssignmentOptions.mockResolvedValue(BUNDLED_OPTIONS);
    await renderForm(editingRow(BUNDLED_CONTENT));
    await openSubmissionTab();
    await click(manualSwitch());
    await type("#asg-manual-share", "20");

    // The owner's example, in the owner's terms: the teacher never does this subtraction.
    expect(shownText()).toContain(
      "You mark 20% of the grade. The other 80% comes from the 4 assessments and 2 vocabulary sets attached here.",
    );
  });

  it("names content the picker never lists — an out-of-scope set still fills the rest", async () => {
    // getAssignmentOptions scopes the picker by is_active, subject and classroom level, so a
    // set this homework already holds can be missing from it for good. It is still attached,
    // still sent on save and still graded — and the form must say so, not the opposite.
    await renderForm(editingRow({ manual_grade_weight_percent: 20, ...BUNDLED_CONTENT }));
    await openSubmissionTab();

    const text = shownText();
    expect(text).toContain("The other 80% comes from the 4 assessments and 2 vocabulary sets attached here.");
    expect(text).not.toContain("Nothing here is graded automatically");

    // What the sentence names is what the save sends — one source, not two.
    await click(buttonLabelled("Save changes"));
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    expect(body.assessment_set_ids).toEqual([1, 2, 3, 4]);
  });

  it("counts what is attached while the picker's own list is still loading", async () => {
    // The fetch decides how the cart LABELS a selection, never whether the grade has an
    // automatic half. Waiting on it made the warning fire on the ordinary edit of any
    // homework carrying assessments, which teaches a teacher to ignore it.
    getAssignmentOptions.mockReturnValue(new Promise(() => {}));
    await renderForm(editingRow({ manual_grade_weight_percent: 20, ...BUNDLED_CONTENT }));
    await openSubmissionTab();

    const text = shownText();
    expect(text).toContain("The other 80% comes from the 4 assessments and 2 vocabulary sets attached here.");
    expect(text).not.toContain("Nothing here is graded automatically");
  });

  it("says plainly, while the teacher is still editing, that nothing is there to fill the rest", async () => {
    await renderForm(editingRow());
    await openSubmissionTab();
    await click(manualSwitch());
    await type("#asg-manual-share", "20");

    const text = shownText();
    expect(text).toContain("Nothing here is graded automatically");
    expect(text).toContain("the other 80%");
    // Said at the moment it becomes true — the teacher has pressed nothing.
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it("refuses a share outside 0-100 before the request leaves", async () => {
    await renderForm(editingRow());
    await openSubmissionTab();
    await click(manualSwitch());
    await type("#asg-manual-share", "120");

    expect(shownText()).toContain("A share runs from 0 to 100.");
    const save = buttonLabelled("Save changes");
    expect(save?.disabled).toBe(true);
    await click(save);
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it("keeps the share of a homework that already has one", async () => {
    await renderForm(editingRow({ manual_grade_weight_percent: 35, ...BUNDLED_CONTENT }));
    await openSubmissionTab();

    expect(manualSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(shareInput()?.value).toBe("35");

    await click(buttonLabelled("Save changes"));
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    expect(body.manual_grade_weight_percent).toBe(35);
  });

  it("is not offered on classwork at all", async () => {
    // The owner asked for this on homework. Classwork lives in a different grading world —
    // `rewards.homework.recompute_bundle` returns early for CATEGORY_CLASSWORK because its
    // points are given by a teacher's hand rather than earned — so a share here would
    // describe a split that nothing downstream performs.
    await renderForm(editingRow({ category: "CLASSWORK" }));
    // Opening the tab matters: without it the switch is absent for every kind, and this
    // test would pass while proving nothing at all.
    await openSubmissionTab();

    expect(manualSwitch()).toBeNull();
    expect(shownText()).not.toContain("part I mark myself");
    // And the rest of the tab is still there — this gates one block, not the page.
    expect(shownText()).toContain("Allow file submissions");
  });

  it("opens a homework saved at 0% with the switch ON, and keeps the zero", async () => {
    // 0 is legal and means "a review that carries no weight" — the teacher owes a mark that
    // changes no number. Read as falsy rather than as a value, the switch would open OFF and
    // the next save would NULL the column, dropping a review the teacher still owes.
    await renderForm(editingRow({ manual_grade_weight_percent: 0, ...BUNDLED_CONTENT }));
    await openSubmissionTab();

    expect(manualSwitch()?.getAttribute("aria-checked")).toBe("true");
    expect(shareInput()?.value).toBe("0");

    await click(buttonLabelled("Save changes"));
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    expect(body.manual_grade_weight_percent).toBe(0);
  });

  it("clears the share when the teacher switches it back off", async () => {
    await renderForm(editingRow({ manual_grade_weight_percent: 35 }));
    await openSubmissionTab();
    await click(manualSwitch());

    expect(shareInput()).toBeNull();
    await click(buttonLabelled("Save changes"));
    const body = updateAssignment.mock.calls[0][2] as Record<string, unknown>;
    // Explicitly null, not omitted: a partial update that leaves the key out would leave
    // yesterday's share standing on a homework whose form now says it has none.
    expect(body).toHaveProperty("manual_grade_weight_percent", null);
  });
});
