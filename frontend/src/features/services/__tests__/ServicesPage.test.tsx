/**
 * The Services page: the three services, the facts two of them carry, and the registration gate.
 *
 * The facts are the part most likely to mislead. "Nothing booked yet" may only be said once the
 * bookings have loaded — a failed request is not an empty diary — and "your next hour" has to be
 * the next one (booked, not withdrawn, not over), not whichever row the API happens to list
 * first. Same for the test date: the soonest, not the admin's first.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportBooking } from "@/lib/api";

const useMySupportBookings = vi.fn();
const useExamDates = vi.fn();

vi.mock("@/features/support/supportHooks", () => ({
  useMySupportBookings: (...a: unknown[]) => useMySupportBookings(...a),
}));

// Only the query is faked; `formatExamDate` and the other helpers stay real.
vi.mock("../servicesHooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../servicesHooks")>()),
  useExamDates: (...a: unknown[]) => useExamDates(...a),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { ServicesPage } = await import("../ServicesPage");
const { formatExamDate } = await import("../servicesHooks");

const HOUR = 3_600_000;

function booking(
  id: number,
  status: SupportBooking["status"],
  startsInHours: number,
  teacher: string,
  withdrawn = false,
): SupportBooking {
  const starts = Date.now() + startsInHours * HOUR;
  return {
    id, status, topic: "", booked_at: new Date().toISOString(), settled_at: null,
    classroom_id: null, classroom_name: null, student_id: 1, student: "Aziza",
    invited_by_id: null, invited_by: null, cancel_reason: "", cancelled_at: null,
    rating: null, rating_comment: "", rated_at: null, teacher_note: "",
    slot: {
      id: 100 + id, support_teacher_id: 9, support_teacher: teacher,
      starts_at: new Date(starts).toISOString(), ends_at: new Date(starts + HOUR).toISOString(),
      capacity: 1, note: "", is_cancelled: withdrawn,
    },
  };
}

const loaded = (data: unknown) => ({ data, isPending: false, isSuccess: true, isError: false, refetch: vi.fn() });
const pending = () => ({ data: undefined, isPending: true, isSuccess: false, isError: false, refetch: vi.fn() });
const failed = () => ({ data: undefined, isPending: false, isSuccess: false, isError: true, refetch: vi.fn() });

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<ServicesPage />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useMySupportBookings.mockReturnValue(loaded([]));
  useExamDates.mockReturnValue(loaded([]));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("ServicesPage", () => {
  it("offers the same three services, support still opening the calendar", async () => {
    await render();

    expect(host.textContent).toContain("Support booking");
    expect(host.textContent).toContain("Register for the SAT");
    expect(host.textContent).toContain("College admission");
    expect(host.textContent).toContain("Coming soon");
    expect(host.querySelector('a[href="/support"]')?.textContent).toContain("Open the calendar");
  });

  it("names the next support hour: booked, not withdrawn, not over — the earliest", async () => {
    useMySupportBookings.mockReturnValue(loaded([
      booking(1, "HELD", -30, "Already held"),
      booking(2, "BOOKED", 50, "Later one"),
      booking(3, "BOOKED", 2, "Withdrawn hour", true),
      booking(4, "BOOKED", 26, "Dilafruz"),
      booking(5, "CANCELLED", 3, "Cancelled hour"),
    ]));
    await render();

    expect(host.textContent).toContain("Your next hour");
    expect(host.textContent).toContain("Dilafruz");
    for (const other of ["Already held", "Later one", "Withdrawn hour", "Cancelled hour"]) {
      expect(host.textContent).not.toContain(other);
    }
  });

  it("says nothing is booked only once the bookings have loaded", async () => {
    await render();
    expect(host.textContent).toContain("Nothing booked yet");

    useMySupportBookings.mockReturnValue(failed());
    await render();
    expect(host.textContent).not.toContain("Nothing booked yet");
    expect(host.textContent).not.toContain("Your next hour");

    useMySupportBookings.mockReturnValue(pending());
    await render();
    expect(host.textContent).not.toContain("Nothing booked yet");
  });

  it("shows the soonest test date, whatever order the list came in", async () => {
    const dates = [
      { id: 3, exam_date: "2027-12-04", label: "" },
      { id: 1, exam_date: "2027-10-02", label: "" },
      { id: 2, exam_date: "2027-11-06", label: "" },
    ];
    useExamDates.mockReturnValue(loaded(dates));
    await render();

    expect(host.textContent).toContain("Next test date");
    expect(host.textContent).toContain(formatExamDate(dates[1]));
    expect(host.textContent).not.toContain(formatExamDate(dates[0]));
  });

  it("never reads a failed date list as none on offer", async () => {
    useExamDates.mockReturnValue(failed());
    await render();

    expect(host.textContent).not.toContain("None open just now");
    expect(host.textContent).not.toContain("Next test date");
  });

  it("opens the checklist in the app's sans, and shows Telegram only once the box is ticked", async () => {
    await render();

    const open = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("See what you need"),
    );
    await act(async () => open?.click());

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Send these six things");
    // Portalled onto <body>, it inherited Georgia until the panel carried the UI face itself.
    expect(dialog?.classList.contains("ds-app")).toBe(true);
    expect(document.querySelector('a[href="https://t.me/MS_register"]')).toBeNull();

    const tick = dialog?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => tick?.click());

    expect(document.querySelector('a[href="https://t.me/MS_register"]')).not.toBeNull();
  });
});
