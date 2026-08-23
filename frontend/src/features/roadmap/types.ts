/**
 * Student roadmap payload — the shape returned by GET /api/classes/roadmap/.
 * See backend/classes/roadmap.py for the contract. Locked (other-level) lessons carry
 * ONLY {lesson_number, title, lesson_type, is_midterm}; the own-level fields below are
 * present only when the level `is_own_level`.
 */

export type RoadmapLessonState = "completed" | "available" | "upcoming";
export type RoadmapLessonType = "HOMEWORK" | "MIDTERM";

export type RoadmapLesson = {
  lesson_number: number;
  title: string;
  lesson_type: RoadmapLessonType;
  is_midterm: boolean;
  // Own-level only (absent on locked lessons):
  accessible?: boolean;
  state?: RoadmapLessonState;
  assignment_id?: number | null;
  scheduled_for?: string | null;
};

/**
 * One rung of a subject's ladder. Only levels the subject actually teaches are ever sent —
 * English starts at Junior and has no Foundation rung at all — so there is no "not offered"
 * flag to render: an absent level is absent, never greyed.
 */
export type RoadmapLevel = {
  level: string;
  level_label: string;
  is_own_level: boolean;
  /** False → no published journal for this level yet ("coming soon"). */
  journal_published: boolean;
  lesson_count: number;
  /** How long the school says this level takes. 0 = nobody has filled it in. */
  duration_months: number;
  lessons: RoadmapLesson[];
};

export type RoadmapTrack = {
  subject: "math" | "english";
  subject_label: string;
  own_level: string | null;
  own_level_label: string | null;
  /** The classroom whose released homework the own-level lessons link to. */
  own_classroom_id: number | null;

  // ── Summary, for the dashboard ──────────────────────────────────────────
  // Every one of these is null rather than a guess when the data cannot support it: each is
  // a claim the student will repeat to somebody.

  /** Lessons of their OWN level finished — not of the whole ladder. */
  completed_lessons: number;
  total_lessons: number;
  /** 0–1, or null when the level has no published lessons to be part-way through. */
  completion_rate: number | null;
  /** The rung above theirs; null at the top of the ladder. */
  next_level: string | null;
  next_level_label: string | null;
  /** Which week the GROUP is in, counted in lessons held. Null before the first lesson, or
   *  when the classroom's schedule cannot be read. */
  current_week: number | null;
  /** Course months left in this subject. Null when the journals carry no authored duration —
   *  which must NOT be shown as "0 months left". */
  months_remaining: number | null;

  /** The ladder itself, in order. */
  levels: RoadmapLevel[];
};

export type RoadmapResponse = {
  tracks: RoadmapTrack[];
  /** How long until the student could sit the SAT: the MAX across tracks, never the sum —
   *  one exam holds both sections, so they are ready when the slower course finishes.
   *  Null when no track can be estimated. */
  months_to_sat: number | null;
  /** Which subjects that figure actually accounts for, so the UI can say so rather than
   *  imply it covers a course it could not see. */
  months_to_sat_basis: ("math" | "english")[];
};
