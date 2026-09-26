import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import api from "@/lib/api";
import type { ClassroomWithRole } from "../../types";

/**
 * A request that fails on a classroom tab — Materials, Results, and the archived homework under
 * Assignments.
 *
 * All three destructured their query without `isError` and fell straight through to their empty
 * state, so a teacher whose request never came back was told their class has no materials, no
 * results, and nothing archived. Nothing of the sort had happened: the files, the scores and the
 * archive were all still there, and the page had simply not read them.
 *
 * A load that fails is its own state: it says what did not load and offers "Try again", which runs
 * the load again. The empty state is kept for a class that really is empty.
 *
 * Only the HTTP call is stubbed, so each tab goes through its real hook and its real api client.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/teacher/classrooms/1",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { Materials } = await import("../Materials");
const { Results } = await import("../Results");
const { Assignments } = await import("../Assignments");

/** `GET /api/classes/1/` as the class's teacher receives it. */
const ALGEBRA = {
  id: 1,
  name: "Algebra 2",
  subject: "MATH",
  lesson_days: "ODD",
  join_code: "JOIN1",
  my_role: "TEACHER",
  members_count: 22,
  student_count: 20,
} as ClassroomWithRole;

const MATERIALS = "/classes/1/materials/";
const RESULTS = "/classes/1/results/";
const ASSIGNMENTS = "/classes/1/assignments/";
const ARCHIVED = "/classes/1/assignments/?include_archived=1";

/** What the server sends back when it is reachable. */
const OK: Record<string, unknown> = {
  [MATERIALS]: { results: [] },
  [RESULTS]: { rows: [], summary: null },
  [ASSIGNMENTS]: [],
  [ARCHIVED]: [],
};

/** Answer every request from `OK`, except the urls in `failing`, which reject. */
function serve(failing: Set<string>) {
  const get = async (url: string) => {
    if (failing.has(url)) throw new Error("Network Error");
    if (url in OK) return { data: OK[url] };
    throw new Error(`unexpected GET ${url}`);
  };
  vi.spyOn(api, "get").mockImplementation(get as unknown as typeof api.get);
}

let host: HTMLDivElement;
let root: Root;

const text = () => (host.textContent ?? "").replace(/\s+/g, " ").trim();

/** Let the queries settle until `done`, or fail naming what never happened. */
async function until(done: () => boolean, what: string) {
  for (let tick = 0; tick < 50 && !done(); tick++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  if (!done()) throw new Error(`${what} never happened`);
}

const spinning = () => host.querySelector(".animate-spin") != null;

/** The "Try again" the ErrorState offers, or null when the page is not offering one. */
function tryAgain(): HTMLButtonElement | null {
  return ([...host.querySelectorAll("button")] as HTMLButtonElement[]).find(
    (b) => (b.textContent ?? "").trim() === "Try again",
  ) ?? null;
}

async function mount(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await until(() => !spinning(), "the tab settling");
}

beforeEach(() => {
  // React 19 only flushes work inside `act` when the environment declares itself one.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("Materials — the request for this class's files fails", () => {
  it("says the materials did not load, and never that the class has none", async () => {
    serve(new Set([MATERIALS]));
    await mount(<Materials classroom={ALGEBRA} />);

    expect(text()).toContain("Could not load this class’s materials.");
    expect(text()).toContain("Network Error");
    expect(tryAgain()).not.toBeNull();
    expect(text()).not.toContain("No materials yet");
  });

  it("loads the materials when the teacher tries again", async () => {
    const failing = new Set([MATERIALS]);
    serve(failing);
    await mount(<Materials classroom={ALGEBRA} />);

    OK[MATERIALS] = {
      results: [{ id: 7, title: "Unit 3 vocabulary", file_name: "unit3.pdf", file_url: "/m/7", created_at: "2026-09-18T09:00:00+05:00" }],
    };
    failing.delete(MATERIALS);
    await act(async () => tryAgain()?.click());
    await until(() => text().includes("Unit 3 vocabulary"), "the materials arriving");

    expect(text()).not.toContain("Could not load this class’s materials.");
    expect(tryAgain()).toBeNull();
    OK[MATERIALS] = { results: [] };
  });

  it("still says the class has no materials when the class really has none", async () => {
    serve(new Set());
    await mount(<Materials classroom={ALGEBRA} />);

    expect(text()).toContain("No materials yet");
    expect(tryAgain()).toBeNull();
  });
});

describe("Results — the request for this class's scores fails", () => {
  it("says the results did not load, and never that the filter found nothing", async () => {
    serve(new Set([RESULTS]));
    await mount(<Results classroom={ALGEBRA} />);

    expect(text()).toContain("Could not load these results.");
    expect(text()).toContain("Network Error");
    expect(tryAgain()).not.toBeNull();
    expect(text()).not.toContain("No results yet for this filter.");
  });

  it("still says the filter found nothing when the filter really found nothing", async () => {
    serve(new Set());
    await mount(<Results classroom={ALGEBRA} />);

    expect(text()).toContain("No results yet for this filter.");
    expect(tryAgain()).toBeNull();
  });
});

describe("Assignments — the request for this class's archived homework fails", () => {
  /** Open the archived section and wait for it to settle. */
  async function showArchived() {
    const button = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Show archived");
    if (!button) throw new Error("no Show archived button");
    await act(async () => button.click());
    await until(() => !spinning(), "the archived list settling");
  }

  it("says the archive did not load, and never that nothing is archived", async () => {
    serve(new Set([ARCHIVED]));
    await mount(<Assignments classroom={ALGEBRA} />);
    await showArchived();

    expect(text()).toContain("Could not load the archived homework.");
    expect(tryAgain()).not.toBeNull();
    expect(text()).not.toContain("Nothing archived");
  });

  it("still says nothing is archived when nothing is", async () => {
    serve(new Set());
    await mount(<Assignments classroom={ALGEBRA} />);
    await showArchived();

    expect(text()).toContain("Nothing archived");
    expect(tryAgain()).toBeNull();
  });
});
