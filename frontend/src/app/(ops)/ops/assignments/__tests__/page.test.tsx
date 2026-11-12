/**
 * /ops/assignments in the console's look: it says the work moved to the Teacher Portal, and its one link goes to
 * the portal's classrooms.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { default: Page } = await import("../page");

let host: HTMLElement;
let root: Root;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Page />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Assignments moved", () => {
  it("says where assignments went, and links there", () => {
    expect(host.querySelector("h1")!.textContent).toBe("Assignments moved to the Teacher Portal");
    expect(host.textContent).toContain(
      "Teachers now create and manage classroom assignments (homework, assessments, past papers, midterms) directly in their classroom workspace. Admin is governance-only.",
    );
    const link = host.querySelector("a")!;
    expect(link.textContent?.trim()).toBe("Open Teacher Portal");
    const base = process.env.NEXT_PUBLIC_TEACHER_PORTAL_URL || "https://teacher.mastersat.uz";
    expect(link.getAttribute("href")).toBe(`${base}/teacher/classrooms`);
  });
});
