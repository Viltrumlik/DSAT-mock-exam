/**
 * Practice tests can be sat Timed or Untimed (owner decision 2026-10-14). The choice is made on
 * the Welcome screen, travels to the server on Start, and comes back on the attempt as
 * `is_timed` — the runner then draws "Untimed" in place of the clock.
 *
 * (No @testing-library in this repo: these mount with react-dom/client + act, like the rest
 * of the runner's tests.)
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
vi.mock("@/lib/api", () => ({
  default: { post: (...args: unknown[]) => post(...args), get: vi.fn() },
  getCachedCsrfToken: () => null,
}));

import { ExamHeader } from "../components/ExamHeader";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { createExamApi } from "../services/examApiClient";
import { isPracticeTest, isUntimed } from "../state/selectors";
import { parseAttempt } from "../types";

const attempt = (extra: Record<string, unknown>) => extra as never;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(node: React.ReactNode) {
  act(() => {
    root.render(node);
  });
}

const radio = (name: RegExp) =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="radio"]')).find((el) => name.test(el.textContent ?? ""));
/** Some element whose OWN text (not its children's) is, or matches, `text`. */
const hasText = (text: string | RegExp) =>
  Array.from(container.querySelectorAll("*")).some((el) => {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .trim();
    return typeof text === "string" ? own === text : text.test(own);
  });
const buttonNamed = (name: RegExp) =>
  Array.from(container.querySelectorAll("button")).find((el) => name.test(el.textContent ?? ""));

/** The smallest payload the wire contract accepts. */
const wire = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  current_state: "NOT_STARTED",
  version_number: 1,
  practice_test_details: { id: 3, subject: "MATH", title: "Practice Test 1", modules: [] },
  current_module: null,
  current_module_details: null,
  current_module_start_time: null,
  server_now: "2026-10-15T10:00:00Z",
  remaining_seconds: null,
  module_duration_seconds: null,
  current_module_saved_answers: null,
  current_module_flagged_questions: null,
  is_completed: false,
  is_expired: false,
  ...extra,
});

describe("untimed practice tests", () => {
  it("reads the server's choice", () => {
    expect(isUntimed(attempt({ is_timed: false }))).toBe(true);
    expect(isUntimed(attempt({ is_timed: true }))).toBe(false);
    expect(isUntimed(attempt({}))).toBe(false);
    expect(isPracticeTest(attempt({ practice_test_details: { is_practice_test: true } }))).toBe(true);
  });

  it("offers Timed / Untimed on the Welcome screen and reports the choice", () => {
    const onChange = vi.fn();
    mount(
      <WelcomeScreen moduleTitle="Section 2, Module 1: Math" kindLabel="Practice Test" subjectLabel="Math"
        minutes={35} questionCount={22} starting={false} fullscreenSupported={false} onStart={() => {}}
        timing={{ timed: true, onChange }} />,
    );
    act(() => {
      radio(/untimed/i)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows 'No limit' and the untimed rule when untimed is picked", () => {
    mount(
      <WelcomeScreen moduleTitle="M" kindLabel="Practice Test" subjectLabel="Math" minutes={35}
        questionCount={22} starting={false} fullscreenSupported={false} onStart={() => {}}
        timing={{ timed: false, onChange: () => {} }} />,
    );
    expect(hasText("No limit")).toBe(true);
    expect(hasText(/no timer/i)).toBe(true);
  });

  it("past papers get no choice", () => {
    mount(
      <WelcomeScreen moduleTitle="M" subjectLabel="Math" minutes={35} questionCount={22}
        starting={false} fullscreenSupported={false} onStart={() => {}} />,
    );
    expect(radio(/untimed/i)).toBeUndefined();
  });

  it("keeps the minutes and the timer rule while Timed is picked", () => {
    mount(
      <WelcomeScreen moduleTitle="M" kindLabel="Practice Test" subjectLabel="Math" minutes={35}
        questionCount={22} starting={false} fullscreenSupported={false} onStart={() => {}}
        timing={{ timed: true, onChange: () => {} }} />,
    );
    expect(hasText("35 min")).toBe(true);
    expect(hasText("No limit")).toBe(false);
    expect(hasText(/timer starts when you press start/i)).toBe(true);
    expect(radio(/^timed$/i)!.getAttribute("aria-checked")).toBe("true");
    expect(radio(/untimed/i)!.getAttribute("aria-checked")).toBe("false");
  });
});

describe("the wire contract", () => {
  it("carries is_timed and defaults it to true when the server does not send it", () => {
    expect(parseAttempt(wire()).is_timed).toBe(true);
    expect(parseAttempt(wire({ is_timed: false })).is_timed).toBe(false);
  });

  it("carries the practice-test marks on practice_test_details", () => {
    const a = parseAttempt(
      wire({
        practice_test_details: {
          id: 3, subject: "MATH", title: "T", modules: [], is_practice_test: true, practice_number: 4,
        },
      }),
    );
    expect(a.practice_test_details.is_practice_test).toBe(true);
    expect(a.practice_test_details.practice_number).toBe(4);
    expect(isPracticeTest(a)).toBe(true);
  });
});

describe("start()", () => {
  beforeEach(() => post.mockReset());

  it("tells the server timed:false for an untimed sitting", async () => {
    post.mockResolvedValue({ data: wire({ is_timed: false }) });
    await createExamApi("/exams/attempts").start(7, "key-1", { timed: false });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("/exams/attempts/7/start/");
    expect(post.mock.calls[0][1]).toEqual({ timed: false });
  });

  it("sends an empty body otherwise, exactly as before", async () => {
    post.mockResolvedValue({ data: wire() });
    await createExamApi("/exams/attempts").start(7, "key-2");
    await createExamApi("/exams/attempts").start(7, "key-3", { timed: true });
    expect(post.mock.calls[0][1]).toEqual({});
    expect(post.mock.calls[1][1]).toEqual({});
  });
});

describe("ExamHeader", () => {
  const tools = {
    calculatorOpen: false,
    toggleCalculator: () => {},
    referenceOpen: false,
    toggleReference: () => {},
    highlighterActive: false,
    toggleHighlighter: () => {},
    notesOpen: false,
    toggleNotes: () => {},
    zoomIn: () => {},
    zoomOut: () => {},
    toggleHelp: () => {},
    fullscreen: { supported: false, isFullscreen: false, toggle: () => {} },
  } as never;

  const header = (extra: Record<string, unknown> = {}) => (
    <ExamHeader
      moduleTitle="Section 1, Module 1: Reading and Writing"
      secondsLeft={1500}
      timerHidden={false}
      onToggleTimer={() => {}}
      timerWarning={false}
      showDirections={false}
      onToggleDirections={() => {}}
      mathTools={false}
      showCalculator={false}
      tools={tools}
      pauseAllowed={false}
      paused={false}
      onTogglePause={() => {}}
      saveExitAllowed
      onSaveAndExit={() => {}}
      {...extra}
    />
  );

  it("shows 'Untimed' instead of the countdown", () => {
    mount(header({ untimed: true }));
    expect(hasText("Untimed")).toBe(true);
    expect(hasText("25:00")).toBe(false);
    expect(buttonNamed(/^hide$/i)).toBeUndefined();
  });

  it("shows the countdown when timed", () => {
    mount(header());
    expect(hasText("Untimed")).toBe(false);
    expect(hasText("25:00")).toBe(true);
    expect(buttonNamed(/^hide$/i)).toBeDefined();
  });
});
