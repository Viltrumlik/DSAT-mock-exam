/**
 * The support desk, from behind it — and the one thing the old page never did.
 *
 * The load-bearing test here is the first block: an hour that has ENDED and is still BOOKED
 * has to be surfaced as work owed to the teacher, and has to be one press from settled. On
 * production 39 of them had accumulated since 13 August, paying nobody, because a diary in
 * date order never said so.
 *
 * The rest is the contract the rebuild must not break: every capability the old page had still
 * has a control, a failed load says it failed and is NEVER drawn as an empty diary, and
 * withdrawing an hour — which cancels the bookings on it — still asks first.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportBooking, SupportTeacherCalendar, SupportTeacherHour } from "@/lib/api";

const hooks = {
  useMySupportCalendar: vi.fn(),
  useSupportDiary: vi.fn(),
  useSetSupportHour: vi.fn(),
  useSettleBooking: vi.fn(),
};

vi.mock("../supportHooks", () => ({
  useMySupportCalendar: () => hooks.useMySupportCalendar(),
  useSupportDiary: () => hooks.useSupportDiary(),
  useSetSupportHour: () => hooks.useSetSupportHour(),
  useSettleBooking: () => hooks.useSettleBooking(),
}));

const { SupportTeacherPage } = await import("../SupportTeacherPage");

/* ── fixtures ─────────────────────────────────────────────────────────────────────────── */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();
const ago = (ms: number) => new Date(now - ms).toISOString();
const ahead = (ms: number) => new Date(now + ms).toISOString();

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function hour(over: Partial<SupportTeacherHour> & { starts_at: string }): SupportTeacherHour {
  return {
    ends_at: new Date(new Date(over.starts_at).getTime() + HOUR).toISOString(),
    state: "open", capacity: 1, seats_left: 1, note: "", availability_id: null, bookings: [],
    ...over,
  };
}

/** Every fixture hour sits on day 0, which is the day the grid opens on. */
const CALENDAR: SupportTeacherCalendar = {
  days: 4, open_hour: 8, close_hour: 18,
  free_hours: 7, booked_sessions: 2, awaiting_settle: 2,
  ratings: { average: 4.5, count: 6 },
  dates: [localDate(now), localDate(now + DAY)],
  days_out: [
    {
      date: localDate(now),
      hours: [
        hour({ starts_at: ahead(2 * HOUR), state: "open" }),
        hour({ starts_at: ahead(3 * HOUR), state: "closed" }),
        hour({ starts_at: ago(6 * HOUR), state: "past" }),
        hour({ starts_at: ago(7 * HOUR), state: "off" }),
        hour({
          starts_at: ago(5 * HOUR),
          state: "booked",
          bookings: [{
            id: 1, status: "BOOKED", topic: "Inference questions", student: "Aziza",
            student_id: 1, classroom_name: "SAT English · Group 4", rating: null,
          }],
        }),
        // THE HOUR THAT IS HAPPENING NOW: started 20 minutes ago, ends in 40. Booked, and
        // nothing has been recorded on it — because the teacher is in the room teaching it.
        // The one fixture that tells `ends_at` and `starts_at` apart; without it the whole
        // suite passes with the overdue test moved to the start of the hour, and this is the
        // teacher the brief names — asked to close a session while the student is sitting
        // there. No topic on it, so the Info cue below stays a test of one chip.
        hour({
          starts_at: ago(20 * MINUTE),
          state: "booked",
          bookings: [{
            id: 7, status: "BOOKED", topic: "", student: "Shahrizoda",
            student_id: 7, classroom_name: "SAT Math · Group 2", rating: null,
          }],
        }),
      ],
    },
    { date: localDate(now + DAY), hours: [hour({ starts_at: ahead(DAY), state: "open" })] },
  ],
};

