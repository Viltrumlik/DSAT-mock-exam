/**
 * Assessments (PR 17a): the subject → level → sets drill-down with its counts (a two-level set in both levels,
 * Unassigned), the chips, the review status select, delete with the 409 force delete, and Import CSV sending the
 * bucket's subject and level.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssessmentSet } from "@/features/assessments/types";

const listAllSets = vi.fn();
const setReviewStatus = vi.fn();
const deleteSet = vi.fn();
const importSetCsv = vi.fn();
const toast = vi.fn();
const routerPush = vi.fn();
let role = "admin";
let subject: "math" | "english" | null = null;

vi.mock("next/link", () => ({
  default: ({ children, href, className, ...rest }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => ({ push: toast }) }));
vi.mock("@/lib/permissions", () => ({ getRole: () => role, getSubject: () => subject }));
vi.mock("@/features/assessmentsAdmin/api", () => ({
  assessmentsAdminApi: {
    importSetCsv: (...a: unknown[]) => importSetCsv(...a),
  },
}));
// The page's own hooks, on the real react-query, without the shared hooks' rethrow in onError (an unhandled
// rejection in a test); mutateAsync rejects with the request's own error either way.
vi.mock("@/features/assessments/hooks", async () => {
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    useAssessmentSetsList: (params?: unknown) =>
      useQuery({ queryKey: ["sets", params], queryFn: () => listAllSets(params) }),
    useSetReviewStatus: () =>
      useMutation({ mutationFn: (x: { id: number; status: string }) => setReviewStatus(x.id, x.status) }),
    useDeleteAssessmentSet: () =>
      useMutation({ mutationFn: (v: { setId: number; force?: boolean }) => deleteSet(v.setId, Boolean(v.force)) }),
  };
});

const { default: Page } = await import("../page");

function set(id: number, over: Partial<AssessmentSet> = {}): AssessmentSet {
  return {
    id,
    subject: "math",
    level: "junior",
    secondary_level: "",
    category: "",
    title: `Set ${id}`,
    description: "",
    is_active: true,
    review_status: "draft",
    questions: [],
    updated_at: "2026-11-01T10:00:00+05:00",
    ...over,
  } as AssessmentSet;
}

const SETS = [
  set(11, { subject: "english", review_status: "approved" }),
  set(12, {
    title: "Linear equations",
    is_active: false,
    category: "Algebra · Linear equations",
    questions: [{ is_active: true }, { is_active: false }] as AssessmentSet["questions"],
  }),
  set(13, { title: "Systems", secondary_level: "middle", review_status: "needs_review" }),
  set(14, { level: "middle", review_status: "approved" }),
  set(15, { level: "", title: "Old set", is_active: false }),
  set(16, { subject: "english", level: "senior" }),
];

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 4; i += 1) {
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
        <Page />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim().startsWith(words))!;
const rows = () => Array.from(host.querySelectorAll<HTMLElement>("li[data-set]"));
const rowIds = () => rows().map((r) => Number(r.dataset.set));
const row = (id: number) => host.querySelector<HTMLElement>(`li[data-set="${id}"]`)!;

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function openMathJunior() {
  await render();
  await click(buttonIn(host, "Math"));
  await click(buttonIn(host, "Junior"));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of [listAllSets, setReviewStatus, deleteSet, importSetCsv, toast, routerPush]) f.mockReset();
  role = "admin";
  subject = null;
  listAllSets.mockResolvedValue({ count: SETS.length, next: null, previous: null, results: SETS });
  setReviewStatus.mockResolvedValue({});
  deleteSet.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the drill-down", () => {
  it("opens a subject, then a level, with their counts; a two-level set is in both levels", async () => {
    await render();
    expect(host.textContent).toContain("Assessments");
    expect(buttonIn(host, "English").textContent).toContain("2 sets");
    expect(buttonIn(host, "Math").textContent).toContain("4 sets");
    // Total / Active / Draft over every set.
    expect(host.textContent).toMatch(/Total\s*6/);

    await click(buttonIn(host, "Math"));
    expect(buttonIn(host, "Foundation").textContent).toContain("0 sets");
    expect(buttonIn(host, "Junior").textContent).toContain("2 sets");
    expect(buttonIn(host, "Middle").textContent).toContain("2 sets");
    expect(buttonIn(host, "Unassigned").textContent).toContain("1 without a level");

    await click(buttonIn(host, "Junior"));
    expect(rowIds()).toEqual([12, 13]);
    expect(host.querySelector('nav[aria-label="Subject and level"]')!.textContent).toBe("All subjectsMathJunior");
    const newSet = Array.from(host.querySelectorAll("a")).find((a) => a.textContent?.includes("New set"))!;
    expect(newSet.getAttribute("href")).toBe("/builder/sets/new?subject=math&level=junior");

    // Back to the start from the breadcrumb.
    await click(buttonIn(host.querySelector("nav")!, "All subjects"));
    expect(buttonIn(host, "English")).toBeTruthy();
    expect(rows()).toHaveLength(0);
  });

  it("starts a teacher at their own subject, asking the server for it alone", async () => {
    role = "teacher";
    subject = "math";
    await render();
    expect(listAllSets).toHaveBeenCalledWith({ subject: "math" });
    expect(host.querySelector('nav[aria-label="Subject and level"]')!.textContent).toBe("Math");
    expect(buttonIn(host, "Junior")).toBeTruthy();
  });

  it("draws a set's row: its badges, category, and what it holds", async () => {
    await openMathJunior();
    const r = row(12);
    expect(r.querySelector('a[href="/builder/sets/12"]')!.textContent).toBe("#12 · Linear equations");
    expect(r.textContent).toContain("Incomplete");
    expect(r.textContent).toContain("Draft");
    expect(r.textContent).toContain("Algebra · Linear equations");
    expect(r.textContent).toContain("2 questions(1 active)");
    expect(r.textContent).toContain("updated Nov 1, 2026");
    const systems = row(13);
    expect(systems.textContent).toContain("Needs review");
    expect(systems.textContent).toContain("Published");
    expect(systems.textContent).toContain("Junior · Middle");
    expect(systems.textContent).toContain("immutable");
  });
});

describe("the filters", () => {
  it("filters by review status and visibility with the chips, each with its count", async () => {
    await openMathJunior();
    const review = host.querySelector('[role="group"][aria-label="Review status"]')!;
    const needs = buttonIn(review, "Needs review");
    expect(needs.textContent).toContain("1");
    await click(needs);
    expect(needs.getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual([13]);

    await click(buttonIn(review, "All review statuses"));
    await click(buttonIn(host.querySelector('[role="group"][aria-label="Visibility"]')!, "Archived only"));
    expect(rowIds()).toEqual([12]);
  });

  it("says when nothing matches, and offers New set", async () => {
    await openMathJunior();
    await click(buttonIn(host.querySelector('[role="group"][aria-label="Review status"]')!, "Approved"));
    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain("No sets match your filters.");
  });
});

describe("the review status", () => {
  it("changes with the same call and says so", async () => {
    await openMathJunior();
    await click(row(12).querySelector<HTMLButtonElement>('button[aria-label="Review status of #12"]')!);
    const approved = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.startsWith("Approved"))!;
    await click(approved);
    expect(setReviewStatus).toHaveBeenCalledWith(12, "approved");
    expect(toast).toHaveBeenCalledWith({ message: "Status set to “Approved”.", tone: "success" });
  });

  it("keeps Approved out of a teacher's reach", async () => {
    role = "teacher";
    subject = "math";
    await render();
    await click(buttonIn(host, "Junior"));
    await click(row(12).querySelector<HTMLButtonElement>('button[aria-label="Review status of #12"]')!);
    const approved = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((o) => o.textContent?.startsWith("Approved"))!;
    expect(approved.getAttribute("aria-disabled")).toBe("true");
    expect(approved.textContent).toContain("Only an admin can approve");
    await click(approved);
    expect(setReviewStatus).not.toHaveBeenCalled();
  });
});

describe("delete", () => {
  it("asks, then deletes with the same call", async () => {
    await openMathJunior();
    await click(row(12).querySelector<HTMLButtonElement>('button[aria-label="Delete set Linear equations"]')!);
    expect(document.body.textContent).toContain("Delete assessment set?");
    expect(document.body.textContent).toContain("“#12 · Linear equations” and its draft questions will be permanently removed.");
    await click(buttonIn(document.body, "Delete set"));
    expect(deleteSet).toHaveBeenCalledWith(12, false);
  });

  it("offers the force delete when the server refuses with 409, and sends force", async () => {
    deleteSet.mockRejectedValueOnce({ response: { status: 409, data: { detail: "This set has student attempts." } } });
    await openMathJunior();
    await click(row(13).querySelector<HTMLButtonElement>('button[aria-label="Delete set Systems"]')!);
    expect(document.body.textContent).not.toContain("Force delete?");
    await click(buttonIn(document.body, "Delete set"));
    expect(document.body.textContent).toContain("This set has student attempts.");
    expect(document.body.textContent).toContain("Force delete?");
    await click(buttonIn(document.body, "Force delete (removes attempts & grades)"));
    expect(deleteSet).toHaveBeenLastCalledWith(13, true);
  });
});

describe("Import CSV", () => {
  it("creates a set in this subject and level from the file, then opens it", async () => {
    importSetCsv.mockResolvedValue({ id: 77, created_count: 3 });
    await openMathJunior();
    await click(buttonIn(host, "Import CSV"));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Import set from CSV");
    expect(dialog.textContent).toContain("Math · Junior — one question per row.");

    const [title, file] = Array.from(dialog.querySelectorAll<HTMLInputElement>("input"));
    setValue(title, "Algebra — Unit 1");
    setValue(dialog.querySelector("select")!, "SQB");
    const csv = new File(["question_type,prompt\n"], "unit1.csv", { type: "text/csv" });
    Object.defineProperty(file, "files", { value: [csv] });

    await click(buttonIn(dialog, "Import"));
    expect(importSetCsv).toHaveBeenCalledWith({ subject: "math", source: "SQB", level: "junior", title: "Algebra — Unit 1" }, csv);
    expect(toast).toHaveBeenCalledWith({ tone: "success", message: "Created “Algebra — Unit 1” with 3 questions." });
    expect(routerPush).toHaveBeenCalledWith("/builder/sets/77");
  });
});
