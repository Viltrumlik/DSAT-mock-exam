import api from "@/lib/api";

/** How a student did on the attendance register of one classroom. */
export interface ProgressAttendance {
  /** 0–100, weighted: present 1, late ½, absent 0. Null when nothing is marked. */
  rate: number | null;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** The denominator — sessions minus the excused ones. */
  counted: number;
}

/** How much of one classroom's published homework they finished. */
export interface ProgressHomework {
  rate: number;
  completed: number;
  total: number;
}

export interface ProgressLevel {
  level: string;
  level_label: string;
  /**
   * `current`      — the level they are studying now
   * `done`         — a level they have finished, with real numbers
   * `not-recorded` — below their level, but they never sat it here (joined part-way)
   * `upcoming`     — still ahead of them
   */
  state: "current" | "done" | "not-recorded" | "upcoming";
  classroom_id: number | null;
  classroom_name: string | null;
  attendance: ProgressAttendance | null;
  homework: ProgressHomework | null;
  /** The two halves combined, or null when neither could be measured. NEVER 0 for "unknown". */
  overall: number | null;
  /** Which halves the number above actually counted. */
  basis: string[];
}

export interface ProgressTrack {
  subject: "math" | "english";
  subject_label: string;
  current_level: string | null;
  current_level_label: string | null;
  levels: ProgressLevel[];
}

export interface ProgressResponse {
  tracks: ProgressTrack[];
  /** The mean of every level that has a number. Null when nothing is measurable yet. */
  overall: number | null;
  weights: { attendance: number; homework: number };
}

/** A quarter band, never a rank — "top quarter" is something to aim at; "17th of 18" is not. */
export type PeerStanding = "top_quarter" | "upper_half" | "lower_half";

/**
 * One measure, the student beside their group. Group figures are aggregates over the roster and
 * are null below the server's minimum group size — never zero, and never a classmate's own number.
 */
export interface PeerMetric {
  you: number | null;
  group_average: number | null;
  group_median: number | null;
  /** How many students the group figures cover, the student included. */
  measured: number | null;
  /** Null when the group is too small, the student has no value, or the teacher hid standings. */
  standing: PeerStanding | null;
}

export interface PeerAttendance extends PeerMetric {
  detail: { present: number; late: number; absent: number; excused: number };
}

export interface PeerHomework extends PeerMetric {
  detail: {
    completed: number;
    total: number;
    remaining: number;
    /** Further pieces that would lift the student to the group's average; 0 when already there. */
    to_reach_average: number;
  };
}

export type LessonStatus = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export interface PeerGroup {
  subject: "math" | "english";
  subject_label: string;
  classroom_id: number;
  classroom_name: string;
  level: string;
  level_label: string;
  group_size: number;
  /** The teacher set this class's leaderboard to hidden: averages only, no bands. */
  standings_hidden: boolean;
  metrics: {
    attendance: PeerAttendance;
    homework: PeerHomework;
    overall: PeerMetric;
    /** English groups only — words proved in all four games. */
    vocabulary?: PeerMetric;
  };
  /** The student's own last marked lessons, oldest first. */
  recent_lessons: { date: string; status: LessonStatus }[];
  /** "YYYY-MM" months with marks, oldest first; `group` null where too few were marked. */
  attendance_trend: { month: string; you: number | null; group: number | null }[];
}

export interface PeerResponse {
  groups: PeerGroup[];
  min_peers: number;
}

export const progressApi = {
  /** The student beside their group, per subject. Its own request, so the ladder never waits. */
  peers: async (): Promise<PeerResponse> => {
    const r = await api.get<PeerResponse>("/classes/progress/peers/");
    // Spread with defaults — the same rule as `mine` below.
    return { ...r.data, groups: r.data?.groups ?? [], min_peers: r.data?.min_peers ?? 4 };
  },
  mine: async (): Promise<ProgressResponse> => {
    const r = await api.get<ProgressResponse>("/classes/progress/");
    // Spread with defaults, never a field-by-field rebuild — a hand-written whitelist here
    // is the bug class that dropped `months_to_sat` from the roadmap payload and took the
    // student dashboard down in production.
    return {
      ...r.data,
      tracks: r.data?.tracks ?? [],
      overall: r.data?.overall ?? null,
      weights: r.data?.weights ?? { attendance: 0.5, homework: 0.5 },
    };
  },
};
