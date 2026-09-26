/**
 * The standalone midterm area on the teacher host: /teacher/midterms and one paper's page.
 *
 * Four branches per screen, and the two in the middle are the ones this product keeps getting
 * wrong: a request that FAILED must say so and offer the retry, and a teacher who genuinely has
 * nothing yet must be told that in words. Neither may ever render as the other.
 *
 * This page has a third branch most do not, and it is the reason these tests exist at all: the
 * catalog can answer while EVERY per-midterm access check fails. There are midterms — we simply
 * could not read who holds them. Rendering that as "No published midterms yet" would tell a
 * teacher their grants are gone, and rendering it as a table would print a page of em dashes and
 * call it the truth. It gets its own error, and the partial version of it gets a banner that says
 * the totals above are a floor.
 *
 * Mocked at the transport (`@/lib/api`) rather than at `@/lib/midtermApi`, so the real
 * `fetchStandaloneOverview` really walks the catalog and the real `summarizeStandalone` really
 * does the arithmetic these screens print. Mocking the client module would have left both
 * untested and the fixtures would have had to restate their answers.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("@/lib/api", () => ({
  default: {
    get: (url: string, config?: unknown) => get(url, config),
    post: (url: string, body?: unknown) => post(url, body),
    delete: (url: string, config?: unknown) => del(url, config),
    patch: vi.fn(),
  },
  classesApi: {},
  examsPublicApi: {},
  examsAdminApi: {},
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { StandaloneMidtermsList } = await import("../../midterm/standalone/MidtermsList");
const { StandaloneMidtermDetail } = await import("../../midterm/standalone/MidtermDetail");

/* ── fixtures. Invented names and scores; this repository is public. ──────── */

const PAPER_A = {
  id: 11, title: "Unit 3 Midterm", subject: "MATH", level: "junior",
  scoring_scale: "SCALE_100", score_ceiling: 100,
  duration_minutes: 70, question_count: 44, is_published: true,
};
const PAPER_B = {
  id: 12, title: "Reading Checkpoint 2", subject: "READING_WRITING", level: "",
  scoring_scale: "SCALE_100", score_ceiling: 100,
  duration_minutes: 64, question_count: 54, is_published: true,
};

function student(over: Record<string, unknown> = {}) {
  return {
    student_id: 501, student_name: "Dilnoza Rashidova", student_profile_image_url: null,
    instructor_id: 9, instructor_name: "Teacher One", instructor_profile_image_url: null,
    state: "COMPLETED", submitted: true, score: 82, score_ceiling: 100, scoring_scale: "SCALE_100",
    sittings: 1, resit_open: false,
    ...over,
  };
}

const CATALOG = { data: { results: [PAPER_A, PAPER_B] } };

