/**
 * The person page's lazy parts — attendance, results, security, history — each on its own
 * request (`GET /users/admin/people/<id>/<part>/`): what each shows, that an empty one says
 * "Nothing yet", and that a failed one says so instead.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PersonAttendance, PersonHistory, PersonResults, PersonSecurity } from "../personApi";

const get = vi.fn();

vi.mock("@/lib/api", () => ({
  default: { get: (...a: unknown[]) => get(...a) },
}));

const { AttendanceSection } = await import("../sections/AttendanceSection");
const { ResultsSection } = await import("../sections/ResultsSection");
const { SecuritySection } = await import("../sections/SecuritySection");
const { HistorySection } = await import("../sections/HistorySection");

let host: HTMLElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Serves `data` for `/users/admin/people/7/<part>/`. */
function serve(part: string, data: unknown) {
  get.mockImplementation((url: string) =>
    url === `/users/admin/people/7/${part}/` ? Promise.resolve({ data }) : Promise.reject(new Error(`unexpected ${url}`)),
  );
}

async function render(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
}

const text = () => host.textContent ?? "";
const headings = () => [...host.querySelectorAll("h3")].map((h) => h.textContent?.trim());
const headers = () => [...host.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
/** The subsection under heading `title`: the h3 and everything up to the next one. */
function subsection(title: string): string {
  const h = [...host.querySelectorAll("h3")].find((x) => x.textContent?.trim() === title);
  let out = "";
  for (let n = h?.nextElementSibling; n && n.tagName !== "H3"; n = n.nextElementSibling) out += n.textContent ?? "";
  return out;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const EMPTY_RESULTS: PersonResults = {
  homework: [],
  overdue: [],
  assessments: [],
  mocks: [],
  practice: [],
  midterms: [],
  events: [],
  rewards: { xp: 0, coins: 0 },
};

describe("Attendance", () => {
  const DATA: PersonAttendance = {
    classes: [
      { id: 59, name: "Junior G21 Math", active: true, rate: 87.5, present: 6, late: 1, absent: 1, excused: 0, counted: 8 },
      { id: 12, name: "Old class", active: false, rate: null, present: 0, late: 0, absent: 0, excused: 2, counted: 0 },
    ],
    recent: [
      {
        date: "2026-10-14",
        class_id: 59,
        class_name: "Junior G21 Math",
        status: "ABSENT",
        note: "",
        reason: "Kasal",
        lcup_push: "sent",
      },
      {
        date: "2026-10-12",
        class_id: 59,
        class_name: "Junior G21 Math",
        status: "PRESENT",
        note: "on time",
        reason: "",
        lcup_push: null,
      },
    ],
  };

  it("gives each class its rate out of what counts, and the four counts", async () => {
    serve("attendance", DATA);
    await render(<AttendanceSection id={7} />);
    expect(text()).toContain("Junior G21 Math — 87.5% of 8 · present 6 · late 1 · absent 1 · excused 0");
    expect(text()).toContain("Old class (left) — —% of 0");
  });

  it("lists the recent marks with lc-up's reason and whether the register reached lc-up", async () => {
    serve("attendance", DATA);
    await render(<AttendanceSection id={7} />);
    expect(headers()).toEqual(["Date", "Class", "Mark", "Note", "lc-up"]);
    const [absent, present] = [...host.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );
    expect(absent).toEqual(["Oct 14, 2026", "Junior G21 Math", "Absent — Kasal", "—", "Sent"]);
    expect(present).toEqual(["Oct 12, 2026", "Junior G21 Math", "Present", "on time", "—"]);
  });

  it("says Nothing yet only when there is nothing", async () => {
    serve("attendance", { classes: [], recent: [] });
    await render(<AttendanceSection id={7} />);
    expect(text()).toContain("Nothing yet");
  });
});

describe("Results", () => {
  it("lists overdue homework with its class and due date", async () => {
    serve("results", {
      ...EMPTY_RESULTS,
      homework: [{ class_id: 59, class_name: "Junior G21 Math", rate: 50, completed: 1, total: 2 }],
      overdue: [{ id: 3, title: "HW2", class_name: "Junior G21 Math", due_at: "2026-10-10T18:00:00+05:00" }],
      midterms: [{ title: "Midterm 1", score: 74, scale: "SCALE_100", passed: true, at: "2026-10-01T10:00:00+05:00" }],
    });
    await render(<ResultsSection id={7} section="students" />);
    expect(subsection("Overdue homework")).toContain("HW2");
    expect(subsection("Overdue homework")).toContain("Oct 10, 2026");
    expect(subsection("Homework")).toContain("1/2");
    expect(subsection("Midterms")).toContain("74 / 100");
    expect(subsection("Midterms")).toContain("Yes");
  });

  it("says Nothing yet under every empty list, and always the XP line", async () => {
    serve("results", EMPTY_RESULTS);
    await render(<ResultsSection id={7} section="students" />);
    for (const title of [
      "Homework",
      "Overdue homework",
      "Assessments",
      "Mock exams",
      "Practice tests",
      "Midterms",
      "Events",
    ]) {
      expect(subsection(title)).toBe("Nothing yet");
    }
    expect(text()).toContain("XP 0 · Coins 0");
  });

  it("shows a public user only mock exams, practice tests and events", async () => {
    serve("results", { ...EMPTY_RESULTS, rewards: { xp: 120, coins: 15 } });
    await render(<ResultsSection id={7} section="public" />);
    expect(headings()).toEqual(["Mock exams", "Practice tests", "Events"]);
    expect(text()).toContain("XP 120 · Coins 15");
  });
});

describe("Security", () => {
  const DATA: PersonSecurity = {
    sessions: [
      {
        id: 5,
        created_at: "2026-10-01T09:00:00+05:00",
        last_seen_at: null,
        ip: "1.2.3.4",
        device: "Mozilla/5.0 Chrome",
      },
    ],
    telegram_linked: true,
    email_verified: false,
    last_password_change: null,
  };

  it("lists the signed-in devices and the account's security facts", async () => {
    serve("security", DATA);
    await render(<SecuritySection id={7} />);
    expect(headers()).toEqual(["Device", "IP", "Signed in", "Last active"]);
    expect(text()).toContain("Mozilla/5.0 Chrome");
    expect(text()).toContain("1.2.3.4");
    expect(text()).toMatch(/Telegram\s*Linked/);
    expect(text()).toMatch(/Email verified\s*No/);
    expect(text()).toMatch(/Password changed\s*Never/);
  });

  it("says when no device is signed in", async () => {
    serve("security", { ...DATA, sessions: [] });
    await render(<SecuritySection id={7} />);
    expect(text()).toContain("No signed-in devices");
    expect(host.querySelector("table")).toBeNull();
  });
});

describe("History", () => {
  const DATA: PersonHistory = {
    items: [
      { at: "2026-10-01T09:30:00+05:00", kind: "group", title: "Added to Junior G21 Math", by: "" },
      { at: "2026-10-15T14:05:00+05:00", kind: "admin", title: "Frozen by an admin", by: "Bo Ss" },
    ],
    truncated: false,
  };

  it("reads newest first: when, what, and who", async () => {
    serve("history", DATA);
    await render(<HistorySection id={7} />);
    const items = [...host.querySelectorAll("ol > li")].map((li) => li.textContent);
    expect(items).toEqual([
      "Oct 15, 2026 14:05 · Frozen by an admin · by Bo Ss",
      "Oct 1, 2026 09:30 · Added to Junior G21 Math",
    ]);
    expect(text()).toContain("Admin edits are recorded from 15 Oct 2026.");
    expect(text()).not.toContain("Showing the latest 200.");
  });

  it("says when the list is cut", async () => {
    serve("history", { ...DATA, truncated: true });
    await render(<HistorySection id={7} />);
    expect(text()).toContain("Showing the latest 200.");
  });

  it("says a failed load failed — never that there is nothing", async () => {
    get.mockRejectedValue(new Error("boom"));
    await render(<HistorySection id={7} />);
    expect(text()).toContain("Could not load.");
    expect(text()).not.toContain("Nothing yet");
  });

  it("says Nothing yet for an account with no history", async () => {
    serve("history", { items: [], truncated: false });
    await render(<HistorySection id={7} />);
    expect(text()).toContain("Nothing yet");
  });
});
