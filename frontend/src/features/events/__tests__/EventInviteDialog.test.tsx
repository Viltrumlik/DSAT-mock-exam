import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The event invitation a student meets right after signing in.
 *
 * Most of these guard "must not appear", which is the right ratio for anything that takes
 * over the screen: a prompt that keeps asking is one students learn to dismiss without
 * reading, and then the seat goes unfilled anyway.
 */

const useUpcomingEvents = vi.fn();
const useMe = vi.fn();
const signUp = vi.fn();
let pathname = "/";

vi.mock("../eventsHooks", () => ({
  useUpcomingEvents: () => useUpcomingEvents(),
  useSignUpForEvent: () => ({ mutate: signUp, isPending: false }),
}));
vi.mock("@/hooks/useMe", () => ({ useMe: () => useMe() }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

const { EventInviteDialog } = await import("../EventInviteDialog");

function event(over: Record<string, unknown> = {}) {
  return {
    id: 4,
    title: "Robotics open day",
    description: "",
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

let container: HTMLDivElement;
let root: Root;

const text = () => document.body.textContent ?? "";
const buttonLabelled = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<EventInviteDialog />));
}

async function render() {
  await mount();
  await act(async () => {
    vi.advanceTimersByTime(2500);
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  window.sessionStorage.clear();
  pathname = "/";
  useMe.mockReturnValue({ me: { role: "student" } });
  useUpcomingEvents.mockReturnValue({ data: [event()], isError: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  // Defensive: a failed assertion inside "waits while another dialog is on screen" could
  // otherwise leave its manually-appended blocker on <body>, where it would silently gate
  // every later test's dialog closed.
  document.querySelectorAll('[role="dialog"][aria-modal="true"]').forEach((el) => el.remove());
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("EventInviteDialog", () => {
  it("names the event, when it is and how many seats are left", async () => {
    await render();
    expect(text()).toContain("There's an event coming up");
    expect(text()).toContain("Robotics open day");
    expect(text()).toContain("12 seats left");
  });

  it("signs the student up without leaving the page", async () => {
    await render();
    await act(async () => buttonLabelled("Sign up")!.click());
    expect(signUp).toHaveBeenCalledWith(4);
  });

  it("waits before opening, rather than landing with the page", async () => {
    await mount();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(text()).not.toContain("There's an event coming up");
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(text()).toContain("There's an event coming up");
  });

  it("waits while another dialog is on screen", async () => {
    // The survey invitation (or the push opt-in) may already have the screen — a raw node is
    // enough to stand in for it, since the check is a DOM query, not a mock.
    const blocker = document.createElement("div");
    blocker.setAttribute("role", "dialog");
    blocker.setAttribute("aria-modal", "true");
    document.body.appendChild(blocker);

    await mount();
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(text()).not.toContain("There's an event coming up");

    blocker.remove();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(text()).toContain("There's an event coming up");
  });

  it("does not come back after Later, on the next page", async () => {
    await render();
    await act(async () => buttonLabelled("Later")!.click());
    expect(text()).not.toContain("There's an event coming up");

    await act(async () => root.unmount());
    container.remove();
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });

  it("stays away from a student who already has that seat", async () => {
    useUpcomingEvents.mockReturnValue({
      data: [event({ can_sign_up: false, my_registration: { id: 1, status: "REGISTERED", attendance: null, registered_at: "", points_awarded: 0 } })],
      isError: false,
    });
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });

  it("stays away from a full event", async () => {
    useUpcomingEvents.mockReturnValue({ data: [event({ seats_left: 0, can_sign_up: false })], isError: false });
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });

  it("stays away from anyone who is not a student", async () => {
    useMe.mockReturnValue({ me: { role: "admin" } });
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });

  it("stays away on the events page itself", async () => {
    pathname = "/events";
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });

  it("stays away when the check failed", async () => {
    useUpcomingEvents.mockReturnValue({ data: undefined, isError: true });
    await render();
    expect(text()).not.toContain("There's an event coming up");
  });
});

/**
 * The invitation names the event's hour, and that hour is Tashkent's. On a device three hours
 * behind (Europe/Kyiv in November) it used to say 13:00 for a 16:00 event.
 */
describe("EventInviteDialog on a device outside Tashkent", () => {
  /** 16:00 on Monday the 9th in Tashkent — 13:00 on the device. */
  const FOUR_PM = "2026-11-09T16:00:00+05:00";
  /** 01:00 on Tuesday the 10th in Tashkent — still Monday 22:00 on the device. */
  const AFTER_MIDNIGHT = "2026-11-10T01:00:00+05:00";
  let savedTz: string | undefined;

  beforeAll(() => {
    savedTz = process.env.TZ;
    process.env.TZ = "Europe/Kyiv";
  });

  afterAll(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("really is on the other clock — otherwise nothing below proves anything", () => {
    expect(new Date(FOUR_PM).getHours()).toBe(13);
  });

  it("names the event's day and hour by the school's clock", async () => {
    useUpcomingEvents.mockReturnValue({ data: [event({ starts_at: FOUR_PM })], isError: false });
    await render();
    expect(text()).toMatch(/(16:00|04:00\sPM)/);
    expect(text()).not.toMatch(/(13:00|01:00\sPM)/);
  });

  it("names the school's day for an event just after midnight", async () => {
    useUpcomingEvents.mockReturnValue({ data: [event({ starts_at: AFTER_MIDNIGHT })], isError: false });
    await render();
    expect(text()).toMatch(/(Tue, Nov 10|Tue 10 Nov)/);
  });
});
