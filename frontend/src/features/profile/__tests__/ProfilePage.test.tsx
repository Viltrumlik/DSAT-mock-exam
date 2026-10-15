/**
 * The rebuilt profile, as a student uses it: the overview's functions, Payments holding its place,
 * and the settings that save what they say they save.
 *
 * Dates are built from the real clock, so "Catch up" and "Due tomorrow" hold whenever this runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const classes = vi.hoisted(() => ({ list: vi.fn(), myAssignments: vi.fn(), mySchedule: vi.fn(), people: vi.fn() }));
const users = vi.hoisted(() => ({ getMe: vi.fn(), getTelegramWidgetConfig: vi.fn(), listExamDates: vi.fn(), patchMe: vi.fn() }));
const auth = vi.hoisted(() => ({ logout: vi.fn() }));
const profile = vi.hoisted(() => ({
  sessions: vi.fn(),
  signOutDevice: vi.fn(),
  signOutOtherDevices: vi.fn(),
  signOutEverywhere: vi.fn(),
  changePassword: vi.fn(),
}));
const attempts = vi.hoisted(() => ({ getAttempts: vi.fn() }));
const rewards = vi.hoisted(() => ({ me: vi.fn() }));
const finance = vi.hoisted(() => ({ mine: vi.fn() }));
const toast = vi.hoisted(() => ({ push: vi.fn() }));
const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));
const session = vi.hoisted(() => ({ role: "student" }));

vi.mock("@/lib/api", () => ({ authApi: auth, classesApi: classes, usersApi: users }));
vi.mock("@/features/profile/profileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/profile/profileApi")>()),
  profileApi: profile,
}));
vi.mock("@/features/examsStudent/api", () => ({ examsStudentApi: attempts }));
vi.mock("@/features/rewards/rewardsApi", () => ({ rewardsApi: rewards }));
vi.mock("@/features/finance/financeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/finance/financeApi")>()),
  financeApi: finance,
}));
vi.mock("@/hooks/useMe", () => ({ invalidateMe: vi.fn(), useMe: () => ({ me: { role: session.role } }) }));
vi.mock("@/components/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "system", setTheme: theme.setTheme }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));
vi.mock("@/features/notifications/NotificationPreferencesCard", () => ({ NotificationPreferencesCard: () => <p>notification switches</p> }));
vi.mock("@/components/EmailVerificationModal", () => ({ EmailVerificationModal: () => null }));

const { default: ProfilePage } = await import("@/app/(main)/profile/page");

const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const ME = {
  id: 47,
  username: "madina_y",
  first_name: "Madina",
  last_name: "Yusupova",
  email: "madina@example.com",
  email_verified: true,
  phone_number: "",
  telegram_linked: false,
  role: "student",
  sat_exam_date: "2026-11-07",
  target_score: 1400,
  target_english: 690,
  target_math: 710,
  profile_image_url: null,
  last_password_change: "2026-06-02T08:00:00+00:00",
};

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

let host: HTMLDivElement;
let root: Root;

async function flush(until: () => boolean = () => true) {
  for (let i = 0; i < 60; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (until()) return;
  }
  throw new Error("the page never got there");
}

async function renderPage(search = "") {
  window.history.replaceState(null, "", `/profile${search}`);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ProfilePage />
      </QueryClientProvider>,
    ),
  );
  await flush(() => host.querySelector('[role="tab"]') != null);
}

const text = () => host.textContent ?? "";

function button(label: string | RegExp): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? ""),
  );
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await flush();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  users.getMe.mockResolvedValue(ME);
  // Absolute on purpose: check:api-layer forbids a relative API path in a string literal anywhere in src, tests included.
  users.getTelegramWidgetConfig.mockResolvedValue({ enabled: true, bot_username: "Bot", client_id: "1", start_url: "https://mastersat.uz/api/users/telegram/start/" });
  users.listExamDates.mockResolvedValue([
    { id: 9, exam_date: "2026-10-03", label: "October SAT" },
    { id: 10, exam_date: "2026-11-07", label: "November SAT" },
  ]);
  users.patchMe.mockImplementation(async (body: Record<string, unknown>) => ({ ...ME, ...body }));
  classes.list.mockResolvedValue({ items: [], count: 0, next: null, previous: null });
  classes.mySchedule.mockResolvedValue({ from: "", to: "", events: [] });
  classes.people.mockResolvedValue([]);
  classes.myAssignments.mockResolvedValue({
    count: 4,
    items: [
      { id: 1, title: "Transitions", due_at: inDays(1), classroom_id: 34, classroom_name: "English Middle G4", workflow_status: "NOT_STARTED" },
      { id: 2, title: "Words in context", due_at: inDays(-2), classroom_id: 34, classroom_name: "English Middle G4", workflow_status: "RETURNED" },
      { id: 3, title: "Ratios", due_at: inDays(-5), classroom_id: 35, classroom_name: "Math Junior G2", workflow_status: "GRADED" },
      { id: 4, title: "Systems", due_at: inDays(-6), classroom_id: 35, classroom_name: "Math Junior G2", workflow_status: "submitted" },
    ],
  });
  attempts.getAttempts.mockResolvedValue({
    items: [
      { id: 71, is_completed: true, score: 610, submitted_at: inDays(-3), practice_test_details: { subject: "READING_WRITING", title: "Practice Test 4" } },
      { id: 72, is_completed: true, score: 480, submitted_at: inDays(-1), practice_test_details: { subject: "MATH", title: "Midterm 2", mock_exam_id: 5, mock_kind: "MIDTERM" } },
    ],
  });
  rewards.me.mockResolvedValue({ points: 342, coins: 12, xp: 1480, strikes: 4, current_streak: 6, best_streak: 11, history: [] });
  finance.mine.mockReset().mockResolvedValue({
    linked: true,
    balance: -150000,
    debt: 150000,
    updated_at: inDays(0),
    frozen_for_debt: false,
    freeze_day: 6,
    monthly_cost: 500000,
    groups: [{ name: "Math Junior G2", monthly_cost: 500000 }],
    payments: [
      { id: 2, date: "2026-10-07", amount: 500000, kind: "payment", method: "Plastik karta", month: "2026-10", group: "Math Junior G2" },
      { id: 1, date: "2026-09-20", amount: 100000, kind: "refund", method: "Naqd pul", month: "2026-09", group: "Math Junior G2" },
    ],
  });
  profile.sessions.mockResolvedValue([
    { id: 1, created_at: inDays(0), last_seen_at: inDays(0), ip: "84.54.71.12", user_agent: CHROME_WINDOWS, is_current: true },
    { id: 2, created_at: inDays(-1), last_seen_at: inDays(-1), ip: "84.54.90.3", user_agent: SAFARI_IPHONE, is_current: false },
    { id: 3, created_at: inDays(-4), last_seen_at: inDays(-4), ip: "213.230.112.9", user_agent: SAFARI_IPHONE, is_current: false },
  ]);
  profile.signOutOtherDevices.mockResolvedValue({ revoked: 2, keptCurrent: true });
  profile.changePassword.mockResolvedValue({ signedOutDevices: 2, changedAt: new Date().toISOString() });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  session.role = "student";
});

describe("A public learner", () => {
  // Owner, 2026-10-13: a public learner sees mock exams and events; the profile stays usable,
  // as its settings, and nothing of the learning center's is asked for — except their own
  // finished attempts, which the server serves a learner who left (owner, 2026-10-14: "can
  // still see their own past results, read only, in their profile").
  const FINISHED = [
    { id: 81, is_completed: true, score: 640, submitted_at: inDays(-4), practice_test_details: { subject: "MATH", title: "Practice Test 7" } },
    { id: 82, is_completed: true, score: 590, submitted_at: inDays(-2), practice_test_details: { subject: "READING_WRITING", title: "Practice Test 9" } },
  ];

  const tabNames = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() ?? "");
  const tab = (name: string) => [...host.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.trim() === name);

  it("gets Settings and Results, and none of the learning center's other requests", async () => {
    session.role = "public_student";
    await renderPage("?tab=overview");
    // The page's own tabs; the settings sections below are tabs too, and stay.
    const tabs = tabNames();
    expect(tabs.slice(0, 2)).toEqual(["Settings", "Results"]);
    expect(tabs).not.toContain("Overview");
    expect(tabs.some((t) => t.startsWith("Classes"))).toBe(false);
    expect(text()).toContain("Photo, name and phone");
    expect(classes.list).not.toHaveBeenCalled();
    expect(classes.myAssignments).not.toHaveBeenCalled();
    expect(rewards.me).not.toHaveBeenCalled();
    expect(attempts.getAttempts).toHaveBeenCalledTimes(1);
    expect(users.getMe).toHaveBeenCalled();
  });

  it("reads each finished attempt back, linked to its review, and nothing else of the centre's", async () => {
    session.role = "public_student";
    attempts.getAttempts.mockResolvedValue({
      items: [...FINISHED, { id: 83, is_completed: false, score: null, submitted_at: null, practice_test_details: { subject: "MATH", title: "Practice Test 3" } }],
    });
    await renderPage();
    await click(tab("Results")!);
    await flush(() => text().includes("Practice Test 9"));

    expect(text()).toContain("Practice Test 7");
    expect(text()).toContain("Practice Test 9");
    expect(text()).not.toContain("Practice Test 3"); // not finished, so not a result
    const links = [...host.querySelectorAll('a[href^="/review/"]')].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/review/82", "/review/81"]); // newest first
    expect(host.querySelector('a[href="/review/83"]')).toBeNull();
    // Read only: nothing to start or resume, and nothing of the centre's rewards or homework.
    expect(text()).not.toMatch(/start|resume|continue|\bXP\b|points|coins|homework|classes/i);
    expect(host.querySelectorAll('a[href="/practice-tests"], a[href^="/classes"]').length).toBe(0);
    expect(classes.myAssignments).not.toHaveBeenCalled();
    expect(rewards.me).not.toHaveBeenCalled();
  });

  it("says there are no results yet when nothing is finished", async () => {
    session.role = "public_student";
    attempts.getAttempts.mockResolvedValue({ items: [] });
    await renderPage();
    await click(tab("Results")!);
    await flush(() => text().includes("No results yet"));

    expect(text()).toContain("No results yet");
    expect(host.querySelector('a[href^="/review/"]')).toBeNull();
  });

  it("says a failed request failed, never that there are no results", async () => {
    session.role = "public_student";
    attempts.getAttempts.mockRejectedValue(new Error("offline"));
    await renderPage();
    await click(tab("Results")!);
    await flush(() => text().includes("didn't load"));

    expect(text()).toContain("Your results didn't load.");
    expect(text()).not.toContain("No results yet");
  });

  it("opens on Results from the address", async () => {
    session.role = "public_student";
    await renderPage("?tab=results");
    await flush(() => text().includes("Practice Test 4"));

    expect(tab("Results")?.getAttribute("aria-selected")).toBe("true");
  });

  it("asks for the attempts once even when the role arrives after the first render", async () => {
    // A student first, then a public learner: the role the page was drawn with changes under it.
    await renderPage();
    session.role = "public_student";
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ProfilePage />
        </QueryClientProvider>,
      ),
    );
    await flush();

    expect(attempts.getAttempts).toHaveBeenCalledTimes(1);
  });
});

describe("A learning-center student's profile", () => {
  it("keeps results on the Overview, with no Results tab and no second list", async () => {
    await renderPage("?tab=results");
    await flush(() => text().includes("Practice Test 4"));

    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() ?? "");
    expect(tabs[0]).toBe("Overview");
    expect(tabs[1]).toMatch(/^Classes/);
    expect(tabs[2]).toBe("Settings");
    expect(tabs).not.toContain("Results");
    // `?tab=results` is a public learner's address; a student's page stays on the Overview.
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe("Overview");
    expect(host.querySelectorAll('a[href="/review/71"]').length).toBe(1);
    expect(text()).not.toContain("No results yet");
    expect(attempts.getAttempts).toHaveBeenCalledTimes(1);
  });
});

describe("Overview", () => {
  it("turns homework into what to do next, in growth language, and counts what is turned in", async () => {
    await renderPage();
    await flush(() => text().includes("Words in context"));

    // The tile: 2 of 4 turned in, submitted and graded in either case.
    expect(text()).toContain("50%");
    expect(text()).toContain("2 of 4 turned in");
    // The list: the missed piece first, as something to catch up on, then tomorrow's.
    const rows = [...host.querySelectorAll('a[href^="/classes/34/assignments/"]')].map((a) => a.textContent ?? "");
    expect(rows[0]).toContain("Catch up");
    expect(rows[0]).toContain("Words in context");
    expect(rows[1]).toContain("Due tomorrow");
    expect(text()).not.toMatch(/overdue|past due/i);
    expect(text()).not.toContain("Ratios");
  });

  it("says a failed homework request failed, never that there is nothing to do", async () => {
    classes.myAssignments.mockRejectedValue(new Error("offline"));
    await renderPage();
    await flush(() => text().includes("didn't load"));

    expect(text()).toContain("Your homework didn't load.");
    expect(text()).not.toContain("all caught up");
  });

  it("shows the latest results with a way to review them, and leaves midterms to their own page", async () => {
    await renderPage();
    await flush(() => text().includes("Practice Test 4"));

    expect(host.querySelector('a[href="/review/71"]')).not.toBeNull();
    expect(text()).not.toContain("Midterm 2");
  });

  it("shows the student's own debt, monthly price and latest payments from lc-up", async () => {
    await renderPage();
    await flush(() => text().includes("You owe"));
    const payments = host.querySelector('[aria-label="Payments"]')?.textContent ?? "";

    expect(payments).toContain("You owe");
    expect(payments).toContain("150,000 UZS");
    expect(payments).toContain("Payments are due by the 6th of each month");
    expect(payments).toContain("Monthly price");
    expect(payments).toContain("500,000 UZS");
    expect(payments).toContain("Card"); // lc-up's "Plastik karta", in English
    expect(payments).toContain("Refund");
    expect(payments).toContain("−100,000 UZS");
  });

  it("says All paid, with no due-date warning, when nothing is owed", async () => {
    finance.mine.mockResolvedValue({
      linked: true, balance: 0, debt: 0, updated_at: null, frozen_for_debt: false, freeze_day: 6,
      monthly_cost: 500000, groups: [], payments: [],
    });
    await renderPage();
    await flush(() => text().includes("All paid"));
    const payments = host.querySelector('[aria-label="Payments"]')?.textContent ?? "";

    expect(payments).toContain("All paid");
    expect(payments).not.toContain("due by");
    expect(payments).toContain("No payments recorded yet.");
  });

  it("tells an account lc-up does not know that its payments will show once linked", async () => {
    finance.mine.mockResolvedValue({ linked: false });
    await renderPage();
    await flush(() => text().includes("links your account"));

    expect(text()).toContain("Your payments will show here once your learning center links your account.");
  });

  it("shows an error, not an empty state, when the payments do not load", async () => {
    finance.mine.mockRejectedValue(new Error("down"));
    await renderPage();
    await flush(() => text().includes("didn't load"));

    expect(text()).toContain("Your payments didn't load.");
    expect(text()).not.toContain("No payments recorded yet.");
  });

  it("opens the step a checklist item names", async () => {
    await renderPage();
    expect(text()).toContain("Add a profile photo");

    // The photo row's action: "Add" beside "Add a profile photo".
    const row = [...host.querySelectorAll("li")].find((li) => li.textContent?.includes("Add a profile photo"));
    await click(row!.querySelector("button")!);

    expect(text()).toContain("Profile photo");
    expect(window.location.search).toBe("?tab=settings&section=account");
  });
});

describe("Settings", () => {
  it("opens the section the address names", async () => {
    await renderPage("?tab=settings&section=devices");
    await flush(() => text().includes("Chrome on Windows"));

    expect(text()).toContain("This device");
  });

  it("saves the goal as two sections and their total, and leaves an unchanged date alone", async () => {
    await renderPage("?tab=settings&section=goal");
    const english = host.querySelector<HTMLInputElement>("#goal-english")!;

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(english, "720");
      english.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("Save goal"));

    expect(users.patchMe).toHaveBeenCalledWith({ target_english: 720, target_math: 710, target_score: 1430 });
  });

  it("signs out every other device, keeping this one", async () => {
    await renderPage("?tab=settings&section=devices");
    await flush(() => text().includes("Chrome on Windows"));

    await click(button(/Sign out of 2 other devices/));

    expect(profile.signOutOtherDevices).toHaveBeenCalledTimes(1);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(toast.push).toHaveBeenCalledWith({ tone: "success", message: "Signed out on 2 other devices." });
  });

  it("checks the new password twice before it asks the server, then says what changing it did", async () => {
    await renderPage("?tab=settings&section=signin");
    await click(button("Change password"));

    const type = async (id: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await type("pw-current", "Old-pass-26");
    await type("pw-new", "Quiet-Lantern-81");
    await type("pw-confirm", "Quiet-Lantern-18");
    await click(button("Update password"));

    expect(text()).toContain("The two new passwords don't match.");
    expect(profile.changePassword).not.toHaveBeenCalled();

    await type("pw-confirm", "Quiet-Lantern-81");
    await click(button("Update password"));

    expect(profile.changePassword).toHaveBeenCalledWith("Old-pass-26", "Quiet-Lantern-81");
    expect(toast.push).toHaveBeenCalledWith({ tone: "success", message: "Password changed. 2 other devices were signed out." });
  });

  it("switches the theme, including back to following the device", async () => {
    await renderPage("?tab=settings&section=appearance");

    await click(button(/^Dark/));
    await click(button(/^Automatic/));

    expect(theme.setTheme.mock.calls).toEqual([["dark"], ["system"]]);
  });
});
