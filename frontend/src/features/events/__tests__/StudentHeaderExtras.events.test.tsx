import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The events entry in the top bar.
 *
 * It appears only while something is open for sign-up — a permanent entry would be dead most
 * of the term — and it survives a failed request, because on desktop it is one of only two
 * ways onto /events and vanishing with the network takes the retry with it.
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

let container: HTMLDivElement;
let root: Root;

const hrefs = () =>
  Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));

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
  });

  it("says nothing when there is nothing to sign up for", async () => {
    useUpcomingEvents.mockReturnValue({ data: [event({ can_sign_up: false })], isError: false });
    await render();
    expect(hrefs()).not.toContain("/events");
  });

  it("keeps the way in when the check failed", async () => {
    useUpcomingEvents.mockReturnValue({ data: undefined, isError: true });
    await render();
    expect(hrefs()).toContain("/events");
  });
});
