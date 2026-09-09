/**
 * The past-papers tab: the work list has to be reachable, the five breakdowns have to be
 * comparable, an untagged question has to say so, and the cohort has to be stated — because
 * it is a different cohort from the one the assessments tab counts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PastPaperOption,
  PastpaperBreakdown,
  PastpaperGroupRow,
  PastpaperItemAnalysis,
  PastpaperItemRow,
} from "../types";

const pastpaper = vi.fn();
const pastPapers = vi.fn();

vi.mock("../api", () => ({
  questionAnalysisApi: {
    assessments: vi.fn(),
    pastpaper: (...args: unknown[]) => pastpaper(...args),
    classrooms: vi.fn(),
    pastPapers: (...args: unknown[]) => pastPapers(...args),
  },
  questionAnalysisKeys: {
    all: ["question-analysis"],
    classrooms: () => ["question-analysis", "classrooms"],
    pastPapers: () => ["question-analysis", "past-papers"],
    assessments: (c: number, s: number | null, t: number) => ["question-analysis", "a", c, s, t],
    pastpaper: (c: number, p: number, t: number) => ["question-analysis", "p", c, p, t],
  },
}));

const { PastPapersPanel } = await import("../PastPapersPanel");
const { BREAKDOWN_GRID_STYLE } = await import("../components/BreakdownList");

const PAPER: PastPaperOption = {
  id: 44,
  title: "Practice Test 4",
  collection_name: "Bluebook Pack B",
  subject: "READING_WRITING",
};

const item = (over: Partial<PastpaperItemRow> = {}): PastpaperItemRow => ({
  question_id: 901,
  number: 14,
  module: 1,
  module_label: "Module 1",
  stem: "Which choice completes the text with the most logical word?",
  correct_answer: "B",
  question_type: "READING",
  question_type_label: "Reading",
  format: "MCQ",
  format_label: "Multiple choice",
  skill_id: 7,
  skill: "Words in Context",
  domain_id: 2,
  domain: "Craft and Structure",
  difficulty: "HARD",
  difficulty_label: "Hard",
  seen: 21,
  answered: 20,
  omitted: 1,
  correct: 2,
  wrong: 18,
  error_rate: 90,
  miss_rate: 90,
  needs_analysis: true,
  suspect_key: true,
  ...over,
});

const breakdown = (
  label: string,
  rate: number | null,
  over: Partial<PastpaperGroupRow> = {},
): PastpaperBreakdown => ({
  coverage: { tagged: 10, total: 12 },
  groups: [
    {
      key: 1,
      label,
      questions: 1,
      suspect_key_count: 0,
      analysed_questions: 1,
      seen: 21,
      answered: 19,
      wrong: 12,
      error_rate: rate,
      needs_analysis_count: 1,
      ...over,
    },
  ],
});

function payload(over: Partial<PastpaperItemAnalysis> = {}): PastpaperItemAnalysis {
  const rows = over.questions ?? [item()];
  return {
    practice_test: {
      id: 44,
      title: "Practice Test 4",
      collection_name: "Bluebook Pack B",
      subject: "READING_WRITING",
      subject_label: "Reading & Writing",
    },
    classroom: { id: 3, name: "Chilonzor 12-A", subject: "ENGLISH", subject_label: "English" },
    threshold: 25,
    denominator: "answered",
    attempt_selection: "first_clean_completed_sitting_per_student",
    needs_analysis: rows,
    questions: rows,
    totals: {
      questions: 12,
      seen: 240,
      answered: 215,
      omitted: 12,
      correct: 137,
      wrong: 78,
      // Over the 11 trustworthy questions, not over the 215 raw answers beside it.
      error_rate: 30.6,
      analysed: { questions: 11, seen: 219, answered: 196, wrong: 60 },
      needs_analysis: rows.length,
      suspect_key: 1,
    },
    groups: {
      question_type: breakdown("Reading", 39),
      format: breakdown("Multiple choice", 36),
      skill: breakdown("Cross-Text Connections", 63),
      domain: breakdown("Craft and Structure", 54),
      difficulty: breakdown("Hard", 65),
    },
    unclassified_total: 2,
    unclassified_wrong: 12,
    data_quality: {
      roster: 24,
      attempts_considered: 23,
      attempts_counted: 21,
      students_counted: 21,
      excluded: { copied: 3, repeat_sitting: 2 },
      suspect_key_questions: 1,
    },
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
  pastpaper.mockReset();
  pastPapers.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** Let the query settle: it resolves after the first commit, and the panel re-renders. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The panel starts with no paper chosen; a teacher picks one before anything is analysed. */
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PastPapersPanel classroomId={3} threshold={25} />
      </QueryClientProvider>,
    );
  });
  await flush();

  const select = host.querySelector("select");
  expect(select).not.toBeNull();
  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setValue.call(select!, String(PAPER.id));
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function renderWithPaperChosen(data: PastpaperItemAnalysis) {
  pastPapers.mockResolvedValue([PAPER]);
  pastpaper.mockResolvedValue(data);
  await mount();
}

