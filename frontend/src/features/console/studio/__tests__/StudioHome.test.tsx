/**
 * /builder — Studio home (design handoff v0.3, BuilderHome board): the header line, the mid-attempt badge,
 * the five kinds of thing that need the team, the bank at a glance (every number opens the bank filtered to
 * it), where you left off, Team today, coverage by skill and the library with live counts — all from one
 * Studio summary; a failed summary says so and is never zero.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioSummary } from "../summary";

const get = vi.fn();
vi.mock("@/lib/api", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me: { id: 3, role: "test_admin", first_name: "Nodira" } }) }));

const { StudioHome } = await import("../StudioHome");

const statusFacet = (counts: Record<string, number>) => ({
  key: "status",
  options: Object.entries(counts).map(([value, count]) => ({ value, label: value === "TRIAGE" ? "In review" : value[0] + value.slice(1).toLowerCase(), count })),
});
const ALL = {
  count: 69,
  results: [],
  filters: [
    { key: "subject", options: [{ value: "READING_WRITING", label: "R&W", count: 37 }, { value: "MATH", label: "Math", count: 32 }] },
    statusFacet({ IMPORTED: 14, TRIAGE: 12, APPROVED: 38 }),
  ],
};
const BY_SUBJECT: Record<string, unknown> = {
  READING_WRITING: { count: 37, results: [], filters: [statusFacet({ IMPORTED: 6, TRIAGE: 7, APPROVED: 21 })] },
  MATH: { count: 32, results: [], filters: [statusFacet({ IMPORTED: 8, TRIAGE: 5, APPROVED: 17 })] },
};
const now = new Date().toISOString();
const SUMMARY: StudioSummary = {
  review: { count: 12, oldest_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), with_suggestion: 4 },
  no_key: { count: 6, live: 2 },
  no_skill: { count: 4 },
  imports: { batches: 3, with_errors: 1, failed: [{ id: 3, filename: "b3.pdf", errors: 3, duplicates: 0, at: now, by: "Doston" }] },
  mocks: {
    total: 6,
    live: 5,
    incomplete: 1,
    not_ready: [{ id: 7, title: "Full Mock 7", live: false, ready: false, block_reason: "Every module needs at least one question.", short: 30, gaps: [{ module: "R&W 2", have: 19, need: 27 }, { module: "Math 2", have: 0, need: 22 }] }],
    not_ready_count: 1,
    mid_attempt: [{ id: 5, title: "Full Mock 5", students: 4 }],
  },
  team_today: [
    { who: "Kamola", mine: false, what: "approved 6 questions", detail: "", at: now, kind: "qb_question_approve" },
    { who: "Doston", mine: false, what: "imported batch #3", detail: "3 rows failed", at: now, kind: "import" },
    { who: null, mine: false, what: "Full Mock 5 published", detail: "full mock", at: now, kind: "publish" },
  ],
  coverage: {
    target: 10,
    thin_below: 5,
    skills: [
      { id: 1, name: "Words in Context", domain: "Craft", subject: "ENGLISH", approved: 9 },
      { id: 2, name: "Linear equations", domain: "Algebra", subject: "MATH", approved: 12 },
      { id: 3, name: "Cross-Text Connections", domain: "Craft", subject: "ENGLISH", approved: 3 },
      { id: 4, name: "Geometry & trigonometry", domain: "Geo", subject: "MATH", approved: 0 },
    ],
  },
  library: {
    questions: { total: 69, review: 12, english: 37, math: 32 },
    sets: { total: 17, live: 15, english: 8, math: 9, categories: 5 },
    midterms: { total: 14, live: 10, english: 6, math: 8 },
    vocabulary: { sections: 4, names: ["SAT Core", "Hard words for 750+"] },
    imports: { batches: 3, with_errors: 1 },
    pastpapers: { total: 6, live: 4 },
    practice_tests: { total: 8, live: 6 },
    mocks: { total: 6, live: 5, incomplete: 1 },
  },
  recent: [],
};

let summary: StudioSummary | Error = SUMMARY;
let host: HTMLDivElement;
let root: Root;
async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StudioHome />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 6; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}
const text = () => host.textContent ?? "";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  summary = SUMMARY;
  window.localStorage.clear();
  get.mockReset();
  get.mockImplementation(async (url: string, opts: { params: Record<string, string> }) => {
    if (url === "/questionbank/studio/summary/") {
      if (summary instanceof Error) throw summary;
      return { data: summary };
    }
    const p = opts.params;
    if (p.subject) return { data: BY_SUBJECT[p.subject] };
    return { data: ALL };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("StudioHome", () => {
  it("greets the author with the review queue and the mock closest to ready", async () => {
    await render();
    expect(text()).toContain("Welcome back, Nodira");
    expect(text()).toContain("12 questions waiting for review · Full Mock 7 is 30 questions from ready");
    const badge = host.querySelector('a[href="/builder/full-mocks/5"]');
    expect(badge?.textContent).toContain("4 mid-attempt on Full Mock 5");
  });

  it("lists the five kinds that need the team, in the board's order, each opening its list", async () => {
    await render();
    const t = text();
    const order = [
      "6 questions have no answer key",
      "12 questions waiting for review",
      "Import batch #3 failed validation",
      "Full Mock 7 can’t be published yet",
      "4 questions without a skill",
    ].map((s) => t.indexOf(s, t.indexOf("Needs you")));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain("2 are in live tests — students can’t be scored on them");
    expect(t).toContain("Oldest 3 days · 4 have a suggestion");
    expect(t).toContain("R&W 2 needs 8 more · Math 2 is empty");
    expect(host.querySelector('a[href="/builder/question-bank?answer=no"]')?.textContent).toContain("Fix keys");
    expect(host.querySelector('a[href="/builder/question-bank/imports/3"]')?.textContent).toContain("See errors");
    // The card's count is the number of KINDS: five.
    expect(t).toContain("Needs you5");
  });

  it("lays the bank out by subject and status, each number opening the bank filtered to it", async () => {
    await render();
    const cell = host.querySelector('a[aria-label="5 Math questions, In review"]');
    expect(cell?.getAttribute("href")).toBe("/builder/question-bank?subject=MATH&status=TRIAGE");
    // jsdom's selector engine trips on the & in an attribute selector, so compare the label directly.
    const labels = [...host.querySelectorAll("a[aria-label]")].map((a) => a.getAttribute("aria-label"));
    expect(labels).toContain("21 R&W questions, Approved");
  });

  it("continues where this browser left off, with each item's live state", async () => {
    window.localStorage.setItem(
      "ms-recent-builder",
      JSON.stringify([
        { kind: "mock", id: 7, name: "Full Mock 7", href: "/builder/full-mocks/7", at: Date.now() - 40 * 60_000 },
        { kind: "question", id: 30, name: "QB-MATH-000030", href: "/builder/question-bank/30", at: Date.now() - 3_600_000 },
        { kind: "set", id: 99, name: "Deleted set", href: "/builder/sets/99", at: Date.now() },
      ]),
    );
    summary = {
      ...SUMMARY,
      recent: [
        { kind: "mock", ...SUMMARY.mocks.not_ready[0], updated_at: now },
        { kind: "question", id: 30, title: "QB-MATH-000030", text: "<p>Which of the following is equal to $x$?</p>", status: "TRIAGE", subject: "MATH", skill: null, needs_skill: true, imported: true, updated_at: now, created_at: now },
      ],
    };
    await render();
    expect(get).toHaveBeenCalledWith("/questionbank/studio/summary/", { params: { recent: "mock:7,question:30,set:99" } });
    expect(text()).toContain("Continue where you left off");
    const cards = [...host.querySelectorAll('a[href="/builder/full-mocks/7"]')].map((a) => a.textContent ?? "");
    const mock = cards.find((c) => c.includes("R&W 2 · 19 / 27"));
    expect(mock).toContain("8 + 22 questions to add");
    expect(mock).toContain("Incomplete");
    const q = host.querySelector('a[href="/builder/question-bank/30"]');
    expect(q?.textContent).toContain("Which of the following is equal to …?");
    expect(q?.textContent).toContain("needs a skill");
    expect(q?.textContent).toContain("In review");
    // The set the server no longer has is not drawn.
    expect(host.querySelector('a[href="/builder/sets/99"]')).toBeNull();
  });

  it("shows no Continue row before this browser opened anything", async () => {
    await render();
    expect(text()).not.toContain("Continue where you left off");
  });

  it("says what the team did today, naming nobody for publishing", async () => {
    await render();
    expect(text()).toContain("Kamola approved 6 questions");
    expect(text()).toContain("Doston imported batch #3");
    expect(text()).toContain("3 rows failed");
    expect(text()).toContain("Full Mock 5 published");
  });

  it("draws coverage thinnest first with the finding", async () => {
    await render();
    const t = text();
    expect(t.indexOf("Geometry & trigonometry")).toBeLessThan(t.indexOf("Cross-Text Connections"));
    expect(t).toContain("2 skills have fewer than 5 approved questions. 1 has none yet.");
    expect(t).toContain("line = target of 10");
  });

  it("counts the library", async () => {
    await render();
    const t = text();
    expect(t).toContain("R&W 37");
    expect(t).toContain("English 8");
    expect(t).toContain("1 with errors");
    expect(t).toContain("5 live");
    expect(t).toContain("1 incomplete");
    expect(t).toContain("SAT Core · Hard words for 750+ · …");
  });

  it("says the summary failed rather than showing zeros", async () => {
    summary = new Error("down");
    await render();
    const t = text();
    expect(t).toContain("Couldn’t check what needs the team.");
    expect(t).toContain("Couldn’t load today’s activity");
    expect(t).toContain("Couldn’t load coverage");
    expect(t).not.toContain("Nothing waits for review");
    expect(t).not.toContain("Nothing yet today");
  });
});
