/**
 * My Progress, with the comparison: what the page must say, and must not.
 *
 * The comparison arrives on its own request, so the two can fail apart — the ladder must survive a
 * failed comparison. A group figure the server withheld reads "No group figure yet", never 0%.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerGroup, PeerMetric, PeerResponse, ProgressResponse } from "../progressApi";

const useMyProgress = vi.fn();
const useMyPeerProgress = vi.fn();

vi.mock("../progressHooks", () => ({
  useMyProgress: () => useMyProgress(),
  useMyPeerProgress: () => useMyPeerProgress(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const { MyProgressPage } = await import("../MyProgressPage");

const LADDER: ProgressResponse = {
  overall: 78,
  weights: { attendance: 0.5, homework: 0.5 },
  tracks: [{
    subject: "english", subject_label: "English", current_level: "middle", current_level_label: "Middle",
    levels: [{
      level: "middle", level_label: "Middle", state: "current", classroom_id: 34, classroom_name: "Middle G4",
      attendance: { rate: 92.5, present: 12, late: 1, absent: 0, excused: 1, counted: 13 },
      homework: { rate: 75, completed: 6, total: 8 },
      overall: 83.8, basis: ["attendance", "homework"],
    }],
  }],
};

function metric(over: Partial<PeerMetric> = {}): PeerMetric {
  return { you: 92.5, group_average: 81.3, group_median: 85, measured: 17, standing: "top_quarter", ...over };
}

function peerGroup(over: Partial<PeerGroup> = {}): PeerGroup {
  return {
    subject: "english", subject_label: "English", classroom_id: 34, classroom_name: "Middle G4",
    level: "middle", level_label: "Middle", group_size: 18, standings_hidden: false,
    metrics: {
      attendance: { ...metric(), detail: { present: 12, late: 1, absent: 0, excused: 1 } },
      homework: { ...metric({ you: 75, group_average: 80, standing: "lower_half" }), detail: { completed: 6, total: 8, remaining: 2, to_reach_average: 1 } },
      overall: metric({ you: 83.8, group_average: 80.1, standing: "upper_half" }),
      vocabulary: metric({ you: 120, group_average: 85.4, standing: "top_quarter" }),
    },
    recent_lessons: [
      { date: "2026-09-07", status: "PRESENT" },
      { date: "2026-09-09", status: "LATE" },
      { date: "2026-09-11", status: "ABSENT" },
    ],
    attendance_trend: [
      { month: "2026-08", you: 88, group: 79.5 },
      { month: "2026-09", you: 95, group: null },
    ],
    ...over,
  };
}

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

let host: HTMLElement;
let root: Root;

async function render() {
  await act(async () => root.render(<MyProgressPage />));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  useMyProgress.mockReturnValue(ok(LADDER));
  useMyPeerProgress.mockReturnValue(ok<PeerResponse>({ groups: [peerGroup()], min_peers: 4 }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

describe("MyProgressPage — you and your group", () => {
  it("puts the student beside their group, with the sentences it works out itself", async () => {
    await render();
    const text = host.textContent ?? "";

    expect(text).toContain("You and your group");
    expect(text).toContain("Middle G4");
    expect(text).toContain("18 students");
    expect(text).toContain("Group average 81%");
    expect(text).toContain("+11 vs group");
    expect(text).toContain("Top quarter of your group for attendance and words mastered.");
    expect(text).toContain("1 more homework brings you up to your group's average.");
    // The lower-half band is said as the next step, not as a label.
    expect(text).toContain("1 more to reach your group's average");
    expect(host.querySelector('a[href="/classes/34"]')).not.toBeNull();
  });

  it("marks the student's own lessons with what happened, calling an absence missed", async () => {
    await render();
    const labels = Array.from(host.querySelectorAll('[role="img"][aria-label]')).map((el) => el.getAttribute("aria-label"));

    expect(labels.some((l) => l?.endsWith(": Present"))).toBe(true);
    expect(labels.some((l) => l?.endsWith(": Missed"))).toBe(true);
    expect(labels.some((l) => l?.includes("Absent"))).toBe(false);
  });

  it("shows a withheld group figure as missing, never as zero", async () => {
    const none = metric({ group_average: null, group_median: null, measured: null, standing: null });
    useMyPeerProgress.mockReturnValue(ok<PeerResponse>({
      groups: [peerGroup({
        metrics: {
          attendance: { ...none, detail: { present: 3, late: 0, absent: 0, excused: 0 } },
          homework: { ...none, detail: { completed: 1, total: 2, remaining: 1, to_reach_average: 0 } },
          overall: none,
        },
      })],
      min_peers: 4,
    }));
    await render();
    const text = host.textContent ?? "";

    expect(text).toContain("No group figure yet");
    expect(text).toContain("Group figures appear once 4 classmates have marks in this class.");
    expect(text).not.toContain("Group average 0%");
  });

  it("keeps the ladder when the comparison fails, and says the comparison failed", async () => {
    useMyPeerProgress.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: vi.fn() });
    await render();
    const text = host.textContent ?? "";

    expect(text).toContain("didn’t load");
    expect(text).toContain("Level by level");
    expect(text).toContain("Studying now");
  });

  it("leaves vocabulary off a group that has none", async () => {
    const g = peerGroup();
    delete g.metrics.vocabulary;
    useMyPeerProgress.mockReturnValue(ok<PeerResponse>({ groups: [{ ...g, subject: "math", subject_label: "Math" }], min_peers: 4 }));
    await render();

    expect(host.textContent).not.toContain("Words mastered");
  });
});
