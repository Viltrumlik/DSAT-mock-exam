import api from "@/lib/api";

/**
 * The lc-up link (backend/lcup). Types mirror backend/lcup/serializers.py field for field — these
 * are read raw, with no shared zod contract stripping keys on the way in.
 */

export type LinkStatus = "unmatched" | "auto" | "needs_review" | "confirmed" | "created" | "ignored";
export type GroupLinkStatus = "suggested" | "needs_teacher" | "confirmed" | "ignored";
export type ClaimState = "pending" | "signed_in" | "done" | "expired" | "locked";
export type StudentFilter = "needs_review" | "unmatched" | "all";

export interface LcupRef {
  id: number;
  name: string;
}

export interface LcupUserRef {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
}

export interface LcupRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  dry_run: boolean;
  ok: boolean;
  counts: Record<string, number>;
  errors: { stage: string; error: string }[];
  alerts: string[];
}

export interface LcupStatus {
  enabled: boolean;
  initial_review_done_at: string | null;
  last_run: LcupRun | null;
  recent_runs: LcupRun[];
  counts: {
    needs_review_students: number;
    unmatched_students: number;
    needs_review_teachers: number;
    groups_pending: number;
    unclaimed_accounts: number;
  };
}

export interface LcupGroup {
  id: number;
  lcup_group_id: number;
  name: string;
  course: string;
  days: number[];
  start_time: string;
  finish_time: string;
  teachers: string[];
  status: GroupLinkStatus;
  deleted: boolean;
  classroom: LcupRef | null;
  suggestion: (LcupRef & { score: number; reasons: string[] }) | null;
  /** Why nothing was suggested, when nothing was. */
  notes: string[];
  member_count: number | null;
}

export interface LcupCandidate {
  user_id: number;
  name: string;
  reason: string;
}

export interface LcupPerson {
  id: number;
  lcup_id: number;
  name: string;
  phone: string;
  status: LinkStatus;
  reason: string;
  candidates: LcupCandidate[];
  user: LcupUserRef | null;
  groups: string[];
  deleted: boolean;
}

export interface LcupUnlinkedMember {
  classroom: LcupRef;
  user: LcupUserRef;
}

export interface LcupAccount {
  user: LcupUserRef;
  phone: string;
  state: ClaimState;
  expires_at: string;
  failed_attempts: number;
  first_login_at: string | null;
  password_set_at: string | null;
  reissued_count: number;
}

export type AttendancePushState = "sent" | "failed" | "refused";

/** One register sent to lc-up (lc-up Part 2): what lc-up took, and the students it did not. */
export interface LcupAttendancePush {
  id: number;
  group: string;
  date: string;
  state: AttendancePushState;
  attempts: number;
  marks: number;
  summary: { saved?: number; deleted?: number; unchanged?: number; failed?: number };
  failures: { student: LcupUserRef | null; code: string; message: string }[];
  error: string;
  sent_at: string | null;
}

export type TrialState = "not_yet" | "came" | "used";
export type MissingReason = "needs_review" | "ignored" | "no_account" | "not_seated";

export interface LcupTrialRow {
  membership_id: number;
  name: string;
  student: LcupUserRef | null;
  classroom: LcupRef;
  teachers: string[];
  since: string | null;
  lessons: number;
  first_lesson: string | null;
  last_lesson: string | null;
  state: TrialState;
}

export interface LcupMissingRow {
  lcup_student_id: number;
  name: string;
  phone: string;
  student: LcupUserRef | null;
  classroom: LcupRef;
  teachers: string[];
  lcup_status: string;
  since: string | null;
  reason: MissingReason;
  reason_text: string;
}

/** /ops/trials (backend lcup.followups): read-only; a student is activated in lc-up itself. */
export interface LcupFollowups {
  free_trial_lessons: number;
  trials: LcupTrialRow[];
  not_on_list: LcupMissingRow[];
  pending: number;
}

