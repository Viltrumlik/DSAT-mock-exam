import { describe, expect, it } from "vitest";

import type { PastpaperSection } from "@/lib/api";
import type { MidtermRow } from "@/lib/midtermApi";
import { bucketMidterms } from "@/lib/midtermBuckets";

import { groupPastpapers, midtermStatus, paperAction } from "../homeModel";

function section(id: number, date: string, subject: string, name = "Oct A"): PastpaperSection {
  return {
    id,
    title: "",
    practice_date: date,
    subject,
    label: "A",
    form_type: "INTERNATIONAL",
    collection_name: name,
    is_published: true,
    modules: [],
  } as unknown as PastpaperSection;
}

function midterm(over: Partial<MidtermRow> = {}): MidtermRow {
  return {
    midterm_id: 1,
    title: "Math Midterm",
    subject: "MATH",
    scoring_scale: "SCALE_100",
    score_ceiling: 100,
    duration_minutes: 60,
    question_count: 20,
    flavor: "CLASSROOM",
    attempt_id: null,
    state: "NOT_STARTED",
    submitted: false,
    is_open: true,
    is_before_start: false,
    awaiting_code: false,
    available_at: null,
    deadline: null,
    results_visible: false,
    score: null,
    certificate: null,
    ...over,
  };
}

describe("past papers on the home screen", () => {
  it("groups by month, newest first, Reading & Writing before Math", () => {
    const groups = groupPastpapers(
      [
        section(1, "2025-08-23", "MATH"),
        section(2, "2025-10-04", "MATH"),
        section(3, "2025-10-04", "READING_WRITING"),
      ],
      [],
      [],
    );
    expect(groups.map((g) => g.name)).toEqual(["October 2025", "August 2025"]);
    expect(groups[0].items.map((r) => r.section.id)).toEqual([3, 2]);
  });

  it("reads each card's state from the student's attempts", () => {
    const [group] = groupPastpapers(
      [section(7, "2025-10-04", "MATH")],
      [{ id: 50, practice_test: 7, is_completed: false, is_expired: false, score: null }],
      [],
    );
    expect(group.items[0].state.status).toBe("progress");
    expect(paperAction(group.items[0].state).label).toBe("Resume");
  });

  it("names the button for every state", () => {
    const base = { score: null, completedDate: null, completedAttemptId: null, openAttemptId: null, sittings: 0, reopenedBy: null };
    expect(paperAction({ ...base, status: "new" })).toEqual({ label: "Start", finished: false });
    expect(paperAction({ ...base, status: "reopened" })).toEqual({ label: "Start again", finished: false });
    expect(paperAction({ ...base, status: "completed" })).toEqual({ label: "See score", finished: true });
  });
});

describe("midterms on the home screen", () => {
  it("offers Start, or Resume for a sitting already under way", () => {
    expect(midtermStatus(midterm(), "available")).toEqual({ label: "Start", actionable: true });
    expect(midtermStatus(midterm({ attempt_id: 9, state: "MODULE_1_ACTIVE" }), "available").label).toBe("Resume");
  });

  it("says why a scheduled one can't open yet", () => {
    expect(midtermStatus(midterm({ is_open: false, awaiting_code: true }), "scheduled").label).toBe(
      "Waiting for your teacher to start it",
    );
    expect(midtermStatus(midterm({ is_open: false, is_before_start: true, available_at: null }), "scheduled").label).toBe(
      "Opens soon",
    );
  });

  it("shows a score only once it is released", () => {
    expect(midtermStatus(midterm({ submitted: true, score: 80 }), "past").label).toBe(
      "Finished — your result is on its way",
    );
    expect(midtermStatus(midterm({ submitted: true, score: 80, results_visible: true }), "past").label).toBe(
      "Score 80 / 100",
    );
    expect(midtermStatus(midterm({ is_open: false }), "missed").label).toBe("Not taken");
  });

  it("buckets exactly as the site's Midterms page does", () => {
    const b = bucketMidterms([
      midterm({ midterm_id: 1 }),
      midterm({ midterm_id: 2, is_open: false, awaiting_code: true }),
      midterm({ midterm_id: 3, submitted: true }),
      midterm({ midterm_id: 4, submitted: true, resit_open: true }),
      midterm({ midterm_id: 5, is_open: false }),
      midterm({ midterm_id: 6, is_open: false, attempt_id: 3, state: "MODULE_1_ACTIVE" }),
    ]);
    expect(b.available.map((m) => m.midterm_id)).toEqual([1, 4, 6]);
    expect(b.scheduled.map((m) => m.midterm_id)).toEqual([2]);
    expect(b.past.map((m) => m.midterm_id)).toEqual([3]);
    expect(b.missed.map((m) => m.midterm_id)).toEqual([5]);
  });
});
