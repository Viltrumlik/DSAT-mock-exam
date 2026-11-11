/**
 * /builder — Studio home (design handoff v0.3, BuilderHome board): the bank at a glance (every
 * number opens the bank filtered to it), what waits for review, what changed lately; a failed
 * source says so and is never zero.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    { key: "classified", options: [{ value: "no", label: "No", count: 4 }] },
  ],
};
const BY_SUBJECT: Record<string, unknown> = {
  READING_WRITING: { count: 37, results: [], filters: [statusFacet({ IMPORTED: 6, TRIAGE: 7, APPROVED: 21 })] },
  MATH: { count: 32, results: [], filters: [statusFacet({ IMPORTED: 8, TRIAGE: 5, APPROVED: 17 })] },
};
const RECENT = { count: 69, results: [{ id: 30, qb_id: "QB-MATH-000030", question_text: "<p>Which of the following is equal to $x$?</p>", status: "TRIAGE", updated_at: new Date().toISOString() }] };

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
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  get.mockImplementation(async (_url: string, opts: { params: Record<string, string> }) => {
    const p = opts.params;
    if (p.o === "-updated") return { data: RECENT };
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
  it("greets the author and says what waits for review", async () => {
    await render();
    expect(host.textContent).toContain("Welcome back, Nodira");
    expect(host.textContent).toContain("12 questions waiting for review");
    expect(host.textContent).toContain("4 questions without a skill");
  });

  it("lays the bank out by subject and status, each number opening the bank filtered to it", async () => {
    await render();
    const cell = host.querySelector('a[aria-label="5 Math questions, In review"]');
    expect(cell?.getAttribute("href")).toBe("/builder/question-bank?subject=MATH&status=TRIAGE");
    // jsdom's selector engine trips on the & in an attribute selector, so compare the label directly.
    const labels = [...host.querySelectorAll("a[aria-label]")].map((a) => a.getAttribute("aria-label"));
    expect(labels).toContain("21 R&W questions, Approved");
  });

  it("lists what changed lately, with its QB-ID and state", async () => {
    await render();
    const link = host.querySelector('a[href="/builder/question-bank/30"]');
    expect(link?.textContent).toContain("QB-MATH-000030");
    expect(link?.textContent).toContain("In review");
  });

  it("says the bank failed to load rather than showing zeros", async () => {
    get.mockImplementation(async (_url: string, opts: { params: Record<string, string> }) => {
      if (opts.params.o === "-updated") return { data: RECENT };
      throw new Error("down");
    });
    await render();
    expect(host.textContent).toContain("Couldn’t load the question bank. This is not zero.");
    expect(host.textContent).toContain("Couldn’t check the review queue.");
    expect(host.textContent).not.toContain("Nothing waits for review");
  });
});