function booking(over: Partial<SupportBooking> & { id: number }): SupportBooking {
  const starts = over.slot?.starts_at ?? ago(5 * HOUR);
  return {
    status: "BOOKED", topic: "", booked_at: ago(40 * DAY), settled_at: null,
    classroom_id: 34, classroom_name: "SAT English · Group 4",
    student_id: 1, student: "Aziza",
    invited_by_id: null, invited_by: null,
    cancel_reason: "", cancelled_at: null,
    rating: null, rating_comment: "", rated_at: null,
    teacher_note: "",
    ...over,
    slot: {
      id: 900 + over.id, support_teacher_id: 9, support_teacher: "Dilafruz Karimova",
      starts_at: starts, ends_at: new Date(new Date(starts).getTime() + HOUR).toISOString(),
      capacity: 1, note: "", is_cancelled: false,
      ...over.slot,
    },
  };
}

/** The whole spread: owed, upcoming, held, missed, and a seat given back. */
const DIARY: SupportBooking[] = [
  // Owed since long before anyone noticed — the oldest, and the one the banner reports.
  booking({ id: 1, topic: "Inference questions", slot: { starts_at: ago(43 * DAY) } as never }),
  booking({ id: 2, slot: { starts_at: ago(5 * HOUR) } as never, student: "Nodir" }),
  booking({
    id: 3, student: "Madina", slot: { starts_at: ahead(2 * DAY) } as never,
    invited_by: "Aziza", invited_by_id: 1, topic: "Linear equations",
  }),
  booking({
    id: 4, status: "HELD", student: "Kamola", slot: { starts_at: ago(9 * DAY) } as never,
    teacher_note: "Went through inference questions", rating: 5,
    rating_comment: "Explained it three ways until it clicked",
  }),
  booking({ id: 5, status: "NO_SHOW", student: "Jasur", slot: { starts_at: ago(11 * DAY) } as never }),
  booking({
    id: 6, status: "CANCELLED", student: "Sardor", slot: { starts_at: ago(3 * DAY) } as never,
    cancel_reason: "Clashed with a midterm", cancelled_at: ago(4 * DAY),
  }),
  // Started 20 minutes ago and still running — the same hour as the calendar chip above. It
  // has a start time in the past and no outcome, exactly like the two owed rows, and it is
  // owed nothing at all. Every other slot here is days away on one side or the other.
  booking({ id: 7, student: "Shahrizoda", slot: { starts_at: ago(20 * MINUTE) } as never }),
];

const loaded = (data: unknown) => ({
  data, isPending: false, isError: false, isSuccess: true, error: null, refetch: vi.fn(),
});
const failed = (error: unknown = null) => ({
  data: undefined, isPending: false, isError: true, isSuccess: false, error, refetch: vi.fn(),
});
const pending = () => ({
  data: undefined, isPending: true, isError: false, isSuccess: false, error: null, refetch: vi.fn(),
});
const mutation = () => ({
  mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false,
  error: null, variables: undefined, reset: vi.fn(),
});

/* ── harness ──────────────────────────────────────────────────────────────────────────── */

let host: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(<SupportTeacherPage />));
}

async function click(el: Element | null | undefined) {
  await act(async () => (el as HTMLElement | null)?.click());
}

const buttons = (scope: ParentNode = document.body) => Array.from(scope.querySelectorAll("button"));
const buttonNamed = (text: string, scope: ParentNode = document.body) =>
  buttons(scope).find((b) => b.textContent?.trim() === text);
const buttonContaining = (text: string, scope: ParentNode = document.body) =>
  buttons(scope).find((b) => b.textContent?.includes(text));

/** The page opens on the backlog, so the rest of the diary is behind this. */
const showEverything = () => click(buttonContaining("Everything"));

/** A diary row, by whose session it is. Scoped to the list: the week grid names people too. */
const rowFor = (name: string) =>
  Array.from(host.querySelectorAll("li")).find((el) => el.textContent?.includes(name));

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  hooks.useMySupportCalendar.mockReturnValue(loaded(CALENDAR));
  hooks.useSupportDiary.mockReturnValue(loaded(DIARY));
  hooks.useSetSupportHour.mockReturnValue(mutation());
  hooks.useSettleBooking.mockReturnValue(mutation());
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

