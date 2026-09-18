import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The ops console's events page.
 *
 * Two properties are worth the test: publishing asks first — it mails every student in the
 * learning center and cannot be undone — and marking is only offered once the door is open,
 * so the desk is not handed a button the server will refuse.
 */

const useAdminEvents = vi.fn();
const useEventRegistrations = vi.fn();
const publish = vi.fn();
const mark = vi.fn();
const confirmSpy = vi.fn();

vi.mock("@/features/events/eventsHooks", () => ({
  useAdminEvents: () => useAdminEvents(),
  useEventRegistrations: (id: number) => useEventRegistrations(id),
  useSaveEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvent: () => ({ mutate: vi.fn(), isPending: false }),
  usePublishEvent: () => ({ mutate: publish, isPending: false }),
  useCancelEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAttendance: () => ({ mutate: mark, isPending: false }),
}));

const OpsEventsPage = (await import("@/app/(ops)/ops/events/page")).default;

function event(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Robotics open day",
    description: "",
    cover_image_url: null,
    starts_at: "2026-09-25T15:00:00+05:00",
    ends_at: "2026-09-25T17:00:00+05:00",
    location: "Fergana city branch, room 3",
    seats: 30,
    seats_left: 18,
    status: "DRAFT",
    my_registration: null,
    can_sign_up: false,
    can_cancel: false,
    ...over,
  };
}

function registration(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    student: 5,
    student_name: "Aziza Karimova",
    phone: "+998901234567",
    status: "REGISTERED",
    registered_at: "2026-09-20T10:00:00+05:00",
    attendance: null,
    marked_at: null,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => document.body.textContent ?? "";
const buttonLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<OpsEventsPage />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm", confirmSpy);
  useAdminEvents.mockReturnValue({ data: [event()], isPending: false, isError: false, refetch: vi.fn() });
  useEventRegistrations.mockReturnValue({
    data: { registrations: [], counts: { registered: 0, attended: 0, missed: 0, not_marked: 0, cancelled: 0 }, marking_opens_at: "2026-09-25T13:00:00+05:00" },
    isPending: false, isError: false, refetch: vi.fn(),
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("OpsEventsPage", () => {
  it("lists the events with their state and how many seats are taken", async () => {
    await render();
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("12/30");
    expect(text()).toContain("Draft");
  });

  it("asks before publishing, because publishing is the send", async () => {
    await render();
    await act(async () => buttonLabelled("Publish")!.click());
    expect(confirmSpy).toHaveBeenCalled();
    expect(String(confirmSpy.mock.calls[0][0])).toContain("email every student");
    expect(publish).toHaveBeenCalledWith(1);
  });

  it("publishes nothing when the confirmation is declined", async () => {
    confirmSpy.mockReturnValue(false);
    await render();
    await act(async () => buttonLabelled("Publish")!.click());
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not offer Publish on an event that is already published", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ status: "PUBLISHED" })], isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    expect(buttonLabelled("Publish")).toBeUndefined();
  });

  it("says the list failed rather than showing an empty console", async () => {
    useAdminEvents.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render();
    expect(text()).toContain("didn't load");
    expect(text()).not.toContain("No events yet");
  });

  it("disables Attended and Missed before the marking window opens", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ status: "PUBLISHED" })], isPending: false, isError: false, refetch: vi.fn(),
    });
    useEventRegistrations.mockReturnValue({
      data: {
        registrations: [registration()],
        counts: { registered: 1, attended: 0, missed: 0, not_marked: 1, cancelled: 0 },
        // An hour from now — the desk is not handed a button the server would refuse.
        marking_opens_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => buttonLabelled("Who came")!.click());
    expect((buttonLabelled("Attended") as HTMLButtonElement).disabled).toBe(true);
    expect((buttonLabelled("Missed") as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables marking once the door is open, and Attended calls the mutation", async () => {
    useAdminEvents.mockReturnValue({
      data: [event({ status: "PUBLISHED" })], isPending: false, isError: false, refetch: vi.fn(),
    });
    useEventRegistrations.mockReturnValue({
      data: {
        registrations: [registration()],
        counts: { registered: 1, attended: 0, missed: 0, not_marked: 1, cancelled: 0 },
        // An hour ago — the window is open.
        marking_opens_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      isPending: false, isError: false, refetch: vi.fn(),
    });
    await render();
    await act(async () => buttonLabelled("Who came")!.click());
    const attended = buttonLabelled("Attended") as HTMLButtonElement;
    expect(attended.disabled).toBe(false);
    await act(async () => attended.click());
    expect(mark).toHaveBeenCalledWith({ id: 9, attendance: "ATTENDED" });
  });
});
