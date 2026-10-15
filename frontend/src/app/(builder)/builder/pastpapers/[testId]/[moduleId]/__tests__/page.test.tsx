/**
 * The module editor both builder libraries share: past papers at /builder/pastpapers/<id>/<module>,
 * practice tests at /builder/practice-tests/<id>/<module> (a re-export of the same page). It loads
 * just ITS section, and only the way back differs between the two.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSection = vi.fn();
const panel = vi.fn();
let pathname = "/builder/pastpapers/7/70";

vi.mock("next/navigation", () => ({
  useParams: () => ({ testId: "7", moduleId: "70" }),
  usePathname: () => pathname,
}));
vi.mock("@/features/examsAdmin/api", () => ({
  examsAdminApi: { getSection: (...a: unknown[]) => getSection(...a) },
}));
vi.mock("@/lib/studioSession", () => ({ writeStudioSession: vi.fn() }));
vi.mock("@/features/questionsAdmin/ModuleQuestionsPanel", () => ({
  default: (props: Record<string, unknown>) => {
    panel(props);
    return <div data-testid="panel" />;
  },
}));

const { default: SharedEditor } = await import("../page");
const { default: PracticeEditor } = await import(
  "../../../../practice-tests/[testId]/[moduleId]/page"
);

let host: HTMLElement;
let root: Root;

async function renderEditor(Page: () => React.ReactNode) {
  act(() => root.render(<Page />));
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const lastProps = () => panel.mock.calls.at(-1)![0] as Record<string, unknown>;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  getSection.mockReset();
  panel.mockReset();
  pathname = "/builder/pastpapers/7/70";
  getSection.mockResolvedValue({
    id: 7,
    title: "Algebra focus",
    subject: "MATH",
    collection_name: "",
    modules: [{ id: 70, module_order: 2 }],
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the shared module editor", () => {
  it("loads only its own section, whichever library it was opened from", async () => {
    await renderEditor(SharedEditor);
    expect(getSection).toHaveBeenCalledWith(7);
    expect(lastProps()).toMatchObject({
      testId: 7,
      moduleId: 70,
      packTitle: "Algebra focus",
      sectionSubject: "MATH",
      moduleOrder: "Module 2",
    });
  });

  it("goes back to Past papers by default", async () => {
    await renderEditor(SharedEditor);
    expect(lastProps().backHref).toBeUndefined();
    expect(lastProps().backLabel).toBeUndefined();
  });

  it("goes back to Practice tests when opened from the practice-test library", async () => {
    pathname = "/builder/practice-tests/7/70";
    await renderEditor(PracticeEditor);
    expect(lastProps()).toMatchObject({ backHref: "/builder/practice-tests", backLabel: "Practice tests" });
  });

  it("serves practice tests with the very same page", () => {
    expect(PracticeEditor).toBe(SharedEditor);
  });

  it("still opens the panel when the section cannot be loaded", async () => {
    getSection.mockRejectedValue(new Error("404"));
    await renderEditor(SharedEditor);
    expect(host.querySelector("[data-testid=panel]")).not.toBeNull();
    expect(lastProps()).toMatchObject({ testId: 7, moduleId: 70, sectionSubject: undefined });
  });
});
