import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  default: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

// The real calculator loads the Desmos script; here it only has to say it is open.
vi.mock("@/features/testing-simulation/tools/calculator/DesmosCalculator", () => ({
  DesmosCalculator: () => <div data-testid="desmos">desmos</div>,
}));

import { QuestionOfTheDayPrompt } from "../QuestionOfTheDayPrompt";
import { QuestionOfTheDayRunner } from "../QuestionOfTheDayRunner";
import { formatAnswer } from "../dailyQuestionsFormat";
import { msUntilTashkentMidnight } from "../dailyQuestionsHooks";

const question = {
  id: 501,
  prompt: "Which is right?",
  question_prompt: "",
  question_type: "multiple_choice",
  choices: [
    { id: "A", text: "alpha" },
    { id: "B", text: "beta" },
  ],
  question_image: null,
  option_a_image: null,
  option_b_image: null,
  option_c_image: null,
  option_d_image: null,
};

function card(overrides: Record<string, unknown> = {}) {
  return { id: 9, date: "2026-11-02", subject: "math", level: "senior", status: "open", question, result: null, ...overrides };
}

function today(questions: unknown[], extra: Record<string, unknown> = {}) {
  return { data: { date: "2026-11-02", enabled: true, reward: { points: 2, xp: 2 }, questions, ...extra } };
}

const wrongResult = { answer: "B", is_correct: false, correct_answer: "A", explanation: "Because alpha.", earned: { points: 0, xp: 0 } };

/** React Query hands results over on a timer (its notifyManager batches with setTimeout), so
 *  draining microtasks alone is not enough — let a few macrotasks run too. */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function button(match: (b: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(match);
  if (!found) throw new Error("button not found");
  return found as HTMLButtonElement;
}

const byText = (text: string) => (b: HTMLButtonElement) => (b.textContent ?? "").trim() === text;
const choice = (text: string) => (b: HTMLButtonElement) =>
  b.getAttribute("aria-pressed") !== null && (b.textContent ?? "").includes(text);

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  push.mockReset();
  searchParams = new URLSearchParams();
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

async function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
  await flush();
}

describe("QuestionOfTheDayPrompt", () => {
  it("asks about an open question and opens the runner on Solve", async () => {
    get.mockResolvedValue(today([card()]));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(get).toHaveBeenCalledWith("/daily-questions/today/");
    expect(host.textContent).toContain("Your Math · Senior question is waiting");
    expect(host.textContent).toContain("+2 XP · +2 points");
    await act(async () => button(byText("Solve now")).click());
    expect(push).toHaveBeenCalledWith("/question-of-the-day?subject=math");
  });

  it("offers each open subject when there are two", async () => {
    get.mockResolvedValue(today([card({ id: 1, subject: "english", level: "middle" }), card({ id: 2 })]));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    await act(async () => button(byText("Solve English · Middle")).click());
    expect(push).toHaveBeenCalledWith("/question-of-the-day?subject=english");
    expect(button(byText("Solve Math · Senior"))).toBeTruthy();
  });

  it("has no close button: it stays until Solve or Not today", async () => {
    get.mockResolvedValue(today([card()]));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    const labels = Array.from(host.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());
    expect(labels).toEqual(["Solve now", "Not today"]);
  });

  it("Not today hides it for that date only, for that student", async () => {
    get.mockResolvedValue(today([card()]));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    await act(async () => button(byText("Not today")).click());
    expect(host.textContent).toBe("");
    expect(window.localStorage.getItem("mastersat.qotd-skipped.7")).toBe("2026-11-02");

    // Same day, page reload: still hidden.
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toBe("");

    // The next day's questions bring it back.
    get.mockResolvedValue({ data: { ...today([card()]).data, date: "2026-11-03" } });
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toContain("Question of the Day");
  });

  it("is gone once everything is answered, while the flag is off, or with nothing dealt", async () => {
    get.mockResolvedValue(today([card({ status: "answered", result: wrongResult })]));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toBe("");

    get.mockResolvedValue(today([card()], { enabled: false }));
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toBe("");

    get.mockResolvedValue(today([]));
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toBe("");
  });

  it("says nothing when the fetch fails", async () => {
    get.mockRejectedValue(new Error("network"));
    await mount(<QuestionOfTheDayPrompt userId={7} />);
    expect(host.textContent).toBe("");
  });
});

