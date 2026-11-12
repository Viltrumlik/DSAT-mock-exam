/**
 * /ops/events/check/<code> in the console's look: the ticket's name and event, the one Attended button with the
 * same call, and the sentence that stands in for it when it cannot be pressed.
 */
import { act, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useTicket = vi.fn();
const mark = vi.fn();

vi.mock("@/features/events/eventsHooks", () => ({
  useTicket: (code: string) => useTicket(code),
  useMarkAttendance: () => ({ mutate: mark, isPending: false }),
}));

const { default: Page } = await import("../page");

function ticket(over: Record<string, unknown> = {}) {
  return {
    registration_id: 31, ticket_code: "4K29-7XPD", student_name: "Ali Valiyev",
    event: { id: 5, title: "Open day", location: "Chilonzor" },
    attendance: null, marked_at: null, marked_by_name: "", can_mark: true, reason: null,
    marking_opens_at: null,
    ...over,
  };
}

let host: HTMLElement;
let root: Root;
const refetch = vi.fn();

async function render() {
  const params = Promise.resolve({ code: "4K297XPD" });
  await act(async () => {
    root.render(
      <Suspense fallback={null}>
        <Page params={params} />
      </Suspense>,
    );
  });
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}
const buttonIn = (el: ParentNode, words: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === words);

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useTicket.mockReset();
  mark.mockReset();
  refetch.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the ticket check", () => {
  it("shows the ticket and marks it Attended with the same call", async () => {
    mark.mockImplementation((_vars: unknown, opts: { onSuccess: () => void }) => opts.onSuccess());
    useTicket.mockReturnValue({ data: ticket(), isPending: false, isError: false, refetch });
    await render();
    expect(useTicket).toHaveBeenCalledWith("4K297XPD");
    expect(host.querySelector("h1")!.textContent).toBe("Ticket");
    expect(host.textContent).toContain("4K29-7XPD");
    expect(host.querySelector("h2")!.textContent).toBe("Ali Valiyev");
    expect(host.textContent).toContain("Open day · Chilonzor");
    await act(async () => buttonIn(host, "Attended")!.click());
    expect(mark.mock.calls[0][0]).toEqual({ id: 31, attendance: "ATTENDED" });
    expect(refetch).toHaveBeenCalled();
  });

  it("shows no button on a ticket already marked Attended, and keeps it for a Missed one", async () => {
    useTicket.mockReturnValue({
      data: ticket({ attendance: "ATTENDED", marked_at: "2026-11-12T10:05:00Z", marked_by_name: "Aziza" }),
      isPending: false, isError: false, refetch,
    });
    await render();
    expect(host.textContent).toContain("Attended · marked");
    expect(host.textContent).toContain("by Aziza");
    expect(buttonIn(host, "Attended")).toBeUndefined();

    useTicket.mockReturnValue({ data: ticket({ attendance: "MISSED" }), isPending: false, isError: false, refetch });
    await render();
    expect(host.textContent).toContain("Missed");
    expect(buttonIn(host, "Attended")).toBeDefined();
  });

  it("says why it cannot be marked", async () => {
    useTicket.mockReturnValue({ data: ticket({ can_mark: false, reason: "cancelled" }), isPending: false, isError: false, refetch });
    await render();
    expect(host.textContent).toContain("This student gave this seat back, so there is nothing to mark.");

    useTicket.mockReturnValue({ data: ticket({ can_mark: false, reason: "event_cancelled" }), isPending: false, isError: false, refetch });
    await render();
    expect(host.textContent).toContain("This event was called off.");

    useTicket.mockReturnValue({
      data: ticket({ can_mark: false, reason: "too_early", marking_opens_at: "2026-11-20T09:30:00Z" }),
      isPending: false, isError: false, refetch,
    });
    await render();
    expect(host.textContent).toContain("You can mark from");
  });

  it("says plainly when there is no such ticket, and while it reads one", async () => {
    useTicket.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch });
    await render();
    expect(host.textContent).toContain("Reading the ticket…");

    useTicket.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    await render();
    expect(host.textContent).toContain("No ticket with that code. Find the student by name in the list instead.");
  });
});
