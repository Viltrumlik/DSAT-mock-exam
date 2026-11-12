/**
 * The support report's controls, in the console's look: the month picker, Refresh the month, the backlog
 * notice's owner chips and "Show me which", the history's filters (native selects and date fields), Clear,
 * the pager, and a student's name as a filter. Each must ask the endpoints exactly what it asked before.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportCounts, SupportMonthlyReport, SupportSessionRow, SupportSessionsReport } from "../types";

const monthly = vi.fn();
const sessions = vi.fn();

vi.mock("../api", () => ({
  supportReportApi: {
    monthly: (...args: unknown[]) => monthly(...args),
    sessions: (...args: unknown[]) => sessions(...args),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

import { SupportReportPage } from "../SupportReportPage";

const counts = (over: Partial<SupportCounts> = {}): SupportCounts => ({
  slots_published: 6,
  bookings: 8,
  held: 5,
  no_show: 1,
  cancelled: 1,
  upcoming: 0,
  unsettled: 1,
  unsettled_oldest: "2026-09-02T09:00:00+05:00",
  students_helped: 4,
  students_booked: 6,
  ...over,
});

const report = (over: Partial<SupportMonthlyReport> = {}): SupportMonthlyReport => ({
  month: "2026-09",
  months: ["2026-09", "2026-08"],
  generated_at: "2026-09-09T12:00:00+05:00",
  teacher_id: null,
  teachers: [
    {
      support_teacher_id: 7,
      support_teacher: "Dilafruz Ibrokhimjonova",
      ...counts(),
      attendance_rate: 0.8333,
      backlog_unsettled: 3,
      backlog_oldest: "2026-08-13T09:00:00+05:00",
    },
  ],
  total: { ...counts(), attendance_rate: 0.8333 },
  backlog: {
    unsettled: 3,
    oldest: "2026-08-13T09:00:00+05:00",
    teachers: [{ support_teacher_id: 7, support_teacher: "Dilafruz Ibrokhimjonova", unsettled: 3, oldest: "2026-08-13T09:00:00+05:00" }],
  },
  status_labels: { BOOKED: "Booked", HELD: "Held", NO_SHOW: "Did not attend", CANCELLED: "Cancelled" },
  ...over,
});

const row = (over: Partial<SupportSessionRow> = {}): SupportSessionRow => ({
  id: 1,
  starts_at: "2026-09-02T09:00:00+05:00",
  ends_at: "2026-09-02T10:00:00+05:00",
  slot_id: 2,
  slot_note: "",
  capacity: 1,
  support_teacher_id: 7,
  support_teacher: "Dilafruz Ibrokhimjonova",
  student_id: 21,
  student: "Aziza K",
  classroom_id: 3,
  classroom_name: "Math Senior A",
  topic: "Quadratic word problems",
  status: "NO_SHOW",
  status_label: "Did not attend",
  booked_at: "2026-08-30T12:00:00+05:00",
  settled_at: "2026-09-02T10:05:00+05:00",
  settled_by_id: 7,
  settled_by: "Dilafruz Ibrokhimjonova",
  invited_by_id: null,
  invited_by: null,
  cancel_reason: "",
  cancelled_at: null,
  teacher_note: "",
  rating: null,
  rating_comment: "",
  is_unsettled: false,
  ...over,
});

const history = (over: Partial<SupportSessionsReport> = {}): SupportSessionsReport => ({
  results: [row()],
  count: 1,
  limit: 50,
  offset: 0,
  has_more: false,
  statuses: [
    { value: "HELD", label: "Held" },
    { value: "NO_SHOW", label: "Did not attend" },
    { value: "UNSETTLED", label: "Not settled yet" },
  ],
  ...over,
});

let root: Root;
let host: HTMLElement;

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
async function render() {
  await act(async () => {
    root.render(<SupportReportPage />);
  });
  await settle();
}
async function click(el: Element | null | undefined) {
  expect(el, "element to click").toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function setValue(el: Element | null, value: string, event: "change" | "input" = "change") {
  expect(el, "field").toBeTruthy();
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el!.dispatchEvent(new Event(event, { bubbles: true }));
  });
  await settle();
}
const text = () => host.textContent ?? "";
const button = (words: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === words) ?? null;
/** The history filter whose label is `words`. */
const filter = (words: string) =>
  [...host.querySelectorAll("label")].find((l) => l.firstElementChild?.textContent === words)?.querySelector("select, input") ?? null;
const lastSessions = () => sessions.mock.calls[sessions.mock.calls.length - 1][0];