describe("QuestionOfTheDayRunner", () => {
  it("takes one answer, then shows the key on the choices and the explanation", async () => {
    get.mockResolvedValue(today([card()]));
    post.mockResolvedValue({ data: card({ status: "answered", result: wrongResult }) });
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).toContain("Which is right?");
    expect(host.textContent).not.toContain("Because alpha.");

    const check = button(byText("Check"));
    expect(check.disabled).toBe(true);
    await act(async () => button(choice("beta")).click());
    expect(check.disabled).toBe(false);
    await act(async () => check.click());
    await flush();

    expect(post).toHaveBeenCalledWith("/daily-questions/9/answer/", { answer: "B" });
    const states = Array.from(host.querySelectorAll("[data-state]")).map((el) => el.getAttribute("data-state"));
    expect(states).toEqual(["correct", "incorrect"]);
    expect(host.querySelector("[data-verdict]")?.getAttribute("data-verdict")).toBe("incorrect");
    expect(host.textContent).toContain("Because alpha.");
    expect(host.textContent).not.toContain("Check");
    expect(button(byText("Done for today"))).toBeTruthy();
  });

  it("stays on the question just checked when both are open and no subject was asked for", async () => {
    get.mockResolvedValue(today([card({ id: 1 }), card({ id: 2, subject: "english", level: "junior" })]));
    post.mockResolvedValue({ data: card({ id: 1, status: "answered", result: wrongResult }) });
    await mount(<QuestionOfTheDayRunner />);
    await act(async () => button(choice("beta")).click());
    await act(async () => button(byText("Check")).click());
    await flush();
    expect(post).toHaveBeenCalledWith("/daily-questions/1/answer/", { answer: "B" });
    expect(host.textContent).toContain("Because alpha.");
    expect(button(byText("Next: English question"))).toBeTruthy();
  });

  it("shows what a right answer earned", async () => {
    get.mockResolvedValue(today([card({
      status: "answered",
      result: { answer: "A", is_correct: true, correct_answer: "A", explanation: "", earned: { points: 2, xp: 2 } },
    })]));
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).toContain("Correct! +2 XP · +2 points");
    expect(host.textContent).toContain("Your answer · correct");
  });

  it("opens the subject asked for, switches between them, and keeps each draft", async () => {
    searchParams = new URLSearchParams("subject=english");
    get.mockResolvedValue(today([
      card({ id: 1, subject: "math" }),
      card({ id: 2, subject: "english", level: "junior", question: { ...question, prompt: "English one" } }),
    ]));
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).toContain("English one");

    await act(async () => button(choice("beta")).click());
    await act(async () => button(byText("Math")).click());
    expect(host.textContent).not.toContain("English one");
    expect(button(choice("beta")).getAttribute("aria-pressed")).toBe("false");
    await act(async () => button(byText("English")).click());
    expect(button(choice("beta")).getAttribute("aria-pressed")).toBe("true");
  });

  it("offers Desmos on Math, at any level, and not on English", async () => {
    get.mockResolvedValue(today([card({ level: "junior" })]));
    await mount(<QuestionOfTheDayRunner />);
    await act(async () => button((b) => (b.textContent ?? "").includes("Calculator")).click());
    expect(host.querySelector("[data-testid='desmos']")).not.toBeNull();

    get.mockResolvedValue(today([card({ subject: "english" })]));
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).not.toContain("Calculator");
  });

  it("points to the next open subject after an answer", async () => {
    get.mockResolvedValue(today([
      card({ id: 1, status: "answered", result: wrongResult }),
      card({ id: 2, subject: "english", level: "junior" }),
    ]));
    searchParams = new URLSearchParams("subject=math");
    await mount(<QuestionOfTheDayRunner />);
    await act(async () => button(byText("Next: English question")).click());
    expect(button(byText("Check"))).toBeTruthy();
  });

  it("says so when it fails to load, and when nothing is dealt", async () => {
    get.mockRejectedValue(new Error("network"));
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).toContain("didn't load");
    expect(button(byText("Try again"))).toBeTruthy();

    get.mockResolvedValue(today([]));
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(<QuestionOfTheDayRunner />);
    expect(host.textContent).toContain("no Question of the Day for you today");
    await act(async () => button(byText("Back to home")).click());
    expect(push).toHaveBeenCalledWith("/");
  });
});

describe("formatAnswer", () => {
  it("reads like an answer key", () => {
    expect(formatAnswer("B")).toBe("B");
    expect(formatAnswer(["0.5", "1/2"])).toBe("0.5 or 1/2");
    expect(formatAnswer(true)).toBe("True");
    expect(formatAnswer(null)).toBe("");
  });
});

describe("msUntilTashkentMidnight", () => {
  it("counts to midnight in Tashkent (UTC+5), not in UTC or the browser's zone", () => {
    // 23:59:00 Tashkent = 18:59:00 UTC → one minute (plus the 5 s grace) to go.
    expect(msUntilTashkentMidnight(Date.UTC(2026, 10, 2, 18, 59, 0))).toBe(60_000 + 5_000);
    // 00:00:00 Tashkent exactly = 19:00 UTC → a whole day to the next one.
    expect(msUntilTashkentMidnight(Date.UTC(2026, 10, 2, 19, 0, 0))).toBe(24 * 3600_000 + 5_000);
    // 12:00 UTC = 17:00 Tashkent → seven hours.
    expect(msUntilTashkentMidnight(Date.UTC(2026, 10, 2, 12, 0, 0))).toBe(7 * 3600_000 + 5_000);
  });
});
