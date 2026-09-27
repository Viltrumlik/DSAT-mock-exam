/**
 * The assessment library on the teacher panel.
 *
 * Four states, and the pair in the middle is what these tests exist for: the page this replaced
 * rendered its error banner and its "nothing here" card as sibling blocks, so a 403 painted both
 * at once and told a teacher their access is empty when the server had said no such thing.
 * Neither may ever render as the other.
 *
 * Then the two quieter lies the old page told with a straight face: a question count that
 * included questions the runner refuses to deal, and a search that answered "no match" about
 * sets it had never asked the server for.
 *
 * Every fixture here is invented. This repository is public and no real student or teacher
 * appears in it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const adminListSets = vi.fn();

vi.mock("@/lib/api", () => ({
  assessmentsAdminApi: {
    adminListSets: (params?: Record<string, unknown>) => adminListSets(params),
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { TeacherAssessments } = await import("../assessments/TeacherAssessments");

/** A question as the set serializer sends it — only the field this page reads matters here. */
function question(id: number, isActive = true) {
  return { id, order: id, prompt: `Question ${id}`, question_type: "MCQ", is_active: isActive };
}

const SETS = [
  {
    id: 7,
    title: "Linear equations in two variables",
    subject: "math",
    level: "middle",
    category: "Algebra",
    description: "Slope and intercept from a table.",
    is_active: true,
    questions: [question(1), question(2), question(3)],
  },
  {
    id: 8,
    title: "Transitions and boundaries",
    subject: "english",
    level: "senior",
    category: "Standard English Conventions",
    description: "Semicolons, and the comma that should not be there.",
    is_active: true,
    questions: [question(11), question(12)],
  },
  {
    id: 9,
    title: "Circles in the coordinate plane",
    subject: "math",
    level: "junior",
    category: "Geometry",
    description: "",
    // Authored, not given out yet.
    is_active: false,
    // Five written, two retired: the runner opens this one at "Question 1 of 3".
    questions: [question(21), question(22), question(23), question(24, false), question(25, false)],
  },
];

