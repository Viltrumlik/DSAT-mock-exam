/**
 * The grade a STUDENT reads on their own homework page, when the teacher's mark carries only a
 * share of it.
 *
 * The share is the branch's own worked example: 20% to the teacher, 80% graded automatically.
 * The automatic side settles at 100 and the teacher marks 50, so the server composes 90 — and
 * serves that number, as `composed_grade`, to the student's own `/my-submission/` read and to
 * every teacher screen alike.
 *
 * The page drew its Feedback pill from `review.grade` alone. That key is the teacher's mark and
 * nothing more: the student was shown a bare "50", with no denominator and no share, while their
 * teacher was looking at 90. A number that low, presented as the grade, is the kind a student
 * takes home to their parents.
 *
 * The last two tests are the same seam before anything is handed in. Vocabulary mastered on
 * Monday settles the automatic side straight away; the upload slot may not be used until Friday,
 * and until it is there is no submission row at all. The server composes that partly-settled
 * grade anyway and says so in a response carrying `composed_grade` and nothing else — a response
 * this page used to read as "nothing to show".
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const getMySubmission = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    get: async (id: number) => ({ id, name: "Middle G13", my_role: "STUDENT" }),
    getMySubmission: (...args: unknown[]) => getMySubmission(...args),
    submitAssignment: vi.fn(),
  },
  examsPublicApi: {},
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/classes/34/assignments/102",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { AssignmentDetailPage } = await import("../pages/AssignmentDetail");

/** `GET /api/classes/34/assignments/102/` — an upload homework, as a student receives it. */
const HOMEWORK = {
  id: 102,
  title: "Unit 3 review",
  instructions: "Answer the questions at the end of chapter 3.",
  status: "PUBLISHED",
  category: "HOMEWORK",
  due_at: "2026-09-14T18:00:00+05:00",
  max_score: "100.00",
  allow_file_upload: true,
  assessment_homework: null,
  assessment_homeworks: [],
  vocab_homeworks: [],
  external_urls: [],
};

/** `ComposedGrade.as_payload()` for the worked example: 20% by hand, 80% automatic. */
function composed(over: Record<string, unknown>) {
  return {
    state: "final",
    percent: 90,
    is_final: true,
    automatic_percent: 100,
    manual_percent: 50,
    manual_weight_percent: 20,
    automatic_weight_percent: 80,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  getMySubmission.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** Serve this `/my-submission/` body and mount the homework's page for the student. */
async function mount(mySubmission: object) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/assignments/102/") return { data: HOMEWORK };
    throw new Error(`unexpected GET ${url}`);
  });
  getMySubmission.mockResolvedValue(mySubmission);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssignmentDetailPage classId={34} assignmentId={102} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

/**
 * Run the page until it stops changing.
 *
 * The homework and `/my-submission/` are two queries that settle on different ticks, and React
 * Query resolves across MACROtasks — a fixed count of `await Promise.resolve()` flushes only
 * microtasks and caught the page mid-load under parallel load, which read as a missing pill.
 */
async function settle(maxTicks = 150) {
  let last = "";
  let stable = 0;
  for (let tick = 0; tick < maxTicks; tick++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const now = host.innerHTML;
    if (now === last && now !== "") {
      if (++stable >= 5) return;
    } else {
      stable = 0;
      last = now;
    }
  }
}

/** Everything the feedback card says, as one string. */
function feedbackCard(): string {
  return host.querySelector("#feedback-card")?.textContent ?? "";
}

/** The pill in the feedback card's header — the one number a student looks at first. */
function pill(): string | undefined {
  return host.querySelector("#feedback-card .rounded-full")?.textContent ?? undefined;
}

