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

const breakdown = (label: string, rate: number): PastpaperBreakdown => ({
  coverage: { tagged: 10, total: 12 },
  groups: [
    {
      key: 1,
      label,
      questions: 1,
      seen: 21,
      answered: 19,
      wrong: 12,
      error_rate: rate,
      needs_analysis_count: 1,
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
    attempt_selection: "first completed sitting",
    needs_analysis: rows,
    questions: rows,
    totals: {
      questions: 12,
      seen: 240,
      answered: 215,
      omitted: 12,
      correct: 137,
      wrong: 78,
      error_rate: 36,
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

  it("still refuses to render a failed fetch as a clean paper", async () => {
    pastPapers.mockResolvedValue([PAPER]);
    pastpaper.mockRejectedValue(new Error("boom"));
    await mount();

    expect(host.textContent).toContain("this is not a clean paper");
    expect(host.textContent).not.toContain("Nothing is over 25%");
  });
});
