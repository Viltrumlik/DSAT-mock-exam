import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The student's events page.
 *
 * The states worth protecting are the ones that cost a seat: a full event must not look
 * available, a failed load must not read as "no events", and the cancel button must disappear
 * once the two-hour window has closed rather than offering something the server will refuse.
 */

const useUpcomingEvents = vi.fn();
const useMyEvents = vi.fn();
const signUp = vi.fn();
const cancelSeat = vi.fn();

vi.mock("../eventsHooks", () => ({
  useUpcomingEvents: () => useUpcomingEvents(),
  useMyEvents: () => useMyEvents(),
  useSignUpForEvent: () => ({ mutate: signUp, isPending: false }),
  useCancelEventSeat: () => ({ mutate: cancelSeat, isPending: false }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { EventsPage } = await import("../EventsPage");

type Row = {
  id: number;
  title: string;
  description: string;
  cover_image_url: string | null;
  starts_at: string;
  ends_at: string;
  location: string;
  seats: number;
  seats_left: number;
  status: string;
  my_registration: null | {
    id: number;
    status: string;
    attendance: string | null;
    registered_at: string;
    points_awarded: number;
  };
  can_sign_up: boolean;
  can_cancel: boolean;
};

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    title: "Robotics open day",
    description: "Bring a laptop.",
    cover_image_url: null,
    starts_at: "2026-09-25T15:00:00+05:00",
    ends_at: "2026-09-25T17:00:00+05:00",
    location: "Fergana city branch, room 3",
    seats: 30,
    seats_left: 12,
    status: "PUBLISHED",
    my_registration: null,
    can_sign_up: true,
    can_cancel: false,
    ...over,
  };
}

function query(over: Record<string, unknown> = {}) {
  return { data: undefined, isPending: false, isError: false, refetch: vi.fn(), ...over };
}

let container: HTMLDivElement;
let root: Root;

function text(): string {
  return container.textContent ?? "";
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<EventsPage />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useUpcomingEvents.mockReturnValue(query({ data: [row()] }));
  useMyEvents.mockReturnValue(query({ data: [] }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("EventsPage", () => {
  it("names the event, when it is, where it is and how many seats are left", async () => {
    await render();
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("Fergana city branch, room 3");
    expect(text()).toContain("12 seats left");
  });

  it("signs the student up", async () => {
    await render();
    await act(async () => buttonLabelled("Sign up")!.click());
    expect(signUp).toHaveBeenCalledWith(1);
  });

  it("offers nothing to press on a full event", async () => {
    useUpcomingEvents.mockReturnValue(query({ data: [row({ seats_left: 0, can_sign_up: false })] }));
    await render();
    expect(text()).toContain("Full");
    expect(buttonLabelled("Sign up")).toBeUndefined();
  });

  it("lets a student give the seat back while the window is open", async () => {
    useUpcomingEvents.mockReturnValue(
      query({
        data: [
          row({
            can_sign_up: false,
            can_cancel: true,
            my_registration: {
              id: 5, status: "REGISTERED", attendance: null,
              registered_at: "2026-09-20T10:00:00+05:00", points_awarded: 0,
            },
          }),
        ],
      }),
    );
    await render();
    await act(async () => buttonLabelled("Cancel")!.click());
    expect(cancelSeat).toHaveBeenCalledWith(1);
  });

  it("says why the seat can no longer be given back", async () => {
    useUpcomingEvents.mockReturnValue(
      query({
        data: [
          row({
            can_sign_up: false,
            can_cancel: false,
            my_registration: {
              id: 5, status: "REGISTERED", attendance: null,
              registered_at: "2026-09-20T10:00:00+05:00", points_awarded: 0,
            },
          }),
        ],
      }),
    );
    await render();
    expect(text()).toContain("You're signed up");
    expect(text()).toContain("can't cancel within 2 hours");
    expect(buttonLabelled("Cancel")).toBeUndefined();
  });

  it("shows what a past event paid, and calls a missed one Missed", async () => {
    useMyEvents.mockReturnValue(
      query({
        data: [
          row({
            id: 9, title: "Career talk",
            starts_at: "2026-09-01T10:00:00+05:00", ends_at: "2026-09-01T12:00:00+05:00",
            my_registration: {
              id: 7, status: "REGISTERED", attendance: "ATTENDED",
              registered_at: "2026-09-01T10:00:00+05:00", points_awarded: 10,
            },
          }),
          row({
            id: 10, title: "Study skills workshop",
            starts_at: "2026-09-01T10:00:00+05:00", ends_at: "2026-09-01T12:00:00+05:00",
            my_registration: {
              id: 8, status: "REGISTERED", attendance: "MISSED",
              registered_at: "2026-09-01T10:00:00+05:00", points_awarded: 0,
            },
          }),
        ],
      }),
    );
    await render();
    expect(text()).toContain("Attended");
    expect(text()).toContain("10");
    expect(text()).toContain("Missed");
    // Never the punishing word — see the house copy rule.
    expect(text()).not.toContain("Absent");
  });

  it("says the list failed rather than pretending there is nothing on", async () => {
    useUpcomingEvents.mockReturnValue(query({ isError: true }));
    await render();
    expect(text()).toContain("didn't load");
    expect(text()).not.toContain("Nothing coming up");
  });

  it("shows the empty state only when the list really is empty", async () => {
    useUpcomingEvents.mockReturnValue(query({ data: [] }));
    await render();
    expect(text()).toContain("Nothing coming up");
  });
});
