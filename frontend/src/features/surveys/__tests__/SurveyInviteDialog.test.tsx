import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * The survey invitation a student meets after signing in.
 *
 * Most of these tests guard "must not appear", and that is the right ratio for anything that
 * takes over the screen. The learning center wants replies, so the temptation is a prompt that
 * keeps asking — and a prompt that keeps asking is one students learn to dismiss without
 * reading, which costs the very replies it was added to collect. The three properties worth
 * protecting are: it names the survey's OWN price rather than the old flat 40, it does not
 * come back once it has been answered for this sign-in, and it stays out of the way of anyone
 * it was not written for.
 */

const useOpenSurveys = vi.fn();
const useMe = vi.fn();
let pathname = "/";

vi.mock("../surveysHooks", () => ({
  useOpenSurveys: () => useOpenSurveys(),
}));

vi.mock("@/hooks/useMe", () => ({
  useMe: () => useMe(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const { SurveyInviteDialog } = await import("../SurveyInviteDialog");

type Brief = {
  id: number;
  title: string;
  description: string;
  closes_at: string | null;
  question_count: number;
  allow_anonymous: boolean;
  image_url: string | null;
  points_award: number;
};

function survey(over: Partial<Brief> = {}): Brief {
  return {
    id: 7,
    title: "How is this term going?",
    description: "",
    closes_at: null,
    question_count: 6,
    allow_anonymous: true,
    image_url: null,
    points_award: 40,
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;

/** The dialog portals to document.body, so assertions read the whole document, not the host. */
function text(): string {
  return document.body.textContent ?? "";
}

function linkLabelled(label: string): HTMLAnchorElement | undefined {
  return Array.from(document.body.querySelectorAll("a")).find(
    (a) => a.textContent?.trim() === label,
  );
}

function buttonLabelled(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<SurveyInviteDialog />));
}

async function render() {
  await mount();
  // The dialog waits before opening so that it does not land in the same frame as the
  // dashboard. Every assertion below is about the state AFTER that wait, so run the timer out
  // here rather than in each test.
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  pathname = "/";
  useMe.mockReturnValue({ me: { role: "student" } });
  useOpenSurveys.mockReturnValue({ data: [survey()], isError: false });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SurveyInviteDialog", () => {
  it("names the survey and what finishing it pays", async () => {
    await render();
    expect(text()).toContain("You have a survey waiting");
    expect(text()).toContain("How is this term going?");
    expect(text()).toContain("40");
    expect(text()).toContain("points");
  });

  it("waits before opening, rather than landing with the page", async () => {
    // Asserting at 500ms, not at 0ms: a `setTimeout(…, 0)` is still a macrotask and so is
    // still closed on the first paint, which would make a 0ms check pass whatever the delay
    // was set to. This one fails if the constant is lowered.
    await mount();
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(text()).not.toContain("You have a survey waiting");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(text()).toContain("You have a survey waiting");
  });

  it("quotes the survey's own price, not the flat 40 surveys used to pay", async () => {
    // The regression this guards is a sentence with the number written into it. Surveys have
    // been priced per survey since the learning center found a one-question pulse and a
    // thirty-question evaluation both paying 40 — a prompt promising 40 while the ledger pays
    // 10 is worse than one that mentions no number at all.
    useOpenSurveys.mockReturnValue({ data: [survey({ points_award: 10 })], isError: false });
    await render();
    expect(text()).toContain("10");
    expect(text()).not.toContain("40");
  });

  it("promises nothing when the survey pays nothing", async () => {
    // 0 is a legitimate price and means exactly that: a purely administrative form. The prompt
    // still invites, it just does not invent an earning.
    useOpenSurveys.mockReturnValue({ data: [survey({ points_award: 0 })], isError: false });
    await render();
    expect(text()).toContain("You have a survey waiting");
    expect(text()).not.toContain("earns you");
  });

  it("sends a lone survey straight to its form, and several to the list", async () => {
    await render();
    expect(linkLabelled("Take the survey")?.getAttribute("href")).toBe("/surveys/7");

    await act(async () => root.unmount());
    container.remove();
    window.sessionStorage.clear();
    useOpenSurveys.mockReturnValue({
      data: [survey(), survey({ id: 9, title: "Second one" })],
      isError: false,
    });
    await render();
    expect(linkLabelled("Take the survey")?.getAttribute("href")).toBe("/surveys");
  });

  it("does not come back after Maybe later, on the next page", async () => {
    // The dialog is mounted in the shell, which survives client-side navigation but re-mounts
    // on a full page load. Component state alone would forget the dismissal on the next
    // reload and ask again — which is how a prompt turns into a nag.
    await render();
    const later = buttonLabelled("Maybe later");
    expect(later).toBeTruthy();
    await act(async () => later!.click());
    expect(text()).not.toContain("You have a survey waiting");

    await act(async () => root.unmount());
    container.remove();
    await render();
    expect(text()).not.toContain("You have a survey waiting");
  });

  it("stays away from anyone who is not a student", async () => {
    // A survey aimed at "everyone" is listed for staff too, and the top-bar button reflects
    // that. A modal is different: it stops the work of an admin the form was not written for.
    useMe.mockReturnValue({ me: { role: "teacher" } });
    await render();
    expect(text()).not.toContain("You have a survey waiting");
  });

  it("stays away on the surveys pages themselves", async () => {
    pathname = "/surveys/7";
    await render();
    expect(text()).not.toContain("You have a survey waiting");
  });

  it("stays away when the check for surveys failed", async () => {
    // The top-bar prompt deliberately survives an error — it is the only desktop route to
    // /surveys, so it must not vanish with the network. A modal has no such duty, and it
    // cannot honestly name a survey it failed to fetch.
    useOpenSurveys.mockReturnValue({ data: undefined, isError: true });
    await render();
    expect(text()).not.toContain("You have a survey waiting");
  });

  it("stays away when there is nothing waiting", async () => {
    useOpenSurveys.mockReturnValue({ data: [], isError: false });
    await render();
    expect(text()).not.toContain("You have a survey waiting");
  });
});
