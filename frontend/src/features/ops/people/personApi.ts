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