describe("PastPapersPanel", () => {
  it("draws every breakdown bar in the same track, so 63% is never longer than 65%", async () => {
    // The SAT-skill card used to span two grid columns, which rendered its 63% bar roughly
    // twice the length of the 65% bar in the single-column Difficulty card beside it.
    await renderWithPaperChosen(payload());
    const tracks = Array.from(host.querySelectorAll<HTMLElement>("[data-bar-track]"));
    expect(tracks.length).toBe(5);
    const widths = new Set(tracks.map((t) => t.className));
    expect(widths.size).toBe(1);

    // And no card claims extra columns for itself any more.
    expect(host.innerHTML).not.toContain("col-span");
  });

  it("lays the breakdowns out on the container, not the viewport", async () => {
    await renderWithPaperChosen(payload());
    const grid = Array.from(host.querySelectorAll<HTMLElement>("div")).find((el) =>
      el.style.gridTemplateColumns.includes("auto-fit"),
    );
    expect(grid).toBeDefined();
    expect(grid!.style.alignItems).toBe("start");
    expect(grid!.style.gridTemplateColumns).toBe(BREAKDOWN_GRID_STYLE.gridTemplateColumns);
  });

  it("keeps the warnings visible and folds the method notes", async () => {
    await renderWithPaperChosen(payload());
    const visible = Array.from(host.querySelectorAll("[data-caveat-tone]")).filter(
      (el) => !el.closest("details"),
    );
    const shown = visible.map((el) => el.textContent).join(" ");
    expect(shown).toContain("excluded as corrupt");
    expect(shown).toContain("90% or above");
    expect(shown).not.toContain("first completed sitting");

    // Folded, not deleted.
    const details = host.querySelector<HTMLDetailsElement>("details[data-caveat-notes]");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(false);
    expect(details!.textContent).toContain("first completed sitting");
  });

  it("marks an untagged question instead of showing nothing", async () => {
    await renderWithPaperChosen(
      payload({
        questions: [item({ skill_id: null, skill: "Untagged", domain_id: null, difficulty: null })],
      }),
    );
    // Read it off the flagged row itself: the caveats mention an "Untagged row" too, and a
    // test that passed on that would not be testing the card at all.
    const list = host.querySelector("[data-flagged-list]");
    expect(list?.textContent).toContain("Untagged");
  });

  it("says where a question with no stem lives rather than promising a link it has none for", async () => {
    // No teacher-reachable route addresses a past-paper question: the module editor is
    // admin-only and on the questions console, and the payload carries no module id.
    await renderWithPaperChosen(payload({ questions: [item({ stem: "" })] }));
    expect(host.textContent).toContain("no text stem saved");
    expect(host.textContent).toContain("on the paper itself");
  });

  it("states its cohort, and that it is not the same cohort as the assessments tab", async () => {
    await renderWithPaperChosen(payload());
    const cohort = [...host.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("Who is counted:"),
    );
    expect(cohort).toBeDefined();
    expect(cohort!.closest("details")).toBeNull();
    expect(cohort!.textContent).toContain("24 students");
    expect(cohort!.textContent).toContain("have left the class are not here");

    const details = host.querySelector("details[data-caveat-notes]");
    expect(details!.textContent).toContain("roster as it stands today");
    expect(details!.textContent).toContain("different class sizes");
  });

  it("prints the paper's rate beside the population it divided, not the raw tallies", async () => {
    // `totals.error_rate` holds the suspect answer keys out; `totals.wrong`/`answered` do
    // not. Showing the percentage without `totals.analysed` puts a rate and a set of counts
    // that cannot be reconciled on the same screen.
    await renderWithPaperChosen(payload());
    const line = host.querySelector("[data-paper-rate]")!;
    expect(line.textContent).toContain("30.6%");
    expect(line.textContent).toContain("60 wrong of 196 answers");
    expect(line.textContent).toContain("11 of 12 questions whose answer key looks sound");
    expect(line.textContent).toContain("1 question at 90% or above is held out");
    // And the paper as recorded is still there, under its own words.
    expect(line.textContent).toContain("The paper as recorded: 78 wrong of 215 answers");
  });

  it("says on the row how many questions a breakdown rate had to leave out", async () => {
    await renderWithPaperChosen(
      payload({
        groups: {
          ...payload().groups,
          question_type: breakdown("Math", 0, {
            questions: 2,
            suspect_key_count: 1,
            analysed_questions: 1,
            seen: 12,
            answered: 12,
            wrong: 0,
          }),
        },
      }),
    );
    const counts = [...host.querySelectorAll("[data-breakdown-counts]")].map((p) => p.textContent);
    expect(counts.join(" ")).toContain("2 questions (1 held out)");

    const note = host.querySelector("[data-held-out-note]");
    expect(note?.textContent).toContain("held out as a likely broken answer key");
    expect(note?.textContent).toContain("the rate above is over the other 1 question");
  });

  it("makes an all-suspect group explain its dash rather than look like missing data", async () => {
    // The measured case: Grid-in holds only the question whose key is broken. The em dash is
    // correct — there is nothing trustworthy to average — but on its own it reads as a
    // rendering fault or an empty class.
    await renderWithPaperChosen(
      payload({
        groups: {
          ...payload().groups,
          format: breakdown("Grid-in", null, {
            questions: 1,
            suspect_key_count: 1,
            analysed_questions: 0,
            seen: 0,
            answered: 0,
            wrong: 0,
          }),
        },
      }),
    );
    const counts = [...host.querySelectorAll("[data-breakdown-counts]")].map((p) => p.textContent);
    // Never "0 wrong of 0 answers", which reads as a class that answered nothing.
    expect(counts.join(" ")).toContain("1 question (1 held out) · nothing left to average");
    expect(counts.join(" ")).not.toContain("0 wrong of 0 answers");

    const note = host.querySelector("[data-held-out-note]");
    expect(note?.textContent).toContain("The one question here is at 90% or above");
    expect(note?.textContent).toContain("that dash is not a zero, and nothing is missing");
  });

  it("keeps the selection rule's raw tag off the screen, and its meaning on it", async () => {
    // `attempt_selection` is a machine tag, and the rule it names changed: a student whose
    // first sitting was corrupt is no longer dropped, only that sitting is.
    await renderWithPaperChosen(payload());
    expect(host.textContent).not.toContain("first_clean_completed_sitting_per_student");
    const details = host.querySelector("details[data-caveat-notes]")!;
    expect(details.textContent).toContain("their next clean sitting counts instead");
  });

  it("says a corrupt sitting cost the sitting, not the student", async () => {
    await renderWithPaperChosen(payload());
    const visible = Array.from(host.querySelectorAll("[data-caveat-tone]"))
      .filter((el) => !el.closest("details"))
      .map((el) => el.textContent)
      .join(" ");
    expect(visible).toContain("it is the sitting that was discarded, not the student");
    // And the suspect-key warning now discloses the hold-out, which is what changed the
    // meaning of every rate on the page.
    expect(visible).toContain("held out of the paper's rate and of every statistic below");
  });

  it("still refuses to render a failed fetch as a clean paper", async () => {
    pastPapers.mockResolvedValue([PAPER]);
    pastpaper.mockRejectedValue(new Error("boom"));
    await mount();

    expect(host.textContent).toContain("this is not a clean paper");
    expect(host.textContent).not.toContain("Nothing is over 25%");
  });
});
