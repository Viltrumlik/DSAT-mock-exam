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
const toast = vi.hoisted(() => ({ push: vi.fn() }));
const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));

vi.mock("@/lib/api", () => ({ authApi: auth, classesApi: classes, usersApi: users }));
vi.mock("@/features/profile/profileApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/profile/profileApi")>()),
  profileApi: profile,
}));
vi.mock("@/features/examsStudent/api", () => ({ examsStudentApi: attempts }));
vi.mock("@/features/rewards/rewardsApi", () => ({ rewardsApi: rewards }));
vi.mock("@/hooks/useMe", () => ({ invalidateMe: vi.fn() }));
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
  users.getTelegramWidgetConfig.mockResolvedValue({ enabled: true, bot_username: "Bot", client_id: "1", start_url: "/api/users/telegram/start/" });
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

  it("holds Payments' place, coming soon, with no amounts in it", async () => {
    await renderPage();
    const payments = host.querySelector('[aria-label="Payments — coming soon"]');

    expect(payments?.textContent).toContain("Coming soon");
    expect(payments?.textContent).not.toMatch(/\d/);
    expect(payments?.querySelector("a, button")).toBeNull();
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
