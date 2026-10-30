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

import { DashboardQuestionOfTheDay, formatAnswer } from "../DashboardQuestionOfTheDay";

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

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

function button(match: (b: HTMLButtonElement) => boolean): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll("button")).find(match);
  if (!found) throw new Error("button not found");
  return found as HTMLButtonElement;
}

describe("DashboardQuestionOfTheDay", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  async function mount() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <DashboardQuestionOfTheDay />
        </QueryClientProvider>,
      );
    });
    await flush();
  }

  it("renders nothing when there is nothing to answer", async () => {
    get.mockResolvedValue(today([]));
    await mount();
    expect(get).toHaveBeenCalledWith("/daily-questions/today/");
    expect(host.textContent).toBe("");
  });

  it("renders nothing while the flag is off", async () => {
    get.mockResolvedValue(today([card()], { enabled: false }));
    await mount();
    expect(host.textContent).toBe("");
  });

  it("says so when it fails to load instead of looking empty", async () => {
    get.mockRejectedValue(new Error("network"));
    await mount();
    expect(host.textContent).toContain("didn't load");
    expect(host.textContent).toContain("Try again");
  });

  it("takes one answer and shows the verdict, the key and the explanation", async () => {
    get.mockResolvedValue(today([card()]));
    post.mockResolvedValue({
      data: card({
        status: "answered",
        result: { answer: "B", is_correct: false, correct_answer: "A", explanation: "Because alpha.", earned: { points: 0, xp: 0 } },
      }),
    });
    await mount();
    expect(host.textContent).toContain("Question of the Day");
    expect(host.textContent).toContain("Math · Senior");
    expect(host.textContent).not.toContain("Because alpha.");

    const check = button((b) => (b.textContent ?? "").includes("Check my answer"));
    expect(check.disabled).toBe(true);
    await act(async () => button((b) => b.getAttribute("aria-pressed") !== null && (b.textContent ?? "").includes("beta")).click());
    expect(check.disabled).toBe(false);
    await act(async () => check.click());
    await flush();

    expect(post).toHaveBeenCalledWith("/daily-questions/9/answer/", { answer: "B" });
    expect(host.textContent).toContain("The correct answer is A");
    expect(host.textContent).toContain("Because alpha.");
    expect(host.textContent).toContain("a new question comes tomorrow");
    expect(host.textContent).not.toContain("Check my answer");
  });

  it("shows what a right answer earned", async () => {
    get.mockResolvedValue(today([card({
      status: "answered",
      result: { answer: "A", is_correct: true, correct_answer: "A", explanation: "", earned: { points: 2, xp: 2 } },
    })]));
    await mount();
    expect(host.textContent).toContain("Correct! +2 XP · +2 points");
  });

  it("lists two subjects side by side", async () => {
    get.mockResolvedValue(today([card({ id: 1, subject: "english", level: "junior" }), card({ id: 2 })]));
    await mount();
    expect(host.textContent).toContain("English · Junior");
    expect(host.textContent).toContain("Math · Senior");
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
