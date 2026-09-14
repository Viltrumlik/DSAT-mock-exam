/**
 * A homework's own page as the teaching team sees it (`/teacher/classrooms/[id]/assignments/[id]`).
 *
 * Its "Grading" card offered "Open in gradebook" whatever the homework's status. A draft reaches no
 * student, so nothing on it can be handed in or graded: the button opened a gradebook that either
 * leaves the draft out or counts the whole class as missing it, and never said what comes first.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const push = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...args: unknown[]) => get(...args), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  classesApi: {
    get: async (id: number) => ({ id, name: "Middle G13", my_role: "OWNER" }),
    getMySubmission: vi.fn(),
    submitAssignment: vi.fn(),
  },
  // Aliased at import time by `features/examsStudent/api`; only the student view calls it.
  examsPublicApi: {},
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/classrooms/34/assignments/102",
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { AssignmentDetailPage } = await import("../pages/AssignmentDetail");

const BASE = "/teacher/classrooms/34";

/** `GET /api/classes/34/assignments/102/` for a written homework, as the teaching team receives it. */
function homework(status: "DRAFT" | "PUBLISHED") {
  return {
    id: 102,
    title: "Unit 3 review",
    instructions: "Answer the questions at the end of chapter 3.",
    status,
    category: "HOMEWORK",
    // The class's next lesson, which `create` gives all homework. On a draft it is a placeholder.
    due_at: "2026-09-14T18:00:00+05:00",
    max_score: "100.00",
    allow_file_upload: true,
    assessment_homework: null,
    assessment_homeworks: [],
    vocab_homeworks: [],
    external_urls: [],
  };
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
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

/** Serve `detail` as the homework and mount its page for the class owner. */
async function mount(detail: object) {
  get.mockImplementation(async (url: string) => {
    if (url === "/classes/34/assignments/102/") return { data: detail };
    throw new Error(`unexpected GET ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssignmentDetailPage classId={34} assignmentId={102} basePath={BASE} />
      </QueryClientProvider>,
    );
  });
  for (let tick = 0; tick < 50 && !host.textContent?.includes("Grading"); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!host.textContent?.includes("Grading")) throw new Error("the teacher view never rendered");
}

const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label);

describe("A homework's page — the Grading card", () => {
  it("tells the teacher a draft has nothing to grade yet, instead of sending them to the gradebook", async () => {
    await mount(homework("DRAFT"));

    expect(host.textContent).toContain("Draft");
    expect(buttons("Open in gradebook")).toHaveLength(0);
    expect(host.textContent).toContain("Students cannot see a draft, so there is nothing to grade yet.");
    expect(host.textContent).toContain("You publish it on the Assignments tab.");
  });

  it("still opens the gradebook for published homework", async () => {
    await mount(homework("PUBLISHED"));

    const [open] = buttons("Open in gradebook");
    expect(open).toBeTruthy();
    await act(async () => open.click());
    expect(push).toHaveBeenCalledWith(`${BASE}?tab=grading&assignment=102`);
    expect(host.textContent).not.toContain("Students cannot see a draft");
  });
});
