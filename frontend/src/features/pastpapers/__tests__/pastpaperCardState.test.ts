/**
 * What a past-paper card shows.
 *
 * Before a homework could set a paper again, a finished paper was finished for good: the card
 * read "Completed" and only offered the review. Now a paper set again comes back as work to
 * start, the card keeps showing the last score until the new one replaces it, and the newest
 * sitting's score is always the one on the card.
 */
import { describe, expect, it } from "vitest";

import { cardState, type CardAttempt } from "../pastpaperCardState";
import type { ReopenedPastpaper } from "../pastpaperReportApi";

function sitting(id: number, score: number, completed_at = "2026-08-01T10:00:00Z"): CardAttempt {
  return { id, practice_test: 12, is_completed: true, is_expired: false, score, completed_at };
}

function open(id: number): CardAttempt {
  return { id, practice_test: 12, is_completed: false, is_expired: false, score: null };
}

const SET_AGAIN: ReopenedPastpaper = {
  practice_test_id: 12,
  assignment_id: 40,
  assignment_title: "Lesson 14 homework",
  classroom_id: 3,
  classroom_name: "SAT Math A",
  set_at: "2026-09-10T09:00:00Z",
  due_at: null,
};

describe("cardState", () => {
  it("is new when the paper was never sat", () => {
    expect(cardState([]).status).toBe("new");
  });

  it("is completed with its score once sat", () => {
    const d = cardState([sitting(5, 560)]);
    expect([d.status, d.score, d.completedAttemptId, d.sittings]).toEqual(["completed", 560, 5, 1]);
  });

  it("shows the NEWEST sitting's score, whatever order the attempts arrive in", () => {
    const d = cardState([sitting(9, 690, "2026-09-12T10:00:00Z"), sitting(5, 560)].reverse());
    expect([d.score, d.completedAttemptId, d.sittings]).toEqual([690, 9, 2]);
  });

  it("comes back as work to start when a homework sets it again", () => {
    const d = cardState([sitting(5, 560)], SET_AGAIN);
    expect(d.status).toBe("reopened");
    // The last score stays on the card until the new sitting replaces it.
    expect(d.score).toBe(560);
    expect(d.reopenedBy?.assignment_title).toBe("Lesson 14 homework");
    expect(d.openAttemptId).toBeNull();
  });

  it("resumes the new sitting once it has been started", () => {
    const d = cardState([sitting(5, 560), open(8)], SET_AGAIN);
    expect([d.status, d.openAttemptId, d.score]).toEqual(["progress", 8, 560]);
  });

  it("ignores a leftover open attempt from before the last finish", () => {
    const d = cardState([open(3), sitting(5, 560)]);
    expect([d.status, d.openAttemptId]).toEqual(["completed", null]);
  });

  it("does not call a paper nobody finished 'set again'", () => {
    // The server only lists papers the student finished; a stray entry must not turn a new
    // paper into a retake.
    const d = cardState([], SET_AGAIN);
    expect([d.status, d.reopenedBy]).toEqual(["new", null]);
  });
});
