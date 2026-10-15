/**
 * A practice test is never presented as a past paper (owner rule, 2026-10-15).
 *
 * A homework that sets practice tests travels as `practice_test_ids` like a past paper does, so
 * `assignmentKind` keeps answering PASTPAPER: that is the ENGINE kind, and routing, launch and the
 * results all key off it. Only the WORDS change. The homework page said "Past Paper" in three places
 * — the student's launcher card, the hero badge, and the teacher's header — and each now asks one
 * helper, so a homework whose every section is a practice test reads "Practice Test(s)" and a mix
 * keeps the label it had.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const getMySubmission = vi.fn();
let myRole = "STUDENT";

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    get: async (id: number) => ({ id, name: "Middle G13", my_role: myRole }),
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
// The teacher's statistics cards fetch their own data and say "past paper" in their own words; this
// file is about the homework's own labels.
vi.mock("@/features/questionAnalysis/HomeworkQuestionStatistics", () => ({ HomeworkQuestionStatistics: () => null }));
vi.mock("@/features/teacher/mistakes", () => ({ MostMissed: () => null }));

const { AssignmentDetailPage } = await import("../pages/AssignmentDetail");
const { assignmentKind, contentActions, homeworkKindLabel, contentKindLabel } = await import("../homeworkApi");
type AssignmentDetail = import("../homeworkApi").AssignmentDetail;
type Section = NonNullable<AssignmentDetail["practice_bundle_tests"]>[number];

const PRACTICE_4: Section = { id: 9, name: "Practice Test 4", is_practice_test: true, state: "not_started", subject: "MATH", attempt_id: null };
const PRACTICE_5: Section = { id: 10, name: "Practice Test 5", is_practice_test: true, state: "not_started", subject: "READING_WRITING", attempt_id: null };
const PAPER: Section = { id: 12, name: "SAT March 2024", state: "not_started", subject: "MATH", attempt_id: null };

function homework(...sections: Section[]): AssignmentDetail & Record<string, unknown> {
  return {
    id: 102,
    title: "Lesson 20 homework",
    instructions: "",
    due_at: null,
    status: "PUBLISHED",
    category: "HOMEWORK",
    max_score: null,
    assessment_homework: null,
    assessment_homeworks: [],
    vocab_homeworks: [],
    external_urls: [],
    practice_test_ids: sections.map((s) => s.id),
    practice_bundle_tests: sections,
  };
}

describe("homeworkKindLabel", () => {
  it("names a homework of one practice test a Practice Test, and keeps the engine kind", () => {
    const a = homework(PRACTICE_4);
    expect(assignmentKind(a)).toBe("PASTPAPER");
    expect(homeworkKindLabel(a)).toBe("Practice Test");
  });

  it("uses the plural where several practice tests are set", () => {
    expect(homeworkKindLabel(homework(PRACTICE_4, PRACTICE_5))).toBe("Practice Tests");
  });

  it("leaves a past paper, and a mix of the two, as Past Paper", () => {
    expect(homeworkKindLabel(homework(PAPER))).toBe("Past Paper");
    expect(homeworkKindLabel(homework(PRACTICE_4, PAPER))).toBe("Past Paper");
  });

  it("does not guess when the sections did not arrive", () => {
    const a = homework(PRACTICE_4);
    a.practice_bundle_tests = [];
    expect(homeworkKindLabel(a)).toBe("Past Paper");
  });
});

describe("contentKindLabel", () => {
  it("labels each launcher card by what it opens", () => {
    const [practice, paper] = contentActions(homework(PRACTICE_4, PAPER));
    expect(contentKindLabel(practice)).toBe("Practice Test");
    expect(contentKindLabel(paper)).toBe("Past Paper");
  });
});

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  getMySubmission.mockReset();
  getMySubmission.mockResolvedValue({ id: 1, status: "ASSIGNED", workflow_status: null, files: [] });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

async function mount(detail: object, role: "STUDENT" | "OWNER") {
  myRole = role;
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/assignments/102/") return { data: detail };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssignmentDetailPage classId={34} assignmentId={102} />
      </QueryClientProvider>,
    );
  });
  const marker = role === "OWNER" ? "Grading" : "Start";
  for (let tick = 0; tick < 80 && !host.textContent?.includes(marker); tick++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  if (!host.textContent?.includes(marker)) throw new Error("the page never rendered");
}

describe("the student's homework page", () => {
  it("never says Past Paper for a practice test, on the badge or on the card", async () => {
    await mount(homework(PRACTICE_4), "STUDENT");
    expect(host.textContent).toContain("Practice Test");
    expect(host.textContent).not.toMatch(/past paper/i);
  });

  it("says Practice Tests on the badge of a homework of several, and Practice Test on each card", async () => {
    await mount(homework(PRACTICE_4, PRACTICE_5), "STUDENT");
    expect(host.textContent).toContain("Practice Tests");
    expect(host.textContent).not.toMatch(/past paper|bundle/i);
  });

  it("keeps Past Paper on a past paper", async () => {
    await mount(homework(PAPER), "STUDENT");
    expect(host.textContent).toContain("Past Paper");
    expect(host.textContent).not.toMatch(/practice test/i);
  });

  it("keeps Bundle for a mix", async () => {
    await mount(homework(PRACTICE_4, PAPER), "STUDENT");
    expect(host.textContent).toContain("Bundle");
  });
});

describe("the teacher's homework page", () => {
  it("heads a practice-test homework Practice Test, not Past Paper", async () => {
    await mount(homework(PRACTICE_4), "OWNER");
    expect(host.querySelector("header")?.textContent).toContain("Practice Test");
    expect(host.querySelector("header")?.textContent).not.toMatch(/past paper/i);
  });

  it("keeps Past Paper on a past-paper homework", async () => {
    await mount(homework(PAPER), "OWNER");
    expect(host.querySelector("header")?.textContent).toContain("Past Paper");
  });
});
