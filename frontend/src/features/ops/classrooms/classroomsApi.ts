"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { ChangeListData } from "@/features/ops/changelist/ChangeList";
import type { ChangeListParams } from "@/features/ops/changelist/useChangeListParams";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";

/**
 * `/classes/admin/classrooms/` — the /ops Classrooms changelist and each class's change form
 * (backend/classes/views_ops_classrooms.py). The server searches, filters, counts, orders and pages;
 * this names the shapes and asks.
 */

export type ClassroomRow = {
  id: number;
  name: string;
  /** "MATH" | "ENGLISH". */
  subject: string;
  level: string;
  teacher: { id: number; name: string } | null;
  /** Active student seats. */
  students: number;
  /** "ODD" | "EVEN" | "". */
  lesson_days: string;
  lesson_time: string;
  room_number: string;
  /** The branch's name, "" for none. */
  branch: string;
  /** Paired with an lc-up group — its details, teacher and students come from lc-up. */
  lcup: boolean;
  is_active: boolean;
  created_at: string | null;
};

export type ClassroomPage = ChangeListData<ClassroomRow> & { ordering: string };

export type ClassroomCore = {
  id: number;
  name: string;
  subject: string;
  level: string;
  description: string;
  lesson_days: string;
  lesson_time: string;
  lesson_hours: number | null;
  /** "YYYY-MM-DD". */
  start_date: string | null;
  room_number: string;
  branch: { id: number; name: string } | null;
  telegram_chat_id: string;
  telegram_group_url: string;
  max_students: number | null;
  schedule_summary: string;
  is_active: boolean;
  join_code: string;
  created_at: string | null;
  teacher: { id: number; name: string } | null;
  tas: { id: number; name: string }[];
  students: number;
  /** Null when the class has no lc-up group at all. `locked_fields` are lc-up's while it is managed. */
  lcup: { managed: boolean; group_name: string; status: string; locked_fields: string[] } | null;
  /** The header's figures on the Overview (`ops_classrooms._glance`), each the same reading as its tab. */
  glance: ClassroomGlance;
};

export type ClassroomGlance = {
  /** Over every marked lesson; null before the first. */
  attendance_rate: number | null;
  /** "YYYY-MM-DD" of the latest lesson, null before the first. */
  last_lesson: string | null;
  /** Published homework: handed in out of expected (students sitting now × assignments). */
  homework: { assignments: number; handed_in: number; expected: number };
  /** Students sitting now who owe lc-up. */
  owing: number;
};

export type ClassroomRoster = {
  students: {
    id: number;
    name: string;
    username: string;
    /** Their profile photo, null when none is set. */
    avatar_url: string | null;
    section: PeopleSection;
    joined_at: string | null;
    /** What lc-up says they owe, in whole UZS; null when nothing. */
    owes: number | null;
    attendance_rate: number | null;
    homework_rate: number | null;
  }[];
};

export type ClassroomAttendance = {
  sessions: {
    date: string;
    present: number;
    late: number;
    absent: number;
    excused: number;
    lcup_push: "sent" | "failed" | "refused" | null;
  }[];
  rate: number | null;
};

export type ClassroomHomework = {
  assignments: { id: number; title: string; due_at: string | null; turned_in: number; students: number }[];
};

export type ClassroomHistory = { items: { at: string; title: string; by: string }[]; truncated: boolean };

export type ClassroomTelegramMember = {
  id: number;
  user_id: number | null;
  name: string;
  telegram_user_id: number | null;
  telegram_username: string;
  telegram_display_name: string;
  status: "PENDING" | "JOINED" | "LEFT" | "REMOVED";
  /** The bot acts on them by itself: it watched them arrive, or they signed in to the bot. */
  managed: boolean;
  frozen: boolean;
  frozen_for_debt: boolean;
  joined_at: string | null;
};

export type ClassroomTelegram = {
  configured: boolean;
  health: { ok: boolean; title: string; member_count: number | null; problem: string } | null;
  /** `in_group` is Telegram's own head count (bot and admins included); the rest are people known here. */
  counts: { in_group: number | null; known: number; managed: number; frozen_in_group: number };
  members: ClassroomTelegramMember[];
};

export type ClassroomPartName = "roster" | "attendance" | "homework" | "history" | "telegram";

/** The filter keys the list understands (anything else in the address is not sent). */
export const CLASSROOM_FILTER_KEYS = ["subject", "level", "teacher", "branch", "days", "lcup", "status"] as const;

/** The query string the changelist endpoint takes, from the list's address state. */
export function classroomQuery(params: ChangeListParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of CLASSROOM_FILTER_KEYS) {
    const value = params.filters[key];
    if (value) out[key] = value;
  }
  if (params.q) out.q = params.q;
  if (params.o) out.o = params.o;
  if (params.page > 1) out.page = params.page;
  out.page_size = params.pageSize;
  return out;
}

export const classroomKeys = {
  all: ["ops", "classrooms"] as const,
  list: (query: Record<string, string | number>) => ["ops", "classrooms", "list", query] as const,
  core: (id: number) => ["ops", "classrooms", id] as const,
  part: (id: number, part: ClassroomPartName) => ["ops", "classrooms", id, part] as const,
};

/** One page of the list. The previous page stays on screen while the next loads. */
export function useClassrooms(params: ChangeListParams) {
  const query = classroomQuery(params);
  return useQuery({
    queryKey: classroomKeys.list(query),
    queryFn: async () => (await api.get<ClassroomPage>("/classes/admin/classrooms/", { params: query })).data,
    placeholderData: keepPreviousData,
  });
}

export const isNotFound = (err: unknown) => (err as { response?: { status?: number } })?.response?.status === 404;

export function useClassroom(id: number) {
  return useQuery({
    queryKey: classroomKeys.core(id),
    queryFn: async () => (await api.get<ClassroomCore>(`/classes/admin/classrooms/${id}/`)).data,
    retry: (count, err) => !isNotFound(err) && count < 2,
  });
}

export function useClassroomPart<T>(id: number, part: ClassroomPartName) {
  return useQuery({
    queryKey: classroomKeys.part(id, part),
    queryFn: async () => (await api.get<T>(`/classes/admin/classrooms/${id}/${part}/`)).data,
  });
}

/**
 * The server's own rule for a class's Telegram chat id (classes/serializers.py,
 * `validate_telegram_chat_id`), checked before the save so a stray letter in a pasted /chatid
 * answer shows at the field. Blank means "no group". The server stays the authority: whatever it
 * refuses still comes back through `serverReason`.
 */
export const TELEGRAM_CHAT_ID_MESSAGE = "Telegram chat id must be the number /chatid gave you (e.g. -1001234567890).";

/** Null when `value` would be accepted, else the message to show. */
export function telegramChatIdProblem(value: string): string | null {
  const v = value.trim();
  return v === "" || /^-?[0-9]+$/.test(v) ? null : TELEGRAM_CHAT_ID_MESSAGE;
}

/** The server's reason for a refusal (`detail`, else the first field error), or `fallback`. */
export function serverReason(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.detail === "string") return d.detail;
    for (const value of Object.values(d)) {
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      if (typeof value === "string") return value;
    }
  }
  return fallback;
}

/** An admin takes one person out of the class Telegram group (forced past the bot's own rules). */
export async function removeTelegramMember(id: number, memberId: number): Promise<{ removed: boolean }> {
  return (await api.post(`/classes/admin/classrooms/${id}/telegram/remove/`, { member_id: memberId })).data;
}
