/**
 * A homework that sets a past paper the student already sat offers it again.
 *
 * The launcher used to read "Review" on any finished paper, so a homework setting the same
 * paper again could not be done at all. The server now counts only sittings finished since the
 * homework was set, and flags the rest `retake`: the button starts a new sitting and says so.
 */
import { describe, expect, it } from "vitest";

import { contentActions, launcherLabel, type AssignmentDetail } from "../homeworkApi";

function pastpaperHomework(section: NonNullable<AssignmentDetail["practice_bundle_tests"]>[number]): AssignmentDetail {
  return {
    id: 102,
    title: "Lesson 14 homework",
    due_at: null,
    status: "PUBLISHED",
    category: "HOMEWORK",
    max_score: null,
    practice_test_ids: [section.id],
    practice_bundle_tests: [section],
  };
}

describe("the past-paper launcher", () => {
  it("starts a new sitting of a paper sat before the homework, and says so", () => {
    const [action] = contentActions(
      pastpaperHomework({ id: 12, name: "SAT March 2024", state: "not_started", attempt_id: null, retake: true }),
    );

    expect([action.mode, action.startTestId, action.retake]).toEqual(["start", 12, true]);
    expect(launcherLabel(action)).toBe("Start again");
  });

  it("reviews the new sitting once it is done", () => {
    const [action] = contentActions(
      pastpaperHomework({ id: 12, name: "SAT March 2024", state: "completed", attempt_id: 90, retake: false }),
    );

    expect([action.mode, action.attemptId]).toEqual(["review", 90]);
    expect(launcherLabel(action)).toBe("Review");
  });

  it("is a plain Start for a paper never sat", () => {
    const [action] = contentActions(
      pastpaperHomework({ id: 12, name: "SAT March 2024", state: "not_started", attempt_id: null }),
    );

    expect(launcherLabel(action)).toBe("Start");
  });

  it("resumes an open sitting whatever came before it", () => {
    expect(launcherLabel({ mode: "resume", retake: true })).toBe("Resume");
  });
});
