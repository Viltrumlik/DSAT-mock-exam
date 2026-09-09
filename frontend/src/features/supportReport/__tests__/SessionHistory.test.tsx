/**
 * The history table: the four render branches, and the two facts that only appear here — the
 * topic, and who settled the session.
 *
 * The branch that matters most is the same one as everywhere else on this page: a request that
 * failed must not render as a desk with nothing on it.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportSessionRow, SupportSessionsReport } from "../types";

const sessions = vi.fn();

vi.mock("../api", () => ({
  supportReportApi: {
    sessions: (...args: unknown[]) => sessions(...args),
    monthly: vi.fn(),
  },
  errText: (_e: unknown, fallback: string) => fallback,
}));

import { SessionHistory } from "../SessionHistory";

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
  status: "HELD",
  status_label: "Held",
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

const page = (over: Partial<SupportSessionsReport> = {}): SupportSessionsReport => ({
  results: [row()],
  count: 1,
  limit: 50,
  offset: 0,
  has_more: false,
  statuses: [
    { value: "BOOKED", label: "Booked" },
    { value: "HELD", label: "Held" },
    { value: "NO_SHOW", label: "Did not attend" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "UNSETTLED", label: "Not settled yet" },
  ],
  ...over,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(props: Parameters<typeof SessionHistory>[0] = {}): Promise<string> {
  container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container as HTMLDivElement);
    root.render(<SessionHistory {...props} />);
  });
  return (container as HTMLDivElement).textContent ?? "";
}

beforeEach(() => {
  sessions.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("SessionHistory", () => {
  it("shows who was helped, when, on what, and who settled it", async () => {
    sessions.mockResolvedValue(page());
    const out = await render();

    expect(out).toContain("Aziza K");
    expect(out).toContain("Dilafruz Ibrokhimjonova");
    expect(out).toContain("Math Senior A");
    // The owner asked for the topic by name; it is a column, not a tooltip.
    expect(out).toContain("Quadratic word problems");
    expect(out).toContain("Held");
    expect(out).toContain("1–1 of 1");
  });

  it("renders a past unsettled booking as an action, not as a neutral 'Booked'", async () => {
    sessions.mockResolvedValue(
      page({
        results: [
          row({ status: "BOOKED", status_label: "Booked", settled_by: null, settled_at: null, is_unsettled: true }),
        ],
      }),
    );
    const out = await render();

    expect(out).toContain("Not settled yet");
    // The pill carries its own explanation, readable without a mouse.
    expect(out).toContain("it paid nobody");
  });

  it("never shows a raw enum", async () => {
    sessions.mockResolvedValue(
      page({ results: [row({ status: "NO_SHOW", status_label: "Did not attend" })] }),
    );
    const out = await render();

    expect(out).toContain("Did not attend");
    expect(out).not.toContain("NO_SHOW");
  });

  it("names the person who invited a student into somebody's hour", async () => {
    sessions.mockResolvedValue(
      page({ results: [row({ invited_by_id: 22, invited_by: "Bekzod S" })] }),
    );
    const out = await render();
    expect(out).toContain("Invited by Bekzod S");
  });

  it("says a topic is missing rather than leaving a blank cell", async () => {
    sessions.mockResolvedValue(page({ results: [row({ topic: "" })] }));
    const out = await render();
    expect(out).toContain("No topic given");
  });

  it("renders a failed request as a failure — never as 'no sessions'", async () => {
    sessions.mockRejectedValue(new Error("boom"));
    const out = await render();

    expect(out).toContain("Could not load the support report");
    expect(out).toContain("Nothing here is empty — it is unknown");
    expect(out).not.toContain("No support sessions yet");
    expect(out).not.toContain("No sessions match these filters");
    // The filters survive the failure: they are how a reader gets out of it.
    expect(out).toContain("Support teacher");
    expect(out).toContain("Status");
  });

  it("tells an empty filter apart from an empty history", async () => {
    sessions.mockResolvedValue(page({ results: [], count: 0 }));
    const unfiltered = await render();
    expect(unfiltered).toContain("No support sessions yet");

    act(() => root?.unmount());
    container?.remove();

    // Any filter set → the empty state is about the filter, and offers a way back.
    const filtered = await render({ initialFrom: "2026-09-01", initialTo: "2026-09-30" });
    expect(filtered).toContain("No sessions match these filters");
    expect(filtered).toContain("clear the filters");
  });

  it("passes the inclusive date range straight through to the endpoint", async () => {
    sessions.mockResolvedValue(page());
    await render({ initialFrom: "2026-09-01", initialTo: "2026-09-30" });

    const call = sessions.mock.calls[0][0];
    expect(call.from).toBe("2026-09-01");
    expect(call.to).toBe("2026-09-30");
    expect(call.limit).toBe(50);
  });

  /**
   * The banner's "show me which". `UNSETTLED` is a pseudo-status the backend accepts precisely
   * so this click cannot mix next week's appointments into August's unfinished hours.
   */
  it("applies the backlog banner's request, dropping the month's date range", async () => {
    sessions.mockResolvedValue(page());
    await render({
      initialFrom: "2026-09-01",
      initialTo: "2026-09-30",
      request: { teacher: 7, status: "UNSETTLED", nonce: 1 },
    });

    const last = sessions.mock.calls[sessions.mock.calls.length - 1][0];
    expect(last.status).toBe("UNSETTLED");
    expect(last.teacher).toBe(7);
    // The backlog is all time; a September range would hide most of it.
    expect(last.from).toBeNull();
    expect(last.to).toBeNull();
  });
});