describe("a student's own grade, when the teacher's mark is a share of it", () => {
  it("shows the whole grade the server composed, not the teacher's mark on its own", async () => {
    await mount({
      id: 7,
      status: "REVIEWED",
      workflow_status: "REVIEWED",
      files: [],
      review: { grade: "50.00", max_score: "100.00", feedback: "Good work on the second half." },
      composed_grade: composed({}),
    });

    // What the page used to draw here was "50.00/100.00" — the mark, as the whole grade.
    expect(pill()).toBe("90%");
    const card = feedbackCard();
    // The teacher's own mark still appears, but as the mark and never as the grade.
    expect(card).toContain("Your teacher's mark is worth 20% of this grade");
    expect(card).toContain("Your teacher marked it 50%");
    expect(card).toContain("Good work on the second half.");
  });

  it("leaves homework with no manual share exactly as it was", async () => {
    await mount({
      id: 7,
      status: "REVIEWED",
      workflow_status: "REVIEWED",
      files: [],
      review: { grade: "88.00", max_score: "100.00", feedback: "" },
      // The key is present and null on nearly every homework in the school.
      composed_grade: null,
    });

    expect(pill()).toBe("88.00/100.00");
    expect(feedbackCard()).not.toContain("worth");
  });

  it("says the mark is still owed rather than showing a part-composed number as the grade", async () => {
    await mount({
      id: 7,
      status: "REVIEWED",
      workflow_status: "REVIEWED",
      files: [],
      // The automatic side is graded and recorded; the teacher has not marked.
      review: { grade: "100.00", max_score: "100.00", feedback: "", is_auto: true },
      composed_grade: composed({ state: "awaiting_manual_mark", percent: 80, is_final: false, manual_percent: null }),
    });

    // The grade is 80 so far — the automatic side weighted. That is a running total, not a
    // grade, and printed as one a student reads their unfinished homework as a B-.
    expect(pill()).toBe("Waiting on your teacher's mark");
    const card = feedbackCard();
    // The review carries 100, but the platform wrote it, not a teacher. Crediting a person with
    // that number is the same mistake as reading the mark as the grade, pointed the other way.
    expect(card).not.toContain("Your teacher marked it");
    expect(card).toContain("is graded automatically and stands at 100%");
  });

  it("says so when the whole grade could not be worked out, instead of falling back to the mark", async () => {
    await mount({
      id: 7,
      status: "REVIEWED",
      workflow_status: "REVIEWED",
      files: [],
      review: { grade: "50.00", max_score: "100.00", feedback: "" },
      composed_grade: composed({ state: "unavailable", percent: null, is_final: false, automatic_percent: null, manual_percent: null }),
    });

    expect(pill()).toBe("Total unavailable");
    expect(feedbackCard()).toContain("Your teacher's mark is saved and it counts");
  });

  it("shows the part of the grade already settled before anything has been handed in", async () => {
    // `/my-submission/` with no submission row: this key and nothing else. 80/20 split, the
    // automatic side settled at 100, so the WHOLE grade stands at 80 so far.
    await mount({ composed_grade: composed({ state: "awaiting_manual_mark", percent: 80, is_final: false, manual_percent: null }) });

    const card = feedbackCard();
    expect(card).toContain("Part of this grade is already decided");
    expect(card).toContain("80% so far");
    expect(card).toContain("settled at 100%");
    expect(card).toContain("this grade can only go up");
  });

  it("calls the whole grade 'so far', never the automatic side on its own", async () => {
    // The number beside "so far" is the one the teacher's own screen shows, off the same field.
    // Printing the automatic side there told a student on an 80/20 split with 95% automatic that
    // they stood at 95 and could "only go up" — and they finish on 90 unless their teacher marks
    // above 95. Two people reading one payload and getting different numbers is the whole bug
    // this branch has been closing; it must not reappear in the sentence that reassures a child.
    await mount({
      composed_grade: composed({
        state: "awaiting_manual_mark", percent: 76, is_final: false,
        automatic_percent: 95, manual_percent: null,
      }),
    });

    expect(pill()).toBe("76% so far");
    expect(feedbackCard()).toContain("settled at 95%, which puts the whole grade at 76% so far");
  });

  it("stays quiet before hand-in on homework with no manual share", async () => {
    await mount({ composed_grade: null });
    expect(feedbackCard()).toBe("");
  });
});

/**
 * The two ends of the share — where one side of the composition carries nothing.
 *
 * Both were introduced by the fix above and caught in review. A grade screen's edge states are
 * where a careful number turns back into a wrong one: with nothing to compose, the honest thing
 * is the mark and a sentence, never a blank and never a promise.
 */
describe("the ends of the share", () => {
  it("still shows the mark when a 0% share has nothing to compose with", async () => {
    // Share 0 AND nothing auto-graded: the composition has no number to give, and it is not
    // awaiting anything either. Dropping the pill blanked the score under "shown above".
    await mount({
      id: 7,
      status: "REVIEWED",
      workflow_status: "REVIEWED",
      files: [],
      review: { grade: "72.00", max_score: "100.00", feedback: "" },
      composed_grade: composed({
        state: "final", percent: null, automatic_percent: null, manual_percent: 72,
        manual_weight_percent: 0, automatic_weight_percent: 100,
      }),
    });

    expect(pill()).toBe("72.00/100.00");
    // And it says why the mark will not move the grade, instead of implying that it did.
    expect(feedbackCard()).toContain("This grade is worked out automatically");
  });

  it("does not call a weightless automatic score part of the grade", async () => {
    // The teacher's mark is the whole grade. An automatic score can still be recorded against
    // the homework, and it carries nothing — "already decided" would promise a part that
    // does not exist.
    await mount({
      composed_grade: composed({
        state: "awaiting_manual_mark", percent: null, is_final: false,
        automatic_percent: 95, manual_percent: null,
        manual_weight_percent: 100, automatic_weight_percent: 0,
      }),
    });

    expect(feedbackCard()).toBe("");
  });

  it("still shows the settled part when the automatic side really does carry weight", async () => {
    await mount({
      composed_grade: composed({
        state: "awaiting_manual_mark", percent: 76, is_final: false,
        automatic_percent: 95, manual_percent: null,
      }),
    });

    expect(feedbackCard()).toContain("Part of this grade is already decided");
  });
});
