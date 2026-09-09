/**
 * The assessments tab, judged on what a teacher can do in the first few seconds: reach the
 * flagged question, tell an untagged question from a broken chip, read the same disclosure
 * once rather than twice, and know who is actually in the cohort.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssessmentItemAnalysis, AssessmentItemRow } from "../types";

const assessments = vi.fn();

vi.mock("../api", () => ({
  questionAnalysisApi: {
    assessments: (...args: unknown[]) => assessments(...args),
    pastpaper: vi.fn(),
    classrooms: vi.fn(),
    pastPapers: vi.fn(),
  },
  questionAnalysisKeys: {
    all: ["question-analysis"],
    classrooms: () => ["question-analysis", "classrooms"],
    pastPapers: () => ["question-analysis", "past-papers"],
    assessments: (c: number, s: number | null, t: number) => ["question-analysis", "a", c, s, t],
    pastpaper: (c: number, p: number, t: number) => ["question-analysis", "p", c, p, t],
  },
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    title,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    title?: string;
    className?: string;
  }) => (
    <a href={href} title={title} className={className}>
      {children}
    </a>
  ),
}));

const { AssessmentsPanel, setPracticeHref } = await import("../AssessmentsPanel");
const { BREAKDOWN_GRID_STYLE } = await import("../components/BreakdownList");

const SET = { id: 12, title: "Week 6 — Words in Context", subject: "ENGLISH" };

const item = (over: Partial<AssessmentItemRow> = {}): AssessmentItemRow => ({
  question_id: 401,
  order: 0,
  position: 4,
  prompt: "Which choice completes the text with the most logical word?",
  prompt_truncated: false,
  question_type: "MCQ",
  question_type_label: "Multiple choice",
  set: SET,
  students_answered: 22,
  students_graded: 22,
  students_correct: 5,
  students_wrong: 17,
  ungraded: 0,
  error_rate: 77,
  needs_analysis: true,
  skill: "Words in Context",
  domain: "Craft and Structure",
  ...over,
});

const NOTE =
  "5 of 8 questions are linked to the question bank. The other 3 were written directly in the builder.";

function payload(over: Partial<AssessmentItemAnalysis> = {}): AssessmentItemAnalysis {
  const rows = over.questions ?? [item()];
  return {
    classroom: {
      id: 3,
      name: "Chilonzor 12-A",
      subject: "ENGLISH",
      subject_label: "English",
      level: null,
      level_label: null,
    },
    threshold: 25,
    denominator: "graded",
    counting_rule: "their first attempt at each question",
    summary: {
      questions_total: 8,
      questions_analysed: 7,
      questions_awaiting_grading: 1,
      questions_flagged: rows.length,
      students_counted: 22,
      attempts_counted: 22,
      sets: 2,
    },
    taxonomy_coverage: { linked: 5, total: 8, rate: 62.5, note: NOTE },
    excluded: { retired_questions: 6 },
    needs_analysis: rows,
    questions: rows,
    by_question_type: [],
    by_skill: [],
    by_domain: [],
    sets: [SET],
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  assessments.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(data: AssessmentItemAnalysis) {
  assessments.mockResolvedValue(data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssessmentsPanel classroomId={3} threshold={25} />
      </QueryClientProvider>,
    );
  });
  // One more turn of the loop: the query resolves after the first commit, and the panel
  // renders its data on the re-render that follows.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Every occurrence of a string in the rendered text, so "twice" is measurable. */
function occurrences(needle: string): number {
  return (host.textContent ?? "").split(needle).length - 1;
}

describe("AssessmentsPanel", () => {
  it("prints the taxonomy coverage note once, not once per breakdown", async () => {
    // It was passed to both the SAT-skill and the Domain card, which printed the same
    // sentence verbatim twice, a few hundred pixels apart.
    await render(payload());
    expect(occurrences(NOTE)).toBe(1);
  });

  it("gives every flagged question a way to reach it", async () => {
    await render(payload());
    const link = host.querySelector<HTMLAnchorElement>(`a[href="${setPracticeHref(SET.id)}"]`);
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain("Q4");
    // The route has no per-question segment, so the link says where it lands rather than
    // implying a deep link it cannot make.
    expect(link!.title).toContain("question 1");
  });

  it("does not tell a teacher to open something it gives them no way to open", async () => {
    await render(payload({ questions: [item({ prompt: "" })] }));
    expect(host.textContent).toContain("no text prompt saved");
    expect(host.querySelector(`a[href="${setPracticeHref(SET.id)}"]`)).not.toBeNull();
  });

  it("marks an untagged question instead of showing nothing", async () => {
    // No pill at all read as a chip that failed to load. A question nobody tagged is a fact
    // about the content and has to say so.
    await render(payload({ questions: [item({ skill: null, domain: null })] }));
    const list = host.querySelector("[data-flagged-list]");
    expect(list?.textContent).toContain("Untagged");
  });

  it("keeps the real skill chip when there is one", async () => {
    await render(payload());
    expect(host.textContent).toContain("Words in Context");
    expect(host.textContent).not.toContain("Untagged");
  });

  it("states its cohort, and that it is not the same cohort as the past-papers tab", async () => {
    // The two tabs scope differently for the same class: this one counts every student who
    // was given the sets, past papers filters to the current roster. A teacher comparing
    // them sees two class sizes, and without this it looks like a bug.
    await render(payload());
    const cohort = [...host.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Who is counted:"),
    );
    // Visible without opening anything: who this tab counts, and that leavers are in it.
    expect(cohort).toBeDefined();
    expect(cohort!.closest("details")).toBeNull();
    expect(cohort!.textContent).toContain("22 students");
    expect(cohort!.textContent).toContain("since left the class");

    // The full cross-tab difference sits with the other method notes.
    const details = host.querySelector("details[data-caveat-notes]");
    expect(details!.textContent).toContain("Past papers tab filters to the class roster");
    expect(details!.textContent).toContain("different class sizes");
  });

  it("folds the method notes and leaves the warnings out where they can be seen", async () => {
    await render(payload());
    const visible = Array.from(host.querySelectorAll("[data-caveat-tone]")).filter(
      (el) => !el.closest("details"),
    );
    expect(visible.map((el) => el.textContent).join(" ")).toContain("since retired in the builder");
    expect(host.querySelector("details[data-caveat-notes]")).not.toBeNull();
  });

  it("lays the breakdowns out on the container, not the viewport", async () => {
    await render(payload());
    const grid = Array.from(host.querySelectorAll<HTMLElement>("div")).find((el) =>
      el.style.gridTemplateColumns.includes("auto-fit"),
    );
    expect(grid).toBeDefined();
    expect(grid!.style.alignItems).toBe("start");
    expect(grid!.style.gridTemplateColumns).toBe(BREAKDOWN_GRID_STYLE.gridTemplateColumns);
  });
});
