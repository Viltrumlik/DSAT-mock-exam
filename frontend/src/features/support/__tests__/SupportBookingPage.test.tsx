/**
 * The support booking page, as restyled: the behaviours the new chips and pills must keep.
 *
 * An hour that can't be taken stays on screen with its reason and is not a button; picking an
 * hour opens the confirm panel named after the pick; a booked session can take a member or be
 * cancelled, and cancelling asks why; only an attended, unrated session asks for a rating. The
 * dialogs are pinned to the app's sans — portalled onto <body>, they were reading in Georgia.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportBooking, SupportCalendar, SupportHour } from "@/lib/api";

const hooks = {
  useSupportCalendar: vi.fn(),
  useMySupportBookings: vi.fn(),
  useBookSupportHour: vi.fn(),
  useCancelSupportBooking: vi.fn(),
  useRateSupportSession: vi.fn(),
  useInvitableClassmates: vi.fn(),
  useInviteMember: vi.fn(),
};

vi.mock("../supportHooks", () => ({
  useSupportCalendar: () => hooks.useSupportCalendar(),
  useMySupportBookings: () => hooks.useMySupportBookings(),
  useBookSupportHour: () => hooks.useBookSupportHour(),
  useCancelSupportBooking: () => hooks.useCancelSupportBooking(),
  useRateSupportSession: () => hooks.useRateSupportSession(),
  useInvitableClassmates: () => hooks.useInvitableClassmates(),
  useInviteMember: () => hooks.useInviteMember(),
}));

const { SupportBookingPage } = await import("../SupportBookingPage");

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).toISOString();

const today = new Date();
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

function hour(d: Date, h: number, state: SupportHour["state"], note = ""): SupportHour {
  return { starts_at: at(d, h), ends_at: at(d, h + 1), state, capacity: 1, seats_left: 1, note };
}

const CALENDAR: SupportCalendar = {
  days: 4, open_hour: 8, close_hour: 18, dates: [localDate(today), localDate(tomorrow)],
  allowance: { upcoming: 1, max_upcoming: 2, max_per_day: 1, taken_days: [], can_book: true },
  teachers: [{
    id: 9, name: "Dilafruz Karimova", photo_url: null,
    classrooms: [{ id: 34, name: "SAT English · Group 4" }],
    days: [
      { date: localDate(tomorrow), hours: [
        hour(tomorrow, 9, "full"),
        hour(tomorrow, 10, "closed"),
        hour(tomorrow, 14, "open", "Bring your answer sheet"),
      ] },
    ],
  }],
};

function booking(id: number, status: SupportBooking["status"], rating: number | null = null): SupportBooking {
  return {
    id, status, topic: "", booked_at: at(today, 8), settled_at: null,
    classroom_id: 34, classroom_name: "SAT English · Group 4", student_id: 1, student: "Aziza",
    invited_by_id: null, invited_by: null, cancel_reason: "", cancelled_at: null,
    rating, rating_comment: "", rated_at: null, teacher_note: "",
    slot: {
      id: 100 + id, support_teacher_id: 9, support_teacher: "Dilafruz Karimova",
      starts_at: at(tomorrow, 15), ends_at: at(tomorrow, 16), capacity: 1, note: "", is_cancelled: false,
    },
  };
}

const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() });
const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() });

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<SupportBookingPage />));
}

async function click(el: Element | null | undefined) {
  await act(async () => (el as HTMLElement | null)?.click());
}

const buttonNamed = (text: string, scope: ParentNode = host) =>
  Array.from(scope.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  hooks.useSupportCalendar.mockReturnValue(loaded(CALENDAR));
  hooks.useMySupportBookings.mockReturnValue(loaded([booking(1, "BOOKED"), booking(2, "HELD"), booking(3, "HELD", 4)]));
  hooks.useBookSupportHour.mockReturnValue(mutation());
  hooks.useCancelSupportBooking.mockReturnValue(mutation());
  hooks.useRateSupportSession.mockReturnValue(mutation());
  hooks.useInvitableClassmates.mockReturnValue(loaded([{ id: 21, name: "Madina Yusupova" }]));
  hooks.useInviteMember.mockReturnValue(mutation());
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("SupportBookingPage", () => {
  it("keeps an hour that can't be taken on screen with its reason, and only open hours are buttons", async () => {
    await render();

    expect(host.textContent).toContain("Fully booked");
    expect(host.textContent).toContain("Not available");
    expect(host.querySelectorAll('[aria-label^="Book "]')).toHaveLength(1);
  });

  it("opens the confirm panel named after the picked hour, with the teacher's note", async () => {
    await render();
    expect(host.textContent).not.toContain("Confirm booking");

    await click(host.querySelector('[aria-label^="Book "]'));

    expect(host.textContent).toContain("with Dilafruz Karimova");
    expect(host.textContent).toContain("Bring your answer sheet");
    expect(host.textContent).toContain("Confirm booking");
  });

  it("asks only the attended, unrated session for a rating", async () => {
    await render();

    const rate = Array.from(host.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Rate this session"),
    );
    expect(rate).toHaveLength(1);
  });

  it("cancels a booked session through a dialog that asks why, set in the app's sans", async () => {
    await render();

    await click(buttonNamed("Cancel"));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Cancel this session?");
    expect(dialog?.classList.contains("ds-app")).toBe(true);
  });

  it("adds a member through a dialog listing classmates, set in the app's sans", async () => {
    await render();

    await click(buttonNamed("Add a member"));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Add someone to this session");
    expect(dialog?.textContent).toContain("Madina Yusupova");
    expect(dialog?.classList.contains("ds-app")).toBe(true);
  });
});
