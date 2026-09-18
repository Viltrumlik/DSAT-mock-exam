import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The page a phone camera opens when it scans a ticket.
 *
 * It is used standing at a door with somebody waiting, so every refusal has to say which one
 * it is — "too early" and "they gave the seat back" are different conversations. There is
 * only one button here, Attended: the desk corrects a Missed into an Attended when somebody
 * arrives late, but there is no button back the other way, and none at all once a ticket is
 * already Attended.
 */

const useTicket = vi.fn();
// Calls the mutate options' onSuccess, the way the real mutation does once the server
// answers — needed to prove the check page actually refetches after marking.
const mark = vi.fn((_vars: { id: number; attendance: string }, opts?: { onSuccess?: () => void }) => {
  opts?.onSuccess?.();
});

vi.mock("@/features/events/eventsHooks", () => ({
  useTicket: (code: string) => useTicket(code),
  useMarkAttendance: () => ({ mutate: mark, isPending: false }),
}));

const CheckPage = (await import("@/app/(ops)/ops/events/check/[code]/page")).default;

function ticket(over: Record<string, unknown> = {}) {
  return {
    registration_id: 12,
    ticket_code: "4K29-7XPD",
    student_name: "Anna Karimova",
    status: "REGISTERED",
    attendance: null,
    marked_at: null,
    marked_by_name: "",
    can_mark: true,
    reason: "",
    marking_opens_at: "2026-09-25T13:00:00+05:00",
    event: {
      id: 1, title: "Robotics open day", starts_at: "2026-09-25T15:00:00+05:00",
      ends_at: "2026-09-25T17:00:00+05:00", location: "Fergana city branch, room 3",
      status: "PUBLISHED",
    },
    ...over,
  };
}

function query(over: Record<string, unknown> = {}) {
  return { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...over };
}

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";
const buttonLabelled = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CheckPage params={Promise.resolve({ code: "4K297XPD" })} />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useTicket.mockReturnValue(query({ data: ticket() }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("ops ticket check", () => {
  it("names the student and the event, large enough to read at a door", async () => {
    await render();
    expect(text()).toContain("Anna Karimova");
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("4K29-7XPD");
  });

  it("marks them as attended", async () => {
    await render();
    await act(async () => buttonLabelled("Attended")!.click());
    expect(mark).toHaveBeenCalledWith(
      { id: 12, attendance: "ATTENDED" },
      expect.anything(),
    );
  });

  it("refetches the ticket once marking succeeds", async () => {
    const refetch = vi.fn();
    useTicket.mockReturnValue(query({ data: ticket(), refetch }));
    await render();
    await act(async () => buttonLabelled("Attended")!.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("reports a ticket that has already been marked, and by whom", async () => {
    useTicket.mockReturnValue(
      query({
        data: ticket({
          attendance: "ATTENDED",
          marked_at: "2026-09-25T15:04:00+05:00",
          marked_by_name: "Dilnoza R.",
        }),
      }),
    );
    await render();
    expect(text()).toContain("Attended");
    expect(text()).toContain("Dilnoza R.");
  });

  it("shows no Attended button once a ticket is already marked", async () => {
    useTicket.mockReturnValue(
      query({
        data: ticket({
          attendance: "ATTENDED",
          marked_at: "2026-09-25T15:04:00+05:00",
          marked_by_name: "Dilnoza R.",
        }),
      }),
    );
    await render();
    expect(buttonLabelled("Attended")).toBeUndefined();
  });

  it("says when marking opens rather than offering a button the server refuses", async () => {
    useTicket.mockReturnValue(query({ data: ticket({ can_mark: false, reason: "too_early" }) }));
    await render();
    expect(text()).toContain("You can mark from");
    expect(buttonLabelled("Attended")).toBeUndefined();
  });

  it("says the seat was given back", async () => {
    useTicket.mockReturnValue(
      query({ data: ticket({ can_mark: false, reason: "cancelled", status: "CANCELLED" }) }),
    );
    await render();
    expect(text()).toContain("gave this seat back");
    expect(buttonLabelled("Attended")).toBeUndefined();
  });

  it("says a code it does not know is not a ticket", async () => {
    useTicket.mockReturnValue(query({ isError: true }));
    await render();
    expect(text()).toContain("No ticket with that code");
  });
});
