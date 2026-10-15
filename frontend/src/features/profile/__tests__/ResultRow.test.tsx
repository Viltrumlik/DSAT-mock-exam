/**
 * A finished test, as a row of the profile's results. A practice test is never presented as a past
 * paper: its row is "Practice Test N", whatever internal title the builder gave it (owner,
 * 2026-10-15). A past paper keeps the title it always had.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileAttempt } from "../types";

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}));

const { ResultRow } = await import("../ResultsTab");
const { resultTitle } = await import("../profileModel");

const PRACTICE: ProfileAttempt = {
  id: 31,
  submitted_at: "2026-10-14T09:00:00Z",
  is_completed: true,
  score: 640,
  practice_test_details: {
    subject: "MATH", title: "Algebra focus", collection_name: null,
    is_practice_test: true, practice_number: 4,
  },
};
const PAPER: ProfileAttempt = {
  id: 32,
  submitted_at: "2026-10-13T09:00:00Z",
  is_completed: true,
  score: 700,
  practice_test_details: { subject: "MATH", title: "Section 1", collection_name: "SAT March 2024" },
};

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(attempt: ProfileAttempt) {
  await act(async () => root.render(<ul><ResultRow attempt={attempt} /></ul>));
}

describe("resultTitle", () => {
  it("names a practice test by its number, ahead of its internal title", () => {
    expect(resultTitle(PRACTICE)).toBe("Practice Test 4");
  });

  it("is never a past paper's name for a practice test with no number yet", () => {
    expect(resultTitle({ ...PRACTICE, practice_test_details: { ...PRACTICE.practice_test_details, practice_number: null } })).toBe("Practice Test");
  });

  it("keeps a past paper's title, then its collection, then its subject", () => {
    expect(resultTitle(PAPER)).toBe("Section 1");
    expect(resultTitle({ ...PAPER, practice_test_details: { subject: "MATH", title: " ", collection_name: "SAT March 2024" } })).toBe("SAT March 2024");
    expect(resultTitle({ ...PAPER, practice_test_details: { subject: "MATH" } })).toBe("Math");
  });
});

describe("ResultRow", () => {
  it("reads Practice Test N for a practice test, and still says which subject", async () => {
    await render(PRACTICE);

    const text = host.textContent ?? "";
    expect(text).toContain("Practice Test 4");
    expect(text).not.toContain("Algebra focus");
    expect(text).not.toMatch(/past paper/i);
    expect(text).toContain("Math");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/review/31");
  });

  it("leaves a past paper's row as it was", async () => {
    await render(PAPER);

    expect(host.textContent).toContain("Section 1");
    expect(host.textContent).not.toMatch(/practice test/i);
  });
});
