/**
 * /ops/surveys in the console's look: the guard for a non-super-admin, the list and Create with the same payload,
 * the editor's Publish and settings patches, adding a question with the same body, the delete dialog (refused
 * once anyone replied, the server's words shown inside it), and the replies panel with its empty state.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = {
  adminList: vi.fn(),
  adminDetail: vi.fn(),
  adminCreate: vi.fn(),
  adminUpdate: vi.fn(),
  adminDelete: vi.fn(),
  addQuestion: vi.fn(),
  updateQuestion: vi.fn(),
  deleteQuestion: vi.fn(),
  reorderQuestions: vi.fn(),
  duplicate: vi.fn(),
  participation: vi.fn(),
  results: vi.fn(),
  downloadResults: vi.fn(),
};
let me: Record<string, unknown> = { role: "super_admin" };

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => ({ me }) }));
vi.mock("@/features/surveys/surveysApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/surveys/surveysApi")>()),
  surveysApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));

const { SurveyBuilderPage } = await import("../SurveyBuilderPage");
const { levelLabel } = await import("@/lib/levels");

function question(id: number, over: Record<string, unknown> = {}) {
  return {
    id, order: id, prompt: `Question ${id}`, help_text: "", question_type: "SHORT_TEXT", is_required: false,
    options: [], max_selections: 0, scale_min: 1, scale_max: 5, image_url: null, scale_low_label: "", scale_high_label: "",
    follow_up_threshold: null, follow_up_placeholder: "", follow_up_required: false, follow_up_options: [],
    condition_question: null, condition_operator: "", condition_value: null,
    ...over,
  };
}

function survey(id: number, over: Record<string, unknown> = {}) {
  return {
    id, title: `Survey ${id}`, description: "", status: "DRAFT", opens_at: null, closes_at: null, allow_anonymous: false,
    audience_kind: "ALL", audience_level: "", audience_classrooms: [], audience_branch: null, points_award: 10,
    image_url: null, created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z",
    questions: [], question_count: 0, response_count: 0, is_open: true,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <SurveyBuilderPage />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words);
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const text = () => document.body.textContent ?? "";

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  me = { role: "super_admin" };
  api.adminList.mockResolvedValue([survey(1, { title: "Autumn feedback", question_count: 2, response_count: 3 }), survey(2, { status: "PUBLISHED", is_open: false })]);
  api.adminDetail.mockImplementation(async (id: number) =>
    id === 1 ? survey(1, { title: "Autumn feedback", questions: [question(11), question(12, { is_required: true })], question_count: 2, response_count: 0 }) : survey(id),
  );
  api.participation.mockResolvedValue({ expected: null, replied: 0, rate: null, outstanding: [], outstanding_total: 0 });
  api.results.mockResolvedValue({ summaries: [], responses: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the survey builder", () => {
  it("tells anyone but a super admin who manages surveys", async () => {
    me = { role: "admin" };
    await render();
    expect(host.textContent).toContain("Surveys are managed by a super admin.");
    expect(host.textContent).toContain("Ask a super admin to create or publish a survey.");
    expect(host.querySelector("#new-survey-title")).toBeNull();
  });

  it("shows the header, the list with each survey's state and counts, and the empty pane", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("Surveys");
    expect(host.textContent).toContain("Admin console · Super admin");
    const first = host.querySelector('[data-survey="1"]')!;
    expect(first.textContent).toContain("Autumn feedback");
    expect(first.textContent).toContain("Draft");
    expect(first.textContent).toContain("2 q · 3 replies");
    // Published but past its closing date reads as closed.
    expect(host.querySelector('[data-survey="2"]')!.textContent).toContain("Closed by date");
    expect(host.textContent).toContain("Pick a survey to start");
  });

  it("says so when there are no surveys, and when the list fails", async () => {
    api.adminList.mockResolvedValue([]);
    await render();
    expect(host.textContent).toContain("No surveys yet");
    expect(host.textContent).toContain("Create one above and it will show up here.");

    act(() => root.unmount());
    root = createRoot(host);
    api.adminList.mockRejectedValue(new Error("boom"));
    await render();
    expect(host.textContent).toContain("Couldn’t load surveys");
    expect(buttonIn(host, "Retry")).toBeDefined();
  });

  it("creates a survey with the title only, then opens it", async () => {
    api.adminCreate.mockResolvedValue(survey(1, { title: "Autumn feedback" }));
    await render();
    const create = buttonIn(host, "Create")!;
    expect(create.disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("#new-survey-title")!, "  Autumn feedback  ");
    expect(buttonIn(host, "Create")!.disabled).toBe(false);
    await click(buttonIn(host, "Create")!);
    expect(api.adminCreate).toHaveBeenCalledWith({ title: "Autumn feedback" });
    expect(host.querySelector<HTMLInputElement>("#new-survey-title")!.value).toBe("");
    expect(host.textContent).toContain("Question 11");
  });

  it("shows the server's words when a create is refused", async () => {
    api.adminCreate.mockRejectedValue({ response: { data: { title: ["Ensure this field has no more than 200 characters."] } } });
    await render();
    await type(host.querySelector<HTMLInputElement>("#new-survey-title")!, "Long");
    await click(buttonIn(host, "Create")!);
    expect(host.textContent).toContain("title: Ensure this field has no more than 200 characters.");
  });

  it("opens a survey: its questions in order, Publish sends the status patch", async () => {
    api.adminUpdate.mockResolvedValue(survey(1, { status: "PUBLISHED" }));
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    expect(host.querySelector("h2")!.textContent).toBe("Autumn feedback");
    expect(host.textContent).toContain("2 questions · 0 replies");
    expect(host.querySelector('[data-question="11"]')!.textContent).toContain("1.Question 11");
    expect(host.querySelector('[data-question="12"]')!.textContent).toContain("2.Question 12*");
    await click(buttonIn(host, "Publish")!);
    expect(api.adminUpdate).toHaveBeenCalledWith(1, { status: "PUBLISHED" }, undefined);
  });

  it("keeps Publish off until the survey has a question", async () => {
    api.adminDetail.mockResolvedValue(survey(3));
    api.adminList.mockResolvedValue([survey(3)]);
    await render();
    await click(host.querySelector('[data-survey="3"]')!);
    expect(buttonIn(host, "Publish")!.disabled).toBe(true);
    expect(host.textContent).toContain("No questions yet");
  });

  it("saves the audience with the narrowing cleared, and warns when it reaches nobody", async () => {
    api.adminUpdate.mockResolvedValue(survey(1));
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await choose(host.querySelector<HTMLSelectElement>("#survey-audience")!, "LEVEL");
    expect(api.adminUpdate).toHaveBeenCalledWith(
      1,
      { audience_kind: "LEVEL", audience_level: "", audience_classrooms: [], audience_branch: null },
      undefined,
    );

    api.adminDetail.mockResolvedValue(survey(1, { audience_kind: "LEVEL" }));
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    expect(host.textContent).toContain("This survey currently reaches nobody");
    expect(host.querySelector("#survey-level")).not.toBeNull();
  });

  it("adds a question with the same body the API always got", async () => {
    api.addQuestion.mockResolvedValue(question(13));
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(buttonIn(host, "Add a question")!);
    expect(host.textContent).toContain("New question");
    // Nothing to ask yet: the reason shows and the button stays off.
    expect(host.textContent).toContain("The question needs something to ask.");
    expect(buttonIn(host, "Add question")!.disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("#q-new-prompt")!, "  How was it?  ");
    expect(buttonIn(host, "Add question")!.disabled).toBe(false);
    await click(buttonIn(host, "Add question")!);
    expect(api.addQuestion).toHaveBeenCalledTimes(1);
    const [surveyId, body, image] = api.addQuestion.mock.calls[0];
    expect(surveyId).toBe(1);
    expect(image).toBeNull();
    expect(body).toMatchObject({
      prompt: "How was it?",
      question_type: "SHORT_TEXT",
      is_required: false,
      options: [],
      condition_question: null,
      condition_operator: "",
      condition_value: null,
    });
    expect(host.textContent).not.toContain("New question");
  });

  it("asks before deleting a survey, and shows a refusal inside the dialog", async () => {
    api.adminDelete.mockRejectedValue({ response: { data: { detail: "This survey has replies." } } });
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(byLabel("Delete survey"));
    const d = dialog()!;
    expect(d.textContent).toContain("Delete this survey?");
    expect(d.textContent).toContain("“Autumn feedback” and its questions will be permanently deleted. This cannot be undone.");
    await click(buttonIn(d, "Delete survey")!);
    expect(api.adminDelete).toHaveBeenCalledWith(1);
    expect(dialog()!.textContent).toContain("This survey has replies.");
  });

  it("will not delete a survey that has replies", async () => {
    api.adminDetail.mockResolvedValue(survey(1, { title: "Autumn feedback", response_count: 2, questions: [question(11)], question_count: 1 }));
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(byLabel("Delete survey"));
    const d = dialog()!;
    expect(d.textContent).toContain("“Autumn feedback” has 2 replies. A survey with replies cannot be deleted — close it instead, and the answers stay.");
    expect(buttonIn(d, "Delete survey")!.disabled).toBe(true);
  });

  it("opens the replies: the empty state, then the summaries", async () => {
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(buttonIn(host, "Replies")!);
    expect(host.textContent).toContain("Replies — Autumn feedback");
    expect(host.textContent).toContain("No replies yet");
    expect(host.textContent).toContain("0 replies(sent to everyone — no fixed roster to count against)");
    expect(buttonIn(host, "CSV")!.disabled).toBe(true);

    api.results.mockResolvedValue({
      summaries: [
        { question_id: 11, prompt: "How was it?", question_type: "SINGLE_CHOICE", answered: 4, skipped: 1, not_asked: 0, is_conditional: false, comments: [], options: [{ text: "Good", count: 3, percent: 75 }, { text: "Bad", count: 1, percent: 25 }] },
        { question_id: 12, prompt: "Score us", question_type: "SCALE", answered: 4, skipped: 0, not_asked: 0, is_conditional: true, comments: [{ value: 2, text: "Too fast" }], average: 3.5, scale_max: 5, distribution: [{ score: 1, count: 0 }, { score: 2, count: 1 }], threshold: 3, below_threshold: 1 },
      ],
      responses: [{ id: 7, survey: 1, student: 5, student_name: "Ali Valiyev", is_anonymous: false, submitted_at: "2026-11-02T10:00:00Z", classroom: null, classroom_name: null, level: "senior", answers: [{ question: 11, prompt: "How was it?", value: "Good", follow_up: "" }] }],
    });
    act(() => root.unmount());
    root = createRoot(host);
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(buttonIn(host, "Replies")!);
    const first = host.querySelector('[data-summary="11"]')!;
    expect(first.textContent).toContain("4 answered · 1 skipped");
    expect(first.textContent).toContain("Good3(75%)");
    const second = host.querySelector('[data-summary="12"]')!;
    expect(second.textContent).toContain("shown to some");
    expect(second.textContent).toContain("average out of 5");
    expect(second.textContent).toContain("1 below 3");
    expect(second.textContent).toContain("1 wrote more");
    expect(second.textContent).toContain("Too fast");

    await click(Array.from(host.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((b) => b.textContent === "Each reply (1)")!);
    expect(host.querySelector('[data-reply="7"]')!.textContent).toContain("Ali Valiyev");
  });

  it("asks the results again for one level, and offers to clear it when it has none", async () => {
    api.results.mockImplementation(async (_id: number, filters: { level?: string }) =>
      filters.level
        ? { summaries: [], responses: [] }
        : {
            summaries: [],
            responses: [{ id: 7, survey: 1, student: 5, student_name: "Ali Valiyev", is_anonymous: true, submitted_at: null, classroom: null, classroom_name: null, level: "senior", answers: [] }],
          },
    );
    await render();
    await click(host.querySelector('[data-survey="1"]')!);
    await click(buttonIn(host, "Replies")!);
    expect(api.results).toHaveBeenCalledWith(1, { level: undefined });
    await choose(byLabel("Filter by level") as HTMLSelectElement, "junior");
    expect(api.results).toHaveBeenCalledWith(1, { level: "junior" });
    expect(text()).toContain(`No replies from ${levelLabel("junior")}`);
    await click(buttonIn(host, "Clear filter")!);
    expect(text()).toContain("Each reply (1)");
  });
});
