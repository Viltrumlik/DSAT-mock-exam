"use client";

import api from "@/lib/api";

/**
 * The seat actions (`backend/classes/views_seats.py`): admins only, and refused with 409 `lcup_managed` until
 * the centre leaves lc-up, which `seats_open` on the class and on /ops/trials tells the screens.
 */

export type SeatStatus = "active" | "trial" | "frozen";
export type SeatAction = "activate" | "freeze" | "return" | "move" | "leave" | "fix-date";

/** Who holds the phone a new student was given (409 `phone_taken`). */
export type PhoneHolder = { id: number; name: string; section: string; groups: string[]; can_add: boolean };

const seatsPath = (roomId: number) => `/classes/admin/classrooms/${roomId}/seats/`;

/** Today on the admin's own calendar: "YYYY-MM-DD", which `toISOString` gets wrong near midnight. */
export function todayIso(): string {
  const now = new Date();
  const part = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
}

export async function addSeat(roomId: number, body: { user_id: number; status: "trial" | "active"; date: string }) {
  return (await api.post(seatsPath(roomId), body)).data;
}

export async function createStudent(
  roomId: number,
  body: {
    full_name: string;
    phone: string;
    parent_name: string;
    parent_phone: string;
    status: "trial" | "active";
    date: string;
  },
): Promise<{ login: { phone: string; code: string } }> {
  return (await api.post(`${seatsPath(roomId)}new-student/`, body)).data;
}

export async function seatAction(
  roomId: number,
  userId: number,
  action: SeatAction,
  body: { date: string; to_classroom?: number },
) {
  return (await api.post(`${seatsPath(roomId)}${userId}/${action}/`, body)).data;
}

/** Every active class, however many pages: a move offered from the first page alone would hide the rest. */
export async function activeClassrooms(): Promise<{ id: number; name: string }[]> {
  const rooms: { id: number; name: string }[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await api.get<{ results: { id: number; name: string }[]; pages: number }>("/classes/admin/classrooms/", {
      params: { status: "active", page_size: 100, page },
    });
    rooms.push(...data.results);
    if (page >= data.pages) return rooms;
  }
}
