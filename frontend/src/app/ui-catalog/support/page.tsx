"use client";

/**
 * Preview of the teacher's Support sessions page, on invented data.
 *
 * The real page needs a support teacher's account and a diary with history behind it. This
 * route seeds the two queries it reads and renders the SAME component, so the thing the
 * rebuild exists for — the hours that were taught and never recorded — can be looked at.
 *
 * The sample deliberately holds one session that is still INSIDE its own hour. It must not be
 * counted as owed: a teacher sitting with a student is teaching, not neglecting.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SupportTeacherPage } from "@/features/support/SupportTeacherPage";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** Invented names. This repository is public; no real student appears here. */
function booking(
  id: number, student: string, status: "BOOKED" | "HELD" | "NO_SHOW" | "CANCELLED",
  startOffset: number, extra: Record<string, unknown> = {},
) {
  return {
    id, status, student, student_id: id, topic: "Module 2 timing",
    booked_at: iso(startOffset - 3 * DAY), settled_at: null,
    classroom_id: 1, classroom_name: "Math Junior 3",
    invited_by_id: null, invited_by: null,
    cancel_reason: "", cancelled_at: null,
    rating: null, rating_comment: "", rated_at: null,
    teacher_note: "",
    slot: { starts_at: iso(startOffset), ends_at: iso(startOffset + HOUR), capacity: 3, seats_left: 2 },
    ...extra,
  };
}

const DIARY = [
  // The backlog: taught, finished, never recorded. The oldest is six weeks old.
  booking(1, "Aziza Karimova", "BOOKED", -43 * DAY),
  booking(2, "Bekzod Tursunov", "BOOKED", -12 * DAY),
  booking(3, "Malika Rahimova", "BOOKED", -5 * DAY),
  booking(4, "Jasur Alimov", "BOOKED", -2 * DAY),
  // Being taught right now — started twenty minutes ago. NOT owed.
  booking(5, "Shahrizoda Umarova", "BOOKED", -20 * MIN),
  // Still to come.
  booking(6, "Nodira Yo'ldosheva", "BOOKED", 2 * DAY),
  // Already settled, with the student's verdict on the session.
  booking(7, "Sardor Yusupov", "HELD", -9 * DAY, {
    settled_at: iso(-9 * DAY + HOUR), teacher_note: "Went through the whole grid-in section.",
    rating: 5, rating_comment: "Explained it three ways until it landed.", rated_at: iso(-9 * DAY + 2 * HOUR),
  }),
  booking(8, "Dilnoza Ergasheva", "NO_SHOW", -7 * DAY, { settled_at: iso(-7 * DAY + HOUR) }),
  booking(9, "Kamola Nazarova", "CANCELLED", -4 * DAY, {
    cancelled_at: iso(-5 * DAY), cancel_reason: "Clashed with the midterm.",
  }),
];

function hour(startOffset: number, state: string, bookings: { id: number; student: string }[] = []) {
  return {
    starts_at: iso(startOffset), ends_at: iso(startOffset + HOUR), state,
    capacity: 3, seats_left: 3 - bookings.length, note: "", availability_id: 1,
    bookings: bookings.map((b) => ({
      id: b.id, status: "BOOKED" as const, topic: "Module 2 timing",
      student: b.student, student_id: b.id, classroom_name: "Math Junior 3", rating: null,
    })),
  };
}

const CALENDAR = {
  days: 4, open_hour: 9, close_hour: 13,
  free_hours: 6, booked_sessions: 3,
  awaiting_settle: 5,
  ratings: { average: 4.6, count: 18 },
  dates: [],
  days_out: [
    { date: new Date(Date.now()).toISOString().slice(0, 10),
      hours: [hour(-20 * MIN, "booked", [{ id: 5, student: "Shahrizoda Umarova" }]), hour(2 * HOUR, "open"), hour(3 * HOUR, "off")] },
    { date: new Date(Date.now() + DAY).toISOString().slice(0, 10),
      hours: [hour(DAY, "open"), hour(DAY + HOUR, "closed"), hour(DAY + 2 * HOUR, "open")] },
    { date: new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10),
      hours: [hour(2 * DAY, "booked", [{ id: 6, student: "Nodira Yo'ldosheva" }]), hour(2 * DAY + HOUR, "open")] },
  ],
};

export default function Page() {
  const [qc] = useState(() => {
    const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    c.setQueryData(["support", "my-calendar"], CALENDAR);
    c.setQueryData(["support", "diary"], DIARY);
    return c;
  });
  return (
    <QueryClientProvider client={qc}>
      <SupportTeacherPage />
    </QueryClientProvider>
  );
}