/* ── the backlog ──────────────────────────────────────────────────────────────────────── */

describe("the hours nobody closed", () => {
  it("says how many have been taught and never recorded, and what they cost", async () => {
    await render();

    const banner = host.querySelector('[role="alert"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toContain("2 sessions");
    expect(banner?.textContent).toContain("still waiting to be recorded");
    // The finding is the cost, not the count.
    expect(banner?.textContent).toContain("paid nobody");
    expect(banner?.textContent).toContain("not the student, and not you");
    // Not a telling-off: the platform never asked.
    expect(banner?.textContent).toContain("Nothing asked you for them until now");
  });

  it("reports the age of the oldest, so nobody has to do the subtraction", async () => {
    await render();

    const banner = host.querySelector('[role="alert"]');
    expect(banner?.textContent).toContain("The oldest has been waiting since");
    // 43 days, which is the real gap between 13 August and the day this was written.
    expect(banner?.textContent).toContain("6 weeks ago");
  });

  it("opens the list on them rather than burying them in date order", async () => {
    await render();

    const waiting = buttonContaining("Waiting for you");
    expect(waiting?.getAttribute("aria-pressed")).toBe("true");
    // Only the two owed hours are on screen; the upcoming and recorded ones are not.
    expect(host.textContent).toContain("Nodir");
    expect(host.textContent).not.toContain("Madina");
    expect(host.textContent).not.toContain("Kamola");
  });

  it("keeps that selected filter readable — never white on the amber tone", async () => {
    await render();

    // This tab is selected by default whenever there is a backlog, so its label is the one
    // piece of text on the screen this page exists for. White on `--dz-amber` measured
    // 2.3:1 in light and 1.7:1 in dark at 13px bold; white on indigo is the kit's own
    // solid-fill pairing and is what every other selected tab already uses.
    const style = buttonContaining("Waiting for you")?.getAttribute("style") ?? "";
    expect(style).toContain("var(--dz-indigo)");
    expect(style).not.toContain("--dz-amber");
  });

  it("marks the hour in the teacher's own week too, not only in the list", async () => {
    await render();

    expect(host.textContent).toContain("Needs recording");
    // Exactly the one hour that has ENDED. Day 0 holds two booked hours and the other is
    // still running, so a marker counted from the start of the hour would print two.
    expect((host.textContent?.match(/Needs recording/g) ?? []).length).toBe(1);
    expect(host.textContent).toContain("Shahrizoda");
  });

  it("leaves a session that is still in its own hour alone — it is being taught", async () => {
    await render();

    // Three rows are BOOKED with a start time in the past; only two of those HOURS are over.
    const banner = host.querySelector('[role="alert"]');
    expect(banner?.textContent).toContain("2 sessions");
    expect(rowFor("Shahrizoda")).toBeUndefined();

    // And the page does not split against itself: wherever that row appears it reads the
    // same. A predicate that fired at the start of the hour would count it in the banner
    // above while its own chip still called it Booked.
    await click(buttonContaining("Coming up"));
    const row = rowFor("Shahrizoda");
    expect(row?.textContent).toContain("Booked");
    expect(row?.textContent).not.toContain("Waiting for you");
  });

  it("never claims nothing is owed when the diary failed to load", async () => {
    hooks.useSupportDiary.mockReturnValue(failed());
    await render();

    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain("waiting to be recorded");
    expect(host.textContent).not.toContain("still waiting to be recorded");
  });
});

describe("settling one", () => {
  it("sends HELD with the teacher's note", async () => {
    const settle = mutation();
    hooks.useSettleBooking.mockReturnValue(settle);
    await render();

    const note = host.querySelector<HTMLInputElement>('[aria-label="What the session with Aziza covered"]');
    expect(note).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(note, "Inference questions, two past papers");
      note!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await click(buttonNamed("They came"));

    expect(settle.mutate).toHaveBeenCalledWith({
      bookingId: 1,
      status: "HELD",
      teacherNote: "Inference questions, two past papers",
    });
  });

  it("sends NO_SHOW when the student did not attend", async () => {
    const settle = mutation();
    hooks.useSettleBooking.mockReturnValue(settle);
    await render();

    await click(buttonNamed("Did not attend"));

    expect(settle.mutate).toHaveBeenCalledWith({
      bookingId: 1,
      status: "NO_SHOW",
      teacherNote: "",
    });
  });

  it("is one press: the note is optional", async () => {
    const settle = mutation();
    hooks.useSettleBooking.mockReturnValue(settle);
    await render();

    await click(buttonNamed("They came"));

    expect(settle.mutate).toHaveBeenCalledTimes(1);
    expect(settle.mutate.mock.calls[0][0]).toMatchObject({ status: "HELD" });
  });

  it("says so when the outcome did not reach the server", async () => {
    hooks.useSettleBooking.mockReturnValue({
      ...mutation(),
      isError: true,
      error: { response: { data: { detail: "That booking is already settled." } } },
    });
    await render();

    expect(host.textContent).toContain("That session wasn't recorded");
    expect(host.textContent).toContain("That booking is already settled.");
  });
});

/* ── the diary, and every capability it had ───────────────────────────────────────────── */

describe("the diary", () => {
  it("says a failed load failed, and is NOT drawn as an empty diary", async () => {
    hooks.useSupportDiary.mockReturnValue(failed());
    await render();

    expect(host.textContent).toContain("Your bookings didn't load");
    expect(host.textContent).toContain("still expected");
    // The lie this page must never tell.
    expect(host.textContent).not.toContain("Nothing booked yet");
    expect(buttonContaining("Try again")).toBeTruthy();
  });

  it("says an empty diary is empty, in words", async () => {
    hooks.useSupportDiary.mockReturnValue(loaded([]));
    await render();

    expect(host.textContent).toContain("Nothing booked yet");
    expect(host.textContent).not.toContain("didn't load");
  });

  it("draws a placeholder while it loads, and neither of the two stories above", async () => {
    hooks.useSupportDiary.mockReturnValue(pending());
    await render();

    expect(host.querySelectorAll(".ds-skeleton").length).toBeGreaterThan(0);
    expect(host.textContent).not.toContain("Nothing booked yet");
    expect(host.textContent).not.toContain("didn't load");
  });

  it("names who booked, the topic and the class", async () => {
    await render();
    await showEverything();

    expect(host.textContent).toContain("Aziza");
    expect(host.textContent).toContain("Inference questions");
    expect(host.textContent).toContain("SAT English · Group 4");
  });

  it("explains an invited seat", async () => {
    await render();
    await showEverything();

    expect(host.textContent).toContain("Invited into this seat by Aziza");
  });

  it("says why a seat came back", async () => {
    await render();
    await showEverything();

    expect(host.textContent).toContain("Given back:");
    expect(host.textContent).toContain("Clashed with a midterm");
  });

  it("shows the student's rating and their comment as a verdict on the SESSION", async () => {
    await render();
    await showEverything();

    expect(host.textContent).toContain("Explained it three ways until it clicked");
    const rating = Array.from(host.querySelectorAll("[title]")).find((el) =>
      el.getAttribute("title")?.includes("rated this session"),
    );
    expect(rating?.getAttribute("title")).toBe("Kamola rated this session 5 out of 5");
  });

  it("keeps growth-oriented words: Missed and Did not attend, never absent or no-show", async () => {
    await render();
    await showEverything();

    const text = host.textContent ?? "";
    expect(text).toContain("Missed");
    expect(text).toContain("Did not attend");
    expect(text.toLowerCase()).not.toContain("absent");
    expect(text.toLowerCase()).not.toContain("no-show");
    expect(text.toLowerCase()).not.toContain("roster");
  });

  it("reaches every stand a booking can be in", async () => {
    await render();
    await showEverything();

    const text = host.textContent ?? "";
    expect(text).toContain("Waiting for you");
    expect(text).toContain("Booked");
    expect(text).toContain("Held");
    expect(text).toContain("Missed");
    expect(text).toContain("Cancelled");
  });

  it("offers no outcome buttons on a seat that was given back", async () => {
    hooks.useSupportDiary.mockReturnValue(loaded([DIARY[5]]));
    await render();

    expect(host.textContent).toContain("Cancelled");
    expect(buttonNamed("They came")).toBeUndefined();
    expect(buttonNamed("Did not attend")).toBeUndefined();
  });

  it("lets a settled session be corrected, note and all", async () => {
    hooks.useSupportDiary.mockReturnValue(loaded([DIARY[3]]));
    await render();

    expect(host.textContent).toContain("Held");
    expect(buttonNamed("They came")).toBeTruthy();
    expect(buttonNamed("Did not attend")).toBeTruthy();
    expect(
      host.querySelector<HTMLInputElement>('[aria-label="What the session with Kamola covered"]')?.value,
    ).toBe("Went through inference questions");
  });
});

/* ── the week ─────────────────────────────────────────────────────────────────────────── */

describe("the teacher's week", () => {
  it("asks before withdrawing an hour, because withdrawing cancels its bookings", async () => {
    const setHour = mutation();
    hooks.useSetSupportHour.mockReturnValue(setHour);
    await render();

    const withdraw = buttons(host).find((b) => b.getAttribute("aria-label")?.startsWith("Withdraw "));
    expect(withdraw).toBeTruthy();

    await click(withdraw);

    // Asked, not done.
    expect(setHour.mutate).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Withdraw this hour?");
    expect(buttonNamed("Keep it open", dialog!)).toBeTruthy();
  });

  it("withdraws it once they confirm, and asks for no reason it cannot deliver", async () => {
    const setHour = mutation();
    hooks.useSetSupportHour.mockReturnValue(setHour);
    await render();

    await click(buttons(host).find((b) => b.getAttribute("aria-label")?.startsWith("Withdraw ")));

    // No free-text reason, and this is the assertion that keeps it away. `SupportHourView`
    // cancels the bookings with a fixed sentence of its own, so nothing typed here would
    // reach the student it was written for; and the `note` the endpoint does accept is the
    // hour's PUBLIC invitation note, which re-opening leaves in place — the reason would
    // come back as the teacher's advice on an hour students can book.
    expect(document.querySelector("#withdraw-note")).toBeNull();

    await click(buttonNamed("Withdraw the hour"));

    expect(setHour.mutate).toHaveBeenCalledWith({
      action: "close",
      startsAt: CALENDAR.days_out[0].hours[0].starts_at,
    });
  });

  it("re-opens a withdrawn hour", async () => {
    const setHour = mutation();
    hooks.useSetSupportHour.mockReturnValue(setHour);
    await render();

    await click(buttons(host).find((b) => b.getAttribute("aria-label")?.startsWith("Re-open ")));

    expect(setHour.mutate).toHaveBeenCalledWith({
      action: "open",
      startsAt: CALENDAR.days_out[0].hours[1].starts_at,
    });
  });

  it("draws every hour state, and never offers to withdraw one outside the teacher's shift", async () => {
    await render();

    const text = host.textContent ?? "";
    expect(text).toContain("Free");
    expect(text).toContain("Re-open");
    expect(text).toContain("Gone");
    expect(text).toContain("Off shift");
    expect(text).toContain("Aziza");
    // Six hours on day 0, and exactly one of them is withdrawable.
    expect(buttons(host).filter((b) => b.getAttribute("aria-label")?.startsWith("Withdraw "))).toHaveLength(1);
  });

  it("marks a booked hour whose student said what they need, so the topic is one hover away", async () => {
    await render();

    // The name carries the topic in its `title`; the icon is the only cue that it does.
    const named = Array.from(host.querySelectorAll("span[title]"))
      .find((el) => el.getAttribute("title") === "Inference questions");
    expect(named).toBeTruthy();
    expect(named?.parentElement?.querySelector("svg")).toBeTruthy();

    // And an hour nobody wrote a topic on gets no cue, so the icon means something.
    const plain = Array.from(host.querySelectorAll("span"))
      .find((el) => el.textContent === "Shahrizoda");
    expect(plain?.parentElement?.querySelector("svg")).toBeNull();
  });

  it("moves to another day when its tab is picked", async () => {
    await render();

    await click(buttons(host).find((b) => b.getAttribute("aria-label")?.startsWith("Tomorrow")));

    // Tomorrow's single open hour, and none of today's.
    expect(host.textContent).not.toContain("Off shift");
    expect(buttons(host).filter((b) => b.getAttribute("aria-label")?.startsWith("Withdraw "))).toHaveLength(1);
  });

  it("says the week failed rather than drawing an empty one, and offers the retry", async () => {
    const calendar = failed({ response: { data: { detail: "Support teachers only." } } });
    hooks.useMySupportCalendar.mockReturnValue(calendar);
    await render();

    expect(host.textContent).toContain("Your week didn't load");
    expect(host.textContent).toContain("Support teachers only.");
    expect(host.textContent).not.toContain("No days to show");

    await click(buttonContaining("Try again"));
    expect(calendar.refetch).toHaveBeenCalled();

    // The diary survives a failed calendar: the bookings are a separate request.
    expect(host.textContent).toContain("Nodir");
  });

  it("says an empty calendar window is empty, not broken", async () => {
    hooks.useMySupportCalendar.mockReturnValue(loaded({ ...CALENDAR, days_out: [] }));
    await render();

    expect(host.textContent).toContain("No days to show");
    expect(host.textContent).not.toContain("didn't load");
  });

  it("says so when changing an hour did not reach the server", async () => {
    hooks.useSetSupportHour.mockReturnValue({
      ...mutation(),
      isError: true,
      error: { response: { data: { detail: "That hour has already gone." } } },
    });
    await render();

    expect(host.textContent).toContain("That hour didn't change");
    expect(host.textContent).toContain("That hour has already gone.");
  });
});

/* ── the desk's figures ───────────────────────────────────────────────────────────────── */

describe("the desk", () => {
  it("counts what is owed from the rows it can act on, not from a number with no list", async () => {
    // Made to disagree on purpose: the server says 9, the diary holds 2 the teacher can
    // actually press. The figure on screen has to be the one the list below backs, or the
    // page sends somebody looking for seven rows that are not there.
    hooks.useMySupportCalendar.mockReturnValue(loaded({ ...CALENDAR, awaiting_settle: 9 }));
    await render();

    const stat = Array.from(host.querySelectorAll("div")).find(
      (el) => el.firstElementChild?.textContent === "Waiting for you"
        && el.textContent?.includes("taught, not yet recorded"),
    );
    expect(stat).toBeTruthy();
    expect(stat?.textContent).toContain("2");
    expect(stat?.textContent).not.toContain("9");
  });

  it("falls back to the server's figure while the diary has not answered", async () => {
    hooks.useSupportDiary.mockReturnValue(pending());
    await render();

    expect(host.textContent).toContain("Waiting for you");
    expect(host.textContent).toContain("taught, not yet recorded");
  });

  it("shows the session rating as the students' verdict on the session", async () => {
    await render();

    expect(host.textContent).toContain("Session rating");
    expect(host.textContent).toContain("4.5");
    expect(host.textContent).toContain("6 students rated the session");
  });
});
