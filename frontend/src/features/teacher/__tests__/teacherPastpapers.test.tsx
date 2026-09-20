/**
 * Past papers on the teacher host.
 *
 * The library's three states are the point of these tests, and the middle one is the trap this
 * product keeps falling into: a request that FAILED must say so and offer the retry, and a
 * teacher whose subject genuinely has no papers must be told that in words. Neither may ever
 * render as the other, and neither may ever render as a blank page.
 *
 * Then the paper itself: a teacher opens it and reads the question — its text and its options,
 * drawn by the same components the student runner draws them with.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const getPastpaperSections = vi.fn();
const getPastpaperSection = vi.fn();
const getQuestions = vi.fn();

vi.mock("@/lib/api", () => ({
  classesApi: {},
  examsPublicApi: {
    getPastpaperSections: () => getPastpaperSections(),
    getPastpaperSection: (id: number) => getPastpaperSection(id),
  },
  examsAdminApi: {
    getQuestions: (testId: number, moduleId: number) => getQuestions(testId, moduleId),
  },
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

const { TeacherPastpapers } = await import("../pastpapers/TeacherPastpapers");
const { TeacherPaper } = await import("../pastpapers/TeacherPaper");

const SECTIONS = [
  {
    id: 41, title: "", practice_date: "2025-10-04", subject: "READING_WRITING", label: "A",
    form_type: "INTERNATIONAL", collection_name: "October 2025 Int. A", is_published: true,
    modules: [{ id: 411, module_order: 1 }, { id: 412, module_order: 2 }],
  },
  {
    id: 42, title: "", practice_date: "2025-10-04", subject: "MATH", label: "A",
    form_type: "US", collection_name: "October 2025 US A", is_published: true,
    modules: [{ id: 421, module_order: 1 }],
  },
];

const QUESTIONS_M1 = [
  {
    id: 9001, order: 1,
    question_text: "Scientists tracked the colony for a decade.",
    question_prompt: "Which choice best states the purpose of the passage?",
    question_type: "READING", is_math_input: false,
    option_a: "To record a steady rise", option_b: "To dispute an old estimate",
    option_c: "To describe a method", option_d: "To praise a researcher",
    correct_answer: "B", explanation: "The passage sets up a disagreement.", score: 1,
  },
  {
    id: 9002, order: 2,
    question_text: "The colony doubled every three years.",
    question_prompt: "", question_type: "MATH", is_math_input: true,
    option_a: "", option_b: "", option_c: "", option_d: "",
    correct_answer: "8", explanation: "", score: 1,
  },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  getPastpaperSections.mockReset();
  getPastpaperSection.mockReset();
  getQuestions.mockReset();
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

describe("the past-paper library — while it is loading", () => {
  it("shows neither an answer nor a failure, only the placeholder", async () => {
    // A promise that never settles: the pending state, held still.
    getPastpaperSections.mockReturnValue(new Promise(() => {}));
    await mount(<TeacherPastpapers />, false);

    expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(text()).not.toContain("No past papers in your subject yet");
    // The skeleton's own shape — six 40px bars. A bare `[aria-hidden="true"]` would be
    // satisfied by any decorative icon on the page and prove nothing about this state.
    const bars = [...host.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].filter(
      (d) => d.style.height === "40px",
    );
    expect(bars).toHaveLength(6);
  });
});

describe("the past-paper library — when the request fails", () => {
  it("says the request failed, and offers the retry", async () => {
    getPastpaperSections.mockRejectedValue(new Error("network"));
    await mount(<TeacherPastpapers />);

    expect(text()).toContain("The past papers didn't load");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain("Try again");
    // The whole point: a failure is never dressed up as an empty shelf.
    expect(text()).not.toContain("No past papers in your subject yet");
  });

  it("asks again when the retry is pressed", async () => {
    getPastpaperSections.mockRejectedValue(new Error("network"));
    await mount(<TeacherPastpapers />);
    const before = getPastpaperSections.mock.calls.length;

    const retry = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Try again"));
    expect(retry).toBeTruthy();
    await act(async () => { retry!.click(); });
    await flush();

    expect(getPastpaperSections.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("the past-paper library — when there is nothing to show", () => {
  it("gives the reason, not a blank page", async () => {
    getPastpaperSections.mockResolvedValue([]);
    await mount(<TeacherPastpapers />);

    expect(text()).toContain("No past papers in your subject yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector("table")).toBeNull();
  });
});

describe("the past-paper library — when papers come back", () => {
  it("lists them with the sitting, the region and the subject", async () => {
    getPastpaperSections.mockResolvedValue(SECTIONS);
    await mount(<TeacherPastpapers />);

    expect(text()).toContain("International Form A");
    expect(text()).toContain("US Form A");
    expect(text()).toContain("October 2025");
    expect(text()).toContain("Reading & Writing");
    expect(text()).toContain("Mathematics");
    expect(text()).not.toContain("No past papers in your subject yet");
  });

  it("opens the paper from its row", async () => {
    getPastpaperSections.mockResolvedValue(SECTIONS);
    await mount(<TeacherPastpapers />);

    const row = [...host.querySelectorAll("tbody tr")][0];
    await act(async () => { (row as HTMLElement).click(); });
    expect(push).toHaveBeenCalledWith("/teacher/pastpapers/41");
  });

  it("names each paper with a real link, so a keyboard reaches it", async () => {
    getPastpaperSections.mockResolvedValue(SECTIONS);
    await mount(<TeacherPastpapers />);

    // A row click is a convenience for a mouse. The link is the way in: it takes focus in
    // tab order, a screen reader announces it, the destination shows on hover, and it opens
    // in a second tab. A bare <tr> onClick offered none of that.
    const hrefs = [...host.querySelectorAll("tbody a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/teacher/pastpapers/41");
    expect(hrefs).toContain("/teacher/pastpapers/42");
  });

  it("does not print a paper's own name twice when it has no title of its own", async () => {
    // Both fixtures carry title: "", so paperTitle() falls back to the variant — the second
    // line must then not repeat it. "International Form A" over "International Form A" was
    // what every untitled import rendered.
    getPastpaperSections.mockResolvedValue(SECTIONS);
    await mount(<TeacherPastpapers />);

    const firstCell = host.querySelector("tbody tr td");
    const shown = (firstCell?.textContent ?? "").split("International Form A").length - 1;
    expect(shown).toBe(1);
  });
});

describe("a past paper, opened", () => {
  it("renders the question's text and its options", async () => {
    getPastpaperSection.mockResolvedValue(SECTIONS[0]);
    getQuestions.mockImplementation((_testId: number, moduleId: number) =>
      Promise.resolve(moduleId === 411 ? QUESTIONS_M1 : []),
    );
    await mount(<TeacherPaper paperId={41} />);

    expect(text()).toContain("Scientists tracked the colony for a decade.");
    expect(text()).toContain("Which choice best states the purpose of the passage?");
    expect(text()).toContain("To record a steady rise");
    expect(text()).toContain("To dispute an old estimate");
    expect(text()).toContain("To describe a method");
    expect(text()).toContain("To praise a researcher");
    expect(text()).toContain("Module 1 · Question 1 of 2");
  });

  it("keeps the answer key to itself — Check is a later slice", async () => {
    getPastpaperSection.mockResolvedValue(SECTIONS[0]);
    getQuestions.mockImplementation((_testId: number, moduleId: number) =>
      Promise.resolve(moduleId === 411 ? QUESTIONS_M1 : []),
    );
    await mount(<TeacherPaper paperId={41} />);

    expect(text()).not.toContain("The passage sets up a disagreement.");
    // And the seam that would reveal it is genuinely not built yet. (The old assertion here
    // looked for the string "Correct answer", which nothing in this slice renders in any
    // state — green by construction, whatever the component did.)
    const labels = [...host.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(labels).not.toContain("Check");
  });

  it("says a paper with no questions is empty, and does not call it a failure", async () => {
    getPastpaperSection.mockResolvedValue(SECTIONS[1]);
    getQuestions.mockResolvedValue([]);
    await mount(<TeacherPaper paperId={42} />);

    expect(text()).toContain("This paper has no questions yet");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("says so when the paper does not load", async () => {
    getPastpaperSection.mockRejectedValue(new Error("network"));
    await mount(<TeacherPaper paperId={41} />);

    expect(text()).toContain("This paper didn't load");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).not.toContain("This paper has no questions yet");
  });

  it("says a link that is not a paper's is not a paper's, instead of loading for ever", async () => {
    // /teacher/pastpapers/abc — Number("abc") is NaN, which disables the query, and a
    // disabled react-query v5 query reports status "pending". The page drew the skeleton and
    // never stopped: a dead end painted as work still in progress.
    await mount(<TeacherPaper paperId={Number("abc")} />, false);
    await flush();

    expect(text()).toContain("This link doesn't point at a paper");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(getPastpaperSection).not.toHaveBeenCalled();
    // Not the skeleton, and not the empty state either — nothing here is missing.
    expect(text()).not.toContain("This paper has no questions yet");
  });
});
