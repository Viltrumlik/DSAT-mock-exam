/**
 * /practice-tests wears the same filter row as /pastpapers (REGION / YEAR / STATUS), so its two
 * labels are upper-case too: SUBJECT and STATUS (owner, 2026-10-15 — "the same look").
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ examsPublicApi: { getPracticeTestSections: vi.fn() } }));
// The data hook is its own concern (and shared with /pastpapers); this page test is about what the
// page draws, so the library is empty and the filter row is all there is.
vi.mock("@/features/pastpapers/PaperLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/pastpapers/PaperLibrary")>()),
  usePaperLibrary: () => ({
    sections: [], atts: [], reopened: new Map(), byTest: new Map(), loading: false, error: false,
    load: vi.fn(), starting: null, startError: null, handleOpen: vi.fn(),
  }),
}));

const { default: PracticeTestsPage } = await import("../page");

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

describe("/practice-tests filters", () => {
  it("labels its two filters SUBJECT and STATUS, like /pastpapers does", async () => {
    await act(async () => root.render(<PracticeTestsPage />));

    const labels = [...host.querySelectorAll("span")].map((s) => s.textContent);
    expect(labels).toContain("SUBJECT");
    expect(labels).toContain("STATUS");
    expect(labels).not.toContain("Subject");
    expect(labels).not.toContain("Status");
  });
});
