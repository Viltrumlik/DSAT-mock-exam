import type { Classroom } from "@/lib/api";

/** The profile's copy of `/users/me/`: strings where a form edits them, nulls where it doesn't. */
export interface ProfileMe {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  email_verified: boolean;
  phone_number: string;
  telegram_linked: boolean;
  role: string;
  sat_exam_date: string;
  target_score: number | null;
  target_english: number | null;
  target_math: number | null;
  profile_image_url: string | null;
  last_password_change: string | null;
}

const toNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toProfileMe(me: any): ProfileMe {
  return {
    username: me?.username || "",
    first_name: me?.first_name || "",
    last_name: me?.last_name || "",
    email: me?.email || "",
    email_verified: Boolean(me?.email_verified),
    phone_number: me?.phone_number || "",
    telegram_linked: Boolean(me?.telegram_linked),
    role: String(me?.role || "student"),
    sat_exam_date: me?.sat_exam_date || "",
    target_score: toNumber(me?.target_score),
    target_english: toNumber(me?.target_english),
    target_math: toNumber(me?.target_math),
    profile_image_url: me?.profile_image_url || null,
    last_password_change: me?.last_password_change || null,
  };
}

/** An admin-set SAT date a student may pick (active and upcoming only). */
export interface ExamDateOption {
  id: number;
  exam_date: string;
  label: string;
}

export interface TelegramConfig {
  enabled: boolean;
  bot_username: string | null;
  client_id: string | null;
  start_url: string | null;
}

/** A row of `GET /classes/` with the fields the serializer sends that the OpenAPI types predate. */
export type ProfileClass = Omit<Classroom, "teacher_details"> & {
  branch_name?: string | null;
  telegram_group_url?: string | null;
  teacher_details: (NonNullable<Classroom["teacher_details"]> & { profile_image_url?: string | null }) | null;
};

/** A completed test attempt, as `GET /exams/attempts/` serves the fields the profile reads. */
export interface ProfileAttempt {
  id: number;
  submitted_at?: string | null;
  is_completed?: boolean;
  score?: number | null;
  practice_test_details?: {
    subject?: string | null;
    title?: string | null;
    collection_name?: string | null;
    mock_exam_id?: number | null;
    mock_kind?: string | null;
  } | null;
}

/** The Settings tab's sections, in the order its menu lists them. */
export const SETTINGS_SECTIONS = ["account", "goal", "appearance", "notifications", "signin", "devices"] as const;
export type SettingsSectionKey = (typeof SETTINGS_SECTIONS)[number];

/** Where a request stands. Kept apart from its data so a failure never reads as "none". */
export type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };
