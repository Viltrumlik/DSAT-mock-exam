import { describe, expect, it } from "vitest";

import { gapToGroup, peerInsights } from "../peerInsights";
import type { PeerGroup, PeerMetric } from "../progressApi";

function metric(over: Partial<PeerMetric> = {}): PeerMetric {
  return { you: 80, group_average: 70, group_median: 72, measured: 12, standing: "upper_half", ...over };
}

function group(over: Partial<PeerGroup> = {}, metrics: Partial<PeerGroup["metrics"]> = {}): PeerGroup {
  return {
    subject: "english", subject_label: "English", classroom_id: 34, classroom_name: "Middle G4",
    level: "middle", level_label: "Middle", group_size: 12, standings_hidden: false,
    recent_lessons: [], attendance_trend: [],
    ...over,
    metrics: {
      attendance: { ...metric(), detail: { present: 9, late: 1, absent: 1, excused: 0 } },
      homework: { ...metric(), detail: { completed: 6, total: 8, remaining: 2, to_reach_average: 0 } },
      overall: metric(),
      ...metrics,
    },
  };
}

/** Words a student-facing sentence must never use about them. */
const PUNISHING = /\b(behind|low|last|worst|bad|poor|fail)/i;

describe("peerInsights", () => {
  it("names the top quarter, together, when a student is there on more than one measure", () => {
    const g = group({}, {
      attendance: { ...metric({ standing: "top_quarter" }), detail: { present: 10, late: 0, absent: 0, excused: 0 } },
      vocabulary: metric({ standing: "top_quarter" }),
    });
    const texts = peerInsights(g, 4).map((i) => i.text);
    expect(texts[0]).toBe("Top quarter of your group for attendance and words mastered.");
  });

  it("turns a homework gap into the number of pieces that close it", () => {
    const g = group({}, {
      homework: { ...metric({ you: 50, standing: "lower_half" }), detail: { completed: 4, total: 8, remaining: 4, to_reach_average: 2 } },
    });
    const gap = peerInsights(g, 4).find((i) => i.key === "homework-gap");
    expect(gap?.text).toBe("2 more homework bring you up to your group's average.");
    expect(gap?.tone).toBe("warning");
  });

  it("says attendance under the group's as what moves it, never as a verdict", () => {
    const g = group({}, {
      attendance: { ...metric({ you: 60, group_average: 84.4, standing: "lower_half" }), detail: { present: 6, late: 0, absent: 4, excused: 0 } },
      overall: metric({ standing: "lower_half" }),
    });
    const insights = peerInsights(g, 4);
    expect(insights.map((i) => i.key)).toContain("attendance-gap");
    for (const insight of insights) expect(insight.text).not.toMatch(PUNISHING);
  });

  it("says why there is no group figure instead of guessing one", () => {
    const none = metric({ group_average: null, group_median: null, measured: null, standing: null });
    const g = group({}, {
      attendance: { ...none, detail: { present: 3, late: 0, absent: 0, excused: 0 } },
      homework: { ...none, detail: { completed: 1, total: 2, remaining: 1, to_reach_average: 0 } },
      overall: none,
    });
    expect(peerInsights(g, 4)).toEqual([
      expect.objectContaining({ key: "few", text: "Group figures appear once 4 classmates have marks in this class." }),
    ]);
  });

  it("leads with this month when a student under the group's term average is ahead of it now", () => {
    // The shape of a real group on production: under the group across the term, ahead in September.
    const g = group(
      {
        attendance_trend: [
          { month: "2026-08", you: 62.5, group: 80.2 },
          { month: "2026-09", you: 70, group: 69.2 },
        ],
      },
      {
        attendance: { ...metric({ you: 66.7, group_average: 74.1, standing: "lower_half" }), detail: { present: 8, late: 0, absent: 4, excused: 0 } },
        overall: metric({ standing: "lower_half" }),
      },
    );
    const insights = peerInsights(g, 4);
    expect(insights[0].text).toBe("In September your attendance (70%) is above your group's (69%).");
    // …and the term-average line that would contradict it is not said in the same breath.
    expect(insights.map((i) => i.key)).not.toContain("attendance-gap");
  });

  it("notices attendance rising month on month", () => {
    const g = group(
      {
        attendance_trend: [
          { month: "2026-07", you: 60, group: 75 },
          { month: "2026-08", you: 71.4, group: 78 },
        ],
      },
      { overall: metric({ standing: "lower_half" }) },
    );
    expect(peerInsights(g, 4).map((i) => i.text)).toContain(
      "Your attendance is up from 60% in July to 71% in August.",
    );
  });

  it("explains hidden standings", () => {
    const g = group({ standings_hidden: true }, { overall: metric({ standing: null }) });
    expect(peerInsights(g, 4).map((i) => i.key)).toContain("hidden");
  });

  it("stops at three", () => {
    const g = group({ standings_hidden: true }, {
      attendance: { ...metric({ you: 50, group_average: 80, standing: "top_quarter" }), detail: { present: 5, late: 0, absent: 5, excused: 0 } },
      homework: { ...metric({ standing: "lower_half" }), detail: { completed: 1, total: 8, remaining: 7, to_reach_average: 4 } },
    });
    expect(peerInsights(g, 4)).toHaveLength(3);
  });
});

describe("gapToGroup", () => {
  it("is the student minus the group, or null when either is missing", () => {
    expect(gapToGroup(metric({ you: 92.5, group_average: 81.3 }))).toBe(11.2);
    expect(gapToGroup(metric({ you: null }))).toBeNull();
    expect(gapToGroup(metric({ group_average: null }))).toBeNull();
    expect(gapToGroup(undefined)).toBeNull();
  });
});
