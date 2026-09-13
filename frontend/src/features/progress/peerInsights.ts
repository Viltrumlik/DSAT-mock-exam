/**
 * The sentences My Progress writes on its own — "automatic", in the owner's word — out of a
 * student's comparison with their group.
 *
 * A pure function of the payload, so every sentence is testable and none is invented: each one
 * reads a figure the server sent. Growth-oriented by rule — a strength is named, a gap is said as
 * the next thing to do ("2 more homework would reach…"), and nothing calls a student behind, low
 * or last. At most three, strongest first, so the card stays a summary rather than a report.
 */
import type { PeerGroup, PeerMetric } from "./progressApi";

export type InsightTone = "success" | "warning" | "info" | "muted";
export type InsightIcon = "trophy" | "sparkles" | "target" | "calendar" | "lock" | "users";

export interface Insight {
  key: string;
  tone: InsightTone;
  icon: InsightIcon;
  text: string;
}

const MEASURE_NAME: Record<"attendance" | "homework" | "vocabulary", string> = {
  attendance: "attendance",
  homework: "homework",
  vocabulary: "words mastered",
};

/** "attendance", "attendance and homework", "attendance, homework and words mastered". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "2026-09" → "September". en-US on purpose: the page is in English, and a test must not
 *  change its sentence with the machine's locale. */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

/** The student's value minus the group's average, or null when either is missing. */
export function gapToGroup(metric: PeerMetric | undefined): number | null {
  if (!metric || metric.you == null || metric.group_average == null) return null;
  return Math.round((metric.you - metric.group_average) * 10) / 10;
}

export function peerInsights(group: PeerGroup, minPeers: number): Insight[] {
  const { attendance, homework, overall, vocabulary } = group.metrics;
  const all: (PeerMetric | undefined)[] = [attendance, homework, overall, vocabulary];

  // Nothing about the group can be said yet — say why, once, and stop.
  if (!all.some((m) => m && m.group_average != null)) {
    return [
      {
        key: "few",
        tone: "muted",
        icon: "users",
        text: `Group figures appear once ${minPeers} classmates have marks in this class.`,
      },
    ];
  }

  const out: Insight[] = [];

  // Strengths first. The top quarter on any measure is named together; failing that, being
  // above the middle overall is still worth saying.
  const tops = (["attendance", "homework", "vocabulary"] as const).filter(
    (key) => group.metrics[key]?.standing === "top_quarter",
  );
  if (tops.length > 0) {
    out.push({
      key: "top",
      tone: "success",
      icon: "trophy",
      text: `Top quarter of your group for ${list(tops.map((k) => MEASURE_NAME[k]))}.`,
    });
  } else if (overall.standing === "upper_half") {
    out.push({
      key: "upper",
      tone: "success",
      icon: "sparkles",
      text: "Overall, you're in the upper half of your group.",
    });
  }

  // The month so far, which can be good news the term's average hides: a student under the
  // group across the term who is ahead of it THIS month should hear that first, not last.
  const marked = group.attendance_trend.filter((m) => m.you != null);
  const last = marked[marked.length - 1];
  const previous = marked[marked.length - 2];
  const aheadThisMonth =
    last != null && last.you != null && last.group != null && last.you >= last.group;
  if (aheadThisMonth && attendance.standing !== "top_quarter") {
    out.push({
      key: "month-ahead",
      tone: "success",
      icon: "sparkles",
      text: `In ${monthName(last.month)} your attendance (${Math.round(last.you as number)}%) is above your group's (${Math.round(last.group as number)}%).`,
    });
  } else if (last?.you != null && previous?.you != null && last.you - previous.you >= 5) {
    out.push({
      key: "trend-up",
      tone: "success",
      icon: "sparkles",
      text: `Your attendance is up from ${Math.round(previous.you)}% in ${monthName(previous.month)} to ${Math.round(last.you)}% in ${monthName(last.month)}.`,
    });
  }

  // The actionable gap: a count of homework, which is a thing to go and do.
  const toReach = homework.detail.to_reach_average;
  if (toReach > 0) {
    out.push({
      key: "homework-gap",
      tone: "warning",
      icon: "target",
      text: `${toReach} more homework ${toReach === 1 ? "brings" : "bring"} you up to your group's average.`,
    });
  }

  // Attendance under the group's: the group's figure, and what moves it — never a verdict. Not
  // said in a month the student is already ahead: that would contradict the line above it.
  const attendanceGap = gapToGroup(attendance);
  if (!aheadThisMonth && attendanceGap != null && attendanceGap < 0 && attendance.group_average != null) {
    out.push({
      key: "attendance-gap",
      tone: "info",
      icon: "calendar",
      text: `Your group attends ${Math.round(attendance.group_average)}% of lessons — every lesson you come to closes the gap.`,
    });
  }

  if (group.standings_hidden) {
    out.push({
      key: "hidden",
      tone: "muted",
      icon: "lock",
      text: "Your teacher keeps standings in this class private, so only averages are shown.",
    });
  }

  return out.slice(0, 3);
}
