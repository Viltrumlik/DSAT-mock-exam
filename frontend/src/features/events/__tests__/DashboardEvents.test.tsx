import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The nearest event, on the dashboard.
 *
 * It hides itself when there is nothing on — an empty band on every student's screen is worse
 * than no band — but a FAILED load is not nothing, and must not render as it.
 */

const useUpcomingEvents = vi.fn();
const signUp = vi.fn();

vi.mock("@/features/events/eventsHooks", () => ({
  useUpcomingEvents: () => useUpcomingEvents(),
  useSignUpForEvent: () => ({ mutate: signUp, isPending: false }),
}));

const { DashboardEvents } = await import("../../dashboard/DashboardEvents");

function event(over: Record<string, unknown> = {}) {
  return {
    id: 2,
    title: "Robotics open day",
    starts_at: "2026-09-25T15:00:00+05:00",
    ends_at: "2026-09-25T17:00:00+05:00",
    location: "Fergana city branch, room 3",
    seats: 30,
    seats_left: 12,
    my_registration: null,
    can_sign_up: true,
    can_cancel: false,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<DashboardEvents />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useUpcomingEvents.mockReturnValue({ data: [event()], isPending: false, isError: false, refetch: vi.fn() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("DashboardEvents", () => {
  it("shows the nearest event with its seats and a way in", async () => {
    await render();
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("12 seats left");
    expect(text()).toContain("Sign up");
  });

  it("says so when the student already has the seat", async () => {
    useUpcomingEvents.mockReturnValue({
      data: [event({ can_sign_up: false, my_registration: { id: 1, status: "REGISTERED", attendance: null, registered_at: "", points_awarded: 0 } })],
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(text()).toContain("You're signed up");
    expect(text()).not.toContain("Sign up ");
  });

  it("reads Full when it is", async () => {
    useUpcomingEvents.mockReturnValue({
      data: [event({ seats_left: 0, can_sign_up: false })],
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(text()).toContain("Full");
  });

  it("renders nothing at all when there is nothing on", async () => {
    useUpcomingEvents.mockReturnValue({ data: [], isPending: false, isError: false, refetch: vi.fn() });
    await render();
    expect(text()).toBe("");
  });

  it("renders nothing while it is loading", async () => {
    useUpcomingEvents.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: vi.fn() });
    await render();
    expect(text()).toBe("");
  });

  it("says a failed load failed, quietly", async () => {
    useUpcomingEvents.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render();
    expect(text()).toContain("didn't load");
    expect(text()).toContain("Try again");
  });
});
