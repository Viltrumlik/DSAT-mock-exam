/**
 * The five-second hold. Three things make it more than a `setTimeout`: the
 * verdict has to be banked before the pause rather than after it, the pause has
 * to survive the *keyboard* (which never sees a disabled button), and the timer
 * has to die with the mode — this is a full-screen takeover left by a
 * client-side <Link>, so nothing else will stop it.
 */
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlashcardMode } from "../FlashcardMode";
import type { ModeBootContext } from "../ModeChrome";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  finish: vi.fn(),
  retry: vi.fn(),
}));

/**
 * The deck is swapped per test through a holder rather than a factory argument,
 * because `vi.mock` is hoisted and its factory closes over this once.
 */
const deck = vi.hoisted(() => {
  const word = (id: number) => ({
    id,
    word: `word-${id}`,
    definition: `meaning-${id}`,
    part_of_speech: "",
    example: "",
    synonyms: [] as string[],
    status: "new",
  });
  let words = [word(1), word(2)];
  return {
    use(ids: number[]) {
      words = ids.map(word);
    },
    context: () => ({
      set: { id: 7, title: "Unit 1", is_custom: false, words },
      pool: [],
      runKey: 0,
      restart: () => {},
    }),
  };
});

vi.mock("../useModeSession", () => ({
  useModeSession: () => ({
    ready: true,
    finishing: false,
    summary: null,
    error: null,
    fatal: false,
    report: mocks.report,
    finish: mocks.finish,
    retry: mocks.retry,
  }),
}));

// Stubbed whole: the real ModeBoot fetches the set through react-query, and the
// frame is a fixed-inset takeover — neither has anything to do with the hold.
vi.mock("../ModeChrome", () => ({
  ModeBoot: ({ children }: { children: (ctx: ModeBootContext) => ReactNode }) => (
    <>{children(deck.context() as unknown as ModeBootContext)}</>
  ),
  ModeFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ModePill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Kbd: ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>,
  ModeOutcome: ({ title }: { title: string }) => <div>{title}</div>,
  ModeStartError: ({ message }: { message: string }) => <div>{message}</div>,
  setHref: (id: number) => `/vocabulary/sets/${id}`,
}));

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<FlashcardMode setId={7} />);
  });

  const verdict = (label: "Wrong" | "Correct") => {
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(label),
    );
    if (!button) throw new Error(`no "${label}" button on screen`);
    return button;
  };

  return {
    get text() {
      return container.textContent ?? "";
    },
    /** The card's own aria-label flips with it, so it is the honest probe. */
    get showingDefinition() {
      return container.querySelector('[aria-label="Show the word"]') != null;
    },
    click: (label: "Wrong" | "Correct") =>
      act(() => {
        verdict(label).click();
      }),
    press: (...keys: string[]) =>
      act(() => {
        keys.forEach((key) => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
      }),
    wait: (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      }),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("FlashcardMode — the 5s hold after a verdict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deck.use([1, 2]);
    mocks.report.mockReset();
    mocks.finish.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("banks the verdict immediately and turns the definition face-up", () => {
    const h = mount();
    expect(h.showingDefinition).toBe(false);

    h.click("Correct");

    // Reported before the pause, not after it: quitting mid-hold must not cost
    // the student the verdict they just gave.
    expect(mocks.report).toHaveBeenCalledTimes(1);
    expect(mocks.report).toHaveBeenCalledWith({ word_id: 1, correct: true });
    expect(h.showingDefinition).toBe(true);
    expect(h.text).toContain("5s");
    h.unmount();
  });

  it("holds the card for the whole five seconds before dealing the next", () => {
    const h = mount();
    h.click("Correct");

    h.wait(4000);
    expect(h.text).toContain("1s");
    expect(h.text).not.toContain("word-2");

    h.wait(1000);
    expect(h.text).toContain("word-2");
    // The next card starts face-down again.
    expect(h.showingDefinition).toBe(false);
    h.unmount();
  });

  it("throttles the keyboard, which never sees a disabled button", () => {
    const h = mount();
    h.press("2");
    expect(mocks.report).toHaveBeenCalledTimes(1);

    // A held key repeats far faster than the hold, and `useModeKeys` is bound at
    // the window — this is the entry point `disabled` does nothing about.
    h.press("2", "2", "ArrowRight", "1", "ArrowLeft");
    expect(mocks.report).toHaveBeenCalledTimes(1);

    h.wait(5000);
    h.press("1");
    expect(mocks.report).toHaveBeenCalledTimes(2);
    expect(mocks.report).toHaveBeenLastCalledWith({ word_id: 2, correct: false });
    h.unmount();
  });

  it("records one verdict for a double-click, not two", () => {
    const h = mount();
    act(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Wrong"),
      );
      button?.click();
      button?.click();
    });

    expect(mocks.report).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it("takes its timer with it when the student leaves mid-hold", () => {
    const h = mount();
    h.click("Correct");
    expect(vi.getTimerCount()).toBe(1);

    // Leaving is a client-side <Link>, i.e. an unmount and nothing else. A live
    // interval here would tick on and advance a card in a tree that is gone.
    h.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("grades the round the moment the last verdict lands, not when the hold ends", () => {
    deck.use([9]);
    const h = mount();
    h.click("Correct");

    // The hold would otherwise open a five-second window in which walking out
    // flushes the session as partial — and an uncompleted game scores zero.
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(h.text).not.toContain("Every word learned");

    h.wait(5000);
    expect(h.text).toContain("Every word learned");
    // The screen catching up asks again; `useModeSession` latches that down to a
    // single grade (its own test covers the latch), so two calls is the correct
    // number here — what must never appear is a third path.
    expect(mocks.finish).toHaveBeenCalledTimes(2);
    h.unmount();
  });
});
