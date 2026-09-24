/**
 * The Grading tab's third level: one student's work, and the place to mark it.
 *
 * The tab had two levels — the homework, then the students on it — and a teacher could type a
 * grade without ever seeing what was turned in. These cover the level below that: the file
 * itself, a submission that carries no file (which is normal, not broken), a read that failed
 * (which is not a student who handed nothing in), the walk from one student to the next, and
 * what the teacher's mark is worth when the homework reserves a share for it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClassroomWithRole } from "../types";

const get = vi.fn();
const listSubmissions = vi.fn();
const gradeSubmission = vi.fn();
const returnSubmission = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    listSubmissions: (...args: unknown[]) => listSubmissions(...args),
    gradeSubmission: (...args: unknown[]) => gradeSubmission(...args),
    returnSubmission: (...args: unknown[]) => returnSubmission(...args),
  },
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const { Gradebook } = await import("../pages/Gradebook");

const PAGE = "/teacher/classrooms/34";

/** `GET /api/classes/34/gradebook/assignments/102/` — a written homework in a class of three. */
const GRADES = {
  assignment: {
    id: 102,
    title: "Unit 3 review",
    status: "PUBLISHED",
    category: "HOMEWORK",
    due_at: "2026-09-10T18:00:00+05:00",
    is_auto_graded: false,
    source_label: "Manual",
    max_score: "100.00",
  },
  roster: [
    { student_id: 7, name: "Aziza Karimova", email: "aziza@example.com", profile_image_url: null, status: "SUBMITTED", grade: null, max_score: null, source: null, submission_id: 501 },
    { student_id: 8, name: "Bekzod Rahimov", email: "bekzod@example.com", profile_image_url: null, status: "SUBMITTED", grade: null, max_score: null, source: null, submission_id: 502 },
    { student_id: 9, name: "Dilnoza Yusupova", email: "dilnoza@example.com", profile_image_url: null, status: "MISSING", grade: null, max_score: null, source: null, submission_id: null },
  ],
  counts: { graded: 0, needs_grading: 2, submitted: 2, needs_revision: 0, missing: 1, total: 3 },
  performance: null,
};

const OVERVIEW = { assignments: [], needs_grading_total: 2, students: 3 };

/** `GET .../assignments/102/submissions/` — Aziza turned in a pdf, Bekzod turned in nothing with it. */
function submissions(overrides: Record<number, object> = {}) {
  return [
    {
      id: 501, status: "SUBMITTED", revision: 1, submitted_at: "2026-09-09T10:00:00+05:00",
      student: { id: 7, first_name: "Aziza", last_name: "Karimova" },
      files: [{ id: 9001, url: "https://files.example.test/uploads/essay-draft.pdf", file_name: "essay-draft.pdf", file_type: "application/pdf" }],
      attempt: null, review: null, composed_grade: null,
      ...(overrides[501] ?? {}),
    },
    {
      id: 502, status: "SUBMITTED", revision: 1, submitted_at: "2026-09-09T11:00:00+05:00",
      student: { id: 8, first_name: "Bekzod", last_name: "Rahimov" },
      files: [], attempt: null, review: null, composed_grade: null,
      ...(overrides[502] ?? {}),
    },
  ];
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  listSubmissions.mockReset();
  gradeSubmission.mockReset();
  returnSubmission.mockReset();
  gradeSubmission.mockResolvedValue({ data: {} });
  returnSubmission.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

async function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function waitForText(needle: string) {
  for (let t = 0; t < 60 && !host.textContent?.includes(needle); t++) await tick();
  if (!host.textContent?.includes(needle)) {
    throw new Error(`never saw "${needle}" — the screen reads: ${host.textContent?.slice(0, 500)}`);
  }
}

const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label);

/** The row that opens one student's work — the name itself. */
function openStudent(name: string) {
  const el = host.querySelector<HTMLButtonElement>(`[aria-label="Open ${name}'s work"]`);
  if (!el) throw new Error(`no way in to ${name}'s work`);
  return el;
}

async function click(el: Element) {
  await act(async () => { (el as HTMLElement).click(); });
  await tick(3);
}

/** React listens on the native input event, so the value has to be set the way the browser does. */
async function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`no field ${selector}`);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mount({ work = submissions(), role = "OWNER" }: { work?: unknown[] | "fails"; role?: string } = {}) {
  window.history.replaceState(null, "", `${PAGE}?tab=grading&assignment=102`);
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/gradebook/") return { data: OVERVIEW };
    if (url === "/classes/34/gradebook/assignments/102/") return { data: GRADES };
    throw new Error(`unexpected GET ${url}`);
  });
  listSubmissions.mockImplementation(async () => {
    if (work === "fails") throw Object.assign(new Error("Request failed with status code 500"), { response: { status: 500 } });
    return work;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const classroom = { id: 34, name: "Middle G13", my_role: role } as unknown as ClassroomWithRole;
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Gradebook classroom={classroom} />
      </QueryClientProvider>,
    );
  });
  await tick(5);
}

