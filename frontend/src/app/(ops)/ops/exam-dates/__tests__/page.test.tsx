/**
 * /ops/exam-dates in the console's look: the dates with their labels and status, Add date and Save changes with the
 * same payloads, the status pill's toggle, Delete through the console's confirm dialog (a refusal shows the
 * server's words there), the empty state, and a failed load in the server's words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listExamDatesAdmin: vi.fn(),
  createExamDate: vi.fn(),
  updateExamDate: vi.fn(),
  deleteExamDate: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  examsAdminApi: api,
}));

const { default: Page } = await import("../page");

const DATES = [
  { id: 1, exam_date: "2026-08-22", label: "August SAT", is_active: true, sort_order: 0 },
  { id: 2, exam_date: "2026-10-03", label: "", is_active: false, sort_order: 1 },
];

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
async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const row = (id: number) => host.querySelector<HTMLElement>(`[data-row="${id}"]`)!;
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(api)) f.mockReset();
  api.listExamDatesAdmin.mockResolvedValue(DATES);
  api.createExamDate.mockResolvedValue({});
  api.updateExamDate.mockResolvedValue({});
  api.deleteExamDate.mockResolvedValue({});
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the dates", () => {
  it("shows each date with its label and status, and the count", async () => {
    await render();
    expect(host.querySelector("h1")!.textContent).toBe("SAT exam dates");
    expect(host.textContent).toContain("Admin console · Exam dates");
    expect(row(1).textContent).toContain("Aug 22, 2026");
    expect(row(1).textContent).toContain("August SAT");
    expect(buttonIn(row(1), "Active").title).toBe("Toggle active");
    expect(row(2).textContent).toContain("—");
    expect(buttonIn(row(2), "Inactive")).toBeDefined();
    expect(host.textContent).toContain("2 dates · 1 active");
  });

  it("shows the empty state when there are no dates", async () => {
    api.listExamDatesAdmin.mockResolvedValue({ results: [] });
    await render();
    expect(host.textContent).toContain("No exam dates yet");
    expect(host.textContent).toContain("Add your first SAT date above.");
  });

  it("shows the server's words when the list does not load", async () => {
    api.listExamDatesAdmin.mockRejectedValue({ response: { status: 500, data: { detail: "Database is down." } } });
    await render();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("Database is down.");
  });

  it("loads again on Refresh", async () => {
    await render();
    await click(buttonIn(host, "Refresh"));
    expect(api.listExamDatesAdmin).toHaveBeenCalledTimes(2);
  });
});

describe("add, edit, toggle", () => {
  it("adds a date with the trimmed label, the sort as a number and the Active tick", async () => {
    await render();
    const form = host.querySelector<HTMLFormElement>('form[data-form="new"]')!;
    expect(buttonIn(form, "Add date").disabled).toBe(true);
    await type(host.querySelector<HTMLInputElement>("#exam-date-new-date")!, "2026-12-05");
    await type(host.querySelector<HTMLInputElement>("#exam-date-new-label")!, "  December SAT ");
    await type(host.querySelector<HTMLInputElement>("#exam-date-new-sort")!, "3");
    await click(host.querySelector<HTMLInputElement>("#exam-date-new-active")!);
    await click(buttonIn(form, "Add date"));
    expect(api.createExamDate).toHaveBeenCalledWith({
      exam_date: "2026-12-05",
      label: "December SAT",
      is_active: false,
      sort_order: 3,
    });
    expect(api.listExamDatesAdmin).toHaveBeenCalledTimes(2);
  });

  it("shows the server's words when an add is refused", async () => {
    api.createExamDate.mockRejectedValue({ response: { status: 400, data: { exam_date: ["This date already exists."] } } });
    await render();
    await type(host.querySelector<HTMLInputElement>("#exam-date-new-date")!, "2026-08-22");
    await click(buttonIn(host.querySelector('form[data-form="new"]')!, "Add date"));
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("This date already exists.");
  });

  it("edits a date in place and saves the same fields", async () => {
    await render();
    await click(row(1).querySelector('[aria-label="Edit"]')!);
    const form = row(1).querySelector<HTMLFormElement>('form[data-form="edit"]')!;
    expect(form.querySelector<HTMLInputElement>("#exam-date-edit-date")!.value).toBe("2026-08-22");
    expect(form.querySelector<HTMLInputElement>("#exam-date-edit-label")!.value).toBe("August SAT");
    await type(form.querySelector<HTMLInputElement>("#exam-date-edit-label")!, "August SAT (main)");
    await click(buttonIn(form, "Save changes"));
    expect(api.updateExamDate).toHaveBeenCalledWith(1, {
      exam_date: "2026-08-22",
      label: "August SAT (main)",
      is_active: true,
      sort_order: 0,
    });
    expect(host.querySelector('form[data-form="edit"]')).toBeNull();
  });

  it("cancels an edit without saving", async () => {
    await render();
    await click(row(2).querySelector('[aria-label="Edit"]')!);
    await click(buttonIn(row(2), "Cancel"));
    expect(host.querySelector('form[data-form="edit"]')).toBeNull();
    expect(api.updateExamDate).not.toHaveBeenCalled();
  });

  it("toggles a date's status from its pill", async () => {
    await render();
    await click(buttonIn(row(2), "Inactive"));
    expect(api.updateExamDate).toHaveBeenCalledWith(2, { is_active: true });
  });
});

describe("delete", () => {
  it("asks in the console dialog, then deletes and reloads", async () => {
    await render();
    await click(row(1).querySelector('[aria-label="Delete"]')!);
    const d = dialog()!;
    expect(d.querySelector("h2")!.textContent).toContain("Delete the exam date");
    expect(d.querySelector("h2")!.textContent).toContain("Aug 22, 2026?");
    expect(d.textContent).toContain("Students who chose it will lose it.");
    expect(api.deleteExamDate).not.toHaveBeenCalled();
    await click(buttonIn(d, "Delete"));
    expect(api.deleteExamDate).toHaveBeenCalledWith(1);
    expect(api.listExamDatesAdmin).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the dialog is cancelled", async () => {
    await render();
    await click(row(1).querySelector('[aria-label="Delete"]')!);
    await click(buttonIn(dialog()!, "Cancel"));
    expect(api.deleteExamDate).not.toHaveBeenCalled();
  });

  it("shows a refusal in the dialog in the server's words", async () => {
    api.deleteExamDate.mockRejectedValue({ response: { status: 409, data: { detail: "Students still count down to it." } } });
    await render();
    await click(row(1).querySelector('[aria-label="Delete"]')!);
    await click(buttonIn(dialog()!, "Delete"));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain("Students still count down to it.");
    expect(api.listExamDatesAdmin).toHaveBeenCalledTimes(1);
  });
});
