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

export const progressApi = {
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