function envelope(results: unknown[], extra: Record<string, unknown> = {}) {
  return { count: results.length, next: null, previous: null, results, ...extra };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  adminListSets.mockReset();
  push.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function mount(node: ReactNode, settle = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  if (settle) { await flush(); await flush(); }
}

const text = () => host.textContent ?? "";

/** React listens on the native input event, so the value has to be set the way the browser does. */
async function type(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLInputElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
}

describe("the assessment library — while it is loading", () => {
  it("shows neither an answer nor a failure, only the placeholder", async () => {
    // A promise that never settles: the pending state, held still.
    adminListSets.mockReturnValue(new Promise(() => {}));
    await mount(<TeacherAssessments />, false);

    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(text()).not.toContain("No assessments available to you yet");
    // The skeleton's own shape — six 40px bars. A bare `[aria-hidden="true"]` would be
    // satisfied by any decorative icon on the page and prove nothing about this state.
    const bars = [...host.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].filter(
      (d) => d.style.height === "40px",
    );
    expect(bars).toHaveLength(6);
  });
});

describe("the assessment library — when the request fails", () => {
  it("says the request failed, and never that the teacher has no assessments", async () => {
    adminListSets.mockRejectedValue(new Error("403"));
    await mount(<TeacherAssessments />);

    expect(text()).toContain("The assessments didn't load");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain("Try again");
    // The whole reason this page was rebuilt rather than repainted: GET /assessments/admin/sets/
    // 403s on a frozen or unpermitted account, and the old page answered that with a statement
    // about the teacher's own library that the server had never made.
    expect(text()).not.toContain("No assessments available to you yet");
    expect(host.querySelector("table")).toBeNull();
  });

  it("asks again when the retry is pressed", async () => {
    adminListSets.mockRejectedValue(new Error("network"));
    await mount(<TeacherAssessments />);
    const before = adminListSets.mock.calls.length;

    const retry = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Try again"));
    expect(retry).toBeTruthy();
    await act(async () => { retry!.click(); });
    await flush();

    expect(adminListSets.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("the assessment library — when there is nothing to show", () => {
  it("gives the reason, not a blank page", async () => {
    adminListSets.mockResolvedValue(envelope([]));
    await mount(<TeacherAssessments />);

    expect(text()).toContain("No assessments available to you yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("table")).toBeNull();
  });
});

describe("the assessment library — when the sets come back", () => {
  beforeEach(() => {
    adminListSets.mockResolvedValue(envelope(SETS));
  });

  it("lists each set with its subject, its level and its category", async () => {
    await mount(<TeacherAssessments />);

    expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(text()).toContain("Linear equations in two variables");
    expect(text()).toContain("Transitions and boundaries");
    expect(text()).toContain("Math");
    expect(text()).toContain("English");
    expect(text()).toContain("Standard English Conventions");
    expect(text()).toContain("senior");
    expect(text()).not.toContain("No assessments available to you yet");
  });

  it("counts only the questions a sitting would deal", async () => {
    await mount(<TeacherAssessments />);

    // Five questions are written on set 9 and two of them are deactivated. The runner filters
    // `is_active !== false` and opens at "Question 1 of 3"; a card that said 5 sent the teacher
    // to a class with the wrong number in their mouth.
    const cells = [...host.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => (c.textContent ?? "").trim()),
    );
    const circles = cells.find((c) => c[0].includes("Circles in the coordinate plane"));
    expect(circles).toBeTruthy();
    expect(circles).toContain("3");
    expect(circles).not.toContain("5");
  });

  it("marks a set that has not been given out yet, and still lists it", async () => {
    await mount(<TeacherAssessments />);

    expect(text()).toContain("Draft");
    // A draft is findable and openable — the marker is information, not a gate.
    expect(text()).toContain("Circles in the coordinate plane");
  });

  it("opens the practice runner from the row's own button", async () => {
    await mount(<TeacherAssessments />);

    const rows = [...host.querySelectorAll("tbody tr")];
    const first = rows[0].querySelector("button");
    await act(async () => { (first as HTMLButtonElement).click(); });

    expect(push).toHaveBeenCalledWith("/teacher/assessments/7/practice");
  });

  it("narrows to one subject when the filter is pressed", async () => {
    await mount(<TeacherAssessments />);

    await act(async () => { buttonLabelled("English")!.click(); });
    await flush();

    expect(text()).toContain("Transitions and boundaries");
    expect(text()).not.toContain("Linear equations in two variables");

    await act(async () => { buttonLabelled("All")!.click(); });
    await flush();
    expect(text()).toContain("Linear equations in two variables");
  });

  it("searches the set's description as well as its name", async () => {
    await mount(<TeacherAssessments />);

    // "Semicolons" is nowhere on screen — it is in the description, which is the only place an
    // untitled set's topic is ever written down, so it is worth searching.
    await type('input[aria-label="Search assessments"]', "semicolons");

    expect(text()).toContain("Transitions and boundaries");
    expect(text()).not.toContain("Linear equations in two variables");
  });

  it("says a search found nothing in the search's own words, not the library's", async () => {
    await mount(<TeacherAssessments />);

    await type('input[aria-label="Search assessments"]', "trigonometry");

    expect(text()).toContain("No assessment matches");
    // The library is not empty and nothing failed; saying either would be a different claim.
    expect(text()).not.toContain("No assessments available to you yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("the assessment library — when the server pages the list", () => {
  it("walks the pages instead of keeping the first 200", async () => {
    // The view pins max_limit = 200, so the old single `limit: 500` was clamped and the 201st
    // set simply did not exist as far as the search box was concerned.
    const bulk = Array.from({ length: 200 }, (_, i) => ({
      id: 100 + i, title: `Practice set ${i + 1}`, subject: "math", level: "junior",
      category: "Algebra", description: "", is_active: true, questions: [question(1)],
    }));
    const last = {
      id: 999, title: "Rational exponents", subject: "math", level: "senior",
      category: "Advanced Math", description: "", is_active: true, questions: [question(1)],
    };
    adminListSets.mockImplementation((params?: { offset?: number }) =>
      Promise.resolve(
        (params?.offset ?? 0) === 0
          ? { count: 201, next: "http://api.test/assessments/admin/sets/?limit=200&offset=200", previous: null, results: bulk }
          : { count: 201, next: null, previous: "http://api.test/assessments/admin/sets/?limit=200", results: [last] },
      ),
    );

    await mount(<TeacherAssessments />);

    expect(adminListSets).toHaveBeenCalledTimes(2);
    expect(adminListSets.mock.calls[1][0]).toMatchObject({ limit: 200, offset: 200 });
    expect(text()).toContain("201 assessments");

    await type('input[aria-label="Search assessments"]', "rational exponents");
    expect(text()).toContain("Rational exponents");
    expect(text()).not.toContain("No assessment matches");
    // The 201 sets are the claim — the view pins max_limit = 200, so anything smaller could not
    // tell page-walking from a single clamped request. Rendering them twice (on mount, and again
    // after the search) makes this test 8-50x the cost of every sibling in the file: ~0.9s alone,
    // but past the 5s default once 125 files contend for the CPU, which turned the whole suite
    // red. Its own limit, rather than a smaller fixture that would stop proving anything.
  }, 30_000);

  it("says so when it stops before the end of the list", async () => {
    // A server that never stops offering a next page. The walk has its own ceiling, and when it
    // hits one the page has to admit the search below it is running over a partial list.
    adminListSets.mockImplementation((params?: { offset?: number }) => {
      const offset = params?.offset ?? 0;
      return Promise.resolve({
        count: 9999,
        next: `http://api.test/assessments/admin/sets/?limit=200&offset=${offset + 200}`,
        previous: null,
        results: [{
          id: 5000 + offset, title: `Set at offset ${offset}`, subject: "math", level: "junior",
          category: "Algebra", description: "", is_active: true, questions: [question(1)],
        }],
      });
    });

    await mount(<TeacherAssessments />);

    expect(adminListSets).toHaveBeenCalledTimes(20);
    expect(text()).toContain("Showing the first 20 of 9999");
    // Still a list, not a failure: what came back is real, there is simply more of it.
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("table")).not.toBeNull();
  });
});