beforeEach(() => {
  monthly.mockReset();
  sessions.mockReset();
  monthly.mockResolvedValue(report());
  sessions.mockResolvedValue(history());
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("SupportReportPage — the month", () => {
  it("offers every month in the picker and asks for the one picked", async () => {
    await render();
    const picker = host.querySelector('select[aria-label="Report month"]') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["September 2026", "August 2026"]);
    expect(picker.value).toBe("2026-09");

    monthly.mockResolvedValue(report({ month: "2026-08" }));
    await setValue(picker, "2026-08");
    expect(monthly).toHaveBeenLastCalledWith("2026-08");
    expect(text()).toContain("The desk in August 2026");
  });

  it("Refresh the month asks again for the same month", async () => {
    await render();
    const before = monthly.mock.calls.length;
    await click(button("Refresh the month"));
    expect(monthly.mock.calls.length).toBe(before + 1);
    expect(monthly).toHaveBeenLastCalledWith(null);
  });

  it("puts the unsettled count in an attention tile, and the six headline figures", async () => {
    await render();
    for (const words of ["Attendance", "Sessions held", "Students who came", "Did not attend", "Cancelled", "Not settled yet"]) {
      expect(text()).toContain(words);
    }
    expect(text()).toContain("This month's hours that paid nobody");
  });
});

describe("SupportReportPage — the backlog notice", () => {
  it("Show me which filters the history to every unsettled session, all time", async () => {
    await render();
    expect(text()).toContain("3 support sessions have never been settled");
    await click(button("Show me which"));
    const call = lastSessions();
    expect(call.status).toBe("UNSETTLED");
    expect(call.teacher).toBeNull();
    expect(call.from).toBeNull();
    expect(call.to).toBeNull();
  });

  it("an owner's chip filters the history to that teacher's", async () => {
    await render();
    const chip = [...host.querySelectorAll("button")].find((b) => b.title.startsWith("Show Dilafruz Ibrokhimjonova's"));
    await click(chip);
    const call = lastSessions();
    expect(call.status).toBe("UNSETTLED");
    expect(call.teacher).toBe(7);
    expect(text()).toContain("These are the 1 session behind the banner above");
  });
});

describe("SupportReportPage — the history", () => {
  it("filters by teacher, status and dates from the first page, and Clear drops them all", async () => {
    await render();
    expect(text()).toContain("Did not attend");
    // The status pill carries its explanation for a screen reader.
    expect(text()).toContain("The seat was taken and the student did not turn up. It pays nothing.");

    await setValue(filter("Support teacher"), "7");
    expect(lastSessions()).toMatchObject({ teacher: 7, offset: 0, limit: 50 });

    await setValue(filter("Status"), "NO_SHOW");
    expect(lastSessions()).toMatchObject({ teacher: 7, status: "NO_SHOW" });

    await setValue(filter("From"), "2026-09-05");
    expect(lastSessions()).toMatchObject({ from: "2026-09-05", to: "2026-09-30" });
    expect((filter("To") as HTMLInputElement).min).toBe("2026-09-05");

    await click(button("Clear"));
    expect(lastSessions()).toMatchObject({ teacher: null, status: null, from: null, to: null, student: null, offset: 0 });
    expect(button("Clear")).toBeNull();
  });

  it("a student's name filters to that student", async () => {
    await render();
    await click([...host.querySelectorAll("tbody button")].find((b) => b.textContent === "Aziza K"));
    expect(lastSessions().student).toBe(21);
    expect((filter("Student") as HTMLSelectElement).value).toBe("21");
  });

  it("pages Older and Newer by fifty", async () => {
    sessions.mockResolvedValue(history({ count: 120, has_more: true }));
    await render();
    expect((button("Newer") as HTMLButtonElement).disabled).toBe(true);

    await click(button("Older"));
    expect(lastSessions().offset).toBe(50);
    await click(button("Newer"));
    expect(lastSessions().offset).toBe(0);
  });

  it("tells an empty filter apart from a failed request", async () => {
    await render();
    sessions.mockResolvedValue(history({ results: [], count: 0 }));
    await setValue(filter("Status"), "HELD");
    expect(text()).toContain("No sessions match these filters");

    sessions.mockRejectedValue(new Error("boom"));
    await setValue(filter("Status"), "NO_SHOW");
    expect(text()).toContain("Could not load the session history.");
    expect(text()).not.toContain("No sessions match these filters");

    sessions.mockResolvedValue(history());
    await click(button("Try again"));
    expect(text()).toContain("Aziza K");
  });
});
