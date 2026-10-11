/**
 * The calculator is a RULE of the paper, not a tool preference: a Foundation Math midterm is
 * worked by hand (2026-10-11, the school's request), so nothing in the runner may offer or
 * promise Desmos on one. The server decides (`calculator_enabled` / `calculator_mode` on the
 * midterm's practice_test_details); these tests pin every surface that reads that decision —
 * the selector, the floating calculator's mount, and the Directions wording.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Desmos itself loads a remote script; the gate under test is whether it MOUNTS at all.
vi.mock("../tools/calculator/DesmosCalculator", () => ({
  DesmosCalculator: (p: { scientificOnly?: boolean }) => (
    <div data-testid="desmos" data-scientific={String(Boolean(p.scientificOnly))} />
  ),
}));

import { DirectionsOverlay } from "../components/DirectionsOverlay";
import { calculatorAllowed, calculatorScientificOnly } from "../state/selectors";
import { ExamToolsLayer } from "../tools/ExamToolsLayer";
import type { ExamTools } from "../tools/useExamTools";
import type { Attempt } from "../types";

function attempt(details: Record<string, unknown>): Attempt {
  return {
    id: 1,
    current_state: "MODULE_1_ACTIVE",
    practice_test_details: { id: 1, title: "Paper", modules: [], ...details },
  } as unknown as Attempt;
}

const midterm = (level: string, calculator_enabled: boolean, calculator_mode: string | null) =>
  attempt({ subject: "MATH", mock_kind: "MIDTERM", level, calculator_enabled, calculator_mode });

/** A tools controller with the calculator OPEN — the state a rule flip can leave behind. */
function openCalculatorTools(): ExamTools {
  return {
    calculatorOpen: true,
    calculatorEnlarged: false,
    toggleCalculator: vi.fn(),
    toggleCalculatorEnlarge: vi.fn(),
    referenceOpen: false,
    notesOpen: false,
    helpOpen: false,
    highlighter: { toolbar: null },
  } as unknown as ExamTools;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(ui: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(ui);
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("calculator selectors — the server's per-level decision", () => {
  it("Foundation Math midterm: no calculator at all", () => {
    const a = midterm("foundation", false, null);
    expect(calculatorAllowed(a)).toBe(false);
    expect(calculatorScientificOnly(a)).toBe(false);
  });

  it("Junior Math midterm: the Scientific calculator only", () => {
    const a = midterm("junior", true, "scientific");
    expect(calculatorAllowed(a)).toBe(true);
    expect(calculatorScientificOnly(a)).toBe(true);
  });

  it("Middle Math midterm: the full calculator", () => {
    const a = midterm("middle", true, "full");
    expect(calculatorAllowed(a)).toBe(true);
    expect(calculatorScientificOnly(a)).toBe(false);
  });

  it("a SAT Math module (not a midterm) keeps the calculator; R&W never has one", () => {
    expect(calculatorAllowed(attempt({ subject: "MATH" }))).toBe(true);
    expect(calculatorAllowed(attempt({ subject: "READING_WRITING" }))).toBe(false);
  });
});

describe("ExamToolsLayer — Desmos mounts on the rule, not on the open flag alone", () => {
  it("an open calculator on a paper that allows none is not mounted", () => {
    const el = render(<ExamToolsLayer tools={openCalculatorTools()} attemptId={1} calculatorEnabled={false} />);
    expect(el.querySelector('[data-testid="desmos"]')).toBeNull();
  });

  it("fails closed when a caller forgets the prop", () => {
    const el = render(<ExamToolsLayer tools={openCalculatorTools()} attemptId={1} />);
    expect(el.querySelector('[data-testid="desmos"]')).toBeNull();
  });

  it("mounts when allowed, Scientific-only when the paper says so", () => {
    const el = render(
      <ExamToolsLayer tools={openCalculatorTools()} attemptId={1} calculatorEnabled calculatorScientificOnly />,
    );
    const desmos = el.querySelector('[data-testid="desmos"]');
    expect(desmos).not.toBeNull();
    expect(desmos?.getAttribute("data-scientific")).toBe("true");
  });
});

describe("DirectionsOverlay — the Math wording matches the toolbar", () => {
  const overlay = (calculatorAllowedFlag: boolean) =>
    render(
      <DirectionsOverlay
        anchorBottom={0}
        widthPct={50}
        subject="MATH"
        calculatorAllowed={calculatorAllowedFlag}
        onClose={() => {}}
      />,
    );

  it("a paper without a calculator says to work by hand, never that one is permitted", () => {
    const text = overlay(false).textContent ?? "";
    expect(text).toContain("work these questions by hand");
    expect(text).not.toContain("calculator is permitted");
  });

  it("a paper with a calculator keeps the SAT wording", () => {
    expect(overlay(true).textContent ?? "").toContain("Use of a calculator is permitted for all questions.");
  });
});