export const lcupApi = {
  async status(): Promise<LcupStatus> {
    const { data } = await api.get<LcupStatus>("/lcup/status/");
    return data;
  },
  /** Both run in the worker; the result shows up in the run list. */
  async sync(dryRun = false): Promise<{ queued: boolean; dry_run: boolean }> {
    const { data } = await api.post(dryRun ? "/lcup/sync/?dry_run=1" : "/lcup/sync/");
    return data;
  },
  async reviewDone(): Promise<{ initial_review_done_at: string }> {
    const { data } = await api.post("/lcup/review-done/");
    return data;
  },

  async groups(): Promise<LcupGroup[]> {
    const { data } = await api.get<LcupGroup[]>("/lcup/groups/");
    return data;
  },
  /** Without a class, the backend pairs the group with its suggestion. */
  async confirmGroup(id: number, classroomId?: number): Promise<LcupGroup> {
    const { data } = await api.post(`/lcup/groups/${id}/confirm/`, classroomId ? { classroom_id: classroomId } : {});
    return data;
  },
  async createClass(id: number): Promise<LcupGroup> {
    const { data } = await api.post(`/lcup/groups/${id}/create-class/`);
    return data;
  },
  async ignoreGroup(id: number): Promise<LcupGroup> {
    const { data } = await api.post(`/lcup/groups/${id}/ignore/`);
    return data;
  },

  async students(filter: StudentFilter): Promise<LcupPerson[]> {
    const { data } = await api.get<LcupPerson[]>("/lcup/students/", { params: { status: filter } });
    return data;
  },
  async linkStudent(id: number, userId: number): Promise<LcupPerson> {
    const { data } = await api.post(`/lcup/students/${id}/link/`, { user_id: userId });
    return data;
  },
  /** `phone` only for siblings who share one in lc-up — ours must be unique. */
  async createAccount(id: number, phone?: string): Promise<LcupPerson> {
    const { data } = await api.post(`/lcup/students/${id}/create-account/`, phone ? { phone } : {});
    return data;
  },
  async ignoreStudent(id: number): Promise<LcupPerson> {
    const { data } = await api.post(`/lcup/students/${id}/ignore/`);
    return data;
  },

  async teachers(all = false): Promise<LcupPerson[]> {
    const { data } = await api.get<LcupPerson[]>("/lcup/teachers/", all ? { params: { status: "all" } } : undefined);
    return data;
  },
  async linkTeacher(id: number, userId: number): Promise<LcupPerson> {
    const { data } = await api.post(`/lcup/teachers/${id}/link/`, { user_id: userId });
    return data;
  },
  async ignoreTeacher(id: number): Promise<LcupPerson> {
    const { data } = await api.post(`/lcup/teachers/${id}/ignore/`);
    return data;
  },

  async unlinkedMembers(): Promise<LcupUnlinkedMember[]> {
    const { data } = await api.get<LcupUnlinkedMember[]>("/lcup/unlinked-members/");
    return data;
  },
  async accounts(): Promise<LcupAccount[]> {
    const { data } = await api.get<LcupAccount[]>("/lcup/accounts/");
    return data;
  },
  async attendancePushes(): Promise<LcupAttendancePush[]> {
    const { data } = await api.get<LcupAttendancePush[]>("/lcup/attendance/pushes/");
    return data;
  },
  async followups(): Promise<LcupFollowups> {
    const { data } = await api.get<LcupFollowups>("/lcup/followups/");
    return data;
  },
  async reissue(userId: number): Promise<LcupAccount> {
    const { data } = await api.post(`/lcup/accounts/${userId}/reissue/`);
    return data;
  },

  /** The student's own first password (the profile completion gate asks for it first). */
  async setInitialPassword(password: string): Promise<void> {
    await api.post("/lcup/claim/password/", { password });
  },

  /** On one of several same-name accounts: the number the administrator holds makes THIS account
   *  the one lc-up is linked to (`moved` when it was another one before). */
  async confirmPhone(phone: string): Promise<{ moved: boolean }> {
    const { data } = await api.post<{ moved: boolean }>("/lcup/claim/phone/", { phone });
    return data;
  },
  /** Another person with the same name: the phone question goes from this account. */
  async notMe(): Promise<void> {
    await api.post("/lcup/claim/phone/", { not_me: true });
  },
};
