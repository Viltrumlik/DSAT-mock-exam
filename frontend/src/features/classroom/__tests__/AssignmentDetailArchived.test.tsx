/**
 * An archived homework's own page as the teaching team sees it (`/teacher/classrooms/[id]/assignments/[id]`).
 *
 * The API used to leave archived work out of what it gave the teaching team by id, as its list still does
 * unless the request says `include_archived`. So an archived homework opened from the Assignments tab's
 * archived list read "Assignment not available" and its "Open in gradebook" was never reached. By id, the
 * teaching team now gets archived work too. Archiving keeps the grades, but the gradebook's list leaves
 * archived homework out, so the button opens the gradebook on this homework itself.
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

/** `GET /api/classes/34/assignments/102/` for a written homework the class owner archived. */
const ARCHIVED_HOMEWORK = {
  id: 102,
  title: "Unit 3 review",
  instructions: "Answer the questions at the end of chapter 3.",
  status: "ARCHIVED",
  category: "HOMEWORK",
  due_at: "2026-09-10T18:00:00+05:00",
  max_score: "100.00",
  allow_file_upload: true,
  assessment_homework: null,
  assessment_homeworks: [],
  vocab_homeworks: [],
  external_urls: [],
};

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

/** Mount the page for the class owner, with the API answering as `AssignmentViewSet` does: by id, the teaching team gets archived work. */
async function mount() {
  get.mockImplementation(async (url: string) => {
    if (url !== "/classes/34/assignments/102/") throw new Error(`unexpected GET ${url}`);
    return { data: ARCHIVED_HOMEWORK };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AssignmentDetailPage classId={34} assignmentId={102} basePath={BASE} />
      </QueryClientProvider>,
    );
  });
  const settled = () => ["Grading", "Assignment not available"].some((t) => host.textContent?.includes(t));
  for (let tick = 0; tick < 50 && !settled(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!settled()) throw new Error("the page never rendered");
}

const buttons = (label: string) =>
  [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label);

describe("An archived homework's page", () => {
  it("opens, instead of reading \"Assignment not available\"", async () => {
    await mount();

    expect(host.textContent).not.toContain("Assignment not available");
    expect(host.textContent).toContain("Unit 3 review");
    expect(host.textContent).toContain("Archived");
  });

  it("opens the gradebook on this homework, which the gradebook's list leaves out", async () => {
    await mount();

    const [open] = buttons("Open in gradebook");
    expect(open).toBeTruthy();
    await act(async () => open.click());
    expect(push).toHaveBeenCalledWith(`${BASE}?tab=grading&assignment=102`);
  });
});