describe("Grading tab — the work, before the mark", () => {
  it("opens the work the student turned in, with the way back to the homework", async () => {
    await mount();
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    expect(listSubmissions).toHaveBeenCalledWith(34, 102);
    // Drawn in the page at the size of the page, not as a tile to open elsewhere.
    expect(host.querySelector('iframe[title="essay-draft.pdf"]')).toBeTruthy();
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://files.example.test/uploads/essay-draft.pdf"]')).toBeTruthy();
    // Three levels, three ways back: this one names the homework it returns to.
    expect(buttons("Unit 3 review")).toHaveLength(1);
    expect(host.textContent).toContain("1 of 3 in this view");
  });

  it("goes back to the students on the homework, with the list as it was", async () => {
    await mount();
    await waitForText("Aziza Karimova");
    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    await click(buttons("Unit 3 review")[0]);
    await waitForText("Bekzod Rahimov");
    expect(host.textContent).toContain("Dilnoza Yusupova");
    expect(host.textContent).not.toContain("essay-draft.pdf");
    // And the level above that is still there.
    expect(buttons("Gradebook")).toHaveLength(1);
  });

  it("says a submission carries no file, rather than looking broken or empty", async () => {
    await mount();
    await waitForText("Bekzod Rahimov");

    await click(openStudent("Bekzod Rahimov"));
    await waitForText("Nothing was uploaded with this one.");

    expect(host.textContent).not.toContain("Not turned in yet");
    expect(host.textContent).not.toContain("The work didn't load");
    // The mark can still be entered: no file is not no submission.
    expect(buttons("Save grade")).toHaveLength(1);
  });

  it("reads a homework turned in as a test attempt as work, not as an empty hand-in", async () => {
    await mount({
      work: submissions({
        502: { files: [], attempt: { id: 4412, score: 1340, practice_test_name: "Practice Test 7", is_completed: true } },
      }),
    });
    await waitForText("Bekzod Rahimov");

    await click(openStudent("Bekzod Rahimov"));
    await waitForText("Practice Test 7");

    expect(host.textContent).toContain("No files with this one — the work is the test attempt above.");
    expect(host.textContent).toContain("Attempt #4412");
    expect(host.textContent).toContain("scored 1340");
    expect(host.textContent).not.toContain("Nothing was uploaded with this one.");
  });

  it("says a read that failed, and never draws it as work nobody turned in", async () => {
    await mount({ work: "fails" });
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("The work didn't load");

    expect(buttons("Try again")).toHaveLength(1);
    expect(host.textContent).not.toContain("Not turned in yet");
    expect(host.textContent).not.toContain("Nothing was uploaded with this one.");
    // A failed read is not a dead end either: the walk is still there.
    expect(buttons("Next student")).toHaveLength(1);
  });

  it("says a student has not turned in yet, with nothing to mark", async () => {
    // The class list calls a DRAFT "not turned in" while still carrying its id, and the upload
    // panel opens that draft as soon as a file is picked. Reading it here would put work the
    // student never handed over under a "Not turned in" chip.
    await mount({
      work: [
        ...submissions(),
        {
          id: 503, status: "DRAFT", revision: 0, submitted_at: null,
          student: { id: 9, first_name: "Dilnoza", last_name: "Yusupova" },
          files: [{ id: 9002, url: "https://files.example.test/uploads/half-finished.pdf", file_name: "half-finished.pdf", file_type: "application/pdf" }],
          attempt: null, review: null, composed_grade: null,
        },
      ],
    });
    await waitForText("Dilnoza Yusupova");

    await click(openStudent("Dilnoza Yusupova"));
    await waitForText("Not turned in yet");

    expect(host.textContent).toContain("Nothing has come in from Dilnoza Yusupova for this homework.");
    expect(host.textContent).not.toContain("half-finished.pdf");
    expect(host.textContent).not.toContain("The work didn't load");
    expect(buttons("Save grade")).toHaveLength(0);
  });

  it("saves the grade from the student's own work", async () => {
    await mount();
    await waitForText("Aziza Karimova");
    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    await type('input[type="number"]', "88");
    await click(buttons("Save grade")[0]);

    expect(gradeSubmission).toHaveBeenCalledWith(501, { grade: "88", feedback: "" });
  });

  it("returns the work for revision from the student's own work", async () => {
    await mount();
    await waitForText("Aziza Karimova");
    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    await type("textarea", "Have another go at the second paragraph.");
    await click(buttons("Return for revision")[0]);

    expect(returnSubmission).toHaveBeenCalledWith(501, { note: "Have another go at the second paragraph." });
  });

  it("walks to the next student without climbing back to the list", async () => {
    await mount();
    await waitForText("Aziza Karimova");
    await click(openStudent("Aziza Karimova"));
    await waitForText("1 of 3 in this view");

    await click(buttons("Next student")[0]);
    await waitForText("2 of 3 in this view");

    expect(host.textContent).toContain("Bekzod Rahimov");
    expect(host.textContent).toContain("Nothing was uploaded with this one.");
    // One read for the whole homework: the walk costs nothing.
    expect(listSubmissions).toHaveBeenCalledTimes(1);
    // And back one student, from the other end of the walk.
    await click(buttons("Previous")[0]);
    await waitForText("1 of 3 in this view");
    expect(host.textContent).toContain("essay-draft.pdf");
  });

  it("carries nothing of one student's marking into the next student's form", async () => {
    await mount();
    await waitForText("Aziza Karimova");
    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    await type('input[type="number"]', "88");
    await type("textarea", "Careful with the thesis.");
    await click(buttons("Next student")[0]);
    await waitForText("Bekzod Rahimov");

    expect(host.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  });
});

describe("Grading tab — what the teacher's mark is worth", () => {
  /** `composed_grade` as the API sends it for a homework whose manual share is 20%. */
  const awaiting = {
    state: "awaiting_manual_mark", percent: 72, is_final: false,
    automatic_percent: 90, manual_percent: null,
    manual_weight_percent: 20, automatic_weight_percent: 80,
  };

  it("tells the teacher the share, what is already settled, and where that leaves the grade", async () => {
    await mount({ work: submissions({ 501: { composed_grade: awaiting } }) });
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("Your mark is worth 20% of this grade.");

    expect(host.textContent).toContain("The other 80% is graded automatically, and it is already settled at 90%.");
    expect(host.textContent).toContain("That puts the homework at 72% so far — it can only go up once your mark goes in.");
    expect(host.textContent).toContain("Waiting on your mark");
    // Said where the mark is typed, and nowhere else.
    expect(buttons("Save grade")).toHaveLength(1);
  });

  it("says the grade is settled once the mark is in", async () => {
    await mount({
      work: submissions({
        501: {
          composed_grade: {
            state: "final", percent: 90, is_final: true,
            automatic_percent: 90, manual_percent: 90,
            manual_weight_percent: 20, automatic_weight_percent: 80,
          },
        },
      }),
    });
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("With your mark, the homework stands at 90%.");

    expect(host.textContent).toContain("Marked");
    expect(host.textContent).not.toContain("Waiting on your mark");
  });

  it("says the composition failed, and never passes it off as a grade not given yet", async () => {
    await mount({
      work: submissions({
        501: {
          composed_grade: {
            state: "unavailable", percent: null, is_final: false,
            automatic_percent: null, manual_percent: null,
            manual_weight_percent: 20, automatic_weight_percent: 80,
          },
        },
      }),
    });
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("The combined grade couldn't be read");

    expect(host.textContent).toContain("Your mark still saves and still counts.");
    expect(host.textContent).not.toContain("Your mark is worth");
    expect(buttons("Save grade")).toHaveLength(1);
  });

  it("says the mark is the whole grade when nothing here is graded automatically", async () => {
    await mount({
      work: submissions({
        501: {
          composed_grade: {
            state: "awaiting_manual_mark", percent: null, is_final: false,
            automatic_percent: null, manual_percent: null,
            manual_weight_percent: 100, automatic_weight_percent: 0,
          },
        },
      }),
    });
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("Your mark is the whole grade.");

    expect(host.textContent).toContain("Nothing on this homework is graded automatically");
  });

  it("changes nothing on a homework with no manual share", async () => {
    await mount();
    await waitForText("Aziza Karimova");

    await click(openStudent("Aziza Karimova"));
    await waitForText("essay-draft.pdf");

    expect(host.textContent).not.toContain("Your mark is worth");
    expect(host.textContent).not.toContain("Waiting on your mark");
    expect(host.textContent).not.toContain("combined grade");
    expect(host.textContent).not.toContain("graded automatically");
    // The form a teacher has always had, unchanged.
    expect(buttons("Save grade")).toHaveLength(1);
    expect(buttons("Return for revision")).toHaveLength(1);
  });
});

describe("Grading tab — who may read the work", () => {
  it("never shows a student the class's work, whatever mounts the tab", async () => {
    // `features/classroom/**` is one tree, mounted by the student site too — which rewrites
    // `my_role` to STUDENT on the way in.
    await mount({ role: "STUDENT" });
    await waitForText("Grading is for the teaching team");

    expect(host.textContent).not.toContain("Aziza Karimova");
    expect(get).not.toHaveBeenCalled();
    expect(listSubmissions).not.toHaveBeenCalled();
  });
});