/** `GET` answers by URL, so one mock serves the catalog, both result calls and the picker. */
function routes(map: Record<string, unknown | (() => unknown)>) {
  get.mockImplementation((url: string) => {
    for (const [fragment, answer] of Object.entries(map)) {
      if (url.includes(fragment)) {
        const value = typeof answer === "function" ? (answer as () => unknown)() : answer;
        return value instanceof Promise ? value : Promise.resolve(value);
      }
    }
    // Everything unclaimed — the student picker's own list, above all — answers empty rather
    // than rejecting, so an unrelated 500 can never be what a test is actually measuring.
    return Promise.resolve({ data: { results: [] } });
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  get.mockReset();
  post.mockReset();
  del.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  // The revoke dialog portals onto <body>; without this it outlives its own test.
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mount(node: ReactNode, settle = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  if (settle) {
    await flush();
    await flush();
    await flush();
  }
}

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

/** Same, for a native <select>: React reads `change`, not `input`. */
async function choose(selector: string, value: string) {
  const el = host.querySelector(selector) as HTMLSelectElement | null;
  if (!el) throw new Error(`No field ${selector}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

const text = () => host.textContent ?? "";
/** The dialog lives in a portal, so what the teacher can read is the whole document. */
const pageText = () => document.body.textContent ?? "";
const alerts = () => host.querySelectorAll('[role="alert"]').length;
const buttonWith = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));

/* ── /teacher/midterms ───────────────────────────────────────────────────── */

describe("the midterm list — while it is loading", () => {
  it("shows neither an answer nor a failure, only the placeholder", async () => {
    routes({ "/midterms/teacher/midterms/": new Promise(() => {}) });
    await mount(<StandaloneMidtermsList />, false);

    expect(host.querySelector("table")).toBeNull();
    expect(alerts()).toBe(0);
    expect(text()).not.toContain("No published midterms yet");
    const bars = [...host.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].filter(
      (d) => d.style.height === "40px",
    );
    expect(bars).toHaveLength(6);
  });
});

describe("the midterm list — when the request fails", () => {
  it("says the request failed, and never that there are no midterms", async () => {
    routes({ "/midterms/teacher/midterms/": () => Promise.reject(new Error("network")) });
    await mount(<StandaloneMidtermsList />);

    expect(text()).toContain("We couldn't load your midterms");
    expect(alerts()).toBe(1);
    expect(text()).not.toContain("No published midterms yet");
    expect(host.querySelector("table")).toBeNull();
  });

  it("asks again when the retry is pressed", async () => {
    routes({ "/midterms/teacher/midterms/": () => Promise.reject(new Error("network")) });
    await mount(<StandaloneMidtermsList />);
    const before = get.mock.calls.length;

    await act(async () => {
      buttonWith("Try again")!.click();
    });
    await flush();

    expect(get.mock.calls.length).toBeGreaterThan(before);
  });

  it("says so when the catalog answers but no access list does", async () => {
    // The branch a restyle is most likely to drop, because on the surface it looks like a
    // page with data. There ARE midterms; what failed is every question about who holds them.
    routes({
      "/results/": () => Promise.reject(new Error("boom")),
      "/midterms/teacher/midterms/": CATALOG,
    });
    await mount(<StandaloneMidtermsList />);

    expect(text()).toContain("We couldn't check any of your midterms");
    expect(alerts()).toBe(1);
    expect(text()).not.toContain("No published midterms yet");
    expect(text()).not.toContain("You haven't given a midterm to anyone yet");
  });
});

describe("the midterm list — when there is nothing to show", () => {
  it("gives the reason, not a blank page and not an error", async () => {
    routes({ "/midterms/teacher/midterms/": { data: { results: [] } } });
    await mount(<StandaloneMidtermsList />);

    expect(text()).toContain("No published midterms yet");
    expect(alerts()).toBe(0);
    expect(host.querySelector("table")).toBeNull();
  });

  it("separates a paper nobody has from one it could not check", async () => {
    // Two answers that must never collapse into one chip: PAPER_A is genuinely not given
    // out, PAPER_B's check failed. "Not given out" for the second would be a lie.
    routes({
      "/midterms/11/results/": { data: { midterm: PAPER_A, students: [] } },
      "/midterms/12/results/": () => Promise.reject(new Error("boom")),
      "/midterms/teacher/midterms/": CATALOG,
    });
    await mount(<StandaloneMidtermsList />);

    expect(text()).toContain("You haven't given a midterm to anyone yet");
    // And the roll-up admits the shortfall rather than printing a confident smaller number.
    expect(text()).toContain("1 of 2 midterms could not be checked");
    expect(buttonWith("Check again")).toBeTruthy();
  });
});

describe("the midterm list — when midterms come back", () => {
  beforeEach(() => {
    routes({
      "/midterms/11/results/": {
        data: {
          midterm: PAPER_A,
          students: [student(), student({ student_id: 502, student_name: "Bekzod Umarov", submitted: false, state: "NOT_STARTED", score: null })],
        },
      },
      "/midterms/12/results/": { data: { midterm: PAPER_B, students: [] } },
      "/midterms/teacher/midterms/": CATALOG,
    });
  });

  it("lists what has been given out, with the figures that came back", async () => {
    await mount(<StandaloneMidtermsList />);

    expect(text()).toContain("Unit 3 Midterm");
    expect(text()).toContain("Mathematics");
    // One of the two students has finished, so: 2 with access, 1 still to sit, 1 result in.
    expect(text()).toContain("Students with access");
    expect(text()).toContain("82 / 100");
    expect(alerts()).toBe(0);
    expect(text()).not.toContain("No published midterms yet");
    // The paper nobody has is NOT in this table — it is one tab across.
    expect(host.querySelector("tbody")!.textContent).not.toContain("Reading Checkpoint 2");
  });

  it("opens a midterm from its name, so a keyboard reaches it", async () => {
    await mount(<StandaloneMidtermsList />);

    const hrefs = [...host.querySelectorAll("tbody a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/teacher/midterms/11");
  });

  it("narrows the table by title, and says so when nothing matches", async () => {
    await mount(<StandaloneMidtermsList />);
    await type('input[aria-label="Search midterms you have given out"]', "nothing like this");

    expect(text()).toContain("No midterm matches that search");
    // A search with no hits is an empty result, never a failure.
    expect(alerts()).toBe(0);
    expect(host.querySelector("table")).toBeNull();
  });

  it("shows the whole catalog on the other tab, including the paper nobody has", async () => {
    await mount(<StandaloneMidtermsList />);

    await act(async () => {
      buttonWith("All midterms")!.click();
    });

    expect(text()).toContain("Reading Checkpoint 2");
    expect(text()).toContain("Not given out");
    expect(text()).toContain("Given to 2");
  });
});

/* ── /teacher/midterms/[midtermId] ───────────────────────────────────────── */

describe("one midterm — when it fails to load", () => {
  it("says the request failed, and never that nobody has it", async () => {
    routes({ "/results/": () => Promise.reject(new Error("network")) });
    await mount(<StandaloneMidtermDetail midtermId={11} />);

    expect(text()).toContain("We couldn't load this midterm");
    expect(alerts()).toBe(1);
    expect(text()).not.toContain("Nobody has this midterm yet");
  });
});

describe("one midterm — when nobody has it", () => {
  it("says so, and offers the way to give it out", async () => {
    routes({ "/results/": { data: { midterm: PAPER_A, students: [] } } });
    await mount(<StandaloneMidtermDetail midtermId={11} />);

    expect(text()).toContain("Nobody has this midterm yet");
    expect(alerts()).toBe(0);
    expect(host.querySelector("table")).toBeNull();
  });
});

describe("one midterm — when its students come back", () => {
  beforeEach(() => {
    routes({
      "/results/": {
        data: {
          midterm: PAPER_A,
          students: [
            student(),
            student({ student_id: 502, student_name: "Bekzod Umarov", state: "NOT_STARTED", submitted: false, score: null, sittings: 0 }),
          ],
        },
      },
    });
  });

  it("lists everyone with access, and what each has got to", async () => {
    await mount(<StandaloneMidtermDetail midtermId={11} />);

    expect(text()).toContain("Dilnoza Rashidova");
    expect(text()).toContain("Bekzod Umarov");
    expect(text()).toContain("82 / 100");
    expect(text()).toContain("Not started");
    expect(alerts()).toBe(0);
    expect(text()).not.toContain("Nobody has this midterm yet");
  });

  it("filters the list by where each student has got to", async () => {
    await mount(<StandaloneMidtermDetail midtermId={11} />);
    await choose('select[aria-label="Filter by status"]', "not_started");

    const body = host.querySelector("tbody")!.textContent ?? "";
    expect(body).toContain("Bekzod Umarov");
    expect(body).not.toContain("Dilnoza Rashidova");
  });

  it("offers a re-sit only to a student who has already handed it in", async () => {
    await mount(<StandaloneMidtermDetail midtermId={11} />);

    const rows = [...host.querySelectorAll("tbody tr")];
    const finished = rows.find((r) => (r.textContent ?? "").includes("Dilnoza Rashidova"))!;
    const notStarted = rows.find((r) => (r.textContent ?? "").includes("Bekzod Umarov"))!;

    expect(finished.textContent).toContain("Allow re-sit");
    expect(notStarted.textContent).not.toContain("Allow re-sit");
  });

  it("asks before removing access, and says what that student stands to lose", async () => {
    await mount(<StandaloneMidtermDetail midtermId={11} />);

    const finished = [...host.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes("Dilnoza Rashidova"),
    )!;
    const remove = [...finished.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Remove"),
    )!;
    await act(async () => {
      remove.click();
    });

    // The dialog is portalled out of `host`, so it is the document that has to be read.
    expect(pageText()).toContain("Remove access to this midterm?");
    expect(pageText()).toContain("Dilnoza Rashidova");
    // She has sat it: the copy must say the score and certificate survive, which is the whole
    // reason this dialog reads the row rather than printing one general sentence.
    expect(pageText()).toContain("their score and certificate stay exactly as they are");
    // Opening the question must not have answered it.
    expect(post).not.toHaveBeenCalled();
  });
});
