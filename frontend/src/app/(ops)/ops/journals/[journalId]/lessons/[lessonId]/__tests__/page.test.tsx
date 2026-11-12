/**
 * The session editor page in the console's look: the back link and title, the three sides as tabs with their
 * Ready / Todo / Optional verdicts, each tab opening its editor, the midterm session's panel, and the page's own
 * words when it cannot load. The editors themselves are covered in features/journals.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = { get: vi.fn(), lesson: vi.fn() };

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ journalId: "3", lessonId: "12" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/ops/journals/3/lessons/12",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/journals/api", () => ({
  journalsApi: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }),
}));
vi.mock("@/features/journals/JournalLessonEditor", () => ({
  default: ({ journalId, lessonId }: { journalId: number; lessonId: number }) => <div data-editor="homework">{`homework ${journalId}/${lessonId}`}</div>,
}));
vi.mock("@/features/journals/JournalClassworkEditor", () => ({
  default: ({ journalId, lessonId }: { journalId: number; lessonId: number }) => <div data-editor="classwork">{`classwork ${journalId}/${lessonId}`}</div>,
}));
vi.mock("@/features/journals/JournalRoadmapEditor", () => ({
  default: ({ journalId, lessonId }: { journalId: number; lessonId: number }) => <div data-editor="roadmap">{`roadmap ${journalId}/${lessonId}`}</div>,
}));

const { default: Page } = await import("../page");

const JOURNAL = { id: 3, subject: "MATH", subject_label: "Math", level: "junior", level_label: "Junior", display_title: "Math Junior" };
function lesson(over: Record<string, unknown> = {}) {
  return {
    id: 12,
    journal_id: 3,
    lesson_number: 2,
    lesson_type: "HOMEWORK",
    homework_ready: true,
    classwork_ready: false,
    has_roadmap: false,
    midterm: null,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<Page />);
  });
  await settle();
}
async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
const tab = (name: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim().startsWith(name))!;
const editor = () => host.querySelector<HTMLElement>("[data-editor]")?.dataset.editor;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.get.mockResolvedValue(JOURNAL);
  api.lesson.mockResolvedValue(lesson());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the session editor", () => {
  it("shows the title, the back link and the three sides with their verdicts", async () => {
    await render();
    expect(api.get).toHaveBeenCalledWith(3);
    expect(api.lesson).toHaveBeenCalledWith(3, 12);
    expect(host.querySelector("h1")!.textContent).toBe("Session 2· Math Junior");
    const back = host.querySelector<HTMLAnchorElement>('a[href="/ops/journals/3"]')!;
    expect(back.textContent).toContain("Back to Math Junior");
    expect(tab("Homework").textContent).toBe("HomeworkReady");
    expect(tab("Classwork").textContent).toBe("ClassworkTodo");
    expect(tab("Roadmap").textContent).toBe("RoadmapOptional");
    expect(tab("Homework").getAttribute("aria-selected")).toBe("true");
    expect(editor()).toBe("homework");
    expect(host.querySelector('[role="tabpanel"]')!.textContent).toBe("homework 3/12");
  });

  it("opens each side's editor", async () => {
    await render();
    await click(tab("Classwork"));
    expect(editor()).toBe("classwork");
    expect(tab("Classwork").getAttribute("aria-selected")).toBe("true");
    await click(tab("Roadmap"));
    expect(editor()).toBe("roadmap");
    await click(tab("Homework"));
    expect(editor()).toBe("homework");
  });

  it("calls a filled roadmap Ready", async () => {
    api.lesson.mockResolvedValue(lesson({ has_roadmap: true, classwork_ready: true }));
    await render();
    expect(tab("Classwork").textContent).toBe("ClassworkReady");
    expect(tab("Roadmap").textContent).toBe("RoadmapReady");
  });

  it("shows a midterm session's panel instead of the tabs", async () => {
    api.lesson.mockResolvedValue(lesson({ lesson_type: "MIDTERM", midterm: { exam_id: 7, title: "Midterm 1", access_days_before: 2 } }));
    await render();
    expect(host.querySelector('[role="tab"]')).toBeNull();
    expect(host.textContent).toContain("Midterm session");
    expect(host.textContent).toContain("Runs “Midterm 1”.");
    expect(host.textContent).toContain("The class is given access 2 days before this");
    expect(host.textContent).toContain("Midterm sessions carry no homework or classwork.");
  });

  it("says when the session could not load", async () => {
    api.lesson.mockRejectedValue(new Error("down"));
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Could not load this session.");
  });
});
