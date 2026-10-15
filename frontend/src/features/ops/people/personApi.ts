"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { PeopleSection } from "@/features/ops/changelist/peopleApi";
import type { FinancePayment, MyFinance } from "@/features/finance/financeApi";

/**
 * One person's /ops change form: `GET /users/admin/people/<id>/` (the core the page opens with)
 * and its parts, one request each, so a slow or failing part never blanks the page
 * (backend/users/people_detail.py, people_parts.py, views_people_detail.py).
 */

export type PersonGroup = {
  id: number;
  name: string;
  subject: string;
  /** The class teacher's display name, "" when the class has none. */
  teacher: string;
  joined_at: string | null;
  /** Paired with lc-up: the seat comes and goes there, never here. */
  lcup_managed: boolean;
};

/** One lc-up payment, `lcup.finance._payment_row`: whole UZS, always positive; `kind` says which way. */
export type PersonPayment = FinancePayment;

/** `lcup.finance.student_finance(user)` plus the link itself. Null on the core when not linked. */
export type PersonLcup = MyFinance & {
  /** `LcupStudentLink.status`: "confirmed" | "auto" | "created" | "needs_review" | … */
  status: string;
  lcup_student_id: number;
  /** Never frozen for debt (`debt_freeze_exempt_at` is set). */
  exempt: boolean;
  /** The duplicate-accounts phone form's state, null when never asked. */
  phone_prompt: "pending" | "confirmed" | "not_me" | "superseded" | null;
};

export type PersonDuplicate = {
  id: number;
  name: string;
  username: string;
  section: PeopleSection;
  status: string;
  last_seen: string | null;
  /** Names of the live classes they sit in. */
  groups: string[];
};

export type PersonStaffClass = {
  id: number;
  name: string;
  subject: string;
  as: "teacher" | "ta";
  students: number;
  lcup_managed: boolean;
};

export type PersonStaff = {
  lcup_teacher: { status: string; name: string } | null;
  classes: PersonStaffClass[];
  workload: { classes: number; students: number; to_review: number };
};

export type PersonCore = {
  id: number;
  /** Where the account belongs now; the page follows it there when opened under another. */
  section: PeopleSection;
  username: string;
  first_name: string;
  last_name: string;
  name: string;
  email: string;
  email_verified: boolean;
  phone: string;
  role: string;
  subject: string;
  /** `users.audience.kind_of` for learners; "active" | "frozen" for staff. */
  status: string;
  is_frozen: boolean;
  /** Why the account is frozen: lc-up debt (lifts when paid) or an admin; null when it is not. */
  frozen_reason: "debt" | "admin" | null;
  date_joined: string | null;
  last_seen: string | null;
  /** Graded/submitted rows the account holds — the delete warning. */
  attempt_count: number;
  telegram_linked: boolean;
  lcup_created: boolean;
  /** Set by the student; ops only reads it. */
  sat: { exam_date: string | null; target_score: number | null; target_english: number | null; target_math: number | null };
  /** Learners only ([] for staff). */
  groups: PersonGroup[];
  past_groups: { id: number; name: string; left_at: string | null }[];
  /** Active classes not paired with lc-up that the learner is not in — "Add to class". */
  open_classes: { id: number; name: string }[];
  lcup: PersonLcup | null;
  duplicates: PersonDuplicate[];
  /** Staff only (null for learners). */
  staff: PersonStaff | null;
};

export type PersonPartName = "attendance" | "results" | "security" | "history";

// ── Parts (backend/users/people_parts.py) ─────────────────────────────────────────────────

/** `GET …/attendance/`: every class with records, and the last 30 days' marks (≤ 60, newest first). */
export type PersonAttendance = {
  classes: {
    id: number;
    name: string;
    /** False once the seat or the class is gone. */
    active: boolean;
    /** Percent of `counted` (EXCUSED is left out); null when nothing counts. */
    rate: number | null;
    present: number;
    late: number;
    absent: number;
    excused: number;
    counted: number;
  }[];
  recent: {
    /** "YYYY-MM-DD". */
    date: string;
    class_id: number;
    class_name: string;
    status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | string;
    note: string;
    /** lc-up's absence reason, "" when none. */
    reason: string;
    /** That register's `POST /attendance` to lc-up; null when none was made. */
    lcup_push: "sent" | "failed" | "refused" | null;
  }[];
};

/** `GET …/results/`: each list at most 20, newest first. */
export type PersonResults = {
  homework: { class_id: number; class_name: string; rate: number; completed: number; total: number }[];
  overdue: { id: number; title: string; class_name: string; due_at: string | null }[];
  assessments: { title: string; percent: number | null; at: string | null }[];
  mocks: { title: string; english: number | null; math: number | null; total: number | null; at: string | null }[];
  practice: { title: string; score: number | null; at: string | null }[];
  /** `scale` is the midterm's scoring scale: "SCALE_100" or "SCALE_800". */
  midterms: { title: string; score: number | null; scale: string; passed: boolean | null; at: string | null }[];
  events: {
    title: string;
    starts_at: string | null;
    status: "REGISTERED" | "CANCELLED" | string;
    attendance: "ATTENDED" | "MISSED" | string | null;
  }[];
  rewards: { xp: number; coins: number };
};

/** `GET …/security/`: live sign-in sessions (no token ever leaves the server). */
export type PersonSecurity = {
  sessions: { id: number; created_at: string | null; last_seen_at: string | null; ip: string; device: string }[];
  telegram_linked: boolean;
  email_verified: boolean;
  last_password_change: string | null;
};

/** `GET …/history/`: role changes, seats, security and admin events, lc-up payments; newest first, ≤ 200. */
export type PersonHistory = {
  items: {
    at: string;
    kind: "role" | "group" | "admin" | "security" | "payment";
    title: string;
    by: string;
    /** A day without a time (an lc-up payment): show the date alone. */
    all_day?: boolean;
  }[];
  truncated: boolean;
};

export const personKeys = {
  all: ["ops", "person"] as const,
  core: (id: number) => ["ops", "person", id] as const,
  part: (id: number, part: PersonPartName) => ["ops", "person", id, part] as const,
};

/** True for an axios-style 404: the account is missing or outside the actor's scope. */
export const isNotFound = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status === 404;

export function usePerson(id: number) {
  return useQuery({
    queryKey: personKeys.core(id),
    queryFn: async () => (await api.get<PersonCore>(`/users/admin/people/${id}/`)).data,
    // A missing account stays missing; anything else gets two more tries.
    retry: (count, err) => !isNotFound(err) && count < 2,
  });
}

export function usePersonPart<T>(id: number, part: PersonPartName) {
  return useQuery({
    queryKey: personKeys.part(id, part),
    queryFn: async () => (await api.get<T>(`/users/admin/people/${id}/${part}/`)).data,
  });
}

export const personActions = {
  /** Signs the account out of every device; resolves to how many sessions were revoked. */
  async revokeSessions(id: number): Promise<number> {
    const { data } = await api.post<{ revoked: number }>(`/users/admin/people/${id}/revoke-sessions/`);
    return data.revoked;
  },
};
