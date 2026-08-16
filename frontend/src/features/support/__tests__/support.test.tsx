/**
 * The two pieces of support-desk logic a type check cannot catch.
 *
 * 1. **The diary's order.** It used to be one all-time list, oldest first, so the session
 *    needing a decision today sat under every hour ever taught. The grouping is what makes
 *    the "To record" number point at rows a teacher can actually find.
 * 2. **The award announcement's first run.** Without the first-run rule, everybody who has
 *    ever attended a support session gets congratulated for every one of them the first
 *    time this ships — which is not news, and teaches students to ignore the next one.
 *    That failure is invisible in development, where nobody has a history.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportBooking } from "@/lib/api";

const useSupportCalendar = vi.fn();
const useMySupportBookings = vi.fn();
const useBookSupportHour = vi.fn();
const useCancelSupportBooking = vi.fn();
const useRateSupportSession = vi.fn();
const pushGlobalToast = vi.fn();

vi.mock("../supportHooks", () => ({
  useSupportCalendar: (...a: unknown[]) => useSupportCalendar(...a),
  useMySupportBookings: (...a: unknown[]) => useMySupportBookings(...a),
  useBookSupportHour: (...a: unknown[]) => useBookSupportHour(...a),
  useCancelSupportBooking: (...a: unknown[]) => useCancelSupportBooking(...a),
  useRateSupportSession: (...a: unknown[]) => useRateSupportSession(...a),
}));

vi.mock("@/lib/toastBus", () => ({
  pushGlobalToast: (...a: unknown[]) => pushGlobalToast(...a),
  pushGlobalToastOnce: (...a: unknown[]) => pushGlobalToast(...a),
}));

const { SupportBookingPage } = await import("../SupportBookingPage");
const { groupDiary } = await import("../SupportTeacherPage");

const HOUR = 3_600_000;

function booking(over: Partial<SupportBooking> = {}): SupportBooking {
  const startsAt = over.slot?.starts_at ?? new Date(Date.now() + HOUR).toISOString();
  return {
    id: 1,
    status: "BOOKED",
    topic: "",
    booked_at: new Date().toISOString(),
    settled_at: null,
    classroom_id: null,
    classroom_name: null,
    student_id: 7,
    student: "Aziz X",
    cancel_reason: "",
    cancelled_at: null,
    rating: null,
    rating_comment: "",
    rated_at: null,
    teacher_note: "",
    award: null,
    ...over,
    slot: {
      id: 1,
      support_teacher_id: 2,
      support_teacher: "Dilnoza T",
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + HOUR).toISOString(),
      capacity: 1,
      note: "",
      is_cancelled: false,
      ...(over.slot ?? {}),
    },
  };
}

function at(hoursFromNow: number, over: Partial<SupportBooking> = {}): SupportBooking {
  const startsAt = new Date(Date.now() + hoursFromNow * HOUR).toISOString();
  return booking({ ...over, slot: { ...(over.slot ?? {}), starts_at: startsAt } as never });
}

// ─── groupDiary ───────────────────────────────────────────────────────────────

describe("groupDiary", () => {
  it("puts the sessions nobody has been paid for first", () => {
    const overdue = at(-5, { id: 1 });
    const soon = at(2, { id: 2 });
    const groups = groupDiary([soon, overdue]);

    expect(groups.toRecord.map((b) => b.id)).toEqual([1]);
    expect(groups.coming.map((b) => b.id)).toEqual([2]);
  });

  it("orders what is coming soonest-first and what is done newest-first", () => {
    const groups = groupDiary([
      at(6, { id: 1 }),
      at(2, { id: 2 }),
      at(-30, { id: 3, status: "HELD" }),
      at(-4, { id: 4, status: "NO_SHOW" }),
    ]);

    expect(groups.coming.map((b) => b.id)).toEqual([2, 1]);
    // Newest first: a teacher looking at "Done" wants this morning, not last term.
    expect(groups.done.map((b) => b.id)).toEqual([4, 3]);
  });

  it("keeps cancelled sessions, which the diary used to filter out entirely", () => {
    const groups = groupDiary([at(-2, { id: 9, status: "CANCELLED", cancel_reason: "Unwell" })]);
    expect(groups.done.map((b) => b.id)).toEqual([9]);
    // And never as something the teacher still has to decide about.
    expect(groups.toRecord).toEqual([]);
  });

  it("does not ask a teacher to record an hour that has not finished", () => {
    // Started 20 minutes ago, still running. Settling it now would be a guess.
    const running = booking({
      id: 5,
      slot: {
        starts_at: new Date(Date.now() - 0.3 * HOUR).toISOString(),
        ends_at: new Date(Date.now() + 0.7 * HOUR).toISOString(),
      } as never,
    });
    const groups = groupDiary([running]);
    expect(groups.toRecord).toEqual([]);
    expect(groups.coming.map((b) => b.id)).toEqual([5]);
  });
});

// ─── The award announcement ───────────────────────────────────────────────────

describe("the +XP announcement", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(bookings: SupportBooking[]) {
    act(() => {
      useMySupportBookings.mockReturnValue({ data: bookings, isPending: false, isError: false });
      root.render(<SupportBookingPage />);
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    pushGlobalToast.mockClear();
    useSupportCalendar.mockReturnValue({
      data: {
        days: 4, open_hour: 8, close_hour: 18, dates: [],
        allowance: { upcoming: 0, max_upcoming: 2, this_week: 0, max_per_week: 3, can_book: true },
        teachers: [],
      },
      isPending: false,
      isError: false,
    });
    const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn() };
    useBookSupportHour.mockReturnValue(idle);
    useCancelSupportBooking.mockReturnValue(idle);
    useRateSupportSession.mockReturnValue(idle);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("says nothing on the first run, however much history there is", () => {
    render([
      at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-30, { id: 2, status: "HELD", award: { points: 10, xp: 10 } }),
    ]);
    expect(pushGlobalToast).not.toHaveBeenCalled();
  });

  it("announces a session settled since the last look", () => {
    render([at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } })]);
    pushGlobalToast.mockClear();

    render([
      at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-2, { id: 2, status: "HELD", award: { points: 10, xp: 10 } }),
    ]);

    expect(pushGlobalToast).toHaveBeenCalledTimes(1);
    expect(pushGlobalToast.mock.calls[0][0]).toMatchObject({
      tone: "success",
      message: expect.stringContaining("+10 XP"),
    });
  });

  it("says it once for several, not once each", () => {
    render([at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } })]);
    pushGlobalToast.mockClear();

    render([
      at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-3, { id: 2, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-2, { id: 3, status: "HELD", award: { points: 10, xp: 10 } }),
    ]);

    expect(pushGlobalToast).toHaveBeenCalledTimes(1);
    expect(pushGlobalToast.mock.calls[0][0].message).toContain("+20 XP");
    expect(pushGlobalToast.mock.calls[0][0].message).toContain("2 support sessions");
  });

  it("does not announce the same session twice", () => {
    render([at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } })]);
    const fresh = [
      at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-2, { id: 2, status: "HELD", award: { points: 10, xp: 10 } }),
    ];
    render(fresh);
    pushGlobalToast.mockClear();

    // A refetch returning the same rows — the ordinary case every 15 seconds.
    render(fresh);
    expect(pushGlobalToast).not.toHaveBeenCalled();
  });

  it("stays quiet for a session that earned nothing", () => {
    render([at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } })]);
    pushGlobalToast.mockClear();

    // Settled, but the ledger paid nothing — a rule priced at zero, or a revoked award.
    render([
      at(-40, { id: 1, status: "HELD", award: { points: 10, xp: 10 } }),
      at(-2, { id: 2, status: "NO_SHOW", award: null }),
    ]);
    expect(pushGlobalToast).not.toHaveBeenCalled();
  });
});
