import type { ReopenedPastpaper } from "./pastpaperReportApi";

/** The fields of a `GET /exams/attempts/` row that a past-paper card reads. */
export type CardAttempt = {
  id: number;
  practice_test: number;
  is_completed: boolean;
  is_expired: boolean;
  score: number | null;
  completed_at?: string | null;
  submitted_at?: string | null;
  current_state?: string;
};

/**
 * - `new`: never sat.
 * - `progress`: a sitting is open, newer than the last finished one.
 * - `reopened`: finished before, and a homework has set it again since. The server decides
 *   that (`GET /classes/pastpapers/reopened/`), and the card offers "Start again".
 * - `completed`: finished, and nothing has set it again.
 */
export type CardStatus = "new" | "progress" | "reopened" | "completed";

export type CardState = {
  status: CardStatus;
  /** The newest finished sitting's score: a paper sat again shows the new result. */
  score: number | null;
  completedDate: string | null;
  /** The newest finished sitting. Review, the report and the history open from it. */
  completedAttemptId: number | null;
  /** The open sitting a Resume continues, when there is one. */
  openAttemptId: number | null;
  /** How many finished sittings the history lists. */
  sittings: number;
  /** The homework that set the paper again, when it has. */
  reopenedBy: ReopenedPastpaper | null;
};

/**
 * What one past-paper card shows, from the student's attempts on it (any order).
 *
 * An open attempt counts only when it is newer than the last finished one. An older one is a
 * leftover from before that finish, and the card has always ignored it once the paper was done.
 */
export function cardState(attempts: CardAttempt[], reopened?: ReopenedPastpaper | null): CardState {
  const newestFirst = [...attempts].sort((a, b) => b.id - a.id);
  const finished = newestFirst.filter((a) => a.is_completed);
  const last = finished[0] ?? null;
  const open = newestFirst.find(
    (a) => !a.is_completed && !a.is_expired && (last == null || a.id > last.id),
  );
  const status: CardStatus = open
    ? "progress"
    : last && reopened
      ? "reopened"
      : last
        ? "completed"
        : "new";
  return {
    status,
    score: last?.score ?? null,
    completedDate: last?.completed_at || last?.submitted_at || null,
    completedAttemptId: last?.id ?? null,
    openAttemptId: open?.id ?? null,
    sittings: finished.length,
    reopenedBy: last && reopened ? reopened : null,
  };
}
