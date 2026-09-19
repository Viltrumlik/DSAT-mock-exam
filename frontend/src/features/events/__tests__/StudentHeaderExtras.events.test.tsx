import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The events entry in the top bar.
 *
 * It is PERMANENT. It used to be gated on `can_sign_up`, which the server turns false the
 * moment a student takes a seat — so signing up deleted the student's own way back to their
 * ticket, the joining details and the cancel button. The owner reported exactly that and
 * asked for the button to stay. These tests pin the three ways it used to disappear: after a
 * sign-up, with nothing coming up, and on a failed request.
 */

const useMyRewards = vi.fn();
const useOpenSurveys = vi.fn();
const useUpcomingEvents = vi.fn();

vi.mock("@/features/rewards/rewardsHooks", () => ({ useMyRewards: () => useMyRewards() }));
vi.mock("@/features/surveys/surveysHooks", () => ({ useOpenSurveys: () => useOpenSurveys() }));
vi.mock("@/features/events/eventsHooks", () => ({ useUpcomingEvents: () => useUpcomingEvents() }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { StudentHeaderExtras } = await import("@/components/shell/StudentHeaderExtras");

function event(over: Record<string, unknown> = {}) {
  return { id: 3, title: "Robotics open day", can_sign_up: true, seats_left: 12, ...over };
}

/** The same event as a student who has taken a seat sees it: the server drops `can_sign_up`. */
function seatTaken(over: Record<string, unknown> = {}) {
  return event({
    can_sign_up: false,
    my_registration: { id: 9, status: "REGISTERED", ticket_code: "4K297XPD" },
    ...over,
  });
}

let container: HTMLDivElement;
let root: Root;

const hrefs = () =>
  Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
const eventsLink = () => container.querySelector('a[href="/events"]');
const eventsLabel = () => eventsLink()?.getAttribute("aria-label") ?? "";

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<StudentHeaderExtras />));
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useMyRewards.mockReturnValue({ data: { points: 120, coins: 3 } });
  useOpenSurveys.mockReturnValue({ data: [], isError: false });
  useUpcomingEvents.mockReturnValue({ data: [event()], isError: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("StudentHeaderExtras — events", () => {
  it("offers a way to /events while one is open for sign-up", async () => {
    await render();
    expect(hrefs()).toContain("/events");
    expect(eventsLabel()).toContain("Robotics open day");
  });

  it("stays put after the student has signed up, and says so", async () => {
    useUpcomingEvents.mockReturnValue({ data: [seatTaken()], isError: false });
    await render();
    // The regression: this is the screen of a student holding a ticket, and this button is
    // their only desktop route to it.
    expect(hrefs()).toContain("/events");
    expect(eventsLabel()).toContain("you’re signed up for Robotics open day");
  });

  it("stays put when there is nothing coming up at all", async () => {
    useUpcomingEvents.mockReturnValue({ data: [], isError: false });
    await render();
    expect(hrefs()).toContain("/events");
    expect(eventsLabel()).toBe("Events — nothing coming up yet");
  });

  it("keeps the way in when the check failed", async () => {
    useUpcomingEvents.mockReturnValue({ data: undefined, isError: true });
    await render();
    expect(hrefs()).toContain("/events");
    expect(eventsLabel()).toContain("couldn’t check");
  });

  it("counts open sign-ups from one, because a permanent button no longer says it by being there", async () => {
    await render();
    expect(eventsLink()?.textContent).toContain("1");
  });

  it("counts every open one when several are, and ignores the seat already taken", async () => {
    useUpcomingEvents.mockReturnValue({
      data: [event(), event({ id: 4, title: "Math night" }), seatTaken({ id: 5 })],
      isError: false,
    });
    await render();
    expect(eventsLink()?.textContent).toContain("2");
    expect(eventsLabel()).toBe("Events — 2 open for sign-up");
  });

  it("shows no count when nothing is open, rather than a zero", async () => {
    useUpcomingEvents.mockReturnValue({ data: [seatTaken()], isError: false });
    await render();
    // Asserted separately: without it, a button that had vanished would fail this with
    // "undefined is not a string" instead of saying what actually went wrong.
    expect(eventsLink()).not.toBeNull();
    expect(eventsLink()?.textContent).not.toContain("0");
  });
});
