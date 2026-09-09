import api from "@/lib/api";

/**
 * The XP a teacher gives for ONE classwork, addressed by the classwork itself.
 *
 * Deliberately separate from `lessonsApi.awardClasswork`, which finds the same award
 * through a journal lesson. Classwork written in the Classwork tab has no lesson behind
 * it, so that route cannot reach it at all; this one names the carrier directly. Both
 * write the same single row per (classwork, student) — the ledger keys on the carrier —
 * so a teacher who pays from the lesson panel and revises from here corrects the figure in
 * place instead of paying twice.
 */

/** One student on the roster, and whatever they have already been given for this classwork. */
export interface ClassworkAwardStudent {
  student_id: number;
  name: string;
  /**
   * Whether a teacher has recorded anything at all. **Test this, never `points > 0`.** A
   * recorded 0 is a teacher who looked and decided; the absence of a row is nobody having
   * looked yet, and dressing the second up as the first tells a student they earned nothing
   * when in truth they were never marked.
   */
  awarded: boolean;
  points: number;
  xp: number;
  note: string;
  awarded_at: string | null;
}

export interface ClassworkAwardsPanel {
  assignment_id: number;
  title: string;
  /** The ceiling on one award. Read from the server, never hard-coded — the school owns it. */
  max_points: number;
  /** Whether THIS viewer may write. A TA reads the panel and gets no buttons. */
  can_award: boolean;
  students: ClassworkAwardStudent[];
  /** The server's sentence about what just happened. Only on a write; absent on the read. */
  detail?: string;
}

const base = (classId: number, assignmentId: number) =>
  `/classes/${classId}/classwork/${assignmentId}/awards/`;

export const classworkAwardsApi = {
  panel: async (classId: number, assignmentId: number): Promise<ClassworkAwardsPanel> =>
    (await api.get(base(classId, assignmentId))).data,

  /** Set one student's XP. Sending a *smaller* number leaves the XP standing — see `withdraw`. */
  give: async (
    classId: number,
    assignmentId: number,
    body: { student_id: number; points: number; note?: string },
  ): Promise<ClassworkAwardsPanel> =>
    (await api.post(base(classId, assignmentId), body)).data,

  /**
   * Take one student's award back entirely, points and XP.
   *
   * **Not the same as giving 0, and the difference is the XP.** The reward engine never
   * lowers XP for doing worse (`max(previous_xp, …)`), so correcting 20 down to 0 leaves 20
   * XP on the leaderboard for ever. This is the only path that clears it, which is why the
   * dialog offers it as its own action rather than as "type zero".
   *
   * The student id rides in the query string, not a body: a DELETE body is legal but some
   * clients and proxies drop it, and a withdrawal that silently loses its target reads as
   * "that student isn't on this roster".
   */
  withdraw: async (
    classId: number,
    assignmentId: number,
    studentId: number,
  ): Promise<ClassworkAwardsPanel> =>
    (await api.delete(`${base(classId, assignmentId)}?student_id=${studentId}`)).data,
};
